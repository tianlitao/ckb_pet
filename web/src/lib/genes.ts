/**
 * Gene decoding — mirrors tech-spec §5. The 32-byte gene entropy is derived
 * on-chain at adoption (blake2b256 of the funding out point); everything here
 * is pure presentation-layer decoding.
 */
import { ccc } from "@ckb-ccc/ccc";
import { hex, unhex } from "./molecule";

export const SPECIES = ["喵喵", "汪汪", "兔兔", "蛙蛙", "咕咕", "章鱼"] as const;
export const PERSONALITIES = [
  "粘人", "高冷", "贪吃", "胆小", "社牛", "戏精", "哲学家", "戆憨",
] as const;

export interface Traits {
  species: number;
  speciesName: string;
  palette: number;
  eyes: number;
  mouth: number;
  pattern: number;
  personality: number;
  personalityName: string;
  aura: boolean;
  rarity: Rarity;
  /** leading zero bits of the whole gene hash */
  beauty: number;
}

export type Rarity = "普通" | "稀有" | "史诗" | "传说";

/** genes = blake2b256(funding_out_point.tx_hash ++ funding_index ++ output_index) */
export function genesFor(
  fundTxHash: string,
  fundIndex: bigint | number,
  outputIndex: number,
): string {
  const seed = concat([
    unhex(fundTxHash),
    u32le(Number(fundIndex)),
    u32le(outputIndex),
  ]);
  return ccc.hashCkb(hex(seed));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function u32le(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v, true);
  return out;
}

export function leadingZeroBits(genes: Uint8Array): number {
  let count = 0;
  for (const b of genes) {
    if (b === 0) {
      count += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit--) {
      if (b & (1 << bit)) return count;
      count++;
    }
  }
  return count;
}

export function decodeTraits(genes: Uint8Array): Traits {
  const beauty = leadingZeroBits(genes);
  const rarity: Rarity =
    beauty >= 10 ? "传说" : beauty >= 8 ? "史诗" : beauty >= 5 ? "稀有" : "普通";
  return {
    species: genes[0] % SPECIES.length,
    speciesName: SPECIES[genes[0] % SPECIES.length],
    palette: genes[1] % 12,
    eyes: genes[3] % 16,
    mouth: genes[4] % 16,
    pattern: genes[5] % 8,
    personality: genes[6] % PERSONALITIES.length,
    personalityName: PERSONALITIES[genes[6] % PERSONALITIES.length],
    aura: genes[31] === 0xff,
    rarity,
    beauty,
  };
}
