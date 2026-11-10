import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import Experience from '../../experience.js'
import emitter from '../event/event-bus.js'
import { resolvePublicAssetPath } from '../public-asset-url.js'

export default class Resources {
  constructor(sources, options = {}) {
    this.experience = new Experience()
    this.renderer = this.experience.renderer
    this.sources = sources

    this.items = {}
    this.loadingPromises = new Map()
    this._readyEmitted = false
    this.toLoad = this.sources.filter(source => !source.lazy).length
    this.loaded = 0
    this.failed = 0

    // Loading screen elements
    this.loadingScreen = document.getElementById('loading-screen')
    this.loadingBar = document.getElementById('loading-bar')
    this.loadingPercentage = document.getElementById('loading-percentage')

    this.options = {
      sourceLoadTimeoutMs: 12000,
      ...options,
    }

    this.setLoaders()
    this.startLoading()
  }

  setLoaders() {
    this.loaders = {}
    this.loaders.gltfLoader = new GLTFLoader()
    this.loaders.textureLoader = new THREE.TextureLoader()
  }

  startLoading() {
    const eagerSources = this.sources.filter(source => !source.lazy)

    if (eagerSources.length === 0) {
      this._emitLoadingProgress()
      this._emitReadyOnce()
      return
    }

    this._emitLoadingProgress()

    for (const source of eagerSources) {
      void this.loadSource(source, { countInProgress: true })
    }
  }

  loadSource(source, options = {}) {
    if (!source?.name) {
      return Promise.resolve(null)
    }

    const { countInProgress = false } = options

    if (this.items[source.name]) {
      return Promise.resolve(this.items[source.name])
    }

    if (this.loadingPromises.has(source.name)) {
      return this.loadingPromises.get(source.name)
    }

    const loadPromise = new Promise((resolve) => {
      let settled = false
      let timeoutId = null

      const finishWithSuccess = (file) => {
        if (settled) {
          return
        }
        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        this.sourceLoaded(source, file, { countInProgress })
        resolve(file)
      }

      const finishWithFailure = (error) => {
        if (settled) {
          return
        }
        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        console.error(`[Resources] Failed to load source: ${source.name} (${source.path})`, error)
        this.sourceFailed(source, error, { countInProgress })
        resolve(null)
      }

      const timeoutMs = Number(this.options.sourceLoadTimeoutMs)
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          finishWithFailure(new Error(`resource_load_timeout:${timeoutMs}ms`))
        }, timeoutMs)
      }

      const resourcePath = resolvePublicAssetPath(source.path)

      switch (source.type) {
        case 'gltfModel': {
          this.loaders.gltfLoader.load(resourcePath, finishWithSuccess, undefined, finishWithFailure)
          break
        }
        case 'texture': {
          this.loaders.textureLoader.load(resourcePath, finishWithSuccess, undefined, finishWithFailure)
          break
        }
        default: {
          finishWithFailure(new Error(`Unsupported source type: ${source.type}`))
        }
      }
    }).finally(() => {
      this.loadingPromises.delete(source.name)
    })

    this.loadingPromises.set(source.name, loadPromise)
    return loadPromise
  }

  sourceLoaded(source, file, options = {}) {
    const { countInProgress = false } = options
    this.items[source.name] = file

    if (countInProgress) {
      this.loaded++
    }

    this._updateLoadingUi()

    if (countInProgress && this.loaded + this.failed === this.toLoad) {
      this._emitReadyOnce()
    }
  }

  sourceFailed(source, error, options = {}) {
    const { countInProgress = false } = options

    if (countInProgress) {
      this.failed++
    }

    emitter.emit('core:resource-error', {
      name: source?.name || '',
      path: source?.path || '',
      message: String(error?.message || 'unknown_resource_error'),
    })

    this._updateLoadingUi()

    if (countInProgress && this.loaded + this.failed === this.toLoad) {
      this._emitReadyOnce()
    }
  }

  _updateLoadingUi() {
    const progress = this.loadProgress
    const percentage = Math.round(progress * 100)

    if (this.loadingBar) {
      this.loadingBar.style.width = `${percentage}%`
    }
    if (this.loadingPercentage) {
      this.loadingPercentage.textContent = `${percentage}%`
    }

    this._emitLoadingProgress()
  }

  _emitLoadingProgress() {
    emitter.emit('core:loading-progress', {
      loaded: this.loaded,
      failed: this.failed,
      total: this.toLoad,
      progress: this.loadProgress,
    })
  }

  _emitReadyOnce() {
    if (this._readyEmitted) {
      return
    }
    this._readyEmitted = true

    if (this.loadingScreen) {
      this.loadingScreen.style.transition = 'opacity 0.5s ease-out'
      this.loadingScreen.style.opacity = '0'
      setTimeout(() => {
        this.loadingScreen.style.display = 'none'
      }, 500)
    }

    emitter.emit('core:ready')
  }

  get loadProgress() {
    if (!this.toLoad) {
      return 1
    }
    return (this.loaded + this.failed) / this.toLoad
  }

  get isLoaded() {
    return this.loaded + this.failed === this.toLoad
  }

  destroy() {
    // Dispose all loaded textures
    for (const item of Object.values(this.items)) {
      if (item?.dispose) {
        item.dispose()
      }
      // For GLTF models, traverse and dispose
      if (item?.scene?.traverse) {
        item.scene.traverse((child) => {
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
      }
    }

    // Clear items
    this.items = {}
    this.loaded = 0
    this.failed = 0
  }
}
