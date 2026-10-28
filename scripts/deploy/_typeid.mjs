import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0xaa05c89b6dc80ac320ff449d298c3aa24f891f4eedeb5aad0e90435a7b5e8ad5');
for(const [i,o] of r.transaction.outputs.slice(0,2).entries()){
 const type=o.type;
 const actual=ccc.hashCkb(ccc.Script.from(type).toHex());
 console.log(i,'type args',type.args,'scriptHash',actual);
}
