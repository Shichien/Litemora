import { loadAdminAuthSession } from '../auth/admin-auth.js'
import { useSettingsStore } from '../../pinia/settingsStore.js'
import { useUiStore } from '../../pinia/uiStore.js'
import CameraRig from '../camera/camera-rig.js'
import {
  CHUNK_BASIC_CONFIG,
} from '../config/chunk-config.js'
import { INTERACTION_CONFIG } from '../config/interaction-config.js'
import Experience from '../experience.js'
import { fetchGalleryItem } from '../gallery/gallery-api.js'
import BlockBreakParticles from '../interaction/block-break-particles.js'
import BlockInteractionManager from '../interaction/block-interaction-manager.js'
import BlockMiningController from '../interaction/block-mining-controller.js'
import BlockMiningOverlay from '../interaction/block-mining-overlay.js'
import BlockRaycaster from '../interaction/block-raycaster.js'
import BlockSelectionHelper from '../interaction/block-selection-helper.js'
import ItemPickupAnimator from '../interaction/item-pickup-animator.js'
import emitter from '../utils/event/event-bus.js'
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
import ChunkManager from './terrain/chunk-manager.js'
import MinecraftSchematicRenderLayer from './terrain/minecraft-schematic-render-layer.js'
import schematicService from './terrain/schematic-service.js'
import { decodeWorldStateSnapshot, encodeWorldStateSnapshot } from './terrain/world-state-codec.js'

const WORLD_STATE_STORAGE_KEY = 'mc-world-state'
const WORLD_STATE_DB_NAME = 'mc-world-state-storage'
const WORLD_STATE_DB_STORE = 'snapshots'
const WORLD_STATE_DB_VERSION = 1
const DEFAULT_PROJECTION_SPAWN_LIFT = 2

function decodeBase64ToArrayBuffer(base64Text = '') {
  const binary = atob(String(base64Text || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function hasSpawnPoint(config = null) {
  const spawnPoint = config?.player?.spawnPoint
  return Number.isFinite(Number(spawnPoint?.x))
    && Number.isFinite(Number(spawnPoint?.y))
    && Number.isFinite(Number(spawnPoint?.z))
}

function buildProjectionSpawnPoint(
  preview = null,
  placementOffset = null,
  lift = DEFAULT_PROJECTION_SPAWN_LIFT,
) {
  const bounds = preview?.bounds
  if (!bounds || bounds.minX === null || bounds.maxX === null) {
    return null
  }

  const offsetX = Number(placementOffset?.x || 0)
  const offsetY = Number(placementOffset?.y || 0)
  const offsetZ = Number(placementOffset?.z || 0)

  return {
    x: Number((((bounds.minX + bounds.maxX) * 0.5) + offsetX).toFixed(2)),
    y: Number((bounds.maxY + offsetY + 0.5 + lift).toFixed(2)),
    z: Number((((bounds.minZ + bounds.maxZ) * 0.5) + offsetZ).toFixed(2)),
  }
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
  try {
    await saveWorldStateToIndexedDb(storageKey, payload)
  }
  catch {
    // ignore IndexedDB failures and continue with localStorage fallback
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
  const modifications = snapshot?.modifications
  if (modifications && typeof modifications === 'object') {
    for (const value of Object.values(modifications)) {
      if (value && typeof value === 'object' && Object.keys(value).length > 0) {
        return true
      }
    }
  }

  // Check if schematic actually has block data, not just empty chunk structures
  if (hasSchematicBlockContent(snapshot)) {
    return true
  }

  return false
}

/**
 * Check if the schematic snapshot actually has block data
 * @param {object} snapshot
 * @returns {boolean}
 */
function hasSchematicBlockContent(snapshot = null) {
  const minecraftChunks = snapshot?.worldState?.minecraftSchematicLayer?.chunks
  if (!minecraftChunks || typeof minecraftChunks !== 'object') {
    return false
  }

  // Check if any chunk has actual block data
  for (const chunk of Object.values(minecraftChunks)) {
    if (chunk && typeof chunk === 'object') {
      // Check for blocks or any meaningful data
      if (chunk.blocks && typeof chunk.blocks === 'object' && Object.keys(chunk.blocks).length > 0) {
        return true
      }
      // Also check for other possible data structures
      if (Object.keys(chunk).length > 0) {
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
    : { schematicOnlyMode: false }

  if (worldState.schematicOnlyMode && !hasSnapshotContent(snapshot)) {
    worldState.schematicOnlyMode = false
  }

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
    schematicOnlyMode: !!safe?.worldState?.schematicOnlyMode,
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
    this.activeProjectionContext = null
    this._projectionBootstrapApplied = false
    this._minecraftRenderLayerSyncTimer = null
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

    emitter.on('core:ready', async () => {
      this.activeProjectionContext = await this._loadActiveProjectionContext()
      this.backendConfigRecord = await loadBackendWorldConfigRecord()
      this.backendConfig = this.backendConfigRecord.config
      const sharedWorldState = await this._loadSharedWorldState()

      this._initTerrain(this.backendConfig, sharedWorldState)
      this.backendConfig = await this._ensureProjectionWorldInitialized(sharedWorldState, this.backendConfig)
      if (!this._projectionBootstrapApplied) {
        await this._restoreMinecraftSchematicRenderLayer()
      }

      this._initPlayerAndCamera()
      this._initEnvironment()
      this._initBlockInteraction()
      this._initEffects()
      this._setupSettingsListeners()
      await this._applyBackendRuntimeConfig(this.backendConfig, { movePlayer: true })
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

  async _loadActiveProjectionContext() {
    const spaceName = getActiveSpaceName()
    const projectionId = getActiveProjectionId()
    console.log('[World Debug] _loadActiveProjectionContext:', { spaceName, projectionId, pathname: window.location.pathname, search: window.location.search })
    if (!spaceName || !projectionId) {
      console.log('[World Debug] _loadActiveProjectionContext returning null: no spaceName or projectionId')
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
      console.warn('[World] Failed to load projection metadata:', error)
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

  async _ensureProjectionWorldInitialized(sharedWorldState = null, backendConfig = null) {
    const projectionContext = this.activeProjectionContext
    console.log('[World Debug] _ensureProjectionWorldInitialized called:', {
      hasProjectionContext: !!projectionContext,
      projectionId: projectionContext?.projectionId,
      hasSharedWorldState: !!sharedWorldState,
      hasSnapshotContent: hasSnapshotContent(sharedWorldState),
      hasSchematicBlockContent: hasSchematicBlockContent(sharedWorldState),
      sharedWorldState: sharedWorldState ? {
        modificationsKeys: Object.keys(sharedWorldState.modifications || {}),
        worldStateKeys: sharedWorldState.worldState ? Object.keys(sharedWorldState.worldState) : 'none',
        schematicLayerChunks: sharedWorldState?.worldState?.minecraftSchematicLayer?.chunks ? Object.keys(sharedWorldState.worldState.minecraftSchematicLayer.chunks) : 'none',
      } : null,
    })
    if (!projectionContext?.projectionId) {
      console.log('[World Debug] Early return: no projectionId')
      return backendConfig
    }

    // For projection worlds, always try to load the schematic from the projection metadata
    // unless we already have valid schematic content (actual blocks, not just empty chunk structures)
    const hasValidSchematicContent = hasSchematicBlockContent(sharedWorldState)
    const hasModifications = sharedWorldState?.modifications && typeof sharedWorldState.modifications === 'object' &&
      Object.keys(sharedWorldState.modifications).length > 0

    if (hasValidSchematicContent) {
      console.log('[World Debug] Early return: has valid schematic block content')
      return backendConfig
    }

    // If there are modifications but no schematic blocks, still need to load schematic
    // (schematic blocks may have been cleared but terrain modifications remain)

    // Even if there's existing world state, we need to apply the projection schematic
    // if it doesn't have schematic content yet
    console.log('[World Debug] Proceeding to load schematic (no existing schematic content)')

    const sourceFile = projectionContext.item?.sourceFile
    console.log('[World Debug] Parsed projection context item:', projectionContext.item)
    if (!sourceFile?.fileBase64) {
      emitter.emit('projection:bootstrap-error', {
        spaceName: projectionContext.spaceName,
        projectionId: projectionContext.projectionId,
        error: 'projection_source_file_missing',
      })
      return backendConfig
    }

    try {
      const buffer = decodeBase64ToArrayBuffer(sourceFile.fileBase64)
      console.log('[World Debug] Decoded buffer length:', buffer.byteLength)
      await schematicService.parseArrayBuffer(buffer)
      const preview = schematicService.getPreview()
      const placementOffset = {
        x: Number(projectionContext.item?.placement?.offset?.x || 0),
        y: Number(projectionContext.item?.placement?.offset?.y || 0),
        z: Number(projectionContext.item?.placement?.offset?.z || 0),
      }
      console.log('[World Debug] Parsing schematic complete, bounds:', preview?.bounds)
      let nextConfig = backendConfig

      if (!this.backendConfigRecord?.exists || !hasSpawnPoint(nextConfig)) {
        const spawnPoint = buildProjectionSpawnPoint(preview, placementOffset)
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
          catch {
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
        options: {
          replaceWorld: true,
          persistModifications: true,
          keepSchematicOnlyMode: true,
        },
      })
      this._projectionBootstrapApplied = true

      return nextConfig
    }
    catch (error) {
      console.warn('[World] Failed to initialize projection world:', error)
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
    const result = await schematicService.applyToWorld(this.chunkManager, offset, options)
    try {
      const renderOverlay = await this._syncMinecraftSchematicRenderLayer({
        onProgress: (renderProgress) => {
          emitter.emit('schematic:apply-progress', {
            phase: 'building-minecraft-render-layer',
            processedStates: renderProgress.processedStates,
            totalStates: renderProgress.totalStates,
            builtMeshes: renderProgress.builtMeshes,
            progress: renderProgress.progress,
          })
        },
      })
      result.renderOverlay = renderOverlay
    }
    catch (renderError) {
      console.warn('[World] Failed to rebuild Minecraft schematic render layer:', renderError)
      result.renderOverlayError = renderError?.message || 'minecraft_render_overlay_failed'
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

  _cloneSimple(value) {
    return JSON.parse(JSON.stringify(value))
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
    const centerPos = this.player?.getPosition?.() || { x: previousManager.chunkWidth * 0.5, z: previousManager.chunkWidth * 0.5 }

    const nextManager = new ChunkManager({
      chunkWidth: previousManager.chunkWidth,
      chunkHeight: nextHeight,
      viewDistance: previousManager.viewDistance,
      unloadPadding: previousManager.unloadPadding,
      seed: previousManager.seed,
      terrain: this._cloneSimple(previousManager.terrainParams),
      trees: this._cloneSimple(previousManager.treeParams),
      water: this._cloneSimple(previousManager.waterParams),
      biomeSource: previousManager.biomeParams?.biomeSource,
      forcedBiome: previousManager.biomeParams?.forcedBiome,
    })

    if (snapshot && nextManager.persistence?.applySnapshot) {
      nextManager.persistence.applySnapshot(snapshot, { persist: true })
      nextManager.restoreRuntimeStateFromPersistence?.()
      nextManager.schematicOnlyMode = !!nextManager.persistence.getWorldState?.().schematicOnlyMode
    }

    nextManager.persistence?.setWorldState?.({ schematicOnlyMode: true })
    nextManager.schematicOnlyMode = true

    nextManager.initInitialGrid()
    nextManager.updateStreaming({ x: centerPos.x, z: centerPos.z }, true)

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

    console.info(`[World] Chunk height updated: ${previousManager.chunkHeight} -> ${nextHeight}`)
  }

  _applyBackendSpawn(playerConfig = {}, options = {}) {
    const { movePlayer = false } = options

    if (!this.player)
      return

    const spawnPoint = playerConfig.spawnPoint
    if (!spawnPoint)
      return

    this.player.setRespawnPoint(spawnPoint.x, spawnPoint.y, spawnPoint.z, movePlayer)

    if (playerConfig.flight) {
      this.player.setFlightOptions(playerConfig.flight)
    }
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
    const schematicLayer = this.chunkManager?.minecraftSchematicLayer
    const stats = schematicLayer?.getStats?.() || { blockCount: 0 }
    console.log('[World Debug] _syncMinecraftSchematicRenderLayer:', { blockCount: stats.blockCount, hasSchematicLayer: !!schematicLayer })

    if (!stats.blockCount) {
      this.chunkManager?.setMinecraftRenderOverlayActive?.(false)
      this.minecraftSchematicRenderLayer?.clear?.()
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
    const result = await renderLayer.rebuildFromLayer(schematicLayer, options)
    this.chunkManager?.setMinecraftRenderOverlayActive?.(true)
    return result
  }

  async _restoreMinecraftSchematicRenderLayer() {
    try {
      await this._syncMinecraftSchematicRenderLayer()
    }
    catch (error) {
      console.warn('[World] Failed to restore Minecraft schematic render layer:', error)
    }
  }

  _scheduleMinecraftSchematicRenderLayerSync(delayMs = 60) {
    if (this._minecraftRenderLayerSyncTimer) {
      clearTimeout(this._minecraftRenderLayerSyncTimer)
    }

    this._minecraftRenderLayerSyncTimer = setTimeout(() => {
      this._minecraftRenderLayerSyncTimer = null
      void this._syncMinecraftSchematicRenderLayer()
    }, delayMs)
  }

  _onMinecraftBlockBreakComplete() {
    if (this.chunkManager?.minecraftRenderOverlayActive) {
      this._scheduleMinecraftSchematicRenderLayerSync()
    }
  }

  _onMinecraftBlockPlace() {
    if (this.chunkManager?.minecraftRenderOverlayActive) {
      this._scheduleMinecraftSchematicRenderLayerSync()
    }
  }

  _onMinecraftBlockUse(payload = {}) {
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
      console.info('[World Debug] Loaded local world-state FULL:', localDecoded)
      console.info('[World Debug] Loaded local world-state SUMMARY', {
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
              console.info('[World Debug] Loaded remote world-state (space-first)', {
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
      console.info('[World Debug] Loaded local fallback world-state', {
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
          ? { worldState: { schematicOnlyMode: false }, modifications: {} }
          : null
      }

      const data = await response.json()
      if (!data || typeof data !== 'object') {
        return activeSpace
          ? { worldState: { schematicOnlyMode: false }, modifications: {} }
          : null
      }

      const decoded = sanitizeSnapshot(decodeWorldStateSnapshot(data))
      console.info('[World Debug] Loaded remote world-state (fallback path)', {
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
        ? { worldState: { schematicOnlyMode: false }, modifications: {} }
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
        },
        body: JSON.stringify(compactPayload),
      })

      if (!response.ok) {
        throw new Error(`remote_world_state_save_failed_${response.status}`)
      }

      console.info('[World Debug] Saved world-state', {
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

  /** 地形：ChunkManager + 暴露 terrainDataManager + 初始网格 */
  _initTerrain(config = null, sharedWorldState = null) {
    const activeSpace = getActiveSpaceName()
    const scopedWorldName = buildSpaceScopedKey('terrain-persistence', activeSpace)
    const backendChunk = config?.settings?.chunk || {}
    const chunkHeight = backendChunk.height ?? CHUNK_BASIC_CONFIG.chunkHeight
    const viewDistance = backendChunk.viewDistance ?? CHUNK_BASIC_CONFIG.viewDistance

    this.chunkManager = new ChunkManager({
      chunkWidth: CHUNK_BASIC_CONFIG.chunkWidth,
      chunkHeight,
      viewDistance,
      seed: 1265,
      worldName: scopedWorldName || 'default',
    })

    if (sharedWorldState && this.chunkManager?.persistence?.applySnapshot) {
      this.chunkManager.persistence.applySnapshot(sharedWorldState, { persist: true })
      this.chunkManager.restoreRuntimeStateFromPersistence?.()
      this.chunkManager.schematicOnlyMode = !!this.chunkManager.persistence.getWorldState?.().schematicOnlyMode
    }

    this.chunkManager.persistence?.setWorldState?.({ schematicOnlyMode: true })
    this.chunkManager.schematicOnlyMode = true

    this.experience.terrainDataManager = this.chunkManager
    this.chunkManager.initInitialGrid()

    const runtimeSnapshot = this.chunkManager.persistence?.exportSnapshot?.() || null
    if (!hasSnapshotContent(sharedWorldState) && hasSnapshotContent(runtimeSnapshot)) {
      void this._saveSharedWorldState()
    }
  }

  /** 玩家 + 相机 Rig，依赖地形（贴地/碰撞用 terrainDataManager） */
  _initPlayerAndCamera() {
    this.player = new Player(this.experience)
    this.cameraRig = new CameraRig()
    this.cameraRig.attachPlayer(this.player)
    this.experience.camera.attachRig(this.cameraRig)

    const camera = this.experience.camera
    const isFirstPerson = camera?.currentMode === camera?.cameraModes?.FIRST_PERSON
    this.player.isFirstPersonView = !!isFirstPerson
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
      if (data.unloadPadding !== undefined)
        this.chunkManager.unloadPadding = data.unloadPadding
      if (this.player) {
        const pos = this.player.getPosition()
        this.chunkManager.updateStreaming({ x: pos.x, z: pos.z }, true)
      }
    })
  }

  /**
   * 每帧更新，顺序与依赖一致：地形流式 → 地形动画 → 挖矿 → 玩家/环境 → 射线/选中框 → 粒子
   */
  update() {
    if (this.chunkManager && this.player) {
      if (!this.chunkManager.schematicOnlyMode) {
        const pos = this.player.getPosition()
        this.chunkManager.updateStreaming({ x: pos.x, z: pos.z })
      }
      this.chunkManager.pumpIdleQueue()
    }
    if (this.chunkManager)
      this.chunkManager.update()
    if (this.minecraftSchematicRenderLayer)
      this.minecraftSchematicRenderLayer.update()
    if (this.blockMiningController)
      this.blockMiningController.update()
    if (this.player)
      this.player.update()
    if (this.environment)
      this.environment.update()
    if (this.blockRaycaster)
      this.blockRaycaster.update()
    if (this.blockSelectionHelper)
      this.blockSelectionHelper.update()
    if (this.blockBreakParticles)
      this.blockBreakParticles.update()
  }

  /**
   * Reset the world with new seed and worldgen params (lightweight rebuild)
   * @param {object} options
   * @param {number} options.seed - The new world seed
   * @param {object} [options.terrain] - Terrain generation params
   * @param {object} [options.trees] - Tree generation params
   */
  reset({ seed, terrain, trees } = {}) {
    console.info('[World] Procedural generation is disabled; ignoring reset_world request.', {
      seed,
      terrain,
      trees,
    })
  }

  destroy() {
    if (this._minecraftRenderLayerSyncTimer) {
      clearTimeout(this._minecraftRenderLayerSyncTimer)
      this._minecraftRenderLayerSyncTimer = null
    }
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
    this.minecraftSchematicRenderLayer?.dispose()
    this.chunkManager?.destroy()

    // Clear terrainDataManager reference
    if (this.experience.terrainDataManager === this.chunkManager) {
      this.experience.terrainDataManager = null
    }
  }
}
