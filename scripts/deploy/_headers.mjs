import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const tip=await c.getTipHeader();
console.log('tip', String(tip.number), String(tip.timestamp), tip.hash);
for (const back of [1n,4n,8n,16n,64n,100n,1000n,10000n,70000n]) {
 const num=tip.number>back?tip.number-back:0n;
 const h=await c.getHeaderByNumber(num);
 console.log(String(back),'num',String(num),'ts',h?String(h.timestamp):'-',h?.hash);
}
