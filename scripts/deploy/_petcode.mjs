import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const dep=await c.getCell({txHash:'0xaa05c89b6dc80ac320ff449d298c3aa24f891f4eedeb5aad0e90435a7b5e8ad5',index:0});
console.log('codehash',ccc.hashCkb(dep.outputData),'len',(dep.outputData.length-2)/2);
console.log('typeargs',dep.cellOutput.type.args);
