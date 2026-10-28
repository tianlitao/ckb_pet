# PetCell

**养一只链上活物。它不存放在服务器里，也不会因为项目关停而消失。**

PetCell 是一个部署在 CKB Testnet 上的电子宠物 dApp。每只宠物就是一条真实的 CKB Cell：身体是 Cell 的占用容量，生命值是可消耗的富余容量。喂养会真实增加它的口粮，代谢会按时间燃烧 CKB，口粮耗尽后宠物死亡，尸体可由任何人收殓。

[在线体验](https://ckb-pet.pages.dev/?demo=1) · [GitHub](https://github.com/tianlitao/ckb_pet) · [技术方案](docs/tech-spec.md) · [部署记录](deployment/README.md)

> 当前为 **CKB Testnet** 版本。合约尚未经过独立第三方安全审计，请勿将其视为主网生产级资产。

## 在线地址

- Demo（无需钱包）：https://ckb-pet.pages.dev/?demo=1
- 测试网正式入口：https://ckb-pet.pages.dev/

> Cloudflare Pages 已于 2026-10-28 完成首次生产部署。

## 它是什么

- **宠物是一条 Cell**：没有中心化数据库，也没有“项目关服”开关。
- **生命值就是口粮**：`surplus = capacity - occupied`，喂它等于向宠物 Cell 转入 CKB。
- **代谢由链强制**：每次状态转移按真实时间结算，燃烧量为 `max(burn_per_day × Δt, min_burn)`。
- **死亡是公开状态**：口粮耗尽且没有及时救助时，宠物进入 `DEAD`，尸体容量可由路人收殓。
- **所有权由钱包决定**：宠物使用共签 `pet-lock`；主人操作必须消耗其原生 lock 锁定的 Cell。

## 核心机制

```text
领养 / 代铸
    ↓
ALIVE ── feed / poke / transfer ──→ ALIVE
    │                                  │
    ├──────── 口粮耗尽 ───────────────→ DEAD
    └──────── 安乐死 ─────────────────→ DEAD
                                           │
                                           └── loot（收殓）
```

| 操作 | 发起者 | 结果 |
| --- | --- | --- |
| 领养 | 用户或代铸人 | 创建宠物 Cell，写入基因、出生时间和初始口粮 |
| 投喂 | 主人或任何人 | 增加宠物口粮，同时结算此前代谢 |
| 摸一下 / Poke | 任何人，无需签名 | 结算代谢；口粮耗尽时宠物死亡 |
| 转让 | 主人 | 把宠物所有权和剩余口粮一起转给新主人 |
| 安乐死 | 主人 | 宠物进入 `DEAD`，税后口粮的 20% 被燃烧 |
| 收殓 / Loot | 任何人 | 消耗死亡宠物 Cell，取回身体容量 |

## 已部署合约

当前测试网使用安全修复版，脚本 Cell 由燃烧私钥的 vault lock 锁定：

| 项目 | 值 |
| --- | --- |
| Network | CKB Testnet（Aggron） |
| Deploy tx | `0x91e318fd6057085b1d11f2fbb69dc8d61eaac0c3949d0373a41df6047e785d42` |
| Block | `22878281` |
| pet-type | Deploy tx `#0`，`hash_type: type` |
| pet-lock | `0x93e936e3461bff7d063162921feab37a0ed685d4fbfb3c18d962ebab6db20812#1`，`hash_type: type` |
| pet-type code hash | `0xb120a01d25c4f6411d6dbc9adac19b2acac2ec941cf1856c9e3d89160f948c5d` |
| pet-lock code hash | `0x4e9c281d6fd4eac28408a13a43fa0473853909d5ce92c63326f1e20d4151f25d` |

链上 smoke 测试覆盖领养、投喂、转让、poke 死亡、安乐死和收殓；每笔交易均按 tx hash 重新读取并确认 `committed`。详见 [deployment/smoke-latest.json](deployment/smoke-latest.json)。

## 快速开始

### 在线体验

直接打开 [Demo 模式](https://ckb-pet.pages.dev/?demo=1)，无需钱包，即可体验领养、投喂、广场、详情、转让和安乐死交互。

真实测试网操作需要安装兼容 CCC 的钱包（如 JoyID）并准备 CKB Testnet 资产。

### 本地运行前端

```bash
cd web
npm ci
npm run dev -- --host 127.0.0.1
```

打开：

- `http://127.0.0.1:5173/`：连接钱包的测试网入口
- `http://127.0.0.1:5173/?demo=1`：本地 Demo 模式

检查构建：

```bash
npm run lint
npm run build
```

### 构建和测试合约

```bash
cd contracts
cargo fmt --all -- --check
cargo build --release --target riscv64imac-unknown-none-elf -p pet-type -p pet-lock -p always-success
cargo test -p pet-tests
cargo test -p pet-common --lib
```

当前测试记录：42 个 CKB-VM 集成测试、7 个编解码测试通过。重新构建 ELF 后需运行：

```bash
python3 scripts/hash_elfs.py
```

### 验证线上部署

```bash
node scripts/deploy/_verify-current-deploy.mjs
npx tsx scripts/deploy/3-smoke.mts
npx tsx scripts/deploy/4-type-data2-attack.mts
```

`4-type-data2-attack.mts` 只做真实 testnet dry-run，不广播攻击交易。当前部署已在线；除非 ELF 和版本同时变化，否则不要重复广播 `2-deploy.mjs`，也不要运行旧的 `2b-vault.mjs`。

## Cloudflare Pages

前端是纯静态 Vite 应用，Cloudflare Pages 配置为：

- Root directory：`web`
- Build command：`npm run build`
- Build output directory：`dist`
- Node version：`22`

仓库同时提供 `web/wrangler.toml`，也可以从仓库根目录用 Wrangler 部署：

```bash
cd web
npm ci
npm run build
npx wrangler pages deploy dist --project-name ckb-pet
```

`web/public/_redirects` 会把 SPA 路由回退到 `index.html`；`web/public/_headers` 为静态资源、字体和安全响应头设置缓存与防护策略。

如果使用 Cloudflare 的 Git 集成，把生产分支设为 `main`，并把构建根目录设为 `web`。README 中的正式地址为 `https://ckb-pet.pages.dev/`。

## 安全模型与已知边界

### 已实现的关键防护

- pet-lock 使用共签模式，Owner lock 类型零适配。
- pet-type 校验基因派生、状态转移、代谢燃烧、严格时钟前进和反尘土手续费。
- Type/Data2 双 script group 共用手续费的攻击路径已有链上 dry-run 复测。
- feed / transfer / euthanize 的代谢手续费有链上约束，不能靠极小手续费反复重置饥饿时钟。

### 仍然存在的风险

- **时钟少报**：脚本只能验证 header dep 存在，无法证明它接近真实 wall-clock。攻击者可能选择较旧 header 少结算代谢。当前 `min_burn` 和严格前进只提供有限缓解，**不是完整解决**。
- **无第三方审计**：尚无独立安全审计、形式化验证或主网级监控。
- **历史索引缺失**：广场的“讣告 / 未收殓”只统计当前仍 live 的死宠 Cell；尸体被收殓后会从界面消失。
- **JoyID 全流程未在本仓库完成浏览器实测**：已有合约测试和交易构造测试，但真实钱包签名、提交、提交后复核仍需单独验收。
- **前端包体积**：主 bundle 约 1.05 MB（gzip 约 336 KB），构建时仍会提示 chunk 过大。
- **中文字体回退**：英文展示字体已自托管；中文仍依赖系统 Serif 字体回退，跨平台字形不完全一致。

## 项目结构

```text
ckb_pet/
├── contracts/          # Rust + ckb-std：pet-type / pet-lock / common / tests
├── web/                # React + Vite + CCC 前端
│   ├── public/         # favicon、字体、Cloudflare headers/redirects
│   └── src/            # 页面、组件、链上编解码和交易构造
├── deployment/         # 测试网部署记录、冒烟测试和部署手册
├── docs/tech-spec.md   # 技术方案、状态机、风险分析
└── scripts/            # ELF 哈希和 testnet 部署/验证脚本
```

## 常用文档

- [技术方案](docs/tech-spec.md)
- [部署手册](deployment/README.md)
- [前端说明](web/README.md)

## License

仓库目前未附带开源许可证。若要公开发布并允许复用，请补充明确的 `LICENSE` 文件。
