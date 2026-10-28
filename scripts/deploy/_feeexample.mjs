import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const k=JSON.parse(readFileSync('deployment/deploy-key.json','utf8')).privateKey;const s=new ccc.SignerCkbPrivateKey(c,k);const lock=(await s.getAddressObjs())[0].script;
const tx=ccc.Transaction.default();tx.outputs=[ccc.CellOutput.from({lock,capacity:300n*100000000n})];tx.outputsData=['0x'];
await tx.completeInputsByCapacity(s,150n*100000000n);
const [added,hasChange]=await tx.completeFeeBy(s,1000n);
console.log('added',added,'hasChange',hasChange,'w',tx.witnesses,'fee',String(await tx.getFee(c)),'size',tx.toBytes().length,'ins',tx.inputs.length);
