import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";
import { blake2b } from "@noble/hashes/blake2.js";
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: ["https://testnet.ckbapp.dev/"] });
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
const lock = (await signer.getAddressObjs())[0].script;
const elf = readFileSync("contracts/target/riscv64imac-unknown-none-elf/release/always-success");
console.log("balance check");
const codeHash = "0x" + Buffer.from(blake2b(elf, { dkLen: 32 })).toString("hex");
console.log("always-success code hash:", codeHash.slice(0, 18), "len:", elf.length);

// tx1: deploy the cell (locked by myself is fine for this test)
const t1 = ccc.Transaction.default();
const occ = BigInt(8 + elf.length + 33 + 20) * 100_000_000n;
t1.outputs = [ccc.CellOutput.from({ lock, capacity: occ })];
t1.outputsData = ["0x" + elf.toString("hex")];
await t1.completeInputsByCapacity(signer);
await t1.completeFeeBy(signer);
const h1 = await signer.sendTransaction(t1);
console.log("deploy tx:", h1);
const conf = await c.waitTransaction(h1, 1, 120_000, 3_000);
console.log("confirmed:", !!conf);

// tx2: invoke it as a type script
const t2 = ccc.Transaction.default();
t2.cellDeps = [ccc.CellDep.from({ outPoint: ccc.OutPoint.from({ txHash: h1, index: 0 }), depType: "code" })];
t2.outputs = [ccc.CellOutput.from({
  lock,
  type: ccc.Script.from({ codeHash, hashType: "data1", args: "0x" }),
  capacity: 200n * 100_000_000n,
})];
t2.outputsData = ["0x" + "cd".repeat(40)];
await t2.completeInputsByCapacity(signer);
await t2.completeFeeBy(signer);
const signed = await signer.signTransaction(t2);
try {
  const h = await c.sendTransaction(signed);
  console.log("ALWAYS-SUCCESS INVOCATION SENT:", h);
} catch (e: any) {
  console.log("REJECTED:", String(e?.message ?? e).slice(0, 240));
}
