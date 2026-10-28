import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c = new ccc.ClientPublicTestnet({ url: 'https://testnet.ckb.dev/', fallbacks: ['https://testnet.ckbapp.dev/'] });
const info=JSON.parse(readFileSync('deployment/deployment.json','utf8'));
for (const [name,op] of Object.entries({petType:info.petType,petLock:info.petLock})) {
  const cell=await c.getCellLive(ccc.OutPoint.from({txHash:op.txHash,index:op.index}));
  console.log(name,'live',!!cell,'data',cell?.outputData.length/2-1,'type',cell?.cellOutput.type?.toHex());
  if(cell) console.log('  codehash(scripthash of type)', ccc.hashCkb(cell.cellOutput.type.toHex()));
}
