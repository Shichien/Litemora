# isGrounded 高频切换问题分析与修复

## 问题描述

`isGrounded` 状态在 `true` 和 `false` 之间按帧率级高频切换，导致：
- 动画状态不稳定
- 跳跃检测不准确
- 性能浪费

## 根本原因分析

### 1. 每帧重置状态

在 `_buildPlayerState` 方法中，`isGrounded` 总是被初始化为 `false`：

```javascript
_buildPlayerState(basePosition) {
  return {
    // ...
    isGrounded: false,  // ❌ 每帧都重置
  }
}
```

### 2. 无状态保持机制

- 如果某一帧没有检测到地面碰撞，`isGrounded` 立即变为 `false`
- 即使玩家实际上还在地面上，只是由于数值精度或微小位置变化导致检测失败
- 下一帧可能又检测到了，形成高频切换

### 3. 重力持续作用

即使在地面上，重力每帧都会增加 `worldVelocity.y`：

```javascript
this.worldVelocity.y += this.gravity * dt  // -9.81 * dt
```

这可能导致：
- 玩家稍微下沉
- 碰撞检测推回
- 形成微小的位置振荡
- 在某些帧检测到地面，某些帧检测不到

### 4. 地面检测条件边界不稳定

地面检测条件：

```javascript
const ground = normal.y > 0.5 && bottomProximity <= radius + 0.05
```

在边界情况下（如 `bottomProximity` 接近 `radius + 0.05`），可能：
- 某些帧满足条件 → `ground = true`
- 某些帧不满足 → `ground = false`
- 形成高频切换

## 解决方案

### 修复策略：状态保持机制

1. **继承上一帧状态**：`_buildPlayerState` 接受上一帧的 `isGrounded` 状态作为初始值
2. **延迟清除 grounded**：如果上一帧是 `grounded`，且当前没有明显上升速度，保持 `grounded` 状态
3. **快速响应跳跃**：如果速度明显上升（`vy > 1.0`），立即清除 `grounded` 状态

### 实现代码

```javascript
// 1. _buildPlayerState 接受上一帧状态
_buildPlayerState(basePosition, previousIsGrounded = false) {
  return {
    // ...
    isGrounded: previousIsGrounded,  // ✅ 继承上一帧状态
  }
}

// 2. 在 _updateCustomPhysics 中添加状态保持逻辑
const playerState = this._buildPlayerState(nextPosition, this.isGrounded)

// ... 碰撞检测 ...

// 状态保持：如果上一帧是 grounded，且当前没有明显上升速度，保持 grounded
if (this.isGrounded && !playerState.isGrounded && playerState.worldVelocity.y < 0.5) {
  playerState.isGrounded = true
}
// 如果明显上升（跳跃），则清除 grounded 状态
if (playerState.worldVelocity.y > 1.0) {
  playerState.isGrounded = false
}
```

## 修复效果

- ✅ **消除高频切换**：状态保持机制避免因数值精度导致的误判
- ✅ **保持响应性**：明显上升时立即清除 `grounded`，不影响跳跃检测
- ✅ **提高稳定性**：减少不必要的状态变化，提高动画和逻辑的稳定性

## 相关文件

- `src/js/world/player/player-movement-controller.js`：移动控制器，实现状态保持
- `src/js/world/player/player-collision.js`：碰撞检测系统，判断地面碰撞
- `src/js/world/player/player.js`：玩家主类，使用 `isGrounded` 状态

## 测试建议

1. 站在平地上，观察 `isGrounded` 是否稳定为 `true`
2. 跳跃时，观察是否立即变为 `false`
3. 落地时，观察是否立即变为 `true`
4. 在斜坡上移动，观察状态是否稳定
