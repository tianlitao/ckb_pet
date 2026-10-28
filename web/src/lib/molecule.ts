/**
 * Molecule codec for PetData — mirrors contracts/common/src/lib.rs exactly.
 * Table layout: [total:u32 LE][offsets:u32 LE ×(N+1)][fields]; ints little-endian.
 */

export const DATA_VERSION = 0;
export const STATE_ALIVE = 0;
export const STATE_DEAD = 1;

export const OP_FEED = 0;
export const OP_POKE = 1;
export const OP_TRANSFER = 2;
export const OP_EUTHANIZE = 3;
export const OP_LOOT = 4;
export const OP_ADOPT = 5;

export const MAX_NAME_LEN = 32;

/**
 * Encode a display name without splitting a UTF-8 code point at the
 * on-chain 32-byte limit. The contract enforces bytes, not JS code units.
 */
export function encodePetName(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length <= MAX_NAME_LEN) return bytes;

  let end = MAX_NAME_LEN;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end--;
  }
  return bytes.slice(0, end);
}

export interface PetData {
  version: number;
  state: number;
  genes: Uint8Array; // 32B
  birthTime: bigint; // ms
  lastTouched: bigint; // ms
  generation: number;
  breedLockUntil: bigint; // ms
  name: Uint8Array; // ≤32B
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

export function encodeTable(fields: Uint8Array[]): Uint8Array {
  const n = fields.length;
  const header = 4 + 4 * (n + 1);
  const total = header + fields.reduce((a, f) => a + f.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, total, true);
  let acc = header;
  for (let i = 0; i < n; i++) {
    dv.setUint32(4 + 4 * i, acc, true);
    acc += fields[i].length;
  }
  // Molecule tables store N+1 offsets; the trailing one is the total size.
  dv.setUint32(4 + 4 * n, total, true);
  let off = header;
  for (const f of fields) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

export class TableReader {
  private readonly data: Uint8Array;
  private readonly n: number;

  constructor(data: Uint8Array, n: number) {
    this.data = data;
    this.n = n;
    if (data.length < 4 + 4 * (n + 1)) throw new Error("data too short");
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (dv.getUint32(0, true) !== data.length) throw new Error("total size mismatch");
    const last = dv.getUint32(4 + 4 * n, true);
    if (last !== data.length) throw new Error("last offset mismatch");
  }

  field(i: number): Uint8Array {
    if (i >= this.n) throw new Error("field out of range");
    const dv = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    const start = dv.getUint32(4 + 4 * i, true);
    const end = dv.getUint32(4 + 4 * (i + 1), true);
    if (end > this.data.length || start > end) throw new Error("bad offsets");
    return this.data.slice(start, end);
  }
}

function u64le(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function u32le(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v, true);
  return out;
}

export function encodePetData(d: PetData): Uint8Array {
  return encodeTable([
    Uint8Array.of(d.version),
    Uint8Array.of(d.state),
    d.genes,
    u64le(d.birthTime),
    u64le(d.lastTouched),
    u32le(d.generation),
    u64le(d.breedLockUntil),
    d.name,
  ]);
}

export function decodePetData(raw: Uint8Array): PetData | null {
  try {
    const t = new TableReader(raw, 8);
    const genes = t.field(2);
    if (genes.length !== 32) return null;
    const rd = (i: number): bigint => {
      const f = t.field(i);
      if (f.length !== 8) throw new Error("bad u64");
      let v = 0n;
      for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(f[j]);
      return v;
    };
    const ru32 = (i: number): number => {
      const f = t.field(i);
      if (f.length !== 4) throw new Error("bad u32");
      return new DataView(f.buffer, f.byteOffset, f.byteLength).getUint32(0, true);
    };
    return {
      version: t.field(0)[0],
      state: t.field(1)[0],
      genes,
      birthTime: rd(3),
      lastTouched: rd(4),
      generation: ru32(5),
      breedLockUntil: rd(6),
      name: t.field(7),
    };
  } catch {
    return null;
  }
}

/** Witness `input_type` raw bytes: [op][clock_header_hash]. */
export function encodeWitness(op: number, clockHash: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(op), clockHash]);
}

export function hex(bytes: Uint8Array): string {
  return (
    "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

export function unhex(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
