/**
 * Transaction builders for all pet operations (tech-spec §3).
 *
 * Signature model (pet-lock "co-sign"): owner operations include at least one
 * input cell locked by the owner — the owner's own lock verifies them. Pokes
 * need no signature at all and can be submitted by any visitor's browser.
 */
import { ccc } from "@ckb-ccc/ccc";
import { loadDeployment, PARAMS, type Deployment } from "../config";
import { unhex } from "./molecule";
import {
  encodePetData,
  encodePetName,
  encodeWitness,
  hex,
  OP_ADOPT,
  OP_EUTHANIZE,
  OP_FEED,
  OP_POKE,
  OP_TRANSFER,
  STATE_DEAD,
  STATE_ALIVE,
  type PetData,
} from "./molecule";
import { adoptGenes, computeBurn, occupiedCapacity, type PetView } from "./petcell";

export type Client = ccc.Client;
export type Signer = ccc.Signer;

// ---------------------------------------------------------------------------
// Script helpers
// ---------------------------------------------------------------------------

export function petTypeScript(dep: Deployment = loadDeployment()): ccc.Script {
  return ccc.Script.from({
    codeHash: dep.petType.codeHash,
    hashType: (dep.petType.hashType ?? "type") as ccc.HashType,
    args: dep.petLock.codeHash,
  });
}

/** args = [full pet_type script hash][owner_lock_hash] */
export function petLockScript(ownerLockHash: string, dep: Deployment = loadDeployment()): ccc.Script {
  return ccc.Script.from({
    codeHash: dep.petLock.codeHash,
    hashType: (dep.petLock.hashType ?? "type") as ccc.HashType,
    args: ccc.hashCkb(petTypeScript(dep).toHex()) + ownerLockHash.slice(2),
  });
}

export async function signerLock(signer: Signer): Promise<ccc.Script> {
  const addr = (await signer.getAddressObjs())[0];
  return addr.script;
}

export async function signerLockHash(signer: Signer): Promise<string> {
  return ccc.hashCkb((await signerLock(signer)).toHex());
}

/** Owner lock hash from any CKB address string. */
export async function lockHashFromAddress(client: Client, address: string): Promise<string> {
  const addr = await ccc.Address.fromString(address, client);
  return ccc.hashCkb(addr.script.toHex());
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function cellDeps(dep: Deployment): ccc.CellDep[] {
  const depOf = (s: { txHash: string; index: number }) =>
    ccc.CellDep.from({
      outPoint: ccc.OutPoint.from({ txHash: s.txHash, index: s.index }),
      depType: "code",
    });
  return [depOf(dep.petType), depOf(dep.petLock)];
}

interface Clock {
  hash: ccc.Hex;
  timestamp: bigint;
}

async function clockOf(client: Client): Promise<Clock> {
  const tip = await client.getTipHeader();
  // RFC 0036 allows any existing header dep. Staying eight blocks behind tip
  // gives ordinary reorgs no chance to invalidate the chosen clock.
  const number = tip.number > 8n ? tip.number - 8n : 0n;
  const header = number === tip.number ? tip : await client.getHeaderByNumber(number);
  if (!header) throw new Error(`无法读取时钟区块 ${number}`);
  return { hash: header.hash, timestamp: header.timestamp };
}

function newTx(dep: Deployment): ccc.Transaction {
  const tx = ccc.Transaction.default();
  tx.cellDeps = cellDeps(dep);
  return tx;
}

function petDataBytes(d: PetData): ccc.Hex {
  return hex(encodePetData(d)) as ccc.Hex;
}

function witnessInputType(op: number, clockHash: string): ccc.Hex {
  return ("0x" +
    Array.from(encodeWitness(op, unhex(clockHash)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")) as ccc.Hex;
}

function witness(op: number, clockHash: string): ccc.Hex {
  return ccc.WitnessArgs.from({
    inputType: witnessInputType(op, clockHash),
  }).toHex();
}

async function txFee(client: Client, tx: ccc.Transaction): Promise<bigint> {
  const inCap = await tx.getInputsCapacity(client);
  const outCap = tx.getOutputsCapacity();
  return inCap - outCap;
}

/** Post-debt surplus, clamped because a Cell cannot have negative surplus. */
function settledSurplus(surplus: bigint, burn: bigint): bigint {
  return surplus > burn ? surplus - burn : 0n;
}

/**
 * Feed/transfer metabolic debt must leave the system as a real fee
 * (anti dust-reset rule, pet-type OP_FEED/OP_TRANSFER). completeFeeBy must
 * be called exactly once — with a fee rate pre-computed so the fee lands
 * above the metabolic burn.
 */
async function completeFeeWithMinFee(
  client: Client,
  signer: Signer,
  tx: ccc.Transaction,
  minFee: bigint,
): Promise<void> {
  // +200B covers the signature witness added at signing time
  const size = BigInt(tx.toHex().length / 2) + 200n;
  // feeRate unit: shannons per kilo-byte; MUST be a number — CCC parses
  // numeric strings as hex and would inflate the rate ~100x
  const rate = Number((minFee * 1000n) / size + 1000n);
  await tx.completeFeeBy(signer, rate);
  const fee = await txFee(client, tx);
  if (fee < minFee) {
    throw new Error(
      `无法把手续费提高到代谢燃烧要求(${fee} < ${minFee} shannons)`,
    );
  }
}

async function finalize(signer: Signer, tx: ccc.Transaction): Promise<ccc.Hex> {
  // the anti-dust min-fee rule can push the fee rate above CCC's sanity cap
  // (0.21 CKB on a small tx) — the fee is intentional, disable the guard
  const signed = await signer.signTransaction(tx);
  const txHash = await signer.client.sendTransaction(signed, undefined, {
    maxFeeRate: 0,
  });
  await waitCommitted(signer.client, txHash);
  return txHash;
}

async function finalizeUnsigned(client: Client, tx: ccc.Transaction): Promise<ccc.Hex> {
  // One submission only. A failure must be visible, never retried silently.
  const txHash = await client.sendTransaction(tx, undefined, { maxFeeRate: 0 });
  await waitCommitted(client, txHash);
  return txHash;
}

async function waitCommitted(client: Client, txHash: ccc.Hex): Promise<void> {
  const r = await client.waitTransaction(txHash, 1, 180_000, 3_000);
  if (!r) throw new Error(`交易 ${txHash} 未在 180 秒内确认`);
  const fresh = await client.getTransaction(txHash);
  if (fresh?.status !== "committed") {
    throw new Error(`交易 ${txHash} 状态为 ${fresh?.status ?? "unknown"},尚未 committed`);
  }
}

function requireAlive(pet: PetView) {
  if (pet.data.state === STATE_DEAD) throw new Error("这只宠物已经死了");
}
function requireDead(pet: PetView) {
  if (pet.data.state !== STATE_DEAD) throw new Error("这只宠物还活着");
}

// ---------------------------------------------------------------------------
// Adoption (self-mint)
// ---------------------------------------------------------------------------

export async function buildAdopt(
  signer: Signer,
  client: Client,
  name: string,
  foodCkb: bigint,
  /** optional explicit clock header hash (smoke tests use an old block so a
   * poke can settle days of metabolism immediately) */
  clockHash?: string,
): Promise<{ tx: ccc.Transaction; txHash: ccc.Hex }> {
  if (foodCkb < 0n) throw new Error("口粮不能为负数");
  const dep = loadDeployment();
  const clock = clockHash
    ? await client.getHeaderByHash(clockHash)
    : await clockOf(client);
  if (!clock) throw new Error("无法读取领养时钟区块");
  const now = clock.timestamp;
  const surplus = foodCkb > PARAMS.adoptMinSurplus ? foodCkb : PARAMS.adoptMinSurplus;
  const data: PetData = {
    version: 0,
    state: STATE_ALIVE,
    genes: new Uint8Array(32),
    birthTime: now,
    lastTouched: now,
    generation: 1,
    breedLockUntil: 0n,
    name: encodePetName(name),
  };
  const occ = occupiedCapacity(64, 32, encodePetData(data).length);
  const lock = await signerLock(signer);
  const ownerHash = ccc.hashCkb(lock.toHex());

  const tx = newTx(dep);
  tx.headerDeps = [clock.hash];
  tx.outputs = [
    ccc.CellOutput.from({
      lock: petLockScript(ownerHash, dep),
      type: petTypeScript(dep),
      capacity: occ + surplus,
    }),
  ];
  tx.outputsData = [petDataBytes(data)];
  // Collect exactly what the pet output needs. The first collected input is
  // the funding outpoint used by the on-chain gene derivation. The final
  // completeFeeBy below may append more inputs for the fee/change.
  await tx.completeInputsByCapacity(signer);

  // genes derive from the first (auto-collected) funding input.
  const genes = await adoptGenes(tx.inputs[0]!, 0);
  data.genes = unhex(genes);
  tx.outputsData = [petDataBytes(data)];

  tx.setWitnessArgs(0, {
    inputType: witnessInputType(OP_ADOPT, clock.hash),
  });
  await tx.completeFeeBy(signer);
  const txHash = await finalize(signer, tx);
  return { tx, txHash };
}

// ---------------------------------------------------------------------------
// Feeding
// ---------------------------------------------------------------------------

export async function buildFeed(
  signer: Signer,
  client: Client,
  pet: PetView,
  foodCkb: bigint,
): Promise<string> {
  requireAlive(pet);
  if (foodCkb < 0n) throw new Error("喂养数量不能为负数");
  const dep = loadDeployment();
  const clock = await clockOf(client);
  if (clock.timestamp <= pet.data.lastTouched) {
    throw new Error("时钟尚未前进,请等待下一区块后重试");
  }
  const elapsed = clock.timestamp - pet.data.lastTouched;
  const burn = computeBurn(elapsed);

  const data: PetData = { ...pet.data, lastTouched: clock.timestamp };
  // A pet may be underwater on metabolic debt. The contract still permits a
  // rescue as long as the output is ALIVE and the transaction burns the debt;
  // the extra funding input pays any deficit.
  const postDebt = settledSurplus(pet.surplus, burn);
  const occ = occupiedCapacity(64, 32, encodePetData(data).length);
  const newCap = occ + postDebt + foodCkb;

  const tx = newTx(dep);
  tx.inputs = [ccc.CellInput.from({ previousOutput: pet.outPoint })];
  tx.outputs = [ccc.CellOutput.from({ lock: pet.cellOutput.lock, type: pet.cellOutput.type, capacity: newCap })];
  tx.outputsData = [petDataBytes(data)];
  tx.headerDeps = [clock.hash];
  tx.witnesses = [witness(OP_FEED, clock.hash)];

  // A feed must have an external funding input, even when the pet's surplus
  // happens to cover the entire output/fee. This also makes the owner/funder
  // signature available to the lock script.
  await tx.completeInputsAddOne(signer);
  await completeFeeWithMinFee(client, signer, tx, burn);
  return finalize(signer, tx);
}

// ---------------------------------------------------------------------------
// Poke (anyone, no signature)
// ---------------------------------------------------------------------------

export async function buildPoke(
  client: Client,
  pet: PetView,
): Promise<{ tx: ccc.Transaction; txHash: string; dies: boolean; burn: bigint }> {
  requireAlive(pet);
  const dep = loadDeployment();
  const clock = await clockOf(client);
  if (clock.timestamp <= pet.data.lastTouched) {
    throw new Error("时钟尚未前进,请等待下一区块后重试");
  }
  const elapsed = clock.timestamp - pet.data.lastTouched;
  if (elapsed < PARAMS.minPokeIntervalMs) {
    throw new Error("距上次互动不足 1 小时,暂时不能 poke");
  }
  const burn = computeBurn(elapsed);
  // `pet.virtualSurplus` is projected to the current tip, while the clock is
  // eight blocks behind the tip. The contract evaluates the latter, so using
  // the tip projection here misclassifies pets near starvation as dead.
  const dies = burn >= pet.surplus;

  const data: PetData = dies
    ? { ...pet.data, lastTouched: clock.timestamp, state: STATE_DEAD }
    : { ...pet.data, lastTouched: clock.timestamp };
  const occ = occupiedCapacity(64, 32, encodePetData(data).length);
  const cap = dies ? occ : pet.capacity - burn;

  const tx = newTx(dep);
  tx.inputs = [ccc.CellInput.from({ previousOutput: pet.outPoint })];
  tx.outputs = [ccc.CellOutput.from({ lock: pet.cellOutput.lock, type: pet.cellOutput.type, capacity: cap })];
  tx.outputsData = [petDataBytes(data)];
  tx.headerDeps = [clock.hash];
  tx.witnesses = [witness(OP_POKE, clock.hash)];

  // Poke has no change output: the actual capacity delta is the fee. Alive
  // pokes require fee >= burn; a DEAD output consumes the full surplus, since
  // the type script requires fee >= surplus_on_death.
  const fee = pet.capacity - cap;
  const requiredFee = dies ? pet.surplus : burn;
  if (fee < requiredFee) {
    throw new Error(`poke 手续费不足(${fee} < ${requiredFee} shannons)`);
  }
  const txHash = await finalizeUnsigned(client, tx);
  return { tx, txHash, dies, burn };
}

// ---------------------------------------------------------------------------
// Loot (body of a dead pet)
// ---------------------------------------------------------------------------

export async function buildLoot(
  signer: Signer,
  _client: Client,
  pet: PetView,
): Promise<string> {
  requireDead(pet);
  const dep = loadDeployment();
  const lock = await signerLock(signer);

  const tx = newTx(dep);
  tx.inputs = [ccc.CellInput.from({ previousOutput: pet.outPoint })];
  // A DEAD cell is already exactly at occupied capacity. Keep the body intact
  // and collect the looter's own input to pay the fee + change.
  tx.outputs = [ccc.CellOutput.from({ lock, capacity: pet.capacity })];
  tx.outputsData = ["0x" as ccc.Hex];
  // The dead body pays for the loot output. Add one small funding input only
  // for the transaction fee and the looter's change, rather than forcing 150
  // CKB of extra capacity to be collected.
  await tx.completeInputsAddOne(signer);
  await tx.completeFeeBy(signer);
  return finalize(signer, tx);
}

// ---------------------------------------------------------------------------
// Transfer (sell / give away, keeps food)
// ---------------------------------------------------------------------------

export async function buildTransfer(
  signer: Signer,
  client: Client,
  pet: PetView,
  toAddress: string,
): Promise<string> {
  requireAlive(pet);
  const dep = loadDeployment();
  const clock = await clockOf(client);
  if (clock.timestamp <= pet.data.lastTouched) {
    throw new Error("时钟尚未前进,请等待下一区块后重试");
  }
  const elapsed = clock.timestamp - pet.data.lastTouched;
  const burn = computeBurn(elapsed);
  const toLock = await ccc.Address.fromString(toAddress, client);
  const toOwnerHash = ccc.hashCkb(toLock.script.toHex());

  const data: PetData = { ...pet.data, lastTouched: clock.timestamp };
  const occ = occupiedCapacity(64, 32, encodePetData(data).length);
  const postDebt = settledSurplus(pet.surplus, burn);
  const newCap = occ + postDebt;

  const tx = newTx(dep);
  tx.inputs = [ccc.CellInput.from({ previousOutput: pet.outPoint })];
  tx.outputs = [ccc.CellOutput.from({ lock: petLockScript(toOwnerHash, dep), type: pet.cellOutput.type, capacity: newCap })];
  tx.outputsData = [petDataBytes(data)];
  tx.headerDeps = [clock.hash];
  tx.witnesses = [witness(OP_TRANSFER, clock.hash)];

  // Transfer requires the owner's native lock in the input set for the
  // co-sign path. Add exactly one input; any additional fee input is left to
  // completeFeeWithMinFee.
  await tx.completeInputsAddOne(signer);
  await completeFeeWithMinFee(client, signer, tx, burn);
  return finalize(signer, tx);
}

// ---------------------------------------------------------------------------
// Euthanasia (owner exit, penalty burned)
// ---------------------------------------------------------------------------

export async function buildEuthanize(
  signer: Signer,
  client: Client,
  pet: PetView,
): Promise<{ txHash: string; penalty: bigint }> {
  requireAlive(pet);
  const dep = loadDeployment();
  const clock = await clockOf(client);
  if (clock.timestamp <= pet.data.lastTouched) {
    throw new Error("时钟尚未前进,请等待下一区块后重试");
  }
  const elapsed = clock.timestamp - pet.data.lastTouched;
  const burn = computeBurn(elapsed);
  const postDebt = settledSurplus(pet.surplus, burn);
  const penalty = (postDebt * PARAMS.euthanasiaPenaltyBp) / 10_000n;

  const data: PetData = { ...pet.data, lastTouched: clock.timestamp, state: STATE_DEAD };
  const occ = occupiedCapacity(64, 32, encodePetData(data).length);

  const tx = newTx(dep);
  tx.inputs = [ccc.CellInput.from({ previousOutput: pet.outPoint })];
  tx.outputs = [
    ccc.CellOutput.from({ lock: pet.cellOutput.lock, type: pet.cellOutput.type, capacity: occ }),
  ];
  tx.outputsData = [petDataBytes(data)];
  tx.headerDeps = [clock.hash];
  tx.witnesses = [witness(OP_EUTHANIZE, clock.hash)];

  // The owner must co-sign, so at least one owner input is mandatory.
  await tx.completeInputsAddOne(signer);
  await completeFeeWithMinFee(client, signer, tx, burn + penalty);
  const txHash = await finalize(signer, tx);
  return { txHash, penalty };
}
