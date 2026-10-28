/**
 * Domain layer: reading pets from chain and projecting their hunger state.
 * Hunger is a client-side virtual state — the chain only settles metabolism
 * on the next touch (see tech-spec §7.1).
 */
import { ccc } from "@ckb-ccc/ccc";
import { hex as toHex, unhex } from "./molecule";
import {
  decodePetData,
  STATE_ALIVE,
  STATE_DEAD,
  type PetData,
} from "./molecule";
import { decodeTraits, type Traits } from "./genes";
import { PARAMS } from "../config";

export interface PetView {
  outPoint: { txHash: string; index: bigint };
  data: PetData;
  traits: Traits;
  capacity: bigint;
  occupied: bigint;
  surplus: bigint; // shannons, as settled on chain
  /** surplus after charging the virtual metabolic debt up to `now` */
  virtualSurplus: bigint;
  ownerLockHash: string; // blake2b of the pet-lock args -> lock hash of pet cell
  ownerLockArgs: string; // full 64B args: pet_type_code_hash ++ owner_lock_hash
  cellOutput: ccc.CellOutput;
  cellOutputData: string; // 0x hex
}

export function occupiedCapacity(
  lockArgsLen: number,
  typeArgsLen: number,
  dataLen: number,
): bigint {
  const bytes = 8 + dataLen + (33 + lockArgsLen) + (33 + typeArgsLen);
  return BigInt(bytes) * 100_000_000n;
}

export function computeBurn(elapsedMs: bigint): bigint {
  if (elapsedMs <= 0n) return PARAMS.minBurn;
  const burn = (PARAMS.burnPerDay * elapsedMs) / PARAMS.msPerDay;
  return burn < PARAMS.minBurn ? PARAMS.minBurn : burn;
}

/** The pet-lock args layout: [pet_type_code_hash(32)][owner_lock_hash(32)]. */
export function ownerLockHashOf(pet: PetView): string {
  return "0x" + pet.ownerLockArgs.slice(66);
}

export function petFromCell(
  cell: ccc.Cell,
  nowMs: bigint,
): PetView | null {
  const data = decodePetData(unhex(cell.outputData));
  if (!data) return null;
  const args = cell.cellOutput.lock.args;
  if (args.length !== 130) return null; // 0x + 128 hex chars
  const occupied = occupiedCapacity(64, 32, cell.outputData.length / 2 - 1);
  const surplus = cell.cellOutput.capacity - occupied;
  const elapsed = nowMs > data.lastTouched ? nowMs - data.lastTouched : 0n;
  const burn = data.state === STATE_DEAD ? 0n : computeBurn(elapsed);
  const virtualSurplusRaw = surplus - burn;
  return {
    outPoint: { txHash: cell.outPoint.txHash, index: cell.outPoint.index },
    data,
    traits: decodeTraits(data.genes),
    capacity: cell.cellOutput.capacity,
    occupied,
    surplus,
    virtualSurplus: virtualSurplusRaw > 0n ? virtualSurplusRaw : 0n,
    ownerLockHash: args.slice(66),
    ownerLockArgs: args,
    cellOutput: cell.cellOutput,
    cellOutputData: cell.outputData,
  };
}

/** Re-read and decode one exact pet outpoint from chain history. */
export async function fetchPetAt(
  client: ccc.Client,
  outPoint: { txHash: string; index: bigint | number },
  nowMs: bigint,
): Promise<PetView> {
  const cell = await client.getCell(
    ccc.OutPoint.from({ txHash: outPoint.txHash, index: outPoint.index }),
  );
  if (!cell) {
    throw new Error(`链上不存在该 Cell: ${outPoint.txHash}#${outPoint.index}`);
  }
  const pet = petFromCell(cell, nowMs);
  if (!pet) {
    throw new Error(`Cell 不是合法宠物: ${outPoint.txHash}#${outPoint.index}`);
  }
  return pet;
}

/** True only when the exact outpoint is still live and decodes as that type. */
export async function isLivePetAt(
  client: ccc.Client,
  outPoint: { txHash: string; index: bigint | number },
  petType: ccc.Script,
): Promise<boolean> {
  const cell = await client.getCellLive(
    ccc.OutPoint.from({ txHash: outPoint.txHash, index: outPoint.index }),
    true,
  );
  if (!cell) return false;
  return cell.cellOutput.type?.toHex() === petType.toHex();
}

export function isAlive(pet: PetView): boolean {
  return pet.data.state === STATE_ALIVE;
}

export function isDead(pet: PetView): boolean {
  return pet.data.state === STATE_DEAD;
}

export function isStarving(pet: PetView): boolean {
  return isAlive(pet) && pet.virtualSurplus < PARAMS.starveLine;
}

/** Hours until the pet starves to death if nobody touches it (virtual). */
export function hoursToStarve(pet: PetView): number | null {
  if (!isAlive(pet)) return null;
  const burnPerMs = Number(PARAMS.burnPerDay) / Number(PARAMS.msPerDay);
  const ms = Number(pet.virtualSurplus) / burnPerMs;
  return ms / 3_600_000;
}

export function petName(pet: PetView): string {
  return pet.data.name.length > 0
    ? new TextDecoder().decode(pet.data.name)
    : "无名" + pet.traits.speciesName;
}

/** Fetch all live pet cells of our type script. */
export async function fetchPets(
  client: ccc.Client,
  petTypeScript: ccc.Script,
): Promise<PetView[]> {
  const tip = await client.getTipHeader();
  const pets: PetView[] = [];
  let count = 0;
  for await (const cell of client.findCellsByType(petTypeScript)) {
    const pet = petFromCell(cell, tip.timestamp);
    if (pet) pets.push(pet);
    if (++count >= 500) break; // MVP bound; paginate when the world gets crowded
  }
  return pets;
}

/** Seed used at adoption — must match pet-type's adopt() exactly. */
export async function adoptGenes(
  fundInput: ccc.CellInput,
  petOutputIndex: number,
): Promise<string> {
  const txHash = fundInput.previousOutput.txHash;
  const index = fundInput.previousOutput.index;
  const seed = new Uint8Array(32 + 4 + 4);
  seed.set(unhex(txHash), 0);
  new DataView(seed.buffer).setUint32(32, Number(index), true);
  new DataView(seed.buffer).setUint32(36, petOutputIndex, true);
  return ccc.hashCkb(toHex(seed));
}
