/**
 * TerrainPersistence：地形修改持久化管理
 * - 记录玩家对地形的所有修改（增删方块）
 * - 保存到 localStorage/IndexedDB
 * - chunk 生成后自动应用修改
 */
const TERRAIN_DB_NAME = 'litemora-terrain-persistence'
const TERRAIN_DB_STORE = 'snapshots'
const TERRAIN_DB_VERSION = 1
const INDEXED_DB_MARKER_FORMAT = 'terrain-persistence-indexeddb-v1'

function openTerrainDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'))
      return
    }

    const request = indexedDB.open(TERRAIN_DB_NAME, TERRAIN_DB_VERSION)
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(TERRAIN_DB_STORE)) {
        db.createObjectStore(TERRAIN_DB_STORE, { keyPath: 'id' })
      }
    }
  })
}

async function readTerrainRecord(id) {
  const db = await openTerrainDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(TERRAIN_DB_STORE, 'readonly')
      const store = tx.objectStore(TERRAIN_DB_STORE)
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'))
    })
  }
  finally {
    db.close()
  }
}

async function writeTerrainRecord(id, value) {
  const db = await openTerrainDb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(TERRAIN_DB_STORE, 'readwrite')
      const store = tx.objectStore(TERRAIN_DB_STORE)
      store.put({
        id,
        value,
        updatedAt: Date.now(),
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('indexeddb_write_failed'))
      tx.onabort = () => reject(tx.error || new Error('indexeddb_write_aborted'))
    })
  }
  finally {
    db.close()
  }
}

function hasMeaningfulTerrainState(worldState = {}, modifications = {}) {
  if (modifications && typeof modifications === 'object') {
    for (const value of Object.values(modifications)) {
      if (value && typeof value === 'object' && Object.keys(value).length > 0) {
        return true
      }
    }
  }

  const minecraftChunks = worldState?.minecraftSchematicLayer?.chunks
  if (minecraftChunks && typeof minecraftChunks === 'object') {
    for (const chunk of Object.values(minecraftChunks)) {
      if (!chunk || typeof chunk !== 'object') {
        continue
      }

      if (
        Array.isArray(chunk.p)
        && String(chunk.pos || '').trim()
        && String(chunk.pid || '').trim()
        && Number(chunk.c || 0) > 0
      ) {
        return true
      }

      if (chunk.blocks && typeof chunk.blocks === 'object' && Object.keys(chunk.blocks).length > 0) {
        return true
      }
    }
  }

  return false
}

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
    this.ready = Promise.resolve()
    this.lastSavePromise = Promise.resolve(true)

    // 加载已保存的修改
    this.ready = Promise.resolve(this.load()).catch((error) => {
      console.error('[TerrainPersistence] 持久化加载失败:', error)
      return false
    })
  }

  _modsStorageKey() {
    return `terrain_mods_${this.worldName}`
  }

  _stateStorageKey() {
    return `terrain_state_${this.worldName}`
  }

  _snapshotRecordKey() {
    return `terrain_snapshot_${this.worldName}`
  }

  _worldStateRecordKey() {
    return `terrain_world_state_${this.worldName}`
  }

  _createIndexedDbMarker(kind, key) {
    return {
      format: INDEXED_DB_MARKER_FORMAT,
      kind,
      key,
      updatedAt: Date.now(),
      schematicOnlyMode: !!this.worldState?.schematicOnlyMode,
    }
  }

  /**
   * 获取 chunk 的存储 key
   */
  _chunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`
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
   * @returns {Array<{chunkX:number, chunkZ:number}>} 已保存修改涉及的 chunk 坐标列表。
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
    const hasMeaningfulContent = hasMeaningfulTerrainState(worldState, modifications)

    // Preserve full worldState including minecraftSchematicLayer for schematic persistence
    this.worldState = {
      ...this.worldState,
      ...worldState,
      schematicOnlyMode: (worldState.schematicOnlyMode ?? this.worldState?.schematicOnlyMode ?? false)
        && hasMeaningfulContent,
    }
    this.deserialize(modifications)

    if (persist) {
      return this.save()
    }

    return Promise.resolve(true)
  }

  /**
   * 保存到 localStorage
   */
  save() {
    const operation = this.useIndexedDB
      ? this._saveToIndexedDB()
      : this._saveToLocalStorage()

    this.lastSavePromise = Promise.resolve(operation).catch((error) => {
      console.error('[TerrainPersistence] 保存失败:', error)
      return false
    })

    return this.lastSavePromise
  }

  /**
   * 从存储加载
   */
  load() {
    if (this.useIndexedDB) {
      return this._loadFromIndexedDB()
    }

    return this._loadFromLocalStorage()
  }

  _normalizeWorldState(worldState = {}) {
    return {
      ...(worldState && typeof worldState === 'object' ? worldState : {}),
      schematicOnlyMode: !!worldState?.schematicOnlyMode,
    }
  }

  _shouldStoreWorldStateInIndexedDB() {
    return !!this.worldState?.minecraftSchematicLayer
  }

  async _saveToLocalStorage() {
    try {
      const data = this.serialize()
      localStorage.setItem(this._modsStorageKey(), JSON.stringify(data))

      if (this._shouldStoreWorldStateInIndexedDB()) {
        const key = this._worldStateRecordKey()
        await writeTerrainRecord(key, {
          worldState: this._normalizeWorldState(this.worldState),
        })
        localStorage.setItem(this._stateStorageKey(), JSON.stringify(this._createIndexedDbMarker('world-state', key)))
        return true
      }

      localStorage.setItem(this._stateStorageKey(), JSON.stringify(this._normalizeWorldState(this.worldState)))
      return true
    }
    catch (error) {
      console.error('[TerrainPersistence] localStorage 保存失败:', error)
      return false
    }
  }

  async _loadFromLocalStorage() {
    try {
      const json = localStorage.getItem(this._modsStorageKey())
      if (json) {
        const data = JSON.parse(json)
        if (data?.format !== INDEXED_DB_MARKER_FORMAT) {
          this.deserialize(data)
        }
      }

      const worldStateRaw = localStorage.getItem(this._stateStorageKey())
      if (worldStateRaw) {
        const parsedState = JSON.parse(worldStateRaw)
        if (parsedState?.format === INDEXED_DB_MARKER_FORMAT) {
          this.worldState = {
            ...this.worldState,
            schematicOnlyMode: !!parsedState.schematicOnlyMode,
          }
          const record = await readTerrainRecord(parsedState.key || this._worldStateRecordKey())
          const storedWorldState = record?.value?.worldState
          if (storedWorldState && typeof storedWorldState === 'object') {
            const normalizedWorldState = this._normalizeWorldState(storedWorldState)
            this.worldState = {
              ...normalizedWorldState,
              schematicOnlyMode: normalizedWorldState.schematicOnlyMode
                && hasMeaningfulTerrainState(normalizedWorldState, this.modifications),
            }
          }
        }
        else {
          const normalizedWorldState = this._normalizeWorldState(parsedState)
          this.worldState = {
            ...normalizedWorldState,
            schematicOnlyMode: normalizedWorldState.schematicOnlyMode
              && hasMeaningfulTerrainState(normalizedWorldState, this.modifications),
          }
        }
      }

      return true
    }
    catch (error) {
      console.error('[TerrainPersistence] localStorage 加载失败:', error)
      return false
    }
  }

  // IndexedDB 实现（可选，用于大规模数据）
  async _saveToIndexedDB() {
    const snapshot = this.exportSnapshot()
    const key = this._snapshotRecordKey()
    await writeTerrainRecord(key, snapshot)

    const marker = this._createIndexedDbMarker('snapshot', key)
    try {
      localStorage.setItem(this._modsStorageKey(), JSON.stringify(marker))
      localStorage.setItem(this._stateStorageKey(), JSON.stringify(marker))
    }
    catch (error) {
      console.warn('[TerrainPersistence] IndexedDB 快照已保存，但 localStorage 标记写入失败:', error)
    }

    return true
  }

  async _loadFromIndexedDB() {
    try {
      const record = await readTerrainRecord(this._snapshotRecordKey())
      const snapshot = record?.value
      if (snapshot && typeof snapshot === 'object') {
        await this.applySnapshot(snapshot, { persist: false })
        return true
      }
    }
    catch (error) {
      console.warn('[TerrainPersistence] IndexedDB 加载失败，尝试 localStorage:', error)
    }

    return this._loadFromLocalStorage()
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
