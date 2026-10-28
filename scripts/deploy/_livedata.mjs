import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const types=['AlwaysSuccess','Secp256k1Blake160','AnyoneCanPay','JoyId'];
for(const n of types){try{const s=await c.getKnownScript(n);console.log(n,s.codeHash,s.hashType,s.cellDeps.map(d=>d.cellDep.outPoint.txHash+':'+d.cellDep.outPoint.index+':'+d.cellDep.depType));}catch(e){console.log(n,'ERR',String(e).slice(0,100));}}
