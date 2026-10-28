import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const now=BigInt(Date.now());
const tip=await c.getTipHeader();
console.log('system now',now.toString(),new Date(Number(now)).toISOString());
console.log('tip ts',tip.timestamp.toString(),new Date(Number(tip.timestamp)).toISOString(),'delta sec',String((now-tip.timestamp)/1000n));
