import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
for(const txHash of process.argv.slice(2)){
 const r=await c.getTransaction(txHash);
 console.log(txHash,'status',r?.status,'block',String(r?.blockNumber));
 if(r) for(const [i,o] of r.transaction.outputs.slice(0,2).entries()) console.log(i,'code',o.type?.codeHash,'args',o.type?.args);
}
