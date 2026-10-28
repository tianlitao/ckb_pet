import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
import { decodePetData } from '../../web/src/lib/molecule.ts';
const info=JSON.parse(readFileSync('deployment/deployment.json','utf8'));
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const t=ccc.Script.from({codeHash:info.petType.codeHash,hashType:'type',args:info.treasuryLockHash});
for await (const cell of c.findCellsByType(t)) {
  const d=decodePetData(Uint8Array.from(Buffer.from(cell.outputData.slice(2),'hex')));
  console.log(cell.outPoint.txHash, 'cap', String(cell.cellOutput.capacity), 'state',d?.state,'name',d?Buffer.from(d.name).toString():'?','last',String(d?.lastTouched),'surplus',Number(cell.cellOutput.capacity - 30900000000n)/1e8);
}
