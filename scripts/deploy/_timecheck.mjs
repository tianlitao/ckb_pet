import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const tip=await c.getTipHeader();
const n=tip.number-70000n;
const h=await c.getHeaderByNumber(n);
console.log('tip',String(tip.number),String(tip.timestamp),new Date(Number(tip.timestamp)).toISOString());
console.log('old',String(n),String(h.timestamp),new Date(Number(h.timestamp)).toISOString(),'days',Number(tip.timestamp-h.timestamp)/86400000);
