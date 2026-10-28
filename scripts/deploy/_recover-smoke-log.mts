/**
 * Read-only helper: recover the full tx hashes from the latest completed smoke
 * run by following the deployer's committed transaction history. It never
 * broadcasts anything.
 */
import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";

const client = new ccc.ClientPublicTestnet({
  url: "https://testnet.ckb.dev/",
  fallbacks: ["https://testnet.ckbapp.dev/"],
});
const { privateKey } = JSON.parse(
  readFileSync("deployment/deploy-key.json", "utf8"),
);
const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
const lock = (await signer.getAddressObjs())[0].script;

const txs = [];
for await (const record of client.findTransactionsByLock(
  lock,
  null,
  false,
  "desc",
  20,
)) {
  txs.push(record);
  if (txs.length >= 90) break;
}
for (const tx of txs) {
  console.log(
    tx.txHash,
    "block=" + (tx.blockNumber?.toString() ?? "?"),
    "in=" + tx.isInput,
    "cellIndex=" + tx.cellIndex,
  );
}
