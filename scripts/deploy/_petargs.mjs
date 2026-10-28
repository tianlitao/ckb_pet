import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const cell=await c.getCell({txHash:'0x151a256cbbb8bf69810e43c19d49c351d3f64097aa162d49d09709403c59c2d9',index:0});
console.log('occupied',cell.occupiedSize,'capfree',String(cell.capacityFree));
console.log('lock args',cell.cellOutput.lock.args);
console.log('type args',cell.cellOutput.type.args);
console.log('hash lock',ccc.hashCkb(cell.cellOutput.lock.toHex()));
