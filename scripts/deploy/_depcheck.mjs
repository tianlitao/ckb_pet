import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const key=JSON.parse(readFileSync('deployment/deploy-key.json','utf8')).privateKey;
const s=new ccc.SignerCkbPrivateKey(c,key);
const lock=(await s.getAddressObjs())[0].script;
for(const t of [undefined,{codeHash:'0x'+'00'.repeat(32),hashType:'data1',args:'0x'},{codeHash:'0x'+'00'.repeat(32),hashType:'type',args:'0x'}]){
 const tx=ccc.Transaction.default();tx.outputs=[ccc.CellOutput.from({lock,capacity:300n*100000000n,...(t?{type:t}:{})})];tx.outputsData=['0x'];
 await tx.completeInputsByCapacity(s,150n*100000000n);await tx.completeFeeBy(s);
 const signed=await s.signTransaction(tx);
 console.log('type',t?.hashType??'-','deps',signed.cellDeps.length,'witnesses',signed.witnesses.length);
 try{console.log(' dry',String(await c.sendTransactionDry(signed)));}catch(e){console.log(' err',String(e?.message??e).slice(0,250));}
}
