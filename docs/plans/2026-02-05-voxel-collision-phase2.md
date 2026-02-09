# 体素碰撞引擎优化计划书 - 阶段二

> **目标**: 优化体素物理引擎的碰撞检测性能  
> **范围**: broadPhase + narrowPhase  
> **预计收益**: 平稳移动时减少80%查询，远离方块时减少90%完整检测  
> **创建日期**: 2026-02-05

---

## 一、当前性能瓶颈分析

### 1.1 碰撞检测流程

```
PlayerMovementController.update()
└── PlayerCollisionSystem.broadPhase()
    └── 遍历胶囊体AABB范围内所有方块 (18-27个方块查询)
        └── PlayerCollisionSystem.narrowPhase()
            └── 对每个候选方块进行完整胶囊-方块碰撞检测
                └── PlayerCollisionSystem.resolveCollisions()
```

### 1.2 性能热点

| 阶段 | 当前实现 | 问题 |
|------|---------|------|
| **broadPhase** | 每帧全量遍历AABB范围 | 玩家微动时也重新查询所有方块 |
| **narrowPhase** | 逐块完整胶囊检测 | 对远离的方块仍进行昂贵计算（含开方、归一化） |

### 1.3 当前代码位置

- **broadPhase**: `src/js/world/player/player-collision.js:61`
- **narrowPhase**: `src/js/world/player/player-collision.js:102`
- **调用入口**: `src/js/world/player/player-movement-controller.js:136-138`

---

## 二、优化方案

### 2.1 优化A: broadPhase空间缓存

#### 问题
每帧重新遍历胶囊体AABB范围内的所有方块，即使玩家只是轻微移动（未跨方块边界）。

#### 解决方案
```
当前: 每帧重新遍历 5×3×5 = 75个方块位置
优化后: 
  ├─ 玩家未跨方块边界 → 复用上帧候选列表 (0次新查询)
  └─ 玩家跨方块边界 → 增量更新 (仅检查新进入/退出的方块)
```

#### 实现细节

**缓存结构**:
```javascript
// 在 PlayerCollisionSystem 中添加
this._broadPhaseCache = {
  lastCenterBlock: { x: 0, y: 0, z: 0 },  // 上次检测的中心方块坐标
  candidates: [],                          // 缓存的候选方块列表
  isValid: false                           // 缓存是否有效
}
```

**优化后逻辑**:
```javascript
broadPhase(playerCapsule, provider) {
  const center = playerCapsule.center
  const currentBlockX = Math.floor(center.x)
  const currentBlockY = Math.floor(center.y)
  const currentBlockZ = Math.floor(center.z)
  
  // 1. 检查是否可以使用缓存
  if (this._broadPhaseCache.isValid &&
      currentBlockX === this._broadPhaseCache.lastCenterBlock.x &&
      currentBlockY === this._broadPhaseCache.lastCenterBlock.y &&
      currentBlockZ === this._broadPhaseCache.lastCenterBlock.z) {
    // 同一方块内，直接返回缓存
    return this._broadPhaseCache.candidates
  }
  
  // 2. 跨边界了，计算增量更新
  const dx = currentBlockX - this._broadPhaseCache.lastCenterX
  const dy = currentBlockY - this._broadPhaseCache.lastCenterY  
  const dz = currentBlockZ - this._broadPhaseCache.lastCenterZ
  
  // 如果移动距离较小（1格内），进行增量更新
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && Math.abs(dz) <= 1 &&
      this._broadPhaseCache.candidates.length > 0) {
    return this._incrementalBroadPhaseUpdate(
      playerCapsule, 
      provider, 
      dx, dy, dz
    )
  }
  
  // 3. 大幅移动，重新全量计算
  const candidates = this._fullBroadPhaseCalculation(playerCapsule, provider)
  
  // 更新缓存
  this._broadPhaseCache.candidates = candidates
  this._broadPhaseCache.lastCenterBlock = { 
    x: currentBlockX, 
    y: currentBlockY, 
    z: currentBlockZ 
  }
  this._broadPhaseCache.isValid = true
  
  return candidates
}
```

**增量更新方法**:
```javascript
_incrementalBroadPhaseUpdate(playerCapsule, provider, dx, dy, dz) {
  const oldCandidates = this._broadPhaseCache.candidates
  const newCandidates = []
  
  // 移除退出范围的方块
  for (const block of oldCandidates) {
    if (this._isStillInRange(block, playerCapsule)) {
      newCandidates.push(block)
    }
  }
  
  // 添加新进入范围的方块
  const newBlocks = this._getNewBlocksInRange(playerCapsule, provider, dx, dy, dz)
  newCandidates.push(...newBlocks)
  
  // 更新缓存
  this._broadPhaseCache.candidates = newCandidates
  this._broadPhaseCache.lastCenterBlock = {
    x: Math.floor(playerCapsule.center.x),
    y: Math.floor(playerCapsule.center.y),
    z: Math.floor(playerCapsule.center.z)
  }
  
  return newCandidates
}
```

#### 预期收益
- **平稳移动时**: 减少 **80%** 方块查询（复用缓存）
- **跨边界时**: 仅需查询新增/退出范围的方块（约20-30%原计算量）
- **大幅跳跃时**: 全量计算（保证正确性）

#### 风险评估
| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 缓存失效边界错误 | 低 | 穿模 | 严格的边界检查 + 调试可视化 |
| 内存占用增加 | 极低 | 可忽略 | 仅存储方块引用，<1KB |

---

### 2.2 优化B: narrowPhase早期剔除

#### 问题
对所有候选方块进行完整胶囊-方块碰撞检测，即使方块距离胶囊很远。

完整检测包含：
- 最近点计算（3次clamp）
- 向量减法、开方（length）
- 归一化（normalize）
- 等等...

#### 解决方案
**两级过滤机制**:
```
第1级: AABB快速剔除 (无开方，仅简单比较)
  └── 方块AABB与胶囊AABB不相交 → 直接跳过 (90%在此被剔除)

第2级: 距离平方预筛 (避免开方)
  └── minDistance² > radius² → 跳过完整检测 (5%在此被剔除)

第3级: 完整胶囊检测 (仅对通过前两级筛选的)
  └── 完整的几何计算 (仅5%需要执行)
```

#### 实现细节

**优化后逻辑**:
```javascript
narrowPhase(candidates, playerCapsule) {
  const collisions = []
  const { center, halfHeight, radius } = playerCapsule
  const radiusSq = radius * radius
  
  // 预计算胶囊AABB
  const capsuleAABB = {
    minX: center.x - radius,
    maxX: center.x + radius,
    minY: center.y - halfHeight - radius,
    maxY: center.y + halfHeight + radius,
    minZ: center.z - radius,
    maxZ: center.z + radius
  }
  
  for (const block of candidates) {
    // === 第1级: AABB快速剔除 ===
    if (!this._aabbIntersectsBlock(capsuleAABB, block)) {
      continue  // 不相交，跳过
    }
    
    // === 第2级: 距离平方预筛 ===
    // 计算方块中心到胶囊轴线的最小距离平方
    const dx = center.x - block.x
    const dz = center.z - block.z
    const dy = Math.abs(center.y - block.y) - 0.5
    
    // 保守估计最小距离平方
    const minDistSq = dx*dx + dz*dz + (dy > 0 ? dy*dy : 0)
    
    if (minDistSq > radiusSq + halfHeight*halfHeight) {
      continue  // 肯定不相交，跳过
    }
    
    // === 第3级: 完整胶囊检测 ===
    const closestPoint = this._calcClosestPointOnBlock(center, block)
    const collision = this._capsuleContainsPoint(closestPoint, playerCapsule)
    
    if (collision) {
      collisions.push({
        block,
        contactPoint: closestPoint,
        ...collision
      })
    }
  }
  
  return collisions
}

/**
 * AABB与方块快速相交测试
 */
_aabbIntersectsBlock(capsuleAABB, block) {
  const blockMinX = block.x - 0.5
  const blockMaxX = block.x + 0.5
  const blockMinY = block.y - 0.5
  const blockMaxY = block.y + 0.5
  const blockMinZ = block.z - 0.5
  const blockMaxZ = block.z + 0.5
  
  return !(capsuleAABB.maxX < blockMinX || capsuleAABB.minX > blockMaxX ||
           capsuleAABB.maxY < blockMinY || capsuleAABB.minY > blockMaxY ||
           capsuleAABB.maxZ < blockMinZ || capsuleAABB.minZ > blockMaxZ)
}
```

#### 预期收益
- **远离方块时**: 减少 **90%** 完整碰撞计算
- **紧邻方块时**: 无额外开销（AABB判断通过，进入完整检测）
- **平均情况**: 减少 **60-70%** 碰撞检测时间

#### 风险评估
| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 保守剔除导致漏检 | 极低 | 穿模 | 距离计算使用保守估计（放宽阈值） |
| AABB计算开销 | 极低 | 可忽略 | 仅6次比较操作 |

---

## 三、实施路线图

### 阶段1: 基础设施准备
- [ ] 添加 `_broadPhaseCache` 数据结构
- [ ] 添加 `_narrowPhaseEarlyExit` 辅助方法
- [ ] 添加调试统计（候选数、过滤数等）

### 阶段2: narrowPhase早期剔除（推荐先做）
- [ ] 实现 `_aabbIntersectsBlock()`
- [ ] 实现距离平方预筛逻辑
- [ ] 集成到 `narrowPhase()`
- [ ] 测试：远离方块时性能提升

### 阶段3: broadPhase空间缓存
- [ ] 实现缓存结构
- [ ] 实现 `_incrementalBroadPhaseUpdate()`
- [ ] 实现边界检测逻辑
- [ ] 测试：同一方块内移动时无新查询

### 阶段4: 验证与调优
- [ ] 复杂地形穿模测试
- [ ] 边缘情况测试（高速移动、跳跃）
- [ ] 性能基准对比
- [ ] 内存占用验证

---

## 四、性能基准

### 优化前（当前）
```
平稳移动:
  broadPhase:  每帧18-27次方块查询
  narrowPhase: 每帧18-27次完整碰撞检测

复杂场景（角落/斜坡）:
  broadPhase:  每帧27次查询
  narrowPhase: 每帧27次完整检测
  resolve:     处理所有碰撞
```

### 优化后（预期）
```
平稳移动:
  broadPhase:  0次查询（缓存命中）
  narrowPhase: 0-3次完整检测（早期剔除）

跨边界移动:
  broadPhase:  5-10次查询（增量更新）
  narrowPhase: 3-8次完整检测

复杂场景:
  broadPhase:  27次查询（缓存失效）
  narrowPhase: 5-10次完整检测（早期剔除）
  resolve:     最多4碰撞/3迭代（阶段1优化）
```

---

## 五、调试与验证

### 5.1 可视化调试建议

在 Debug 面板添加：
```javascript
// 显示broadPhase候选方块（红色线框）
// 显示narrowPhase实际检测方块（黄色线框）
// 显示碰撞点（青色球体）
// 统计信息：候选数 / 通过AABB / 通过距离 / 实际碰撞
```

### 5.2 性能监控

```javascript
// 在 PlayerCollisionSystem 中添加
this.stats = {
  broadPhaseQueries: 0,      // broadPhase查询次数
  narrowPhaseTests: 0,       // narrowPhase完整检测次数
  aabbRejected: 0,           // AABB剔除数
  distanceRejected: 0,       // 距离剔除数
  cacheHits: 0,              // 缓存命中次数
  cacheMisses: 0             // 缓存失效次数
}
```

---

## 六、备选方案

如果空间缓存过于复杂，可考虑简化方案：

**简化版broadPhase**: 仅缓存玩家坐标，同一方块内直接返回空列表（假设玩家未移动足够距离不会产生新碰撞）

**适用场景**: 玩家移动速度较低，碰撞主要发生在同一方块内

**风险**: 高速移动时可能错过碰撞检测

---

## 七、参考实现

### 类似优化在其他项目中的应用

- **Minecraft**: 使用空间哈希缓存玩家附近的方块
- **Unity Physics**:  broadPhase使用AABB树，narrowPhase使用GJK/EPA算法
- **Bullet Physics**: 动态AABB树 + 增量更新

---

**文档版本**: v1.0  
**关联文档**: 
- `2026-02-05-RAF-performance-optimization.md` (主计划书)
- `2026-02-05-phase1-implementation-report.md` (阶段1实施报告)

**等待状态**: ⏸️ 等待用户指令开始实施
