import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0xaa05c89b6dc80ac320ff449d298c3aa24f891f4eedeb5aad0e90435a7b5e8ad5');
for(const [i,op] of r.transaction.outputs.entries()){if(!op.type)continue;const ch=ccc.hashCkb(r.transaction.outputsData[i]);const sh=ccc.hashCkb(ccc.Script.from(op.type).toHex());console.log(i,'dataHash',ch,'scriptHash',sh,'typeArgs',op.type.args)}
