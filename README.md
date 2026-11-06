[English](./README_EN.md) | 中文

# Litemora

把 Minecraft 原理图变成可以在浏览器里走进去的世界。

上传 `.litematic`、`.schem` 或 `.schematic`，Litemora 会按原版方块模型和材质把它渲染成一个可漫游的 3D 世界：第一人称或第三人称行走、飞行、碰撞，用快捷栏放置和破坏方块，并把作品放进自己的空间分享给别人。

在线地址：<https://litemora.art>

## 功能

- **原理图世界**：原生方块模型与资源包渲染，按区块流式加载，大型建筑也能流畅浏览。
- **角色与相机**：行走、疾跑、潜行、飞行，第一人称 / 第三人称 / 鸟瞰视角，Minecraft 皮肤可切换。
- **个人空间**：`litemora.art/<空间名>` 下管理自己的投影，支持 GitHub / Google 登录、RSS 和公开或私有。
- **红石档案**：播放由 [redstone-rs](https://github.com/azazo1/redstone-rs) 计算出的确定性红石回放，支持播放、暂停、逐刻前后、倍速和拖动时间线。详见 [docs/redstone-archive.md](./docs/redstone-archive.md)。
- **中英双语** 界面。

## 操作

| 按键 | 作用 |
| --- | --- |
| `W A S D` / 方向键 | 移动 |
| `Space` | 跳跃（飞行时上升） |
| `Shift` / `V` | 潜行（飞行时下降） |
| `Ctrl` | 疾跑 |
| `F` | 切换飞行 |
| `Y` | 切换视角 |
| `Tab` | 切换第三人称相机左右肩 |
| `Q` | 切换方块编辑模式（添加 / 移除） |
| `1`–`9` / 滚轮 | 选择快捷栏格子 |
| `R` | 回到出生点 |
| `Esc` | 暂停菜单 |

## 本地开发

需要 Node.js 和 pnpm。

```powershell
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # 输出到 dist/
pnpm preview
pnpm lint
```

开发服务器内置了本地 API 中间件，会从 `public/spaces/` 读取空间和投影数据，不需要 Cloudflare 环境即可调试世界列表和世界页面。

## 目录结构

```
src/
  js/          Three.js 世界、相机、玩家、渲染与红石回放
  vue/         Vue 界面：首页、空间页、菜单、HUD、管理页
  pinia/       状态管理
  styles/      全局样式与深板岩 + 红石设计系统（_redstone.scss）
  locales/     zh / en 文案
functions/     Cloudflare Pages Functions（/api/*）
public/        资源包、原理图、红石回放、世界封面等静态资源
scripts/       原理图生成、红石回放转换、封面截图等工具脚本
docs/          专题文档
```

## 部署

项目部署在 Cloudflare Pages，推送到部署分支后自动构建。

- 构建命令：`pnpm build`，输出目录 `dist`
- `functions/` 下的接口由 Pages Functions 提供
- KV 绑定：`LITEMORA_SPACE_KV`（空间、投影和画廊数据）
- 机密变量：`LITEMORA_SESSION_SECRET`、`OAUTH_GITHUB_CLIENT_ID`、`OAUTH_GITHUB_CLIENT_SECRET`、`OAUTH_GOOGLE_CLIENT_ID`、`OAUTH_GOOGLE_CLIENT_SECRET`
- 可选：`VITE_OAUTH_CALLBACK_ORIGIN`（构建时变量，指定 OAuth 回调域名）

## 工具脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm thumbnails:capture [空间/世界ID]` | 用无头浏览器为公开世界截取等距封面，写入 `public/thumbnails/` |
| `pnpm redstone:registry` | 生成指定 Minecraft 版本的官方方块状态表 |
| `pnpm redstone:replay` | 把 redstone-rs 的轨迹转换为浏览器回放文件 |
| `pnpm kv:seed` | 生成 KV 初始数据 |

## 致谢

- [**azazo1/redstone-rs**](https://github.com/azazo1/redstone-rs)：确定性、无需 JVM 的 Minecraft Java 版红石模拟器。红石档案中的三段活塞扩展器、飞行器阵列、数字时钟和八位红石计算机，以及它们的每一段回放，都来自这个项目。非常感谢 azazo1！
- [Cubane](https://www.npmjs.com/package/cubane) 与 [schematic-renderer](https://www.npmjs.com/package/schematic-renderer)：方块模型与原理图渲染。
- [Three.js](https://threejs.org/)、[Vue](https://vuejs.org/)、[Pinia](https://pinia.vuejs.org/)、[Vite](https://vitejs.dev/)。
- 皮肤作者 hibiki_ekko 与 holland0519。
- 本项目与 [Third-Person-MC](https://github.com/Shichien/Third-Person-MC) 有关。

Minecraft 是 Mojang Studios 的商标。Litemora 不是官方 Minecraft 产品，与 Mojang 或 Microsoft 无关。

## 许可证

AGPL-3.0-only，详见 [LICENSE](./LICENSE)。
