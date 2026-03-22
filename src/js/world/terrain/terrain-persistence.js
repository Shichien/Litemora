/**
 * TerrainPersistence：地形修改持久化管理
 * - 记录玩家对地形的所有修改（增删方块）
 * - 保存到 localStorage/IndexedDB
 * - chunk 生成后自动应用修改
 */
export default class TerrainPersistence {
  constructor(options = {}) {
    this.worldName = options.worldName || 'default'
    this.useIndexedDB = options.useIndexedDB ?? false
    this.worldState = {
      schematicOnlyMode: false,
    }

    // 每个 chunk 的修改记录：Map<chunkKey, Map<blockKey, blockId>>
    // chunkKey: "x,z"
    // blockKey: "x,y,z" (chunk 局部坐标)
    // blockId: 方块类型 ID (0 表示删除)
    this.modifications = new Map()

    // 加载已保存的修改
    this.load()
  }

  _modsStorageKey() {
    return `terrain_mods_${this.worldName}`
  }

  _stateStorageKey() {
    return `terrain_state_${this.worldName}`
  }

  /**
   * 获取 chunk 的存储 key
   */
  _chunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`
  }

  /**
   * 获取方块的存储 key（chunk 局部坐标）
   */
  _blockKey(localX, localY, localZ) {
    return `${localX},${localY},${localZ}`
  }

  /**
   * 记录方块修改
   * @param {number} worldX 世界坐标 X
   * @param {number} worldY 世界坐标 Y
   * @param {number} worldZ 世界坐标 Z
   * @param {number} blockId 方块 ID（0 表示删除）
   * @param {number} chunkWidth chunk 宽度
   */
  recordModification(worldX, worldY, worldZ, blockId, chunkWidth) {
    const chunkX = Math.floor(worldX / chunkWidth)
    const chunkZ = Math.floor(worldZ / chunkWidth)
    const localX = Math.floor(worldX - chunkX * chunkWidth)
    const localZ = Math.floor(worldZ - chunkZ * chunkWidth)

    this.recordChunkLocalModification(chunkX, chunkZ, localX, worldY, localZ, blockId)
  }

  recordChunkLocalModification(chunkX, chunkZ, localX, localY, localZ, blockId) {
    const chunkKey = this._chunkKey(chunkX, chunkZ)
    const blockKey = this._blockKey(localX, localY, localZ)

    if (!this.modifications.has(chunkKey)) {
      this.modifications.set(chunkKey, new Map())
    }

    this.modifications.get(chunkKey).set(blockKey, blockId)
  }

  /**
   * 获取某个 chunk 的所有修改
   * @returns {Map<string, number>} blockKey -> blockId
   */
  getChunkModifications(chunkX, chunkZ) {
    const key = this._chunkKey(chunkX, chunkZ)
    return this.modifications.get(key) || new Map()
  }

  /**
   * 获取所有存在修改记录的 chunk 坐标
   * @returns {Array<{chunkX:number, chunkZ:number}>}
   */
  getModifiedChunkCoords() {
    const coords = []
    for (const chunkKey of this.modifications.keys()) {
      const [chunkX, chunkZ] = chunkKey.split(',').map(Number)
      if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
        continue
      }
      coords.push({ chunkX, chunkZ })
    }
    return coords
  }

  /**
   * 清除某个 chunk 的修改记录
   */
  clearChunkModifications(chunkX, chunkZ) {
    const key = this._chunkKey(chunkX, chunkZ)
    this.modifications.delete(key)
  }

  /**
   * 清空所有修改记录
   */
  clearAllModifications() {
    this.modifications.clear()
  }

  setWorldState(patch = {}) {
    this.worldState = {
      ...this.worldState,
      ...patch,
    }
  }

  getWorldState() {
    return {
      ...this.worldState,
    }
  }

  /**
   * 序列化为可保存的格式
   */
  serialize() {
    const data = {}
    for (const [chunkKey, blocks] of this.modifications.entries()) {
      data[chunkKey] = Object.fromEntries(blocks)
    }
    return data
  }

  exportSnapshot() {
    return {
      worldState: { ...this.worldState },
      modifications: this.serialize(),
    }
  }

  /**
   * 从序列化数据恢复
   */
  deserialize(data) {
    this.modifications.clear()
    for (const [chunkKey, blocks] of Object.entries(data)) {
      const blockMap = new Map(Object.entries(blocks).map(([k, v]) => [k, Number(v)]))
      this.modifications.set(chunkKey, blockMap)
    }
  }

  applySnapshot(snapshot = {}, { persist = true } = {}) {
    const worldState = snapshot?.worldState || {}
    const modifications = snapshot?.modifications || {}

    // Preserve full worldState including minecraftSchematicLayer for schematic persistence
    this.worldState = {
      ...this.worldState,
      ...worldState,
      schematicOnlyMode: worldState.schematicOnlyMode ?? this.worldState?.schematicOnlyMode ?? false,
    }
    this.deserialize(modifications)

    if (persist) {
      this.save()
    }
  }

  /**
   * 保存到 localStorage
   */
  save() {
    if (this.useIndexedDB) {
      this._saveToIndexedDB()
    }
    else {
      this._saveToLocalStorage()
    }
  }

  /**
   * 从存储加载
   */
  load() {
    if (this.useIndexedDB) {
      this._loadFromIndexedDB()
    }
    else {
      this._loadFromLocalStorage()
    }
  }

  _saveToLocalStorage() {
    try {
      const data = this.serialize()
      localStorage.setItem(this._modsStorageKey(), JSON.stringify(data))
      localStorage.setItem(this._stateStorageKey(), JSON.stringify(this.worldState))
    }
    catch (error) {
      console.error('[TerrainPersistence] localStorage 保存失败:', error)
    }
  }

  _loadFromLocalStorage() {
    try {
      const json = localStorage.getItem(this._modsStorageKey())
      if (json) {
        const data = JSON.parse(json)
        this.deserialize(data)
      }

      const worldStateRaw = localStorage.getItem(this._stateStorageKey())
      if (worldStateRaw) {
        const parsedState = JSON.parse(worldStateRaw)
        this.worldState = {
          schematicOnlyMode: !!parsedState?.schematicOnlyMode,
        }
      }
    }
    catch (error) {
      console.error('[TerrainPersistence] localStorage 加载失败:', error)
    }
  }

  clearAllPersistedData() {
    this.modifications.clear()
    this.worldState = {
      schematicOnlyMode: false,
    }

    try {
      localStorage.removeItem(this._modsStorageKey())
      localStorage.removeItem(this._stateStorageKey())
    }
    catch (error) {
      console.error('[TerrainPersistence] 清理持久化数据失败:', error)
    }
  }

  // IndexedDB 实现（可选，用于大规模数据）
  async _saveToIndexedDB() {
    // TODO: 实现 IndexedDB 版本（适合大世界）
    this._saveToLocalStorage()
  }

  async _loadFromIndexedDB() {
    this._loadFromLocalStorage()
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalModifications = 0
    for (const blocks of this.modifications.values()) {
      totalModifications += blocks.size
    }
    return {
      chunkCount: this.modifications.size,
      totalModifications,
    }
  }
}
