import { ccc } from '@ckb-ccc/core';
const P=ccc.mol.table({version:ccc.mol.Uint8,state:ccc.mol.Uint8,genes:ccc.mol.Byte32,birthTime:ccc.mol.Uint64LE,lastTouched:ccc.mol.Uint64LE,generation:ccc.mol.Uint32LE,breedLockUntil:ccc.mol.Uint64LE,name:ccc.mol.Bytes});
const d={version:0,state:0,genes:'0x'+'01'.repeat(32),birthTime:1n,lastTouched:2n,generation:1,breedLockUntil:0n,name:'0x6d6f636869'};
const x=P.encode(d); console.log(Buffer.from(x).toString('hex'), x.length); console.log(P.decode(x));
