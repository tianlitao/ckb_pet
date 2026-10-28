import { ccc } from '@ckb-ccc/core';
import { decodePetData, encodePetData } from '../../web/src/lib/molecule.ts';
const P=ccc.mol.table({version:ccc.mol.Uint8,state:ccc.mol.Uint8,genes:ccc.mol.Byte32,birthTime:ccc.mol.Uint64LE,lastTouched:ccc.mol.Uint64LE,generation:ccc.mol.Uint32LE,breedLockUntil:ccc.mol.Uint64LE,name:ccc.mol.Bytes});
const d={version:0,state:0,genes:new Uint8Array(32).fill(1),birthTime:1n,lastTouched:2n,generation:1,breedLockUntil:0n,name:new TextEncoder().encode('mochi')};
const ours=encodePetData(d); const theirs=P.encode({...d,genes:'0x'+'01'.repeat(32),name:'0x'+Buffer.from(d.name).toString('hex')});
console.log('ours',Buffer.from(ours).toString('hex'));console.log('ccc ',Buffer.from(theirs).toString('hex'));console.log('equal',Buffer.from(ours).equals(Buffer.from(theirs)));console.log(decodePetData(theirs));
