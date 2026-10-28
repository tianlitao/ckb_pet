//! Shared on-chain data layout for PetCell contracts, frontend and tests.
//!
//! Cell data uses the molecule `table` serialization:
//! `[total_size: u32 LE][offset[0..=N]: u32 LE (N+1 offsets)][field bytes...]`
//! Integers are little-endian (molecule Uint8/Uint16/Uint32/Uint64).
#![cfg_attr(not(test), no_std)]
extern crate alloc;

use alloc::vec::Vec;

pub const DATA_VERSION: u8 = 0;
pub const STATE_ALIVE: u8 = 0;
pub const STATE_DEAD: u8 = 1;

/// Witness `input_type` slot layout (raw bytes, NOT a molecule table):
/// `[op: u8][clock_header_hash: 32B]` -> 33 bytes total.
pub const OP_FEED: u8 = 0;
pub const OP_POKE: u8 = 1;
pub const OP_TRANSFER: u8 = 2;
pub const OP_EUTHANIZE: u8 = 3;
pub const OP_LOOT: u8 = 4;
pub const OP_ADOPT: u8 = 5;
pub const WITNESS_LEN: usize = 33;

pub const MAX_NAME_LEN: usize = 32;
pub const MS_PER_DAY: u128 = 86_400_000;

// ---------------------------------------------------------------------------
// On-chain economic parameters (hardcoded in pet-type at deploy time, see
// tech-spec §8.1; config-cell governance is a V1.1 upgrade path).
// ---------------------------------------------------------------------------

pub const BURN_PER_DAY: u128 = 500_000_000; // 5 CKB / day, in shannons
pub const MIN_BURN: u128 = 21_000_000; // 0.21 CKB = BURN_PER_DAY / 24 (anti-freeze)
pub const MIN_POKE_INTERVAL_MS: u128 = 3_600_000; // 1 hour
pub const ADOPT_MIN_SURPLUS: u128 = 2_000_000_000; // 20 CKB initial food
pub const EUTHANASIA_PENALTY_BP: u128 = 2_000; // 20% of post-debt surplus, burned

/// Molecule table serialization: [total: u32][offset: u32 × (N+1)][fields...].
/// The trailing offset is equal to the total size; fields start at 4 + 4(N+1).
pub fn encode_table(fields: &[&[u8]]) -> Vec<u8> {
    let n = fields.len();
    let header = 4 + 4 * (n + 1);
    let total = header + fields.iter().map(|f| f.len()).sum::<usize>();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&(total as u32).to_le_bytes());
    let mut acc = header;
    for f in fields {
        out.extend_from_slice(&(acc as u32).to_le_bytes());
        acc += f.len();
    }
    // Molecule tables store N+1 offsets; the last one is the total size.
    out.extend_from_slice(&(total as u32).to_le_bytes());
    for f in fields {
        out.extend_from_slice(f);
    }
    out
}

/// Reader over a molecule table; `field(i)` returns the raw bytes of field i.
/// The field count comes from the schema (molecule tables do not store it).
pub struct TableReader<'a> {
    data: &'a [u8],
    n: usize,
}

impl<'a> TableReader<'a> {
    pub fn new(data: &'a [u8], n: usize) -> Option<Self> {
        let header = 4 + 4 * (n + 1);
        if data.len() < header {
            return None;
        }
        let total = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        if total != data.len() {
            return None;
        }
        let offset = |i: usize| {
            u32::from_le_bytes([
                data[4 + 4 * i],
                data[5 + 4 * i],
                data[6 + 4 * i],
                data[7 + 4 * i],
            ]) as usize
        };
        if offset(0) != header {
            return None;
        }
        let mut previous = header;
        for i in 0..=n {
            let current = offset(i);
            if current < previous || current > total {
                return None;
            }
            previous = current;
        }
        let end_offset = offset(n);
        if end_offset != total {
            return None;
        }
        Some(TableReader { data, n })
    }

    pub fn num_fields(&self) -> usize {
        self.n
    }

    pub fn field(&self, i: usize) -> Option<&'a [u8]> {
        if i >= self.n {
            return None;
        }
        let start = u32::from_le_bytes([
            self.data[4 + 4 * i],
            self.data[5 + 4 * i],
            self.data[6 + 4 * i],
            self.data[7 + 4 * i],
        ]) as usize;
        let end = u32::from_le_bytes([
            self.data[4 + 4 * (i + 1)],
            self.data[5 + 4 * (i + 1)],
            self.data[6 + 4 * (i + 1)],
            self.data[7 + 4 * (i + 1)],
        ]) as usize;
        if end > self.data.len() || start > end {
            return None;
        }
        Some(&self.data[start..end])
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PetData {
    pub version: u8,
    pub state: u8,
    pub genes: [u8; 32],
    pub birth_time: u64,
    pub last_touched: u64,
    pub generation: u32,
    pub breed_lock_until: u64,
    pub name: Vec<u8>,
}

impl PetData {
    pub fn encode(&self) -> Vec<u8> {
        encode_table(&[
            &[self.version],
            &[self.state],
            &self.genes,
            &self.birth_time.to_le_bytes(),
            &self.last_touched.to_le_bytes(),
            &self.generation.to_le_bytes(),
            &self.breed_lock_until.to_le_bytes(),
            &self.name,
        ])
    }

    pub fn decode(data: &[u8]) -> Option<PetData> {
        let t = TableReader::new(data, 8)?;
        if t.num_fields() != 8 {
            return None;
        }
        let version = *t.field(0)?.first()?;
        let state = *t.field(1)?.first()?;
        let genes_raw = t.field(2)?;
        if genes_raw.len() != 32 {
            return None;
        }
        let mut genes = [0u8; 32];
        genes.copy_from_slice(genes_raw);
        let read_u64 = |i: usize| -> Option<u64> {
            let f = t.field(i)?;
            if f.len() != 8 {
                return None;
            }
            Some(u64::from_le_bytes([
                f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7],
            ]))
        };
        let read_u32 = |i: usize| -> Option<u32> {
            let f = t.field(i)?;
            if f.len() != 4 {
                return None;
            }
            Some(u32::from_le_bytes([f[0], f[1], f[2], f[3]]))
        };
        Some(PetData {
            version,
            state,
            genes,
            birth_time: read_u64(3)?,
            last_touched: read_u64(4)?,
            generation: read_u32(5)?,
            breed_lock_until: read_u64(6)?,
            name: t.field(7)?.to_vec(),
        })
    }

    /// Metabolic burn for an elapsed time span, in shannons.
    pub fn compute_burn(elapsed_ms: u128) -> u128 {
        let burn = BURN_PER_DAY * elapsed_ms / MS_PER_DAY;
        if burn < MIN_BURN {
            MIN_BURN
        } else {
            burn
        }
    }
}

/// CKB occupied capacity in shannons, matching ckb-gen-types' consensus
/// formula:
/// `8 (capacity field) + data.len() + (33 + lock_args.len())`
/// + `(33 + type_args.len())` bytes; script molecule table headers are not
///   counted. One byte of cell = 1 CKB = 10^8 shannons.
pub fn occupied_capacity(
    lock_args_len: usize,
    type_args_len: Option<usize>,
    data_len: usize,
) -> u128 {
    const SHANNONS_PER_BYTE: u128 = 100_000_000;
    let lock = 33 + lock_args_len;
    let type_size = type_args_len.map(|a| 33 + a).unwrap_or(0);
    (8 + lock + type_size + data_len) as u128 * SHANNONS_PER_BYTE
}

/// Witness bytes for a pet operation: `[op][clock_header_hash]`.
pub fn encode_witness(op: u8, clock_hash: [u8; 32]) -> Vec<u8> {
    let mut w = Vec::with_capacity(WITNESS_LEN);
    w.push(op);
    w.extend_from_slice(&clock_hash);
    w
}

pub fn decode_witness(data: &[u8]) -> Option<(u8, [u8; 32])> {
    if data.len() != WITNESS_LEN {
        return None;
    }
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&data[1..]);
    Some((data[0], hash))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pet_data_roundtrip() {
        let data = PetData {
            version: DATA_VERSION,
            state: STATE_ALIVE,
            genes: [7u8; 32],
            birth_time: 1_000,
            last_touched: 2_000,
            generation: 1,
            breed_lock_until: 0,
            name: b"mochi".to_vec(),
        };
        let enc = data.encode();
        let dec = PetData::decode(&enc).unwrap();
        assert_eq!(data, dec);
    }

    #[test]
    fn empty_name_roundtrip() {
        let data = PetData {
            version: DATA_VERSION,
            state: STATE_DEAD,
            genes: [0u8; 32],
            birth_time: 0,
            last_touched: 9_999,
            generation: 3,
            breed_lock_until: 0,
            name: Vec::new(),
        };
        let dec = PetData::decode(&data.encode()).unwrap();
        assert_eq!(data, dec);
        // Fixed part: header 40 + 1 + 1 + 32 + 8 + 8 + 4 + 8 = 102
        assert_eq!(data.encode().len(), 102);
    }

    #[test]
    fn bad_data_rejected() {
        assert!(PetData::decode(&[]).is_none());
        assert!(PetData::decode(&[0u8; 16]).is_none());
        let mut enc = PetData {
            version: 0,
            state: 0,
            genes: [0; 32],
            birth_time: 0,
            last_touched: 0,
            generation: 1,
            breed_lock_until: 0,
            name: Vec::new(),
        }
        .encode();
        enc[49] ^= 0xff; // corrupt a gene byte (genes start at header 44 + 1 + 1)
                         // Still decodes (content is arbitrary) but genes differ from origin.
        assert!(PetData::decode(&enc).is_some());
    }

    #[test]
    fn witness_roundtrip() {
        let w = encode_witness(OP_POKE, [9u8; 32]);
        assert_eq!(w.len(), WITNESS_LEN);
        let (op, hash) = decode_witness(&w).unwrap();
        assert_eq!(op, OP_POKE);
        assert_eq!(hash, [9u8; 32]);
    }

    #[test]
    fn occupied_capacity_matches_ckb_formula() {
        // lock args 64 (pet-lock), type args 32 (pet-type), data 102
        // = (8 + 97 + 65 + 102) bytes = 272 CKB
        assert_eq!(
            occupied_capacity(64, Some(32), 102),
            (8 + 97 + 65 + 102) as u128 * 100_000_000
        );
    }

    #[test]
    fn table_has_trailing_offset() {
        let enc = encode_table(&[&[1], &[2, 3]]);
        assert_eq!(enc.len(), 19);
        assert_eq!(u32::from_le_bytes(enc[0..4].try_into().unwrap()), 19);
        assert_eq!(u32::from_le_bytes(enc[4..8].try_into().unwrap()), 16);
        assert_eq!(u32::from_le_bytes(enc[8..12].try_into().unwrap()), 17);
        assert_eq!(u32::from_le_bytes(enc[12..16].try_into().unwrap()), 19);
        assert_eq!(&enc[16..19], &[1, 2, 3]);

        let t = TableReader::new(&enc, 2).unwrap();
        assert_eq!(t.field(0), Some(&[1u8][..]));
        assert_eq!(t.field(1), Some(&[2u8, 3][..]));

        let mut bad = enc.clone();
        bad[12..16].copy_from_slice(&18u32.to_le_bytes());
        assert!(TableReader::new(&bad, 2).is_none());
    }

    #[test]
    fn known_on_chain_109_byte_pet_decodes() {
        // This is the real testnet cell produced by the broken v1 encoder. It
        // has the canonical N+1 offset layout: lengths 40,41,42,74,82,90,94,
        // 102,109 for the eight fields.
        let raw = hex_literal(
            "6d00000028000000290000002a0000004a000000520000005a0000005e000000660000006d00000000001a7af01180911d0b62b1b8caa75e36a3e3ddb3f611aec7f677594bc8913ab220945eb175a1010000945eb175a1010000010000000000000000000000e58692e7839f41",
        );
        let pet = PetData::decode(&raw).expect("known fixture must decode");
        assert_eq!(pet.version, DATA_VERSION);
        assert_eq!(pet.state, STATE_ALIVE);
        assert_eq!(pet.generation, 1);
        assert_eq!(pet.name, "冒烟A".as_bytes());
        assert_eq!(pet.encode(), raw);
    }

    fn hex_literal(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| {
                let digit = |b: u8| match b {
                    b'0'..=b'9' => b - b'0',
                    b'a'..=b'f' => b - b'a' + 10,
                    _ => panic!("invalid hex"),
                };
                (digit(pair[0]) << 4) | digit(pair[1])
            })
            .collect()
    }
}
