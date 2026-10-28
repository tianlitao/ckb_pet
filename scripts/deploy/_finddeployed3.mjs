import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
for(const codeHash of ['0x70ac57b089807dbd65f596f9c0629d229d95c9092d71b2b249ebc92cd61e86e1','0x2a0da40590c1f197d0a9a93b1a96f721743b5c99980ec1b1192cf360c282b711']){
 console.log('---',codeHash);
 let n=0;
 try{for await(const item of c.findTransactions({script:{codeHash,hashType:'type',args:'0x'},scriptType:'type',scriptSearchMode:'prefix'},false,'desc',5)){console.log(JSON.stringify(item).slice(0,600)); if(++n>=5)break;}}catch(e){console.log('err',String(e?.message??e).slice(0,500));}
}
