# MiningLoopAnimation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按住左键时循环播放挖掘动画（复用 `QUICK_COMBO`），松开立即停止；挖掘过程中角色必须完全停止移动与跳跃。

**Architecture:** 以 `game:mining-start` / `game:mining-cancel` / `game:mining-complete` 事件为唯一挖掘状态来源，在 `Player` 内维护 `isMining`，驱动动画状态与移动控制；动画状态机在 `COMBAT` 状态中对挖掘进行“保持态”处理。

**Tech Stack:** Three.js AnimationMixer, mitt 事件总线, 现有 Player 运动与动画状态机。

---

### Task 1: 绑定挖掘事件与玩家挖掘状态

**Files:**
- Modify: `e:/圖形學/Third-Person-MC/src/js/world/player/player.js`

**Step 1: Write the failing test**
- 当前项目无单元测试框架；此任务改为“手动验证步骤”记录于 Task 4。

**Step 2: Run test to verify it fails**
- 跳过（无自动化测试），在 Task 4 手动验证前确认问题仍存在。

**Step 3: Write minimal implementation**
- 在 `Player` 构造函数内新增挖掘状态字段，监听挖掘事件并驱动动画。
- 代码片段（添加到 `constructor()` 与 `setupInputListeners()` 中相应位置）：

```js
// constructor() 中初始化状态
this.isMining = false

// setupInputListeners() 中新增监听
emitter.on('game:mining-start', () => {
  this.isMining = true
  this.animation.triggerAttack(AnimationClips.QUICK_COMBO)
})

emitter.on('game:mining-cancel', () => {
  this.isMining = false
  this.animation.stateMachine.setState(AnimationStates.LOCOMOTION)
})

emitter.on('game:mining-complete', () => {
  this.isMining = false
  this.animation.stateMachine.setState(AnimationStates.LOCOMOTION)
})
```

**Step 4: Run test to verify it passes**
- 先不执行，等 Task 4 统一手动验证。

**Step 5: Commit**
```bash
git add e:/圖形學/Third-Person-MC/src/js/world/player/player.js
git commit -m "feat(player): add mining state hooks"
```

---

### Task 2: 让 QUICK_COMBO 变为挖掘循环，并维持 Combat 状态

**Files:**
- Modify: `e:/圖形學/Third-Person-MC/src/js/world/player/animation-config.js`
- Modify: `e:/圖形學/Third-Person-MC/src/js/world/player/animation-state-machine.js`
- Modify: `e:/圖形學/Third-Person-MC/src/js/world/player/player-animation-controller.js`

**Step 1: Write the failing test**
- 当前项目无单元测试框架；此任务改为“手动验证步骤”记录于 Task 4。

**Step 2: Run test to verify it fails**
- 跳过（无自动化测试）。

**Step 3: Write minimal implementation**
- 将 `QUICK_COMBO` 的 loop 改为 `THREE.LoopRepeat`。

```js
// animation-config.js
[AnimationClips.QUICK_COMBO]: {
  timeScale: 1.5,
  category: AnimationCategories.COMBAT,
  loop: THREE.LoopRepeat
},
```

- 在状态机 `COMBAT` 更新中加入 `isMining` 判断，挖掘中不退出 Combat；非挖掘时回归原逻辑。

```js
// animation-state-machine.js -> COMBAT update
update: (dt, params) => {
  if (params.isMining) {
    return
  }
  if (!this.anim.isActionPlaying(params.currentActionName)) {
    this.setState(AnimationStates.LOCOMOTION)
  }
},
```

- 在动画更新参数中补齐 `isMining` 透传。

```js
// player-animation-controller.js -> update()
this.stateMachine.update(dt, {
  ...playerState,
  currentActionName: this.currentAction ? this.currentAction.getClip().name : null,
})
```

> 注意：`playerState` 需要在 Task 3 中加入 `isMining` 字段。

**Step 4: Run test to verify it passes**
- 跳过（无自动化测试）。

**Step 5: Commit**
```bash
git add e:/圖形學/Third-Person-MC/src/js/world/player/animation-config.js \
  e:/圖形學/Third-Person-MC/src/js/world/player/animation-state-machine.js \
  e:/圖形學/Third-Person-MC/src/js/world/player/player-animation-controller.js
git commit -m "feat(animation): loop mining action and lock combat state"
```

---

### Task 3: 挖掘时强制停止移动与跳跃

**Files:**
- Modify: `e:/圖形學/Third-Person-MC/src/js/world/player/player.js`

**Step 1: Write the failing test**
- 当前项目无单元测试框架；此任务改为“手动验证步骤”记录于 Task 4。

**Step 2: Run test to verify it fails**
- 跳过（无自动化测试）。

**Step 3: Write minimal implementation**
- 跳跃输入被挖掘状态阻断。
- `update()` 内在挖掘时强制清空方向输入并清零水平速度，确保角色立即停下。
- 代码片段（替换/插入到 `setupInputListeners()` 与 `update()` 中相应位置）：

```js
// setupInputListeners() -> input:jump
emitter.on('input:jump', () => {
  if (this.isMining) {
    return
  }
  if (this.movement.isGrounded && this.animation.stateMachine.currentState.name !== AnimationStates.COMBAT) {
    this.movement.jump()
    this.animation.triggerJump()
  }
})
```

```js
// update() 中：在 resolveDirectionInput 之后加入挖掘处理
const { resolvedInput, weights } = resolveDirectionInput(this.inputState)

const effectiveInput = this.isMining
  ? {
      forward: false,
      backward: false,
      left: false,
      right: false,
      shift: false,
      v: false,
      space: false
    }
  : resolvedInput

if (this.isMining) {
  this.movement.worldVelocity.x = 0
  this.movement.worldVelocity.z = 0
}

this.movement.update(effectiveInput, isCombat)

const playerState = {
  inputState: effectiveInput,
  directionWeights: this.isMining ? { forward: 0, backward: 0, left: 0, right: 0 } : weights,
  isMoving: this.isMining ? false : this.movement.isMoving(effectiveInput),
  isGrounded: this.movement.isGrounded,
  speedProfile: this.movement.getSpeedProfile(effectiveInput),
  isMining: this.isMining,
}
```

**Step 4: Run test to verify it passes**
- 跳过（无自动化测试）。

**Step 5: Commit**
```bash
git add e:/圖形學/Third-Person-MC/src/js/world/player/player.js
git commit -m "feat(player): stop movement and jump during mining"
```

---

### Task 4: 手动验证

**Step 1: Run dev server**
```bash
pnpm dev
```
Expected: dev server 正常启动，无报错。

**Step 2: 挖掘循环验证**
- 切到挖掘模式（Remove/Mining）。
- 按住左键：角色播放循环挖掘动画（`QUICK_COMBO`），保持在 Combat 状态。
- 松开左键：动画立即停止并回到待机/行走。

**Step 3: 强制停止验证**
- 挖掘期间按下 WASD 与空格：角色不移动、不跳跃。
- 松开左键：移动与跳跃恢复正常。

---

## Execution Handoff

计划已保存到 `docs/plans/2026-01-21-mining-loop-animation.md`。执行方式二选一：

1) **Subagent-Driven (this session)**：我在本会话中按任务逐个执行（需要 @superpowers:subagent-driven-development）。  
2) **Parallel Session (separate)**：新开会话按计划执行（需要 @superpowers:executing-plans）。

请选择执行方式。
