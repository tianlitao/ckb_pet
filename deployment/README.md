# 部署手册(CKB testnet)

当前测试网部署已提交。除非合约源码和 ELF 同时变化,否则不要重复部署。

## 当前部署

| 项目 | 值 |
|------|----|
| network | CKB testnet(Aggron) |
| deploy tx | `0x91e318fd6057085b1d11f2fbb69dc8d61eaac0c3949d0373a41df6047e785d42` |
| block | `22878281` |
| pet-type | tx above `#0`, 43264 bytes, TYPE_ID wrapper |
| pet-lock | 复用旧部署 tx `0x93e936e3…` `#1`, 29088 bytes |
| wrapper | 两个 Cell 都是 genesis TYPE_ID,前端 `hashType: "type"` |
| pet-type raw ELF hash | `0xbc14bc825b809ab6d0c2603de493bba7c35288b07c71f28f74006f1377eb1ed1` |
| pet-lock raw ELF hash | `0x96aaf01eab2652d0d91198ab60b594ddde1c0b2d24e1ca3303ba894882613573` |
| pet-type script hash(wrapper) | `0xb120a01d25c4f6411d6dbc9adac19b2acac2ec941cf1856c9e3d89160f948c5d` |
| pet-lock script hash(wrapper) | `0x4e9c281d6fd4eac28408a13a43fa0473853909d5ce92c63326f1e20d4151f25d` |

两枚脚本 Cell 均已用 `_verify-current-deploy.mjs` 从链上重新读取完整 data:
pet-type 43264 B、pet-lock 29088 B,均与本仓库构建产物 byte-for-byte 一致,
且两者 `getCellLive` 均为 live。脚本 Cell 由随机生成且未保存私钥的 vault lock
锁定,不可花。部署记录见 `deployment/deployment.json`,前端生成文件见
`web/src/generated/deployment.ts`。

> 当前测试网余额约 `8,932.26 CKB`。现有部署在线,不需要重建;再次执行
> `DRY_RUN=1 node scripts/deploy/2-deploy.mjs` 会因为要重新构造脚本 Cell 而
> 报 `Insufficient CKB`。这是**重新部署资金不足**,不是当前合约或线上 Cell 失效。
> 未确认新的 ELF/版本前禁止广播 `2-deploy.mjs`。只验证当前部署时运行:
>
> ```bash
> node scripts/deploy/_verify-current-deploy.mjs
> ```

## 构建与哈希

```bash
cd contracts
cargo fmt --all -- --check
cargo build --release --target riscv64imac-unknown-none-elf -p pet-type -p pet-lock -p always-success
cd ..
python3 scripts/hash_elfs.py
```

`code_hashes.json` 里的值是 CKB personalized blake2b256
(`person=b"ckb-default-hash"`),仅用于 Data1-style 参考;当前线上引用的是
TYPE_ID Cell 的 **script hash**,两者不能混用。

构建目标必须保留 `contracts/.cargo/config.toml` 的
`-C target-feature=+zba,+zbb,+zbc,+zbs -C passes=lower-atomic`。

## 部署流程

```bash
# 1. 确认 deploy key 余额(测试网,建议至少约 80k CKB;以脚本预检为准)
node scripts/deploy/1-fund.mjs

# 2. 必须先 dry-run:校验 ELF 与 code_hashes、签名、test_tx_pool_accept
DRY_RUN=1 node scripts/deploy/2-deploy.mjs

# 3. 仅在确认需要新版本时广播
node scripts/deploy/2-deploy.mjs

# 4. 只跑精确 outpoint 的端到端冒烟
npx tsx scripts/deploy/3-smoke.mts

# 5. 真实 testnet 攻击复测:Type + Data2 共用 fee,只 dry-run
npx tsx scripts/deploy/4-type-data2-attack.mts
```

`2-deploy.mjs` 会用一次性 vault key 锁定脚本 Cell,产生 genesis TYPE_ID,
在真实广播前执行 `test_tx_pool_accept`;真实部署会把旧
`deployment.json` 归档到 `deployment/history/`。脚本在收集输入前先检查
脚本 Cell 输出容量;余额不足会直接报“preflight failed before broadcast”，
不会把资金不足误报成合约执行失败。

**不要运行 `2b-vault.mjs`**:它是旧 Data1 部署的迁移脚本,会挪动 Cell
outpoint 并重写部署记录,不属于当前 TYPE_ID 部署流程。

## 冒烟判定

`3-smoke.mts` 为每次运行生成随机后缀,并只按上一步产生的精确 outpoint
读取宠物;名称仅作显示。每笔交易必须:

1. `waitTransaction` 返回成功;
2. 再次 `getTransaction` 的状态为 `committed`;
3. 下一步输入的 outpoint 与上一步输出 `#0` 完全一致;
4. loot 后目标 Cell `getCellLive` 为 `false`,且 loot tx 输入包含该 outpoint。

2026-10-27 的前一轮 `mvqhjr2v` 旧日志标签错位,已按链上输入输出关系纠正为:
A adopt/feed/transfer、B adopt/poke/loot、C adopt/euthanize/loot 共 9 笔。
该轮 9 笔均可在链上重新读取为 `committed`;旧日志中的映射不再使用。

修复前端交易构造后的新一轮为 `mvqjb6li`。机器可读结果见
`deployment/smoke-latest.json`;该结果只记录实际提交并再次读取为
`committed` 的交易:

| 步骤 | tx | block | txIndex |
|------|----|-------|---------|
| A adopt | `0x5db102370fe674fab4fdb58883b6a683ae35ff0d9125b2b2ea63078abe89a856` | 22878675 | 1 |
| A feed | `0x175199a430fdc3d450f22c3ab388d239d98d06afc8b4c4f6b585f1fb0d011f44` | 22878679 | 1 |
| A transfer | `0xb40ac57a962e130fe393df7a19f273042d35250a991145c65fc7e682e10bbe3c` | 22878684 | 1 |
| B adopt | `0xa1191b4a6d777951a8ac107aa1d1f11ff5b94fdd0de57741b24f964f0bc78a46` | 22878692 | 1 |
| B poke→DEAD | `0x43e748c725a8255217d0dc898c00cbf9b76aa41752387d54bad13337add3f92b` | 22878696 | 1 |
| B loot | `0x011e92dd72a04057413a11c286e3ce47e1aa05bb9c397f07a9893b588693c1aa` | 22878700 | 1 |
| C adopt | `0x389d9987013a49cba08a433cb0e1f48954ef81c1cbac8ed617753153745ba063` | 22878704 | 1 |
| C euthanize | `0x26f3699722ab1c5e6ce8ec6a42b9ee5de73358c4b60eb04a44b2c19090287702` | 22878709 | 1 |
| C loot | `0x577ae2fcd2833d82c5c44a835302ca1b6987b078653ab6cac6e8b41967acf1cb` | 22878716 | 4 |

`_verify-smoke-txs.mts` 可重新读取该 JSON,逐笔校验 committed、block、
txIndex、操作间 outpoint 连续性和 loot 输入。不要再用截断的控制台日志判断
交易标签。

前端交易构造现已取消对 feed/transfer/euthanize/loot 强制预收集 150 CKB;
这些操作只追加实际签名/手续费所需的输入。旧版 smoke 映射经链上核验后的完整
记录仍保存在 `_verify-smoke-txs.mts` 的 historical fallback 中。


### Type + Data2 攻击复测(修复版)

`4-type-data2-attack.mts` 在真实 testnet 上铸造了两只同一 ELF 的宠物:

- 正常宠物:pet-type/pet-lock 均通过 `hash_type: "type"`(TYPE_ID wrapper)
- 影子宠物:pet-type/pet-lock 均通过 `hash_type: "data2"`(raw ELF hash)

两只宠物各做一次 FEED dry-run 均 ACCEPT;再用一笔同时喂两只、共享 12 CKB
fee 的交易做 dry-run,节点拒绝 `ERR_SCRIPT_GROUP = 11`。组合交易没有广播。
机器可读结果见 `deployment/type-data2-attack.json`:

| 项目 | 值 |
|------|----|
| normal pet | `0x88e9b0bc0b8c9ee6467c7a7c202279d0120f2b8d49aa72db1ef21ea8d582bea9#0` |
| shadow pet | `0x023dcf10eef237a04e98322f66694163e241a48ab2f292421a1918a47e9771f4#0` |
| 单只 burn | 1,001,751,469 shannons |
| 共享 fee | 1,200,000,000 shannons |
| 正常单只 dry-run | ACCEPT,1,948,518 cycles |
| 影子单只 dry-run | ACCEPT,1,882,729 cycles |
| 合并 dry-run | REJECT,errorCode 11 (`ERR_SCRIPT_GROUP`) |

## 已知边界

- 公共 RPC/indexer 限流与短暂不一致会影响读取;交易提交后必须按 hash/Cell 复核,
  不能只看 UI。
- 前端时钟取 tip 前 8 个区块;仍不是最终确定,极端深 reorg 需要重建交易。
- 尚无独立第三方安全审计,也没有公开发布的前端托管;JoyID 浏览器全流程未实测。
- “讣告/耻辱榜”当前只统计 live 的死宠 Cell;捡尸后从 UI 消失,历史索引尚未实现。
