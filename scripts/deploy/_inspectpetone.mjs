import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
import { decodePetData } from '../../web/src/lib/molecule.ts';
const info=JSON.parse(readFileSync('deployment/deployment.json','utf8'));
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const t=ccc.Script.from({codeHash:info.petType.codeHash,hashType:'type',args:info.treasuryLockHash});
for await (const cell of c.findCellsByType(t)) {
 const d=decodePetData(Uint8Array.from(Buffer.from(cell.outputData.slice(2),'hex')));
 const args=cell.cellOutput.lock.args;
 console.log(JSON.stringify({tx:cell.outPoint.txHash,cap:String(cell.cellOutput.capacity),lockCode:cell.cellOutput.lock.codeHash,lockType:cell.cellOutput.lock.hashType,lockArgsLen:(args.length-2)/2,owner:args.slice(66),birth:String(d?.birthTime),last:String(d?.lastTouched),name:Buffer.from(d?.name??[]).toString()}));
}
