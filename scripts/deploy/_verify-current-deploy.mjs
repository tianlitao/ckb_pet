import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname;
const deployment = JSON.parse(
  readFileSync(ROOT + "deployment/deployment.json", "utf8"),
);
const client = new ccc.ClientPublicTestnet({
  url: "https://testnet.ckb.dev/",
  fallbacks: ["https://testnet.ckbapp.dev/"],
});

const expected = {
  "pet-type": {
    txHash: deployment.petType.txHash,
    index: deployment.petType.index,
    bytes: readFileSync(
      ROOT + "contracts/target/riscv64imac-unknown-none-elf/release/pet-type",
    ),
  },
  "pet-lock": {
    txHash: deployment.petLock.txHash,
    index: deployment.petLock.index,
    bytes: readFileSync(
      ROOT + "contracts/target/riscv64imac-unknown-none-elf/release/pet-lock",
    ),
  },
};

let failed = false;
for (const [name, expectedCell] of Object.entries(expected)) {
  const outPoint = ccc.OutPoint.from({
    txHash: expectedCell.txHash,
    index: expectedCell.index,
  });
  const live = await client.getCellLive(outPoint, true);
  if (!live) {
    console.error(`${name}: NOT LIVE at ${expectedCell.txHash}#${expectedCell.index}`);
    failed = true;
    continue;
  }
  const onChain = Buffer.from(live.outputData.slice(2), "hex");
  const same = onChain.equals(expectedCell.bytes);
  const dataHash = ccc.hashCkb(live.outputData);
  const recorded =
    name === "pet-type" ? deployment.petType.codeHash : deployment.petLock.codeHash;
  const scriptHash = ccc.hashCkb(live.cellOutput.type.toHex());
  console.log(
    [
      name,
      `live=yes`,
      `outpoint=${expectedCell.txHash}#${expectedCell.index}`,
      `dataBytes=${onChain.length}`,
      `byteEqual=${same}`,
      `dataHash=${dataHash}`,
      `typeWrapperHash=${scriptHash}`,
      `recorded=${recorded}`,
      `wrapperMatch=${scriptHash === recorded}`,
    ].join(" "),
  );
  if (!same || scriptHash !== recorded || onChain.length !== expectedCell.bytes.length) {
    failed = true;
  }
}

if (deployment.network !== "ckb_testnet") {
  console.error(`unexpected network: ${deployment.network}`);
  failed = true;
}
if (failed) process.exit(1);
console.log("CURRENT DEPLOYMENT VERIFIED");
