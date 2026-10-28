import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
for(const op of [{txHash:'0x028ec84950a3d54256db1d2b63b700d72d7f1951a9db3748199e786e0da3d2c5',index:0},{txHash:'0x19ac216e739d',index:0}]){const x=await c.getCell(op);console.log(op,!!x,x?.cellOutput?.capacity)}
