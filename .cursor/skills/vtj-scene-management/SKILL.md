---
name: vtj-scene-management
description: Orchestrates World lifecycle and component initialization. Use when managing initialization order, update sequences, or implementing proper disposal chains.
---

# vite-threejs Scene Management (World 编排)

## 何时使用本 Skill

- 在 `src/js/world/world.js` 中**新增/删除** 3D 组件
- 调整组件**初始化顺序**或**每帧更新顺序**
- 确认**销毁顺序**与资源清理

## 当前 World 组件清单（与 world.js 一致）

| 实例名 | 类 | 初始化阶段 | update() 中调用 | destroy() 中调用 |
|--------|-----|------------|----------------|------------------|
| chunkManager | ChunkManager | _initTerrain | ✓ streaming + update | ✓ 最后 |
| player | Player | _initPlayerAndCamera | ✓ | ✓ |
| cameraRig | CameraRig | _initPlayerAndCamera | — | ✓ |
| environment | Environment | _initEnvironment | ✓ | ✓ |
| blockRaycaster | BlockRaycaster | _initBlockInteraction | ✓ | ✓ |
| blockSelectionHelper | BlockSelectionHelper | _initBlockInteraction | ✓ | ✓ |
| blockMiningController | BlockMiningController | _initBlockInteraction | ✓ | ✓ |
| blockMiningOverlay | BlockMiningOverlay | _initBlockInteraction | — | ✓ dispose |
| blockInteractionManager | BlockInteractionManager | _initBlockInteraction | — | ✓ |
| blockBreakParticles | BlockBreakParticles | _initEffects | ✓ | ✓ |
| itemPickupAnimator | ItemPickupAnimator | _initEffects | — | ✓ |

说明：`terrainDataManager` 不是独立组件，是 `this.experience.terrainDataManager = this.chunkManager` 的引用，供相机/玩家/射线等使用。

## 依赖顺序（不可颠倒）

- **初始化**：地形 → 玩家+相机 → 环境 → 方块交互链 → 效果 → 设置监听  
  对应方法：`_initTerrain` → `_initPlayerAndCamera` → `_initEnvironment` → `_initBlockInteraction` → `_initEffects` → `_setupSettingsListeners`
- **update()**：先地形流式/动画与挖矿，再玩家/环境，再射线/选中框，最后粒子。  
  文件位置：`src/js/world/world.js` 的 `update()` 方法内，顺序已固定。
- **destroy()**：与创建顺序**相反**：先销毁依赖方（交互、效果、环境、相机、玩家），最后地形；并清空 `experience.terrainDataManager`。  
  文件位置：`src/js/world/world.js` 的 `destroy()` 方法内。

## 添加新 3D 组件的检查清单

1. **确定依赖**：新组件依赖谁？（如依赖地形 → 放在 _initTerrain 之后；依赖玩家 → 放在 _initPlayerAndCamera 之后）
2. **选阶段**：在 `world.js` 中放入对应 `_initXxx()`，或新建 `_initYyy()` 并在 `emitter.on('core:ready', ...)` 里调用。
3. **创建实例**：在对应 _init 方法内 `this.xxx = new Xxx(...)`，所需参数从已有 `this.*` 传入。
4. **如需每帧更新**：在 `update()` 中按依赖顺序添加 `if (this.xxx) this.xxx.update()`。
5. **销毁**：在 `destroy()` 中按**逆序**添加 `this.xxx?.destroy()` 或 `this.xxx?.dispose()`（先于其依赖的被销毁者）。

## 删除组件的检查清单

1. 在对应 `_initXxx()` 中删除 `this.xxx = new Xxx(...)` 及相关逻辑。
2. 在 `update()` 中删除对该组件的 `update` 调用。
3. 在 `destroy()` 中删除对该组件的 `destroy`/`dispose` 调用。
4. 删除文件顶部不再使用的 import。

## 核心代码结构（与 world.js 一致）

```javascript
// 1. 等待资源后再初始化
emitter.on('core:ready', () => {
  this._initTerrain()
  this._initPlayerAndCamera()
  this._initEnvironment()
  this._initBlockInteraction()
  this._initEffects()
  this._setupSettingsListeners()
})

// 2. 各阶段只做创建与挂载，不混入其他阶段
_initTerrain() {
  this.chunkManager = new ChunkManager({ ... })
  this.experience.terrainDataManager = this.chunkManager
  this.chunkManager.initInitialGrid()
}

// 3. update 顺序：地形流式 → 地形 update → 挖矿 → 玩家 → 环境 → 射线/选中框 → 粒子
update() {
  if (this.chunkManager && this.player) { /* streaming + pumpIdleQueue */ }
  this.chunkManager?.update()
  this.blockMiningController?.update()
  this.player?.update()
  this.environment?.update()
  this.blockRaycaster?.update()
  this.blockSelectionHelper?.update()
  this.blockBreakParticles?.update()
}

// 4. destroy 逆序：交互/效果/环境/相机/玩家 → chunkManager，并清空 terrainDataManager
destroy() {
  this.blockMiningOverlay?.dispose()
  this.blockInteractionManager?.destroy()
  // ... 其余依赖方 ...
  this.chunkManager?.destroy()
  if (this.experience.terrainDataManager === this.chunkManager)
    this.experience.terrainDataManager = null
}
```

## 常见错误

- **在 core:ready 之前访问 `this.resources.items` 或依赖地形的逻辑**  
  所有依赖资源的创建必须放在 `emitter.on('core:ready', () => { ... })` 内。
- **忘记在 update() 里调用子组件**  
  有 update 逻辑的组件必须在 `world.js` 的 `update()` 中按依赖顺序调用。
- **destroy 顺序错误**  
  先销毁依赖别人者（如 blockRaycaster），再销毁被依赖者（如 chunkManager）；否则可能访问已销毁对象。

---

修改 World 时，请直接打开 `src/js/world/world.js`，按上表与检查清单增删，并保持 init/update/destroy 三处一致。
