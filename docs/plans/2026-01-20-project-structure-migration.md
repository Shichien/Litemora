# Project Structure Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

I'm using the writing-plans skill to create the implementation plan.

**Goal:** 将当前项目 UI 相关代码迁移到清晰的 UI 分层目录（`src/vue/**`），将 Pinia store 独立到 `src/pinia/**`，统一样式为单一 SCSS 体系（单入口），并引入 Vite alias 以消除深层相对路径，同时修正 Tailwind 扫描范围以覆盖 `.vue`。

**Architecture:** UI（Vue 组件 + 样式 + Pinia 状态）与 3D 核心（`src/js/**`）完全解耦。UI/Store/Styles 使用 alias 引用，避免后续目录调整引发大面积相对路径改动。样式采用 SCSS 单入口作为全局样式管线（包含 Tailwind 指令 + 现有全局/ HUD 样式）。

**Tech Stack:** Vite 5 + Vue 3 + Pinia + TailwindCSS + Sass + mitt + Three.js，包管理 `pnpm`，测试 Playwright。

---

## Target Directory Structure (Post-Migration)

```text
src/
  main.js
  App.vue

  js/                      # Three.js 引擎层（保持）
  shaders/
  locales/

  vue/                     # Vue UI 层（只放 UI 相关）
    components/
      hud/
      menu/
      ui/
      Crosshair.vue
      MiniMap.vue

  pinia/                   # 专门放 store
    uiStore.js
    hudStore.js
    settingsStore.js
    counterStore.js

  styles/                  # 统一 SCSS（单入口）
    main.scss
    hud.scss
    _tokens.scss           # 可选（从旧 global.scss 提炼 mixin/变量）
```

---

## Aliases (Vite resolve.alias)

统一使用 alias，禁止出现 `../../..` 深相对路径：

- `@` → `src`
- `@ui` → `src/vue`
- `@ui-components` → `src/vue/components`
- `@pinia` → `src/pinia`
- `@styles` → `src/styles`
- （可选）`@three` → `src/js`

---

## Task 0: Safety Baseline (Worktree + Baseline checks)

**Files:** none

**Step 1: 创建隔离 worktree（推荐）**

Run:

```bash
git status
git branch --show-current
git worktree add ../Third-Person-MC-structure-migration -b chore/structure-migration
```

Expected:
- 新 worktree 目录创建成功
- 进入 worktree 后分支为 `chore/structure-migration`

**Step 2: 安装依赖并确认基线可跑**

Run:

```bash
pnpm -v
pnpm install
pnpm lint
pnpm build
```

Expected:
- `pnpm lint` 无错误退出
- `pnpm build` 成功产出构建（无 fatal error）

**Step 3: 提交一个“基线记录”提交（可选）**

Run:

```bash
git status
```

Expected:
- 无改动则跳过提交

---

## Task 1: Add Vite Aliases

**Files:**
- Modify: `vite.config.js`

**Step 1: 修改 `vite.config.js` 添加 `resolve.alias`**

Implementation notes:
- 保持 ES module 风格与现有插件配置不变
- alias 路径使用 `path.resolve(__dirname, 'src/...')`

**Step 2: 运行类型/构建验证（alias 不应破坏现有行为）**

Run:

```bash
pnpm build
```

Expected:
- build 成功（此时未改 import，alias 仅为后续做准备）

**Step 3: Commit**

```bash
git add vite.config.js
git commit -m "chore(structure): add Vite aliases for ui/pinia/styles"
```

---

## Task 2: Fix Tailwind Content Scan (Must include .vue)

**Files:**
- Modify: `tailwind.config.cjs`

**Why:** 当前配置未包含 `.vue`，会导致 Vue 模板中的 Tailwind class 可能在生产构建中缺失。

**Step 1: 扩展 `content` 覆盖 `.vue` 与 `.scss`**

Target (example):

```js
content: [
  './index.html',
  './src/**/*.{vue,js,ts,html,css,scss}',
],
```

**Step 2: 验证构建仍正常**

Run:

```bash
pnpm build
```

Expected:
- build 成功

**Step 3: Commit**

```bash
git add tailwind.config.cjs
git commit -m "chore(tailwind): include vue/scss in content scan"
```

---

## Task 3: Create New Folders (vue/components, pinia, styles)

**Files:**
- Create: `src/vue/components/` (dir)
- Create: `src/pinia/` (dir)
- Create: `src/styles/` (dir)

**Step 1: 创建目录**

Run:

```bash
mkdir -p src/vue/components src/pinia src/styles
```

Expected:
- 目录存在

**Step 2: Commit（可选，若你希望每步都落地）**

```bash
git add src/vue src/pinia src/styles
git commit -m "chore(structure): create ui/pinia/styles directories"
```

---

## Task 4: Move Vue Components to src/vue/components

**Files:**
- Move: `src/components/**` → `src/vue/components/**`
- Modify: `src/App.vue`（更新组件 import）

**Step 1: 移动组件目录**

Run:

```bash
git mv src/components src/vue/components
```

Expected:
- `src/components` 不再存在
- 组件位于 `src/vue/components/**`

**Step 2: 更新 `src/App.vue` 的 import 路径（优先用 alias）**

Current (pre):
- `./components/Crosshair.vue`
- `./components/hud/GameHud.vue`
- `./components/menu/UiRoot.vue`
- `./components/MiniMap.vue`

Target (post):
- `@ui-components/Crosshair.vue`
- `@ui-components/hud/GameHud.vue`
- `@ui-components/menu/UiRoot.vue`
- `@ui-components/MiniMap.vue`

**Step 3: 快速启动验证（最小 smoke）**

Run:

```bash
pnpm dev
```

Expected:
- 页面可加载
- 画面仍能显示 UI overlay（菜单/HUD/准星/小地图）

**Step 4: Commit**

```bash
git add src/App.vue src/vue/components
git commit -m "refactor(ui): move vue components under src/vue/components"
```

---

## Task 5: Move Pinia Stores to src/pinia and Update Imports

**Files:**
- Move:
  - `src/vue/uiStore.js` → `src/pinia/uiStore.js`
  - `src/vue/hudStore.js` → `src/pinia/hudStore.js`
  - `src/vue/settingsStore.js` → `src/pinia/settingsStore.js`
  - `src/vue/counterStore.js` → `src/pinia/counterStore.js`
- Modify: store 内互相引用与对 `src/js/**` 的引用（改用 alias）
- Modify: 受影响的 Vue 组件（当前已知 18 处引用）

**Known store import usage locations (pre-migration):**
- `src/vue/uiStore.js` (imports `./settingsStore.js`)
- `src/components/menu/SettingsMenu.vue`
- `src/components/menu/UiRoot.vue`
- `src/components/menu/MainMenu.vue`
- `src/components/menu/HowToPlay.vue`
- `src/components/menu/PauseMenu.vue`
- `src/components/hud/GameHud.vue`
- `src/components/hud/CompassWheel.vue`
- `src/components/hud/InfoPanel.vue`
- `src/components/hud/ChatBox.vue`
- `src/components/hud/Hotbar.vue`
- `src/components/hud/CoordinateDisplay.vue`
- `src/components/hud/ExperienceBar.vue`
- `src/components/hud/HungerBar.vue`
- `src/components/hud/HealthBar.vue`
- `src/vue/counterStore.js`
- `src/vue/hudStore.js`
- `src/vue/settingsStore.js`

> 注意：组件路径在 Task 4 已迁移到 `src/vue/components/**`，所以上面 `src/components/...` 在实际执行时应替换成新路径。

**Step 1: 移动 store 文件**

Run:

```bash
git mv src/vue/uiStore.js src/pinia/uiStore.js
git mv src/vue/hudStore.js src/pinia/hudStore.js
git mv src/vue/settingsStore.js src/pinia/settingsStore.js
git mv src/vue/counterStore.js src/pinia/counterStore.js
```

**Step 2: 更新 store 内部引用（全部走 alias）**

Targets:
- `src/pinia/uiStore.js`：`import { useSettingsStore } from '@pinia/settingsStore.js'`
- `src/pinia/*Store.js`：对 `../js/...` 的引用可改为 `@three/...`（若启用 `@three`）或 `@/js/...`
- `emitter` 建议用 `@/js/utils/event-bus.js` 或 `@three/utils/event-bus.js`

**Step 3: 更新所有 Vue 组件中 store 引用（全部走 alias）**

Example target:
- `import { useHudStore } from '@pinia/hudStore.js'`
- `import { useUiStore } from '@pinia/uiStore.js'`
- `import { useSettingsStore } from '@pinia/settingsStore.js'`

**Step 4: lint + build**

Run:

```bash
pnpm lint
pnpm build
```

Expected:
- 无 import not found
- 无 eslint error

**Step 5: Commit**

```bash
git add src/pinia src/vue
git commit -m "refactor(pinia): move stores to src/pinia and update imports"
```

---

## Task 6: Unify Styles to SCSS-only with Single Entry

**Files:**
- Create: `src/styles/main.scss`
- Create: `src/styles/hud.scss` (or move/rename)
- Modify: `src/main.js`（只保留一个样式入口 import）
- Modify: `src/vue/components/hud/GameHud.vue`（移除/调整对 hud.css 的直接 import）
- Optional cleanup:
  - Delete: `src/css/global.css`
  - Delete: `src/css/hud.css`
  - Delete: `src/scss/global.scss`
  - Delete: `src/css/` dir
  - Delete: `src/scss/` dir

**Step 1: 创建 `src/styles/main.scss`（作为唯一入口）**

Content guidance:
- 顶部包含 Tailwind 指令（原 `src/css/global.css` 的 3 行）
- 合并/引入旧 `src/scss/global.scss`
- 引入 `hud.scss`

**Step 2: 迁移 HUD 样式为 SCSS**

Run (rename):

```bash
git mv src/css/hud.css src/styles/hud.scss
```

**Step 3: 迁移旧 global.scss 到 styles（建议保留为 `_tokens.scss` + 业务样式）**

Run:

```bash
git mv src/scss/global.scss src/styles/_tokens.scss
```

> 如果你更偏好简单：也可以直接 `git mv src/scss/global.scss src/styles/main.scss`，再把 tailwind 指令加到顶部。

**Step 4: 更新入口 `src/main.js`**

Target:
- 删除 `import './css/global.css'`
- 删除 `import './scss/global.scss'`
- 改为 `import '@styles/main.scss'`

**Step 5: 移除组件内对旧 HUD CSS 的引用**

Target:
- `src/vue/components/hud/GameHud.vue`：删除 `import '../../css/hud.css'`

Reason:
- HUD 样式应由 `main.scss` 统一引入，避免“组件挂载才加载样式”的不确定性。

**Step 6: lint + build + dev smoke**

Run:

```bash
pnpm lint
pnpm build
pnpm dev
```

Expected:
- HUD 仍正常显示（血条/饥饿/经验/快捷栏等样式不丢）
- 菜单仍正常显示（`mc-menu`、`mc-button` 等样式存在）

**Step 7: 清理旧目录并提交**

Run:

```bash
git rm -r src/css src/scss
git add src/styles src/main.js src/vue/components/hud/GameHud.vue
git commit -m "style(styles): unify styles into src/styles SCSS single entry"
```

---

## Task 7 (Optional but Recommended): Remove Unused Legacy Entry

**Context:** `index.html` 入口为 `/src/main.js`。当前 `src/js/index.js` 引入了旧样式入口，但通常不再使用。

**Files:**
- Optional delete: `src/js/index.js`

**Step 1: 确认无引用后删除**

Run:

```bash
git rm src/js/index.js
pnpm build
```

Expected:
- build 仍成功

**Step 2: Commit**

```bash
git commit -m "chore(cleanup): remove unused legacy js entry"
```

---

## Acceptance Criteria (Done Definition)

- UI 组件全部位于 `src/vue/components/**`
- Pinia store 全部位于 `src/pinia/**`
- 工程内 UI/Store/Styles 的引用全部使用 alias（不再出现深层 `../../..`）
- 样式仅保留 SCSS：全局唯一入口 `src/styles/main.scss`，`src/main.js` 只 import 这一处
- Tailwind `content` 覆盖 `.vue`，生产构建下 Tailwind class 不丢失
- `pnpm lint` 通过
- `pnpm build` 通过
- `pnpm dev` 本地手动 smoke：菜单、HUD、准星、小地图可见且样式正常

---

## Rollback Strategy

- 每个 Task 都独立 commit：发现问题可 `git revert <commit>` 回退单步
- 若在 worktree 执行：直接删除 worktree 目录即可完全不污染主工作区
- 如果迁移中途出现大量 import 报错：优先回退到上一个可构建的 commit，再分更小步执行

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-20-project-structure-migration.md`. Two execution options:

**1. Subagent-Driven (this session)** - 我在本会话按 Task 逐个实现、每步跑验证并提交

**2. Parallel Session (separate)** - 你开新会话用 `superpowers:executing-plans` 在 worktree 中按计划执行

你希望我用哪一种方式来实际落地执行？
