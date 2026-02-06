# RAF计算优化计划书

> **目标**: 减少单RAF内JS计算量，提升帧率稳定性  
> **分析日期**: 2026-02-05  
> **重点关注**: Camera系统 + 体素物理引擎

---

## 一、问题分析

### 1.1 当前RAF调用链

```
requestAnimationFrame
└── Time.update()
    └── emitter.emit('core:tick')
        └── Experience.update()
            ├── Camera.update()                    [热点1]
            │   └── CameraRig.update()
            ├── World.update()
            │   ├── Player.update()
            │   │   ├── PlayerMovementController.update()  [热点2]
            │   │   │   ├── broadPhase()         [18-27方块查询/帧]
            │   │   │   ├── narrowPhase()        [逐方块胶囊碰撞计算]
            │   │   │   └── resolveCollisions()  [排序+位置修正]
            │   │   └── Animation.update()
            │   └── ChunkManager.update()
            └── Renderer.update()
```

### 1.2 性能热点量化

| 模块 | 每帧操作 | 估算耗时 | 优化潜力 |
|------|---------|---------|---------|
| Camera地形自适应 | `_sampleGroundHeight()` | ~0.1ms | ⭐⭐⭐ |
| Camera洞内检测 | `_checkBlockAbovePlayer()` - 18次方块查询 | ~0.2ms | ⭐⭐⭐⭐ |
| Camera平滑计算 | lerp + bobbing + FOV | ~0.05ms | ⭐⭐ |
| 物理broadPhase | AABB遍历+方块查询 | ~0.3ms | ⭐⭐⭐⭐ |
| 物理narrowPhase | 逐块胶囊-方块碰撞检测 | ~0.4ms | ⭐⭐⭐⭐⭐ |
| 碰撞resolve | 排序+位置迭代修正 | ~0.2ms | ⭐⭐⭐ |

---

## 二、优化策略总览

### 2.1 策略分类

| 策略类型 | 适用场景 | 代表技术 |
|---------|---------|---------|
| **时间分片** | 不需要每帧更新的计算 | 跳帧、节流、任务队列 |
| **空间分割** | 减少查询范围 | LOD、八叉树、缓存 |
| **增量计算** | 状态变化时才计算 | 脏标记、事件驱动 |
| **近似算法** | 精度换性能 | 保守检测、预计算 |

### 2.2 优先级矩阵

```
影响程度 ↑
    │
 高 │  物理narrowPhase    洞内检测    地形自适应
    │       ●               ●            ●
    │
 中 │  broadPhase         碰撞resolve   FOV调整
    │       ●               ●            ○
    │
 低 │  动画更新           Bobbing       其他
    │       ○               ○            ○
    └──────────────────────────────────────────→ 实施难度
           低              中            高
```

---

## 三、Camera系统优化

### 3.1 优化1: 地形自适应采样 - 跳帧+缓存

**问题**: `_sampleGroundHeight()` 每帧查询一次地面高度

**方案**:
```javascript
// 优化前: 每帧查询
_applyTerrainAdaptation(desiredPos) {
  const ground = this._sampleGroundHeight(desiredPos.x, desiredPos.z)
  // ...
}

// 优化后: 50ms间隔采样 + 位置变化阈值
_applyTerrainAdaptation(desiredPos) {
  // 1. 位置变化<0.5单位 && 距离上次采样<50ms → 复用缓存
  const timeGap = this.experience.time.elapsed - this._lastSampleTime
  const posDelta = desiredPos.distanceTo(this._lastSamplePos)
  
  if (timeGap < 50 && posDelta < 0.5 && this._cachedGround !== null) {
    ground = this._cachedGround
  } else {
    ground = this._sampleGroundHeight(desiredPos.x, desiredPos.z)
    this._cachedGround = ground
    this._lastSampleTime = this.experience.time.elapsed
    this._lastSamplePos.copy(desiredPos)
  }
  // ...
}
```

**预期收益**: 减少66%地形查询

---

### 3.2 优化2: 洞内检测 - 简化头顶检测（✅ 已选方案）

**问题**: `_checkBlockAbovePlayer()` 每帧进行18次 `getBlockWorld()` 查询（3x3范围 × 2层高度）

**选择理由**:
- 当前3x3检测范围过宽，实际上相机只需知道**视线是否被遮挡**
- 简化方案仅检测头顶正上方，**3次查询 vs 18次查询**，减少83%
- 实现简单，不需要复杂的缓存逻辑或射线检测接口
- 覆盖90%的实际场景（玩家被方块包围时头顶必然有遮挡）

**方案**:
```javascript
// 优化前: 每帧18次查询
_checkBlockAbovePlayer(playerPos) {
  const checkHeights = [2, 3]
  const checkRange = [-1, 0, 1]  // 3x3范围
  let blockCount = 0
  
  for (const heightOffset of checkHeights) {
    for (const dx of checkRange) {
      for (const dz of checkRange) {
        const block = terrainManager.getBlockWorld(
          playerBlockX + dx, 
          playerBlockY + heightOffset, 
          playerBlockZ + dz
        )
        if (block && block.id !== 0) {
          blockCount++
          if (blockCount >= 4) return true  // 需要4个方块才判定
        }
      }
    }
  }
  return false
}

// 优化后: 仅检测头顶正上方3格（3次查询）
_checkBlockAbovePlayer(playerPos) {
  const terrainManager = this.experience.terrainDataManager
  if (!terrainManager || !terrainManager.getBlockWorld) {
    return false
  }

  const x = Math.floor(playerPos.x)
  const z = Math.floor(playerPos.z)
  const y = Math.floor(playerPos.y)
  
  // 只检测头顶正上方2、3、4格（3次查询 vs 18次）
  let blockedCount = 0
  for (let dy = 2; dy <= 4; dy++) {
    const block = terrainManager.getBlockWorld(x, y + dy, z)
    if (block?.id !== 0) blockedCount++
  }
  
  // 2个或以上方块遮挡即触发洞内模式（更灵敏）
  return blockedCount >= 2
}
```

**可选增强：简单状态缓存**
```javascript
// 如果还需要进一步优化，可添加简单的位置缓存
_checkBlockAbovePlayer(playerPos) {
  const x = Math.floor(playerPos.x)
  const z = Math.floor(playerPos.z)
  const y = Math.floor(playerPos.y)
  
  // 同一方块内复用结果（可选优化）
  if (x === this._lastCheckX && z === this._lastCheckZ && y === this._lastCheckY) {
    return this._cachedResult
  }
  
  // ...简化检测逻辑...
  const result = blockedCount >= 2
  
  // 缓存结果
  this._lastCheckX = x
  this._lastCheckZ = z
  this._lastCheckY = y
  this._cachedResult = result
  
  return result
}
```

**预期收益**: 
- 查询次数: 18次 → 3次（减少83%）
- 代码复杂度: 大幅降低
- 覆盖率: 90%实际场景（头顶遮挡即视为洞内）

---

### 3.3 优化3: Bobbing计算 - 数学简化

**问题**: 每帧多次三角函数计算

**方案**:
```javascript
// 优化前: 每帧4次sin
_updateBobbing(speed, isMoving) {
  const vertical = Math.sin(elapsed * freq * Math.PI * 2)
  const horizontal = Math.sin(elapsed * freq2 * Math.PI * 2)
  const roll = Math.sin(elapsed * freq3 * Math.PI * 2)
  const breathing = Math.sin(elapsed * freq4 * Math.PI * 2)
}

// 优化后: 查表法 + 复用
// 预计算sin表 (256或512精度)
const SIN_TABLE_SIZE = 256
const SIN_TABLE = new Float32Array(SIN_TABLE_SIZE)
for (let i = 0; i < SIN_TABLE_SIZE; i++) {
  SIN_TABLE[i] = Math.sin((i / SIN_TABLE_SIZE) * Math.PI * 2)
}

// 使用时直接查表
function fastSin(phase) {
  const idx = Math.floor((phase % 1) * SIN_TABLE_SIZE) 
  return SIN_TABLE[idx < 0 ? idx + SIN_TABLE_SIZE : idx]
}
```

**预期收益**: 三角函数计算减少90%，内存占用<2KB

---

### 3.4 优化4: FOV动态调整 - 速度阈值触发

**问题**: 每帧平滑插值FOV，但速度变化是渐进的

**方案**:
```javascript
// 优化前: 每帧都插值
_updateDynamicFov(speed) {
  const targetFov = baseFov + (maxFov - baseFov) * Math.min(speed / threshold, 1)
  this._currentFov += (targetFov - this._currentFov) * smoothSpeed
}

// 优化后: 仅当速度变化>5%时才更新
_updateDynamicFov(speed) {
  const speedDelta = Math.abs(speed - this._lastFovSpeed)
  if (speedDelta < this._lastFovSpeed * 0.05) return // 变化<5%跳过
  
  this._lastFovSpeed = speed
  // ...原逻辑
}
```

---

## 四、体素物理引擎优化

### 4.1 优化5: 碰撞检测 - 空间哈希缓存

**问题**: `broadPhase` 每帧遍历整个胶囊体AABB范围

**方案**:
```javascript
// 优化前: 每帧全量查询
broadPhase(playerCapsule, provider) {
  const minX = Math.floor(center.x - radius)
  const maxX = Math.ceil(center.x + radius)
  // ...遍历所有方块
}

// 优化后: 增量更新 + 空间哈希
broadPhase(playerCapsule, provider) {
  // 1. 如果玩家未跨方块边界 → 复用上帧候选列表
  const currentCenterX = Math.floor(playerCapsule.center.x)
  const currentCenterY = Math.floor(playerCapsule.center.y)
  const currentCenterZ = Math.floor(playerCapsule.center.z)
  
  if (this._isSameBlockCell(currentCenterX, currentCenterY, currentCenterZ)) {
    // 只需验证已有候选是否仍然有效（极少数情况会变）
    return this._filterValidCandidates(this._cachedCandidates, provider)
  }
  
  // 2. 跨边界了 → 增量更新候选列表
  const candidates = this._incrementalUpdateCandidates(
    this._cachedCandidates,
    this._lastCenter,
    playerCapsule.center,
    provider
  )
  
  this._cachedCandidates = candidates
  this._lastCenter.copy(playerCapsule.center)
  return candidates
}
```

**预期收益**: 平稳移动时减少80%方块查询

---

### 4.2 优化6: NarrowPhase - 早期剔除

**问题**: 对所有候选方块进行完整胶囊-方块碰撞检测

**方案**:
```javascript
// 优化前: 逐块完整检测
narrowPhase(candidates, playerCapsule) {
  for (const block of candidates) {
    const closestPoint = this._calcClosestPoint(block, playerCapsule.center)
    const collision = this._capsuleContainsPoint(closestPoint, playerCapsule)
    // ...
  }
}

// 优化后: 快速AABB剔除 + 距离平方比较
narrowPhase(candidates, playerCapsule) {
  const radiusSq = playerCapsule.radius * playerCapsule.radius
  const capsuleAABB = this._calcCapsuleAABB(playerCapsule)
  
  for (const block of candidates) {
    // 1. AABB快速剔除
    if (!this._aabbIntersects(capsuleAABB, block)) continue
    
    // 2. 中心距离平方快速判断
    const dx = playerCapsule.center.x - block.x
    const dz = playerCapsule.center.z - block.z
    const dy = Math.abs(playerCapsule.center.y - block.y) - 0.5
    const minDistSq = dx*dx + dz*dz + (dy > 0 ? dy*dy : 0)
    
    if (minDistSq > radiusSq + playerCapsule.halfHeight**2) continue
    
    // 3. 完整检测（仅对通过快速筛选的）
    const collision = this._fullCapsuleTest(block, playerCapsule)
    // ...
  }
}
```

**预期收益**: 远离方块时减少90%完整碰撞计算

---

### 4.3 优化7: 地面检测 - 专用快速路径

**问题**: 地面检测需要完整的碰撞流程

**方案**:
```javascript
// 新增专用地面检测，跳过复杂流程
_fastGroundCheck(playerState, provider) {
  // 只检测脚底正下方3x3区域
  const footX = Math.floor(playerState.basePosition.x)
  const footZ = Math.floor(playerState.basePosition.z)
  const footY = Math.floor(playerState.basePosition.y)
  
  // 只查Y-1层
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const block = provider.getBlockWorld(footX + dx, footY - 1, footZ + dz)
      if (block?.id && block.id !== 0) {
        // 快速AABB检测
        if (this._quickAABBGroundCheck(block, playerState)) {
          return true
        }
      }
    }
  }
  return false
}
```

**预期收益**: 地面状态检测减少70%计算

---

### 4.4 优化8: 碰撞Resolve - 迭代限制

**问题**: `resolveCollisions` 可能进行多次位置修正

**方案**:
```javascript
// 优化前: 处理所有碰撞
resolveCollisions(collisions, playerState) {
  for (const collision of collisions) {
    // ...修正位置
  }
}

// 优化后: 限制迭代次数，优先处理浅层碰撞
default resolveCollisions(collisions, playerState) {
  // 1. 限制最大处理数量（通常3-4个碰撞足够）
  const MAX_COLLISIONS = 4
  const limitedCollisions = collisions
    .sort((a, b) => a.overlap - b.overlap)
    .slice(0, MAX_COLLISIONS)
  
  // 2. 迭代限制
  const MAX_ITERATIONS = 3
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let moved = false
    for (const collision of limitedCollisions) {
      if (this._stillColliding(collision, playerState)) {
        this._resolveSingle(collision, playerState)
        moved = true
      }
    }
    if (!moved) break // 无变化时提前退出
  }
}
```

---

## 五、任务队列与调度优化

### 5.1 优化9: IdleQueue增强 - 优先级调度

**当前**: 使用 IdleQueue 进行 chunk 生成

**增强**:
```javascript
// 为RAF内计算引入优先级队列
class RAFScheduler {
  constructor() {
    this.highPriority = []    // 必须本帧完成: 相机、物理
    this.normalPriority = []  // 可以延迟1帧: 动画、粒子
    this.lowPriority = []     // 可以延迟多帧: 调试、统计
    this.frameBudget = 8      // 每帧预算8ms
  }
  
  update() {
    const startTime = performance.now()
    
    // 1. 必须执行的高优先级任务
    for (const task of this.highPriority) {
      task.execute()
    }
    
    // 2. 在预算内执行普通任务
    for (const task of this.normalPriority) {
      if (performance.now() - startTime > this.frameBudget) break
      task.execute()
    }
    
    // 3. 剩余任务移到下一帧
    // ...
  }
}
```

---

### 5.2 优化10: Worker线程 - 物理计算 offload

**方案**: 将碰撞检测移至Web Worker

```javascript
// 主线程
class PhysicsWorker {
  constructor() {
    this.worker = new Worker('physics-worker.js')
    this.worker.onmessage = (e) => {
      this._applyPhysicsResult(e.data)
    }
  }
  
  update(playerState, candidates) {
    // 发送轻量数据到worker
    this.worker.postMessage({
      type: 'physics',
      capsule: {
        center: playerState.center.toArray(),
        radius: playerState.radius,
        halfHeight: playerState.halfHeight,
        velocity: playerState.worldVelocity.toArray()
      },
      blocks: candidates.map(b => [b.x, b.y, b.z]) // 压缩传输
    })
  }
}

// physics-worker.js
self.onmessage = (e) => {
  const { capsule, blocks } = e.data
  const collisions = performCollisionDetection(capsule, blocks)
  self.postMessage({ collisions })
}
```

**风险评估**: Worker通信开销 vs 计算收益，需要实测

---

## 六、实施路线图

### 阶段1: 快速收益（预估提升20-30%）
- [ ] 3.1 地形自适应跳帧
- [ ] 3.2 洞内检测状态记忆
- [ ] 4.3 地面检测快速路径
- [ ] 4.4 碰撞Resolve迭代限制

### 阶段2: 结构性优化（预估提升30-40%）
- [ ] 3.3 Bobbing查表法
- [ ] 4.1 broadPhase空间缓存
- [ ] 4.2 narrowPhase早期剔除
- [ ] 3.4 FOV阈值触发

### 阶段3: 架构级优化（预估提升20-30%）
- [ ] 5.1 RAFScheduler优先级调度
- [ ] 5.2 Web Worker物理计算
- [ ] 完整性能测试与调优

---

## 七、性能监控方案

### 7.1 内置Profiler

```javascript
class RAFProfiler {
  constructor() {
    this.markers = new Map()
    this.frameData = []
  }
  
  start(marker) {
    this.markers.set(marker, performance.now())
  }
  
  end(marker) {
    const start = this.markers.get(marker)
    if (start) {
      const duration = performance.now() - start
      this._record(marker, duration)
    }
  }
  
  _record(marker, duration) {
    if (!this.frameData[marker]) {
      this.frameData[marker] = []
    }
    this.frameData[marker].push(duration)
    if (this.frameData[marker].length > 60) {
      this.frameData[marker].shift()
    }
  }
  
  getReport() {
    const report = {}
    for (const [marker, data] of Object.entries(this.frameData)) {
      report[marker] = {
        avg: data.reduce((a, b) => a + b, 0) / data.length,
        max: Math.max(...data),
        min: Math.min(...data)
      }
    }
    return report
  }
}
```

### 7.2 Debug面板集成

在现有Tweakpane中增加性能监控面板，实时显示:
- 各模块耗时
- 方块查询次数/帧
- 碰撞检测次数/帧
- 内存占用趋势

---

## 八、验证标准

### 8.1 性能基准

| 指标 | 当前(估) | 阶段1目标 | 最终目标 |
|------|---------|----------|---------|
| Camera.update | 0.35ms | 0.15ms | 0.08ms |
| 物理broadPhase | 0.30ms | 0.20ms | 0.10ms |
| 物理narrowPhase | 0.40ms | 0.35ms | 0.15ms |
| 总RAF时间 | ~2.5ms | ~1.8ms | ~1.2ms |

### 8.2 质量标准

- 所有优化必须保持原有行为
- 极端情况（快速移动、复杂地形）不能穿模
- 相机过渡保持平滑
- 保持60fps前提下允许偶发掉帧

---

## 九、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 缓存导致过时的碰撞数据 | 高 | 严格验证位置阈值 |
| 跳帧导致相机抖动 | 中 | 使用插值保持平滑 |
| Worker通信开销 | 中 | 数据压缩+批量发送 |
| 代码复杂度增加 | 低 | 完善注释+单元测试 |

---

## 十、下一步行动

1. **选择首个优化点**: 建议从 `3.2 洞内检测状态记忆` 开始（简单、收益高）
2. **建立基准测试**: 在固定场景下录制当前性能数据
3. **分阶段验证**: 每个优化后对比性能数据
4. **文档更新**: 更新 AGENTS.md 添加性能优化相关规范

---

**文档版本**: v1.0  
**下次评审**: 完成阶段1后
