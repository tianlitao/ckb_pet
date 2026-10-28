import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const k=JSON.parse(readFileSync('deployment/deploy-key.json','utf8')).privateKey;const s=new ccc.SignerCkbPrivateKey(c,k);const lock=(await s.getAddressObjs())[0].script;
const tx=ccc.Transaction.default();tx.outputs=[ccc.CellOutput.from({lock,capacity:300n*100000000n})];tx.outputsData=['0x'];
await tx.completeInputsByCapacity(s,150n*100000000n);
const [added,hasChange]=await tx.completeFeeBy(s,100000n);
console.log('added',added,'hasChange',hasChange,'w',tx.witnesses,'fee',String(await tx.getFee(c)),'size',tx.toBytes().length,'outs',tx.outputs.map(o=>String(o.capacity)));
const signed=await s.signTransaction(tx);console.log('signed fee',String(await signed.getFee(c)),'siglen',(signed.witnesses[0].length-2)/2);
