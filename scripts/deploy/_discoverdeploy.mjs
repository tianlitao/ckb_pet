import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const out=await c.findTransactions({script:{codeHash:'0x3b521cc4b552f109d092d8cc468a8048acb53c5952dbe769d2b2f9cf6e47f7f1',hashType:'data1',args:'0x'},scriptType:'type',scriptSearchMode:'prefix'},'desc',50);
let n=0;for await(const x of out){console.log(x.txHash,x.blockNumber?.toString(),x.cellIndex,x.isInput);if(++n>20)break;}
