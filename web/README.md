# PetCell Web

PetCell 的纯前端 dApp：React 19 + TypeScript + Vite + CCC。

## 本地运行

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

- 正式测试网入口：`http://127.0.0.1:5173/`
- 本地 Demo：`http://127.0.0.1:5173/?demo=1`

## 构建

```bash
npm run lint
npm run build
```

构建产物在 `dist/`。

## Cloudflare Pages

项目已包含 `wrangler.toml`，并准备了以下部署配置：

| 配置 | 值 |
| --- | --- |
| Root directory | `web` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` |

手动部署：

```bash
cd web
npm ci
npm run build
npx wrangler pages deploy dist --project-name ckb-pet
```

`public/_redirects` 提供 SPA fallback，`public/_headers` 提供静态缓存和安全响应头。Cloudflare Pages 的生产 URL 预期为 `https://ckb-pet.pages.dev/`。

## 已验证与限制

已验证 `npm run lint`、`npm run build`、Demo 交互、详情弹窗焦点闭环、危险确认层、ARIA tab 和桌面/移动响应式布局。

尚未在本机完成真实 JoyID 钱包的链上全流程验收；合约时钟少报风险、第三方审计缺失和历史索引缺失仍属于项目级限制，详见根目录 README 与 `docs/tech-spec.md`。
