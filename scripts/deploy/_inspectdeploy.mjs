import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0xaa05c89b6dc80ac320ff449d298c3aa24f891f4eedeb5aad0e90435a7b5e8ad5');
console.log('status',r.status,'block',String(r.blockNumber),'inputs',r.transaction.inputs.length,'outputs',r.transaction.outputs.length);
for(const [i,o] of r.transaction.outputs.entries()) console.log(i,'cap',String(o.capacity),'lock',o.lock.codeHash,o.lock.hashType,o.lock.args.slice(0,20),'type',o.type?.codeHash,o.type?.args,'data', (r.transaction.outputsData[i].length-2)/2);
console.log('inputs',r.transaction.inputs.map(x=>x.previousOutput.txHash+'#'+x.previousOutput.index));
console.log('deps',r.transaction.cellDeps.map(x=>x.outPoint.txHash+'#'+x.outPoint.index+':'+x.depType));
