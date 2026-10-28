/**
 * Step 2 (v4): deploy pet-type, optionally pet-lock, with
 *   - lock  = one-time vault key (burned after signing — script cells must
 *     never look like spendable balance, see 2b-vault lesson)
 *   - type  = genesis TYPE_ID script (RFC 0032), args = hashTypeId(input0, idx)
 * References then use hash_type "type" + the type-script hash — the ecosystem
 * standard (plain data1 lookups proved unreliable on these nodes).
 *   DRY_RUN=1 node scripts/deploy/2-deploy.mjs
 *   node scripts/deploy/2-deploy.mjs
 *   REUSE_PET_LOCK=1 DRY_RUN=1 node scripts/deploy/2-deploy.mjs
 *   REUSE_PET_LOCK=1 node scripts/deploy/2-deploy.mjs
 */
import { ccc } from "@ckb-ccc/ccc";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ROOT = new URL("../..", import.meta.url).pathname;
const KEYFILE = ROOT + "deployment/deploy-key.json";
const ELF_DIR = ROOT + "contracts/target/riscv64imac-unknown-none-elf/release/";

// genesis TYPE_ID code cell (testnet)
const TYPE_ID_CODE_HASH = "0x00000000000000000000000000000000000000000000000000545950455f4944";
const TYPE_ID_DEP = "0xec18bf0d857c981c3d1f4e17999b9b90c484b303378e94de1a57b0872f5d4602";

const client = () =>
  new ccc.ClientPublicTestnet({
    url: "https://testnet.ckb.dev/",
    fallbacks: ["https://testnet.ckbapp.dev/"],
  });

const ckbHash = (bytes) => {
  const hasher = new ccc.HasherCkb();
  hasher.update(bytes);
  return ccc.hexFrom(hasher.digest());
};

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const reusePetLock = process.env.REUSE_PET_LOCK === "1";
  const { privateKey } = JSON.parse(readFileSync(KEYFILE, "utf8"));
  const c = client();
  const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
  const address = await signer.getRecommendedAddress();
  const bal = await signer.getBalance();
  console.log("deployer:", address, "| balance:", Number(bal) / 1e8, "CKB");

  // vault key: signs nothing after this tx, key is discarded
  const vault = new ccc.SignerCkbPrivateKey(c, "0x" + randomBytes(32).toString("hex"));
  const vaultLock = (await vault.getAddressObjs())[0].script;

  const petTypeElf = readFileSync(ELF_DIR + "pet-type");
  const petLockElf = reusePetLock ? null : readFileSync(ELF_DIR + "pet-lock");

  const expected = JSON.parse(readFileSync(ROOT + "deployment/code_hashes.json", "utf8"));
  const actualPetTypeHash = ckbHash(petTypeElf);
  const actualPetLockHash = petLockElf ? ckbHash(petLockElf) : null;
  if (
    actualPetTypeHash !== expected["pet-type"] ||
    (!reusePetLock && actualPetLockHash !== expected["pet-lock"])
  ) {
    throw new Error(
      `ELF hash mismatch; run python3 scripts/hash_elfs.py\n` +
        `pet-type expected ${expected["pet-type"]}, got ${actualPetTypeHash}\n` +
        `pet-lock expected ${expected["pet-lock"]}, got ${actualPetLockHash ?? "(reused)"}`,
    );
  }

  // Keep the previous live deployment as an immutable audit record instead of
  // silently overwriting it. No Git exists in this workspace.
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(ROOT + "deployment/deployment.json", "utf8"));
  } catch {
    // first deployment
  }
  if (reusePetLock && !previous?.petLock?.txHash) {
    throw new Error("REUSE_PET_LOCK=1 requires a previous deployment with petLock");
  }
  if (reusePetLock && actualPetLockHash !== null) {
    throw new Error("REUSE_PET_LOCK must not carry a new pet-lock ELF");
  }
  if (reusePetLock && ckbHash(readFileSync(ELF_DIR + "pet-lock")) !== expected["pet-lock"]) {
    throw new Error("current pet-lock ELF does not match code_hashes.json");
  }
  if (!dryRun && previous?.deployTx) {
    const historyDir = ROOT + "deployment/history";
    mkdirSync(historyDir, { recursive: true });
    const stamp = previous.deployedAt.replace(/[:.]/g, "-");
    writeFileSync(
      `${historyDir}/${stamp}-${previous.deployTx.slice(0, 12)}.json`,
      JSON.stringify(previous, null, 2),
    );
  }

  const outputs = [ccc.CellOutput.from({ lock: vaultLock, capacity: 0n })];
  const outputsData = ["0x" + petTypeElf.toString("hex")];
  if (petLockElf) {
    outputs.push(ccc.CellOutput.from({ lock: vaultLock, capacity: 0n }));
    outputsData.push("0x" + petLockElf.toString("hex"));
  }
  // final capacities first (type args don't change the size), so the
  // input collector sees the real requirement
  const occ = (dataLen, typeArgsLen) =>
    BigInt(8 + dataLen + 33 + 20 + 33 + typeArgsLen) * 100_000_000n;
  outputs[0].capacity = occ(petTypeElf.length, 32);
  if (petLockElf) outputs[1].capacity = occ(petLockElf.length, 32);

  const tx = ccc.Transaction.default();
  tx.cellDeps = [
    ccc.CellDep.from({
      outPoint: ccc.OutPoint.from({ txHash: TYPE_ID_DEP, index: 0 }),
      depType: "code",
    }),
  ];
  tx.outputs = outputs;
  tx.outputsData = outputsData;
  const minimumOutputCapacity = outputs.reduce((sum, out) => sum + out.capacity, 0n);
  if (bal < minimumOutputCapacity) {
    throw new Error(
      `preflight failed before broadcast: need at least ` +
        `${Number(minimumOutputCapacity) / 1e8} CKB for script cells; ` +
        `balance is ${Number(bal) / 1e8} CKB`,
    );
  }
  await tx.completeInputsByCapacity(signer);

  // RFC 0032: type_id = blake2b256(first_input.out_point ++ output_index ++ 0u64)
  for (const [i, out] of tx.outputs.entries()) {
    const args = await ccc.hashTypeId(tx.inputs[0], i);
    out.type = ccc.Script.from({ codeHash: TYPE_ID_CODE_HASH, hashType: "type", args });
  }

  // Pin change to the deployer lock so output[0] remains the pet-type cell
  // and, in full mode, output[1] remains the pet-lock cell.
  await tx.completeFeeChangeToLock(signer, await signer.getAddressObjs().then((a) => a[0].script));
  const fee = await tx.getFee(c);
  const signedTx = await signer.signTransaction(tx);
  console.log("deployment dry-run summary:");
  console.log("  inputs:", tx.inputs.length);
  console.log("  outputs:", tx.outputs.length);
  console.log("  output capacity:", Number(tx.getOutputsCapacity()) / 1e8, "CKB");
  console.log("  fee:", Number(fee) / 1e8, "CKB");
  console.log("  pet-type ELF:", petTypeElf.length, "bytes");
  console.log(
    "  pet-lock ELF:",
    petLockElf ? `${petLockElf.length} bytes` : "REUSED from previous deployment",
  );
  console.log("  pet-type data hash:", actualPetTypeHash);
  console.log("  pet-lock data hash:", actualPetLockHash ?? "(reused)");

  if (dryRun) {
    const dryCycles = await c.sendTransactionDry(signedTx);
    console.log("  test_tx_pool_accept cycles:", dryCycles.toString());
    console.log("DRY_RUN=1: not broadcast");
    return;
  }

  const txHash = await signer.sendTransaction(signedTx);
  console.log("deploy tx:", txHash);
  const confirmed = await c.waitTransaction(txHash, 1, 180_000, 3_000);
  if (!confirmed) throw new Error("deploy tx not confirmed in time");
  console.log("confirmed at block", confirmed.blockNumber?.toString());

  // Read the script cells back from the committed transaction. The fee-change
  // output is appended by completeFeeChangeToLock, so positional assumptions
  // about tx.outputs[1] are unsafe in REUSE_PET_LOCK mode.
  const confirmedTx = await c.getTransaction(txHash);
  if (confirmedTx?.status !== "committed") {
    throw new Error(`deploy tx ${txHash} is ${confirmedTx?.status}, not committed`);
  }
  const petTypeOutput = confirmedTx.transaction.outputs[0];
  if (!petTypeOutput?.type) {
    throw new Error("committed deploy is missing pet-type TYPE_ID script");
  }
  const petTypeScript = ccc.Script.from({
    codeHash: TYPE_ID_CODE_HASH,
    hashType: "type",
    args: petTypeOutput.type.args,
  });
  const petTypeCodeHash = ccc.hashCkb(petTypeScript.toHex());
  let petLockScript = null;
  if (!reusePetLock) {
    const petLockOutput = confirmedTx.transaction.outputs[1];
    if (!petLockOutput?.type) {
      throw new Error("committed deploy is missing pet-lock TYPE_ID script");
    }
    petLockScript = ccc.Script.from({
      codeHash: TYPE_ID_CODE_HASH,
      hashType: "type",
      args: petLockOutput.type.args,
    });
  }
  const info = {
    network: "ckb_testnet",
    deployedAt: new Date().toISOString(),
    deployTx: txHash,
    petTypeArgs: "RFC-0032 TYPE_ID args",
    petType: {
      codeHash: petTypeCodeHash,
      hashType: "type",
      txHash,
      index: 0,
      dataBytes: petTypeElf.length,
    },
    petLock: {
      codeHash: reusePetLock ? previous.petLock.codeHash : ccc.hashCkb(petLockScript.toHex()),
      hashType: reusePetLock ? previous.petLock.hashType : "type",
      txHash: reusePetLock ? previous.petLock.txHash : txHash,
      index: reusePetLock ? previous.petLock.index : 1,
      dataBytes: reusePetLock ? previous.petLock.dataBytes : petLockElf.length,
    },
    note: "script cells are vault-locked (key burned); references use hash_type type",
  };
  writeFileSync(ROOT + "deployment/deployment.json", JSON.stringify(info, null, 2));
  const ts = `// AUTO-GENERATED by scripts/deploy/2-deploy.mjs — do not edit.
export const DEPLOYMENT = ${JSON.stringify(info, null, 2)} as const;
`;
  writeFileSync(ROOT + "web/src/generated/deployment.ts", ts);
  console.log("pet-type script hash:", info.petType.codeHash);
  console.log("pet-lock script hash:", info.petLock.codeHash);
  console.log("wrote deployment/deployment.json + web/src/generated/deployment.ts");
}

try {
  await main();
} catch (e) {
  console.error(String(e?.message ?? e));
  process.exit(1);
}
