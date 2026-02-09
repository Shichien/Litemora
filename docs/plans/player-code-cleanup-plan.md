# 玩家移动与碰撞系统代码清理计划书

> 清理 `@src/js/world/player/` 目录下的无用代码和冗余代码

## 📋 项目信息

| 项目 | 内容 |
|------|------|
| **目标** | 移除死代码，简化冗余逻辑，提升可维护性 |
| **范围** | `src/js/world/player/` 目录下的 8 个文件 |
| **预计收益** | 减少约 150 行死代码，优化代码结构 |
| **计划时间** | 2026-02-09 |

---

## 🎯 任务总览

```
Phase 1: 删除死代码 (Dead Code)      ████████░░ 8项任务
Phase 2: 简化冗余代码                 ██████░░░░ 6项任务
Phase 3: 优化与重构                   ████░░░░░░ 2项任务
```

---

## Phase 1: 删除死代码 (Dead Code)

### 1.1 删除 GROUND_CHECK 常量

**文件**: `src/js/config/player-config.js`  
**行号**: 14-18  
**内容**:

```javascript
// 删除以下未使用的常量
GROUND_CHECK_RAY_OFFSET: 0.1,
GROUND_CHECK_DISTANCE: 0.25,
GROUND_CHECK_TOLERANCE: 0.2,
GROUND_CHECK_MAX_FALL_SPEED: 0.5,
```

**原因**: 碰撞系统使用胶囊体-AABB 相交检测，完全不依赖射线检测  
**影响**: 无，已通过全局搜索确认无引用

---

### 1.2 删除 `_snapToGround()` 方法

**文件**: `src/js/world/player/player-movement-controller.js`  
**行号**: 325-382 (58 行)  
**内容**: 整个 `_snapToGround()` 方法

**原因**:
- 方法在 Line 139 被注释掉的调用: `// this._snapToGround(playerState, provider)`
- 碰撞解析系统已自然处理地面贴合
- 保留会导致代码理解负担

**关联删除**:
- Line 139: 删除注释掉的调用语句

---

### 1.3 删除 `_getTopSolidY()` 辅助方法

**文件**: `src/js/world/player/player-movement-controller.js`  
**行号**: 389-398 (10 行)  
**内容**: 整个 `_getTopSolidY()` 方法

**原因**:
- 仅被已标记删除的 `_snapToGround()` 方法调用
- 无其他外部引用

---

### 1.4 删除 `RIGHT_BLOCK` 动画配置

**文件**: `src/js/world/player/animation-config.js`

**删除位置**:

| 行号 | 内容 |
|------|------|
| 42 | `RIGHT_BLOCK: 'right_block',` |
| 73 | `[AnimationClips.RIGHT_BLOCK]: { timeScale: 1.0, category: AnimationCategories.COMBAT, loop: THREE.LoopOnce },` |
| 128 | `AnimationClips.RIGHT_BLOCK,` (在 CombatAnimations 数组中) |
| 178 | `[AnimationClips.RIGHT_BLOCK]: 'block',` (在 animationSubGroupMap 中) |

**原因**:
- 已定义但从未被触发
- 战斗系统只使用 `BLOCK` (left_block)

**决策**: 删除而非实现，因为需求中未明确右手格挡功能

---

### 1.5 删除 `TPOSE` 动画配置

**文件**: `src/js/world/player/animation-config.js`

**删除位置**:

| 行号 | 内容 |
|------|------|
| 44 | `TPOSE: 'tpose',` |
| 180 | `[AnimationClips.TPOSE]: 'idle',` (在 animationSubGroupMap 中) |

**原因**:
- 仅在皮肤选择 UI 显示，从未实际播放
- 映射到 'idle' 是冗余的

**注意**: `skin-config.js` 中的 UI 引用保留，仅删除动画系统配置

---

## Phase 2: 简化冗余代码

### 2.1 删除 `terrainProvider` 冗余引用

**文件**: `src/js/world/player/player-movement-controller.js`  
**行号**: 32, 135, 256

**修改内容**:

```javascript
// 修改前 (Line 32)
this.terrainProvider = this.experience.terrainDataManager

// 修改前 (Line 135)
const provider = this.experience.terrainDataManager || this.terrainProvider

// 修改前 (Line 256)
const provider = this.experience.terrainDataManager || this.terrainProvider
```

```javascript
// 修改后: 直接访问，无需冗余变量
const provider = this.experience.terrainDataManager
```

**原因**:
- `terrainProvider` 初始化后永不被修改
- 回退逻辑 `|| this.terrainProvider` 无实际意义

---

### 2.2 简化 `isGrounded` 状态保持逻辑

**文件**: `src/js/world/player/player-movement-controller.js`  
**行号**: 144-151

**修改前**:

```javascript
// 状态保持：如果上一帧是 grounded，且当前没有明显上升速度，保持 grounded 状态
if (this.isGrounded && !playerState.isGrounded && playerState.worldVelocity.y < 0.5) {
  playerState.isGrounded = true
}
// 如果明显上升（跳跃），则清除 grounded 状态
if (playerState.worldVelocity.y > 1.0) {
  playerState.isGrounded = false
}

this.isGrounded = playerState.isGrounded
```

**修改后**:

```javascript
// 直接信任碰撞系统的检测结果
this.isGrounded = playerState.isGrounded
```

**原因**:
- 碰撞解析器已正确设置 `isGrounded`
- 额外的状态保持逻辑可能引入浮空 bug
- 简化后逻辑更清晰

---

### 2.3 提取重复的动画数组为常量

**文件**: `src/js/world/player/animation-config.js` (新增)  
**文件**: `src/js/world/player/player-animation-controller.js` (修改)

**新增内容** (animation-config.js):

```javascript
// ===== Blend Tree 动画列表 =====
export const BLEND_ANIMATIONS = Object.freeze([
  AnimationClips.IDLE,
  AnimationClips.WALK_FORWARD,
  AnimationClips.WALK_BACK,
  AnimationClips.WALK_LEFT,
  AnimationClips.WALK_RIGHT,
  AnimationClips.RUN_FORWARD,
  AnimationClips.RUN_BACK,
  AnimationClips.RUN_LEFT,
  AnimationClips.RUN_RIGHT,
  AnimationClips.SNEAK_FORWARD,
  AnimationClips.SNEAK_BACK,
  AnimationClips.SNEAK_LEFT,
  AnimationClips.SNEAK_RIGHT,
])
```

**修改位置**:

| 文件 | 行号 | 操作 |
|------|------|------|
| `player-animation-controller.js` | 54-68 | 替换为使用 `BLEND_ANIMATIONS` |
| `player-animation-controller.js` | 192-206 | 替换为使用 `BLEND_ANIMATIONS` |
| `player-animation-controller.js` | 239-253 | 替换为使用 `BLEND_ANIMATIONS` |

**原因**:
- 同一数组在三个方法中重复定义
- 维护成本高，容易遗漏更新

---

### 2.4 删除重复注释

**文件**: `src/js/world/player/player.js`  
**行号**: 480-481

**修改前**:

```javascript
// ===== 速度控制 =====

// ===== 速度控制 =====
```

**修改后**:

```javascript
// ===== 速度控制 =====
```

---

### 2.5 清理导入语句

**文件**: `src/js/world/player/player-movement-controller.js`  
**行号**: 1-6

**修改内容**:

```javascript
// 检查 blocks 导入是否仍需要
import { blocks } from '../terrain/blocks-config.js'
```

若删除 `_getTopSolidY` 后无其他引用，则删除此导入。

---

## Phase 3: 优化与重构

### 3.1 验证常量导出

**文件**: `src/js/world/player/animation-config.js`

确保新增的 `BLEND_ANIMATIONS` 常量已正确导出：

```javascript
export {
  AnimationCategories,
  AnimationStates,
  AnimationClips,
  animationSettings,
  transitionDurations,
  LocomotionProfiles,
  CombatAnimations,
  timeScaleConfig,
  animationSubGroupMap,
  BLEND_ANIMATIONS,  // 新增
}
```

---

### 3.2 更新导入语句

**文件**: `src/js/world/player/player-animation-controller.js`  
**行号**: 1-13

**修改内容**:

```javascript
import {
  AnimationCategories,
  AnimationClips,
  animationSettings,
  AnimationStates,
  animationSubGroupMap,
  BLEND_ANIMATIONS,  // 新增
  BLEND_DIRECTIONS,
  LocomotionProfiles,
  timeScaleConfig,
  transitionDurations,
} from './animation-config.js'
```

---

## ⚠️ 风险评估

| 风险点 | 等级 | 描述 | 缓解措施 |
|--------|------|------|----------|
| `_snapToGround` 未来可能需要 | 🟢 低 | 地面吸附功能预留 | Git 历史可追溯，当前确实无调用 |
| `RIGHT_BLOCK` 是预留功能 | 🟢 低 | 右手格挡未实现 | 需求明确后可重新添加 |
| isGrounded 简化导致抖动 | 🟡 中 | 地面检测可能不稳定 | 重点测试跳跃和边缘行走 |
| 常量删除影响外部模块 | 🟢 低 | 其他文件可能引用 | 已全局搜索确认安全 |

---

## ✅ 测试验证清单

### 核心功能测试

- [ ] **基础移动**: W/A/S/D 移动正常
- [ ] **姿态切换**: Shift 奔跑、V 蹲行正常
- [ ] **跳跃落地**: 空格跳跃，落地检测正常
- [ ] **动画混合**: 走/跑/蹲动画平滑过渡
- [ ] **战斗动画**: Z 直拳、X 勾拳、C 格挡正常
- [ ] **重生机制**: 跌落重生到正确位置

### 碰撞测试

- [ ] **地面行走**: 不会穿过地形
- [ ] **跳跃碰撞**: 跳起和落下正常
- [ ] **边缘检测**: 走在方块边缘不会异常坠落
- [ ] **墙体碰撞**: 无法穿过墙体

### 性能验证

- [ ] **帧率稳定**: 清理后帧率无下降
- [ ] **内存使用**: 无内存泄漏

---

## 📊 预期收益

| 指标 | 数值 |
|------|------|
| **删除代码行数** | ~150 行 |
| **修改文件数** | 5 个 |
| **新增常量** | 1 个 (`BLEND_ANIMATIONS`) |
| **删除常量** | 7 个 (`GROUND_CHECK_*`, `RIGHT_BLOCK`, `TPOSE`) |
| **删除方法** | 2 个 (`_snapToGround`, `_getTopSolidY`) |
| **性能提升** | 极轻微 (减少死代码解析) |
| **可维护性** | ⬆️ 显著提升 |

---

## 📝 提交规范

本次清理将遵循 **Conventional Commits** 规范，使用以下提交信息：

```
refactor(player): 清理无用代码和冗余代码

- 删除未使用的 GROUND_CHECK 常量 (player-config.js)
- 移除 _snapToGround 和 _getTopSolidY 死代码 (player-movement-controller.js)
- 删除未触发的 RIGHT_BLOCK 和 TPOSE 动画配置 (animation-config.js)
- 简化 terrainProvider 引用逻辑，删除冗余回退
- 简化 isGrounded 状态处理，信任碰撞系统
- 提取重复的 BLEND_ANIMATIONS 常量
- 修复重复注释

BREAKING CHANGE: 删除了 RIGHT_BLOCK 和 TPOSE 动画配置，
如需使用需在 animation-config.js 中重新添加
```

---

## 🔍 代码审查要点

审查时请重点关注：

1. **isGrounded 简化** 是否导致跳跃/落地异常
2. **BLEND_ANIMATIONS 常量** 是否正确导出和导入
3. **terrainProvider 删除** 后是否还有隐藏引用
4. **删除的动画** 是否确实从未被触发

---

## 📚 附录

### A. 相关文件清单

```
src/
├── js/
│   ├── config/
│   │   └── player-config.js          # 删除 GROUND_CHECK 常量
│   └── world/
│       └── player/
│           ├── animation-config.js   # 删除动画配置，添加 BLEND_ANIMATIONS
│           ├── player-animation-controller.js  # 使用常量，删除重复数组
│           ├── player-movement-controller.js   # 删除方法，简化逻辑
│           └── player.js             # 删除重复注释
```

### B. 参考文档

- [Conventional Commits](https://www.conventionalcommits.org/)
- 项目 AGENTS.md 开发规范

---

**计划制定**: Claude Code (Sisyphus)  
**制定时间**: 2026-02-09  
**预计执行时间**: 15-20 分钟  
**状态**: 🟡 待执行
