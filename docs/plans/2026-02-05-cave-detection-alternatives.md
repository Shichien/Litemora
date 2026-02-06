# 洞内检测优化 - 备选方案

> **文档用途**: 存储洞内检测的备选优化方案，供未来参考  
> **当前方案**: 简化头顶检测（见主计划书 3.2 节）  
> **创建日期**: 2026-02-05

---

## 方案B: 状态记忆 + 按需更新

**适用场景**: 
- 需要在性能与准确性之间取得平衡
- 玩家移动频繁的开放世界场景
- 可以接受偶尔的检测延迟

**核心思路**: 
1. 玩家在同一方块内时复用上帧结果（0次查询）
2. 快速预检：只查头顶1格，无方块则直接返回false（1次查询）
3. 仅在预检通过时才进行完整检测（最坏18次，但极少触发）

**实现代码**:

```javascript
class CameraRig {
  constructor() {
    // ...原有代码...
    
    // 缓存相关状态
    this._lastCheckX = null
    this._lastCheckZ = null
    this._cachedCaveResult = null
    this._lastCheckTime = 0
  }

  /**
   * 洞内检测 - 状态记忆 + 按需更新版本
   * @param {THREE.Vector3} playerPos 玩家脚底位置
   * @returns {boolean} 是否在洞内/遮挡状态
   */
  _checkBlockAbovePlayer(playerPos) {
    const terrainManager = this.experience.terrainDataManager
    if (!terrainManager || !terrainManager.getBlockWorld) {
      return false
    }

    const currentBlockX = Math.floor(playerPos.x)
    const currentBlockZ = Math.floor(playerPos.z)
    const currentBlockY = Math.floor(playerPos.y)
    
    // 1. 位置缓存：玩家未移动到新方块 → 复用上帧结果
    if (currentBlockX === this._lastCheckX && 
        currentBlockZ === this._lastCheckZ &&
        this._cachedCaveResult !== null) {
      return this._cachedCaveResult
    }
    
    // 2. 快速预检：只查头顶正上方第2格
    // 如果这一格都没有方块，肯定不在洞内
    const quickCheck = terrainManager.getBlockWorld(
      currentBlockX, 
      currentBlockY + 2, 
      currentBlockZ
    )
    
    if (!quickCheck || quickCheck.id === 0) {
      this._cachedCaveResult = false
      this._lastCheckX = currentBlockX
      this._lastCheckZ = currentBlockZ
      return false
    }
    
    // 3. 预检通过，进行完整检测（18次查询）
    const fullResult = this._fullCaveCheck(playerPos, currentBlockX, currentBlockZ, currentBlockY)
    this._cachedCaveResult = fullResult
    this._lastCheckX = currentBlockX
    this._lastCheckZ = currentBlockZ
    return fullResult
  }
  
  /**
   * 完整洞内检测（原始逻辑）
   */
  _fullCaveCheck(playerPos, playerBlockX, playerBlockZ, playerBlockY) {
    const terrainManager = this.experience.terrainDataManager
    const checkHeights = [2, 3]
    const checkRange = [-1, 0, 1]
    let blockCount = 0
    
    for (const heightOffset of checkHeights) {
      const checkY = playerBlockY + heightOffset
      for (const dx of checkRange) {
        for (const dz of checkRange) {
          const checkX = playerBlockX + dx
          const checkZ = playerBlockZ + dz
          const block = terrainManager.getBlockWorld(checkX, checkY, checkZ)
          
          if (block && block.id !== 0) {
            blockCount++
            if (blockCount >= 4) {
              return true
            }
          }
        }
      }
    }
    return false
  }
}
```

**预期性能**:

| 场景 | 平均查询次数 | 说明 |
|------|-------------|------|
| 开阔平地 | 1次 | 快速预检直接返回 |
| 室内/洞穴入口 | 18次 | 触发完整检测 |
| 同一方块内移动 | 0次 | 复用缓存 |

**优缺点分析**:

| 优点 | 缺点 |
|------|------|
| 性能优秀（大部分情况1次查询） | 代码复杂度增加 |
| 保持原有检测精度 | 需要管理缓存状态 |
| 易于回退到完整检测 | 跨方块边界时可能有1帧延迟感 |

---

## 方案C: 射线检测（Raycasting）

**适用场景**:
- 对检测精度要求极高
- 有射线查询基础设施
- 复杂几何结构（非轴对齐遮挡）

**核心思路**:
从相机位置向玩家头部发射射线，检测视线是否被地形阻挡。语义上最准确：不关心玩家是否"在洞里"，只关心"相机是否看得见玩家"。

**实现代码**:

```javascript
class CameraRig {
  /**
   * 射线检测视线遮挡
   * 从相机预估位置向玩家头部发射射线
   * @param {THREE.Vector3} playerPos 玩家脚底位置
   * @returns {boolean} 视线是否被遮挡
   */
  _checkCameraLineOfSight(playerPos) {
    const terrainManager = this.experience.terrainDataManager
    
    // 如果没有射线接口，降级到简化检测
    if (!terrainManager?.raycastBlocks) {
      return this._simpleCeilingCheck(playerPos)
    }

    // 1. 估算相机世界位置（基于当前偏移配置）
    const cameraWorldPos = this._estimateCameraPosition(playerPos)
    
    // 2. 玩家头部位置（高度约1.8）
    const playerHeadPos = new THREE.Vector3(
      playerPos.x, 
      playerPos.y + 1.8,
      playerPos.z
    )
    
    // 3. 计算射线方向和距离
    const direction = new THREE.Vector3()
      .subVectors(playerHeadPos, cameraWorldPos)
      .normalize()
    const maxDistance = cameraWorldPos.distanceTo(playerHeadPos)
    
    // 4. 射线检测（通常1-3次方块查询即可）
    const hit = terrainManager.raycastBlocks(
      cameraWorldPos,
      direction,
      maxDistance
    )
    
    return hit !== null // 有碰撞 = 视线被遮挡
  }
  
  /**
   * 估算相机世界位置
   * 基于当前相机偏移配置计算预估位置
   */
  _estimateCameraPosition(playerPos) {
    // 使用当前的目标偏移估算相机位置
    const offset = this.isInCave ? this._caveOffset : this._normalOffset
    
    // 应用左右切换因子
    const actualOffset = offset.clone()
    actualOffset.x *= this._sideFactor
    
    // 根据玩家朝向旋转偏移
    const angle = this.target.getFacingAngle()
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    
    const rotatedX = actualOffset.x * cos + actualOffset.z * sin
    const rotatedZ = -actualOffset.x * sin + actualOffset.z * cos
    
    return new THREE.Vector3(
      playerPos.x + rotatedX,
      playerPos.y + actualOffset.y,
      playerPos.z + rotatedZ
    )
  }
  
  /**
   * 备用简化检测（无射线功能时的降级方案）
   */
  _simpleCeilingCheck(playerPos) {
    const terrainManager = this.experience.terrainDataManager
    const x = Math.floor(playerPos.x)
    const z = Math.floor(playerPos.z)
    const y = Math.floor(playerPos.y)
    
    // 只检测头顶正上方2-4格
    let blocked = 0
    for (let dy = 2; dy <= 4; dy++) {
      const block = terrainManager.getBlockWorld(x, y + dy, z)
      if (block?.id !== 0) blocked++
    }
    return blocked >= 2
  }
}

// ========================================
// ChunkManager 需要添加的射线接口
// ========================================

class ChunkManager {
  /**
   * 体素射线检测
   * 使用DDA算法遍历射线经过的体素
   * @param {THREE.Vector3} origin 射线起点
   * @param {THREE.Vector3} direction 射线方向（需归一化）
   * @param {number} maxDistance 最大检测距离
   * @returns {object|null} 碰撞信息或null
   */
  raycastBlocks(origin, direction, maxDistance) {
    // 起始方块坐标
    let x = Math.floor(origin.x)
    let y = Math.floor(origin.y)
    let z = Math.floor(origin.z)
    
    // 步进方向
    const stepX = direction.x > 0 ? 1 : -1
    const stepY = direction.y > 0 ? 1 : -1
    const stepZ = direction.z > 0 ? 1 : -1
    
    // tDelta: 穿过一个方块所需的时间
    const tDeltaX = Math.abs(1 / direction.x)
    const tDeltaY = Math.abs(1 / direction.y)
    const tDeltaZ = Math.abs(1 / direction.z)
    
    // tMax: 到达下一个方块边界的时间
    const tMaxX = (stepX > 0 ? (x + 1 - origin.x) : (origin.x - x)) / Math.abs(direction.x)
    const tMaxY = (stepY > 0 ? (y + 1 - origin.y) : (origin.y - y)) / Math.abs(direction.y)
    const tMaxZ = (stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z)) / Math.abs(direction.z)
    
    let t = 0
    
    while (t < maxDistance) {
      // 检测当前方块
      const block = this.getBlockWorld(x, y, z)
      if (block?.id !== 0) {
        return {
          x, y, z,
          distance: t,
          block: block
        }
      }
      
      // DDA步进
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX
        x += stepX
        tMaxX += tDeltaX
      } else if (tMaxY < tMaxZ) {
        t = tMaxY
        y += stepY
        tMaxY += tDeltaY
      } else {
        t = tMaxZ
        z += stepZ
        tMaxZ += tDeltaZ
      }
    }
    
    return null
  }
}
```

**预期性能**:

| 场景 | 查询次数 | 说明 |
|------|---------|------|
| 开阔场景 | 1-2次 | 射线直达玩家 |
| 遮挡场景 | 2-5次 | 检测到遮挡物停止 |
| 远距离 | 5-10次 | 射线经过多个方块 |

**优缺点分析**:

| 优点 | 缺点 |
|------|------|
| 语义最准确（检测视线而非"洞内"） | 需要修改ChunkManager |
| 能适应复杂地形 | 射线算法有一定复杂度 |
| 查询次数稳定（通常<5次） | 需要处理边界情况（如相机在方块内） |
| 可扩展性强（如检测部分遮挡） | DDA算法需要充分测试 |

---

## 方案对比总结

| 方案 | 平均查询/帧 | 精度 | 实现难度 | 推荐场景 |
|------|------------|------|---------|---------|
| **A. 简化头顶检测（当前采用）** | 3次 | ⭐⭐⭐ | 低 | 快速实施，性能敏感 |
| B. 状态记忆+按需更新 | 0.5-1次 | ⭐⭐⭐⭐ | 中 | 开放世界，平衡性能与精度 |
| C. 射线检测 | 1-5次 | ⭐⭐⭐⭐⭐ | 高 | 高精度需求，有基础设施 |

---

## 迁移路径

建议按以下顺序升级：

```
当前(18次查询) 
    ↓ 立即实施
方案A(3次查询) 
    ↓ 如需进一步优化
方案B(0.5-1次查询，保持精度)
    ↓ 长期架构升级
方案C(射线检测，最准确)
```

---

## 参考资源

- **DDA算法**: Digital Differential Analyzer，用于体素射线遍历的经典算法
- **Three.js Raycaster**: 可参考其实现思路，但体素版本更简单（轴对齐）
- **Minecraft源码**: 使用类似的简化检测来判断玩家头部是否在水中/遮挡中

---

*文档版本: v1.0*  
*关联文档: `2026-02-05-RAF-performance-optimization.md` (主计划书)*
