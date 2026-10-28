/**
 * Demo mode: fully local mock pets so the whole experience is playable
 * without a deployed contract or wallet (?demo=1).
 */
import { ccc } from "@ckb-ccc/ccc";
import type { PetView } from "./petcell";
import { computeBurn } from "./petcell";
import { decodeTraits } from "./genes";
import { STATE_ALIVE, STATE_DEAD, type PetData } from "./molecule";

export const DEMO_OWNER = "0x" + "aa".repeat(32);

interface DemoPetSpec {
  name: string;
  seed: number;
  lastTouchedHoursAgo: number;
  foodCkb: bigint;
  dead?: boolean;
}

const SPECS: DemoPetSpec[] = [
  { name: "麻薯", seed: 0x11, lastTouchedHoursAgo: 3, foodCkb: 40n },
  { name: "煤球", seed: 0x22, lastTouchedHoursAgo: 20, foodCkb: 12n },
  { name: "肥啾", seed: 0x33, lastTouchedHoursAgo: 60, foodCkb: 18n },
  { name: "闹闹", seed: 0x44, lastTouchedHoursAgo: 5, foodCkb: 55n },
  { name: "馒头", seed: 0x55, lastTouchedHoursAgo: 2, foodCkb: 26n },
  { name: "阿薯", seed: 0x66, lastTouchedHoursAgo: 100, foodCkb: 6n },
  { name: "咕噜", seed: 0x77, lastTouchedHoursAgo: 30, foodCkb: 9n, dead: true },
  { name: "雪宝", seed: 0x88, lastTouchedHoursAgo: 1, foodCkb: 80n },
];

function seededGenes(seed: number): Uint8Array {
  const g = new Uint8Array(32);
  let x = (seed * 2654435761 + 7 * 40503) >>> 0;
  for (let i = 0; i < 32; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    g[i] = (x >>> 16) & 0xff;
  }
  if (seed === 0x88) g[31] = 0xff; // one legendary aura in the demo
  return g;
}

export function makeDemoPet(spec: DemoPetSpec, nowMs: bigint): PetView {
  const genes = seededGenes(spec.seed);
  const data: PetData = {
    version: 0,
    state: spec.dead ? STATE_DEAD : STATE_ALIVE,
    genes,
    birthTime: nowMs - 86_400_000n * 30n,
    lastTouched: nowMs - BigInt(spec.lastTouchedHoursAgo) * 3_600_000n,
    generation: 1,
    breedLockUntil: 0n,
    name: new TextEncoder().encode(spec.name),
  };
  const occupiedShannons = 316n * 100_000_000n; // typical pet cell body
  const surplus = spec.dead ? 0n : spec.foodCkb * 100_000_000n;
  const elapsed = nowMs > data.lastTouched ? nowMs - data.lastTouched : 0n;
  const burn = spec.dead ? 0n : computeBurn(elapsed);
  const virtualRaw = surplus - burn;
  return {
    outPoint: { txHash: "0x" + "d".repeat(63) + spec.seed.toString(16), index: 0n },
    data,
    traits: decodeTraits(genes),
    capacity: occupiedShannons + surplus,
    occupied: occupiedShannons,
    surplus,
    virtualSurplus: virtualRaw > 0n ? virtualRaw : 0n,
    ownerLockHash: DEMO_OWNER,
    ownerLockArgs: "0x" + "00".repeat(32) + DEMO_OWNER.slice(2),
    cellOutput: ccc.CellOutput.from({
      lock: ccc.Script.from({ codeHash: "0x" + "00".repeat(32), hashType: "data1", args: "0x" }),
      capacity: occupiedShannons + surplus,
    }),
    cellOutputData: "0x",
  };
}

export function makeDemoPets(nowMs: bigint): PetView[] {
  return SPECS.map((s) => makeDemoPet(s, nowMs));
}
