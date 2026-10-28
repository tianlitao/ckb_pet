import { ccc } from '@ckb-ccc/core';
const c=new ccc.ClientPublicTestnet({url:'https://testnet.ckb.dev/'});
const wanted=['0x7972b19f91f17b236ff092f355ecf41cf21c207891ad0fa33b7291c4a66aed6a','0x96aaf01eab2652d0d91198ab60b594ddde1c0b2d24e1ca3303ba894882613573','0x9a7c1b75e44de3aef38ae37ee26dc01d6dc056d15f40536cdcd5cae0bdeb1c56','0x3253c6363c3d121cd13d3521f8a584b5b2774f9ce94d71e5b83e8fdf01e03b95'];
for(const h of wanted){for(const hashType of ['data1','data']){let n=0;try{for await(const x of c.findTransactions({script:{codeHash:h,hashType,args:'0x'},scriptType:'type',scriptSearchMode:'prefix'},'desc',3)){console.log(h.slice(0,10),hashType,x.txHash,x.blockNumber);if(++n>=3)break;}}catch(e){console.log(h.slice(0,10),hashType,'err',String(e?.message??e).slice(0,80));}}}
