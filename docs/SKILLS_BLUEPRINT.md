# Skills 架构蓝图

> **创建日期**: 2026-01-30
> **状态**: 已确定
> **来源**: Session ses_3f7065446ffenYFgiy35EBQpAw 讨论结果

---

## 1. 设计决策

### 1.1 路由系统

| 决策 | 结论 |
|------|------|
| 显式路由系统 | **舍弃** |
| LLM 自主选择 | **采用** - 依赖 skill 的 `description` 字段匹配 |

**理由**：
- 现代 agent 系统（Claude Code、OpenCode、Codex）均采用隐式路由
- LLM 天然擅长语义理解，无需额外路由规则
- 减少维护负担，routing 逻辑随 description 自动更新

### 1.2 分层架构

| 决策 | 结论 |
|------|------|
| Framework / Application 两层分离 | **舍弃** |
| 扁平结构 + 命名前缀 | **采用** |

**理由**：
- Skills 目录结构必须扁平（规范要求）
- 自定义 frontmatter 字段不会被系统解析
- 命名前缀实现零系统复杂度 + 人类可维护性

### 1.3 命名约定

| 前缀 | 归属 | 说明 |
|------|------|------|
| `vtj-` | vite-threejs 框架 | 框架层约束，跨项目复用 |
| `game-` | 本项目游戏逻辑 | 项目特定，可替换 |
| 无前缀 | 通用工作流 | 现有的 skills（brainstorming 等） |

---

## 2. 完整目录结构

```
.agent/skills/
│
├── ─────────────── 工作流 Skills（现有，17个）───────────────
│
├── brainstorming/SKILL.md                    # 创意工作前的设计探索
├── dispatching-parallel-agents/SKILL.md      # 并行 agent 调度
├── docs-write/SKILL.md                       # 文档编写
├── executing-plans/SKILL.md                  # 执行实现计划
├── finishing-a-development-branch/SKILL.md   # 完成开发分支
├── frontend-design/SKILL.md                  # 前端 UI 设计
├── receiving-code-review/SKILL.md            # 接收代码审查
├── requesting-code-review/SKILL.md           # 请求代码审查
├── skill-writer/SKILL.md                     # 编写 skills
├── subagent-driven-development/SKILL.md      # 子 agent 驱动开发
├── systematic-debugging/SKILL.md             # 系统化调试
├── test-driven-development/SKILL.md          # TDD
├── using-git-worktrees/SKILL.md              # Git worktrees
├── using-superpowers/SKILL.md                # 使用 superpowers
├── verification-before-completion/SKILL.md   # 完成前验证
├── writing-plans/SKILL.md                    # 编写计划
├── writing-skills/SKILL.md                   # 编写 skills（TDD 版）
│
├── ─────────────── vtj- 框架 Skills（新增，12个）───────────────
│
├── vtj-component-model/SKILL.md        # 3D 组件模型（Experience 单例、类组件）
├── vtj-lifecycle/SKILL.md              # 生命周期（debugInit/update/resize/destroy）
├── vtj-resource-management/SKILL.md    # 资源管理（sources.js、Resources loader）
├── vtj-state-management/SKILL.md       # 状态管理（Pinia + mitt 协同）
├── vtj-ui-integration/SKILL.md         # UI 集成（Vue ↔ Three.js 分离）
├── vtj-input-system/SKILL.md           # 输入系统（IMouse、键盘、NDC）
├── vtj-camera-system/SKILL.md          # 相机系统（Camera rig、避障）
├── vtj-raycasting-system/SKILL.md      # 射线系统（拾取、交互、碰撞检测）
├── vtj-shader-development/SKILL.md     # Shader 开发（vite-glsl、uniform）
├── vtj-debug-panel/SKILL.md            # 调试面板（Tweakpane、debugInit）
├── vtj-performance/SKILL.md            # 性能优化（InstancedMesh、LOD）
├── vtj-anti-patterns/SKILL.md          # 反模式（禁止事项）
│
├── ─────────────── game- 项目 Skills（新增，6个）───────────────
│
├── game-terrain-generation/SKILL.md    # 地形生成（Noise、FBM、Biome、PRNG）
├── game-chunk-management/SKILL.md      # 区块管理（动态加载、卸载、LOD）
├── game-player-controller/SKILL.md     # 玩家控制（第三人称、动画状态机）
├── game-combat-system/SKILL.md         # 战斗系统（攻击、格挡、连击 Combo）
├── game-portal-effect/SKILL.md         # 传送门效果（Shader、场景切换）
└── game-biome-system/SKILL.md          # 生态系统（平原/森林/沙漠/冻洋）
```

---

## 3. Skills 详细说明

### 3.1 vtj- 框架 Skills

| Skill | 职责 | 关键内容 |
|-------|------|----------|
| `vtj-component-model` | 3D 组件模型规范 | Experience 单例、类组件结构、依赖注入 |
| `vtj-lifecycle` | 生命周期管理 | debugInit / update / resize / destroy |
| `vtj-resource-management` | 资源加载与管理 | sources.js 声明、Resources loader、items 访问 |
| `vtj-state-management` | 状态同步 | Pinia 全局状态、mitt 事件通知、协同规则 |
| `vtj-ui-integration` | Vue ↔ Three.js 集成 | 职责分离、通信机制、禁止直接操作 |
| `vtj-input-system` | 输入处理 | IMouse、normalizedMouse、键盘映射 |
| `vtj-camera-system` | 相机系统 | Camera rig、第三人称跟随、避障防穿模 |
| `vtj-raycasting-system` | 射线交互 | Raycaster、NDC 坐标、拾取与碰撞 |
| `vtj-shader-development` | Shader 开发 | vite-glsl-plugin、GLSL 目录结构、uniform 管理 |
| `vtj-debug-panel` | 调试面板 | Tweakpane、addBinding、color view、面板分组 |
| `vtj-performance` | 性能优化 | InstancedMesh、LOD、合批、内存管理 |
| `vtj-anti-patterns` | 反模式 | 禁止事项、常见错误、违规示例 |

### 3.2 game- 项目 Skills

| Skill | 职责 | 关键内容 |
|-------|------|----------|
| `game-terrain-generation` | 程序化地形 | Noise、FBM、PRNG、Seed 系统 |
| `game-chunk-management` | 区块系统 | 动态加载/卸载、视距管理、内存优化 |
| `game-player-controller` | 玩家控制 | 第三人称移动、动画状态机、姿态切换 |
| `game-combat-system` | 战斗系统 | 攻击/格挡、连击 Combo、锁定目标 |
| `game-portal-effect` | 传送门 | Portal Shader、场景切换、渲染目标 |
| `game-biome-system` | 生态系统 | 平原/森林/沙漠/冻洋、生态转换、植被生成 |

---

## 4. 统计

| 分类 | 数量 | 状态 |
|------|------|------|
| 工作流 Skills（无前缀） | 17 | 现有 |
| vtj- 框架 Skills | 11 | ✅ 已完成 |
| game- 项目 Skills | 6 | 待创建 |
| **总计** | **34** | |

> **注**：`vtj-lifecycle` 已合并入 `vtj-component-model`，故 vtj- 实际为 11 个。

---

## 5. 实施计划

### Phase 1: vtj- 框架 Skills（优先）

按依赖顺序创建：
1. `vtj-component-model` - 基础，其他 skill 依赖
2. `vtj-lifecycle` - 紧密关联 component-model
3. `vtj-debug-panel` - 所有组件需要
4. 其余并行创建

### Phase 2: game- 项目 Skills

按功能模块创建，可并行。

---

## 6. 规范提醒

### SKILL.md 格式

```yaml
---
name: skill-name              # 必须与目录名一致
description: Use when...      # 只写触发条件，不写流程
---

# Skill Name

## Overview
...

## When to Use
...

## Instructions
...
```

### 关键规则

1. **扁平结构** - 所有 skills 在 `.agent/skills/` 下一级
2. **description 只写触发条件** - 不要总结 skill 流程
3. **约束内嵌** - 框架约束直接写在每个 skill 正文中
4. **TDD 创建** - 先跑 baseline 测试，再写 skill

---

## 7. 参考文档

- `AGENT_SYSTEM_CONTEXT.md` - 原始设计构想
- `AGENTS.md` - 项目开发指南
- `.agent/skills/writing-skills/SKILL.md` - Skill 编写规范
- `.agent/skills/skill-writer/SKILL.md` - Skill 创建指南
