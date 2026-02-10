# Draft: 多视角相机系统实现规划

## 文档来源
- **设计文档**: `docs/plans/camera-view-modes-design.md` (728行详细设计)
- **日期**: 2026-02-10
- **修订**: Y键作为视角切换快捷键

## 需求分析

### 目标
在现有越肩视角和鸟瞰视角基础上，增加：
1. **第一人称视角** (First-Person)
2. **第三人称跟随视角** (Third-Person Follow)
3. **前置全身视角** (Front Full Body)

实现类似 Minecraft 的循环切换体验。

### 设计原则
- **向后兼容**: 现有越肩视角和鸟瞰视角逻辑完全保留
- **玩家熟悉**: 参考 Minecraft 的视角切换习惯
- **技术可行**: 第一人称仅通过 camera.near 裁剪实现，不修改玩家模型
- **性能优先**: 前置视角优化单帧计算量，预分配变量
- **配置集中**: 所有视角配置统一放置在 `camera-rig-config.js`

## 现有代码分析

### 文件结构
```
src/js/camera/
├── camera.js              # 主相机类 (现有两种模式)
├── camera-rig.js          # 越肩视角 Rig (CameraRig 类)
└── camera-rig-config.js   # 配置对象 (CAMERA_RIG_CONFIG)

src/js/utils/input/
├── input.js               # InputManager 类，处理键盘输入
├── pointer-lock.js        # PointerLockManager 类 (已存在)
└── imouse.js              # 鼠标追踪

src/js/world/player/
└── player.js              # Player 类，提供 getPosition(), getFacingAngle() 等方法
```

### 现有 Camera 类 (src/js/camera/camera.js)

**当前模式枚举:**
```javascript
this.cameraModes = {
  THIRD_PERSON: 'third-person',
  BIRD_PERSPECTIVE: 'bird-perspective',
}
```

**关键方法:**
- `switchMode(mode)` - 切换相机模式，处理控制器启用/禁用
- `update()` - 每帧更新，处理 Rig 输出、地形自适应、Bobbing
- `attachRig(rig)` - 附加 CameraRig
- `_configureBirdViewOrbit()` - 鸟瞰模式 OrbitControls 配置

**相机实例:**
- 使用 `THREE.PerspectiveCamera`
- 默认 near=0.1, far=512, fov=55

### 现有 CameraRig 类 (src/js/camera/camera-rig.js)

**架构:**
- 使用虚拟锚点系统 (THREE.Group + Object3D)
- `group` - 跟随玩家位置的根节点
- `cameraAnchor` - 相机位置锚点
- `targetAnchor` - 目标点锚点

**关键方法:**
- `attachPlayer(player)` - 附加玩家，初始化位置
- `update()` - 返回 `{ cameraPos, targetPos, fov, bobbingOffset, bobbingRoll }`
- `toggleSide()` - 切换左右视角 (使用 GSAP 动画)
- `_checkBlockAbovePlayer()` - 洞内检测
- `_updateCameraOffset()` - 根据洞内状态更新偏移
- `_updateDynamicFov(speed, dt)` - 动态 FOV (Tracking Shot)
- `_updateBobbing(speed, isMoving)` - 镜头震动

**工具函数:**
- `damp(current, target, lambda, dt)` - 帧率无关阻尼
- `dampVec3(current, target, lambda, dt)` - Vector3 阻尼

### 现有配置 (src/js/camera/camera-rig-config.js)

```javascript
CAMERA_RIG_CONFIG = {
  follow: {              // 越肩跟随配置
    offset: Vector3(2, 1.5, 3.5),
    targetOffset: Vector3(0, 1.5, -5.5),
    smoothSpeed: 0.1,
    lookAtSmoothSpeed: 0.45,
    mouseTargetY: { ... },
  },
  trackingShot: {        // 动态效果配置
    fov: { enabled, baseFov, maxFov, speedThreshold },
    bobbing: { enabled, frequencies, amplitudes },
  },
}
```

### 输入系统 (src/js/utils/input/input.js)

**InputManager 类:**
- 监听键盘和鼠标事件
- 维护 `this.keys` 状态对象
- 通过 `emitter` 发送事件

**现有事件:**
- `input:update` - 键盘状态更新
- `input:jump` - 空格键跳跃
- `input:punch_straight` - Z键直拳
- `input:punch_hook` - X键勾拳
- `input:block` - C键格挡
- `input:toggle_block_edit_mode` - Q键
- `input:respawn` - R键重生
- `input:toggle_camera_side` - Tab键切换越肩左右
- `input:mouse_move` - 鼠标移动 (来自 PointerLock)
- `input:wheel` - 滚轮事件

**PointerLockManager:**
- 已完整实现
- 发送 `pointer:locked`, `pointer:unlocked`, `input:mouse_move`

### Player 类 (src/js/world/player/player.js)

**关键方法:**
```javascript
getPosition()     // 返回 Vector3 (脚底位置)
getFacingAngle()  // 返回 number (朝向角度，弧度)
getVelocity()     // 返回 Vector3 (世界速度)
isMoving()        // 返回 boolean (基于速度)
setFacing(angle)  // 设置朝向
setOpacity(value) // 设置模型透明度 (用于洞内)
```

**模型结构:**
- 使用 `movement.group` 作为根节点
- 模型 rotation.y = Math.PI (确保动画正常)
- 通过 `movement.group.rotation.y` 控制朝向

### World 初始化流程 (src/js/world/world.js)

```javascript
_initPlayerAndCamera() {
  this.player = new Player()
  this.cameraRig = new CameraRig()
  this.cameraRig.attachPlayer(this.player)
  this.experience.camera.attachRig(this.cameraRig)
}
```

## 设计文档要点

### 五种视角模式

| 模式 | ID | 特点 |
|------|-----|------|
| 第一人称 | `first-person` | near=0.35裁剪模型，欧拉角控制，FOV=85° |
| 越肩视角 | `shoulder` | 现有，右侧偏移(2,1.5,3.5)，FOV动态 |
| 跟随视角 | `follow` | 正后方(0,2.2,5)，显示全身 |
| 前置全身 | `front-full-body` | 正前方(0,2.2,-4)，看玩家，限制俯仰角 |
| 鸟瞰视角 | `bird` | 现有，独立切换，不参与Y键循环 |

### Y键循环顺序

```
FIRST_PERSON → SHOULDER → FOLLOW → FRONT_FULL_BODY → FIRST_PERSON
```

### 配置参数汇总

```javascript
viewModes: {
  firstPerson: {
    fov: 85,
    near: 0.35,
    headHeight: 1.6,
    mouseSensitivity: 0.002,
    pitchMin: -1.47, pitchMax: 1.47,
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
    pitchRange: { min: -0.35, max: 0.35 },
    mouseSensitivity: 0.002,
  },
}
```

## 技术方案要点

### 第一人称 Near Clip 方案
- 不修改 Player 模型的 visible
- 通过设置 `camera.near = 0.35` 裁剪掉距离相机太近的模型
- 玩家手部可能可见（取决于模型结构）
- 使用欧拉角 (yaw, pitch) 存储朝向

### Rig 架构
- **FirstPersonRig**: 独立类，不继承 CameraRig
- **FollowRig**: 继承 CameraRig，覆盖配置
- **FrontRig**: 独立类，预分配变量优化性能

### 性能优化
- FrontRig 预分配所有 Vector3 变量
- 使用 `damp()` 函数替代 `lerp()` (帧率无关)
- 避免每帧创建临时对象

## 需要修改的文件

### 修改
1. `src/js/camera/camera-rig-config.js` - 添加 viewModes 配置
2. `src/js/camera/camera.js` - 扩展模式枚举，添加 Y键循环逻辑
3. `src/js/utils/input/input.js` - 添加 Y键监听

### 新增
1. `src/js/camera/first-person-rig.js` - 第一人称 Rig
2. `src/js/camera/follow-rig.js` - 跟随视角 Rig
3. `src/js/camera/front-rig.js` - 前置全身 Rig

## 测试策略

**Agent-Executed QA Scenarios:**
- Playwright 验证视角切换
- 验证 Y键循环顺序
- 验证第一人称 near-clip 效果
- 验证各视角下移动/攻击正常
- 验证鸟瞰切换独立工作
- 验证视角切换无卡顿

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| near值不适合所有模型 | 中 | Debug面板添加调节选项 |
| 第一人称眩晕 | 高 | 提供FOV调节选项，默认85° |
| 视角切换时Rig未初始化 | 低 | 延迟初始化 + 空值检查 |
| 前置视角卡顿 | 低 | 预分配变量 + damp优化 |

## 关键决策点

1. **Y键是否已占用？** - 需要确认当前 Y 键是否被其他功能使用
2. **第一人称手部可见性** - 取决于模型结构，可能需要调整 near 值
3. **前置视角俯仰角范围** - ±20° 是否合理
4. **跟随视角是否启用 Tracking Shot** - 设计文档中未明确说明

## 实施阶段

### Phase 1: 配置与基础架构 (2-3小时)
- 扩展 camera-rig-config.js
- 修改 InputManager 添加 Y键
- 修改 Camera 类扩展模式

### Phase 2: 第一人称实现 (3-4小时)
- 创建 FirstPersonRig
- 测试 near clip 效果 (0.3, 0.35, 0.4)

### Phase 3: 跟随视角 (1-2小时)
- 创建 FollowRig (继承 CameraRig)

### Phase 4: 前置全身视角 (2-3小时)
- 创建 FrontRig (优化版)

### Phase 5: 整合与测试 (2-3小时)
- Debug面板更新
- 完整测试流程

---
**状态**: 草稿完成，等待规划确认
**最后更新**: 2026-02-10
