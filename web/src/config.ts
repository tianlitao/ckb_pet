/**
 * Network + deployment configuration.
 *
 * Code hashes are generated from the built contract ELFs (scripts/hash_elfs.py);
 * deployment info (out points + code hashes) from scripts/deploy/2-deploy.mjs.
 * localStorage key `petcell.deployment` can override per browser.
 */
import { DEPLOYMENT as DEPLOYED } from "./generated/deployment";
import {
  PET_TYPE_CODE_HASH,
  PET_LOCK_CODE_HASH,
} from "./generated/code_hashes";

export interface DeployedScript {
  codeHash: string;
  /** "type" (TYPE_ID-wrapped cells, standard) or "data1" (raw ELF hash) */
  hashType: string;
  /** 0x-tx-hash of the cell carrying the script binary */
  txHash: string;
  index: number;
}

export interface Deployment {
  petType: DeployedScript;
  petLock: DeployedScript;
}

/** Zero out points until on-chain deployment is recorded. */
export const PLACEHOLDER_TX = "0x" + "00".repeat(32);

const DEFAULT_DEPLOYMENT: Deployment = {
  petType: {
    codeHash: DEPLOYED?.petType?.codeHash ?? PET_TYPE_CODE_HASH,
    hashType: DEPLOYED?.petType?.hashType ?? "type",
    txHash: DEPLOYED?.petType?.txHash ?? PLACEHOLDER_TX,
    index: DEPLOYED?.petType?.index ?? 0,
  },
  petLock: {
    codeHash: DEPLOYED?.petLock?.codeHash ?? PET_LOCK_CODE_HASH,
    hashType: DEPLOYED?.petLock?.hashType ?? "type",
    txHash: DEPLOYED?.petLock?.txHash ?? PLACEHOLDER_TX,
    index: DEPLOYED?.petLock?.index ?? 1,
  },
};

export function loadDeployment(): Deployment {
  try {
    const raw = localStorage.getItem("petcell.deployment");
    if (raw) return { ...DEFAULT_DEPLOYMENT, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_DEPLOYMENT;
}

export function saveDeployment(d: Deployment) {
  localStorage.setItem("petcell.deployment", JSON.stringify(d));
}

export const IS_DEPLOYED = () => loadDeployment().petType.txHash !== PLACEHOLDER_TX;

// ---------------------------------------------------------------------------
// Economic parameters — MUST mirror contracts/common/src/lib.rs.
// ---------------------------------------------------------------------------

export const SHANNONS = 100_000_000n;

export const PARAMS = {
  burnPerDay: 500_000_000n, // 5 CKB / day
  minBurn: 21_000_000n, // 0.21 CKB = burnPerDay/24 (anti-freeze)
  minPokeIntervalMs: 3_600_000n, // 1 hour
  adoptMinSurplus: 2_000_000_000n, // 20 CKB initial food
  euthanasiaPenaltyBp: 2000n, // 20% of post-debt surplus, burned
  msPerDay: 86_400_000n,
  starveLine: 1_000_000_000n, // 10 CKB, display only
};

export function ckb(n: number | bigint): bigint {
  return BigInt(n) * SHANNONS;
}

export function fmtCkb(shannons: bigint, digits = 2): string {
  const neg = shannons < 0n;
  const v = neg ? -shannons : shannons;
  const whole = v / SHANNONS;
  const frac = digits > 0
    ? `.${(v % SHANNONS).toString().padStart(8, "0").slice(0, digits)}`
    : "";
  return `${neg ? "-" : ""}${whole}${frac}`;
}
