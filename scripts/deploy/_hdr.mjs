import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const t=await c.getTipHeader(); const h=await c.getHeaderByNumber(t.number-16n);
console.log(JSON.stringify({tip:{number:String(t.number),timestamp:String(t.timestamp),hash:t.hash},chosen:{number:String(h.number),timestamp:String(h.timestamp),hash:h.hash}}));
