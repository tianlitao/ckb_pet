import { ccc } from "@ckb-ccc/ccc";
import { loadDeployment } from "../../web/src/config.ts";
import { petTypeScript } from "../../web/src/lib/ops.ts";
const dep = loadDeployment();
console.log("petType dep:", dep.petType.txHash, "#", dep.petType.index);
console.log("type script args:", petTypeScript(dep).args.slice(0, 14));
const c = new ccc.ClientPublicTestnet({ url: "https://testnet.ckb.dev/", fallbacks: ["https://testnet.ckbapp.dev/"] });
const live = await c.getCellLive(ccc.OutPoint.from({ txHash: dep.petType.txHash, index: dep.petType.index }));
console.log("live:", !!live, "dataLen:", live ? (live.outputData.length - 2) / 2 : 0);
const { blake2b } = await import("@noble/hashes/blake2.js");
if (live) {
  const h = "0x" + Buffer.from(blake2b(Buffer.from(live.outputData.slice(2), "hex"), { dkLen: 32 })).toString("hex");
  console.log("dep data hash:", h);
}
