import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'

import Experience from '../../experience.js'
import emitter from '../event/event-bus.js'

export default class Resources {
  constructor(sources, options = {}) {
    this.experience = new Experience()
    this.renderer = this.experience.renderer
    this.sources = sources

    this.items = {}
    this.sourceMap = new Map(this.sources.map(source => [source.name, source]))
    this.loadingPromises = new Map()
    this._readyEmitted = false
    this.toLoad = this.sources.filter(source => !source.lazy).length
    this.loaded = 0

    // Loading screen elements
    this.loadingScreen = document.getElementById('loading-screen')
    this.loadingBar = document.getElementById('loading-bar')
    this.loadingPercentage = document.getElementById('loading-percentage')

    this.options = {
      dracoDecoderPath: 'https://www.gstatic.com/draco/v1/decoders/',
      ktx2TranscoderPath: 'https://unpkg.com/three/examples/jsm/libs/basis/',
      ...options,
    }

    this.setLoaders()
    this.startLoading()
  }

  setLoaders() {
    this.loaders = {}
    this.loaders.gltfLoader = new GLTFLoader()
    this.loaders.textureLoader = new THREE.TextureLoader()
    this.loaders.cubeTextureLoader = new THREE.CubeTextureLoader()
    this.loaders.fontLoader = new FontLoader()
    this.loaders.fbxLoader = new FBXLoader()
    this.loaders.audioLoader = new THREE.AudioLoader()
    this.loaders.objLoader = new OBJLoader()
    this.loaders.hdrTextureLoader = new RGBELoader()
    this.loaders.svgLoader = new SVGLoader()
    this.loaders.exrLoader = new EXRLoader()
    this.loaders.ktx2Loader = new KTX2Loader()

    // Set up DRACOLoader
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath(this.options.dracoDecoderPath)
    this.loaders.gltfLoader.setDRACOLoader(dracoLoader)

    // Set up KTX2Loader
    this.loaders.ktx2Loader
      .setTranscoderPath(this.options.ktx2TranscoderPath)
      .detectSupport(this.renderer.instance)
    this.loaders.gltfLoader.setKTX2Loader(this.loaders.ktx2Loader)
  }

  startLoading() {
    const eagerSources = this.sources.filter(source => !source.lazy)

    if (eagerSources.length === 0) {
      this._emitReadyOnce()
      return
    }

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

    const loadPromise = new Promise((resolve, reject) => {
      const onLoaded = (file) => {
        this.sourceLoaded(source, file, { countInProgress })
        resolve(file)
      }

      const onError = (error) => {
        console.error(`[Resources] Failed to load source: ${source.name} (${source.path})`, error)
        reject(error)
      }

      switch (source.type) {
        case 'gltfModel': {
          this.loaders.gltfLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'texture': {
          this.loaders.textureLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'cubeTexture': {
          this.loaders.cubeTextureLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'font': {
          this.loaders.fontLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'fbxModel': {
          this.loaders.fbxLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'audio': {
          this.loaders.audioLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'objModel': {
          this.loaders.objLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'hdrTexture': {
          this.loaders.hdrTextureLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'svg': {
          this.loaders.svgLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'exrTexture': {
          this.loaders.exrLoader.load(source.path, onLoaded, undefined, onError)
          break
        }
        case 'video': {
          this.loadVideoTexture(source.path).then((file) => {
            onLoaded(file)
          }).catch(onError)
          break
        }
        case 'ktx2Texture': {
          this.loaders.ktx2Loader.load(source.path, onLoaded, undefined, onError)
          break
        }
        default: {
          reject(new Error(`Unsupported source type: ${source.type}`))
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

    // Update loading progress
    const progress = this.loadProgress
    const percentage = Math.round(progress * 100)

    if (this.loadingBar) {
      this.loadingBar.style.width = `${percentage}%`
    }
    if (this.loadingPercentage) {
      this.loadingPercentage.textContent = `${percentage}%`
    }

    if (countInProgress && this.loaded === this.toLoad) {
      this._emitReadyOnce()
    }
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

  async loadByNames(names = []) {
    const uniqueNames = [...new Set((names || []).filter(Boolean))]
    if (uniqueNames.length === 0) {
      return []
    }

    const tasks = uniqueNames.map((name) => {
      const source = this.sourceMap.get(name)
      if (!source) {
        return Promise.resolve(null)
      }
      return this.loadSource(source)
    })

    await Promise.all(tasks)
    return uniqueNames.filter(name => !!this.items[name])
  }

  loadVideoTexture(path) {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.src = path
      video.loop = true
      video.muted = true
      video.playsInline = true

      video.addEventListener('loadeddata', () => {
        const texture = new THREE.VideoTexture(video)
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.format = THREE.RGBFormat

        resolve(texture)
      })

      video.load()
    })
  }

  get loadProgress() {
    return this.loaded / this.toLoad
  }

  get isLoaded() {
    return this.loaded === this.toLoad
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
  }
}
