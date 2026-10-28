import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
import { encodePetData } from '../../web/src/lib/molecule.ts';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
console.log('network ok');
