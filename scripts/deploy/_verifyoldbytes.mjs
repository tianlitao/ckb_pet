import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0xaa05c89b6dc80ac320ff449d298c3aa24f891f4eedeb5aad0e90435a7b5e8ad5');
for(const [f,i] of [['pet-type',0],['pet-lock',1]]) {
 const local=readFileSync(`contracts/target/riscv64imac-unknown-none-elf/release/${f}`);
 const live=Buffer.from(r.transaction.outputsData[i].slice(2),'hex');
 console.log(f,'local',local.length,'live',live.length,'sameCurrent',local.equals(live));
}
