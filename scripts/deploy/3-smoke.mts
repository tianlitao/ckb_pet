/**
 * Step 3: end-to-end smoke test on CKB testnet using the SAME frontend ops
 * code (web/src/lib/ops.ts). Covers:
 *   pet A: adopt -> feed -> transfer
 *   pet B: adopt with a 6-day-old clock -> poke to death -> loot
 *   pet C: adopt -> euthanize (burn penalty) -> loot
 *
 * The ops builders already wait for committed status. Each step below reads
 * the exact returned tx hash once more, records its block/txIndex, and follows
 * only the exact outpoint produced by the previous step.
 *
 * Run: npx tsx scripts/deploy/3-smoke.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/ccc";
import {
  buildAdopt,
  buildEuthanize,
  buildFeed,
  buildLoot,
  buildPoke,
  buildTransfer,
  petTypeScript,
} from "../../web/src/lib/ops.ts";
import {
  fetchPetAt,
  isDead,
  isLivePetAt,
  ownerLockHashOf,
  petName,
} from "../../web/src/lib/petcell.ts";
import { ckb } from "../../web/src/config.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const RESULT_FILE = ROOT + "deployment/smoke-latest.json";
const client = new ccc.ClientPublicTestnet({
  url: "https://testnet.ckb.dev/",
  fallbacks: ["https://testnet.ckbapp.dev/"],
});
const { privateKey } = JSON.parse(
  readFileSync(ROOT + "deployment/deploy-key.json", "utf8"),
);
const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
const ownerHash = ccc.hashCkb((await signer.getAddressObjs())[0].script.toHex());
const runId = Date.now().toString(36);
const petType = petTypeScript();

interface StepResult {
  step: string;
  txHash: string;
  block: string;
  txIndex: string;
  committed: true;
  outPoint?: string;
  consumed?: string;
  detail?: string;
}

const steps: StepResult[] = [];
const checks: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ok(step: string, detail = "") {
  checks.push(`OK ${step}${detail ? " - " + detail : ""}`);
  console.log(checks[checks.length - 1]);
}

/** Independently re-read an exact tx hash and require committed status. */
async function confirmCommitted(
  step: string,
  txHash: string,
  extra: Omit<StepResult, "step" | "txHash" | "block" | "txIndex" | "committed"> = {},
): Promise<StepResult> {
  const fresh = await client.getTransaction(txHash);
  assert(fresh, `${step}: tx ${txHash} not found`);
  assert(
    fresh.status === "committed",
    `${step}: tx ${txHash} status=${fresh.status}, expected committed`,
  );
  assert(fresh.blockNumber != null, `${step}: tx ${txHash} has no block number`);
  const result: StepResult = {
    step,
    txHash,
    block: fresh.blockNumber.toString(),
    txIndex: fresh.txIndex?.toString() ?? "?",
    committed: true,
    ...extra,
  };
  steps.push(result);
  console.log(
    `${step}: ${txHash} block=${result.block} txIndex=${result.txIndex}` +
      (extra.outPoint ? ` out=${extra.outPoint}` : "") +
      (extra.consumed ? ` consumed=${extra.consumed}` : ""),
  );
  return result;
}

/** Find a committed header at least `ageMs` older than the current tip. */
async function oldEnoughHeader(ageMs: bigint) {
  const tip = await client.getTipHeader();
  let lo = 0n;
  let hi = tip.number;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const header = await client.getHeaderByNumber(mid);
    assert(header, `header ${mid} not found`);
    if (tip.timestamp - header.timestamp >= ageMs) lo = mid;
    else hi = mid - 1n;
  }
  const header = await client.getHeaderByNumber(lo);
  assert(
    header && tip.timestamp - header.timestamp >= ageMs,
    "chain is not old enough for a mature smoke clock",
  );
  return header;
}

async function tipTimestamp() {
  return (await client.getTipHeader()).timestamp;
}

async function readOutpoint(txHash: string) {
  return fetchPetAt(client, { txHash, index: 0n }, await tipTimestamp());
}

function outpoint(txHash: string, index = 0n) {
  return `${txHash}#${index}`;
}

function assertLineage(
  pet: { outPoint: { txHash: string; index: bigint } },
  txHash: string,
  step: string,
) {
  assert(
    pet.outPoint.txHash === txHash && pet.outPoint.index === 0n,
    `${step}: expected lineage ${outpoint(txHash)}, got ${outpoint(pet.outPoint.txHash, pet.outPoint.index)}`,
  );
}

async function assertLootConsumes(
  lootTxHash: string,
  deadOutpoint: { txHash: string; index: bigint },
  step: string,
) {
  const loot = await client.getTransaction(lootTxHash);
  assert(loot, `${step}: loot tx not found`);
  const consumed = loot.transaction.inputs.some(
    (input) =>
      input.previousOutput.txHash === deadOutpoint.txHash &&
      input.previousOutput.index === deadOutpoint.index,
  );
  assert(
    consumed,
    `${step}: loot tx does not consume ${outpoint(deadOutpoint.txHash, deadOutpoint.index)}`,
  );
  assert(
    !(await isLivePetAt(client, deadOutpoint, petType)),
    `${step}: target pet is still live after loot`,
  );
}

async function main() {
  const startedAt = new Date().toISOString();
  const bal0 = await signer.getBalance();
  console.log(`deployer balance: ${Number(bal0) / 1e8} CKB`);
  console.log(`run id: ${runId}`);

  // ---------- pet A: adopt -> feed -> transfer ----------
  console.log("- pet A -");
  const a = await buildAdopt(signer, client, `A-${runId}`, ckb(30));
  await confirmCommitted("A adopt", a.txHash, {
    outPoint: outpoint(a.txHash),
  });
  let petA = await readOutpoint(a.txHash);
  assertLineage(petA, a.txHash, "A adopt");
  assert(
    petName(petA) === `A-${runId}` && !isDead(petA),
    "pet A name/state mismatch",
  );
  assert(ownerLockHashOf(petA) === ownerHash, "pet A owner mismatch");
  ok(
    "A adopt (self-mint + gene derivation)",
    `${petA.traits.speciesName}/${petA.traits.personalityName}`,
  );

  const capBefore = petA.capacity;
  const feedTx = await buildFeed(signer, client, petA, ckb(10));
  await confirmCommitted("A feed", feedTx, {
    outPoint: outpoint(feedTx),
    consumed: outpoint(petA.outPoint.txHash, petA.outPoint.index),
  });
  petA = await readOutpoint(feedTx);
  assertLineage(petA, feedTx, "A feed");
  assert(
    petA.capacity > capBefore && petA.capacity <= capBefore + ckb(10),
    `feed capacity delta out of range: ${petA.capacity - capBefore}`,
  );
  ok("A feed 10 CKB", `surplus ${Number(petA.virtualSurplus) / 1e8} CKB`);

  const stranger = new ccc.SignerCkbPrivateKey(client, "0x" + "11".repeat(32));
  const strangerAddr = await stranger.getRecommendedAddress();
  const transferTx = await buildTransfer(
    signer,
    client,
    petA,
    strangerAddr,
  );
  await confirmCommitted("A transfer", transferTx, {
    outPoint: outpoint(transferTx),
    consumed: outpoint(petA.outPoint.txHash, petA.outPoint.index),
  });
  petA = await readOutpoint(transferTx);
  assertLineage(petA, transferTx, "A transfer");
  assert(ownerLockHashOf(petA) !== ownerHash, "transfer did not change owner");
  ok("A transfer to stranger address", strangerAddr.slice(0, 18) + "...");

  const earlyPokeRejected = await buildPoke(client, petA)
    .then(() => false)
    .catch(() => true);
  assert(earlyPokeRejected, "poke within 1h should be rejected client-side");
  ok("A unsigned poke 1h minimum-interval guard");

  // ---------- pet B: old-clock adopt -> poke to death -> loot ----------
  console.log("- pet B -");
  const oldHeader = await oldEnoughHeader(6n * 86_400_000n);
  const b = await buildAdopt(
    signer,
    client,
    `B-${runId}`,
    ckb(20),
    oldHeader.hash,
  );
  await confirmCommitted("B adopt", b.txHash, {
    outPoint: outpoint(b.txHash),
  });
  let petB = await readOutpoint(b.txHash);
  assertLineage(petB, b.txHash, "B adopt");
  assert(
    petName(petB) === `B-${runId}` && !isDead(petB),
    "pet B name/state mismatch",
  );
  ok(
    "B adopt (old clock, >6 days debt)",
    `virtual surplus ${Number(petB.virtualSurplus) / 1e8} CKB`,
  );

  const bBeforeDeath = { ...petB.outPoint };
  const death = await buildPoke(client, petB);
  assert(death.dies, "expected pet B to starve after its 6-day debt");
  await confirmCommitted("B poke -> DEAD", death.txHash, {
    outPoint: outpoint(death.txHash),
    consumed: outpoint(bBeforeDeath.txHash, bBeforeDeath.index),
  });
  petB = await readOutpoint(death.txHash);
  assertLineage(petB, death.txHash, "B poke");
  assert(isDead(petB), "pet B should be DEAD on chain");
  ok("B poke -> on-chain DEAD", `burn ${Number(death.burn) / 1e8} CKB`);

  const deadB = { txHash: petB.outPoint.txHash, index: petB.outPoint.index };
  const lootB = await buildLoot(signer, client, petB);
  await confirmCommitted("B loot", lootB, {
    consumed: outpoint(deadB.txHash, deadB.index),
  });
  await assertLootConsumes(lootB, deadB, "B loot");
  ok("B loot (exact dead outpoint consumed)", lootB.slice(0, 14) + "...");

  // ---------- pet C: adopt -> euthanize -> loot ----------
  console.log("- pet C -");
  const c = await buildAdopt(signer, client, `C-${runId}`, ckb(20));
  await confirmCommitted("C adopt", c.txHash, {
    outPoint: outpoint(c.txHash),
  });
  let petC = await readOutpoint(c.txHash);
  assertLineage(petC, c.txHash, "C adopt");
  assert(
    petName(petC) === `C-${runId}` && !isDead(petC),
    "pet C name/state mismatch",
  );

  const cBeforeEuth = { ...petC.outPoint };
  const { txHash: euthTx, penalty } = await buildEuthanize(
    signer,
    client,
    petC,
  );
  await confirmCommitted("C euthanize", euthTx, {
    outPoint: outpoint(euthTx),
    consumed: outpoint(cBeforeEuth.txHash, cBeforeEuth.index),
  });
  petC = await readOutpoint(euthTx);
  assertLineage(petC, euthTx, "C euthanize");
  assert(isDead(petC), "pet C should be DEAD after euthanasia");
  ok("C euthanasia burns penalty", `penalty ${Number(penalty) / 1e8} CKB`);

  const deadC = { txHash: petC.outPoint.txHash, index: petC.outPoint.index };
  const lootC = await buildLoot(signer, client, petC);
  await confirmCommitted("C loot", lootC, {
    consumed: outpoint(deadC.txHash, deadC.index),
  });
  await assertLootConsumes(lootC, deadC, "C loot");
  ok("C loot (exact dead outpoint consumed)", lootC.slice(0, 14) + "...");

  const bal = await signer.getBalance();
  const report = {
    network: "ckb_testnet",
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    deployerAddress: await signer.getRecommendedAddress(),
    deployerLockHash: ownerHash,
    balanceBefore: bal0.toString(),
    balanceAfter: bal.toString(),
    steps,
    checks,
    note: "Every listed tx was independently re-read by exact tx hash and required status=committed; every operation follows the previous operation's exact outpoint.",
  };
  writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2) + "\n");

  console.log(`final balance: ${Number(bal) / 1e8} CKB (was ${Number(bal0) / 1e8})`);
  console.log("\n===== SMOKE TEST SUMMARY =====");
  for (const check of checks) console.log(check);
  console.log(`\nwrote ${RESULT_FILE}`);
  console.log(
    `verified ${steps.length} committed txs; all assertions followed exact outpoints`,
  );
}

await main();
