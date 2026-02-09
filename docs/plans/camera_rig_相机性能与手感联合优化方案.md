# CameraRig 相机性能与手感联合优化方案

> 目标：**在减少计算量的同时，显著提升相机响应速度与跟手感**  
> 适用场景：Web / Three.js / Voxel / Minecraft-like 游戏相机系统

---

## 一、问题背景与结论

当前 CameraRig 存在以下系统性问题：

- 多层 `lerp` 串联，导致**相位滞后严重**
- 平滑逻辑 **帧率依赖**，高 FPS 下反而更慢
- 洞内状态、鼠标 Y、LookAt、位置均在平滑，**计算量高且手感差**

### 核心结论

> ❌ 问题不是“算得不够快”  
> ✅ 而是“在错误的位置算了太多次”

解决方案的总原则只有一句话：

> **只允许一个时间平滑点，其余全部事件化 / 瞬时化**

---

## 二、推荐的低算力 + 高手感相机架构

```text
[ Player ]
     ↓  （唯一一次时间平滑）
[ Camera Root Position ]
     ↓  （无平滑）
[ LookAt Target ]
     ↓
[ Camera FX（FOV / Bobbing）]
```

### 设计要点

- ✅ **只平滑相机位置**
- ❌ 禁止位置 + LookAt 双重平滑
- ❌ 禁止配置值来回 lerp / copy
- ✅ 所有“状态切换”都必须降频或事件化

---

## 三、具体优化项（按收益排序）

---

## 优化 1：使用帧率无关的指数平滑（必须）

### 问题

```js
smoothed.lerp(target, smoothSpeed) // 帧率依赖
```

- FPS 越高，实际响应越慢
- 30 FPS 与 144 FPS 手感完全不同

### 解决方案：指数阻尼模型

```js
function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(
    current,
    target,
    1 - Math.exp(-lambda * dt),
  )
}

function dampVec3(current, target, lambda, dt) {
  current.x = damp(current.x, target.x, lambda, dt)
  current.y = damp(current.y, target.y, lambda, dt)
  current.z = damp(current.z, target.z, lambda, dt)
}
```

### 替换相机位置跟随

```diff
- this._smoothedPosition.lerp(playerPos, smoothSpeed)
+ dampVec3(this._smoothedPosition, playerPos, 15, dt)
```

**收益**：
- ✅ 帧率无关
- ✅ 更快的初始响应
- ❌ 去掉错误的 per-frame lerp

---

## 优化 2：移除 LookAt 的二次平滑（强烈建议）

### 问题

```js
_smoothedPosition.lerp(...)
_smoothedLookAtTarget.lerp(...)
```

这是**典型的“双低通滤波”**，会造成：

- 转向延迟
- 停止后相机继续“漂移”

### 推荐改法

```js
this._smoothedLookAtTarget.copy(targetPos)
```

或最多：

```js
dampVec3(this._smoothedLookAtTarget, targetPos, 30, dt)
```

**收益**：
- ❌ 少一次 Vector3 插值
- 🎮 视角立即跟手（FPS / MC 风格）

---

## 优化 3：洞内检测事件化 + 降频

### 问题

- 每帧进行体素查询
- 状态是 boolean，偏移却慢速 lerp
- 玩家在边界高度抖动时，相机永远追不上

### 改法 A：按高度变化触发

```js
if (Math.abs(playerPos.y - this._lastY) > 0.25) {
  this.isInCave = this._checkBlockAbovePlayer(playerPos)
  this._lastY = playerPos.y
}
```

### 改法 B：定时检测（推荐）

```js
this._caveCheckTimer -= dt
if (this._caveCheckTimer <= 0) {
  this.isInCave = this._checkBlockAbovePlayer(playerPos)
  this._caveCheckTimer = 0.2
}
```

**收益**：
- 查询次数：60 次/秒 → 5 次/秒
- 相机稳定性显著提升

---

## 优化 4：合并 offset / targetOffset 计算链路

### 问题

当前链路：

```text
normalOffset → lerp → _targetOffset
caveOffset   → lerp → _currentTargetOffset
→ 写回 config → 再 copy 到 anchor
```

这是 **多余的状态同步**。

### 改法

```js
this.cameraAnchor.position.set(
  offsetX * this._sideFactor,
  offsetY,
  offsetZ,
)
```

直接驱动 anchor，禁止 config 作为中转层。

**收益**：
- ❌ 减少 2 个 Vector3
- ❌ 减少 2 次 lerp
- ❌ 减少 config 写回

---

## 优化 5：简化鼠标 Y 为目标阻尼模型

### 原模型（弹簧）

```text
velocity += input
velocity *= damping
offset += velocity * dt
```

### 推荐模型（目标阻尼）

```js
this.mouseYOffsetTarget += movementY * sensitivity
this.mouseYOffset = damp(
  this.mouseYOffset,
  this.mouseYOffsetTarget,
  18,
  dt
)
```

**收益**：
- ❌ 少一个状态变量
- ❌ 少一次 exp
- 🎮 手感更直觉

---

## 优化 6：禁止在 update 中 new 对象

### 问题

```js
const cameraPos = new THREE.Vector3()
```

在高频 update 中会导致 GC 抖动。

### 改法

```js
// constructor
this._cameraWorldPos = new THREE.Vector3()

// update
this.cameraAnchor.getWorldPosition(this._cameraWorldPos)
```

**收益**：
- ❌ 零 GC 压力
- 🎯 相机稳定性明显提升

---

## 四、推荐参数（已校准）

```js
follow: {
  positionDamping: 12 ~ 18,
}

mouseTargetY: {
  sensitivity: 0.012 ~ 0.018,
}
```

---

## 五、最终工程总结

> **减少计算量的正确方式，不是“少算”，而是“只在正确的地方算一次”**

### 你现在的相机：
- 更像电影跟拍系统（柔顺、滞后）

### 你需要的相机：
- 交互优先、可预测、低延迟

---

## 六、可选下一步

- ✂️ 输出一版「极简 CameraRig 实现」
- 🎮 对标 Minecraft / Valorant 的完整参数表
- 🧠 将 CameraRig 重构为纯函数 + 数据驱动

（任选其一即可继续）

