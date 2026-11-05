/**
 * TerrainPersistence：世界状态持久化
 * - 保存 worldState（含 minecraftSchematicLayer 快照）到 localStorage/IndexedDB
 * - 旧体素地形的 `modifications` 已移除：读取时忽略，导出时恒为空对象（保持快照格式兼容）
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

function hasMeaningfulTerrainState(worldState = {}) {
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

  exportSnapshot() {
    return {
      worldState: { ...this.worldState },
      // 旧体素地形修改格式已废弃；保留空字段让 world-state 编解码与后端保持兼容
      modifications: {},
    }
  }

  applySnapshot(snapshot = {}, { persist = true } = {}) {
    const worldState = snapshot?.worldState || {}
    const hasMeaningfulContent = hasMeaningfulTerrainState(worldState)

    // Preserve full worldState including minecraftSchematicLayer for schematic persistence
    this.worldState = {
      ...this.worldState,
      ...worldState,
      schematicOnlyMode: (worldState.schematicOnlyMode ?? this.worldState?.schematicOnlyMode ?? false)
        && hasMeaningfulContent,
    }

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
      localStorage.removeItem(this._modsStorageKey())

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
                && hasMeaningfulTerrainState(normalizedWorldState),
            }
          }
        }
        else {
          const normalizedWorldState = this._normalizeWorldState(parsedState)
          this.worldState = {
            ...normalizedWorldState,
            schematicOnlyMode: normalizedWorldState.schematicOnlyMode
              && hasMeaningfulTerrainState(normalizedWorldState),
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
}
