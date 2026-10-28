import { ccc } from '@ckb-ccc/core';
import { encodePetData } from '/Volumes/tlt/my_project/ckb_pet/web/src/lib/molecule';
const d = {
  version: 0,
  state: 0,
  genes: new Uint8Array(32),
  birthTime: 0x1234567890abcdefn,
  lastTouched: 0x1234567890abcdefn,
  generation: 1,
  breedLockUntil: 0n,
  name: new TextEncoder().encode('hello'),
};
const b = encodePetData(d);
console.log('data', Buffer.from(b).toString('hex'), 'length', b.length);
console.log('table', ccc.molecule?.Table ? 'has Table' : 'no Table');
