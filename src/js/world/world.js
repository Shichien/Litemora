import { useSettingsStore } from '../../pinia/settingsStore.js'
import { useUiStore } from '../../pinia/uiStore.js'
import CameraRig from '../camera/camera-rig.js'
import {
  CHUNK_BASIC_CONFIG,
  TERRAIN_PARAMS,
} from '../config/chunk-config.js'
import { INTERACTION_CONFIG } from '../config/interaction-config.js'
import Experience from '../experience.js'
import BlockBreakParticles from '../interaction/block-break-particles.js'
import BlockInteractionManager from '../interaction/block-interaction-manager.js'
import BlockMiningController from '../interaction/block-mining-controller.js'
import BlockMiningOverlay from '../interaction/block-mining-overlay.js'
import BlockRaycaster from '../interaction/block-raycaster.js'
import BlockSelectionHelper from '../interaction/block-selection-helper.js'
import ItemPickupAnimator from '../interaction/item-pickup-animator.js'
import emitter from '../utils/event/event-bus.js'
import { buildSpaceScopedKey, getActiveSpaceName } from '../utils/space-context.js'
import { loadBackendWorldConfig } from './backend-world-config.js'
import Environment from './environment.js'
import Player from './player/player.js'
import ChunkManager from './terrain/chunk-manager.js'
import { preloadAtlasTextureImage } from './terrain/java-atlas-texture-provider.js'
import schematicService from './terrain/schematic-service.js'
import { decodeWorldStateSnapshot, encodeWorldStateSnapshot } from './terrain/world-state-codec.js'

const WORLD_STATE_STORAGE_KEY = 'mc-world-state'

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

    emitter.on('core:ready', async () => {
      this.backendConfig = await loadBackendWorldConfig()
      const sharedWorldState = await this._loadSharedWorldState()

      this._initTerrain(this.backendConfig, sharedWorldState)

      try {
        await preloadAtlasTextureImage()
      }
      catch (error) {
        console.warn('[World] Atlas preload failed before player spawn:', error)
      }

      this._initPlayerAndCamera()
      this._initEnvironment()
      this._initBlockInteraction()
      this._initEffects()
      this._setupSettingsListeners()
      await this._applyBackendRuntimeConfig(this.backendConfig, { movePlayer: true })
    })

    emitter.on('backend:config-updated', async (config) => {
      await this._applyBackendRuntimeConfig(config, { movePlayer: false })
    })

    emitter.on('schematic:apply-request', async (payload = {}) => {
      try {
        const offset = payload.offset || { x: 0, y: 0, z: 0 }
        emitter.emit('schematic:apply-progress', {
          phase: 'loading-textures',
          progress: 0,
          processedBlocks: 0,
          totalBlocks: schematicService.getPreview()?.blockCount || 0,
        })

        await schematicService.preloadTextures(this.resources)

        const options = {
          ...(payload.options || {}),
          onProgress: (progress) => {
            emitter.emit('schematic:apply-progress', progress)
          },
        }
        const result = await schematicService.applyToWorld(this.chunkManager, offset, options)
        const persistenceSaved = await this._saveSharedWorldState()
        result.persistenceSaved = persistenceSaved
        emitter.emit('schematic:apply-result', { ok: true, result })
      }
      catch (error) {
        emitter.emit('schematic:apply-result', {
          ok: false,
          error: error?.message || 'Unknown schematic apply error',
        })
      }
    })
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
      nextManager.schematicOnlyMode = !!nextManager.persistence.getWorldState?.().schematicOnlyMode
    }

    nextManager.initInitialGrid()
    nextManager.updateStreaming({ x: centerPos.x, z: centerPos.z }, true)

    previousManager.destroy()

    this.chunkManager = nextManager
    this.experience.terrainDataManager = nextManager

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

  async _loadSharedWorldState() {
    const activeSpace = getActiveSpaceName()
    const storageKey = buildSpaceScopedKey(WORLD_STATE_STORAGE_KEY, activeSpace)

    if (activeSpace) {
      try {
        const requestUrl = `/api/world-state?space=${encodeURIComponent(activeSpace)}`
        const response = await fetch(requestUrl, { cache: 'no-store' })
        if (response.ok) {
          const data = await response.json()
          if (data && typeof data === 'object') {
            const decoded = decodeWorldStateSnapshot(data)
            try {
              localStorage.setItem(storageKey, JSON.stringify(data))
            }
            catch {
              // ignore local storage quota errors
            }
            return decoded
          }
        }
      }
      catch {
        // fallback to local state below
      }
    }

    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          return decodeWorldStateSnapshot(parsed)
        }
      }
    }
    catch {
      // ignore invalid local state
    }

    try {
      const requestUrl = activeSpace
        ? `/api/world-state?space=${encodeURIComponent(activeSpace)}`
        : '/api/world-state'
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

      const decoded = decodeWorldStateSnapshot(data)

      try {
        localStorage.setItem(storageKey, JSON.stringify(data))
      }
      catch {
        // ignore local storage quota errors
      }

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
      const storageKey = buildSpaceScopedKey(WORLD_STATE_STORAGE_KEY, activeSpace)

      try {
        localStorage.setItem(storageKey, JSON.stringify(compactPayload))
      }
      catch {
        // ignore local storage quota errors
      }

      const requestUrl = activeSpace
        ? `/api/world-state?space=${encodeURIComponent(activeSpace)}`
        : '/api/world-state'

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

      return true
    }
    catch (error) {
      console.warn('[World] Failed to persist shared world state remotely:', error)
      return false
    }
  }

  /** 地形：ChunkManager + 暴露 terrainDataManager + 初始网格 */
  _initTerrain(config = null, sharedWorldState = null) {
    const backendChunk = config?.settings?.chunk || {}
    const chunkHeight = backendChunk.height ?? CHUNK_BASIC_CONFIG.chunkHeight
    const viewDistance = backendChunk.viewDistance ?? CHUNK_BASIC_CONFIG.viewDistance

    this.chunkManager = new ChunkManager({
      chunkWidth: CHUNK_BASIC_CONFIG.chunkWidth,
      chunkHeight,
      viewDistance,
      seed: 1265,
      terrain: {
        scale: TERRAIN_PARAMS.scale,
        magnitude: TERRAIN_PARAMS.magnitude,
        offset: TERRAIN_PARAMS.offset,
        rockExpose: TERRAIN_PARAMS.rockExpose,
        fbm: TERRAIN_PARAMS.fbm,
      },
    })

    if (sharedWorldState && this.chunkManager?.persistence?.applySnapshot) {
      this.chunkManager.persistence.applySnapshot(sharedWorldState, { persist: true })
      this.chunkManager.schematicOnlyMode = !!this.chunkManager.persistence.getWorldState?.().schematicOnlyMode
    }

    this.experience.terrainDataManager = this.chunkManager
    this.chunkManager.initInitialGrid()
  }

  /** 玩家 + 相机 Rig，依赖地形（贴地/碰撞用 terrainDataManager） */
  _initPlayerAndCamera() {
    this.player = new Player()
    this.cameraRig = new CameraRig()
    this.cameraRig.attachPlayer(this.player)
    this.experience.camera.attachRig(this.cameraRig)
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
    if (!this.chunkManager) {
      console.warn('[World] Cannot reset: chunkManager not initialized')
      return
    }

    this.chunkManager.persistence?.clearAllPersistedData?.()
    this.chunkManager.setSchematicOnlyMode?.(false)

    // Use the new lightweight regeneration API
    this.chunkManager.regenerateAll({
      seed,
      terrain,
      trees,
      centerPos: { x: this.chunkManager.chunkWidth * 0.5, z: this.chunkManager.chunkWidth * 0.5 },
      forceSyncCenterChunk: true,
    })

    // Reset player position to safe spawn point (Strategy A)
    if (this.player) {
      // 触发一次重生，它内部会通过最新的 chunkManager 数据计算正确的高度
      this.player.respawn()
    }
  }

  destroy() {
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
    this.chunkManager?.destroy()

    // Clear terrainDataManager reference
    if (this.experience.terrainDataManager === this.chunkManager) {
      this.experience.terrainDataManager = null
    }
  }
}
