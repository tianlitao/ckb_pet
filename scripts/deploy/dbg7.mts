import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: ["https://testnet.ckbapp.dev/"] });
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
const lock = (await signer.getAddressObjs())[0].script;
for await (const cell of c.findCellsByLock(lock)) {
  console.log(
    cell.outPoint.txHash.slice(0, 14) + "#" + cell.outPoint.index,
    "cap:", (Number(cell.cellOutput.capacity) / 1e8).toFixed(2),
    "data:", (cell.outputData.length - 2) / 2, "bytes",
    "type:", cell.cellOutput.type ? cell.cellOutput.type.codeHash.slice(0, 10) : "-",
  );
}
console.log("balance:", Number(await signer.getBalance()) / 1e8);
