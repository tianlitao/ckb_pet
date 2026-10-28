import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const k=JSON.parse(readFileSync('deployment/deploy-key.json','utf8')).privateKey;const s=new ccc.SignerCkbPrivateKey(c,k);const lock=(await s.getAddressObjs())[0].script;
const prevs=[
 {txHash:'0x47ce24df2b087f25de575e4e7dfedc2f00fbbc340c0b9bd5fbc517d582549cef',index:1},
 {txHash:'0x028ec84950a3d54256db1d2b63b700d72d7f1951a9db3748199e786e0da3d2c5',index:0},
];
for(const prev of prevs){const cell=await c.getCell(prev);console.log('prev',prev.txHash.slice(0,10),'cap',String(cell.cellOutput.capacity));for(const fee of [100000000n,21000000n,1n]){const tx=ccc.Transaction.default();tx.inputs=[ccc.CellInput.from({previousOutput:prev})];tx.outputs=[ccc.CellOutput.from({lock,capacity:cell.cellOutput.capacity-fee})];tx.outputsData=['0x'];try{const signed=await s.signTransaction(tx);const cyc=await c.sendTransactionDry(signed);console.log(' fee',String(fee),'ACCEPT',String(cyc));}catch(e){console.log(' fee',String(fee),'ERR',String(e?.message??e).slice(0,500));}}}
