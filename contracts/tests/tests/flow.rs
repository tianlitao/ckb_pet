//! PetCell v2 contract integration tests, executed in CKB-VM.
//!
//! Build prerequisites:
//! `cargo build --release --target riscv64imac-unknown-none-elf`

use ckb_crypto::secp::{Generator, Privkey};
use ckb_hash::{blake2b_256, new_blake2b};
use ckb_system_scripts::BUNDLED_CELL;
use ckb_testtool::ckb_types::{
    bytes::Bytes as RawBytes,
    core::{
        DepType, EpochNumberWithFraction, HeaderBuilder, ScriptHashType, TransactionBuilder,
        TransactionView,
    },
    packed::{
        Byte32, Bytes as MoleculeBytes, BytesOptBuilder, CellDep, CellDepBuilder, CellInput,
        CellOutput, CellOutputBuilder, OutPoint, Script, WitnessArgs, WitnessArgsBuilder,
    },
    prelude::*,
    H256,
};
use ckb_testtool::context::Context;
use pet_common::{
    encode_witness, occupied_capacity, PetData, BURN_PER_DAY, EUTHANASIA_PENALTY_BP, MIN_BURN,
    OP_ADOPT, OP_EUTHANIZE, OP_FEED, OP_POKE, OP_TRANSFER, STATE_ALIVE, STATE_DEAD,
};

const MAX_CYCLES: u64 = 100_000_000;
const DAY_MS: u64 = 86_400_000;
const SHANNONS: u128 = 100_000_000;
const PET_OVERHEAD: u128 = (8 + 33 + 64 + 33 + 32) * SHANNONS;

fn ckb(n: u128) -> u128 {
    n * SHANNONS
}

fn elf_bytes(name: &str) -> RawBytes {
    let path = format!("../target/riscv64imac-unknown-none-elf/release/{name}");
    RawBytes::from(std::fs::read(&path).unwrap_or_else(|_| panic!("missing ELF: {path}")))
}

struct World {
    context: Context,
    pet_type_op: OutPoint,
    pet_lock_op: OutPoint,
    owner_op: OutPoint,
    secp_data_op: OutPoint,
    secp_lock_op: OutPoint,
    pet_type_script: Script,
    pet_lock_owner: Script,
    pet_lock_stranger: Script,
    owner_lock: Script,
    stranger_lock: Script,
    owner_hash: Byte32,
}

impl World {
    fn new() -> Self {
        let mut context = Context::default();
        let pet_type_op = context.deploy_cell(elf_bytes("pet-type"));
        let pet_lock_op = context.deploy_cell(elf_bytes("pet-lock"));
        let owner_op = context.deploy_cell(elf_bytes("always-success"));
        let secp_data_op = context.deploy_cell(
            BUNDLED_CELL
                .get("specs/cells/secp256k1_data")
                .unwrap()
                .to_vec()
                .into(),
        );
        let secp_lock_op = context.deploy_cell(
            BUNDLED_CELL
                .get("specs/cells/secp256k1_blake160_sighash_all")
                .unwrap()
                .to_vec()
                .into(),
        );

        let owner_lock = context
            .build_script_with_hash_type(
                &owner_op,
                ScriptHashType::Data1,
                RawBytes::from(b"owner-alice".to_vec()),
            )
            .unwrap();
        let stranger_lock = context
            .build_script_with_hash_type(
                &owner_op,
                ScriptHashType::Data1,
                RawBytes::from(b"stranger-bob".to_vec()),
            )
            .unwrap();
        let owner_hash = owner_lock.calc_script_hash();
        let stranger_hash = stranger_lock.calc_script_hash();
        // Match the production deployment shape: both script cells are
        // referenced through their TYPE_ID wrapper (hash_type Type), not by
        // the raw ELF data hash.
        let pet_lock_code_hash = context
            .build_script_with_hash_type(&pet_lock_op, ScriptHashType::Type, RawBytes::default())
            .unwrap()
            .code_hash();
        let pet_type_script = context
            .build_script_with_hash_type(
                &pet_type_op,
                ScriptHashType::Type,
                RawBytes::from(pet_lock_code_hash.raw_data().to_vec()),
            )
            .unwrap();
        let full_pet_type_hash = pet_type_script.calc_script_hash();

        let pet_lock_args = |owner: &Byte32| {
            let mut args = full_pet_type_hash.raw_data().to_vec();
            args.extend_from_slice(owner.raw_data().as_ref());
            RawBytes::from(args)
        };
        let pet_lock_owner = context
            .build_script_with_hash_type(
                &pet_lock_op,
                ScriptHashType::Type,
                pet_lock_args(&owner_hash),
            )
            .unwrap();
        let pet_lock_stranger = context
            .build_script_with_hash_type(
                &pet_lock_op,
                ScriptHashType::Type,
                pet_lock_args(&stranger_hash),
            )
            .unwrap();

        World {
            context,
            pet_type_op,
            pet_lock_op,
            owner_op,
            secp_data_op,
            secp_lock_op,
            pet_type_script,
            pet_lock_owner,
            pet_lock_stranger,
            owner_lock,
            stranger_lock,
            owner_hash,
        }
    }

    fn deps(&self) -> Vec<CellDep> {
        let dep = |op: &OutPoint| {
            CellDepBuilder::default()
                .out_point(op.clone())
                .dep_type(DepType::Code)
                .build()
        };
        vec![
            dep(&self.pet_type_op),
            dep(&self.pet_lock_op),
            dep(&self.owner_op),
            dep(&self.secp_data_op),
            dep(&self.secp_lock_op),
        ]
    }

    fn data2_type(&mut self, args: RawBytes) -> Script {
        self.context
            .build_script_with_hash_type(&self.pet_type_op, ScriptHashType::Data2, args)
            .unwrap()
    }

    fn fund(&mut self, lock: Script, shannons: u128) -> OutPoint {
        let cell = CellOutputBuilder::default()
            .capacity(shannons as u64)
            .lock(lock)
            .build();
        self.context.create_cell(cell, RawBytes::new())
    }

    fn pet_output(
        &self,
        lock: &Script,
        data: &PetData,
        surplus: u128,
    ) -> (CellOutput, MoleculeBytes) {
        self.pet_output_with_type(&self.pet_type_script, lock, data, surplus)
    }

    fn pet_output_with_type(
        &self,
        type_script: &Script,
        lock: &Script,
        data: &PetData,
        surplus: u128,
    ) -> (CellOutput, MoleculeBytes) {
        let data_bytes = MoleculeBytes::from(data.encode());
        let occupied = occupied_capacity(64, Some(32), data_bytes.len());
        assert_eq!(
            occupied - (data_bytes.len() as u128 * SHANNONS),
            PET_OVERHEAD
        );
        let cell = CellOutputBuilder::default()
            .capacity((occupied + surplus) as u64)
            .lock(lock.clone())
            .type_(Some(type_script.clone()))
            .build();
        (cell, data_bytes)
    }

    fn create_pet(&mut self, last_touched: u64, surplus: u128) -> OutPoint {
        let (cell, data) =
            self.pet_output(&self.pet_lock_owner, &alive_data(last_touched), surplus);
        self.context
            .create_cell(cell, RawBytes::from(data.raw_data().to_vec()))
    }

    fn create_dead_pet(&mut self, last_touched: u64) -> OutPoint {
        let mut data = alive_data(last_touched);
        data.state = STATE_DEAD;
        let (cell, bytes) = self.pet_output(&self.pet_lock_owner, &data, 0);
        self.context
            .create_cell(cell, RawBytes::from(bytes.raw_data().to_vec()))
    }

    fn dead_output(&self, data: &PetData) -> (CellOutput, MoleculeBytes) {
        let bytes = MoleculeBytes::from(data.encode());
        let occupied = occupied_capacity(64, Some(32), bytes.len());
        let cell = CellOutputBuilder::default()
            .capacity(occupied as u64)
            .lock(self.pet_lock_owner.clone())
            .type_(Some(self.pet_type_script.clone()))
            .build();
        (cell, bytes)
    }
}

fn alive_data(last_touched: u64) -> PetData {
    PetData {
        version: 0,
        state: STATE_ALIVE,
        genes: [1u8; 32],
        birth_time: 0,
        last_touched,
        generation: 1,
        breed_lock_until: 0,
        name: b"test".to_vec(),
    }
}

fn adoption_data(last_touched: u64) -> PetData {
    let mut data = alive_data(last_touched);
    data.birth_time = last_touched;
    data
}

fn dead_data(last_touched: u64) -> PetData {
    let mut data = alive_data(last_touched);
    data.state = STATE_DEAD;
    data
}

fn genes_for(fund_op: &OutPoint, output_index: u32) -> [u8; 32] {
    let mut seed = Vec::with_capacity(40);
    let fund_index: u32 = fund_op.index().unpack();
    seed.extend_from_slice(fund_op.tx_hash().raw_data().as_ref());
    seed.extend_from_slice(&fund_index.to_le_bytes());
    seed.extend_from_slice(&output_index.to_le_bytes());
    blake2b_256(&seed)
}

fn clock(world: &mut World, ts_ms: u64) -> Byte32 {
    let header = HeaderBuilder::default()
        .timestamp(ts_ms)
        .number(42u64)
        .epoch(EpochNumberWithFraction::new(42, 0, 1800))
        .build();
    world.context.insert_header(header.clone());
    header.hash()
}

fn pet_witness(op: u8, clock_hash: &Byte32) -> MoleculeBytes {
    let witness = encode_witness(op, clock_hash.raw_data().as_ref().try_into().unwrap());
    let input_type = BytesOptBuilder::default().set(Some(witness.pack())).build();
    WitnessArgsBuilder::default()
        .input_type(input_type)
        .build()
        .as_bytes()
        .to_vec()
        .pack()
}

fn empty_witness() -> MoleculeBytes {
    MoleculeBytes::default()
}

fn build_tx(
    world: &mut World,
    inputs: &[OutPoint],
    outputs: &[(CellOutput, MoleculeBytes)],
    header_deps: Vec<Byte32>,
    witnesses: Vec<MoleculeBytes>,
) -> TransactionView {
    let tx = TransactionBuilder::default()
        .inputs(
            inputs
                .iter()
                .map(|op| CellInput::new_builder().previous_output(op.clone()).build())
                .collect::<Vec<_>>(),
        )
        .outputs(
            outputs
                .iter()
                .map(|(cell, _)| cell.clone())
                .collect::<Vec<_>>(),
        )
        .outputs_data(
            outputs
                .iter()
                .map(|(_, data)| data.clone())
                .collect::<Vec<_>>(),
        )
        .cell_deps(world.deps())
        .header_deps(header_deps)
        .witnesses(witnesses)
        .build();
    world.context.complete_tx(tx)
}

fn change_cell(lock: &Script, shannons: u128) -> (CellOutput, MoleculeBytes) {
    (
        CellOutputBuilder::default()
            .capacity(shannons as u64)
            .lock(lock.clone())
            .build(),
        MoleculeBytes::default(),
    )
}

fn expect_ok(world: &World, tx: &TransactionView, name: &str) {
    if let Err(error) = world.context.verify_tx(tx, MAX_CYCLES) {
        for message in world.context.captured_messages() {
            println!("[{name}] contract debug: {}", message.message);
        }
        panic!("{name} should verify but failed: {error:?}");
    }
}

fn expect_fail(world: &World, tx: &TransactionView, name: &str) {
    if world.context.verify_tx(tx, MAX_CYCLES).is_ok() {
        panic!("{name} should NOT verify but passed");
    }
}

fn wrong_pet_lock(world: &mut World, owner: &Byte32) -> Script {
    let mut args = world.pet_type_script.calc_script_hash().raw_data().to_vec();
    args.extend_from_slice(owner.raw_data().as_ref());
    world
        .context
        .build_script_with_hash_type(&world.owner_op, ScriptHashType::Data1, RawBytes::from(args))
        .unwrap()
}

#[test]
fn pet_type_rejects_wrong_lock_code_hash() {
    let mut world = World::new();
    let pet = world.create_pet(1_000_000, ckb(20));
    let owner_hash = world.owner_hash.clone();
    let wrong_lock = wrong_pet_lock(&mut world, &owner_hash);
    let now = 1_000_000 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let (out, bytes) = world.pet_output(&wrong_lock, &alive_data(now), ckb(15));
    let tx = build_tx(
        &mut world,
        &[pet],
        &[(out, bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_POKE, &clock_hash)],
    );
    expect_fail(&world, &tx, "pet_type_rejects_wrong_lock_code_hash");
}

fn blake160(data: &[u8]) -> [u8; 20] {
    let mut out = [0u8; 20];
    out.copy_from_slice(&blake2b_256(data)[..20]);
    out
}

fn sign_secp_tx(tx: &TransactionView, key: &Privkey, position: usize) -> TransactionView {
    const SIGNATURE_SIZE: usize = 65;
    let witnesses = tx.witnesses();
    let mut hasher = new_blake2b();
    let mut message = [0u8; 32];
    hasher.update(&tx.hash().raw_data());
    let raw_witness = tx.witnesses().get(position).unwrap();
    let original_signed_witness = if raw_witness.raw_data().is_empty() {
        WitnessArgs::default()
    } else {
        WitnessArgs::from_slice(raw_witness.raw_data().as_ref()).expect("decode witness")
    };
    let dummy_witness = original_signed_witness
        .clone()
        .as_builder()
        .lock(Some(RawBytes::from(vec![0u8; SIGNATURE_SIZE])).pack())
        .build();
    hasher.update(&(dummy_witness.as_bytes().len() as u64).to_le_bytes());
    hasher.update(&dummy_witness.as_bytes());
    // secp256k1_blake160_sighash_all starts GroupInput witness iteration at
    // offset 1. This transaction has one secp input, but there is a later
    // input witness (the pet operation) that must be appended explicitly.
    for index in (position + 1)..witnesses.len() {
        let witness = witnesses.get(index).unwrap();
        hasher.update(&(witness.raw_data().len() as u64).to_le_bytes());
        hasher.update(&witness.raw_data());
    }
    hasher.finalize(&mut message);
    let sig = key
        .sign_recoverable(&H256::from(message))
        .expect("sign secp witness");
    let signed = original_signed_witness
        .as_builder()
        .lock(Some(RawBytes::from(sig.serialize().to_vec())).pack())
        .build();
    let mut signed_witnesses: Vec<MoleculeBytes> = Vec::with_capacity(witnesses.len());
    for index in 0..witnesses.len() {
        if index == position {
            signed_witnesses.push(signed.as_bytes().pack());
        } else {
            signed_witnesses.push(witnesses.get(index).unwrap());
        }
    }
    tx.as_advanced_builder()
        .set_witnesses(signed_witnesses)
        .build()
}

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

#[test]
fn adopt_with_verified_clock_ok() {
    let mut world = World::new();
    let funding = world.fund(world.owner_lock.clone(), ckb(100_000));
    let now = 1_000_000u64;
    let clock_hash = clock(&mut world, now);
    let mut data = adoption_data(now);
    data.genes = genes_for(&funding, 0);
    let (pet, pet_data) = world.pet_output(&world.pet_lock_owner, &data, ckb(20));
    let pet_cap = u64::from(pet.capacity());
    let change = change_cell(&world.owner_lock, ckb(100_000) - pet_cap as u128);
    let tx = build_tx(
        &mut world,
        &[funding],
        &[(pet, pet_data), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_ADOPT, &clock_hash)],
    );
    expect_ok(&world, &tx, "adopt_with_verified_clock_ok");
}

#[test]
fn adopt_without_clock_witness_fails() {
    let mut world = World::new();
    let funding = world.fund(world.owner_lock.clone(), ckb(100_000));
    let now = 1_000_000u64;
    let mut data = adoption_data(now);
    data.genes = genes_for(&funding, 0);
    let (pet, pet_data) = world.pet_output(&world.pet_lock_owner, &data, ckb(20));
    let pet_cap = u64::from(pet.capacity());
    let change = change_cell(&world.owner_lock, ckb(100_000) - pet_cap as u128);
    let tx = build_tx(
        &mut world,
        &[funding],
        &[(pet, pet_data), change],
        vec![],
        vec![],
    );
    expect_fail(&world, &tx, "adopt_without_clock_witness_fails");
}

#[test]
fn adopt_future_timestamp_fails() {
    let mut world = World::new();
    let funding = world.fund(world.owner_lock.clone(), ckb(100_000));
    let clock_hash = clock(&mut world, 1_000_000);
    let mut data = adoption_data(2_000_000);
    data.genes = genes_for(&funding, 0);
    let (pet, pet_data) = world.pet_output(&world.pet_lock_owner, &data, ckb(20));
    let pet_cap = u64::from(pet.capacity());
    let change = change_cell(&world.owner_lock, ckb(100_000) - pet_cap as u128);
    let tx = build_tx(
        &mut world,
        &[funding],
        &[(pet, pet_data), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_ADOPT, &clock_hash)],
    );
    expect_fail(&world, &tx, "adopt_future_timestamp_fails");
}

#[test]
fn adopt_without_clock_header_dep_fails() {
    let mut world = World::new();
    let funding = world.fund(world.owner_lock.clone(), ckb(100_000));
    let clock_hash = clock(&mut world, 1_000_000);
    let mut data = adoption_data(1_000_000);
    data.genes = genes_for(&funding, 0);
    let (pet, pet_data) = world.pet_output(&world.pet_lock_owner, &data, ckb(20));
    let pet_cap = u64::from(pet.capacity());
    let change = change_cell(&world.owner_lock, ckb(100_000) - pet_cap as u128);
    let tx = build_tx(
        &mut world,
        &[funding],
        &[(pet, pet_data), change],
        vec![],
        vec![pet_witness(OP_ADOPT, &clock_hash)],
    );
    expect_fail(&world, &tx, "adopt_without_clock_header_dep_fails");
}

#[test]
fn adopt_insufficient_food_fails() {
    let mut world = World::new();
    let funding = world.fund(world.owner_lock.clone(), ckb(100_000));
    let now = 1_000_000u64;
    let clock_hash = clock(&mut world, now);
    let mut data = adoption_data(now);
    data.genes = genes_for(&funding, 0);
    let (pet, pet_data) = world.pet_output(&world.pet_lock_owner, &data, ckb(20) - 1);
    let pet_cap = u64::from(pet.capacity());
    let change = change_cell(&world.owner_lock, ckb(100_000) - pet_cap as u128);
    let tx = build_tx(
        &mut world,
        &[funding],
        &[(pet, pet_data), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_ADOPT, &clock_hash)],
    );
    expect_fail(&world, &tx, "adopt_insufficient_food_fails");
}

#[test]
fn adopt_bad_genes_fails() {
    let mut world = World::new();
    let funding = world.fund(world.owner_lock.clone(), ckb(100_000));
    let now = 1_000_000u64;
    let clock_hash = clock(&mut world, now);
    let mut data = adoption_data(now);
    data.genes = [7u8; 32];
    let (pet, pet_data) = world.pet_output(&world.pet_lock_owner, &data, ckb(20));
    let pet_cap = u64::from(pet.capacity());
    let change = change_cell(&world.owner_lock, ckb(100_000) - pet_cap as u128);
    let tx = build_tx(
        &mut world,
        &[funding],
        &[(pet, pet_data), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_ADOPT, &clock_hash)],
    );
    expect_fail(&world, &tx, "adopt_bad_genes_fails");
}

// ---------------------------------------------------------------------------
// Poke
// ---------------------------------------------------------------------------

#[test]
fn poke_burns_exact_amount_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let now = t0 + 2 * DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(10));
    let tx = build_tx(
        &mut world,
        &[pet],
        &[(out, bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_POKE, &clock_hash)],
    );
    expect_ok(&world, &tx, "poke_burns_exact_amount_ok");
}

#[test]
fn poke_too_soon_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let now = t0 + 30 * 60 * 1000;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(19));
    let tx = build_tx(
        &mut world,
        &[pet],
        &[(out, bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_POKE, &clock_hash)],
    );
    expect_fail(&world, &tx, "poke_too_soon_fails");
}

#[test]
fn poke_wrong_burn_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let now = t0 + 2 * DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(11));
    let tx = build_tx(
        &mut world,
        &[pet],
        &[(out, bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_POKE, &clock_hash)],
    );
    expect_fail(&world, &tx, "poke_wrong_burn_fails");
}

#[test]
fn poke_cannot_recover_burn_from_owner_change() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(15));
    // Inputs = pet body + 20 + funding 1000. Outputs = pet body + 15 +
    // change 1005, so the transaction fee is zero and the burn is recovered
    // by the owner's change. The old poke branch accepted this shape.
    let change = change_cell(&world.owner_lock, ckb(1_005));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_POKE, &clock_hash), empty_witness()],
    );
    expect_fail(&world, &tx, "poke_cannot_recover_burn_from_owner_change");
}

#[test]
fn poke_death_cannot_recover_surplus_from_owner_change() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + 5 * DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = dead_data(now);
    let (out, bytes) = world.dead_output(&data);
    // The body is 272 CKB. Inputs = body + 20 + 1000; outputs = body + 1020,
    // leaving the pet's 20 CKB surplus unburned in the owner's change.
    let change = change_cell(&world.owner_lock, ckb(1_020));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_POKE, &clock_hash), empty_witness()],
    );
    expect_fail(
        &world,
        &tx,
        "poke_death_cannot_recover_surplus_from_owner_change",
    );
}

#[test]
fn poke_to_death_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(3));
    let now = t0 + 2 * DAY_MS;
    let clock_hash = clock(&mut world, now);
    let mut data = alive_data(now);
    data.state = STATE_DEAD;
    let (out, bytes) = world.dead_output(&data);
    let tx = build_tx(
        &mut world,
        &[pet],
        &[(out, bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_POKE, &clock_hash)],
    );
    expect_ok(&world, &tx, "poke_to_death_ok");
}

#[test]
fn poke_rejects_young_clock_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let young = clock(&mut world, t0 + 30 * 60 * 1000);
    let data = alive_data(t0 + 30 * 60 * 1000);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(19));
    let tx = build_tx(
        &mut world,
        &[pet],
        &[(out, bytes)],
        vec![young.clone()],
        vec![pet_witness(OP_POKE, &young)],
    );
    expect_fail(&world, &tx, "poke_rejects_young_clock_fails");
}

// ---------------------------------------------------------------------------
// Feed, transfer, immutable name
// ---------------------------------------------------------------------------

#[test]
fn feed_by_owner_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(25));
    let change = change_cell(&world.owner_lock, ckb(985));
    let tx = build_tx(
        &mut world,
        &[funding, pet],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![empty_witness(), pet_witness(OP_FEED, &clock_hash)],
    );
    expect_ok(&world, &tx, "feed_by_owner_ok");
}

#[test]
fn feed_by_stranger_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.stranger_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(25));
    let change = change_cell(&world.stranger_lock, ckb(985));
    let tx = build_tx(
        &mut world,
        &[funding, pet],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![empty_witness(), pet_witness(OP_FEED, &clock_hash)],
    );
    expect_ok(&world, &tx, "feed_by_stranger_ok");
}

#[test]
fn feed_can_rescue_a_pet_whose_debt_exceeds_surplus_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(3));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    // The pet owes 5 CKB but has only 3. Feed 10 CKB of new food; the owner
    // input pays the 5 CKB metabolic fee, leaving a healthy 15 CKB surplus.
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(10));
    let change = change_cell(&world.owner_lock, ckb(988));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_FEED, &clock_hash), empty_witness()],
    );
    expect_ok(
        &world,
        &tx,
        "feed_can_rescue_a_pet_whose_debt_exceeds_surplus_ok",
    );
}

#[test]
fn dust_feed_with_small_fee_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + 2 * DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    // Debt is 10 CKB. Total outputs (pet 272+21 + change 999) leave exactly
    // a 1 CKB fee; the old min_burn-only check accepted this.
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(21));
    let change = change_cell(&world.owner_lock, ckb(999));
    let tx = build_tx(
        &mut world,
        &[funding, pet],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![empty_witness(), pet_witness(OP_FEED, &clock_hash)],
    );
    expect_fail(&world, &tx, "dust_feed_with_small_fee_fails");
}

#[test]
fn low_frequency_freeze_with_same_clock_fails() {
    // Reusing the input's clock header must not reset last_touched. Otherwise
    // a caller could pay only MIN_BURN repeatedly and avoid real-time decay.
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let clock_hash = clock(&mut world, t0);

    let post_burn_surplus = ckb(20) - MIN_BURN;
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &alive_data(t0), post_burn_surplus);
    let change = change_cell(&world.owner_lock, ckb(1_000));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_FEED, &clock_hash), empty_witness()],
    );
    expect_fail(&world, &tx, "low_frequency_freeze_with_same_clock_fails");
}

#[test]
fn feed_with_one_millisecond_clock_advance_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + 1;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(20) - MIN_BURN);
    let change = change_cell(&world.owner_lock, ckb(1_000));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_FEED, &clock_hash), empty_witness()],
    );
    expect_ok(&world, &tx, "feed_with_one_millisecond_clock_advance_ok");
}

#[test]
fn transfer_with_same_clock_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let clock_hash = clock(&mut world, t0);
    let data = alive_data(t0);
    let (out, bytes) = world.pet_output(&world.pet_lock_stranger, &data, ckb(20) - MIN_BURN);
    let change = change_cell(&world.owner_lock, ckb(996));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_TRANSFER, &clock_hash), empty_witness()],
    );
    expect_fail(&world, &tx, "transfer_with_same_clock_fails");
}

#[test]
fn euthanize_with_same_clock_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let clock_hash = clock(&mut world, t0);
    let (pet_out, pet_bytes) = world.dead_output(&dead_data(t0));
    let penalty = ckb(20) * EUTHANASIA_PENALTY_BP / 10_000;
    let change = change_cell(&world.owner_lock, ckb(1_000) - MIN_BURN - penalty);
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(pet_out, pet_bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_EUTHANIZE, &clock_hash), empty_witness()],
    );
    expect_fail(&world, &tx, "euthanize_with_same_clock_fails");
}

#[test]
fn stranger_cannot_extract_food_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.stranger_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(10));
    let change = change_cell(&world.stranger_lock, ckb(1_005));
    let tx = build_tx(
        &mut world,
        &[funding, pet],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![empty_witness(), pet_witness(OP_FEED, &clock_hash)],
    );
    expect_fail(&world, &tx, "stranger_cannot_extract_food_fails");
}

#[test]
fn stranger_cannot_rename_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.stranger_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let mut data = alive_data(now);
    data.name = b"hacked".to_vec();
    let (out, bytes) = world.pet_output(&world.pet_lock_owner, &data, ckb(25));
    let change = change_cell(&world.stranger_lock, ckb(995));
    let tx = build_tx(
        &mut world,
        &[funding, pet],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![empty_witness(), pet_witness(OP_FEED, &clock_hash)],
    );
    expect_fail(&world, &tx, "stranger_cannot_rename_fails");
}

#[test]
fn transfer_by_owner_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_stranger, &data, ckb(20));
    let change = change_cell(&world.owner_lock, ckb(994));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_TRANSFER, &clock_hash)],
    );
    expect_ok(&world, &tx, "transfer_by_owner_ok");
}

#[test]
fn transfer_can_hand_over_a_pet_whose_debt_exceeds_surplus_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(3));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    // Output surplus is zero; the owner input pays the 5 CKB debt fee, so the
    // recipient gets the body and a zero-balance ALIVE pet, not a corpse.
    let (out, bytes) = world.pet_output(&world.pet_lock_stranger, &data, 0);
    let change = change_cell(&world.owner_lock, ckb(998));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_TRANSFER, &clock_hash), empty_witness()],
    );
    expect_ok(
        &world,
        &tx,
        "transfer_can_hand_over_a_pet_whose_debt_exceeds_surplus_ok",
    );
}

#[test]
fn transfer_without_owner_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.stranger_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data = alive_data(now);
    let (out, bytes) = world.pet_output(&world.pet_lock_stranger, &data, ckb(20));
    let change = change_cell(&world.stranger_lock, ckb(994));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_TRANSFER, &clock_hash)],
    );
    expect_fail(&world, &tx, "transfer_without_owner_fails");
}

// ---------------------------------------------------------------------------
// Euthanasia
// ---------------------------------------------------------------------------

#[test]
fn euthanize_burns_debt_and_post_debt_penalty_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let (pet_out, pet_bytes) = world.dead_output(&dead_data(now));
    let burn = BURN_PER_DAY;
    let penalty = ckb(15) * EUTHANASIA_PENALTY_BP / 10_000;
    // Inputs: 1000 + (body + 20). Outputs: body + change. The resulting fee
    // is exactly burn + penalty, so the change is funding minus that 8 CKB.
    let change = change_cell(&world.owner_lock, ckb(1_000) - burn - penalty);
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(pet_out, pet_bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_EUTHANIZE, &clock_hash), empty_witness()],
    );
    expect_ok(&world, &tx, "euthanize_burns_debt_and_post_debt_penalty_ok");
}

#[test]
fn euthanize_with_insufficient_penalty_burn_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let (pet_out, pet_bytes) = world.dead_output(&dead_data(now));
    let body = u64::from(pet_out.capacity()) as u128;
    let required_fee = BURN_PER_DAY + ckb(15) * EUTHANASIA_PENALTY_BP / 10_000;
    let change = change_cell(
        &world.owner_lock,
        ckb(1_000) + ckb(20) + body - body - required_fee + 1,
    );
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(pet_out, pet_bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_EUTHANIZE, &clock_hash), empty_witness()],
    );
    expect_fail(
        &world,
        &tx,
        "euthanize_with_insufficient_penalty_burn_fails",
    );
}

#[test]
fn euthanize_without_owner_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.stranger_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let (pet_out, pet_bytes) = world.dead_output(&dead_data(now));
    let fee = BURN_PER_DAY + ckb(15) * EUTHANASIA_PENALTY_BP / 10_000;
    let change = change_cell(&world.stranger_lock, ckb(1_000) + ckb(20) - fee);
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(pet_out, pet_bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_EUTHANIZE, &clock_hash), empty_witness()],
    );
    expect_fail(&world, &tx, "euthanize_without_owner_fails");
}

#[test]
fn euthanize_can_exit_a_pet_whose_debt_exceeds_surplus_ok() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(3));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let (pet_out, pet_bytes) = world.dead_output(&dead_data(now));
    // burn=5 CKB, post-debt surplus=0, so the penalty is zero. The owner pays
    // the burn out of the funding input and receives the remaining 995 CKB.
    let change = change_cell(&world.owner_lock, ckb(998));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(pet_out, pet_bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_EUTHANIZE, &clock_hash), empty_witness()],
    );
    expect_ok(
        &world,
        &tx,
        "euthanize_can_exit_a_pet_whose_debt_exceeds_surplus_ok",
    );
}

// ---------------------------------------------------------------------------
// Multi-pet and loot
// ---------------------------------------------------------------------------

#[test]
fn two_pets_cannot_share_one_fee_fails() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet_a = world.create_pet(t0, ckb(20));
    let pet_b = world.create_pet(t0, ckb(20));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let data_a = alive_data(now);
    let data_b = alive_data(now);
    let (out_a, bytes_a) = world.pet_output(&world.pet_lock_owner, &data_a, ckb(15));
    let (out_b, bytes_b) = world.pet_output(&world.pet_lock_owner, &data_b, ckb(15));
    let tx = build_tx(
        &mut world,
        &[pet_a, pet_b],
        &[(out_a, bytes_a), (out_b, bytes_b)],
        vec![clock_hash.clone()],
        vec![
            pet_witness(OP_FEED, &clock_hash),
            pet_witness(OP_FEED, &clock_hash),
        ],
    );
    expect_fail(&world, &tx, "two_pets_cannot_share_one_fee_fails");
}

#[test]
fn two_pets_same_elf_via_type_and_data2_fail() {
    // CKB groups scripts by their complete script hash. Referencing the same
    // pet-type ELF through Type and Data2 creates two groups (with different
    // code_hash values), so a per-group
    // "at most one pet" check is insufficient: both groups can account for
    // the same transaction fee. This must fail.
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet_type_args = world.pet_type_script.args().raw_data();
    let shadow_type = world.data2_type(pet_type_args.clone());
    let normal_hash_type = world.pet_type_script.hash_type().as_slice()[0];
    let shadow_hash_type = shadow_type.hash_type().as_slice()[0];
    assert_eq!(normal_hash_type, ScriptHashType::Type as u8);
    assert_eq!(shadow_hash_type, ScriptHashType::Data2 as u8);
    assert_ne!(shadow_type.code_hash(), world.pet_type_script.code_hash());
    assert_ne!(
        shadow_type.calc_script_hash(),
        world.pet_type_script.calc_script_hash()
    );
    // Type.code_hash is the TYPE_ID wrapper script hash while Data2.code_hash
    // is the ELF data hash. The contract must resolve the former through its
    // CellDep and compare the resulting ELF hashes across both script groups.

    let shadow_type_hash = shadow_type.calc_script_hash();
    let shadow_lock = world
        .context
        .build_script_with_hash_type(
            &world.pet_lock_op,
            ScriptHashType::Data2,
            RawBytes::from(
                [
                    shadow_type_hash.raw_data().as_ref(),
                    world.owner_hash.raw_data().as_ref(),
                ]
                .concat(),
            ),
        )
        .unwrap();
    let normal_lock = world.pet_lock_owner.clone();
    let (normal_cell, normal_data) = world.pet_output_with_type(
        &world.pet_type_script,
        &normal_lock,
        &alive_data(t0),
        ckb(20),
    );
    let normal = world
        .context
        .create_cell(normal_cell, RawBytes::from(normal_data.raw_data().to_vec()));
    let (shadow_cell, shadow_data) =
        world.pet_output_with_type(&shadow_type, &shadow_lock, &alive_data(t0), ckb(20));
    let shadow = world
        .context
        .create_cell(shadow_cell, RawBytes::from(shadow_data.raw_data().to_vec()));

    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let funding = world.fund(world.owner_lock.clone(), ckb(5));
    let (normal_out, normal_bytes) = world.pet_output_with_type(
        &world.pet_type_script,
        &normal_lock,
        &alive_data(now),
        ckb(15),
    );
    let (shadow_out, shadow_bytes) =
        world.pet_output_with_type(&shadow_type, &shadow_lock, &alive_data(now), ckb(15));
    // Total fee is exactly 5 CKB. Each script group sees the full fee and
    // would independently accept it as its own day's burn.
    let tx = build_tx(
        &mut world,
        &[normal, shadow, funding],
        &[(normal_out, normal_bytes), (shadow_out, shadow_bytes)],
        vec![clock_hash.clone()],
        vec![
            pet_witness(OP_FEED, &clock_hash),
            pet_witness(OP_FEED, &clock_hash),
            empty_witness(),
        ],
    );
    expect_fail(&world, &tx, "two_pets_same_elf_via_type_and_data2_fail");
}

#[test]
fn shadow_pet_type_on_input_only_is_rejected() {
    // No normal pet exists on the output side. The Type group must still
    // detect the Data2 group by resolving both wrappers to the same ELF.
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet_type_args = world.pet_type_script.args().raw_data();
    let shadow_type = world.data2_type(pet_type_args);
    let shadow_type_hash = shadow_type.calc_script_hash();
    let shadow_lock = world
        .context
        .build_script_with_hash_type(
            &world.pet_lock_op,
            ScriptHashType::Data2,
            RawBytes::from(
                [
                    shadow_type_hash.raw_data().as_ref(),
                    world.owner_hash.raw_data().as_ref(),
                ]
                .concat(),
            ),
        )
        .unwrap();
    let (shadow_cell, shadow_data) =
        world.pet_output_with_type(&shadow_type, &shadow_lock, &alive_data(t0), ckb(20));
    let shadow = world
        .context
        .create_cell(shadow_cell, RawBytes::from(shadow_data.raw_data().to_vec()));

    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let funding = world.fund(world.owner_lock.clone(), ckb(5));
    let (normal_out, normal_bytes) =
        world.pet_output(&world.pet_lock_owner, &alive_data(now), ckb(15));
    let tx = build_tx(
        &mut world,
        &[shadow, funding],
        &[(normal_out, normal_bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_FEED, &clock_hash), empty_witness()],
    );
    expect_fail(&world, &tx, "shadow_pet_type_on_input_only_is_rejected");
}

#[test]
fn shadow_pet_type_on_output_only_is_rejected() {
    // There is no shadow pet input, so the input scan cannot be what rejects
    // this transaction. The output scan must independently catch the Data2
    // group sharing the same ELF.
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet_type_args = world.pet_type_script.args().raw_data();
    let shadow_type = world.data2_type(pet_type_args);
    let shadow_type_hash = shadow_type.calc_script_hash();
    let shadow_lock = world
        .context
        .build_script_with_hash_type(
            &world.pet_lock_op,
            ScriptHashType::Data2,
            RawBytes::from(
                [
                    shadow_type_hash.raw_data().as_ref(),
                    world.owner_hash.raw_data().as_ref(),
                ]
                .concat(),
            ),
        )
        .unwrap();
    let normal = world.create_pet(t0, ckb(20));

    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let funding = world.fund(world.owner_lock.clone(), ckb(5));
    let (normal_out, normal_bytes) =
        world.pet_output(&world.pet_lock_owner, &alive_data(now), ckb(15));
    let (shadow_out, shadow_bytes) =
        world.pet_output_with_type(&shadow_type, &shadow_lock, &alive_data(now), ckb(15));
    let tx = build_tx(
        &mut world,
        &[normal, funding],
        &[(normal_out, normal_bytes), (shadow_out, shadow_bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_FEED, &clock_hash), empty_witness()],
    );
    expect_fail(&world, &tx, "shadow_pet_type_on_output_only_is_rejected");
}

#[test]
fn loot_dead_pet_ok() {
    let mut world = World::new();
    let dead = world.create_dead_pet(1_000_000);
    let occupied = occupied_capacity(64, Some(32), alive_data(1_000_000).encode().len());
    let loot = change_cell(&world.stranger_lock, occupied - ckb(1));
    let tx = build_tx(&mut world, &[dead], &[loot], vec![], vec![]);
    expect_ok(&world, &tx, "loot_dead_pet_ok");
}

#[test]
fn loot_alive_pet_fails() {
    let mut world = World::new();
    let pet = world.create_pet(1_000_000, ckb(20));
    let occupied = occupied_capacity(64, Some(32), alive_data(1_000_000).encode().len());
    let loot = change_cell(&world.stranger_lock, occupied + ckb(19));
    let tx = build_tx(&mut world, &[pet], &[loot], vec![], vec![]);
    expect_fail(&world, &tx, "loot_alive_pet_fails");
}

fn code_hash_lock_args(world: &World, code_hash: Byte32, owner: &Byte32) -> Script {
    let mut args = code_hash.raw_data().to_vec();
    args.extend_from_slice(owner.raw_data().as_ref());
    let mut context = world.context.clone();
    context
        .build_script_with_hash_type(
            &world.pet_lock_op,
            ScriptHashType::Data1,
            RawBytes::from(args),
        )
        .unwrap()
}

#[test]
fn pet_lock_rejects_code_hash_only_binding() {
    let mut world = World::new();
    let pet = world.create_pet(1_000_000, ckb(20));
    let wrong_code_hash = CellOutput::calc_data_hash(&elf_bytes("pet-type"));
    let wrong_lock = code_hash_lock_args(&world, wrong_code_hash, &world.owner_hash);
    let data = alive_data(1_000_000);
    let (out, bytes) = world.pet_output(&wrong_lock, &data, ckb(20));
    let change = change_cell(&world.owner_lock, ckb(20) - ckb(1));
    let tx = build_tx(&mut world, &[pet], &[(out, bytes), change], vec![], vec![]);
    expect_fail(&world, &tx, "pet_lock_rejects_code_hash_only_binding");
}

#[test]
fn euthanize_cannot_recover_penalty_from_owner_change() {
    let mut world = World::new();
    let t0 = 1_000_000u64;
    let pet = world.create_pet(t0, ckb(20));
    let funding = world.fund(world.owner_lock.clone(), ckb(1_000));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let (pet_out, pet_bytes) = world.dead_output(&dead_data(now));
    let burn = BURN_PER_DAY;
    let penalty = ckb(15) * EUTHANASIA_PENALTY_BP / 10_000;
    // One shannon short of the required fee. An honest exit must burn
    // burn + penalty; an owner change output cannot make the exit cheaper.
    let change = change_cell(&world.owner_lock, ckb(1_000) + ckb(20) - burn - penalty + 1);
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(pet_out, pet_bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_EUTHANIZE, &clock_hash), empty_witness()],
    );
    expect_fail(
        &world,
        &tx,
        "euthanize_cannot_recover_penalty_from_owner_change",
    );
}

#[test]
fn real_secp256k1_owner_signature_unlocks_ok() {
    let mut world = World::new();
    let key = Generator::random_privkey();
    let pubkey_hash = blake160(&key.pubkey().expect("pubkey").serialize());
    let secp_lock = world
        .context
        .build_script_with_hash_type(
            &world.secp_lock_op,
            ScriptHashType::Data,
            RawBytes::from(pubkey_hash.to_vec()),
        )
        .unwrap();
    let secp_lock_hash = secp_lock.calc_script_hash();
    let mut pet_lock_args = world.pet_type_script.calc_script_hash().raw_data().to_vec();
    pet_lock_args.extend_from_slice(secp_lock_hash.raw_data().as_ref());
    let pet_lock = world
        .context
        .build_script_with_hash_type(
            &world.pet_lock_op,
            ScriptHashType::Type,
            RawBytes::from(pet_lock_args),
        )
        .unwrap();

    let now = 1_000_000u64;
    let data = alive_data(now);
    let (input_cell, input_data) = world.pet_output(&pet_lock, &data, ckb(20));
    let pet = world
        .context
        .create_cell(input_cell, RawBytes::from(input_data.raw_data().to_vec()));
    let funding = world.fund(secp_lock.clone(), ckb(1_000));
    let clock_hash = clock(&mut world, now + DAY_MS);
    let fed_data = alive_data(now + DAY_MS);
    let (out, bytes) = world.pet_output(&pet_lock, &fed_data, ckb(25));
    let change = change_cell(&secp_lock, ckb(985));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_FEED, &clock_hash), empty_witness()],
    );
    let tx = sign_secp_tx(&tx, &key, 1);
    expect_ok(&world, &tx, "real_secp256k1_owner_signature_unlocks_ok");
}

#[test]
fn real_secp256k1_bad_signature_fails() {
    let mut world = World::new();
    let owner_key = Generator::random_privkey();
    let wrong_key = Generator::random_privkey();
    let owner_hash = blake160(&owner_key.pubkey().expect("pubkey").serialize());
    let secp_lock = world
        .context
        .build_script_with_hash_type(
            &world.secp_lock_op,
            ScriptHashType::Data,
            RawBytes::from(owner_hash.to_vec()),
        )
        .unwrap();
    let owner_lock_hash = secp_lock.calc_script_hash();
    let mut pet_lock_args = world.pet_type_script.calc_script_hash().raw_data().to_vec();
    pet_lock_args.extend_from_slice(owner_lock_hash.raw_data().as_ref());
    let pet_lock = world
        .context
        .build_script_with_hash_type(
            &world.pet_lock_op,
            ScriptHashType::Type,
            RawBytes::from(pet_lock_args),
        )
        .unwrap();

    let now = 1_000_000u64;
    let (input_cell, input_data) = world.pet_output(&pet_lock, &alive_data(now), ckb(20));
    let pet = world
        .context
        .create_cell(input_cell, RawBytes::from(input_data.raw_data().to_vec()));
    let funding = world.fund(secp_lock.clone(), ckb(1_000));
    let clock_hash = clock(&mut world, now + DAY_MS);
    let fed_data = alive_data(now + DAY_MS);
    let (out, bytes) = world.pet_output(&pet_lock, &fed_data, ckb(25));
    let change = change_cell(&secp_lock, ckb(985));
    let tx = build_tx(
        &mut world,
        &[pet, funding],
        &[(out, bytes), change],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_FEED, &clock_hash), empty_witness()],
    );
    let tx = sign_secp_tx(&tx, &wrong_key, 1);
    expect_fail(&world, &tx, "real_secp256k1_bad_signature_fails");
}

#[test]
fn owner_cannot_be_satisfied_by_pet_lock_itself() {
    let mut world = World::new();
    // Craft a pet whose "owner" hash is its own pet-lock script hash. Before
    // the explicit self-input exclusion, owner_present() would see the pet
    // input itself and authorize euthanasia without an external co-sign.
    let self_lock_hash = ckb_hash::blake2b_256(world.pet_lock_owner.as_bytes());
    let mut args = world.pet_type_script.calc_script_hash().raw_data().to_vec();
    args.extend_from_slice(&self_lock_hash);
    let self_lock = world
        .context
        .build_script_with_hash_type(
            &world.pet_lock_op,
            ScriptHashType::Type,
            RawBytes::from(args),
        )
        .unwrap();
    let t0 = 1_000_000u64;
    let (cell, data) = world.pet_output(&self_lock, &alive_data(t0), ckb(20));
    let pet = world
        .context
        .create_cell(cell, RawBytes::from(data.raw_data().to_vec()));
    let now = t0 + DAY_MS;
    let clock_hash = clock(&mut world, now);
    let (pet_out, pet_bytes) = world.dead_output(&dead_data(now));
    // dead_output uses pet_lock_owner, so force the same self-lock here while
    // retaining body-only capacity.
    let mut pet_out = pet_out;
    pet_out = pet_out.as_builder().lock(self_lock).build();
    let tx = build_tx(
        &mut world,
        &[pet],
        &[(pet_out, pet_bytes)],
        vec![clock_hash.clone()],
        vec![pet_witness(OP_EUTHANIZE, &clock_hash)],
    );
    expect_fail(&world, &tx, "owner_cannot_be_satisfied_by_pet_lock_itself");
}
