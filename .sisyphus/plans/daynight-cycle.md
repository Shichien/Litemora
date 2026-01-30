# Day/Night Cycle System - 昼夜循环系统

## Context

### Original Request
用户需要为 Third-Person-MC 项目实现昼夜循环系统，营造场景环境氛围。

### Interview Summary
**Key Discussions**:
- **功能范围**: 纯视觉氛围，不影响 gameplay（无怪物刷新、作物生长等逻辑）
- **天空渲染**: 天空盒图片切换 + 光照/雾气调整
- **时间控制**: Tweakpane 手动调试 + 可开关的自动循环模式
- **一天周期**: 20分钟 = 游戏一天（与 Minecraft 一致）
- **HUD显示**: 仅显示当前时间

**光照效果决策**:
- ✅ 太阳轨迹移动（东升西落）
- ✅ 夜间月光（冷色弱光源）
- ✅ 雾气颜色同步（随时间变化）
- ✅ 雾气强度变化
- ❌ 日出日落渐变色（不做）
- ❌ 星空效果（不做）

### Research Findings (Updated after Review)

**已存在的资源（可直接复用）**:
- **天空盒贴图**: `public/textures/background/` 已有 7 张
  - `sunrise.png`, `morning.png`, `noon.png`, `afternoon.png`, `sundown.png`, `dusk.png`, `midnight.png`
- **HUD 时间显示**: `InfoPanel.vue` 已显示 `hud.gameTime` 和 `hud.gameDay`
- **时间状态**: `hudStore.js` 已有 `gameTime` (ref) 和 `gameDay` (ref)

**需要新建/修改的**:
- `src/js/world/day-cycle.js` — 昼夜循环核心类
- `src/js/sources.js` — 注册 7 张天空盒贴图
- `src/js/world/environment.js` — 集成 DayCycle
- `src/pinia/hudStore.js` — 添加时间更新方法

---

## Work Objectives

### Core Objective
实现一个完整的昼夜循环系统，通过天空盒切换、光照变化、雾气同步来营造动态的场景氛围，复用现有 HUD 显示游戏时间。

### Concrete Deliverables
1. `src/js/sources.js` 更新 - 注册 7 张天空盒贴图
2. `src/js/world/day-cycle.js` - 昼夜循环核心类
3. `src/js/world/environment.js` 更新 - 集成 DayCycle 系统
4. `src/pinia/hudStore.js` 更新 - 添加时间更新方法

### Definition of Done
- [ ] 时间自动循环：20分钟完成一个完整的昼夜周期
- [ ] 天空盒在 7 个时段间切换
- [ ] 太阳/月亮光源随时间移动（弧形轨迹）
- [ ] 雾气颜色和密度随时间变化
- [ ] InfoPanel HUD 显示当前游戏时间（已有，自动更新）
- [ ] Tweakpane 面板可手动控制时间、暂停循环

### Must Have
- 7 张天空盒贴图正确加载和切换
- 太阳轨迹移动（东升西落弧形）
- 夜间月光光源
- 雾气颜色 + 密度同步
- HUD 时间显示（复用 InfoPanel）
- Tweakpane 调试控制

### Must NOT Have (Guardrails)
- ❌ 不添加 gameplay 逻辑（怪物刷新、作物生长等）
- ❌ 不实现日出日落渐变色（保持简单）
- ❌ 不实现星空粒子效果
- ❌ 不修改 InfoPanel.vue 的布局和样式
- ❌ 不新建 TimeDisplay 组件（复用 InfoPanel）
- ❌ 不新建 timeStore（扩展 hudStore）

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (Playwright)
- **User wants tests**: NO
- **Framework**: N/A
- **QA approach**: 手动验证 — Tweakpane 调试 + 视觉检查

### Manual QA Procedures

每个 TODO 完成后，通过以下方式验证：

1. **启动开发服务器**: `pnpm dev`
2. **进入 Debug 模式**: 访问 `http://localhost:xxxx/#debug`
3. **Tweakpane 验证**: 在 Environment / Day Cycle 面板中操作
4. **视觉检查**: 观察天空、光照、雾气变化

---

## Task Flow

```
Task 1 (sources.js 注册贴图)
    ↓
Task 2 (hudStore 扩展时间方法)
    ↓
Task 3 (DayCycle 核心类) ←-- 依赖 Task 1, 2
    ↓
Task 4 (Environment 集成)
    ↓
Task 5 (最终验证)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 1, 2 | sources.js 和 hudStore 扩展相互独立 |

| Task | Depends On | Reason |
|------|------------|--------|
| 3 | 1, 2 | DayCycle 需要贴图资源和 hudStore 方法 |
| 4 | 3 | Environment 集成需要 DayCycle 类 |
| 5 | 4 | 最终验证需要所有功能完成 |

---

## TODOs

- [ ] 1. 在 sources.js 中注册天空盒贴图资源

  **What to do**:
  - 在 `src/js/sources.js` 中添加 7 个天空盒贴图的资源声明
  - 使用 `type: 'texture'` 类型
  - 路径指向 `textures/background/` 目录下的现有贴图

  **Must NOT do**:
  - 不删除或修改现有资源声明
  - 不修改 backgroundTexture（保持现有 HDR 切换功能）

  **Parallelizable**: YES (与 Task 2 并行)

  **References**:
  - `src/js/sources.js:26-29` — 现有 backgroundTexture 声明格式
  - `public/textures/background/` — 7 张贴图文件名

  **贴图文件名**（已存在）:
  - `sunrise.png`
  - `morning.png`
  - `noon.png`
  - `afternoon.png`
  - `sundown.png` (注意: 不是 sunset)
  - `dusk.png`
  - `midnight.png`

  **代码示例**:
  ```javascript
  // ===== 天空盒贴图（昼夜循环）=====
  {
    name: 'sky_sunriseTexture',
    type: 'texture',
    path: 'textures/background/sunrise.png',
  },
  {
    name: 'sky_morningTexture',
    type: 'texture',
    path: 'textures/background/morning.png',
  },
  {
    name: 'sky_noonTexture',
    type: 'texture',
    path: 'textures/background/noon.png',
  },
  {
    name: 'sky_afternoonTexture',
    type: 'texture',
    path: 'textures/background/afternoon.png',
  },
  {
    name: 'sky_sundownTexture',
    type: 'texture',
    path: 'textures/background/sundown.png',
  },
  {
    name: 'sky_duskTexture',
    type: 'texture',
    path: 'textures/background/dusk.png',
  },
  {
    name: 'sky_midnightTexture',
    type: 'texture',
    path: 'textures/background/midnight.png',
  },
  ```

  **Acceptance Criteria**:
  - [ ] sources.js 包含 7 个新的 sky_* 资源声明
  - [ ] `pnpm dev` 启动无报错
  - [ ] 在 console 中确认资源加载：`this.experience.resources.items['sky_sunriseTexture']` 存在

  **Commit**: YES
  - Message: `feat(resources): register 7 sky textures for day/night cycle`
  - Files: `src/js/sources.js`

---

- [ ] 2. 扩展 hudStore 添加时间更新方法

  **What to do**:
  - 在 `src/pinia/hudStore.js` 中添加：
    - `timeOfDay` ref: 0-1 浮点数，表示一天中的时间点
    - `updateGameTime(timeOfDay)` 方法: 根据 timeOfDay 更新 gameTime 和 gameDay
    - `currentPhase` computed: 返回当前时段名称
  - 复用现有的 `gameTime` 和 `gameDay` ref

  **Must NOT do**:
  - 不修改现有 hudStore 的其他功能
  - 不在 store 中处理 3D 渲染逻辑

  **Parallelizable**: YES (与 Task 1 并行)

  **References**:
  - `src/pinia/hudStore.js:80-85` — 现有 gameTime, gameDay 定义
  - `src/pinia/hudStore.js:264-307` — 返回的 public API 结构

  **时段划分逻辑** (基于 timeOfDay 0-1):
  ```
  0.00 - 0.04: midnight (午夜)
  0.04 - 0.12: sunrise (日出)
  0.12 - 0.25: morning (早晨)
  0.25 - 0.42: noon (正午)
  0.42 - 0.58: afternoon (下午)
  0.58 - 0.71: sundown (日落)
  0.71 - 0.83: dusk (黄昏)
  0.83 - 1.00: midnight (午夜)
  ```

  **时间格式化逻辑**:
  ```javascript
  // timeOfDay 0 = 00:00, 0.5 = 12:00, 1 = 24:00
  const hours = Math.floor(timeOfDay * 24)
  const minutes = Math.floor((timeOfDay * 24 - hours) * 60)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  gameTime.value = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
  ```

  **Acceptance Criteria**:
  - [ ] hudStore 新增 `timeOfDay` ref
  - [ ] hudStore 新增 `updateGameTime(timeOfDay)` 方法
  - [ ] hudStore 新增 `currentPhase` computed
  - [ ] 调用 updateGameTime(0.25) 时，gameTime 显示 "6:00 AM"
  - [ ] InfoPanel 自动显示更新后的时间（无需修改 InfoPanel）

  **Commit**: YES
  - Message: `feat(hudStore): add time update methods for day/night cycle`
  - Files: `src/pinia/hudStore.js`

---

- [ ] 3. 创建 DayCycle 核心类

  **What to do**:
  - 创建 `src/js/world/day-cycle.js`
  - 实现 DayCycle 类，遵循项目组件模式：
    - 通过 Experience 单例获取依赖
    - 管理太阳光源位置（弧形轨迹）
    - 管理月光光源（夜间）
    - 管理天空盒切换
    - 管理雾气颜色和密度插值
    - 通过 hudStore 更新时间显示
    - 实现 `debugInit()` 提供 Tweakpane 控制面板
    - 实现 `update()` 每帧更新

  **Must NOT do**:
  - 不直接修改 Environment 的现有逻辑
  - 不添加 gameplay 触发器

  **Parallelizable**: NO (依赖 Task 1, 2)

  **References**:
  - `src/js/world/environment.js` — 组件结构、光照管理、Tweakpane 模式
  - `src/js/world/environment.js:210-233` — update() 方法结构
  - `src/js/world/environment.js:236-368` — debugInit() 面板结构
  - `src/js/world/environment.js:83-127` — 光源创建模式
  - `src/pinia/hudStore.js` — 时间更新方法

  **核心参数设计**:
  ```javascript
  this.params = {
    // 时间控制
    timeOfDay: 0.25,        // 0-1, 默认早晨
    autoPlay: true,         // 自动循环
    dayDuration: 20 * 60 * 1000, // 20分钟

    // 太阳轨迹
    sunOrbitRadius: 100,    // 太阳轨道半径
    sunOrbitHeight: 80,     // 最高点高度

    // 月光
    moonIntensity: 0.3,     // 月光强度
    moonColor: '#8090b0',   // 冷色调

    // 雾气配置（每个时段）
    fogConfigs: {
      sunrise:   { color: '#f5d0a9', density: 0.012 },
      morning:   { color: '#c9e4f7', density: 0.008 },
      noon:      { color: '#989490', density: 0.006 },
      afternoon: { color: '#d4c8b8', density: 0.008 },
      sundown:   { color: '#e8a87c', density: 0.012 },
      dusk:      { color: '#5c6080', density: 0.015 },
      midnight:  { color: '#1a1a2e', density: 0.02 },
    }
  }
  ```

  **时段对应贴图**:
  | Phase | Texture Name |
  |-------|--------------|
  | sunrise | sky_sunriseTexture |
  | morning | sky_morningTexture |
  | noon | sky_noonTexture |
  | afternoon | sky_afternoonTexture |
  | sundown | sky_sundownTexture |
  | dusk | sky_duskTexture |
  | midnight | sky_midnightTexture |

  **HUD 更新方式**:
  ```javascript
  // 在 update() 中调用 hudStore 方法
  import { useHudStore } from '@pinia/hudStore.js'
  const hud = useHudStore()
  hud.updateGameTime(this.params.timeOfDay)
  ```

  **Acceptance Criteria**:
  - [ ] 文件 `src/js/world/day-cycle.js` 存在
  - [ ] DayCycle 类可被实例化
  - [ ] `update()` 方法正确更新太阳位置
  - [ ] 月光在夜间显示，白天隐藏
  - [ ] 天空盒正确切换
  - [ ] 雾气颜色/密度随时间插值
  - [ ] hudStore 的 gameTime/gameDay 自动更新

  **Commit**: YES
  - Message: `feat(world): add DayCycle class for day/night system`
  - Files: `src/js/world/day-cycle.js`

---

- [ ] 4. 在 Environment 中集成 DayCycle

  **What to do**:
  - 在 `src/js/world/environment.js` 中：
    - Import DayCycle 类
    - 在构造函数中实例化 `this.dayCycle = new DayCycle()`
    - 在 `update()` 中调用 `this.dayCycle.update()`
    - 在 `destroy()` 中清理 DayCycle 资源
  - 将 DayCycle 的 Tweakpane 面板添加到 Environment 的调试面板中

  **Must NOT do**:
  - 不破坏现有的光照、雾气手动控制功能
  - 不删除现有的 HDR/Image 背景切换功能

  **Parallelizable**: NO (依赖 Task 3)

  **References**:
  - `src/js/world/environment.js:35-38` — 构造函数中的初始化顺序
  - `src/js/world/environment.js:210-233` — update() 调用模式
  - `src/js/world/environment.js:371-395` — destroy() 清理模式

  **Acceptance Criteria**:
  - [ ] Environment 正确实例化 DayCycle
  - [ ] `pnpm dev` 启动无报错
  - [ ] Tweakpane 中出现 "Day Cycle" 控制面板
  - [ ] 调整时间滑块，天空/光照/雾气正确变化
  - [ ] InfoPanel 时间显示自动更新

  **Manual Verification**:
  - [ ] 启动 `pnpm dev`，访问 `/#debug`
  - [ ] 在 Tweakpane 中找到 Environment → Day Cycle 面板
  - [ ] 拖动 "Time of Day" 滑块，观察：
    - 天空盒切换
    - 太阳位置移动
    - 雾气颜色变化
    - InfoPanel 时间更新
  - [ ] 切换 "Auto Play" 开关，验证自动循环

  **Commit**: YES
  - Message: `feat(environment): integrate DayCycle into Environment`
  - Files: `src/js/world/environment.js`

---

- [ ] 5. 最终验证和调优

  **What to do**:
  - 完整测试昼夜循环的所有功能
  - 调整参数确保视觉效果自然
  - 验证性能（确保无明显帧率下降）
  - 测试 Tweakpane 所有控制功能

  **Must NOT do**:
  - 不在此阶段添加新功能
  - 不修改已通过验证的逻辑

  **Parallelizable**: NO (最终验证任务)

  **Full Verification Checklist**:
  - [ ] **时间循环**: 自动播放 20 分钟完成一个完整周期
  - [ ] **天空盒切换**: 7 个时段正确切换
  - [ ] **太阳轨迹**: 从东边升起，经过头顶，西边落下
  - [ ] **月光**: 夜间（dusk → midnight → sunrise）有冷色光源
  - [ ] **雾气颜色**: 随时段变化，与天空协调
  - [ ] **雾气密度**: 夜间更浓，白天更淡
  - [ ] **HUD 显示**: InfoPanel 时间正确更新，格式正确
  - [ ] **Tweakpane 控制**:
    - [ ] Time of Day 滑块有效
    - [ ] Auto Play 开关有效
    - [ ] Day Duration 可调
    - [ ] 雾气参数可调
  - [ ] **性能**: 帧率稳定，无卡顿

  **Commit**: YES
  - Message: `feat(daynight): complete day/night cycle system`
  - Files: 根据调优修改的文件

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(resources): register 7 sky textures for day/night cycle` | `src/js/sources.js` | `pnpm dev` 无报错 |
| 2 | `feat(hudStore): add time update methods for day/night cycle` | `src/pinia/hudStore.js` | 方法可调用 |
| 3 | `feat(world): add DayCycle class for day/night system` | `src/js/world/day-cycle.js` | 类可实例化 |
| 4 | `feat(environment): integrate DayCycle into Environment` | `src/js/world/environment.js` | Tweakpane 面板可见 |
| 5 | `feat(daynight): complete day/night cycle system` | 根据调优 | 完整验证通过 |

---

## Success Criteria

### Verification Commands
```bash
pnpm dev          # 启动开发服务器，无报错
pnpm lint         # 代码检查通过
```

### Final Checklist
- [ ] 所有 7 张天空盒贴图加载成功
- [ ] 20 分钟完成一个完整的昼夜循环
- [ ] 太阳轨迹自然（东升西落弧形）
- [ ] 夜间有月光光源
- [ ] 雾气颜色和密度随时间变化
- [ ] InfoPanel HUD 显示当前游戏时间
- [ ] Tweakpane 可控制时间和参数
- [ ] 无明显性能下降
- [ ] 代码符合项目规范（ESLint 通过）
