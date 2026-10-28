import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const k=JSON.parse(readFileSync('deployment/deploy-key.json','utf8')).privateKey;const s=new ccc.SignerCkbPrivateKey(c,k);const lock=(await s.getAddressObjs())[0].script;
const tx=ccc.Transaction.default();tx.inputs=[ccc.CellInput.from({previousOutput:{txHash:'0x47ce24df2b087f25de575e4e7dfedc2f00fbbc340c0b9bd5fbc517d582549cef',index:1}})];tx.outputs=[ccc.CellOutput.from({lock,capacity:1178000000000n})];tx.outputsData=['0x'];
console.log('before',tx.witnesses);await tx.completeInputsByCapacity(s);console.log('after inputs',tx.witnesses);await tx.completeFeeBy(s);console.log('afterfee',tx.witnesses);const signed=await s.signTransaction(tx);console.log('signed',signed.witnesses);
try{console.log('dry',String(await c.sendTransactionDry(signed)));}catch(e){console.log('err',String(e?.message??e).slice(0,800));}
