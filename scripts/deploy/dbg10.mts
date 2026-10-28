import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";
import { loadDeployment } from "../../web/src/config.ts";
const dep = loadDeployment();
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: ["https://testnet.ckbapp.dev/"] });
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
const lock = (await signer.getAddressObjs())[0].script;

// molecule OutPointVec (fixed-size items): [total u32][item0 36B][item1 36B]
function outPointVec(ops: { txHash: string; index: number }[]): string {
  const items = ops.map((op) => Buffer.concat([
    Buffer.from(op.txHash.slice(2), "hex"),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(op.index); return b; })(),
  ]));
  // molecule fixed-item vector: the header u32 is the ITEM COUNT
  const count = Buffer.alloc(4);
  count.writeUInt32LE(items.length);
  return "0x" + Buffer.concat([count, ...items]).toString("hex");
}

// tx1: create the dep-group cell
const groupData = outPointVec([
  { txHash: dep.petType.txHash, index: dep.petType.index },
  { txHash: dep.petLock.txHash, index: dep.petLock.index },
]);
console.log("group data:", groupData.slice(0, 30), "len", (groupData.length - 2) / 2);
const t1 = ccc.Transaction.default();
const cap = BigInt(8 + (groupData.length - 2) / 2 + 33 + 20) * 100_000_000n;
t1.outputs = [ccc.CellOutput.from({ lock, capacity: cap })];
t1.outputsData = [groupData];
await t1.completeInputsByCapacity(signer);
await t1.completeFeeBy(signer);
const h1 = await signer.sendTransaction(t1);
console.log("dep-group cell tx:", h1);
const conf = await c.waitTransaction(h1, 1, 120_000, 3_000);
if (!conf) throw new Error("not confirmed");

// tx2: minimal adopt depending ONLY on the dep group
const t2 = ccc.Transaction.default();
t2.cellDeps = [ccc.CellDep.from({ outPoint: ccc.OutPoint.from({ txHash: h1, index: 0 }), depType: "depGroup" })];
t2.outputs = [ccc.CellOutput.from({
  lock,
  type: ccc.Script.from({ codeHash: "0xdc3bc32c5f08cf22bcb8dee318103f2816ddcb52887d5b0ac5fb6908e8c839b8", hashType: "data1", args: dep.treasuryLockHash }),
  capacity: 300n * 100_000_000n,
})];
t2.outputsData = ["0x" + "ab".repeat(60)];
await t2.completeInputsByCapacity(signer);
await t2.completeFeeBy(signer);
const signed = await signer.signTransaction(t2);
try {
  const h = await c.sendTransaction(signed);
  console.log("DEPGROUP ADOPT SENT:", h);
} catch (e: any) {
  console.log("REJECTED:", String(e?.message ?? e).slice(0, 240));
}
