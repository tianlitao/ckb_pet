import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0x151a256cbbb8bf69810e43c19d49c351d3f64097aa162d49d09709403c59c2d9');
const cell=await c.getCell({txHash:'0x151a256cbbb8bf69810e43c19d49c351d3f64097aa162d49d09709403c59c2d9',index:0});
console.log('cap',String(cell.cellOutput.capacity),'occupied',cell.occupiedSize,'free',String(cell.capacityFree));
console.log('lock',cell.cellOutput.lock.toHex());console.log('type',cell.cellOutput.type.toHex());console.log('data len',(cell.outputData.length-2)/2);
