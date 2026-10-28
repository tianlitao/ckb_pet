import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: ["https://testnet.ckbapp.dev/"] });
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
const lock = (await signer.getAddressObjs())[0].script;
const res = await (c as any).requestor.request("get_transactions", [
  { script: { code_hash: lock.codeHash, hash_type: lock.hashType, args: lock.args }, script_type: "lock", search_mode: "exact", group_by_transaction: true },
  "desc", "0x8", null,
]);
console.log(JSON.stringify(res.objects[0], null, 1).slice(0, 1200));
