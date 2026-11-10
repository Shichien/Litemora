import { loadAdminAuthSession } from '../auth/admin-auth.js'
import { buildSpaceScopedKey, getActiveProjectionId, getActiveSpaceName } from '../utils/space-context.js'
import { decodeWorldStateSnapshot, encodeWorldStateSnapshot } from './terrain/world-state-codec.js'

/**
 * 世界状态持久化层。
 *
 * 从 world.js 抽离，职责边界：
 * - 本地 IndexedDB / localStorage 读写与回退
 * - 远端 `/api/world-state` 拉取（space-first）与保存
 * - snapshot 规范化（sanitize / 内容判定 / 调试摘要）
 *
 * 行为等价约束：请求 URL 与查询参数、回退顺序、IndexedDB key
 * （`mc-world-state` / `mc-world-state-storage`）与失败降级都必须与原实现逐字一致。
 *
 * 依赖通过显式 import（codec / space-context / admin-auth）或构造参数（debug）注入，
 * 本模块不创建 Experience、不使用 emitter。
 */

export const WORLD_STATE_STORAGE_KEY = 'mc-world-state'
const WORLD_STATE_DB_NAME = 'mc-world-state-storage'
const WORLD_STATE_DB_STORE = 'snapshots'
const WORLD_STATE_DB_VERSION = 1

export function normalizeStoredWorldStatePayload(record = null) {
  if (!record || typeof record !== 'object') {
    return null
  }

  if (record.payload && typeof record.payload === 'object') {
    return {
      payload: record.payload,
      updatedAt: Number(record.updatedAt || 0) || 0,
    }
  }

  return {
    payload: record,
    updatedAt: 0,
  }
}

function openWorldStateDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'))
      return
    }

    const request = indexedDB.open(WORLD_STATE_DB_NAME, WORLD_STATE_DB_VERSION)
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(WORLD_STATE_DB_STORE)) {
        db.createObjectStore(WORLD_STATE_DB_STORE, { keyPath: 'id' })
      }
    }
  })
}

async function loadWorldStateFromIndexedDb(storageKey) {
  const db = await openWorldStateDb()
  try {
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(WORLD_STATE_DB_STORE, 'readonly')
      const store = tx.objectStore(WORLD_STATE_DB_STORE)
      const request = store.get(storageKey)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'))
    })
    return normalizeStoredWorldStatePayload(record)
  }
  finally {
    db.close()
  }
}

async function saveWorldStateToIndexedDb(storageKey, payload) {
  const db = await openWorldStateDb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(WORLD_STATE_DB_STORE, 'readwrite')
      const store = tx.objectStore(WORLD_STATE_DB_STORE)
      store.put({
        id: storageKey,
        payload,
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

export async function loadLocalWorldStateRecord(storageKey) {
  try {
    const indexedDbRecord = await loadWorldStateFromIndexedDb(storageKey)
    if (indexedDbRecord?.payload && typeof indexedDbRecord.payload === 'object') {
      return {
        source: 'indexeddb',
        ...indexedDbRecord,
      }
    }
  }
  catch {
    // ignore IndexedDB failures and fall back to localStorage
  }

  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    const normalized = normalizeStoredWorldStatePayload(parsed)
    if (!normalized?.payload || typeof normalized.payload !== 'object') {
      return null
    }

    return {
      source: 'local-storage',
      ...normalized,
    }
  }
  catch {
    return null
  }
}

export async function persistWorldStateLocally(storageKey, payload) {
  let savedToIndexedDb = false
  try {
    await saveWorldStateToIndexedDb(storageKey, payload)
    savedToIndexedDb = true
  }
  catch {
    // continue with localStorage fallback below
  }

  if (savedToIndexedDb) {
    try {
      localStorage.removeItem(storageKey)
    }
    catch {
      // localStorage cleanup is not required for the IndexedDB-backed state
    }
    return
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify({
      payload,
      updatedAt: Date.now(),
    }))
  }
  catch {
    // ignore local storage quota errors
  }
}

export function hasSnapshotContent(snapshot = null) {
  // 旧体素地形的 snapshot.modifications 已不再渲染，只看原理图层是否真的有方块
  return hasSchematicBlockContent(snapshot)
}

/**
 * Check if the schematic snapshot actually has block data
 * @param {object} snapshot
 * @returns {boolean} True when the snapshot contains schematic block content.
 */
export function hasSchematicBlockContent(snapshot = null) {
  const minecraftChunks = snapshot?.worldState?.minecraftSchematicLayer?.chunks
  if (!minecraftChunks || typeof minecraftChunks !== 'object') {
    return false
  }

  // Check if any chunk has actual block data
  for (const chunk of Object.values(minecraftChunks)) {
    if (chunk && typeof chunk === 'object') {
      // Legacy shape: { blocks: { [blockKey]: entry } }
      if (chunk.blocks && typeof chunk.blocks === 'object' && Object.keys(chunk.blocks).length > 0) {
        return true
      }
      // Packed shape written by MinecraftSchematicLayer.exportSnapshot(): { p, pos, pid, c }
      if (
        Array.isArray(chunk.p)
        && chunk.p.length > 0
        && String(chunk.pos || '').trim()
        && String(chunk.pid || '').trim()
        && Number(chunk.c || 0) > 0
      ) {
        return true
      }
    }
  }

  return false
}

export function sanitizeSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== 'object') {
    return snapshot
  }

  const worldState = snapshot.worldState && typeof snapshot.worldState === 'object'
    ? { ...snapshot.worldState }
    : {}

  worldState.minecraftTransientRemovedBlocks = {}

  return {
    ...snapshot,
    worldState,
  }
}

export function summarizeSnapshotForDebug(snapshot = null) {
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : {}
  const modifications = safe.modifications && typeof safe.modifications === 'object'
    ? safe.modifications
    : {}
  const minecraftChunks = safe?.worldState?.minecraftSchematicLayer?.chunks
    && typeof safe.worldState.minecraftSchematicLayer.chunks === 'object'
    ? safe.worldState.minecraftSchematicLayer.chunks
    : {}

  let modificationCount = 0
  for (const blocks of Object.values(modifications)) {
    if (blocks && typeof blocks === 'object') {
      modificationCount += Object.keys(blocks).length
    }
  }

  return {
    format: safe.format || 'classic',
    chunkCount: Object.keys(modifications).length,
    modificationCount,
    minecraftSchematicChunkCount: Object.keys(minecraftChunks).length,
  }
}

/**
 * 世界状态读写服务。
 *
 * 只持有 debug 依赖；世界状态本身的来源（ChunkManager 快照）由调用方以
 * `exportSnapshot` / `chunkWidth` 显式传入，避免本模块反向依赖 World。
 */
export default class WorldStatePersistence {
  /**
   * @param {object} [options]
   * @param {(...args: any[]) => void} [options.debug] `#world-debug` 日志函数（由 World 注入，保持日志语义）
   */
  constructor({ debug = () => {} } = {}) {
    this._debug = debug
  }

  /**
   * 加载世界状态：本地优先 → space-first 远端 → 本地兜底 → fallback path 远端。
   * @returns {Promise<object|null>} 解码后的世界状态快照；无空间且远端不可用时为 null。
   */
  async loadSharedWorldState() {
    const activeSpace = getActiveSpaceName()
    const activeProjectionId = getActiveProjectionId()
    const storageKey = buildSpaceScopedKey(WORLD_STATE_STORAGE_KEY, activeSpace, activeProjectionId)
    const localRecord = await loadLocalWorldStateRecord(storageKey)
    const localDecoded = localRecord?.payload
      ? sanitizeSnapshot(decodeWorldStateSnapshot(localRecord.payload))
      : null

    if (localDecoded && hasSnapshotContent(localDecoded)) {
      this._debug('[World Debug] Loaded local world-state FULL:', localDecoded)
      this._debug('[World Debug] Loaded local world-state SUMMARY', {
        source: localRecord?.source || 'local',
        space: activeSpace || 'default',
        storageKey,
        ...summarizeSnapshotForDebug(localDecoded),
      })
      return localDecoded
    }

    if (activeSpace) {
      try {
        const url = new URL('/api/world-state', window.location.origin)
        url.searchParams.set('space', activeSpace)
        if (activeProjectionId) {
          url.searchParams.set('projection', activeProjectionId)
        }
        const requestUrl = `${url.pathname}${url.search}`
        const response = await fetch(requestUrl, { cache: 'no-store' })
        if (response.ok) {
          const data = await response.json()
          if (data && typeof data === 'object') {
            const decoded = sanitizeSnapshot(decodeWorldStateSnapshot(data))
            if (hasSnapshotContent(decoded) || !localDecoded) {
              this._debug('[World Debug] Loaded remote world-state (space-first)', {
                source: 'remote-space-first',
                space: activeSpace || 'default',
                storageKey,
                ...summarizeSnapshotForDebug(decoded),
              })
              await persistWorldStateLocally(storageKey, data)
              return decoded
            }
          }
        }
      }
      catch {
        // fallback to local state below
      }
    }

    if (localDecoded) {
      this._debug('[World Debug] Loaded local fallback world-state', {
        source: localRecord?.source || 'local-fallback',
        space: activeSpace || 'default',
        storageKey,
        ...summarizeSnapshotForDebug(localDecoded),
      })
      return localDecoded
    }

    try {
      const url = new URL('/api/world-state', window.location.origin)
      if (activeSpace) {
        url.searchParams.set('space', activeSpace)
      }
      if (activeProjectionId) {
        url.searchParams.set('projection', activeProjectionId)
      }
      const requestUrl = `${url.pathname}${url.search}` || '/api/world-state'
      const response = await fetch(requestUrl, { cache: 'no-store' })
      if (!response.ok) {
        return activeSpace
          ? { worldState: {}, modifications: {} }
          : null
      }

      const data = await response.json()
      if (!data || typeof data !== 'object') {
        return activeSpace
          ? { worldState: {}, modifications: {} }
          : null
      }

      const decoded = sanitizeSnapshot(decodeWorldStateSnapshot(data))
      this._debug('[World Debug] Loaded remote world-state (fallback path)', {
        source: 'remote-fallback',
        space: activeSpace || 'default',
        storageKey,
        ...summarizeSnapshotForDebug(decoded),
      })

      await persistWorldStateLocally(storageKey, data)

      return decoded
    }
    catch {
      return activeSpace
        ? { worldState: {}, modifications: {} }
        : null
    }
  }

  /**
   * 保存世界状态：先写本地（失败忽略），再在有 admin token 时 POST 到远端。
   * @param {object} options
   * @param {() => object} options.exportSnapshot 取当前持久化快照（保持原 `this` 绑定由调用方负责）
   * @param {number} [options.chunkWidth]
   * @returns {Promise<boolean>} 远端写入成功时为 true；无 token 或任一步骤失败时为 false。
   */
  async saveSharedWorldState({ exportSnapshot, chunkWidth } = {}) {
    try {
      const payload = exportSnapshot()
      const compactPayload = encodeWorldStateSnapshot(payload, { chunkWidth })
      const activeSpace = getActiveSpaceName()
      const activeProjectionId = getActiveProjectionId()
      const storageKey = buildSpaceScopedKey(WORLD_STATE_STORAGE_KEY, activeSpace, activeProjectionId)

      try {
        await persistWorldStateLocally(storageKey, compactPayload)
      }
      catch {
        // ignore local persistence failures and still try remote
      }

      const session = loadAdminAuthSession()
      const token = String(session?.token || '').trim()
      if (!token) {
        return false
      }

      const url = new URL('/api/world-state', window.location.origin)
      if (activeSpace) {
        url.searchParams.set('space', activeSpace)
      }
      if (activeProjectionId) {
        url.searchParams.set('projection', activeProjectionId)
      }
      const requestUrl = `${url.pathname}${url.search}` || '/api/world-state'

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(compactPayload),
      })

      if (!response.ok) {
        throw new Error(`remote_world_state_save_failed_${response.status}`)
      }

      this._debug('[World Debug] Saved world-state', {
        space: activeSpace || 'default',
        requestUrl,
        ...summarizeSnapshotForDebug(payload),
      })

      return true
    }
    catch (error) {
      console.warn('[World] Failed to persist shared world state remotely:', error)
      return false
    }
  }
}
