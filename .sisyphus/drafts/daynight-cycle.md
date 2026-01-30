# Draft: Day/Night Cycle System

## Research Findings

### Current State
- **Lighting**: `Environment.js` manages `DirectionalLight` (sunLight) and `AmbientLight`
- **Sky**: Static HDR/image background textures, no procedural sky
- **Fog**: `THREE.FogExp2` with static color `#989490`
- **Time Uniform**: `uTime` exists but only used for wind animations
- **Sun Position**: Static offset relative to player, no rotation

### Key Files
- `/src/js/world/environment.js` — Main lighting, fog, background
- `/src/js/renderer.js` — Tone mapping, bloom, shadows
- `/src/shaders/includes/directionalLight.glsl` — Custom light calculations
- `/src/shaders/blocks/ao.frag.glsl` — Ambient occlusion for voxels

### Architecture Fit
- `Environment.update()` is called every frame - natural place for time logic
- Can use `this.experience.time.delta` for time progression
- Debug UI (Tweakpane) already integrated for parameter tweaking

## Requirements (confirmed)
- **功能范围**: 纯视觉氛围，不影响 gameplay（无怪物刷新、作物生长等逻辑）
- **天空渲染**: B+C 组合 — 天空盒图片切换（白天/傍晚/夜晚淡入淡出）+ 光照雾气颜色同步调整
- **时间控制**: Tweakpane 手动调试 + 可开关的自动循环模式
- **光照效果**:
  - ✅ 太阳轨迹移动（东升西落）
  - ✅ 夜间月光（冷色弱光源）
  - ✅ 雾气颜色同步（随时间变化）
  - ✅ 雾气强度变化（比如夜晚更浓？）
  - ❌ 日出日落渐变色（不做）
  - ❌ 星空效果（不做）
- **HUD 显示**: 仅显示当前时间（简洁）
- **一天周期**: 20分钟 = 游戏一天（与 Minecraft 一致）
- **天空盒贴图**: 7张（nano banana pro 生成）
  - sunrise（日出）
  - morning（早晨）
  - noon（正午）
  - afternoon（下午）
  - sunset（日落）
  - dusk（黄昏）
  - midnight（午夜）

## Technical Decisions
- [pending]

## Test Strategy Decision
- **Infrastructure exists**: YES (Playwright)
- **User wants tests**: NO
- **QA approach**: 手动验证 — Tweakpane 调试 + 视觉检查

## Scope Boundaries
- INCLUDE: 时间系统核心、天空盒切换、光照变化、雾气同步、HUD时间显示、Tweakpane调试面板
- EXCLUDE: Gameplay逻辑、怪物刷新、作物生长、日出日落渐变色、星空效果、自动化测试
