import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
for(const txHash of process.argv.slice(2)) {
 const r=await c.getTransaction(txHash);
 if(!r) continue;
 for(const [i,w] of r.transaction.witnesses.entries()) {
  console.log(txHash.slice(0,10),'w',i,'len',(w.length-2)/2,'raw',w.slice(0,80));
  try { const wa=ccc.WitnessArgs.fromBytes(w); console.log('  decoded',JSON.stringify({lock:wa.lock?.slice(0,50),inputType:wa.inputType,outputType:wa.outputType})); } catch(e){console.log('  decode err',String(e).slice(0,150));}
 }
}
