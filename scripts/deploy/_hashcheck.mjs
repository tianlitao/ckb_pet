import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const a=readFileSync('contracts/target/riscv64imac-unknown-none-elf/release/pet-type');
const b=readFileSync('contracts/target/riscv64imac-unknown-none-elf/release/pet-lock');
console.log('pet-type ccc',ccc.hashCkb(a));
console.log('pet-lock ccc',ccc.hashCkb(b));
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const r=await c.getTransaction('0xaa05c89b6dc80ac320ff449d298c3aa24f891f4eedeb5aad0e90435a7b5e8ad5');
for(const [i,d] of r.transaction.outputsData.entries())console.log('live out',i,'dataLen',(d.length-2)/2,'ccc data hash',ccc.hashCkb(d));
