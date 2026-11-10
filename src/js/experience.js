import * as THREE from 'three'

import Camera from './camera/camera.js'
import Renderer from './renderer.js'
import sources from './sources.js'
import Resources from './utils/core/resources.js'
import Sizes from './utils/core/sizes.js'
import Stats from './utils/core/stats.js'
import Time from './utils/core/time.js'
import Debug from './utils/debug/debug.js'
import emitter from './utils/event/event-bus.js'
import IMouse from './utils/input/imouse.js'
import InputManager from './utils/input/input.js'
import PointerLockManager from './utils/input/pointer-lock.js'
import World from './world/world.js'

let instance

export default class Experience {
  constructor(canvas) {
    // Singleton
    if (instance) {
      return instance
    }

    instance = this

    // Global access
    window.Experience = this
    this._renderGameToTextHook = this.renderGameToText.bind(this)
    this._advanceTimeHook = this.advanceTime.bind(this)
    window.render_game_to_text = this._renderGameToTextHook
    window.advanceTime = this._advanceTimeHook

    this.canvas = canvas

    // Panel
    // tweakpane 走动态 import（仅 `#debug` 需要），这里不阻塞构造：
    // 面板就绪前 `debug.ui` 是一个延迟节点，会把调用排队等加载完再回放。
    this.debug = new Debug()
    void this.debug.init()
    this.stats = new Stats()
    this.sizes = new Sizes()
    this.time = new Time()
    this.scene = new THREE.Scene()
    this.camera = new Camera()
    this.renderer = new Renderer()
    this.resources = new Resources(sources)
    this.iMouse = new IMouse()
    this.input = new InputManager()
    this.pointerLock = new PointerLockManager() // 鼠标锁定管理器
    this.terrainDataManager = null // 地形数据管理器 - 将在 World 中初始化

    // 记录首个加载错误，UI 可能晚于错误挂载，挂载时从这里读取
    this.bootstrapError = null
    emitter.on('projection:bootstrap-error', (payload = {}) => {
      this.bootstrapError ??= payload
    })

    this.world = new World()

    emitter.on('core:resize', () => {
      this.resize()
    })

    emitter.on('core:tick', () => {
      this.update()
    })

    // Listen for pause state changes from UI
    this.isPaused = false
    emitter.on('ui:pause-changed', (paused) => {
      this.isPaused = paused
    })

    window.addEventListener('beforeunload', () => {
      this.destroy()
    })
  }

  resize() {
    this.camera.resize()
    this.renderer.resize()
  }

  update() {
    // When paused, skip world and camera updates but keep rendering
    if (!this.isPaused) {
      this.camera.update()
      this.world.update()
    }

    // Always render (for static scene display)
    this.renderer.update()
    this.stats.update()
    this.iMouse.update()
  }

  renderGameToText() {
    const player = this.world?.player || null
    const position = player?.getPosition?.() || null
    const velocity = player?.getVelocity?.() || null
    const runtimeStats = this.world?.minecraftSchematicRenderLayer?.getStats?.()?.runtime || null
    return JSON.stringify({
      coordinateSystem: 'Block centers use integer x/y/z; +y is up.',
      mode: this.isPaused ? 'paused' : 'playing',
      sceneReady: !!this.world?.isSceneReady,
      bootstrapError: this.bootstrapError?.error || '',
      projectionId: this.world?.activeProjectionContext?.projectionId || '',
      player: position
        ? {
            x: Number(position.x),
            y: Number(position.y),
            z: Number(position.z),
            velocity: velocity
              ? { x: Number(velocity.x), y: Number(velocity.y), z: Number(velocity.z) }
              : null,
            grounded: !!player?.movement?.isGrounded,
            flying: !!player?.movement?.isFlying,
          }
        : null,
      schematic: runtimeStats
        ? {
            active: !!this.world?.minecraftSchematicRenderLayer?.isRuntimeRendererActive?.(),
            streamReady: !!runtimeStats.streamReady,
            dimensions: runtimeStats.dimensions,
            bounds: runtimeStats.bounds,
            streamCenter: runtimeStats.streamCenter,
            meshes: runtimeStats.meshCount,
            residentChunks: runtimeStats.residentChunkCount,
            loadingChunks: runtimeStats.loadingChunkCount,
            queuedChunks: runtimeStats.queuedChunkCount,
            totalChunks: runtimeStats.totalChunkCount,
            firstChunkMs: runtimeStats.firstChunkMs,
            sharedMemory: runtimeStats.sharedMemory,
            error: runtimeStats.streamError,
          }
        : null,
    })
  }

  advanceTime(milliseconds = 0) {
    const totalMilliseconds = Math.max(0, Number(milliseconds) || 0)
    const frameMilliseconds = 1000 / 60
    const steps = Math.max(1, Math.round(totalMilliseconds / frameMilliseconds))
    const previousDelta = this.time.delta
    for (let step = 0; step < steps; step++) {
      this.time.delta = frameMilliseconds
      this.time.elapsed += frameMilliseconds
      this.update()
    }
    this.time.delta = previousDelta
  }

  destroy() {
    // 1. Stop update loop first
    this.time?.destroy()

    // 2. Destroy child components (reverse init order)
    this.world?.destroy()
    this.pointerLock?.destroy()
    this.input?.destroy()
    this.iMouse?.destroy()
    this.resources?.destroy()
    this.renderer?.destroy()
    this.camera?.destroy()

    // 3. Destroy utils
    this.stats?.destroy()
    this.sizes?.destroy()
    this.debug?.destroy()

    // 4. Clear scene
    if (this.scene) {
      this.scene.traverse((child) => {
        if (child.geometry)
          child.geometry.dispose()
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose())
          }
          else {
            child.material.dispose()
          }
        }
      })
      this.scene.clear()
    }

    // 5. Clear all mitt events (unified cleanup)
    emitter.all.clear()

    // 6. Clear global references
    if (window.Experience === this) {
      window.Experience = null
    }
    if (window.render_game_to_text === this._renderGameToTextHook) {
      delete window.render_game_to_text
    }
    if (window.advanceTime === this._advanceTimeHook) {
      delete window.advanceTime
    }

    // 7. Reset singleton
    instance = null
  }
}
