import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/',fallbacks:['https://testnet.ckbapp.dev/']});
const {privateKey}=JSON.parse(readFileSync('deployment/deploy-key.json','utf8'));
const s=new ccc.SignerCkbPrivateKey(c,privateKey);
const lock=(await s.getAddressObjs())[0].script;
const tx=ccc.Transaction.default();
tx.outputs=[ccc.CellOutput.from({lock,capacity:300n*100000000n})];
tx.outputsData=['0x'];
await tx.completeInputsByCapacity(s,150n*100000000n);
await tx.completeFeeBy(s);
const signed=await s.signTransaction(tx);
let n=0;
for(const d of signed.cellDeps){const x=await c.getCellLive(d.outPoint); console.log('dep',d.outPoint.txHash.slice(0,10),d.outPoint.index,'live',!!x); n++}
console.log('deps',n,'witnesses',signed.witnesses.length,'size',signed.toBytes().length);
try{const cyc=await c.sendTransactionDry(signed);console.log('ACCEPT',String(cyc));}catch(e){console.log('REJECT',String(e?.message??e).slice(0,1000));}
