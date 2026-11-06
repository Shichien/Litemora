import { useSettingsStore } from '../../pinia/settingsStore.js'
import { useUiStore } from '../../pinia/uiStore.js'
import { loadAdminAuthSession } from '../auth/admin-auth.js'
import CameraRig from '../camera/camera-rig.js'
import {
  CHUNK_BASIC_CONFIG,
} from '../config/chunk-config.js'
import { INTERACTION_CONFIG } from '../config/interaction-config.js'
import Experience from '../experience.js'
import { fetchGalleryItem, fetchGalleryItemSource } from '../gallery/gallery-api.js'
import BlockBreakParticles from '../interaction/block-break-particles.js'
import BlockInteractionManager from '../interaction/block-interaction-manager.js'
import BlockMiningController from '../interaction/block-mining-controller.js'
import BlockMiningOverlay from '../interaction/block-mining-overlay.js'
import BlockRaycaster from '../interaction/block-raycaster.js'
import BlockSelectionHelper from '../interaction/block-selection-helper.js'
import ItemPickupAnimator from '../interaction/item-pickup-animator.js'
import emitter from '../utils/event/event-bus.js'
import { navigateToUrl } from '../utils/navigation.js'
import { buildProjectionSpawnPointFromPreview } from '../utils/projection-spawn.js'
import { readSharedPosition } from '../utils/share-position.js'
import { buildSpaceScopedKey, getActiveProjectionId, getActiveSpaceName } from '../utils/space-context.js'
import {
  loadBackendWorldConfig,
  loadBackendWorldConfigRecord,
  normalizeBackendWorldConfig,
  saveAdminWorldConfig,
  saveBackendWorldConfigRemote,
} from './backend-world-config.js'
import Environment from './environment.js'
import Player from './player/player.js'
import PortalLinkController from './portal-link-controller.js'
import RedstoneReplayController, { resolveRedstoneReplayUrl } from './redstone-replay-controller.js'
import { loadRedstoneReplayTimeline } from './redstone-replay-loader.js'
import ChunkManager from './terrain/chunk-manager.js'
import MinecraftSchematicRenderLayer from './terrain/minecraft-schematic-render-layer.js'
import schematicService from './terrain/schematic-service.js'
import { decodeWorldStateSnapshot, encodeWorldStateSnapshot } from './terrain/world-state-codec.js'

const WORLD_STATE_STORAGE_KEY = 'mc-world-state'
const WORLD_STATE_DB_NAME = 'mc-world-state-storage'
const WORLD_STATE_DB_STORE = 'snapshots'
const WORLD_STATE_DB_VERSION = 1
const WORLD_DEBUG_ENABLED = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('world-debug')

function debugWorld(...args) {
  if (WORLD_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function decodeBase64ToArrayBuffer(base64Text = '') {
  const binary = atob(String(base64Text || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function normalizeRuntimeOffset(offset = {}) {
  return {
    x: Math.floor(Number(offset.x || 0)),
    y: Math.floor(Number(offset.y || 0)),
    z: Math.floor(Number(offset.z || 0)),
  }
}

function buildRuntimeBufferSignature(buffer = null) {
  if (!(buffer instanceof ArrayBuffer)) {
    return ''
  }

  const bytes = new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength))
  return `${buffer.byteLength}:${Array.from(bytes).join(',')}`
}

function createRuntimeRenderSource(buffer, options = {}) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 0) {
    return null
  }

  const name = String(options.name || 'runtime-schematic').trim()
  const blockCount = Math.max(0, Math.round(Number(options.blockCount || 0)))
  return {
    id: [
      String(options.id || ''),
      name,
      buildRuntimeBufferSignature(buffer),
    ].join(':'),
    name,
    buffer,
    offset: normalizeRuntimeOffset(options.offset),
    blockCount,
  }
}

function getRuntimeRenderBlockCount(runtimeSource = null) {
  const blockCount = Number(runtimeSource?.blockCount || 0)
  return Number.isFinite(blockCount) && blockCount > 0
    ? Math.round(blockCount)
    : 0
}

function getProjectionPreviewMetadata(item = null) {
  const schematic = item?.schematic && typeof item.schematic === 'object'
    ? item.schematic
    : null
  const previewModel = item?.previewModel && typeof item.previewModel === 'object'
    ? item.previewModel
    : null
  const preview = item?.preview && typeof item.preview === 'object'
    ? item.preview
    : null
  const bounds = preview?.bounds || previewModel?.bounds || schematic?.bounds || null
  const blockCount = Math.max(
    0,
    Math.round(Number(preview?.totalSolidBlocks || 0)),
    Math.round(Number(previewModel?.totalSolidBlocks || previewModel?.blockCount || 0)),
    Math.round(Number(schematic?.blockCount || 0)),
  )

  if (!bounds && blockCount <= 0) {
    return null
  }

  return {
    name: String(schematic?.name || previewModel?.name || item?.title || ''),
    author: String(schematic?.author || previewModel?.author || ''),
    size: schematic?.size || previewModel?.size || null,
    regionCount: Math.max(0, Math.round(Number(schematic?.regionCount || previewModel?.regionCount || 0))),
    blockCount,
    yStats: schematic?.yStats || previewModel?.yStats || null,
    bounds,
  }
}

function attachRuntimePreviewStats(runtimeSource = null, preview = null) {
  if (!runtimeSource) {
    return null
  }

  return {
    ...runtimeSource,
    preview,
    blockCount: Math.max(
      getRuntimeRenderBlockCount(runtimeSource),
      Math.max(0, Math.round(Number(preview?.blockCount || 0))),
    ),
  }
}

function hasSpawnPoint(config = null) {
  const spawnPoint = config?.player?.spawnPoint
  return Number.isFinite(Number(spawnPoint?.x))
    && Number.isFinite(Number(spawnPoint?.y))
    && Number.isFinite(Number(spawnPoint?.z))
}

function isSpawnPointNearProjectionBounds(spawnPoint = null, preview = null, offset = null, margin = 16) {
  if (!spawnPoint || !preview?.bounds) {
    return false
  }

  const offsetX = Number(offset?.x || 0)
  const offsetY = Number(offset?.y || 0)
  const offsetZ = Number(offset?.z || 0)
  const safeMargin = Math.max(0, Number(margin) || 0)
  const minX = Number(preview.bounds.minX) + offsetX - safeMargin
  const maxX = Number(preview.bounds.maxX) + offsetX + safeMargin
  const minY = Number(preview.bounds.minY) + offsetY - safeMargin
  const maxY = Number(preview.bounds.maxY) + offsetY + safeMargin + 8
  const minZ = Number(preview.bounds.minZ) + offsetZ - safeMargin
  const maxZ = Number(preview.bounds.maxZ) + offsetZ + safeMargin

  const x = Number(spawnPoint.x)
  const y = Number(spawnPoint.y)
  const z = Number(spawnPoint.z)
  return x >= minX && x <= maxX
    && y >= minY && y <= maxY
    && z >= minZ && z <= maxZ
}

function hasProjectionContentSource(projectionContext = null, sharedWorldState = null) {
  if (hasSchematicBlockContent(sharedWorldState)) {
    return true
  }

  const sourceFile = projectionContext?.item?.sourceFile || null
  if (!sourceFile || typeof sourceFile !== 'object') {
    return false
  }

  if (sourceFile.fileBase64) {
    return true
  }

  return !!String(sourceFile.fileName || '').trim()
}

function normalizeStoredWorldStatePayload(record = null) {
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

async function loadLocalWorldStateRecord(storageKey) {
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

async function persistWorldStateLocally(storageKey, payload) {
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

function hasSnapshotContent(snapshot = null) {
  // 旧体素地形的 snapshot.modifications 已不再渲染，只看原理图层是否真的有方块
  return hasSchematicBlockContent(snapshot)
}

/**
 * Check if the schematic snapshot actually has block data
 * @param {object} snapshot
 * @returns {boolean} True when the snapshot contains schematic block content.
 */
function hasSchematicBlockContent(snapshot = null) {
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

function sanitizeSnapshot(snapshot = null) {
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

function summarizeSnapshotForDebug(snapshot = null) {
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
 * World 场景编排器：只负责在 core:ready 后按依赖顺序创建组件、编排 update/destroy。
 * 具体职责见 .agent/skills/vtj-scene-management/SKILL.md
 */
export default class World {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.resources = this.experience.resources
    this.backendConfig = null
    this.backendConfigRecord = null
    this.minecraftSchematicRenderLayer = null
    this.redstoneReplayController = null
    this._minecraftSchematicRuntimeSource = null
    this.activeProjectionContext = null
    this._projectionBootstrapApplied = false
    this._needsMinecraftSchematicRenderLayerRestore = false
    this._minecraftRenderLayerSyncTimer = null
    this._minecraftRenderLayerRestoreTimer = null
    this.isSceneReady = false
    this._onMinecraftBlockBreakComplete = this._onMinecraftBlockBreakComplete.bind(this)
    this._onMinecraftBlockPlace = this._onMinecraftBlockPlace.bind(this)
    this._onMinecraftBlockUse = this._onMinecraftBlockUse.bind(this)

    emitter.on('game:block-break-complete', this._onMinecraftBlockBreakComplete)
    emitter.on('game:block-place', this._onMinecraftBlockPlace)
    emitter.on('game:block-use', this._onMinecraftBlockUse)

    // Listen for resource loading errors to help diagnose issues
    emitter.on('core:resource-error', (error) => {
      console.error('[World] Resource failed to load:', error.name, '-', error.path, '-', error.message)
    })

    // 场景数据不依赖贴图/模型，构造时就并行发起，和 Resources 的加载重叠
    this._bootstrap = this._startBootstrapPrefetch()

    emitter.on('core:ready', async () => {
      const initStartedAt = performance.now()

      try {
        const [projectionContext, backendConfigRecord, sharedWorldState] = await Promise.all([
          this._bootstrap.projectionContext,
          this._bootstrap.backendConfigRecord,
          this._bootstrap.sharedWorldState,
        ])
        this.activeProjectionContext = projectionContext
        this.backendConfigRecord = backendConfigRecord
        this.backendConfig = this.backendConfigRecord.config

        await this._initTerrain(this.backendConfig, sharedWorldState)
        this.backendConfig = await this._ensureProjectionWorldInitialized(sharedWorldState, this.backendConfig)

        this._initPlayerAndCamera()
        this._initEnvironment()
        this._initBlockInteraction()
        this._initEffects()
        this._setupSettingsListeners()
        await this._applyBackendRuntimeConfig(this.backendConfig, { movePlayer: true })
        this._applySharedPosition()
        this.redstoneReplayController = new RedstoneReplayController({ world: this })
        await this.redstoneReplayController.initialize()

        this.isSceneReady = true
        emitter.emit('world:scene-ready', {
          projectionId: this.activeProjectionContext?.projectionId || '',
          bootstrapApplied: this._projectionBootstrapApplied,
        })

        if (this._needsMinecraftSchematicRenderLayerRestore || !this._projectionBootstrapApplied) {
          this._scheduleInitialMinecraftSchematicRenderLayerRestore()
        }

        debugWorld('[World] Scene ready', {
          projectionId: this.activeProjectionContext?.projectionId || '',
          bootstrapApplied: this._projectionBootstrapApplied,
          deferredRenderLayerRestore: this._needsMinecraftSchematicRenderLayerRestore || !this._projectionBootstrapApplied,
          elapsedMs: Number((performance.now() - initStartedAt).toFixed(2)),
        })
      }
      catch (error) {
        console.error('[World] Failed to initialize scene:', error)
        emitter.emit('projection:bootstrap-error', {
          spaceName: this.activeProjectionContext?.spaceName || getActiveSpaceName(),
          projectionId: this.activeProjectionContext?.projectionId || getActiveProjectionId(),
          error: error?.message || 'world_scene_init_failed',
        })
      }
    })

    emitter.on('backend:config-updated', async (config) => {
      this.backendConfig = config
      await this._applyBackendRuntimeConfig(config, { movePlayer: false })
    })

    emitter.on('schematic:apply-request', async (payload = {}) => {
      try {
        const result = await this._applySchematicPayload(payload)
        emitter.emit('schematic:apply-result', { ok: true, result })
      }
      catch (error) {
        emitter.emit('schematic:apply-result', {
          ok: false,
          error: error?.message || 'Unknown schematic apply error',
        })
      }
    })

    emitter.on('minecraft:resource-pack-changed', async () => {
      try {
        this.minecraftSchematicRenderLayer?.invalidateResourcePack?.()
        await this._syncMinecraftSchematicRenderLayer()
      }
      catch (error) {
        console.warn('[World] Failed to refresh Minecraft resource pack:', error)
      }
    })
  }

  /**
   * 进入场景时一次性并行发起所有网络读取：
   * 投影元数据 / 世界配置 / 世界状态 互不依赖，同时请求；
   * 原理图源文件和红石回放只依赖元数据（回放还依赖配置），拿到后立即请求；
   * schematic-renderer 的 WASM 和资源包也在这时预热，不再等地形/原理图处理完。
   */
  _startBootstrapPrefetch() {
    // 预取 promise 先挂一个 catch，避免未处理拒绝；真正的消费方仍会 await 并处理错误
    const silence = (promise, label = 'prefetch') => {
      promise.catch((error) => {
        console.warn(`[World] Bootstrap ${label} failed:`, error)
      })
      return promise
    }

    const projectionContext = silence(this._loadActiveProjectionContext(), 'projection context')
    const backendConfigRecord = silence(loadBackendWorldConfigRecord(), 'world config')
    const sharedWorldState = silence(this._loadSharedWorldState(), 'world state')

    const sourcePayload = silence(projectionContext.then((context) => {
      if (!context?.projectionId || !context?.item?.sourceFile) {
        return null
      }
      this._prewarmMinecraftSchematicRuntime()
      return this._fetchProjectionSourcePayload(context)
    }), 'projection source')

    const replay = silence(Promise.all([projectionContext, backendConfigRecord]).then(([context, record]) => {
      const item = context?.item || null
      if (item?.redstoneReplay && typeof item.redstoneReplay === 'object') {
        return null
      }
      const replayUrl = resolveRedstoneReplayUrl(item, record?.config)
      if (!replayUrl) {
        return null
      }
      // 下载、解压、解析、预处理都在 worker 里，和区块加载并行
      return { url: replayUrl, data: silence(loadRedstoneReplayTimeline(replayUrl), 'redstone replay timeline') }
    }), 'redstone replay')

    return {
      projectionContext,
      backendConfigRecord,
      sharedWorldState,
      sourcePayload,
      sourceProjectionContext: projectionContext,
      replay,
    }
  }

  _prewarmMinecraftSchematicRuntime() {
    void this._ensureMinecraftSchematicRenderLayer()
      .then(renderLayer => renderLayer.prewarmRuntime?.())
      .catch((error) => {
        console.warn('[World] Failed to prewarm schematic renderer:', error)
      })
  }

  /** 取用预取的原理图源文件（只用一次，之后释放引用）；上下文不一致时重新请求 */
  async _takeProjectionSourcePayload(projectionContext = this.activeProjectionContext) {
    const bootstrap = this._bootstrap
    if (bootstrap?.sourcePayload) {
      const prefetchedPromise = bootstrap.sourcePayload
      const prefetchedContext = await bootstrap.sourceProjectionContext
      bootstrap.sourcePayload = null
      if (prefetchedContext === projectionContext) {
        const prefetched = await prefetchedPromise.catch(() => null)
        if (prefetched) {
          return prefetched
        }
      }
    }
    return this._fetchProjectionSourcePayload(projectionContext)
  }

  /** 供 RedstoneReplayController 取用预取的回放（URL 一致才复用） */
  takePrefetchedRedstoneReplay(replayUrl) {
    const pending = this._bootstrap?.replay
    if (!pending) {
      return null
    }
    this._bootstrap.replay = null
    return pending.then((entry) => {
      if (entry?.url === replayUrl) {
        return entry.data
      }
      return loadRedstoneReplayTimeline(replayUrl)
    })
  }

  async _loadActiveProjectionContext() {
    const spaceName = getActiveSpaceName()
    const projectionId = getActiveProjectionId()
    debugWorld('[World Debug] _loadActiveProjectionContext:', { spaceName, projectionId, pathname: window.location.pathname, search: window.location.search })
    if (!spaceName || !projectionId) {
      debugWorld('[World Debug] _loadActiveProjectionContext returning null: no spaceName or projectionId')
      return null
    }

    try {
      // Guests don't need a session for public projections
      const session = loadAdminAuthSession()
      const payload = await fetchGalleryItem(spaceName, projectionId, session)
      return {
        spaceName,
        projectionId,
        item: payload?.item || null,
      }
    }
    catch (error) {
      debugWorld('[World] Failed to load projection metadata:', error)
      emitter.emit('projection:bootstrap-error', {
        spaceName,
        projectionId,
        error: error?.message || 'projection_metadata_load_failed',
      })
      return {
        spaceName,
        projectionId,
        item: null,
      }
    }
  }

  _getProjectionPlacementOffset(projectionContext = this.activeProjectionContext) {
    return {
      x: Number(projectionContext?.item?.placement?.offset?.x || 0),
      y: Number(projectionContext?.item?.placement?.offset?.y || 0),
      z: Number(projectionContext?.item?.placement?.offset?.z || 0),
    }
  }

  async _fetchProjectionSourcePayload(projectionContext = this.activeProjectionContext) {
    const sourceFile = projectionContext?.item?.sourceFile
    if (!projectionContext?.projectionId || !sourceFile) {
      return null
    }

    if (sourceFile.fileBase64) {
      const buffer = decodeBase64ToArrayBuffer(sourceFile.fileBase64)
      return {
        buffer,
        fileName: String(sourceFile.fileName || projectionContext.item?.fileName || 'uploaded.schematic'),
        mimeType: String(sourceFile.mimeType || 'application/octet-stream'),
        size: Math.max(0, Math.round(Number(sourceFile.size || buffer.byteLength || 0))),
      }
    }

    return fetchGalleryItemSource(
      projectionContext.spaceName,
      projectionContext.projectionId,
      loadAdminAuthSession(),
      sourceFile,
    )
  }

  async _prepareProjectionRuntimeRenderSource(projectionContext = this.activeProjectionContext) {
    try {
      const sourcePayload = await this._takeProjectionSourcePayload(projectionContext)
      const sourceName = sourcePayload?.fileName || projectionContext?.item?.fileName || 'projection.schematic'
      const preview = getProjectionPreviewMetadata(projectionContext?.item)
      const runtimeSource = attachRuntimePreviewStats(
        createRuntimeRenderSource(sourcePayload?.buffer, {
          id: projectionContext?.projectionId,
          name: sourceName,
          offset: this._getProjectionPlacementOffset(projectionContext),
          blockCount: preview?.blockCount,
        }),
        preview,
      )

      if (runtimeSource) {
        this._minecraftSchematicRuntimeSource = runtimeSource
      }

      return runtimeSource
    }
    catch (error) {
      console.warn('[World] Failed to prepare projection runtime schematic renderer source:', error)
      return null
    }
  }

  async _ensureProjectionWorldInitialized(sharedWorldState = null, backendConfig = null) {
    const projectionContext = this.activeProjectionContext
    debugWorld('[World Debug] _ensureProjectionWorldInitialized called:', {
      hasProjectionContext: !!projectionContext,
      projectionId: projectionContext?.projectionId,
      hasSharedWorldState: !!sharedWorldState,
      hasSnapshotContent: hasSnapshotContent(sharedWorldState),
      hasSchematicBlockContent: hasSchematicBlockContent(sharedWorldState),
      sharedWorldState: sharedWorldState
        ? {
            modificationsKeys: Object.keys(sharedWorldState.modifications || {}),
            worldStateKeys: sharedWorldState.worldState ? Object.keys(sharedWorldState.worldState) : 'none',
            schematicLayerChunks: sharedWorldState?.worldState?.minecraftSchematicLayer?.chunks ? Object.keys(sharedWorldState.worldState.minecraftSchematicLayer.chunks) : 'none',
          }
        : null,
    })
    if (!projectionContext?.projectionId) {
      debugWorld('[World Debug] Early return: no projectionId')
      return backendConfig
    }

    const hasValidSchematicContent = hasSchematicBlockContent(sharedWorldState)

    if (hasValidSchematicContent) {
      debugWorld('[World Debug] Early return: has valid schematic block content')
      await this._prepareProjectionRuntimeRenderSource(projectionContext)
      return backendConfig
    }

    if (!hasProjectionContentSource(projectionContext, sharedWorldState)) {
      emitter.emit('projection:bootstrap-error', {
        spaceName: projectionContext.spaceName,
        projectionId: projectionContext.projectionId,
        error: 'projection_source_file_missing',
      })
      return backendConfig
    }

    debugWorld('[World Debug] Proceeding to load schematic (no existing schematic content)')

    debugWorld('[World Debug] Parsed projection context item:', projectionContext.item)
    try {
      const sourcePayload = await this._takeProjectionSourcePayload(projectionContext)
      const buffer = sourcePayload?.buffer || null

      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 0) {
        emitter.emit('projection:bootstrap-error', {
          spaceName: projectionContext.spaceName,
          projectionId: projectionContext.projectionId,
          error: 'projection_source_file_missing',
        })
        return backendConfig
      }

      debugWorld('[World Debug] Decoded buffer length:', buffer.byteLength)
      const preview = getProjectionPreviewMetadata(projectionContext.item)
      const placementOffset = this._getProjectionPlacementOffset(projectionContext)
      const runtimeSource = attachRuntimePreviewStats(
        createRuntimeRenderSource(buffer, {
          id: projectionContext.projectionId,
          name: sourcePayload?.fileName || projectionContext.item?.fileName || 'projection.schematic',
          offset: placementOffset,
          blockCount: preview?.blockCount,
        }),
        preview,
      )
      this._minecraftSchematicRuntimeSource = runtimeSource
      debugWorld('[World Debug] Projection runtime source prepared, bounds:', preview?.bounds)
      let nextConfig = backendConfig

      const derivedSpawnPoint = buildProjectionSpawnPointFromPreview(preview, placementOffset)
      const shouldReplaceSpawnPoint = !!derivedSpawnPoint && (
        !this.backendConfigRecord?.exists
        || !hasSpawnPoint(nextConfig)
        || !isSpawnPointNearProjectionBounds(nextConfig?.player?.spawnPoint, preview, placementOffset)
      )
      if (shouldReplaceSpawnPoint) {
        const spawnPoint = derivedSpawnPoint
        if (spawnPoint) {
          nextConfig = normalizeBackendWorldConfig({
            ...nextConfig,
            player: {
              ...nextConfig?.player,
              spawnPoint,
            },
          })
          try {
            await saveBackendWorldConfigRemote(nextConfig, '', {
              spaceName: projectionContext.spaceName,
              projectionId: projectionContext.projectionId,
            })
          }
          catch (error) {
            console.warn('[World] Failed to save derived spawn point remotely, falling back to local admin cache:', error)
            saveAdminWorldConfig(nextConfig, '', {
              spaceName: projectionContext.spaceName,
              projectionId: projectionContext.projectionId,
            })
          }
        }
      }

      await this._applySchematicPayload({
        offset: placementOffset,
        spawnPoint: nextConfig?.player?.spawnPoint || null,
        movePlayerToSpawn: false,
        awaitRenderOverlay: false,
        runtimeSource: this._minecraftSchematicRuntimeSource,
        runtimeOnly: true,
        options: {
          replaceWorld: true,
          persistModifications: true,
        },
      })
      this._projectionBootstrapApplied = true

      return nextConfig
    }
    catch (error) {
      debugWorld('[World] Failed to initialize projection world:', error)
      emitter.emit('projection:bootstrap-error', {
        spaceName: projectionContext.spaceName,
        projectionId: projectionContext.projectionId,
        error: error?.message || 'projection_bootstrap_failed',
      })
      return backendConfig
    }
  }

  async _applySchematicPayload(payload = {}) {
    const offset = payload.offset || { x: 0, y: 0, z: 0 }
    const spawnPoint = payload.spawnPoint
      && Number.isFinite(Number(payload.spawnPoint.x))
      && Number.isFinite(Number(payload.spawnPoint.y))
      && Number.isFinite(Number(payload.spawnPoint.z))
      ? {
          x: Number(payload.spawnPoint.x),
          y: Number(payload.spawnPoint.y),
          z: Number(payload.spawnPoint.z),
        }
      : null

    const options = {
      ...(payload.options || {}),
      onProgress: (progress) => {
        emitter.emit('schematic:apply-progress', progress)
      },
    }
    const runtimeSource = payload.runtimeSource
      || schematicService.getRuntimeRenderSource(offset)
      || this._minecraftSchematicRuntimeSource
    if (runtimeSource?.buffer instanceof ArrayBuffer) {
      this._minecraftSchematicRuntimeSource = {
        ...runtimeSource,
        offset: normalizeRuntimeOffset(runtimeSource.offset || offset),
      }
    }

    const awaitRenderOverlay = payload.awaitRenderOverlay !== false
    const runtimeOnly = payload.runtimeOnly === true
      && this._minecraftSchematicRuntimeSource?.buffer instanceof ArrayBuffer

    let result
    if (runtimeOnly) {
      const replaceWorld = options.replaceWorld !== false

      if (replaceWorld) {
        this.chunkManager?.setMinecraftRenderOverlayActive?.(false)
        this.chunkManager?.minecraftSchematicLayer?.clear?.()
        this.chunkManager?.syncMinecraftSchematicLayerState?.({
          scheduleSave: false,
        })
      }

      const totalBlocks = getRuntimeRenderBlockCount(this._minecraftSchematicRuntimeSource)
      options.onProgress?.({
        phase: 'runtime-projection-ready',
        processedBlocks: totalBlocks,
        totalBlocks,
        progress: 1,
        runtime: true,
      })

      result = {
        status: 'applied',
        runtimeOnly: true,
        totalBlocks,
        offset: normalizeRuntimeOffset(offset),
        placedBounds: null,
        importDiagnostics: {
          renderMode: 'schematic-renderer-wasm',
          importedChunkCount: 0,
        },
        placed: 0,
        replaced: 0,
        persisted: 0,
        skipped: 0,
        touchedChunks: 0,
        worldClearedChunks: 0,
        skippedOutOfHeight: 0,
      }
    }
    else {
      result = await schematicService.applyToWorld(this.chunkManager, offset, options)
    }

    if (awaitRenderOverlay) {
      try {
        const renderOverlay = await this._syncMinecraftSchematicRenderLayer({
          runtimeSource: this._minecraftSchematicRuntimeSource,
          onProgress: (renderProgress) => {
            emitter.emit('schematic:apply-progress', {
              phase: 'building-minecraft-render-layer',
              ...renderProgress,
              processedStates: renderProgress.processedStates,
              totalStates: renderProgress.totalStates,
              builtMeshes: renderProgress.builtMeshes,
              progress: Number.isFinite(Number(renderProgress.progress))
                ? Number(renderProgress.progress)
                : 0,
            })
          },
        })
        result.renderOverlay = renderOverlay
      }
      catch (renderError) {
        console.warn('[World] Failed to rebuild Minecraft schematic render layer:', renderError)
        result.renderOverlayError = renderError?.message || 'minecraft_render_overlay_failed'
      }
    }
    else {
      this._needsMinecraftSchematicRenderLayerRestore = true
      result.renderOverlayPending = true
    }

    if (spawnPoint) {
      this._applyBackendSpawn({ spawnPoint }, { movePlayer: !!payload.movePlayerToSpawn })
      result.spawnPoint = spawnPoint
    }

    const persistenceSaved = await this._saveSharedWorldState()
    result.persistenceSaved = persistenceSaved
    return result
  }

  async _applyBackendRuntimeConfig(runtimeConfig = null, options = {}) {
    const { movePlayer = false } = options
    const config = runtimeConfig || await loadBackendWorldConfig()
    this._applyBackendUi(config.ui)
    await this._applyBackendSettings(config.settings)
    this._applyPortalLinks(config.settings?.portalLinks)
    this._applyBackendSpawn(config.player, { movePlayer })
  }

  _applyBackendUi(uiConfig) {
    const ui = useUiStore()
    ui.applyBackendUiConfig(uiConfig)
  }

  async _applyBackendSettings(settingsConfig = {}) {
    const settings = useSettingsStore()

    if (settingsConfig.cameraPreset) {
      settings.applyCameraPreset(settingsConfig.cameraPreset)
    }
    if (settingsConfig.visualPreset) {
      settings.applyVisualPreset(settingsConfig.visualPreset)
    }

    const chunk = settingsConfig.chunk || {}
    if (chunk.height !== undefined && this.chunkManager && chunk.height !== this.chunkManager.chunkHeight) {
      await this._rebuildTerrainWithChunkHeight(chunk.height)
    }
    if (chunk.viewDistance !== undefined)
      settings.setChunkViewDistance(chunk.viewDistance)
    if (chunk.unloadPadding !== undefined)
      settings.setChunkUnloadPadding(chunk.unloadPadding)

    const environment = settingsConfig.environment || {}
    if (environment.skyMode !== undefined)
      settings.setEnvSkyMode(environment.skyMode)
    if (environment.sunIntensity !== undefined)
      settings.setEnvSunIntensity(environment.sunIntensity)
    if (environment.ambientIntensity !== undefined)
      settings.setEnvAmbientIntensity(environment.ambientIntensity)
    if (environment.fogDensity !== undefined)
      settings.setEnvFogDensity(environment.fogDensity)
    if (environment.timeOfDay !== undefined)
      settings.setEnvTimeOfDay(environment.timeOfDay)
    if (environment.timeAutoPlay !== undefined)
      settings.setEnvTimeAutoPlay(environment.timeAutoPlay)
  }

  async _rebuildTerrainWithChunkHeight(nextChunkHeight) {
    if (!this.chunkManager) {
      return
    }

    const nextHeight = Number(nextChunkHeight)
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
      return
    }

    const previousManager = this.chunkManager
    if (previousManager.chunkHeight === nextHeight) {
      return
    }

    const snapshot = previousManager.persistence?.exportSnapshot?.() || null

    const nextManager = new ChunkManager({
      chunkWidth: previousManager.chunkWidth,
      chunkHeight: nextHeight,
      viewDistance: previousManager.viewDistance,
      unloadPadding: previousManager.unloadPadding,
      worldName: previousManager.persistence?.worldName,
      useIndexedDB: previousManager.persistence?.useIndexedDB,
    })
    await nextManager.waitForPersistenceReady?.()

    if (snapshot && nextManager.persistence?.applySnapshot) {
      await nextManager.persistence.applySnapshot(snapshot, { persist: true })
      nextManager.restoreRuntimeStateFromPersistence?.()
    }

    previousManager.destroy()

    this.chunkManager = nextManager
    this.experience.terrainDataManager = nextManager
    if (this.minecraftSchematicRenderLayer) {
      this.minecraftSchematicRenderLayer.chunkManager = nextManager
      void this._syncMinecraftSchematicRenderLayer()
    }

    if (this.blockRaycaster) {
      this.blockRaycaster.chunkManager = nextManager
    }
    if (this.blockInteractionManager) {
      this.blockInteractionManager.chunkManager = nextManager
    }

    debugWorld(`[World] Chunk height updated: ${previousManager.chunkHeight} -> ${nextHeight}`)
  }

  _applyBackendSpawn(playerConfig = {}, options = {}) {
    const { movePlayer = false } = options

    if (!this.player)
      return

    const spawnPoint = playerConfig.spawnPoint
    if (!spawnPoint)
      return

    this.player.setRespawnPoint(spawnPoint.x, spawnPoint.y, spawnPoint.z, movePlayer)

    if (movePlayer && playerConfig.view) {
      const yaw = Number(playerConfig.view.yaw)
      const pitch = Number(playerConfig.view.pitch)

      if (Number.isFinite(yaw)) {
        this.player.setFacing((yaw * Math.PI) / 180)
      }

      if (Number.isFinite(pitch) && this.experience.camera) {
        const pitchRadians = (pitch * Math.PI) / 180
        this.experience.camera.gameplayPitch = pitchRadians
        this.experience.camera.gameplayPitchTarget = pitchRadians
      }
    }

    if (playerConfig.flight) {
      this.player.setFlightOptions(playerConfig.flight)
    }
  }

  /**
   * A shared link carries ?at=x,y,z: drop the player there instead of the spawn.
   * Runs after the backend spawn so it wins, and only once per page load.
   */
  _applySharedPosition() {
    if (this._sharedPositionApplied) {
      return
    }
    this._sharedPositionApplied = true

    const shared = readSharedPosition()
    if (!shared || !this.player) {
      return
    }

    this.player.setRespawnPoint(shared.x, shared.y, shared.z, true)
    emitter.emit('hud:toast', { text: '已传送到分享的位置' })
  }

  _applyPortalLinks(portalLinkConfig = {}) {
    this.portalLinkController?.setConfig(portalLinkConfig)
  }

  async _ensureMinecraftSchematicRenderLayer() {
    if (!this.minecraftSchematicRenderLayer) {
      this.minecraftSchematicRenderLayer = new MinecraftSchematicRenderLayer({
        chunkManager: this.chunkManager,
      })
    }

    this.minecraftSchematicRenderLayer.chunkManager = this.chunkManager
    return this.minecraftSchematicRenderLayer
  }

  async _syncMinecraftSchematicRenderLayer(options = {}) {
    const schematicLayer = this.chunkManager?.getImportedMinecraftBlockLayer?.()
    const stats = schematicLayer?.getStats?.() || { blockCount: 0 }
    const runtimeSource = options.runtimeSource || this._minecraftSchematicRuntimeSource || null
    const runtimeBlockCount = getRuntimeRenderBlockCount(runtimeSource)
    debugWorld('[World Debug] _syncMinecraftSchematicRenderLayer:', { blockCount: stats.blockCount, hasSchematicLayer: !!schematicLayer })

    if (!stats.blockCount && !runtimeBlockCount && !(runtimeSource?.buffer instanceof ArrayBuffer)) {
      this.chunkManager?.setMinecraftRenderOverlayActive?.(false)
      this.minecraftSchematicRenderLayer?.clear?.()
      this._needsMinecraftSchematicRenderLayerRestore = false
      return {
        uniqueBlockStates: 0,
        builtMeshes: 0,
        resourcePackStatus: {
          attempted: false,
          loaded: false,
          source: 'none',
        },
      }
    }

    const renderLayer = await this._ensureMinecraftSchematicRenderLayer()
    if (runtimeSource?.buffer instanceof ArrayBuffer) {
      renderLayer.setRuntimeSource(runtimeSource)
    }
    else if ('runtimeSource' in options) {
      renderLayer.setRuntimeSource(null)
    }

    const layerForRender = stats.blockCount
      ? schematicLayer
      : {
          getStats: () => ({
            blockCount: runtimeBlockCount,
          }),
        }

    const result = await renderLayer.rebuildFromLayer(layerForRender, {
      ...options,
      runtimeSource,
    })
    this.chunkManager?.setMinecraftRenderOverlayActive?.(true)
    this._needsMinecraftSchematicRenderLayerRestore = false

    if (runtimeSource?.buffer instanceof ArrayBuffer) {
      const importedBlockUpdates = this.chunkManager?.getImportedMinecraftBlockRefreshUpdates?.({
        includeLayerBlocks: true,
        includeTransientRemoved: true,
      }) || []
      if (importedBlockUpdates.length) {
        this.chunkManager?.refreshImportedMinecraftBlocks?.(importedBlockUpdates)
      }
    }

    return result
  }

  async _restoreMinecraftSchematicRenderLayer(options = {}) {
    const startedAt = performance.now()
    try {
      const result = await this._syncMinecraftSchematicRenderLayer(options)
      debugWorld('[World] Restored Minecraft schematic render layer', {
        progressive: options.progressive !== false,
        builtMeshes: result?.builtMeshes ?? 0,
        uniqueBlockStates: result?.uniqueBlockStates ?? 0,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      })
    }
    catch (error) {
      console.warn('[World] Failed to restore Minecraft schematic render layer:', error)
    }
  }

  _cancelMinecraftSchematicRenderLayerSync() {
    if (this._minecraftRenderLayerSyncTimer) {
      clearTimeout(this._minecraftRenderLayerSyncTimer)
      this._minecraftRenderLayerSyncTimer = null
    }
  }

  _cancelInitialMinecraftSchematicRenderLayerRestore() {
    if (this._minecraftRenderLayerRestoreTimer) {
      clearTimeout(this._minecraftRenderLayerRestoreTimer)
      this._minecraftRenderLayerRestoreTimer = null
    }
  }

  _scheduleInitialMinecraftSchematicRenderLayerRestore(delayMs = 48) {
    this._cancelInitialMinecraftSchematicRenderLayerRestore()
    debugWorld('[World] Scheduling initial Minecraft schematic render layer restore', {
      delayMs,
      projectionId: this.activeProjectionContext?.projectionId || '',
    })
    this._minecraftRenderLayerRestoreTimer = setTimeout(() => {
      this._minecraftRenderLayerRestoreTimer = null
      void this._restoreMinecraftSchematicRenderLayer({
        progressive: true,
      })
    }, delayMs)
  }

  _scheduleMinecraftSchematicRenderLayerSync(delayMs = 60) {
    this._cancelMinecraftSchematicRenderLayerSync()

    this._minecraftRenderLayerSyncTimer = setTimeout(() => {
      this._minecraftRenderLayerSyncTimer = null
      void this._syncMinecraftSchematicRenderLayer()
    }, delayMs)
  }

  async _syncMinecraftSchematicRenderLayerBlockStates(blockStates = [], options = {}) {
    const normalizedBlockStates = [...new Set(
      (Array.isArray(blockStates) ? blockStates : [])
        .map(blockState => String(blockState || '').trim())
        .filter(Boolean),
    )]
    if (!normalizedBlockStates.length) {
      return null
    }

    const schematicLayer = this.chunkManager?.getImportedMinecraftBlockLayer?.()
    const stats = schematicLayer?.getStats?.() || { blockCount: 0 }
    if (!stats.blockCount) {
      this.chunkManager?.setMinecraftRenderOverlayActive?.(false)
      this.minecraftSchematicRenderLayer?.clear?.()
      return null
    }

    const renderLayer = await this._ensureMinecraftSchematicRenderLayer()
    const runtimeActive = renderLayer?.isRuntimeRendererActive?.()

    if (
      this._needsMinecraftSchematicRenderLayerRestore
      || !this.minecraftSchematicRenderLayer?.getStats?.()?.meshCount
      || (!runtimeActive && !this.chunkManager?.minecraftRenderOverlayActive)
    ) {
      return this._syncMinecraftSchematicRenderLayer({
        progressive: true,
        ...options,
      })
    }

    const result = await renderLayer.syncBlockStatesFromLayer(schematicLayer, normalizedBlockStates, options)
    if (!runtimeActive) {
      this.chunkManager?.setMinecraftRenderOverlayActive?.(true)
    }
    return result
  }

  _onMinecraftBlockBreakComplete(payload = {}) {
    const affectedBlockStates = Array.isArray(payload?.affectedBlockStates) ? payload.affectedBlockStates : []
    const runtimeActive = this.minecraftSchematicRenderLayer?.isRuntimeRendererActive?.()

    if (payload?.source === 'minecraft-schematic' && runtimeActive) {
      return
    }

    if (payload?.source === 'minecraft-schematic' && affectedBlockStates.length) {
      this._cancelMinecraftSchematicRenderLayerSync()
      void this._syncMinecraftSchematicRenderLayerBlockStates(affectedBlockStates)
      return
    }

    if (this.chunkManager?.minecraftRenderOverlayActive) {
      this._scheduleMinecraftSchematicRenderLayerSync()
    }
  }

  _onMinecraftBlockPlace(payload = {}) {
    // 放置与开关交互走同一条会话层补丁路径，渲染层同步规则一致
    this._onMinecraftBlockUse(payload)
  }

  _onMinecraftBlockUse(payload = {}) {
    const affectedBlockStates = Array.isArray(payload?.affectedBlockStates) ? payload.affectedBlockStates : []
    const runtimeActive = this.minecraftSchematicRenderLayer?.isRuntimeRendererActive?.()

    if (payload?.source === 'minecraft-schematic' && runtimeActive) {
      return
    }

    if (payload?.source === 'minecraft-schematic' && affectedBlockStates.length) {
      this._cancelMinecraftSchematicRenderLayerSync()
      void this._syncMinecraftSchematicRenderLayerBlockStates(affectedBlockStates)
      return
    }

    if (payload?.source === 'minecraft-schematic' || this.chunkManager?.minecraftRenderOverlayActive) {
      this._scheduleMinecraftSchematicRenderLayerSync()
    }
  }

  async _loadSharedWorldState() {
    const activeSpace = getActiveSpaceName()
    const activeProjectionId = getActiveProjectionId()
    const storageKey = buildSpaceScopedKey(WORLD_STATE_STORAGE_KEY, activeSpace, activeProjectionId)
    const localRecord = await loadLocalWorldStateRecord(storageKey)
    const localDecoded = localRecord?.payload
      ? sanitizeSnapshot(decodeWorldStateSnapshot(localRecord.payload))
      : null

    if (localDecoded && hasSnapshotContent(localDecoded)) {
      debugWorld('[World Debug] Loaded local world-state FULL:', localDecoded)
      debugWorld('[World Debug] Loaded local world-state SUMMARY', {
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
              debugWorld('[World Debug] Loaded remote world-state (space-first)', {
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
      debugWorld('[World Debug] Loaded local fallback world-state', {
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
      debugWorld('[World Debug] Loaded remote world-state (fallback path)', {
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

  async _saveSharedWorldState() {
    if (!this.chunkManager?.persistence?.exportSnapshot) {
      return false
    }

    try {
      const payload = this.chunkManager.persistence.exportSnapshot()
      const compactPayload = encodeWorldStateSnapshot(payload, {
        chunkWidth: this.chunkManager.chunkWidth,
      })
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

      debugWorld('[World Debug] Saved world-state', {
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

  /** 地形：ChunkManager（Minecraft 方块数据层）+ 暴露 terrainDataManager */
  async _initTerrain(config = null, sharedWorldState = null) {
    const activeSpace = getActiveSpaceName()
    const activeProjectionId = getActiveProjectionId()
    const scopedWorldName = buildSpaceScopedKey('terrain-persistence', activeSpace, activeProjectionId)
    const backendChunk = config?.settings?.chunk || {}
    const chunkHeight = backendChunk.height ?? CHUNK_BASIC_CONFIG.chunkHeight
    const viewDistance = backendChunk.viewDistance ?? CHUNK_BASIC_CONFIG.viewDistance
    const unloadPadding = useSettingsStore().chunkUnloadPadding ?? CHUNK_BASIC_CONFIG.unloadPadding

    this.chunkManager = new ChunkManager({
      chunkWidth: CHUNK_BASIC_CONFIG.chunkWidth,
      chunkHeight,
      viewDistance,
      unloadPadding,
      worldName: scopedWorldName || 'default',
    })
    await this.chunkManager.waitForPersistenceReady?.()

    if (sharedWorldState && this.chunkManager?.persistence?.applySnapshot) {
      await this.chunkManager.persistence.applySnapshot(sharedWorldState, { persist: true })
      this.chunkManager.restoreRuntimeStateFromPersistence?.()
    }

    this.experience.terrainDataManager = this.chunkManager

    const runtimeSnapshot = this.chunkManager.persistence?.exportSnapshot?.() || null
    if (!hasSnapshotContent(sharedWorldState) && hasSnapshotContent(runtimeSnapshot)) {
      void this._saveSharedWorldState()
    }
  }

  /** 玩家 + 相机 Rig，依赖地形（贴地/碰撞用 terrainDataManager） */
  _initPlayerAndCamera() {
    this.player = new Player(this.experience)
    this.portalLinkController = new PortalLinkController({
      player: this.player,
      getTerrainProvider: () => this.experience.terrainDataManager,
      onPortalTrigger: ({ type, url }) => {
        const navigated = navigateToUrl(url)
        if (!navigated) {
          debugWorld('[World] Ignored invalid portal link target', {
            type,
            url,
          })
        }
      },
    })
    this.cameraRig = new CameraRig()
    this.cameraRig.attachPlayer(this.player)
    this.experience.camera.attachRig(this.cameraRig)

    const camera = this.experience.camera
    const isFirstPerson = camera?.currentMode === camera?.cameraModes?.FIRST_PERSON
    this.player.setFirstPersonHidden(!!isFirstPerson)
  }

  /** 环境（天空、光照等） */
  _initEnvironment() {
    this.environment = new Environment()
  }

  /** 方块交互链：射线、选中框、挖矿控制器/覆盖层、交互管理器 */
  _initBlockInteraction() {
    this.blockRaycaster = new BlockRaycaster({
      chunkManager: this.chunkManager,
      maxDistance: INTERACTION_CONFIG.raycast.maxDistance,
      useMouse: false,
    })
    this.blockSelectionHelper = new BlockSelectionHelper({ enabled: true })
    this.blockMiningController = new BlockMiningController({
      enabled: true,
      miningDuration: INTERACTION_CONFIG.mining.duration,
    })
    this.blockMiningOverlay = new BlockMiningOverlay()
    this.blockInteractionManager = new BlockInteractionManager({
      chunkManager: this.chunkManager,
      blockRaycaster: this.blockRaycaster,
      blockMiningController: this.blockMiningController,
    })
  }

  /** 视觉效果：破碎粒子、拾取动画 */
  _initEffects() {
    this.blockBreakParticles = new BlockBreakParticles()
    this.itemPickupAnimator = new ItemPickupAnimator()
  }

  /** 设置变更监听（视距等） */
  _setupSettingsListeners() {
    emitter.on('settings:chunks-changed', (data) => {
      if (!this.chunkManager)
        return
      if (data.viewDistance !== undefined)
        this.chunkManager.viewDistance = data.viewDistance
      if (data.unloadPadding !== undefined) {
        this.chunkManager.unloadPadding = data.unloadPadding
        this.minecraftSchematicRenderLayer?.setUnloadPadding?.(data.unloadPadding)
      }
    })
  }

  /**
   * 每帧更新，顺序与依赖一致：原理图渲染层 → 挖矿 → 玩家/环境 → 射线/选中框 → 粒子
   */
  update() {
    if (this.minecraftSchematicRenderLayer)
      this.minecraftSchematicRenderLayer.update()
    if (this.redstoneReplayController)
      this.redstoneReplayController.update()
    if (this.blockMiningController)
      this.blockMiningController.update()
    if (this.player)
      this.player.update()
    if (this.portalLinkController)
      this.portalLinkController.update()
    if (this.environment)
      this.environment.update()
    if (this.blockRaycaster)
      this.blockRaycaster.update()
    if (this.blockSelectionHelper)
      this.blockSelectionHelper.update()
    if (this.blockBreakParticles)
      this.blockBreakParticles.update()
  }

  destroy() {
    this._cancelMinecraftSchematicRenderLayerSync()
    this._cancelInitialMinecraftSchematicRenderLayerRestore()
    this.isSceneReady = false
    emitter.off('game:block-break-complete', this._onMinecraftBlockBreakComplete)
    emitter.off('game:block-place', this._onMinecraftBlockPlace)
    emitter.off('game:block-use', this._onMinecraftBlockUse)

    // Destroy child components
    this.blockMiningOverlay?.dispose()
    this.blockInteractionManager?.destroy()
    this.blockMiningController?.destroy()
    this.blockBreakParticles?.destroy()
    this.itemPickupAnimator?.destroy()
    this.blockSelectionHelper?.dispose()
    this.blockRaycaster?.destroy()
    this.environment?.destroy()
    this.cameraRig?.destroy()
    this.player?.destroy()
    this.portalLinkController = null
    this.redstoneReplayController?.destroy()
    this.redstoneReplayController = null
    this.minecraftSchematicRenderLayer?.dispose()
    this.chunkManager?.destroy()

    // Clear terrainDataManager reference
    if (this.experience.terrainDataManager === this.chunkManager) {
      this.experience.terrainDataManager = null
    }
  }
}
