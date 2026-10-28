import { ccc } from "@ckb-ccc/ccc";
import { readFileSync } from "node:fs";
import { loadDeployment } from "../../web/src/config.ts";

function petTypeOf(dep: any) {
  return {
    codeHash: "0xdc3bc32c5f08cf22bcb8dee318103f2816ddcb52887d5b0ac5fb6908e8c839b8",
    hashType: "data1",
    args: dep.treasuryLockHash,
  } as any;
}

const dep = loadDeployment();
const { privateKey } = JSON.parse(readFileSync("deployment/deploy-key.json", "utf8"));
for (const url of ["https://testnet.ckb.dev/", "https://testnet.ckbapp.dev/"]) {
  const c = new ccc.ClientPublicTestnet({ url });
  const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
  const lock = (await signer.getAddressObjs())[0].script;
  const tx = ccc.Transaction.default();
  tx.cellDeps = [
    ccc.CellDep.from({
      outPoint: ccc.OutPoint.from({ txHash: dep.petType.txHash, index: dep.petType.index }),
      depType: "code",
    }),
  ];
  tx.outputs = [
    ccc.CellOutput.from({ lock, type: petTypeOf(dep), capacity: 300n * 100_000_000n }),
  ];
  tx.outputsData = ["0x" + "ab".repeat(60)];
  await tx.completeInputsByCapacity(signer);
  const signed = await signer.signTransaction(tx);
  try {
    const cycles = await (c as any).sendTransactionDry(signed);
    console.log(url, "-> ACCEPTED, cycles:", String(cycles).slice(0, 20));
  } catch (e: any) {
    console.log(url, "->", String(e?.message ?? e).slice(0, 160));
  }
}
