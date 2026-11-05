import { CHUNK_BASIC_CONFIG } from '../../config/chunk-config.js'
import Experience from '../../experience.js'
import { blocks } from './blocks-config.js'
import MinecraftSchematicLayer from './minecraft-schematic-layer.js'
import TerrainPersistence from './terrain-persistence.js'

export function buildMinecraftBlockString(blockName = '', properties = {}) {
  const normalizedBlockName = String(blockName || '')
    .trim()
    .replace(/^minecraft:/u, '')

  const entries = Object.entries(properties || {})
    .filter(([key, value]) => key && value !== undefined && value !== null && String(value).trim())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

  if (!normalizedBlockName) {
    return ''
  }

  if (!entries.length) {
    return `minecraft:${normalizedBlockName}`
  }

  const serialized = entries
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join(',')

  return `minecraft:${normalizedBlockName}[${serialized}]`
}

export default class ChunkManager {
  constructor(options = {}) {
    this.experience = new Experience()
    this.debug = this.experience.debug

    this.chunkWidth = options.chunkWidth ?? CHUNK_BASIC_CONFIG.chunkWidth
    this.chunkHeight = options.chunkHeight ?? CHUNK_BASIC_CONFIG.chunkHeight
    this.viewDistance = options.viewDistance ?? CHUNK_BASIC_CONFIG.viewDistance
    this.unloadPadding = options.unloadPadding ?? CHUNK_BASIC_CONFIG.unloadPadding

    this.minecraftRenderOverlayActive = false
    this.minecraftRuntimeBlockProvider = null
    this._transientRemovedMinecraftBlocks = new Map()
    this._sessionImportedBlockOrigins = new Map()
    this._sessionMinecraftBlockLayer = new MinecraftSchematicLayer({
      chunkWidth: this.chunkWidth,
    })

    this.persistence = new TerrainPersistence({
      worldName: options.worldName || CHUNK_BASIC_CONFIG.worldName,
      useIndexedDB: options.useIndexedDB ?? CHUNK_BASIC_CONFIG.useIndexedDB,
    })
    this.minecraftSchematicLayer = new MinecraftSchematicLayer({
      chunkWidth: this.chunkWidth,
    })
    this.persistenceReady = this.persistence.ready || Promise.resolve()
    this.persistenceReady.then(() => {
      this.restoreRuntimeStateFromPersistence()
    })

    this._saveTimeout = null
    this._autoSaveDelay = CHUNK_BASIC_CONFIG.autoSaveDelay

    if (this.debug.active) {
      this.debugInit()
    }
  }

  _worldBlockKey(worldX, worldY, worldZ) {
    return `${Math.floor(worldX)},${Math.floor(worldY)},${Math.floor(worldZ)}`
  }

  _parseWorldBlockKey(blockKey = '') {
    const [worldX, worldY, worldZ] = String(blockKey || '')
      .split(',')
      .map(value => Number(value))

    if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
      return null
    }

    return { worldX, worldY, worldZ }
  }

  _createEmptyBlockRecord() {
    return { id: blocks.empty.id, instanceId: null }
  }

  _cloneImportedMinecraftBlockEntry(entry = null) {
    if (!entry || typeof entry !== 'object') {
      return null
    }

    return {
      ...entry,
      properties: entry.properties && typeof entry.properties === 'object'
        ? { ...entry.properties }
        : {},
      collisionBoxes: Array.isArray(entry.collisionBoxes)
        ? entry.collisionBoxes.map(box => Array.isArray(box) ? [...box] : box)
        : entry.collisionBoxes,
    }
  }

  _rememberSessionImportedBlockOrigin(worldX, worldY, worldZ) {
    const blockKey = this._worldBlockKey(worldX, worldY, worldZ)
    if (this._sessionImportedBlockOrigins.has(blockKey)) {
      return this._sessionImportedBlockOrigins.get(blockKey)
    }

    const originEntry = this._cloneImportedMinecraftBlockEntry(
      this.minecraftSchematicLayer.getBlock(worldX, worldY, worldZ)
      || this.minecraftRuntimeBlockProvider?.getBlockWorld?.(worldX, worldY, worldZ),
    )

    this._sessionImportedBlockOrigins.set(blockKey, originEntry)
    return originEntry
  }

  _getSessionImportedBlockOrigin(worldX, worldY, worldZ) {
    const blockKey = this._worldBlockKey(worldX, worldY, worldZ)
    if (!this._sessionImportedBlockOrigins.has(blockKey)) {
      return undefined
    }

    return this._sessionImportedBlockOrigins.get(blockKey)
  }

  _clearSessionImportedBlockOrigin(worldX, worldY, worldZ) {
    this._sessionImportedBlockOrigins.delete(this._worldBlockKey(worldX, worldY, worldZ))
  }

  clearSessionInteractionState() {
    this._transientRemovedMinecraftBlocks.clear()
    this._sessionMinecraftBlockLayer.clear()
    this._sessionImportedBlockOrigins.clear()
  }

  /**
   * 世界坐标查询方块（只查 Minecraft 方块层：会话层 → 持久层 → 运行时原理图）
   * - 这里的 x/y/z 约定为“方块中心的整数坐标”，与碰撞系统一致
   * - 返回记录里的 id 恒为 empty（旧体素地形已移除），调用方用 isImportedMinecraft / minecraftBlock 判断
   */
  getBlockWorld(x, y, z) {
    const importedMinecraftBlock = this.getImportedMinecraftBlockWorld(x, y, z)
    const hasImportedMinecraftBlock = !!importedMinecraftBlock
    const hasImportedCollision = Array.isArray(importedMinecraftBlock?.collisionBoxes)

    return {
      ...this._createEmptyBlockRecord(),
      source: hasImportedMinecraftBlock ? 'minecraft-schematic' : 'empty',
      minecraftBlock: importedMinecraftBlock
        ? {
            name: `minecraft:${importedMinecraftBlock.blockName}`,
            properties: importedMinecraftBlock.properties,
          }
        : null,
      isImportedMinecraft: hasImportedMinecraftBlock,
      collisionBoxes: hasImportedCollision ? importedMinecraftBlock.collisionBoxes : null,
      collisionSource: importedMinecraftBlock?.collisionSource || null,
      hasCollision: hasImportedCollision && importedMinecraftBlock.collisionBoxes.length > 0,
      stateId: importedMinecraftBlock?.stateId ?? null,
      isClimbable: !!importedMinecraftBlock?.isClimbable,
    }
  }

  getBlocksWorld(worldPositions = []) {
    const positions = Array.isArray(worldPositions) ? worldPositions : []
    if (!positions.length) {
      return []
    }

    const runtimeEntries = this.minecraftRuntimeBlockProvider?.getBlocksWorld?.(positions)
    if (!Array.isArray(runtimeEntries) || runtimeEntries.length !== positions.length) {
      return positions.map(position => this.getBlockWorld(position.x, position.y, position.z))
    }

    return positions.map((position, index) => {
      const x = Number(position?.x)
      const y = Number(position?.y)
      const z = Number(position?.z)
      const blockKey = this._worldBlockKey(x, y, z)
      const hasLocalOverride = !!this._sessionMinecraftBlockLayer.getBlock(x, y, z)
        || !!this.minecraftSchematicLayer.getBlock(x, y, z)
        || this._transientRemovedMinecraftBlocks.has(blockKey)
      if (hasLocalOverride) {
        return this.getBlockWorld(x, y, z)
      }

      const importedMinecraftBlock = runtimeEntries[index]
      const collisionBoxes = Array.isArray(importedMinecraftBlock?.collisionBoxes)
        ? importedMinecraftBlock.collisionBoxes
        : []
      return {
        ...this._createEmptyBlockRecord(),
        source: importedMinecraftBlock ? 'minecraft-schematic' : 'empty',
        minecraftBlock: importedMinecraftBlock
          ? {
              name: `minecraft:${importedMinecraftBlock.blockName}`,
              properties: importedMinecraftBlock.properties,
            }
          : null,
        isImportedMinecraft: !!importedMinecraftBlock,
        collisionBoxes,
        collisionSource: importedMinecraftBlock?.collisionSource || null,
        hasCollision: collisionBoxes.length > 0,
        stateId: importedMinecraftBlock?.stateId ?? null,
        isClimbable: !!importedMinecraftBlock?.isClimbable,
      }
    })
  }

  setMinecraftRenderOverlayActive(enabled = true) {
    this.minecraftRenderOverlayActive = !!enabled
  }

  setMinecraftRuntimeBlockProvider(provider = null) {
    this.minecraftRuntimeBlockProvider = provider && typeof provider.getBlockWorld === 'function'
      ? provider
      : null
  }

  refreshImportedMinecraftBlocks(worldBlocks = []) {
    if (!Array.isArray(worldBlocks) || !worldBlocks.length) {
      return false
    }

    const normalizedBlocks = new Map()
    let refreshed = false
    for (const worldBlock of worldBlocks) {
      const worldX = Number(worldBlock?.worldX ?? worldBlock?.x)
      const worldY = Number(worldBlock?.worldY ?? worldBlock?.y)
      const worldZ = Number(worldBlock?.worldZ ?? worldBlock?.z)
      if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
        continue
      }

      const blockString = String(
        worldBlock?.blockString
        || worldBlock?.nextBlockString
        || buildMinecraftBlockString(worldBlock?.blockName, worldBlock?.properties),
      ).trim()
      normalizedBlocks.set(this._worldBlockKey(worldX, worldY, worldZ), {
        worldX,
        worldY,
        worldZ,
        blockString,
      })
    }

    const runtimeBlocks = [...normalizedBlocks.values()]
      .filter(worldBlock => worldBlock.blockString)
    if (runtimeBlocks.length && this.minecraftRuntimeBlockProvider?.setBlocksAtWorld) {
      refreshed = this.minecraftRuntimeBlockProvider.setBlocksAtWorld(runtimeBlocks) || refreshed
    }

    return refreshed
  }

  async refreshImportedMinecraftBlocksAsync(worldBlocks = []) {
    if (!Array.isArray(worldBlocks) || !worldBlocks.length) {
      return false
    }

    const normalizedBlocks = new Map()
    let refreshed = false
    for (const worldBlock of worldBlocks) {
      const worldX = Number(worldBlock?.worldX ?? worldBlock?.x)
      const worldY = Number(worldBlock?.worldY ?? worldBlock?.y)
      const worldZ = Number(worldBlock?.worldZ ?? worldBlock?.z)
      if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
        continue
      }

      const blockString = String(
        worldBlock?.blockString
        || worldBlock?.nextBlockString
        || buildMinecraftBlockString(worldBlock?.blockName, worldBlock?.properties),
      ).trim()
      normalizedBlocks.set(this._worldBlockKey(worldX, worldY, worldZ), {
        worldX,
        worldY,
        worldZ,
        blockString,
      })
    }

    const runtimeBlocks = [...normalizedBlocks.values()]
      .filter(worldBlock => worldBlock.blockString)
    if (runtimeBlocks.length && this.minecraftRuntimeBlockProvider?.setBlocksAtWorldAsync) {
      refreshed = (await this.minecraftRuntimeBlockProvider.setBlocksAtWorldAsync(runtimeBlocks)) || refreshed
    }
    else if (runtimeBlocks.length && this.minecraftRuntimeBlockProvider?.setBlocksAtWorld) {
      refreshed = this.minecraftRuntimeBlockProvider.setBlocksAtWorld(runtimeBlocks) || refreshed
    }

    return refreshed
  }

  getImportedMinecraftBlockRefreshUpdates({
    includeLayerBlocks = true,
    includeTransientRemoved = true,
  } = {}) {
    const updates = new Map()

    if (includeLayerBlocks) {
      this.getImportedMinecraftBlockLayer()?.forEachBlock?.(({ worldX, worldY, worldZ }, entry) => {
        const blockString = buildMinecraftBlockString(entry?.blockName, entry?.properties)
        if (!blockString) {
          return
        }

        updates.set(this._worldBlockKey(worldX, worldY, worldZ), {
          worldX,
          worldY,
          worldZ,
          blockString,
        })
      })
    }

    if (includeTransientRemoved) {
      for (const blockKey of this._transientRemovedMinecraftBlocks.keys()) {
        const coords = this._parseWorldBlockKey(blockKey)
        if (!coords) {
          continue
        }

        updates.set(blockKey, {
          ...coords,
          blockString: 'minecraft:air',
        })
      }
    }

    return [...updates.values()]
  }

  getCollisionBoxesWorld(x, y, z) {
    const block = this.getBlockWorld(x, y, z)
    if (Array.isArray(block?.collisionBoxes)) {
      return block.collisionBoxes.map(([minX, minY, minZ, maxX, maxY, maxZ]) => ({
        minX: x - 0.5 + Number(minX),
        minY: y - 0.5 + Number(minY),
        minZ: z - 0.5 + Number(minZ),
        maxX: x - 0.5 + Number(maxX),
        maxY: y - 0.5 + Number(maxY),
        maxZ: z - 0.5 + Number(maxZ),
      }))
    }

    return []
  }

  setBaseImportedMinecraftBlock(worldX, worldY, worldZ, blockName, properties = {}, options = {}) {
    const placed = this.minecraftSchematicLayer.setBlock(worldX, worldY, worldZ, blockName, properties)
    if (placed) {
      this._transientRemovedMinecraftBlocks.delete(this._worldBlockKey(worldX, worldY, worldZ))
      if (options.refreshTerrain !== false) {
        this.refreshImportedMinecraftBlocks([{
          worldX,
          worldY,
          worldZ,
          blockString: buildMinecraftBlockString(blockName, properties),
        }])
      }
    }
    return placed
  }

  setImportedMinecraftBlock(worldX, worldY, worldZ, blockName, properties = {}, options = {}) {
    this._rememberSessionImportedBlockOrigin(worldX, worldY, worldZ)
    const placed = this._sessionMinecraftBlockLayer.setBlock(worldX, worldY, worldZ, blockName, properties)
    if (placed) {
      this._transientRemovedMinecraftBlocks.delete(this._worldBlockKey(worldX, worldY, worldZ))
      if (options.refreshTerrain !== false) {
        this.refreshImportedMinecraftBlocks([{
          worldX,
          worldY,
          worldZ,
          blockString: buildMinecraftBlockString(blockName, properties),
        }])
      }
    }
    return placed
  }

  clearImportedMinecraftBlock(worldX, worldY, worldZ, options = {}) {
    const blockKey = this._worldBlockKey(worldX, worldY, worldZ)
    const importedMinecraftBlock = this.getImportedMinecraftBlockWorld(worldX, worldY, worldZ, {
      includeTransientRemoved: true,
    })
    if (!importedMinecraftBlock) {
      return false
    }

    const removedSessionOverride = this._sessionMinecraftBlockLayer.removeBlock(worldX, worldY, worldZ)
    const rememberedOrigin = this._getSessionImportedBlockOrigin(worldX, worldY, worldZ)
    const baseImportedBlock = rememberedOrigin !== undefined
      ? this._cloneImportedMinecraftBlockEntry(rememberedOrigin)
      : this._cloneImportedMinecraftBlockEntry(
          this.minecraftSchematicLayer.getBlock(worldX, worldY, worldZ)
          || this.minecraftRuntimeBlockProvider?.getBlockWorld?.(worldX, worldY, worldZ),
        )

    if (!removedSessionOverride && !baseImportedBlock) {
      return false
    }

    this._clearSessionImportedBlockOrigin(worldX, worldY, worldZ)

    if (baseImportedBlock) {
      this._transientRemovedMinecraftBlocks.set(blockKey, {
        blockName: String(baseImportedBlock.blockName || '').replace(/^minecraft:/u, ''),
        properties: { ...(baseImportedBlock.properties || {}) },
      })
    }
    else {
      this._transientRemovedMinecraftBlocks.delete(blockKey)
    }

    if (options.refreshTerrain !== false) {
      this.refreshImportedMinecraftBlocks([{
        worldX,
        worldY,
        worldZ,
        blockString: 'minecraft:air',
      }])
    }

    return true
  }

  async clearImportedMinecraftBlockAsync(worldX, worldY, worldZ, options = {}) {
    const blockKey = this._worldBlockKey(worldX, worldY, worldZ)
    const importedMinecraftBlock = this.getImportedMinecraftBlockWorld(worldX, worldY, worldZ, {
      includeTransientRemoved: true,
    })
    if (!importedMinecraftBlock) {
      return false
    }

    const removedSessionOverride = this._sessionMinecraftBlockLayer.removeBlock(worldX, worldY, worldZ)
    const rememberedOrigin = this._getSessionImportedBlockOrigin(worldX, worldY, worldZ)
    const baseImportedBlock = rememberedOrigin !== undefined
      ? this._cloneImportedMinecraftBlockEntry(rememberedOrigin)
      : this._cloneImportedMinecraftBlockEntry(
          this.minecraftSchematicLayer.getBlock(worldX, worldY, worldZ)
          || this.minecraftRuntimeBlockProvider?.getBlockWorld?.(worldX, worldY, worldZ),
        )

    if (!removedSessionOverride && !baseImportedBlock) {
      return false
    }

    this._clearSessionImportedBlockOrigin(worldX, worldY, worldZ)

    if (baseImportedBlock) {
      this._transientRemovedMinecraftBlocks.set(blockKey, {
        blockName: String(baseImportedBlock.blockName || '').replace(/^minecraft:/u, ''),
        properties: { ...(baseImportedBlock.properties || {}) },
      })
    }
    else {
      this._transientRemovedMinecraftBlocks.delete(blockKey)
    }

    if (options.refreshTerrain !== false) {
      await this.refreshImportedMinecraftBlocksAsync([{
        worldX,
        worldY,
        worldZ,
        blockString: 'minecraft:air',
      }])
    }

    return true
  }

  getImportedMinecraftBlockWorld(worldX, worldY, worldZ, options = {}) {
    const sessionEntry = this._sessionMinecraftBlockLayer.getBlock(worldX, worldY, worldZ)
    const persistedEntry = this.minecraftSchematicLayer.getBlock(worldX, worldY, worldZ)
    const entry = sessionEntry
      || persistedEntry
      || this.minecraftRuntimeBlockProvider?.getBlockWorld?.(worldX, worldY, worldZ)
    if (!entry) {
      return null
    }

    if (options.includeTransientRemoved) {
      return entry
    }

    return this._transientRemovedMinecraftBlocks.has(this._worldBlockKey(worldX, worldY, worldZ))
      ? null
      : entry
  }

  isImportedMinecraftBlockTransientlyRemoved(worldX, worldY, worldZ) {
    return this._transientRemovedMinecraftBlocks.has(this._worldBlockKey(worldX, worldY, worldZ))
  }

  async clearImportedMinecraftBlockTransientAsync(worldX, worldY, worldZ) {
    const importedMinecraftBlock = this.getImportedMinecraftBlockWorld(worldX, worldY, worldZ, {
      includeTransientRemoved: true,
    })
    if (!importedMinecraftBlock) {
      return false
    }

    const blockKey = this._worldBlockKey(worldX, worldY, worldZ)
    if (this._transientRemovedMinecraftBlocks.has(blockKey)) {
      return false
    }

    const removed = await this.clearImportedMinecraftBlockAsync(worldX, worldY, worldZ)
    if (!removed) {
      return false
    }

    return {
      removed: true,
      source: 'minecraft-schematic',
      worldBlock: { x: worldX, y: worldY, z: worldZ },
      blockId: null,
      minecraftBlock: {
        name: `minecraft:${importedMinecraftBlock.blockName}`,
        properties: importedMinecraftBlock.properties,
      },
      affectedBlockStates: [
        buildMinecraftBlockString(importedMinecraftBlock.blockName, importedMinecraftBlock.properties),
      ].filter(Boolean),
      transient: true,
    }
  }

  syncMinecraftSchematicLayerState({ scheduleSave = false } = {}) {
    this.persistence?.setWorldState?.({
      schematicOnlyMode: true,
      minecraftSchematicLayer: this.minecraftSchematicLayer.exportSnapshot(),
      minecraftTransientRemovedBlocks: null,
    })

    if (scheduleSave) {
      this._scheduleSave()
    }
  }

  restoreRuntimeStateFromPersistence() {
    const worldState = this.persistence?.getWorldState?.() || {}
    this.clearSessionInteractionState()
    this.minecraftSchematicLayer.importSnapshot(worldState.minecraftSchematicLayer)
  }

  /**
   * 持久层 + 会话层的只读合并视图（会话层覆盖持久层）
   * - 任一层为空时直接返回另一层，不再整层复制
   * - 调用方只读：forEachBlock / getBlock / getStats
   */
  getImportedMinecraftBlockLayer() {
    const persistedLayer = this.minecraftSchematicLayer
    const sessionLayer = this._sessionMinecraftBlockLayer
    if (!sessionLayer.chunks.size) {
      return persistedLayer
    }
    if (!persistedLayer.chunks.size) {
      return sessionLayer
    }

    return {
      getBlock: (worldX, worldY, worldZ) => sessionLayer.getBlock(worldX, worldY, worldZ)
        || persistedLayer.getBlock(worldX, worldY, worldZ),
      forEachBlock: (callback) => {
        if (typeof callback !== 'function') {
          return
        }
        persistedLayer.forEachBlock((position, entry) => {
          if (!sessionLayer.getBlock(position.worldX, position.worldY, position.worldZ)) {
            callback(position, entry)
          }
        })
        sessionLayer.forEachBlock(callback)
      },
      getStats: () => {
        let overlapCount = 0
        sessionLayer.forEachBlock(({ worldX, worldY, worldZ }) => {
          if (persistedLayer.getBlock(worldX, worldY, worldZ)) {
            overlapCount++
          }
        })
        const chunkKeys = new Set([...persistedLayer.chunks.keys(), ...sessionLayer.chunks.keys()])
        return {
          chunkCount: chunkKeys.size,
          blockCount: persistedLayer.getStats().blockCount + sessionLayer.getStats().blockCount - overlapCount,
        }
      },
    }
  }

  // #region 世界坐标删除方块
  /**
   * 世界坐标删除方块（Minecraft 方块层；会话内生效，不写回共享世界）
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  removeBlockWorld(x, y, z) {
    const importedMinecraftBlock = this.getImportedMinecraftBlockWorld(x, y, z)
    if (!importedMinecraftBlock) {
      return false
    }

    const removed = this.clearImportedMinecraftBlock(x, y, z)
    if (!removed) {
      return false
    }

    this.syncMinecraftSchematicLayerState()

    return {
      removed: true,
      source: 'minecraft-schematic',
      worldBlock: { x, y, z },
      blockId: blocks.empty.id,
      minecraftBlock: {
        name: `minecraft:${importedMinecraftBlock.blockName}`,
        properties: importedMinecraftBlock.properties,
      },
    }
  }

  // #endregion

  // #region 世界坐标放置方块
  /**
   * 在会话层放置一个 Minecraft 方块，并等待运行时原理图补丁完成
   * - 目标格已有方块时拒绝放置
   * - 运行时补丁失败时回滚会话层，返回 false
   * - 与开关交互一样只存在于本次会话，不写回共享世界状态
   * @returns {Promise<false | { placed: true, worldBlock: {x:number,y:number,z:number}, blockString: string }>} 放置结果；失败为 false。
   */
  async placeMinecraftBlockWorldAsync(x, y, z, blockName, properties = {}) {
    const worldX = Math.round(Number(x))
    const worldY = Math.round(Number(y))
    const worldZ = Math.round(Number(z))
    const blockString = buildMinecraftBlockString(blockName, properties)
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ) || !blockString) {
      return false
    }

    if (this.getImportedMinecraftBlockWorld(worldX, worldY, worldZ)) {
      return false
    }

    const blockKey = this._worldBlockKey(worldX, worldY, worldZ)
    const hadOrigin = this._sessionImportedBlockOrigins.has(blockKey)
    const previousTransient = this._transientRemovedMinecraftBlocks.get(blockKey)
    const placed = this.setImportedMinecraftBlock(worldX, worldY, worldZ, blockName, properties, {
      refreshTerrain: false,
    })
    if (!placed) {
      return false
    }

    const runtimeProvider = this.minecraftRuntimeBlockProvider
    if (runtimeProvider?.setBlocksAtWorldAsync || runtimeProvider?.setBlocksAtWorld) {
      const patched = await this.refreshImportedMinecraftBlocksAsync([{
        worldX,
        worldY,
        worldZ,
        blockString,
      }])
      if (!patched) {
        this._sessionMinecraftBlockLayer.removeBlock(worldX, worldY, worldZ)
        if (!hadOrigin) {
          this._clearSessionImportedBlockOrigin(worldX, worldY, worldZ)
        }
        if (previousTransient) {
          this._transientRemovedMinecraftBlocks.set(blockKey, previousTransient)
        }
        return false
      }
    }

    return {
      placed: true,
      worldBlock: { x: worldX, y: worldY, z: worldZ },
      blockString,
    }
  }

  // #endregion

  // #region 获取某列 (worldX, worldZ) 的最高非空方块 y（找不到返回 null）
  /**
   * 获取某列 (worldX, worldZ) 的最高有碰撞的 Minecraft 方块 y（找不到返回 null）
   * - 用于玩家重生点/贴地等
   */
  getTopSolidYWorld(worldX, worldZ) {
    const x = Math.floor(worldX)
    const z = Math.floor(worldZ)
    for (let y = this.chunkHeight - 1; y >= 0; y--) {
      const block = this.getBlockWorld(x, y, z)
      if (block?.isImportedMinecraft && block.hasCollision !== false) {
        return y
      }
    }
    return null
  }

  // #endregion

  _scheduleSave() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout)
    }
    this._saveTimeout = setTimeout(() => {
      this.persistence.save()
    }, this._autoSaveDelay)
  }

  // #region 调试面板
  debugInit() {
    this.debugFolder = this.debug.ui.addFolder({
      title: '地形持久化',
      expanded: false,
    })

    this.debugFolder.addButton({ title: '💾 手动保存' }).on('click', () => {
      this.persistence.save()
    })

    this.debugFolder.addButton({ title: '🔄 重新加载' }).on('click', async () => {
      await this.persistence.load()
      this.restoreRuntimeStateFromPersistence()
    })
  }

  // #endregion

  destroy() {
    // Cancel pending save
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout)
      this._saveTimeout = null
    }

    this.minecraftSchematicLayer?.clear?.()
    this.clearSessionInteractionState()
  }
}
