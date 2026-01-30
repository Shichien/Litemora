# Swap Interpolation Logic: Skybox vs Fog/Lighting

## TL;DR

> **Quick Summary**: 优化 DayCycle 插值策略 - skybox 改为 smoothstep，雾气/光线也用 smoothstep，并根据贴图调整 fog 颜色
> 
> **Deliverables**:
> - `day-cycle.js` 中 `_updateSkybox()` 改为全程 smoothstep
> - `day-cycle.js` 中 `_updateLightingAndFog()` 改为 smoothstep 插值
> - 根据天空贴图调整 `phaseConfig` 中的 fog 颜色
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - sequential (single file modification)
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

---

## Context

### Original Request
用户指出 skybox 的 mix 使用 remap + smoothstep，而雾气/光线使用纯线性，认为两者应该反过来。
后续确认：skybox 使用方案 B (全程 smoothstep)，并根据贴图内容调整 fog 颜色。

### Interview Summary
**Key Discussions**:
- Skybox: 使用全程 smoothstep 实现"缓入缓出"的自然过渡
- 雾气/光线: 也使用 smoothstep 让过渡更符合人眼感知
- Fog 颜色: 根据提供的 7 张天空贴图调整，使雾气与天空协调

**Research Findings**:
- 当前 `_updateSkybox()` 使用 threshold remap (0.7-1.0) + smoothstep → 前 70% 静止
- 当前 `_updateLightingAndFog()` 使用 `_lerp()` 纯线性
- smoothstep 公式: `t * t * (3 - 2 * t)`

### 贴图分析 (用户提供的 7 张天空贴图)

| 时段 | 贴图特征 | 建议 Fog 颜色 | 当前配置 |
|------|---------|--------------|---------|
| sunrise | 粉橙→淡蓝渐变，地平线暖色 | `#e8c4a8` | `#f2c3a0` |
| morning | 清澈淡蓝，白云点缀 | `#b8daf5` | `#d9ecff` |
| noon | 明亮饱和蓝天 | `#8ecfff` | `#cfe6ff` |
| afternoon | 浅蓝偏暖，太阳西斜 | `#c8e0e8` | `#e4dccf` |
| sunset | 强烈橙红，太阳低垂 | `#d86840` | `#e79a6a` |
| dusk | 紫蓝渐变，暮光效果 | `#5848a0` | `#5b6280` |
| midnight | 深蓝黑，星空月亮 | `#141820` | `#1d1f26` |

**色域注意**:
- 贴图使用 `THREE.SRGBColorSpace`
- `THREE.Color` 内部使用线性空间，hex 设置会自动转换
- 雾气混合可能需要微调以匹配视觉感受
- 最终效果需要在浏览器中实际验证

---

## Work Objectives

### Core Objective
改善昼夜循环的视觉过渡效果，让调试更直观，雾气与天空更协调

### Concrete Deliverables
- 修改 `src/js/world/day-cycle.js` 的插值逻辑和颜色配置

### Definition of Done
- [ ] Skybox 使用全程 smoothstep 过渡（无延迟启动）
- [ ] 雾气/光线变化有"缓入缓出"的自然感觉
- [ ] Fog 颜色与天空贴图视觉协调
- [ ] Debug 面板调参时视觉反馈更直观

### Must Have
- Skybox: 全程 smoothstep `progress * progress * (3 - 2 * progress)`
- 雾气/光线: smoothstep 插值
- Fog 颜色: 根据贴图调整的新配置

### Must NOT Have (Guardrails)
- 不修改 `phaseRanges` 时间范围
- 不修改 shader 文件
- 不添加新的配置参数结构

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO (E2E only, no unit tests for this module)
- **User wants tests**: Manual-only
- **Framework**: none

### Manual QA Procedures

**验证方法**: 使用 Debug 面板调整 timeOfDay 观察过渡效果

1. 启动开发服务器 `pnpm dev`
2. 访问 `http://localhost:5173/#debug`
3. 在 Day Cycle 面板中：
   - 关闭 Auto Play
   - 手动拖动 Time of Day 滑块
4. 观察 sunrise → morning → noon 等阶段过渡
5. 确认：
   - 天空贴图过渡从开始就有变化（无静止段）
   - 雾气颜色与天空视觉协调
   - 过渡有"缓入缓出"感

---

## TODOs

- [ ] 1. 修改 `_updateSkybox()` - 改为全程 smoothstep

  **What to do**:
  - 移除 threshold remap 逻辑 (progress > 0.7 判断)
  - 直接对整个 progress 应用 smoothstep
  - 公式: `mixFactor = progress * progress * (3 - 2 * progress)`

  **Must NOT do**:
  - 不修改 `setTextures()` 调用
  - 不修改贴图选择逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References**:
  - `src/js/world/day-cycle.js:383-407` - 当前 `_updateSkybox()` 实现

  **Acceptance Criteria**:
  - [ ] 移除 `if (progress > 0.7)` 条件
  - [ ] `mixFactor = progress * progress * (3 - 2 * progress)` 应用于全程

  **Commit**: NO (groups with Task 3)

---

- [ ] 2. 修改 `_updateLightingAndFog()` - 应用 smoothstep

  **What to do**:
  - 在方法开头计算 smoothstep progress: `const smoothProgress = progress * progress * (3 - 2 * progress)`
  - 将所有 `_lerp()` 和 `_lerpColor()` 调用中的 `progress` 替换为 `smoothProgress`

  **Must NOT do**:
  - 不修改 `_lerp()` 和 `_lerpColor()` 方法本身
  - 不修改 environment 对象的更新逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `src/js/world/day-cycle.js:409-448` - 当前 `_updateLightingAndFog()` 实现

  **Acceptance Criteria**:
  - [ ] 新增 `smoothProgress` 变量
  - [ ] 所有 6 处插值调用使用 `smoothProgress`:
    - sunIntensity
    - sunColor
    - ambientIntensity
    - ambientColor
    - fogDensity
    - fogColor

  **Commit**: NO (groups with Task 3)

---

- [ ] 3. 更新 `phaseConfig` 中的 fog 颜色

  **What to do**:
  根据天空贴图视觉特征，更新各时段的 fog.color：
  
  ```javascript
  sunrise:   fog.color: '#e8c4a8'  // 粉橙暖色
  morning:   fog.color: '#b8daf5'  // 清澈淡蓝
  noon:      fog.color: '#8ecfff'  // 明亮蓝
  afternoon: fog.color: '#c8e0e8'  // 浅蓝偏暖
  sunset:    fog.color: '#d86840'  // 橙红
  dusk:      fog.color: '#5848a0'  // 紫蓝
  midnight:  fog.color: '#141820'  // 深蓝黑
  ```

  **Must NOT do**:
  - 不修改 sunIntensity / ambientIntensity 等强度值（除非测试后明显不协调）
  - 不修改 fog.density 值

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:
  - `src/js/world/day-cycle.js:100-186` - 当前 `phaseConfig` 定义
  - 用户提供的天空贴图截图（7 张）

  **Acceptance Criteria**:
  - [ ] 7 个时段的 fog.color 全部更新
  - [ ] 颜色值使用 hex 格式

  **Commit**: YES
  - Message: `fix(day-cycle): use smoothstep for skybox/fog interpolation and adjust fog colors`
  - Files: `src/js/world/day-cycle.js`
  - Pre-commit: `pnpm lint`

---

- [ ] 4. 手动验证视觉效果

  **What to do**:
  - 启动 dev server
  - 访问 `/#debug`
  - 手动调节 timeOfDay，观察日出/日落过渡
  - 特别关注雾气与天空的颜色匹配

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`playwright`, `verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (final)
  - **Blocks**: None
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] 天空过渡从开始就有变化，无"延迟启动"
  - [ ] 雾气/光线变化有自然的"缓入缓出"感
  - [ ] 雾气颜色与天空视觉协调（无明显断层）
  - [ ] lint 通过

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 3 | `fix(day-cycle): use smoothstep for skybox/fog interpolation and adjust fog colors` | day-cycle.js | pnpm lint |

---

## Success Criteria

### Verification Commands
```bash
pnpm lint  # Expected: no errors
pnpm dev   # Start server for manual testing
```

### Final Checklist
- [ ] Skybox 使用全程 smoothstep 插值
- [ ] 雾气/光线使用 smoothstep 插值
- [ ] Fog 颜色与天空贴图协调
- [ ] 代码风格符合项目规范
- [ ] 视觉效果改善
