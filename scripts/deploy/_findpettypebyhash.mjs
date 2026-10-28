import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const hashes=['0x70ac57b089807dbd65f596f9c0629d229d95c9092d71b2b249ebc92cd61e86e1','0x2a0da40590c1f197d0a9a93b1a96f721743b5c99980ec1b1192cf360c282b711','0xdc3bc32c5f08cf22bcb8dee318103f2816ddcb52887d5b0ac5fb6908e8c839b8','0x3a55abe29655c91faf617fea6f20313eadb63495145c0250fefdcfbdf3518701'];
for(const h of hashes){
 let n=0;console.log('---',h);
 try{for await(const x of c.findTransactions({script:{codeHash:h,hashType:'data1',args:'0x'},scriptType:'type',scriptSearchMode:'prefix'},'desc',5)){console.log(x.txHash,x.blockNumber?.toString(),x.cellIndex,x.isInput);if(++n>=5)break;}}catch(e){console.log('err',String(e?.message??e).slice(0,200));}
}
