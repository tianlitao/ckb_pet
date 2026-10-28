//! PetCell game state machine.
//!
//! `args = BLOCK[pet_lock_code_hash: 32B]`
//!
//! The v2 rules settle metabolic debt on every state transition:
//!
//! * adopt: `last_touched = clock.timestamp`, verified against a header dep;
//! * feed: debt leaves as transaction fee, no extraction without the owner;
//! * poke: exact burn, or a body-only DEAD cell when burn >= surplus;
//! * transfer: debt leaves as fee, owner must co-sign;
//! * euthanasia: debt and a 20% post-debt penalty leave as fee (burned);
//! * loot: only a DEAD input can disappear without a pet output.
//!
//! One pet input/output per transaction is deliberate. A shared transaction fee
//! must never settle debts for multiple pets, and an output-based penalty
//! check must not let many deaths share one payment.
#![no_std]
#![no_main]

use alloc::vec::Vec;

use ckb_hash::blake2b_256;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::packed::*;
use ckb_std::ckb_types::prelude::*;
use ckb_std::debug;
use ckb_std::high_level::{
    load_cell, load_cell_capacity, load_cell_data, load_cell_data_hash, load_cell_type,
    load_header, load_input_out_point, load_script, load_script_hash, load_witness_args,
};
use ckb_std::{default_alloc, entry};
use pet_common::{
    decode_witness, PetData, ADOPT_MIN_SURPLUS, DATA_VERSION, EUTHANASIA_PENALTY_BP, MAX_NAME_LEN,
    MIN_POKE_INTERVAL_MS, OP_ADOPT, OP_EUTHANIZE, OP_FEED, OP_POKE, OP_TRANSFER, STATE_ALIVE,
    STATE_DEAD,
};

entry!(main);
default_alloc!();

const ERR_SYSCALL: i8 = -1;
const ERR_ARGS: i8 = 1;
const ERR_ENCODING: i8 = 2;
const ERR_WITNESS: i8 = 3;
const ERR_CLOCK: i8 = 4;
const ERR_OP: i8 = 5;
const ERR_ADOPT: i8 = 6;
const ERR_STATE: i8 = 7;
const ERR_ECONOMY: i8 = 8;
const ERR_OWNER: i8 = 9;
const ERR_DEATH: i8 = 10;
const ERR_SCRIPT_GROUP: i8 = 11;
const ERR_MATCH: i8 = 12;

const SHANNONS_PER_BYTE: u64 = 100_000_000;

struct PetCell {
    index: usize,
    output: CellOutput,
    data: PetData,
    capacity: u64,
    occupied: u64,
}

fn count_cells(source: Source) -> Result<usize, i8> {
    let mut count = 0usize;
    loop {
        match load_cell(count, source) {
            Ok(_) => count += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(count),
            Err(_) => return Err(ERR_SYSCALL),
        }
    }
}

fn is_self_type(index: usize, source: Source, self_type_hash: &[u8; 32]) -> Result<bool, i8> {
    match load_cell_type(index, source).map_err(|_| ERR_SYSCALL)? {
        Some(script) => Ok(&blake2b_256(script.as_bytes()) == self_type_hash),
        None => Ok(false),
    }
}

fn resolve_data_hash(script: &Script) -> Result<[u8; 32], i8> {
    let hash_type = u8::from(script.hash_type());
    if hash_type == 0 || hash_type == 2 || hash_type == 4 {
        let mut hash = [0u8; 32];
        hash.copy_from_slice(script.code_hash().raw_data().as_ref());
        return Ok(hash);
    }
    if hash_type == 1 {
        for index in 0..count_cells(Source::CellDep)? {
            let Some(ty) = load_cell_type(index, Source::CellDep).map_err(|_| ERR_SYSCALL)? else {
                continue;
            };
            if blake2b_256(ty.as_bytes()).as_slice() == script.code_hash().raw_data().as_ref() {
                return load_cell_data_hash(index, Source::CellDep).map_err(|_| ERR_SYSCALL);
            }
        }
    }
    Err(ERR_ARGS)
}

fn script_is_other(script: &Script, self_type_hash: &[u8; 32]) -> bool {
    &blake2b_256(script.as_bytes()) != self_type_hash
}

fn reject_alternate_pet_scripts(
    source: Source,
    self_type_hash: &[u8; 32],
    self_data_hash: &[u8; 32],
) -> Result<(), i8> {
    for index in 0..count_cells(source)? {
        let Some(ty) = load_cell_type(index, source).map_err(|_| ERR_SYSCALL)? else {
            continue;
        };
        if script_is_other(&ty, self_type_hash) && resolve_data_hash(&ty)? == *self_data_hash {
            return Err(ERR_SCRIPT_GROUP);
        }
    }
    Ok(())
}

fn load_pet(index: usize, source: Source) -> Result<PetCell, i8> {
    let output = load_cell(index, source).map_err(|_| ERR_SYSCALL)?;
    let raw = load_cell_data(index, source).map_err(|_| ERR_SYSCALL)?;
    let data = PetData::decode(&raw).ok_or(ERR_ENCODING)?;
    let capacity = load_cell_capacity(index, source).map_err(|_| ERR_SYSCALL)?;
    let lock_args_len = output.lock().args().raw_data().len();
    let type_args_len = output
        .type_()
        .to_opt()
        .map(|script| script.args().raw_data().len())
        .unwrap_or(0);
    let occupied =
        (8 + raw.len() + 33 + lock_args_len + 33 + type_args_len) as u64 * SHANNONS_PER_BYTE;
    Ok(PetCell {
        index,
        output,
        data,
        capacity,
        occupied,
    })
}

fn load_pets(source: Source, self_type_hash: &[u8; 32]) -> Result<Vec<PetCell>, i8> {
    let mut pets = Vec::new();
    for index in 0..count_cells(source)? {
        if is_self_type(index, source, self_type_hash)? {
            pets.push(load_pet(index, source)?);
        }
    }
    Ok(pets)
}

fn surplus(cell: &PetCell) -> i128 {
    cell.capacity as i128 - cell.occupied as i128
}

fn tx_fee() -> Result<u128, i8> {
    let mut sum_in = 0u128;
    for index in 0..count_cells(Source::Input)? {
        sum_in += load_cell_capacity(index, Source::Input).map_err(|_| ERR_SYSCALL)? as u128;
    }
    let mut sum_out = 0u128;
    for index in 0..count_cells(Source::Output)? {
        sum_out += load_cell_capacity(index, Source::Output).map_err(|_| ERR_SYSCALL)? as u128;
    }
    sum_in.checked_sub(sum_out).ok_or(ERR_ECONOMY)
}

/// The owner lock hash is the second 32-byte half of the pet-lock args.
fn owner_present(pet: &PetCell) -> Result<bool, i8> {
    let args = pet.output.lock().args().raw_data();
    if args.len() != 64 {
        return Err(ERR_ARGS);
    }
    let owner_hash = &args.as_ref()[32..64];
    for index in 0..count_cells(Source::Input)? {
        // The pet cell itself must never satisfy its own owner check. This
        // matters if an owner hash is deliberately or accidentally set to the
        // pet-lock script hash: co-signing must require a separate input.
        if index == pet.index {
            continue;
        }
        let lock = load_cell(index, Source::Input)
            .map_err(|_| ERR_SYSCALL)?
            .lock();
        if &blake2b_256(lock.as_bytes())[..] == owner_hash {
            return Ok(true);
        }
    }
    Ok(false)
}

fn require_owner(pet: &PetCell) -> Result<(), i8> {
    if owner_present(pet)? {
        Ok(())
    } else {
        Err(ERR_OWNER)
    }
}

fn header_timestamp(clock_hash: &[u8; 32]) -> Result<u64, i8> {
    let mut index = 0usize;
    loop {
        match load_header(index, Source::HeaderDep) {
            Ok(header) => {
                if &blake2b_256(header.as_bytes()) == clock_hash {
                    return Ok(header.raw().timestamp().unpack());
                }
                index += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Err(ERR_CLOCK),
            Err(_) => return Err(ERR_SYSCALL),
        }
    }
}

fn witness_op(input_index: usize) -> Result<(u8, [u8; 32]), i8> {
    let witness = match load_witness_args(input_index, Source::Input) {
        Ok(witness) => witness,
        Err(ckb_std::error::SysError::ItemMissing) => return Err(ERR_WITNESS),
        Err(_) => return Err(ERR_SYSCALL),
    };
    let input_type = witness.input_type().to_opt().ok_or(ERR_WITNESS)?.raw_data();
    decode_witness(input_type.as_ref()).ok_or(ERR_WITNESS)
}

fn check_identity_and_clock(input: &PetCell, output: &PetCell, now: u64, op: u8) -> Result<(), i8> {
    let a = &input.data;
    let b = &output.data;
    if a.version != b.version
        || a.genes != b.genes
        || a.birth_time != b.birth_time
        || a.generation != b.generation
        || a.breed_lock_until != b.breed_lock_until
        || a.name != b.name
        || b.version != DATA_VERSION
        || b.name.len() > MAX_NAME_LEN
        || b.last_touched != now
        // All mutating operations must advance the clock. Reusing the input
        // header would let a caller repeatedly pay MIN_BURN and reset
        // last_touched without real time passing.
        || now <= a.last_touched
    {
        return Err(ERR_STATE);
    }
    if op != OP_TRANSFER && input.output.lock().as_bytes() != output.output.lock().as_bytes() {
        return Err(ERR_OWNER);
    }
    Ok(())
}

fn check_pet_script_binding(
    pet: &PetCell,
    self_type_hash: &[u8; 32],
    pet_lock_code_hash: &[u8; 32],
    self_type: &Script,
) -> Result<(), i8> {
    let lock = pet.output.lock();
    if lock.code_hash().raw_data().as_ref() != pet_lock_code_hash
        || u8::from(lock.hash_type()) != u8::from(self_type.hash_type())
    {
        return Err(ERR_ARGS);
    }
    let lock_args = pet.output.lock().args().raw_data();
    if lock_args.len() != 64 || &lock_args.as_ref()[0..32] != self_type_hash {
        return Err(ERR_ARGS);
    }
    let ty = pet.output.type_().to_opt().ok_or(ERR_ARGS)?;
    if &blake2b_256(ty.as_bytes()) != self_type_hash {
        return Err(ERR_ARGS);
    }
    Ok(())
}

fn check_state_shape(output: &PetCell) -> Result<(), i8> {
    match output.data.state {
        STATE_ALIVE => {
            if surplus(output) < 0 {
                return Err(ERR_ECONOMY);
            }
            Ok(())
        }
        STATE_DEAD => {
            if output.capacity != output.occupied || surplus(output) != 0 {
                return Err(ERR_DEATH);
            }
            Ok(())
        }
        _ => Err(ERR_STATE),
    }
}

fn check_adoption(output: &PetCell, now: u64) -> Result<(), i8> {
    let pet = &output.data;
    if pet.version != DATA_VERSION
        || pet.state != STATE_ALIVE
        || pet.generation != 1
        || pet.breed_lock_until != 0
        || pet.birth_time != now
        || pet.last_touched != now
        || pet.name.len() > MAX_NAME_LEN
        || surplus(output) < ADOPT_MIN_SURPLUS as i128
    {
        return Err(ERR_ADOPT);
    }

    let funding = load_input_out_point(0, Source::Input).map_err(|_| ERR_ADOPT)?;
    let mut seed = Vec::with_capacity(40);
    seed.extend_from_slice(funding.tx_hash().raw_data().as_ref());
    let funding_index: u32 = funding.index().unpack();
    seed.extend_from_slice(&funding_index.to_le_bytes());
    seed.extend_from_slice(&(output.index as u32).to_le_bytes());
    if pet.genes != blake2b_256(&seed) {
        return Err(ERR_ADOPT);
    }
    Ok(())
}

fn update(input: &PetCell, output: &PetCell) -> Result<(), i8> {
    let (op, clock_hash) = witness_op(input.index)?;
    if !matches!(op, OP_FEED | OP_POKE | OP_TRANSFER | OP_EUTHANIZE) {
        return Err(ERR_OP);
    }
    let now = header_timestamp(&clock_hash)?;
    check_identity_and_clock(input, output, now, op)?;
    let elapsed = now.checked_sub(input.data.last_touched).ok_or(ERR_CLOCK)? as u128;
    let burn = PetData::compute_burn(elapsed);
    let s_in = surplus(input);
    let s_out = surplus(output);
    let fee = tx_fee()?;
    let post_debt = s_in.saturating_sub(burn as i128);

    match op {
        OP_FEED => {
            if input.data.state != STATE_ALIVE
                || output.data.state != STATE_ALIVE
                || s_out < post_debt
                || fee < burn
            {
                return Err(ERR_ECONOMY);
            }
        }
        OP_POKE => {
            if input.data.state != STATE_ALIVE || elapsed < MIN_POKE_INTERVAL_MS {
                return Err(ERR_ECONOMY);
            }
            if burn >= s_in.max(0) as u128 {
                // Once the pet is dead, all of its pre-death surplus must
                // leave as fee. Without this, an owner could add a funding
                // input, make change, and recover most of the surplus while
                // still producing a body-only DEAD cell.
                if output.data.state != STATE_DEAD || s_out != 0 || fee < s_in.max(0) as u128 {
                    return Err(ERR_DEATH);
                }
            } else if output.data.state != STATE_ALIVE
                || output.capacity as i128 != input.capacity as i128 - burn as i128
                || s_out != s_in - burn as i128
                || fee < burn
            {
                return Err(ERR_ECONOMY);
            }
        }
        OP_TRANSFER => {
            require_owner(input)?;
            if input.data.state != STATE_ALIVE
                || output.data.state != STATE_ALIVE
                || s_out < post_debt
                || fee < burn
            {
                return Err(ERR_ECONOMY);
            }
        }
        OP_EUTHANIZE => {
            require_owner(input)?;
            if input.data.state != STATE_ALIVE || output.data.state != STATE_DEAD || s_out != 0 {
                return Err(ERR_DEATH);
            }
            let penalty = post_debt.max(0) as u128 * EUTHANASIA_PENALTY_BP / 10_000;
            if fee < burn.checked_add(penalty).ok_or(ERR_ECONOMY)? {
                return Err(ERR_ECONOMY);
            }
        }
        _ => return Err(ERR_OP),
    }

    check_state_shape(output)
}

fn run() -> Result<(), i8> {
    let script = load_script().map_err(|_| ERR_SYSCALL)?;
    let args = script.args().raw_data();
    if args.len() != 32 {
        return Err(ERR_ARGS);
    }
    let mut pet_lock_code_hash = [0u8; 32];
    pet_lock_code_hash.copy_from_slice(args.as_ref());
    let self_type_hash = load_script_hash().map_err(|_| ERR_SYSCALL)?;
    let self_data_hash = resolve_data_hash(&script)?;
    // Script groups key on the complete script hash, not the ELF. Referencing
    // the same ELF via Type and Data2 creates two groups that both see the
    // whole transaction fee. Compare resolved ELF data hashes, not code_hash,
    // and reject every second group so one fee cannot settle multiple pets.
    reject_alternate_pet_scripts(Source::Input, &self_type_hash, &self_data_hash)?;
    reject_alternate_pet_scripts(Source::Output, &self_type_hash, &self_data_hash)?;
    let inputs = load_pets(Source::Input, &self_type_hash)?;
    let outputs = load_pets(Source::Output, &self_type_hash)?;

    // Multiple pets in one transaction share one fee and one penalty burn.
    // Rejecting that shape keeps debt accounting unambiguous.
    if inputs.len() > 1 || outputs.len() > 1 {
        return Err(ERR_MATCH);
    }

    for pet in inputs.iter().chain(outputs.iter()) {
        check_pet_script_binding(pet, &self_type_hash, &pet_lock_code_hash, &script)?;
    }

    match (inputs.as_slice(), outputs.as_slice()) {
        ([input], []) => {
            if input.data.state != STATE_DEAD {
                return Err(ERR_DEATH);
            }
            Ok(())
        }
        ([], [output]) => {
            let (op, clock_hash) = witness_op(0)?;
            if op != OP_ADOPT {
                return Err(ERR_OP);
            }
            let now = header_timestamp(&clock_hash)?;
            check_adoption(output, now)
        }
        ([input], [output]) => update(input, output),
        _ => Err(ERR_MATCH),
    }
}

fn main() -> i8 {
    match run() {
        Ok(()) => 0,
        Err(code) => {
            debug!("pet-type rejected transaction");
            code
        }
    }
}
