# Litemora | Playable Schematic Worlds

[English](README_EN.md) | 中文

Litemora 是一个**极致优雅、极简主义**的网页 3D 画廊，专门用于展示和探索 Minecraft 的建筑原理图（Schematics）。
我们致力于将生硬的建筑文件转化为**可进入、可漫游的沉浸式世界**，并使用原版资源包（Resource Packs）提供真实的视觉效果。

<div align="center">
  <img src="https://raw.githubusercontent.com/shichien/Litemora/main/public/og.jpg" width="800" alt="Litemora Banner" />
</div>

> **在线预览**: [https://litemora.art/](https://litemora.art/)
> **设计语言**: 深色模式、极致排版、Afilmory 画廊风格

---

## 核心亮点

Litemora 已经彻底演进，放弃了初期的“魂类战斗”杂项演示，专注于**建筑投影的纯粹展示**。

1. **真实渲染质感 (Native Rendering)**  
   原汁原味解析 Minecraft 方块模型，结合自定义资源包呈现完美光影。
2. **多格式支持 (3+ Formats)**  
   直接读取 `.litematic` 等原理图文件，0 服务端成本，纯前端即时渲染。
3. **沉浸式探索 (First-Person Exploration)**  
   不仅是查看模型，而是以第一人称视角走入建筑，感受真实碰撞体与物理系统。
4. **创作者空间 (Creator Spaces)**  
   一键创建专属链接（如 `litemora.art/your-space`），将其作为你个人的建筑展览册。

## 本地开发指南

Litemora 采用现代化的包管理器和构建工具。

### 环境要求

- **Node.js**: 20.x 或以上 LTS 版本
- **包管理器**: 推荐使用 `pnpm` (仓库内包含 `pnpm-lock.yaml`)

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/shichien/Litemora.git
cd Litemora

# 2. 安装依赖
pnpm install

# 3. 启动本地开发服务器
pnpm dev
```
启动后，访问 Vite 输出的地址（通常为 `http://localhost:5175` 或 `5173`）即可预览最新的极简主页。

### 服务端 OAuth 部署 (Cloudflare Pages)

对于希望部署并启用“创建空间”功能的开发者，需要在服务端配置环境变量：
- `OAUTH_GITHUB_CLIENT_ID`
- `OAUTH_GITHUB_CLIENT_SECRET`
- `LITEMORA_SESSION_SECRET`

配置在 Cloudflare Pages 的 **Settings -> Environment variables** 中，确保 `_SECRET` 不在客户端暴露。

---

## 开发架构与规约

1. **UI 与 3D 解耦**：  
   `src/vue/` 仅负责绝美的 DOM 交互，3D 渲染逻辑严格封闭在 `src/js/experience.js` 中。两者通过 Pinia 或事件总线（mitt）通信。
2. **样式设计**：  
   全局使用 CSS 变量（`--bg`, `--text-main`, `--accent`），主打深沉、低饱和色调与衬线字体（Playfair Display）。尽量避免花哨的组件库，使用纯手工打磨的 HTML/CSS。
3. **资源加载**：  
   由于体素模型巨大，一切纹理、BufferGeometry 必须做好 GC，绝不允许内存泄漏。

---

## 协议与授权

本项目采用 **AGPL-3.0-only** 协议开源，详见 [LICENSE](LICENSE) 文件。
如果你使用了 Litemora 的代码作为商业用途或架设公开服务，**必须**开源你的修改与后端。

*“Where schematics become playable worlds.”*
