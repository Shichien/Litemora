import * as THREE from 'three'
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
import { loadBackendWorldConfig } from './backend-world-config.js'
import Environment from './environment.js'
import Player from './player/player.js'
import ChunkManager from './terrain/chunk-manager.js'

/**
 * World 场景编排器：只负责在 core:ready 后按依赖顺序创建组件、编排 update/destroy。
 * 具体职责见 .agent/skills/vtj-scene-management/SKILL.md
 */
export default class World {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.resources = this.experience.resources
    this.backendModel = null
    this.backendConfig = null
    this.backendGroundRaycaster = new THREE.Raycaster()
    this.backendGroundRayOrigin = new THREE.Vector3()

    this.scene.add(new THREE.AxesHelper(5))

    emitter.on('core:ready', async () => {
      this.backendConfig = await loadBackendWorldConfig()

      this._initTerrain(this.backendConfig)
      this._initPlayerAndCamera()
      this._initEnvironment()
      this._initBlockInteraction()
      this._initEffects()
      this._setupSettingsListeners()
      await this._applyBackendRuntimeConfig(this.backendConfig)
    })

    emitter.on('backend:config-updated', async (config) => {
      await this._applyBackendRuntimeConfig(config)
    })
  }

  async _applyBackendRuntimeConfig(runtimeConfig = null) {
    const config = runtimeConfig || await loadBackendWorldConfig()
    this._applyBackendUi(config.ui)
    this._applyBackendSettings(config.settings)
    this._applyBackendSpawn(config.player)
    await this._applyBackendSceneModel(config.scene)
  }

  _applyBackendUi(uiConfig) {
    const ui = useUiStore()
    ui.applyBackendUiConfig(uiConfig)
  }

  _applyBackendSettings(settingsConfig = {}) {
    const settings = useSettingsStore()

    if (settingsConfig.cameraPreset) {
      settings.applyCameraPreset(settingsConfig.cameraPreset)
    }
    if (settingsConfig.visualPreset) {
      settings.applyVisualPreset(settingsConfig.visualPreset)
    }

    const chunk = settingsConfig.chunk || {}
    if (chunk.height !== undefined && this.chunkManager && chunk.height !== this.chunkManager.chunkHeight) {
      console.warn('[World] chunk height changed. Please refresh page to rebuild world with new height.')
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

  _applyBackendSpawn(playerConfig = {}) {
    if (!this.player)
      return

    const spawnPoint = playerConfig.spawnPoint
    if (!spawnPoint)
      return

    this.player.setRespawnPoint(spawnPoint.x, spawnPoint.y, spawnPoint.z, true)
  }

  async _applyBackendSceneModel(sceneConfig = {}) {
    if (!sceneConfig.modelUrl)
      return

    try {
      const gltf = await this._loadGltfModel(sceneConfig.modelUrl)
      this._disposeBackendModel()

      this.backendModel = gltf.scene
      this.backendModel.position.set(
        sceneConfig.position?.x ?? 0,
        sceneConfig.position?.y ?? 0,
        sceneConfig.position?.z ?? 0,
      )
      this.backendModel.rotation.set(
        sceneConfig.rotation?.x ?? 0,
        sceneConfig.rotation?.y ?? 0,
        sceneConfig.rotation?.z ?? 0,
      )
      this.backendModel.scale.set(
        sceneConfig.scale?.x ?? 1,
        sceneConfig.scale?.y ?? 1,
        sceneConfig.scale?.z ?? 1,
      )

      this.backendModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = sceneConfig.castShadow ?? true
          child.receiveShadow = sceneConfig.receiveShadow ?? true
        }
      })

      this.scene.add(this.backendModel)
      this._attachBackendGroundSampler()
    }
    catch {
      console.warn('[World] Failed to load backend scene model')
    }
  }

  _attachBackendGroundSampler() {
    if (!this.player)
      return

    this.player.setGroundSampler((x, z, originY) => {
      return this._sampleBackendModelGroundY(x, z, originY)
    })
  }

  _sampleBackendModelGroundY(x, z, originY = 80) {
    if (!this.backendModel)
      return null

    const startY = Math.max(originY + 10, 20)
    this.backendGroundRayOrigin.set(x, startY, z)
    this.backendGroundRaycaster.set(this.backendGroundRayOrigin, new THREE.Vector3(0, -1, 0))
    this.backendGroundRaycaster.far = 200

    const hits = this.backendGroundRaycaster.intersectObject(this.backendModel, true)
    if (!hits || hits.length === 0)
      return null

    return hits[0].point.y
  }

  _loadGltfModel(path) {
    const loader = this.resources?.loaders?.gltfLoader
    if (!loader) {
      return Promise.reject(new Error('GLTF loader is not ready'))
    }

    return new Promise((resolve, reject) => {
      loader.load(path, resolve, undefined, reject)
    })
  }

  _disposeBackendModel() {
    if (!this.backendModel)
      return

    this.backendModel.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose?.()
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material.dispose?.())
        }
        else {
          child.material.dispose?.()
        }
      }
    })

    this.scene.remove(this.backendModel)
    this.backendModel = null

    if (this.player) {
      this.player.setGroundSampler(null)
    }
  }

  /** 地形：ChunkManager + 暴露 terrainDataManager + 初始网格 */
  _initTerrain(config = null) {
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
      const pos = this.player.getPosition()
      this.chunkManager.updateStreaming({ x: pos.x, z: pos.z })
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
    this._disposeBackendModel()

    // Clear terrainDataManager reference
    if (this.experience.terrainDataManager === this.chunkManager) {
      this.experience.terrainDataManager = null
    }
  }
}
