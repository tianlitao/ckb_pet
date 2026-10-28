//! pet-lock: authentication for pet cells.
//!
//! args = [full_pet_type_script_hash: 32B][owner_lock_hash: 32B]
//!
//! Rules:
//! 1. Creation (no group inputs) is always allowed; the type script validates
//!    adoption rules.
//! 2. Owner-consent: if ANY input cell in the transaction is locked by
//!    `owner_lock_hash`, the owner's own lock script has verified their
//!    signature — allow anything (the type script still enforces game rules).
//!    This "co-sign" composition works with any owner lock (secp256k1,
//!    JoyID, omnilock, ...).
//! 3. Unsigned path (pokes / free feeds / looting): only allowed when
//!    a) the pet cell's type script is our pet-type (args[0..32]),
//!    b) either the cell is fully consumed (loot; the type script requires
//!    state DEAD), or it converts into a pet cell of the same group,
//!    c) strangers never net-gain: sum of non-pet output capacities is at
//!    most the sum of non-pet input capacities.
#![no_std]
#![no_main]

use alloc::vec::Vec;

use ckb_hash::blake2b_256;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::packed::*;
use ckb_std::ckb_types::prelude::*;
use ckb_std::high_level::{load_cell, load_cell_capacity, load_cell_type, load_script};
use ckb_std::{default_alloc, entry};

entry!(main);
default_alloc!();

const ERR_SYSCALL: i8 = -1;
const ERR_ARGS: i8 = 1;
const ERR_TYPE: i8 = 2;
const ERR_BALANCE: i8 = 3;

fn count_cells(source: Source) -> Result<usize, i8> {
    let mut i = 0usize;
    loop {
        match load_cell(i, source) {
            Ok(_) => i += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(i),
            Err(_) => return Err(ERR_SYSCALL),
        }
    }
}

fn is_pet_typed(index: usize, source: Source, pet_type_hash: &[u8]) -> Result<bool, i8> {
    let ty = load_cell_type(index, source).map_err(|_| ERR_SYSCALL)?;
    Ok(match ty {
        Some(script) => blake2b_256(script.as_bytes()).as_slice() == pet_type_hash,
        None => false,
    })
}

fn run() -> Result<(), i8> {
    let script = load_script().map_err(|_| ERR_SYSCALL)?;
    let args = script.args().raw_data();
    if args.len() != 64 {
        return Err(ERR_ARGS);
    }
    let pet_type_hash = &args.as_ref()[0..32];
    let owner_lock_hash = &args.as_ref()[32..64];

    // Group inputs (cells being spent with this exact lock).
    let mut group_inputs: Vec<CellOutput> = Vec::new();
    let mut gi = 0usize;
    loop {
        match load_cell(gi, Source::GroupInput) {
            Ok(cell) => {
                group_inputs.push(cell);
                gi += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERR_SYSCALL),
        }
    }
    if group_inputs.is_empty() {
        // Creation: nothing to authenticate.
        return Ok(());
    }

    // The spent cells must actually be pet cells of our type.
    for cell in &group_inputs {
        let ty = match cell.type_().to_opt() {
            Some(t) => t,
            None => return Err(ERR_TYPE),
        };
        if blake2b_256(ty.as_bytes()).as_slice() != pet_type_hash {
            return Err(ERR_TYPE);
        }
    }

    // Owner present? Their own lock script verifies their signature.
    let n_inputs = count_cells(Source::Input)?;
    for i in 0..n_inputs {
        let lock = load_cell(i, Source::Input).map_err(|_| ERR_SYSCALL)?.lock();
        if blake2b_256(lock.as_bytes()).as_slice() == owner_lock_hash {
            return Ok(());
        }
    }

    // Unsigned path. Consumption (loot) is left to the type script's DEAD
    // check; otherwise only pet->pet conversions with no stranger profit.
    let mut group_outputs_empty = true;
    let mut go = 0usize;
    loop {
        match load_cell(go, Source::GroupOutput) {
            Ok(cell) => {
                group_outputs_empty = false;
                let ty = match cell.type_().to_opt() {
                    Some(t) => t,
                    None => return Err(ERR_TYPE),
                };
                if blake2b_256(ty.as_bytes()).as_slice() != pet_type_hash {
                    return Err(ERR_TYPE);
                }
                go += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERR_SYSCALL),
        }
    }
    if group_outputs_empty {
        return Ok(());
    }

    // Strangers must not net-gain: sum(non-pet outputs) <= sum(non-pet inputs).
    let n_outputs = count_cells(Source::Output)?;
    let mut sum_in_non_pet: u128 = 0;
    for i in 0..n_inputs {
        if !is_pet_typed(i, Source::Input, pet_type_hash)? {
            let cap = load_cell_capacity(i, Source::Input).map_err(|_| ERR_SYSCALL)?;
            sum_in_non_pet += cap as u128;
        }
    }
    let mut sum_out_non_pet: u128 = 0;
    for i in 0..n_outputs {
        if !is_pet_typed(i, Source::Output, pet_type_hash)? {
            let cap = load_cell_capacity(i, Source::Output).map_err(|_| ERR_SYSCALL)?;
            sum_out_non_pet += cap as u128;
        }
    }
    if sum_out_non_pet > sum_in_non_pet {
        return Err(ERR_BALANCE);
    }
    Ok(())
}

fn main() -> i8 {
    match run() {
        Ok(()) => 0,
        Err(code) => code,
    }
}
