import { ccc } from "@ckb-ccc/ccc";
import { readFileSync, writeFileSync } from "node:fs";
import { loadDeployment } from "../../web/src/config.ts";
const dep = loadDeployment();
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/" });
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
const lock = (await signer.getAddressObjs())[0].script;
const tx = ccc.Transaction.default();
tx.cellDeps = [ccc.CellDep.from({ outPoint: ccc.OutPoint.from({ txHash: dep.petType.txHash, index: dep.petType.index }), depType: "code" })];
tx.outputs = [ccc.CellOutput.from({
  lock,
  type: ccc.Script.from({ codeHash: "0xdc3bc32c5f08cf22bcb8dee318103f2816ddcb52887d5b0ac5fb6908e8c839b8", hashType: "data1", args: dep.treasuryLockHash }),
  capacity: 300n * 100_000_000n,
})];
tx.outputsData = ["0x" + "ab".repeat(60)];
await tx.completeInputsByCapacity(signer);
await tx.completeFeeBy(signer);
const signed = await signer.signTransaction(tx);
const view = ccc.Transaction.from(signed);
// hand-build the RPC JSON from the packed entities
const j = (e: any) => (typeof e === "string" ? e : typeof e?.toHex === "function" ? e.toHex() : String(e));
const json = {
  version: "0x" + Number(view.version).toString(16),
  cell_deps: view.cellDeps.map((d) => ({ dep_type: d.depType, out_point: { tx_hash: j(d.outPoint.txHash), index: j(d.outPoint.index) } })),
  header_deps: view.headerDeps.map((h) => j(h)),
  inputs: view.inputs.map((i) => ({ previous_output: { tx_hash: j(i.previousOutput.txHash), index: j(i.previousOutput.index) }, since: j(i.since) })),
  outputs: view.outputs.map((o) => ({ capacity: j(o.capacity), lock: { code_hash: j(o.lock.codeHash), hash_type: o.lock.hashType, args: j(o.lock.args) }, type: o.type ? { code_hash: j(o.type.codeHash), hash_type: o.type.hashType, args: j(o.type.args) } : null })),
  outputs_data: view.outputsData.map((d) => j(d)),
  witnesses: view.witnesses.map((w) => j(w)),
};
writeFileSync("/tmp/minimal-tx.json", JSON.stringify({ id: 1, jsonrpc: "2.0", method: "test_tx_pool_accept", params: [json, "0x0"] }, null, 1));
console.log("wrote /tmp/minimal-tx.json");
console.log("cell_deps:", JSON.stringify(json.cell_deps));
console.log("out0.type:", JSON.stringify(json.outputs[0].type));
