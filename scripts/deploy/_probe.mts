import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
import { buildAdopt } from '../../web/src/lib/ops.ts';
import { loadDeployment } from '../../web/src/config.ts';

const root = '/Volumes/tlt/my_project/ckb_pet/';
const c = new ccc.ClientPublicTestnet({ url: 'https://testnet.ckb.dev/', fallbacks: ['https://testnet.ckbapp.dev/'] });
const { privateKey } = JSON.parse(readFileSync(root + 'deployment/deploy-key.json', 'utf8'));
const signer = new ccc.SignerCkbPrivateKey(c, privateKey);
console.log('deployment', loadDeployment().petType);
const bal = await signer.getBalance();
console.log('balance CKB', Number(bal) / 1e8);
const r = await buildAdopt(signer, c, 'probe', 30n * 100_000_000n);
console.log('ADOPT BUILT', r.txHash);
console.log('tx inputs', r.tx.inputs.length, 'outputs', r.tx.outputs.length, 'cellDeps', r.tx.cellDeps.length);
const tx = await c.getTransaction(r.txHash);
console.log('tx status', tx?.status, 'block', tx?.blockNumber);
