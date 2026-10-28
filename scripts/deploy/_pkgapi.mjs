import { ccc } from '@ckb-ccc/core';
console.log('mol', typeof ccc.mol, Object.keys(ccc.mol).slice(0,80));
for (const k of ['table','struct','option','byteVec','fixedItemVec','dynamicItemVec','vector']) console.log(k, typeof ccc.mol[k]);
