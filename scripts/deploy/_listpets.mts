import { ccc } from "@ckb-ccc/ccc";
import { petTypeScript } from "../../web/src/lib/ops.ts";

const client = new ccc.ClientPublicTestnet({
  url: "https://testnet.ckb.dev/",
  fallbacks: ["https://testnet.ckbapp.dev/"],
});
const type = petTypeScript();
console.log("pet type:", type.toHex());
let count = 0;
for await (const cell of client.findCellsByType(type, true, "desc", 10)) {
  console.log(
    cell.outPoint.txHash,
    "#" + cell.outPoint.index,
    "cap=" + Number(cell.cellOutput.capacity) / 1e8,
    "data=" + (cell.outputData.length - 2) / 2,
  );
  if (++count >= 100) break;
}
console.log("live pet cells:", count);
