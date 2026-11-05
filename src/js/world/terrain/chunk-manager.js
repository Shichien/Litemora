import {
  CHUNK_BASIC_CONFIG,
  RENDER_PARAMS,
} from '../../config/chunk-config.js'
import Experience from '../../experience.js'
import { blocks, getBlockTypeById, getCollisionBoxesForBlockType } from './blocks-config.js'
import MinecraftSchematicLayer from './minecraft-schematic-layer.js'
import TerrainChunk from './terrain-chunk.js'
import TerrainPersistence from './terrain-persistence.js'

function buildMinecraftBlockString(blockName = '', properties = {}) {
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

    this.renderParams = { ...RENDER_PARAMS }

    this._statsParams = {
      totalInstances: 0,
      chunkCount: 0,
    }

    /** @type {Map<string, TerrainChunk>} */
    this.chunks = new Map()

    this.minecraftRenderOverlayActive = false
    this.minecraftRuntimeBlockProvider = null
    this._transientRemovedMinecraftBlocks = new Map()
    this._sessionBlockModifications = new Map()
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

  _key(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`
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

  _hasLegacyBlock(block) {
    return !!(block?.id && block.id !== blocks.empty.id)
  }

  _chunkLocalBlockKey(localX, localY, localZ) {
    return `${Math.floor(localX)},${Math.floor(localY)},${Math.floor(localZ)}`
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
    this._sessionBlockModifications.clear()
    this._sessionImportedBlockOrigins.clear()
  }

  _setSessionBlockModification(worldX, worldY, worldZ, blockId) {
    const chunkX = Math.floor(worldX / this.chunkWidth)
    const chunkZ = Math.floor(worldZ / this.chunkWidth)
    const chunkKey = this._key(chunkX, chunkZ)
    const localX = Math.floor(worldX - chunkX * this.chunkWidth)
    const localZ = Math.floor(worldZ - chunkZ * this.chunkWidth)
    const blockKey = this._chunkLocalBlockKey(localX, worldY, localZ)

    if (!this._sessionBlockModifications.has(chunkKey)) {
      this._sessionBlockModifications.set(chunkKey, new Map())
    }

    this._sessionBlockModifications.get(chunkKey).set(blockKey, Number(blockId))
  }

  _getSessionBlockModification(worldX, worldY, worldZ) {
    const chunkX = Math.floor(worldX / this.chunkWidth)
    const chunkZ = Math.floor(worldZ / this.chunkWidth)
    const chunkKey = this._key(chunkX, chunkZ)
    const localX = Math.floor(worldX - chunkX * this.chunkWidth)
    const localZ = Math.floor(worldZ - chunkZ * this.chunkWidth)
    const blockKey = this._chunkLocalBlockKey(localX, worldY, localZ)

    return this._sessionBlockModifications.get(chunkKey)?.get(blockKey)
  }

  _getSessionChunkModificationCoords() {
    const chunkCoords = []
    for (const chunkKey of this._sessionBlockModifications.keys()) {
      const [chunkX, chunkZ] = chunkKey.split(',').map(Number)
      if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
        continue
      }
      chunkCoords.push({ chunkX, chunkZ })
    }
    return chunkCoords
  }

  _getSessionChunkModifications(chunkX, chunkZ) {
    return this._sessionBlockModifications.get(this._key(chunkX, chunkZ)) || new Map()
  }

  _mergeChunkCoordLists(...coordGroups) {
    const merged = new Map()
    for (const coords of coordGroups) {
      for (const coord of coords || []) {
        const chunkX = Number(coord?.chunkX)
        const chunkZ = Number(coord?.chunkZ)
        if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
          continue
        }
        merged.set(this._key(chunkX, chunkZ), { chunkX, chunkZ })
      }
    }
    return [...merged.values()]
  }

  /**
   * 恢复玩家修改过的 chunk（世界本身没有程序化地形，只有这些 chunk 需要建网格）
   */
  initInitialGrid() {
    this.restoreModifiedChunks()
  }

  restoreModifiedChunks() {
    const coords = this._mergeChunkCoordLists(
      this.persistence?.getModifiedChunkCoords?.() || [],
      this._getSessionChunkModificationCoords(),
    )
    if (!coords.length) {
      this._updateStats()
      return
    }

    for (const { chunkX, chunkZ } of coords) {
      const chunk = this._ensureChunk(chunkX, chunkZ)
      if (!chunk || chunk.state === 'disposed') {
        continue
      }

      if (chunk.state === 'init') {
        chunk.container.clear()
        chunk.state = 'dataReady'
      }

      this._applyChunkModifications(chunk)

      if (chunk.state === 'dataReady') {
        const built = chunk.buildMesh()
        if (built) {
          chunk.renderer?.group?.scale?.setScalar?.(this.renderParams.scale)
        }
      }
      else if (chunk.state === 'meshReady') {
        chunk.renderer?._rebuildFromContainer?.()
        chunk.renderer?.group?.scale?.setScalar?.(this.renderParams.scale)
      }
    }

    this._updateStats()
  }

  /**
   * 获取 chunk（不存在则返回 null）
   */
  getChunk(chunkX, chunkZ) {
    return this.chunks.get(this._key(chunkX, chunkZ)) || null
  }

  /**
   * 世界坐标查询方块
   * - 这里的 x/y/z 约定为“方块中心的整数坐标”，与碰撞系统一致
   * - 若 chunk 未生成/不存在，返回 empty
   */
  getBlockWorld(x, y, z) {
    const sessionBlockId = this._getSessionBlockModification(x, y, z)

    const baseBlock = this._createEmptyBlockRecord()
    const resolvedBaseBlock = Number.isFinite(sessionBlockId)
      ? {
          id: sessionBlockId,
          instanceId: baseBlock?.instanceId ?? null,
        }
      : baseBlock

    const importedMinecraftBlock = this.getImportedMinecraftBlockWorld(x, y, z)
    const hasImportedMinecraftBlock = !!importedMinecraftBlock
    const hasImportedCollision = Array.isArray(importedMinecraftBlock?.collisionBoxes)
    const legacyBlockType = getBlockTypeById(resolvedBaseBlock?.id)
    const legacyCollisionBoxes = getCollisionBoxesForBlockType(legacyBlockType)
    const hasCollision = hasImportedCollision
      ? importedMinecraftBlock.collisionBoxes.length > 0
      : (Array.isArray(legacyCollisionBoxes) ? legacyCollisionBoxes.length > 0 : this._hasLegacyBlock(resolvedBaseBlock))

    return {
      ...resolvedBaseBlock,
      source: hasImportedMinecraftBlock
        ? 'minecraft-schematic'
        : (this._hasLegacyBlock(resolvedBaseBlock) ? 'legacy' : 'empty'),
      minecraftBlock: importedMinecraftBlock
        ? {
            name: `minecraft:${importedMinecraftBlock.blockName}`,
            properties: importedMinecraftBlock.properties,
          }
        : null,
      isImportedMinecraft: hasImportedMinecraftBlock,
      collisionBoxes: hasImportedCollision ? importedMinecraftBlock.collisionBoxes : legacyCollisionBoxes,
      collisionSource: importedMinecraftBlock?.collisionSource || null,
      hasCollision,
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
      const hasLocalOverride = Number.isFinite(this._getSessionBlockModification(x, y, z))
        || !!this._sessionMinecraftBlockLayer.getBlock(x, y, z)
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

  shouldRenderTerrainBlock(worldX, worldY, worldZ) {
    if (!this.minecraftRenderOverlayActive) {
      return true
    }

    return !this.getImportedMinecraftBlockWorld(worldX, worldY, worldZ)
  }

  setMinecraftRenderOverlayActive(enabled = true) {
    const nextValue = !!enabled
    if (this.minecraftRenderOverlayActive === nextValue) {
      return
    }

    this.minecraftRenderOverlayActive = nextValue
    this._rebuildAllChunks()
  }

  setMinecraftRuntimeBlockProvider(provider = null) {
    this.minecraftRuntimeBlockProvider = provider && typeof provider.getBlockWorld === 'function'
      ? provider
      : null
  }

  _refreshImportedMinecraftChunk(worldX, worldZ) {
    if (!this.minecraftRenderOverlayActive) {
      return false
    }

    const chunkX = Math.floor(Number(worldX) / this.chunkWidth)
    const chunkZ = Math.floor(Number(worldZ) / this.chunkWidth)
    const chunk = this.getChunk(chunkX, chunkZ)
    if (!chunk || chunk.state === 'disposed') {
      return false
    }

    const refreshed = chunk.refreshMesh?.()
    if (!refreshed) {
      return false
    }

    chunk.renderer?.group?.scale?.setScalar?.(this.renderParams.scale)
    this._updateStats()
    return true
  }

  refreshImportedMinecraftBlocks(worldBlocks = []) {
    if (!Array.isArray(worldBlocks) || !worldBlocks.length) {
      return false
    }

    const normalizedBlocks = new Map()
    const refreshedChunks = new Set()
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

      const chunkX = Math.floor(worldX / this.chunkWidth)
      const chunkZ = Math.floor(worldZ / this.chunkWidth)
      const chunkKey = this._key(chunkX, chunkZ)
      if (refreshedChunks.has(chunkKey)) {
        continue
      }

      if (this._refreshImportedMinecraftChunk(worldX, worldZ)) {
        refreshedChunks.add(chunkKey)
        refreshed = true
      }
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
    const refreshedChunks = new Set()
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

      const chunkX = Math.floor(worldX / this.chunkWidth)
      const chunkZ = Math.floor(worldZ / this.chunkWidth)
      const chunkKey = this._key(chunkX, chunkZ)
      if (refreshedChunks.has(chunkKey)) {
        continue
      }

      if (this._refreshImportedMinecraftChunk(worldX, worldZ)) {
        refreshedChunks.add(chunkKey)
        refreshed = true
      }
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

    if (this._hasLegacyBlock(block)) {
      return [{
        minX: x - 0.5,
        minY: y - 0.5,
        minZ: z - 0.5,
        maxX: x + 0.5,
        maxY: y + 0.5,
        maxZ: z + 0.5,
      }]
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

  getImportedMinecraftBlockLayer() {
    const overlayLayer = new MinecraftSchematicLayer({
      chunkWidth: this.chunkWidth,
    })

    this.minecraftSchematicLayer?.forEachBlock?.(({ worldX, worldY, worldZ }, entry) => {
      overlayLayer.setBlock(worldX, worldY, worldZ, entry?.blockName, entry?.properties || {})
    })
    this._sessionMinecraftBlockLayer?.forEachBlock?.(({ worldX, worldY, worldZ }, entry) => {
      overlayLayer.setBlock(worldX, worldY, worldZ, entry?.blockName, entry?.properties || {})
    })

    return overlayLayer
  }

  // #region 世界坐标删除方块
  /**
   * 世界坐标删除方块
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  removeBlockWorld(x, y, z) {
    const importedMinecraftBlock = this.getImportedMinecraftBlockWorld(x, y, z)
    if (importedMinecraftBlock) {
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

    const chunkX = Math.floor(x / this.chunkWidth)
    const chunkZ = Math.floor(z / this.chunkWidth)
    const chunk = this.getChunk(chunkX, chunkZ)

    if (!chunk)
      return false

    const localX = Math.floor(x - chunkX * this.chunkWidth)
    const localZ = Math.floor(z - chunkZ * this.chunkWidth)

    // 1. 获取方块信息（包含 instanceId）
    const block = chunk.container.getBlock(localX, y, localZ)
    if (!block || block.id === blocks.empty.id)
      return false

    const blockId = block.id
    const instanceId = block.instanceId
    const removedMinecraftBlock = this.getImportedMinecraftBlockWorld(x, y, z)
      ? this.clearImportedMinecraftBlock(x, y, z)
      : null

    // 2. 更新数据层
    chunk.container.setBlockId(localX, y, localZ, blocks.empty.id)

    // 3. 更新渲染层
    const renderer = chunk.renderer
    if (renderer) {
      const mesh = renderer._blockMeshes.get(blockId)
      if (mesh) {
        renderer.removeInstance(mesh, instanceId)
      }

      // 4. 揭示邻居方块（原本被遮挡，现在可能变得可见）
      const neighbors = [
        { x: localX + 1, y, z: localZ },
        { x: localX - 1, y, z: localZ },
        { x: localX, y: y + 1, z: localZ },
        { x: localX, y: y - 1, z: localZ },
        { x: localX, y, z: localZ + 1 },
        { x: localX, y, z: localZ - 1 },
      ]

      for (const n of neighbors) {
        // 只有在 chunk 范围内的邻居才处理（跨 chunk 揭示暂不考虑，逻辑会变复杂）
        if (n.x >= 0 && n.x < this.chunkWidth && n.z >= 0 && n.z < this.chunkWidth && n.y >= 0 && n.y < this.chunkHeight) {
          const neighborBlock = chunk.container.getBlock(n.x, n.y, n.z)

          // 如果邻居非空、没有实例，且现在不再被遮挡
          if (neighborBlock.id !== blocks.empty.id && neighborBlock.instanceId === null) {
            if (!chunk.container.isBlockObscured(n.x, n.y, n.z)) {
              renderer.addBlockInstance(n.x, n.y, n.z)
            }
          }
        }
      }
    }

    this._setSessionBlockModification(x, y, z, blocks.empty.id)
    if (removedMinecraftBlock) {
      this.syncMinecraftSchematicLayerState()
    }

    return {
      removed: true,
      source: 'legacy',
      worldBlock: { x, y, z },
      blockId,
      minecraftBlock: null,
    }
  }

  // #endregion

  // #region 世界坐标添加方块
  /**
   * 世界坐标添加方块
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} blockId
   */
  addBlockWorld(x, y, z, blockId) {
    const chunkX = Math.floor(x / this.chunkWidth)
    const chunkZ = Math.floor(z / this.chunkWidth)
    const chunk = this.getChunk(chunkX, chunkZ)

    if (!chunk)
      return false

    const localX = Math.floor(x - chunkX * this.chunkWidth)
    const localZ = Math.floor(z - chunkZ * this.chunkWidth)

    // 1. 检查目标位是否为空（防止重叠）
    const existingWorldBlock = this.getBlockWorld(x, y, z)
    const existing = chunk.container.getBlock(localX, y, localZ)
    if (existing.id !== blocks.empty.id || existingWorldBlock?.minecraftBlock)
      return false

    // 2. 更新数据层
    chunk.container.setBlockId(localX, y, localZ, blockId)
    const removedMinecraftBlock = this.getImportedMinecraftBlockWorld(x, y, z)
      ? this.clearImportedMinecraftBlock(x, y, z)
      : null

    // 3. 更新渲染层
    const renderer = chunk.renderer
    if (renderer) {
      // 3a. 如果自身不被遮挡，添加实例
      if (!chunk.container.isBlockObscured(localX, y, localZ)) {
        renderer.addBlockInstance(localX, y, localZ)
      }

      // 3b. 隐藏现在被遮挡的邻居方块
      const neighbors = [
        { x: localX + 1, y, z: localZ },
        { x: localX - 1, y, z: localZ },
        { x: localX, y: y + 1, z: localZ },
        { x: localX, y: y - 1, z: localZ },
        { x: localX, y, z: localZ + 1 },
        { x: localX, y, z: localZ - 1 },
      ]

      for (const n of neighbors) {
        // 只处理 chunk 范围内的邻居
        if (n.x >= 0 && n.x < this.chunkWidth && n.z >= 0 && n.z < this.chunkWidth && n.y >= 0 && n.y < this.chunkHeight) {
          const neighborBlock = chunk.container.getBlock(n.x, n.y, n.z)

          // 如果邻居非空、有实例、且现在被完全遮挡
          if (neighborBlock.id !== blocks.empty.id && neighborBlock.instanceId !== null) {
            if (chunk.container.isBlockObscured(n.x, n.y, n.z)) {
              // 移除实例
              const mesh = renderer._blockMeshes.get(neighborBlock.id)
              if (mesh) {
                renderer.removeInstance(mesh, neighborBlock.instanceId)
              }
              // 清空 instanceId（关键：这样被挖掘后才能正确揭露）
              chunk.container.setBlockInstanceId(n.x, n.y, n.z, null)
            }
          }
        }
      }
    }

    this._setSessionBlockModification(x, y, z, blockId)
    if (removedMinecraftBlock) {
      this.syncMinecraftSchematicLayerState()
    }

    return true
  }

  // #endregion

  // #region 获取某列 (worldX, worldZ) 的最高非空方块 y（找不到返回 null）
  /**
   * 获取某列 (worldX, worldZ) 的最高非空方块 y（找不到返回 null）
   * - 用于玩家重生点/贴地等
   */
  getTopSolidYWorld(worldX, worldZ) {
    const x = Math.floor(worldX)
    const z = Math.floor(worldZ)
    for (let y = this.chunkHeight - 1; y >= 0; y--) {
      const block = this.getBlockWorld(x, y, z)
      const hasLegacySolidBlock = !!block?.id && block.id !== blocks.empty.id
      const hasImportedSolidBlock = !!block?.isImportedMinecraft && block.hasCollision !== false

      if (!hasLegacySolidBlock && !hasImportedSolidBlock)
        continue
      if (hasImportedSolidBlock)
        return y

      // 排除所有树干和树叶类型
      const isTree
        = block.id === blocks.treeTrunk.id
          || block.id === blocks.treeLeaves.id
          || block.id === blocks.birchTrunk.id
          || block.id === blocks.birchLeaves.id
          || block.id === blocks.cherryTrunk.id
          || block.id === blocks.cherryLeaves.id

      if (!isTree) {
        return y
      }
    }
    return null
  }

  // #endregion

  /**
   * 确保 chunk 存在（不存在则创建）
   */
  _ensureChunk(chunkX, chunkZ) {
    const key = this._key(chunkX, chunkZ)
    if (this.chunks.has(key)) {
      return this.chunks.get(key)
    }

    const chunk = new TerrainChunk({
      chunkX,
      chunkZ,
      chunkWidth: this.chunkWidth,
      chunkHeight: this.chunkHeight,
      sharedRenderParams: this.renderParams,
      blockVisibilityFilter: (localX, localY, localZ) => this.shouldRenderTerrainBlock(
        (chunkX * this.chunkWidth) + localX,
        localY,
        (chunkZ * this.chunkWidth) + localZ,
      ),
    })

    this.chunks.set(key, chunk)

    // 标记需要应用修改（在生成后执行）
    const persistedMods = this.persistence.getChunkModifications(chunkX, chunkZ)
    const sessionMods = this._getSessionChunkModifications(chunkX, chunkZ)
    chunk._pendingModifications = new Map([
      ...persistedMods.entries(),
      ...sessionMods.entries(),
    ])

    return chunk
  }

  _scheduleSave() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout)
    }
    this._saveTimeout = setTimeout(() => {
      this.persistence.save()
    }, this._autoSaveDelay)
  }

  _applyChunkModifications(chunk) {
    if (!chunk._pendingModifications || chunk._pendingModifications.size === 0) {
      return
    }

    for (const [blockKey, blockId] of chunk._pendingModifications.entries()) {
      const [localX, localY, localZ] = blockKey.split(',').map(Number)

      // 直接修改 container 数据（跳过渲染，稍后统一重建）
      chunk.container.setBlockId(localX, localY, localZ, blockId)
    }

    // 清除标记
    chunk._pendingModifications = null
  }

  // #region 调试面板
  /**
   * 统一控制面板（所有 chunk 共用）
   */
  debugInit() {
    this.debugFolder = this.debug.ui.addFolder({
      title: 'Chunk 地形',
      expanded: false,
    })

    const renderFolder = this.debugFolder.addFolder({
      title: '渲染参数（全局）',
      expanded: true,
    })

    renderFolder.addBinding(this.renderParams, 'scale', {
      label: '整体缩放',
      min: 0.1,
      max: 3,
      step: 0.1,
    }).on('change', () => {
      // 直接同步所有 chunk 的 group 缩放
      this.chunks.forEach((chunk) => {
        chunk.renderer?.group?.scale?.setScalar?.(this.renderParams.scale)
      })
    })

    renderFolder.addBinding(this.renderParams, 'heightScale', {
      label: '高度缩放',
      min: 0.5,
      max: 5,
      step: 0.1,
    }).on('change', () => {
      // 需要重建所有 chunk 的 instanceMatrix
      this._rebuildAllChunks()
    })

    renderFolder.addBinding(this.renderParams, 'showOresOnly', {
      label: '仅显示矿产',
    }).on('change', () => {
      this._rebuildAllChunks()
    })

    const statsFolder = this.debugFolder.addFolder({
      title: '统计信息（全局）',
      expanded: false,
    })
    this._statsBinding = statsFolder.addBinding(this._statsParams, 'totalInstances', {
      label: '实例总数',
      readonly: true,
    })

    statsFolder.addBinding(this._statsParams, 'chunkCount', {
      label: 'Chunk 数量',
      readonly: true,
    })

    const persistFolder = this.debugFolder.addFolder({
      title: '持久化 (Persistence)',
      expanded: false,
    })

    const stats = this.persistence.getStats()
    const statsParams = {
      chunkCount: stats.chunkCount,
      totalMods: stats.totalModifications,
    }

    persistFolder.addBinding(statsParams, 'chunkCount', {
      label: '已修改 chunk 数',
      readonly: true,
    })

    persistFolder.addBinding(statsParams, 'totalMods', {
      label: '总修改数',
      readonly: true,
    })

    persistFolder.addButton({ title: '💾 手动保存' }).on('click', () => {
      this.persistence.save()
      const newStats = this.persistence.getStats()
      statsParams.chunkCount = newStats.chunkCount
      statsParams.totalMods = newStats.totalModifications
    })

    persistFolder.addButton({ title: '🔄 重新加载' }).on('click', () => {
      this.persistence.load()
      this._reloadModifiedChunks()
    })

    persistFolder.addButton({ title: '🗑️ 清除所有修改' }).on('click', () => {
      // eslint-disable-next-line no-alert
      if (confirm('确定要清除所有玩家修改吗？此操作不可恢复！')) {
        this.persistence.modifications.clear()
        this.persistence.save()
        this._reloadModifiedChunks()
      }
    })
  }

  // #endregion

  /**
   * 重建所有 chunk 的渲染层（基础参数如 scale/heightScale 变更）
   */
  _rebuildAllChunks() {
    this.chunks.forEach((chunk) => {
      chunk.buildMesh()
      // 同步 scale
      chunk.renderer?.group?.scale?.setScalar?.(this.renderParams.scale)
    })
    this._updateStats()
  }

  /**
   * 更新全局统计信息
   */
  _updateStats() {
    let total = 0
    this.chunks.forEach((chunk) => {
      const count = chunk.renderer?._statsParams?.totalInstances ?? 0
      total += count
    })
    this._statsParams.totalInstances = total
    this._statsParams.chunkCount = this.chunks.size
    if (this._statsBinding?.refresh)
      this._statsBinding.refresh()
  }

  /**
   * 每帧更新：遍历所有 chunk 更新动画材质
   */
  update() {
    this.chunks.forEach(chunk => chunk.update())
  }

  /**
   * 丢弃所有 chunk 后按持久化里的玩家修改重新建网格
   */
  _reloadModifiedChunks() {
    this.chunks.forEach(chunk => chunk.dispose())
    this.chunks.clear()
    this.restoreModifiedChunks()
  }

  destroy() {
    // Cancel pending save
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout)
      this._saveTimeout = null
    }

    // Dispose all chunks
    this.chunks.forEach((chunk) => {
      chunk.dispose()
    })
    this.chunks.clear()
    this.minecraftSchematicLayer?.clear?.()
    this.clearSessionInteractionState()
  }
}
