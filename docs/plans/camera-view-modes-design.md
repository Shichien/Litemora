# 多视角模式系统设计文档 (修订版 V3)

**日期**: 2026-02-10  
**修订**: Y 键作为视角切换快捷键  
**关联文件**: `src/js/camera/camera.js`, `src/js/camera/camera-rig.js`, `src/js/camera/camera-rig-config.js`, `src/js/utils/input/input.js`

---

## 1. 概述

### 1.1 目标
在现有越肩视角和鸟瞰视角基础上，增加第一人称、第三人称跟随和前置全身视角，实现类似 Minecraft 的循环切换体验。

### 1.2 设计原则
- **向后兼容**: 现有越肩视角和鸟瞰视角逻辑完全保留
- **玩家熟悉**: 参考 Minecraft 的视角切换习惯
- **技术可行**: 第一人称仅通过 camera.near 裁剪实现，不修改玩家模型
- **性能优先**: 前置视角优化单帧计算量，预分配变量
- **配置集中**: 所有视角配置统一放置在 `camera-rig-config.js`

---

## 2. 视角模式定义

### 2.1 五种视角模式

```javascript
const CAMERA_VIEW_MODES = {
  FIRST_PERSON: 'first-person',           // 第一人称
  THIRD_PERSON_SHOULDER: 'shoulder',      // 越肩视角 (现有)
  THIRD_PERSON_FOLLOW: 'follow',          // 第三人称跟随
  FRONT_FULL_BODY: 'front',               // 前置全身视角
  BIRD_PERSPECTIVE: 'bird',               // 鸟瞰视角 (现有, Y键外)
}
```

### 2.2 各视角详细参数

#### 第一人称 (FIRST_PERSON)
| 属性 | 值 | 说明 |
|------|-----|------|
| 相机位置 | 玩家头部中央 (0, 1.6, 0) | 眼睛高度 |
| 朝向控制 | PointerLock + 鼠标 | 完全由鼠标控制 |
| FOV | 85° | 标准 FPS 视野 |
| **Near Clip** | **0.35** | **裁剪掉玩家模型，只保留手部可见** |
| 玩家可见性 | 通过 near 裁剪自动处理 | 不修改模型 visible |
| 控制器 | 欧拉角 + PointerLock 输入 | 禁用 OrbitControls |

#### 越肩视角 (SHOULDER) - 现有
| 属性 | 值 | 说明 |
|------|-----|------|
| 相机位置 | 右后方偏移 (2, 1.5, 3.5) | 当前实现 |
| 朝向 | 看向前方目标点 | 通过 CameraRig 控制 |
| FOV | 65°-85° 动态 | 根据速度变化 |
| Near Clip | 0.1 | 标准值 |
| 玩家可见性 | 全身可见 | 洞内时半透明 |
| 控制器 | CameraRig + 自定义跟随 | 现有逻辑 |

#### 第三人称跟随 (FOLLOW)
| 属性 | 值 | 说明 |
|------|-----|------|
| 相机位置 | 正后方远距离 (0, 2.2, 5) | 显示全身 |
| 朝向 | 看向玩家中心 | 平滑跟随 |
| FOV | 70° | 中等视野 |
| Near Clip | 0.1 | 标准值 |
| 玩家可见性 | 全身可见 | 完整模型 |
| 控制器 | CameraRig 变体 | 简化版跟随逻辑 |

#### 前置全身视角 (FRONT_FULL_BODY)
| 属性 | 值 | 说明 |
|------|-----|------|
| 相机位置 | 正前方远距离 (0, 2.2, -4) | 面向玩家，显示全身 |
| 朝向 | 看向玩家中心 (0, 1.0, 0) | 固定目标 |
| FOV | 65° | 适中视野，减少边缘变形 |
| Near Clip | 0.1 | 标准值 |
| 玩家可见性 | 全身可见 | 用于欣赏皮肤 |
| 控制器 | 固定位置 + 限制旋转 | 可微调仰角 (-20° ~ +20°) |
| **优化重点** | **预分配变量 + damp 平滑** | **减少单帧计算** |

#### 鸟瞰视角 (BIRD) - 现有
| 属性 | 值 | 说明 |
|------|-----|------|
| 相机位置 | 地形中心上方 | 自动计算 |
| 朝向 | 看向地形中心 | 可旋转 |
| FOV | 55° | 默认 |
| Near Clip | 0.1 | 标准值 |
| 玩家可见性 | 玩家为场景一部分 | 不特殊处理 |
| 控制器 | OrbitControls | 完全自由 |
| **切换方式** | **独立按键/菜单** | **不参与 Y 键循环** |

### 2.3 Y 键视角切换顺序

**Y 键只在以下四种视角间循环：**

```
FIRST_PERSON → SHOULDER → FOLLOW → FRONT_FULL_BODY → FIRST_PERSON
(第一人称)   → (越肩)   → (跟随) → (前置全身)     → (回到第一人称)
```

**鸟瞰视角独立切换：**
- 通过 Debug 面板按钮切换
- 或通过独立快捷键（如 F6）
- 不参与 Y 键循环

---

## 3. 技术实现方案

### 3.1 配置集中管理

#### camera-rig-config.js 扩展
```javascript
// src/js/camera/camera-rig-config.js

import * as THREE from 'three'

export const CAMERA_RIG_CONFIG = {
  // 越肩视角配置 (现有)
  follow: {
    offset: new THREE.Vector3(2, 1.5, 3.5),
    targetOffset: new THREE.Vector3(0, 1.5, -5.5),
    smoothSpeed: 0.1,
    lookAtSmoothSpeed: 0.45,
    mouseTargetY: {
      enabled: true,
      invertY: true,
      sensitivity: 0.012,
      maxOffset: 5,
      returnSpeed: 1.5,
      damping: 3.5,
      unlockReset: true,
    },
  },

  // ===== 新增：各视角模式配置 =====
  viewModes: {
    firstPerson: {
      fov: 85,
      near: 0.35,              // 关键：裁剪玩家模型
      headHeight: 1.6,
      mouseSensitivity: 0.002,
      pitchMin: -Math.PI / 2 + 0.1,
      pitchMax: Math.PI / 2 - 0.1,
    },
    shoulder: {
      fov: 65,
      near: 0.1,
      offset: new THREE.Vector3(2, 1.5, 3.5),
      targetOffset: new THREE.Vector3(0, 1.5, -5.5),
    },
    follow: {
      fov: 70,
      near: 0.1,
      offset: new THREE.Vector3(0, 2.2, 5.0),
      targetOffset: new THREE.Vector3(0, 1.0, 0),
      smoothSpeed: 12,         // 阻尼系数
    },
    front: {
      fov: 65,
      near: 0.1,
      offset: new THREE.Vector3(0, 2.2, -4.0),
      targetOffset: new THREE.Vector3(0, 1.0, 0),
      smoothSpeed: 12,         // 位置平滑阻尼
      pitchSpeed: 10,          // 俯仰角平滑阻尼
      pitchRange: { min: -0.35, max: 0.35 },  // 俯仰角限制 (-20° ~ +20°)
      mouseSensitivity: 0.002,
    },
  },

  // ===== Tracking Shot 配置 (现有) =====
  trackingShot: {
    fov: {
      enabled: true,
      baseFov: 65,
      maxFov: 85,
      speedThreshold: 3.0,
      smoothSpeed: 0.05,
    },
    bobbing: {
      enabled: true,
      verticalFrequency: 4.0,
      verticalAmplitude: 0.025,
      horizontalFrequency: 4.0,
      horizontalAmplitude: 0.015,
      rollFrequency: 4.0,
      rollAmplitude: 0.005,
      speedMultiplier: 1.0,
      idleBreathing: {
        enabled: true,
        frequency: 0.7,
        amplitude: 0.015,
      },
    },
  },
}

// Y 键循环顺序 (排除鸟瞰)
export const VIEW_MODE_CYCLE_ORDER = [
  'first-person',
  'shoulder',
  'follow',
  'front-full-body',
]
```

### 3.2 架构调整

#### Camera 类修改
```javascript
// src/js/camera/camera.js

import { CAMERA_RIG_CONFIG, VIEW_MODE_CYCLE_ORDER } from './camera-rig-config.js'

export default class Camera {
  constructor() {
    // 扩展现有枚举
    this.cameraModes = {
      FIRST_PERSON: 'first-person',
      THIRD_PERSON_SHOULDER: 'third-person-shoulder',
      THIRD_PERSON_FOLLOW: 'third-person-follow',
      FRONT_FULL_BODY: 'front-full-body',
      BIRD_PERSPECTIVE: 'bird-perspective',
    }

    // Y 键循环顺序（排除鸟瞰）
    this._viewModeCycleOrder = VIEW_MODE_CYCLE_ORDER
    this._viewModeCycleIndex = 1 // 默认从越肩开始

    // 新增：各视角专用 Rig
    this.firstPersonRig = null
    this.followRig = null
    this.frontRig = null

    // 配置引用
    this._viewConfig = CAMERA_RIG_CONFIG.viewModes

    // 监听 Y 键
    emitter.on('input:toggle_camera_view', () => {
      this.cycleViewMode()
    })
  }

  // Y 键循环切换
  cycleViewMode() {
    this._viewModeCycleIndex = (this._viewModeCycleIndex + 1) % this._viewModeCycleOrder.length
    const nextMode = this._viewModeCycleOrder[this._viewModeCycleIndex]
    this.switchMode(nextMode)
  }
}
```

#### InputManager 添加 Y 键监听
```javascript
// src/js/utils/input/input.js

// 在构造函数中添加 y 键状态
this.keys = {
  // ... 现有按键 ...
  y: false,  // 新增 Y 键
}

// 在 updateKey 方法中添加
updateKey(key, isPressed) {
  switch (key) {
    // ... 现有按键处理 ...

    case 'y':
      if (isPressed && !this.keys.y) {
        emitter.emit('input:toggle_camera_view')  // Y 键切换视角
      }
      this.keys.y = isPressed
      break

    // ... 其他按键 ...
  }
}
```

### 3.3 第一人称 Near Clip 方案

**核心原理**：通过调整 camera.near 来裁剪掉距离相机太近的模型

```javascript
// Camera 类中

_enterFirstPerson() {
  const config = this._viewConfig.firstPerson

  // 1. 设置 near 裁剪值 - 这是关键！
  this.instance.near = config.near  // 0.35
  this.instance.fov = config.fov    // 85
  this.instance.updateProjectionMatrix()

  // 2. 初始化/更新 FirstPersonRig
  if (!this.firstPersonRig) {
    this.firstPersonRig = new FirstPersonRig()
    this.firstPersonRig.attachPlayer(this.experience.world?.player)
  }

  // 3. 同步当前玩家朝向到欧拉角
  const player = this.experience.world?.player
  if (player) {
    this.firstPersonRig.euler.y = player.getFacingAngle()
  }
}

_enterOtherView(mode) {
  const config = this._viewConfig[mode]

  // 恢复默认 near 和标准 FOV
  this.instance.near = config.near  // 0.1
  this.instance.fov = config.fov
  this.instance.updateProjectionMatrix()
}
```

**Near 值测试建议**：
- `near = 0.3`: 裁剪较激进，可能看不到肩膀
- `near = 0.35`: 推荐值，能看到手部，裁剪头部
- `near = 0.4`: 裁剪较保守，可能看到部分肩膀

### 3.4 新增 Rig 实现

#### 第一人称 Rig
```javascript
// src/js/camera/first-person-rig.js

import * as THREE from 'three'
import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import { CAMERA_RIG_CONFIG } from './camera-rig-config.js'

export default class FirstPersonRig {
  constructor() {
    this.experience = new Experience()
    this.camera = this.experience.camera.instance
    this.target = null
    this.config = CAMERA_RIG_CONFIG.viewModes.firstPerson

    // 欧拉角存储 (yaw, pitch)
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ')

    this._setupInput()
  }

  attachPlayer(player) {
    this.target = player
    if (player) {
      const facingAngle = player.getFacingAngle()
      this.euler.y = facingAngle
    }
  }

  update() {
    if (!this.target) return null

    const playerPos = this.target.getPosition()

    // 相机位置 = 玩家位置 + 头部高度
    const cameraPos = playerPos.clone()
    cameraPos.y += this.config.headHeight

    // 应用欧拉角到相机
    this.camera.quaternion.setFromEuler(this.euler)

    return {
      cameraPos,
      targetPos: null,
      fov: this.camera.fov,
      bobbingOffset: new THREE.Vector3(0, 0, 0),
      bobbingRoll: 0,
    }
  }

  _setupInput() {
    emitter.on('input:mouse_move', ({ movementX, movementY }) => {
      if (this.experience.camera.currentMode !== 'first-person') return

      this.euler.y -= movementX * this.config.mouseSensitivity
      this.euler.x -= movementY * this.config.mouseSensitivity
      this.euler.x = THREE.MathUtils.clamp(
        this.euler.x,
        this.config.pitchMin,
        this.config.pitchMax
      )
    })
  }
}
```

#### 跟随视角 Rig
```javascript
// src/js/camera/follow-rig.js

import CameraRig from './camera-rig.js'
import { CAMERA_RIG_CONFIG } from './camera-rig-config.js'

export default class FollowRig extends CameraRig {
  constructor() {
    super()

    const config = CAMERA_RIG_CONFIG.viewModes.follow

    // 覆盖配置为正后方跟随
    this.config.follow.offset.copy(config.offset)
    this.config.follow.targetOffset.copy(config.targetOffset)
    this.config.follow.smoothSpeed = config.smoothSpeed

    // 禁用洞内检测（正后方不需要）
    this._checkBlockAbovePlayer = () => false
    this.isInCave = false

    // 简化平滑参数
    this.config.follow.mouseTargetY.enabled = false
  }

  // 禁用左右切换
  toggleSide() {
    // 正后方视角不需要切换左右
  }
}
```

#### 前置全身视角 Rig（优化版）
```javascript
// src/js/camera/front-rig.js

import * as THREE from 'three'
import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import { CAMERA_RIG_CONFIG } from './camera-rig-config.js'

/**
 * 帧率无关的阻尼函数（复用自 camera-rig.js）
 */
function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt))
}

export default class FrontRig {
  constructor() {
    this.experience = new Experience()
    this.time = this.experience.time
    this.config = CAMERA_RIG_CONFIG.viewModes.front

    // 虚拟锚点
    this.group = new THREE.Group()
    this.group.name = 'FrontRig'
    this.experience.scene.add(this.group)

    this.cameraAnchor = new THREE.Object3D()
    this.cameraAnchor.name = 'FrontCameraAnchor'
    this.group.add(this.cameraAnchor)

    this.targetAnchor = new THREE.Object3D()
    this.targetAnchor.name = 'FrontTargetAnchor'
    this.group.add(this.targetAnchor)

    // === 预分配变量（性能优化：避免每帧创建对象）===
    this._smoothedPosition = new THREE.Vector3()
    this._currentPitch = 0
    this._targetPitch = 0
    this._cameraWorldPos = new THREE.Vector3()
    this._targetWorldPos = new THREE.Vector3()
    // 临时变量，用于计算
    this._tempPos = new THREE.Vector3()

    this.target = null
    this._setupInput()
  }

  _setupInput() {
    emitter.on('input:mouse_move', ({ movementY }) => {
      if (this.experience.camera.currentMode !== 'front-full-body') return

      this._targetPitch -= movementY * this.config.mouseSensitivity
      this._targetPitch = THREE.MathUtils.clamp(
        this._targetPitch,
        this.config.pitchRange.min,
        this.config.pitchRange.max
      )
    })
  }

  attachPlayer(player) {
    this.target = player
    if (player) {
      const pos = player.getPosition()
      this._smoothedPosition.copy(pos)
      this.group.position.copy(pos)
      this.group.updateMatrixWorld(true)
    }
  }

  update() {
    if (!this.target) return null

    const dt = this.time.delta / 1000
    const playerPos = this.target.getPosition()
    const facingAngle = this.target.getFacingAngle()

    // === 位置平滑（使用 damp 替代 lerp，更稳定）===
    this._tempPos.copy(playerPos)
    this._smoothedPosition.x = damp(this._smoothedPosition.x, this._tempPos.x, this.config.smoothSpeed, dt)
    this._smoothedPosition.y = damp(this._smoothedPosition.y, this._tempPos.y, this.config.smoothSpeed, dt)
    this._smoothedPosition.z = damp(this._smoothedPosition.z, this._tempPos.z, this.config.smoothSpeed, dt)

    this.group.position.copy(this._smoothedPosition)
    this.group.rotation.y = facingAngle
    this.group.updateMatrixWorld(true)

    // === 俯仰角平滑（简单线性插值，计算量小）===
    const pitchDelta = this._targetPitch - this._currentPitch
    this._currentPitch += pitchDelta * (1 - Math.exp(-this.config.pitchSpeed * dt))

    // === 应用配置到锚点（避免重复创建 Vector3）===
    this.cameraAnchor.position.copy(this.config.offset)
    this.cameraAnchor.rotation.x = this._currentPitch
    this.targetAnchor.position.copy(this.config.targetOffset)

    // === 获取世界坐标（复用预分配变量）===
    this.cameraAnchor.getWorldPosition(this._cameraWorldPos)
    this.targetAnchor.getWorldPosition(this._targetWorldPos)

    return {
      cameraPos: this._cameraWorldPos,
      targetPos: this._targetWorldPos,
      fov: this.config.fov,
      bobbingOffset: null,  // 前置视角不需要 bobbing
      bobbingRoll: 0,
    }
  }

  destroy() {
    this.experience.scene.remove(this.group)
    this.target = null
  }
}
```

### 3.5 前置视角优化说明

**优化点对比**：

| 优化项 | 原版实现 | 优化后实现 |
|--------|----------|------------|
| Vector3 创建 | 每帧 `new THREE.Vector3()` x2 | 预分配 `_cameraWorldPos`, `_targetWorldPos` |
| 位置平滑 | `lerp()` 计算 | `damp()` 函数，帧率无关 |
| 俯仰角平滑 | 复杂公式 | 简单指数衰减 |
| 临时对象 | 多处 `.clone()` | 复用 `_tempPos` |
| 返回值 | 新创建 Vector3 | 返回预分配变量引用 |

**性能提升**：
- 减少每帧 GC 压力（无临时对象创建）
- damp 计算比 lerp 更稳定（帧率无关）
- 代码更清晰，易于维护

---

## 4. 文件结构

```
src/js/camera/
├── camera.js                    # 主相机类 (修改)
├── camera-rig.js                # 越肩视角 Rig (保留)
├── camera-rig-config.js         # 统一配置 (扩展)
├── first-person-rig.js          # 第一人称 Rig (新增)
├── follow-rig.js                # 跟随视角 Rig (新增)
└── front-rig.js                 # 前置全身视角 Rig (新增)

src/js/utils/input/
└── input.js                     # 输入管理 (添加 Y 键)
```

---

## 5. 实施计划

### Phase 1: 配置与基础架构 (2-3 小时)
1. **扩展 camera-rig-config.js**
   - 添加 `viewModes` 配置对象
   - 添加 `VIEW_MODE_CYCLE_ORDER` 常量
   - 包含所有视角的参数（offset、FOV、near、smoothSpeed 等）

2. **修改 InputManager**
   - 在 `input.js` 中添加 Y 键监听
   - 发送 `input:toggle_camera_view` 事件

3. **修改 Camera 类**
   - 扩展 cameraModes 枚举
   - 添加 `_viewModeCycleOrder` 和 `_viewModeCycleIndex`
   - 添加 `cycleViewMode()` 方法
   - 修改 `switchMode()` 支持多 Rig 切换

### Phase 2: 第一人称实现 (3-4 小时)
1. **创建 FirstPersonRig 类**
   - 欧拉角存储和更新
   - 监听 `input:mouse_move` 事件
   - 从配置读取参数

2. **测试 near clip 效果**
   - 尝试 near = 0.3, 0.35, 0.4
   - 确认手部可见，头部被裁剪
   - 调整至最佳效果

### Phase 3: 跟随视角 (1-2 小时)
1. **创建 FollowRig 类**
   - 继承 CameraRig
   - 从配置读取偏移参数
   - 禁用 toggleSide() 和洞内检测

### Phase 4: 前置全身视角 (2-3 小时)
1. **创建 FrontRig 类（优化版）**
   - 预分配所有 Vector3 变量
   - 使用 damp 函数平滑
   - 鼠标 Y 控制俯仰角（限制范围）
   - 从配置读取所有参数

### Phase 5: 整合与测试 (2-3 小时)
1. **Debug 面板更新**
   - 添加 Y 键循环视角切换按钮
   - 添加鸟瞰独立切换按钮
   - 显示当前视角模式

2. **测试清单**
   - [ ] Y 键循环：第一人称 → 越肩 → 跟随 → 前置 → 回到第一人称
   - [ ] 第一人称 near clip 效果正常
   - [ ] 各视角下移动/攻击操作正常
   - [ ] 鸟瞰切换独立工作
   - [ ] 视角切换时无卡顿
   - [ ] 前置视角平滑效果流畅

---

## 6. 关键配置值

### Near Clip 调试表
| Near 值 | 效果描述 | 推荐度 |
|---------|----------|--------|
| 0.25 | 裁剪激进，可能看到手臂断面 | ⭐⭐ |
| 0.30 | 头部被裁，肩膀可见 | ⭐⭐⭐ |
| **0.35** | **头部裁剪，手部完整** | **⭐⭐⭐⭐⭐** |
| 0.40 | 裁剪保守，可能看到部分脸部 | ⭐⭐⭐ |

### 配置参数汇总
```javascript
// camera-rig-config.js 中的关键值

viewModes: {
  firstPerson: {
    fov: 85,
    near: 0.35,
    headHeight: 1.6,
    mouseSensitivity: 0.002,
    pitchMin: -1.47,  // -84°
    pitchMax: 1.47,   // 84°
  },
  shoulder: {
    fov: 65,
    near: 0.1,
    offset: { x: 2, y: 1.5, z: 3.5 },
    targetOffset: { x: 0, y: 1.5, z: -5.5 },
  },
  follow: {
    fov: 70,
    near: 0.1,
    offset: { x: 0, y: 2.2, z: 5.0 },
    targetOffset: { x: 0, y: 1.0, z: 0 },
    smoothSpeed: 12,
  },
  front: {
    fov: 65,
    near: 0.1,
    offset: { x: 0, y: 2.2, z: -4.0 },
    targetOffset: { x: 0, y: 1.0, z: 0 },
    smoothSpeed: 12,
    pitchSpeed: 10,
    pitchRange: { min: -0.35, max: 0.35 },  // ±20°
    mouseSensitivity: 0.002,
  },
}
```

---

## 7. 风险与注意事项

### 7.1 技术风险
| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| near 值不适合所有模型 | 中 | 配置中添加调节选项，Debug 面板可调 |
| 第一人称眩晕 | 高 | 提供 FOV 调节选项，默认 85° |
| 视角切换时 Rig 未初始化 | 低 | 延迟初始化 + 空值检查 |
| 前置视角卡顿 | 低 | 预分配变量 + damp 优化 |

### 7.2 实现注意事项
1. **不要修改 Player 模型 visible** - 只通过 camera.near 裁剪
2. **第一人称需要同步玩家朝向** - 切换时同步 euler.y
3. **前置视角预分配变量** - 避免每帧创建 Vector3
4. **配置集中管理** - 所有参数从 camera-rig-config.js 读取
5. **Y 键冲突检查** - 确认 Y 键未被其他功能占用

---

## 附录: 快速参考

### 按键映射
| 按键 | 功能 |
|------|------|
| **Y** | **循环切换: 第一人称 → 越肩 → 跟随 → 前置全身** |
| Tab | 越肩视角下切换左右侧 |
| Shift | 冲刺 |
| V | 下蹲（保留原有功能） |
| F6 | 独立切换鸟瞰视角 (可选) |

### 新增/修改文件清单
```
修改:
- src/js/camera/camera.js
- src/js/camera/camera-rig-config.js
- src/js/utils/input/input.js

新增:
- src/js/camera/first-person-rig.js
- src/js/camera/follow-rig.js
- src/js/camera/front-rig.js
```
