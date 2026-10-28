//! A minimal always-success lock, used in tests as the owner lock and the
//! owner lock. On a real deployment owners would use JoyID/secp256k1 locks.
#![no_std]
#![no_main]

use ckb_std::high_level::load_script;
use ckb_std::{default_alloc, entry};

entry!(main);
default_alloc!();

fn main() -> i8 {
    match load_script() {
        Ok(_) => 0,
        Err(_) => -1,
    }
}
