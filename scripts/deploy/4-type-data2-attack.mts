/**
 * Live testnet regression for the cross-hash_type fee-sharing attack.
 *
 * 1. Mint one pet through the production TYPE_ID wrapper (hash_type=type).
 * 2. Mint one pet through the same ELF via hash_type=data2.
 * 3. Dry-run one normal FEED and one shadow FEED as positive controls.
 * 4. Dry-run a transaction that feeds both pets using one shared 12 CKB fee.
 *
 * The combined transaction MUST be rejected with pet-type error code 11
 * (ERR_SCRIPT_GROUP). It is NEVER broadcast.
 *
 * Run: npx tsx scripts/deploy/4-type-data2-attack.mts
 */
import { ccc } from "@ckb-ccc/ccc";
import { readFileSync, writeFileSync } from "node:fs";
import { loadDeployment } from "../../web/src/config.ts";
import {
  decodePetData,
  encodePetData,
  hex,
  OP_ADOPT,
  OP_FEED,
  type PetData,
} from "../../web/src/lib/molecule.ts";
import { adoptGenes, computeBurn, occupiedCapacity } from "../../web/src/lib/petcell.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const ELF_DIR = ROOT + "contracts/target/riscv64imac-unknown-none-elf/release/";
const KEYFILE = ROOT + "deployment/deploy-key.json";
const RESULT_FILE = ROOT + "deployment/type-data2-attack.json";
const DAY_MS = 86_400_000n;
const SHARED_FEE = 12n * 100_000_000n;
const PET_SURPLUS = 20n * 100_000_000n;
const DEAD_OWNER_HASH = "0x" + "33".repeat(32);

const client = new ccc.ClientPublicTestnet({
  url: "https://testnet.ckb.dev/",
  fallbacks: ["https://testnet.ckbapp.dev/"],
});
const { privateKey } = JSON.parse(readFileSync(KEYFILE, "utf8"));
const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
const deployerLock = (await signer.getAddressObjs())[0].script;
const deployment = loadDeployment();

const typeElfHash = ccc.hashCkb(readFileSync(ELF_DIR + "pet-type"));
const lockElfHash = ccc.hashCkb(readFileSync(ELF_DIR + "pet-lock"));
const normalType = ccc.Script.from({
  codeHash: deployment.petType.codeHash,
  hashType: deployment.petType.hashType as ccc.HashType,
  args: deployment.petLock.codeHash,
});
// Data2.code_hash is the CKB personalized hash of the Cell data (the ELF).
const shadowType = ccc.Script.from({
  codeHash: typeElfHash,
  hashType: "data2",
  // The shadow group is internally consistent too: its lock is pet-lock via
  // Data2, so its pet-type args bind the raw pet-lock ELF hash.
  args: lockElfHash,
});
const normalTypeHash = ccc.hashCkb(normalType.toHex());
const shadowTypeHash = ccc.hashCkb(shadowType.toHex());
const normalLock = ccc.Script.from({
  codeHash: deployment.petLock.codeHash,
  hashType: deployment.petLock.hashType as ccc.HashType,
  args: normalTypeHash + DEAD_OWNER_HASH.slice(2),
});
const shadowLock = ccc.Script.from({
  codeHash: lockElfHash,
  hashType: "data2",
  args: shadowTypeHash + DEAD_OWNER_HASH.slice(2),
});

const deps = [
  ccc.CellDep.from({
    outPoint: ccc.OutPoint.from({
      txHash: deployment.petType.txHash,
      index: deployment.petType.index,
    }),
    depType: "code",
  }),
  ccc.CellDep.from({
    outPoint: ccc.OutPoint.from({
      txHash: deployment.petLock.txHash,
      index: deployment.petLock.index,
    }),
    depType: "code",
  }),
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function witnessInputType(op: number, clockHash: string): string {
  return "0x" + op.toString(16).padStart(2, "0") + clockHash.slice(2);
}

function petData(lastTouched: bigint, name: string): PetData {
  return {
    version: 0,
    state: 0,
    genes: new Uint8Array(32),
    birthTime: lastTouched,
    lastTouched,
    generation: 1,
    breedLockUntil: 0n,
    name: new TextEncoder().encode(name),
  };
}

function decodeCellData(cell: ccc.Cell): PetData {
  const data = decodePetData(
    Uint8Array.from(Buffer.from(cell.outputData.slice(2), "hex")),
  );
  assert(data, `cell ${cell.outPoint.txHash}#${cell.outPoint.index} does not decode`);
  return data;
}

async function waitCommitted(txHash: string) {
  const result = await client.waitTransaction(txHash, 1, 180_000, 2_000);
  assert(result, `transaction ${txHash} was not confirmed`);
  const fresh = await client.getTransaction(txHash);
  assert(fresh?.status === "committed", `${txHash} is ${fresh?.status}, not committed`);
  return fresh;
}

async function headerAtOrBefore(targetTimestamp: bigint) {
  const tip = await client.getTipHeader();
  let lo = 0n;
  let hi = tip.number;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const header = await client.getHeaderByNumber(mid);
    assert(header, `missing header ${mid}`);
    if (header.timestamp <= targetTimestamp) lo = mid;
    else hi = mid - 1n;
  }
  const header = await client.getHeaderByNumber(lo);
  assert(header, `missing header ${lo}`);
  assert(header.timestamp <= targetTimestamp, "failed to find an old clock header");
  return header;
}

async function mintPet(
  label: string,
  type: ccc.Script,
  lock: ccc.Script,
  clockHash: string,
  clockTimestamp: bigint,
): Promise<ccc.Cell> {
  const data = petData(clockTimestamp, label);
  const capacity = occupiedCapacity(64, 32, encodePetData(data).length) + PET_SURPLUS;

  const tx = ccc.Transaction.default();
  tx.cellDeps = deps;
  tx.headerDeps = [clockHash];
  tx.outputs = [ccc.CellOutput.from({ lock, type, capacity })];
  tx.outputsData = [hex(encodePetData(data))];
  await tx.completeInputsByCapacity(signer, 150n * 100_000_000n);

  data.genes = Uint8Array.from(
    Buffer.from((await adoptGenes(tx.inputs[0]!, 0)).slice(2), "hex"),
  );
  tx.outputsData = [hex(encodePetData(data))];
  // Adoption has no pet input; the first ordinary funding input carries the
  // input_type witness. Do not assume it stays at input #0 after fee completion.
  await tx.completeFeeBy(signer);
  const adoptWitnessIndex = await tx.findInputIndexByLock(deployerLock, client);
  assert(adoptWitnessIndex !== undefined, "adoption has no deployer funding input");
  tx.setWitnessArgs(adoptWitnessIndex, {
    inputType: witnessInputType(OP_ADOPT, clockHash),
  });

  const txHash = await signer.client.sendTransaction(await signer.signTransaction(tx));
  const committed = await waitCommitted(txHash);
  assert(
    committed.transaction.outputs[0]?.type?.eq(type),
    `${label} adoption output does not carry the expected type script`,
  );
  const cell = await client.getCellLive(
    ccc.OutPoint.from({ txHash, index: 0 }),
    true,
  );
  assert(cell, `${label} adoption output is not live at ${txHash}#0`);
  const decoded = decodeCellData(cell);
  assert(decoded.birthTime === clockTimestamp, `${label} birth time mismatch`);
  assert(decoded.lastTouched === clockTimestamp, `${label} lastTouched mismatch`);
  return cell;
}

async function chooseFundingCell(): Promise<ccc.Cell> {
  for await (const cell of client.findCellsByLock(
    deployerLock,
    null,
    true,
    "desc",
    10,
  )) {
    if (
      !cell.cellOutput.type &&
      cell.outputData === "0x" &&
      cell.cellOutput.capacity > SHARED_FEE + 61n * 100_000_000n
    ) {
      return cell;
    }
  }
  throw new Error("no pure-CKB funding cell large enough for the attack fixture");
}

function buildFeedDryRun(
  pets: ccc.Cell[],
  funding: ccc.Cell,
  clockHash: string,
  clockTimestamp: bigint,
): ccc.Transaction {
  const tx = ccc.Transaction.default();
  tx.cellDeps = deps;
  tx.headerDeps = [clockHash];
  tx.inputs = [
    ...pets.map((pet) => ccc.CellInput.from({ previousOutput: pet.outPoint })),
    ccc.CellInput.from({ previousOutput: funding.outPoint }),
  ];
  tx.outputs = [
    ...pets.map((pet) => {
      const data = decodeCellData(pet);
      data.lastTouched = clockTimestamp;
      assert(
        encodePetData(data).length === (pet.outputData.length - 2) / 2,
        "feed changed the encoded data length",
      );
      return ccc.CellOutput.from({
        lock: pet.cellOutput.lock,
        type: pet.cellOutput.type,
        capacity: pet.cellOutput.capacity,
      });
    }),
    ccc.CellOutput.from({
      lock: deployerLock,
      capacity: funding.cellOutput.capacity - SHARED_FEE,
    }),
  ];
  tx.outputsData = [
    ...pets.map((pet) => {
      const data = decodeCellData(pet);
      data.lastTouched = clockTimestamp;
      return hex(encodePetData(data));
    }),
    "0x",
  ];
  for (let i = 0; i < pets.length; i += 1) {
    tx.setWitnessArgs(i, {
      inputType: witnessInputType(OP_FEED, clockHash),
    });
  }
  return tx;
}

async function main() {
  const tip = await client.getTipHeader();
  assert(tip.number > 8n, "chain tip is too low");
  const attackClock = await client.getHeaderByNumber(tip.number - 8n);
  assert(attackClock, "cannot read attack clock header");
  const oldClock = await headerAtOrBefore(
    attackClock.timestamp - 2n * DAY_MS - 300_000n,
  );
  const elapsed = attackClock.timestamp - oldClock.timestamp;
  const burn = computeBurn(elapsed);
  assert(elapsed >= 2n * DAY_MS, "fixture clock is younger than two days");
  assert(burn < SHARED_FEE, `one shared fee must cover one group`);
  assert(SHARED_FEE < burn * 2n, `shared fee must be insufficient for both groups`);

  console.log("attack clock:", attackClock.number.toString(), attackClock.hash);
  console.log("old clock:", oldClock.number.toString(), oldClock.hash);
  console.log("elapsed ms:", elapsed.toString(), "burn per pet:", burn.toString());
  console.log("shared fee:", SHARED_FEE.toString());

  const normal = await mintPet(
    "normal-type",
    normalType,
    normalLock,
    oldClock.hash,
    oldClock.timestamp,
  );
  console.log(`normal pet: ${normal.outPoint.txHash}#${normal.outPoint.index}`);
  const shadow = await mintPet(
    "shadow-data2",
    shadowType,
    shadowLock,
    oldClock.hash,
    oldClock.timestamp,
  );
  console.log(`shadow pet: ${shadow.outPoint.txHash}#${shadow.outPoint.index}`);

  const funding = await chooseFundingCell();
  console.log(
    `funding: ${funding.outPoint.txHash}#${funding.outPoint.index}`,
    Number(funding.cellOutput.capacity) / 1e8,
    "CKB",
  );

  const normalControl = buildFeedDryRun(
    [normal],
    funding,
    attackClock.hash,
    attackClock.timestamp,
  );
  const normalCycles = await client.sendTransactionDry(
    await signer.signTransaction(normalControl),
  );
  console.log("normal-only FEED dry-run: ACCEPT", normalCycles.toString());

  const shadowControl = buildFeedDryRun(
    [shadow],
    funding,
    attackClock.hash,
    attackClock.timestamp,
  );
  const shadowCycles = await client.sendTransactionDry(
    await signer.signTransaction(shadowControl),
  );
  console.log("shadow-only FEED dry-run: ACCEPT", shadowCycles.toString());

  const attack = buildFeedDryRun(
    [normal, shadow],
    funding,
    attackClock.hash,
    attackClock.timestamp,
  );
  const attackSigned = await signer.signTransaction(attack);
  let rejection: { errorCode?: number; source?: string; message: string };
  try {
    const cycles = await client.sendTransactionDry(attackSigned);
    throw new Error(`attack unexpectedly ACCEPTED at ${cycles} cycles`);
  } catch (error) {
    const value = error as {
      errorCode?: number;
      source?: string;
      message?: string;
      data?: string;
    };
    assert(
      !String(value.message ?? "").startsWith("attack unexpectedly ACCEPTED"),
      String(value.message),
    );
    rejection = {
      errorCode: value.errorCode,
      source: value.source,
      message: String(value.message ?? value.data ?? error),
    };
  }
  console.log("combined FEED dry-run:", rejection);
  assert(
    rejection.errorCode === 11,
    `expected ERR_SCRIPT_GROUP (11), got ${rejection.errorCode ?? "unknown"}`,
  );

  const result = {
    network: "ckb_testnet",
    checkedAt: new Date().toISOString(),
    productionPetType: normalType.toHex(),
    shadowPetType: shadowType.toHex(),
    sharedElfDataHash: typeElfHash,
    oldClock: {
      number: oldClock.number.toString(),
      hash: oldClock.hash,
      timestamp: oldClock.timestamp.toString(),
    },
    attackClock: {
      number: attackClock.number.toString(),
      hash: attackClock.hash,
      timestamp: attackClock.timestamp.toString(),
    },
    burnPerPet: burn.toString(),
    sharedFee: SHARED_FEE.toString(),
    normalPet: {
      outPoint: `${normal.outPoint.txHash}#${normal.outPoint.index}`,
      txHash: normal.outPoint.txHash,
    },
    shadowPet: {
      outPoint: `${shadow.outPoint.txHash}#${shadow.outPoint.index}`,
      txHash: shadow.outPoint.txHash,
    },
    controls: {
      normalOnlyCycles: normalCycles.toString(),
      shadowOnlyCycles: shadowCycles.toString(),
    },
    combinedDryRun: {
      broadcast: false,
      rejected: true,
      errorCode: rejection.errorCode,
      source: rejection.source ?? null,
      message: rejection.message,
    },
  };
  writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2) + "\n");
  console.log("wrote", RESULT_FILE);
}

await main();
