---
name: vtj-performance
description: Use when optimizing rendering performance. Covers InstancedMesh patterns, occlusion culling, geometry sharing, idle queue scheduling, and memory management.
---

# vite-threejs Performance Optimization

## Overview

本项目作为体素游戏，采用多种性能优化技术：
- **InstancedMesh**：大规模方块渲染
- **遮挡剔除**：隐藏被包围的方块
- **几何体共享**：所有同类方块共用几何体
- **空闲队列调度**：利用浏览器空闲时间处理任务

## When to Use

- 渲染大量相似对象
- 优化帧率和内存使用
- 实现流式加载
- 添加新的渲染内容时考虑性能影响

## InstancedMesh 模式

### 基础用法

```javascript
import * as THREE from 'three'

// 共享几何体（只创建一次）
const sharedGeometry = new THREE.BoxGeometry(1, 1, 1)
const material = new THREE.MeshStandardMaterial({ color: 0x888888 })

// 创建 InstancedMesh
const count = 1000
const mesh = new THREE.InstancedMesh(sharedGeometry, material, count)

// 使用 DynamicDrawUsage 允许运行时修改
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

// 设置每个实例的变换矩阵
const tempObject = new THREE.Object3D()
const tempMatrix = new THREE.Matrix4()

for (let i = 0; i < count; i++) {
  tempObject.position.set(x, y, z)
  tempObject.rotation.set(0, 0, 0)
  tempObject.scale.set(1, 1, 1)
  tempObject.updateMatrix()
  
  mesh.setMatrixAt(i, tempObject.matrix)
}

mesh.instanceMatrix.needsUpdate = true
this.scene.add(mesh)
```

### 本项目实现（terrain-renderer.js）

```javascript
// 每种方块类型一个 InstancedMesh
_createBlockMesh(blockType, positions) {
  const geometry = sharedGeometry  // 共享几何体
  const materials = this._getMaterialsForBlock(blockType)
  
  const mesh = new THREE.InstancedMesh(geometry, materials, positions.length)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  
  // 记录实例到网格位置的映射（用于快速移除）
  mesh.userData.instanceToGrid = {}
  
  positions.forEach((pos, index) => {
    this._tempObject.position.set(pos.x, pos.y * this.params.heightScale, pos.z)
    this._tempObject.updateMatrix()
    mesh.setMatrixAt(index, this._tempObject.matrix)
    mesh.userData.instanceToGrid[index] = { x: pos.x, y: pos.y, z: pos.z }
  })
  
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}
```

### O(1) 实例移除（Swap and Pop）

```javascript
removeInstance(mesh, instanceId) {
  const lastIndex = mesh.count - 1
  
  if (instanceId < lastIndex) {
    // 用最后一个实例替换要删除的实例
    mesh.getMatrixAt(lastIndex, this._tempMatrix)
    mesh.setMatrixAt(instanceId, this._tempMatrix)
    
    // 更新映射
    const lastGridPos = mesh.userData.instanceToGrid[lastIndex]
    mesh.userData.instanceToGrid[instanceId] = lastGridPos
    this.container.setBlockInstanceId(
      lastGridPos.x, lastGridPos.y, lastGridPos.z,
      instanceId
    )
  }
  
  // 减少 count 而非 splice 数组
  mesh.count--
  mesh.instanceMatrix.needsUpdate = true
}
```

**复杂度**：O(1) 而非 O(n)

## 遮挡剔除

### 方块遮挡检测

```javascript
// 检查方块是否被完全包围（六面都有方块）
isBlockObscured(x, y, z) {
  const up = this.getBlock(x, y + 1, z)?.id ?? blocks.empty.id
  const down = this.getBlock(x, y - 1, z)?.id ?? blocks.empty.id
  const north = this.getBlock(x, y, z + 1)?.id ?? blocks.empty.id
  const south = this.getBlock(x, y, z - 1)?.id ?? blocks.empty.id
  const east = this.getBlock(x + 1, y, z)?.id ?? blocks.empty.id
  const west = this.getBlock(x - 1, y, z)?.id ?? blocks.empty.id
  
  // 任一面暴露则需要渲染
  if (up === blocks.empty.id) return false
  if (down === blocks.empty.id) return false
  if (north === blocks.empty.id) return false
  if (south === blocks.empty.id) return false
  if (east === blocks.empty.id) return false
  if (west === blocks.empty.id) return false
  
  return true  // 完全被包围，可跳过渲染
}
```

### 在渲染时使用

```javascript
this.container.forEachFilled((block, x, y, z) => {
  // 跳过被包围的方块
  if (this.container.isBlockObscured(x, y, z)) return
  
  // 只渲染可见方块
  this._addBlockToMesh(block, x, y, z)
})
```

## 几何体共享

```javascript
// blocks-config.js

// 所有方块共用一个 BoxGeometry
export const sharedGeometry = new THREE.BoxGeometry(1, 1, 1)

// 所有植物共用一个交叉面几何体
export const sharedCrossPlaneGeometry = (() => {
  const geometry = new THREE.BufferGeometry()
  
  // 两个交叉的平面
  const vertices = new Float32Array([/* ... */])
  const uvs = new Float32Array([/* ... */])
  const normals = new Float32Array([/* ... */])
  
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  
  return geometry
})()
```

**收益**：只创建一次几何体，被所有 InstancedMesh 复用。

## 空闲队列调度

### IdleQueue 实现

```javascript
// src/js/utils/idle-queue.js
export default class IdleQueue {
  constructor(options = {}) {
    this._tasks = []
    this.timeBudgetMs = options.timeBudgetMs ?? 10
  }
  
  enqueue(key, task, priority = 0) {
    this._tasks.push({ key, task, priority })
    this._tasks.sort((a, b) => a.priority - b.priority)  // 优先级排序
  }
  
  pump() {
    const ric = window.requestIdleCallback
    if (ric) {
      ric(deadline => this._run(deadline), { timeout: 50 })
    } else {
      setTimeout(() => this._run(null), 0)
    }
  }
  
  _run(deadline) {
    const start = performance.now()
    
    while (this._tasks.length > 0) {
      const { task } = this._tasks.shift()
      task()
      
      // 检查时间预算
      if (deadline?.timeRemaining) {
        if (deadline.timeRemaining() <= 0) break
      } else {
        if (performance.now() - start >= this.timeBudgetMs) break
      }
    }
    
    // 还有任务，继续调度
    if (this._tasks.length > 0) {
      this.pump()
    }
  }
}
```

### 区块生成中使用

```javascript
// chunk-manager.js
_enqueueChunkBuild(chunk, playerChunkX, playerChunkZ) {
  // 优先级 = 距离玩家的距离（越近优先级越高）
  const dist = Math.max(
    Math.abs(chunk.chunkX - playerChunkX),
    Math.abs(chunk.chunkZ - playerChunkZ)
  )
  
  // 先生成数据
  this.idleQueue.enqueue(`${chunk.key}:data`, () => {
    chunk.generateData()
    
    // 数据生成后，再构建网格
    this.idleQueue.enqueue(`${chunk.key}:mesh`, () => {
      chunk.buildMesh()
    }, dist)
    
  }, dist)
}
```

## 内存管理

### Dispose 模式

```javascript
destroy() {
  // 1. 销毁材质
  if (Array.isArray(this.mesh.material)) {
    this.mesh.material.forEach(mat => mat?.dispose?.())
  } else {
    this.mesh.material?.dispose?.()
  }
  
  // 2. 销毁几何体（如果是独占的）
  // 注意：共享几何体不要销毁！
  if (!this.isSharedGeometry) {
    this.mesh.geometry?.dispose?.()
  }
  
  // 3. 销毁纹理（如果是组件创建的）
  this.texture?.dispose?.()
  
  // 4. 从场景移除
  this.scene.remove(this.mesh)
  
  // 5. 清空引用
  this.mesh = null
}
```

### Renderer 销毁

```javascript
// renderer.js
destroy() {
  // 销毁后处理
  this.renderPass?.dispose?.()
  this.bloomPass?.dispose?.()
  this.speedLinePass?.dispose?.()
  this.outputPass?.dispose?.()
  
  // 销毁渲染目标
  this.composer.renderTarget1?.dispose()
  this.composer.renderTarget2?.dispose()
  
  // 强制释放 WebGL 上下文
  this.instance.forceContextLoss()
  this.instance.dispose()
}
```

## 配置驱动优化

```javascript
// chunk-config.js
export const CHUNK_BASIC_CONFIG = {
  chunkWidth: 64,        // 区块大小（平衡 draw calls 和内存）
  chunkHeight: 32,
  viewDistance: 1,       // 视距（1 = 3x3 区块网格）
  unloadPadding: 1,      // 卸载滞后（防止频繁加载/卸载）
  autoSaveDelay: 2000,   // 保存节流延迟
}
```

## 性能监控

```javascript
// 通过 stats.js 监控
this.stats = this.experience.stats

// 关键指标
// - FPS: 帧率
// - MS: 每帧耗时
// - MB: 内存使用

// 通过 debugInit 暴露参数
debugInit() {
  this.debugFolder.addBinding(this.params, 'viewDistance', {
    min: 1, max: 4, step: 1,
  }).on('change', () => this.updateViewDistance())
}
```

## Common Mistakes

### ❌ 为每个对象创建几何体

```javascript
// BAD: 每个方块创建新几何体
blocks.forEach(block => {
  const geometry = new THREE.BoxGeometry(1, 1, 1)  // 重复创建！
  const mesh = new THREE.Mesh(geometry, material)
})

// GOOD: 共享几何体 + InstancedMesh
const geometry = new THREE.BoxGeometry(1, 1, 1)  // 只创建一次
const mesh = new THREE.InstancedMesh(geometry, material, blocks.length)
```

### ❌ 使用 splice 移除实例

```javascript
// BAD: O(n) 复杂度
instances.splice(index, 1)

// GOOD: swap-and-pop，O(1) 复杂度
instances[index] = instances[instances.length - 1]
instances.pop()
mesh.count--
```

### ❌ 主线程阻塞

```javascript
// BAD: 一次性处理所有区块
chunks.forEach(chunk => {
  chunk.generateData()
  chunk.buildMesh()
})

// GOOD: 使用空闲队列分帧处理
chunks.forEach(chunk => {
  idleQueue.enqueue(chunk.key, () => {
    chunk.generateData()
    chunk.buildMesh()
  })
})
```

### ❌ 忘记调用 needsUpdate

```javascript
// BAD: 修改后忘记标记更新
mesh.setMatrixAt(index, matrix)
// 渲染不会更新！

// GOOD: 标记需要更新
mesh.setMatrixAt(index, matrix)
mesh.instanceMatrix.needsUpdate = true
```

## Quick Reference

| 优化技术 | 适用场景 | 收益 |
|----------|----------|------|
| InstancedMesh | 大量相似对象 | 减少 draw calls |
| 遮挡剔除 | 体素地形 | 减少顶点处理 |
| 几何体共享 | 所有对象 | 减少内存 |
| Swap-and-pop | 动态增删实例 | O(1) 移除 |
| 空闲队列 | 非紧急任务 | 避免帧卡顿 |
| DynamicDrawUsage | 频繁修改的 buffer | GPU 优化 |

| 关键参数 | 说明 |
|----------|------|
| `viewDistance` | 区块加载半径 |
| `unloadPadding` | 卸载滞后 |
| `timeBudgetMs` | 每帧任务时间预算 |
| `chunkWidth` | 区块尺寸 |
