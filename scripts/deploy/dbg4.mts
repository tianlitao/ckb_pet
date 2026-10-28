import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";
import { loadDeployment } from "../../web/src/config.ts";
const dep = loadDeployment();
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: ["https://testnet.ckbapp.dev/"] });
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
const lock = (await signer.getAddressObjs())[0].script;
const tx = ccc.Transaction.default();
// single minimal dep: only the pet-type cell
tx.cellDeps = [ccc.CellDep.from({ outPoint: ccc.OutPoint.from({ txHash: dep.petType.txHash, index: dep.petType.index }), depType: "code" })];
tx.outputs = [ccc.CellOutput.from({
  lock,
  type: ccc.Script.from({ codeHash: "0xdc3bc32c5f08cf22bcb8dee318103f2816ddcb52887d5b0ac5fb6908e8c839b8", hashType: "data", args: dep.treasuryLockHash }),
  capacity: 300n * 100_000_000n,
})];
tx.outputsData = ["0x" + "ab".repeat(60)];
await tx.completeInputsByCapacity(signer);
await tx.completeFeeBy(signer);
const signed = await signer.signTransaction(tx);
console.log("deps:", signed.cellDeps.map((d) => d.outPoint.txHash.slice(0, 10) + "#" + d.outPoint.index).join(","));
console.log("type hashType:", tx.outputs[0].type?.hashType);
try {
  const h = await c.sendTransaction(signed);
  console.log("MINIMAL ADOPT SENT:", h);
} catch (e: any) {
  console.log("REJECTED:", String(e?.message ?? e).slice(0, 240));
}
