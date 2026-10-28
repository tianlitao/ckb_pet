import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0x47ce24df2b087f25de575e4e7dfedc2f00fbbc340c0b9bd5fbc517d582549cef');
for(const [i,inp] of r.transaction.inputs.entries()) {
 const cell=await c.getCell(inp.previousOutput);
 console.log('in',i,inp.previousOutput.txHash,inp.previousOutput.index,'live?',cell?'cell':'none');
}
console.log('headerDeps',r.transaction.headerDeps);
