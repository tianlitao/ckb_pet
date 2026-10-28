import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0x151a256cbbb8bf69810e43c19d49c351d3f64097aa162d49d09709403c59c2d9');
const dep=r.transaction.cellDeps[0].outPoint;
const depCell=await c.getCell(dep);
console.log('dep',dep.txHash,dep.index,'data len',(depCell.outputData.length-2)/2,'type',depCell.cellOutput.type?.toHex());
console.log('codehash',ccc.hashCkb(depCell.outputData));
