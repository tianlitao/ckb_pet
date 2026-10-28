import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const info=JSON.parse(readFileSync('deployment/deployment.json','utf8'));
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const t=ccc.Script.from({codeHash:info.petType.codeHash,hashType:'type',args:info.treasuryLockHash});
console.log('type',t.toHex());
let n=0;
try { for await (const cell of c.findCellsByType(t)) { console.log('cell', cell.outPoint.txHash, cell.outPoint.index, 'cap', String(cell.cellOutput.capacity),'dataLen',(cell.outputData.length-2)/2); if(++n>=20)break; } } catch(e){ console.log('ERR', String(e?.message??e)); }
console.log('count',n);
