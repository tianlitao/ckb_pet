import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
for(const h of ['0x151a256cbbb8bf69810e43c19d49c351d3f64097aa162d49d09709403c59c2d9','0x47ce24df2b087f25de575e4e7dfedc2f00fbbc340c0b9bd5fbc517d582549cef']) {
 const r=await c.getTransaction(h); console.log(h.slice(0,10),r.transaction.headerDeps, 'witness0',r.transaction.witnesses[0]);
}
