import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c = new ccc.ClientPublicTestnet({ url: 'https://testnet.ckb.dev/', fallbacks: ['https://testnet.ckbapp.dev/'] });
const k=JSON.parse(readFileSync('deployment/deploy-key.json','utf8'));
const s=new ccc.SignerCkbPrivateKey(c,k.privateKey);
const lock=(await s.getAddressObjs())[0].script;
const tx=ccc.Transaction.default();
tx.outputs=[ccc.CellOutput.from({lock,capacity:300n*100000000n})];
tx.outputsData=['0x'];
await tx.completeInputsByCapacity(s,150n*100000000n);
await tx.completeFeeBy(s);
const signed=await s.signTransaction(tx);
for (const [name,url] of [['dev','https://testnet.ckb.dev/'],['app','https://testnet.ckbapp.dev/']]) {
  const c2=new ccc.ClientPublicTestnet({url});
  try { const cycles=await c2.sendTransactionDry(signed); console.log(name,'ACCEPT',String(cycles)); } catch(e){ console.log(name,'REJECT',String(e?.message??e).slice(0,300)); }
}
