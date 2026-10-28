import { ccc } from '@ckb-ccc/core';
import { readFileSync } from 'node:fs';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});const k=JSON.parse(readFileSync('deployment/deploy-key.json','utf8')).privateKey;const s=new ccc.SignerCkbPrivateKey(c,k);console.log(await s.getRecommendedAddress(),(await s.getAddressObjs())[0].script.toHex(),ccc.hashCkb((await s.getAddressObjs())[0].script.toHex()));
