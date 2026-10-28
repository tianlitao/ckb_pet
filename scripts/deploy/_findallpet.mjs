import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const t=await c.getTipHeader();
const keys=[
 {script:{codeHash:'0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac',hashType:'type',args:t.timestamp.toString(16)},scriptType:'type',scriptSearchMode:'prefix'},
];
let n=0;try{for await(const x of c.findTransactions(keys[0],'desc',10)){console.log(x.txHash,x.blockNumber);if(++n>10)break;}}catch(e){console.log(String(e).slice(0,300));}
