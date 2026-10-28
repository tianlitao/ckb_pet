import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: ["https://testnet.ckbapp.dev/"] });
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
const lock = (await signer.getAddressObjs())[0].script;
// secp depGroup covers the 1MB data cell (0x8f8c79eb#3) whose data hash = 0x3a55abe2...
const tx = ccc.Transaction.default();
tx.cellDeps = [ccc.CellDep.from({
  outPoint: ccc.OutPoint.from({ txHash: "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37", index: 0 }),
  depType: "depGroup",
})];
tx.outputs = [ccc.CellOutput.from({
  lock,
  type: ccc.Script.from({ codeHash: "0x3a55abe29655c91faf617fea6f20313eadb63495145c0250fefdcfbdf3518701", hashType: "data1", args: "0x" }),
  capacity: 300n * 100_000_000n,
})];
tx.outputsData = ["0x" + "ab".repeat(40)];
await tx.completeInputsByCapacity(signer);
await tx.completeFeeBy(signer);
const signed = await signer.signTransaction(tx);
try {
  const h = await c.sendTransaction(signed);
  console.log("UNEXPECTEDLY SENT:", h);
} catch (e: any) {
  console.log("RESULT:", String(e?.message ?? e).slice(0, 250));
}
