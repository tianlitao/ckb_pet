import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
for (const txHash of process.argv.slice(2)) {
 const r=await c.getTransaction(txHash);
 if(!r) { console.log(txHash,'not found'); continue; }
 console.log('\nTX',txHash,'status',r.status,'block',r.blockNumber,'inputs',r.transaction.inputs.length,'outputs',r.transaction.outputs.length,'witnesses',r.transaction.witnesses.length);
 console.log('witnesses',r.transaction.witnesses.map(w=>w.slice(0,80)));
 console.log('cellDeps',r.transaction.cellDeps.map(d=>d.outPoint.txHash.slice(0,10)+'#'+d.outPoint.index+':'+d.depType));
 for (const [i,o] of r.transaction.outputs.entries()) console.log('out',i,'cap',String(o.capacity),'lock',o.lock.codeHash.slice(0,10),o.lock.hashType,'type',o.type?.codeHash.slice(0,10),o.type?.hashType,'data',r.transaction.outputsData[i].slice(0,40),r.transaction.outputsData[i].length);
}
