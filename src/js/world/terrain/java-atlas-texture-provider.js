import * as THREE from 'three'
import { javaAtlasBlockTextureRects } from '../../generated/java-atlas-textures.js'
import emitter from '../../utils/event/event-bus.js'

const ATLAS_VIRTUAL_PREFIX = 'atlas:'
const ATLAS_IMAGE_URL = '/textures/litematic/atlas.png'

const atlasRectKeySet = new Set(Object.keys(javaAtlasBlockTextureRects))
const atlasTextureCache = new Map()
const atlasReadyEmitted = new Set()

let atlasImage = null
let atlasSize = 0
let atlasLoadPromise = null

function upperPowerOfTwo(value) {
  let x = Math.max(1, Math.floor(Number(value) || 1))
  x -= 1
  x |= x >> 1
  x |= x >> 2
  x |= x >> 4
  x |= x >> 8
  x |= x >> 16
  return x + 1
}

export function isAtlasTextureVirtualKey(textureKey) {
  return typeof textureKey === 'string' && textureKey.startsWith(ATLAS_VIRTUAL_PREFIX)
}

export function toAtlasVirtualTextureKey(rectKey) {
  if (typeof rectKey !== 'string' || !rectKey) {
    return null
  }
  return `${ATLAS_VIRTUAL_PREFIX}${rectKey}`
}

export function hasAtlasRectKey(rectKey) {
  return atlasRectKeySet.has(rectKey)
}

export function preloadAtlasTextureImage() {
  return ensureAtlasImageLoaded()
}

function getRectKeyFromVirtualTextureKey(textureKey) {
  if (!isAtlasTextureVirtualKey(textureKey)) {
    return null
  }
  return textureKey.slice(ATLAS_VIRTUAL_PREFIX.length)
}

function ensureAtlasImageLoaded() {
  if (atlasImage) {
    return Promise.resolve(atlasImage)
  }

  if (atlasLoadPromise) {
    return atlasLoadPromise
  }

  atlasLoadPromise = new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('[AtlasTextureProvider] Image is not available in current runtime'))
      return
    }

    const image = new Image()
    image.onload = () => {
      atlasImage = image
      atlasSize = upperPowerOfTwo(Math.max(image.width, image.height))
      console.debug('[AtlasTextureProvider] atlas loaded', {
        url: ATLAS_IMAGE_URL,
        width: image.width,
        height: image.height,
        atlasSize,
      })
      resolve(image)
    }
    image.onerror = (error) => {
      reject(new Error(`[AtlasTextureProvider] Failed to load atlas image: ${String(error)}`))
    }
    image.src = ATLAS_IMAGE_URL
  }).catch((error) => {
    atlasLoadPromise = null
    throw error
  })

  return atlasLoadPromise
}

function createTextureFromAtlasRect(rectKey) {
  if (!atlasImage) {
    return null
  }

  const rect = javaAtlasBlockTextureRects[rectKey]
  if (!Array.isArray(rect) || rect.length < 4) {
    return null
  }

  const [x, y, width, height] = rect
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  const sampledHeight = width !== height && rectKey.startsWith('block/') ? width : height
  if (width <= 0 || sampledHeight <= 0) {
    return null
  }

  if (typeof document === 'undefined') {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = sampledHeight

  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  context.imageSmoothingEnabled = false
  const boundSize = atlasSize || Math.max(atlasImage.width, atlasImage.height)
  if (x + width > boundSize || y + sampledHeight > boundSize) {
    return null
  }

  context.drawImage(atlasImage, x, y, width, sampledHeight, 0, 0, width, sampledHeight)

  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}

export function requestAtlasTexture(textureKey) {
  if (!isAtlasTextureVirtualKey(textureKey)) {
    return null
  }

  const cachedTexture = atlasTextureCache.get(textureKey)
  if (cachedTexture) {
    return cachedTexture
  }

  const rectKey = getRectKeyFromVirtualTextureKey(textureKey)
  if (!rectKey || !hasAtlasRectKey(rectKey)) {
    return null
  }

  if (atlasImage) {
    const texture = createTextureFromAtlasRect(rectKey)
    if (texture) {
      atlasTextureCache.set(textureKey, texture)
      if (!atlasReadyEmitted.has(textureKey)) {
        atlasReadyEmitted.add(textureKey)
        emitter.emit('terrain:atlas-texture-ready', { textureKey })
      }
      return texture
    }
    return null
  }

  ensureAtlasImageLoaded()
    .then(() => {
      if (atlasTextureCache.has(textureKey)) {
        return
      }

      const loadedTexture = createTextureFromAtlasRect(rectKey)
      if (!loadedTexture) {
        return
      }

      atlasTextureCache.set(textureKey, loadedTexture)
      if (!atlasReadyEmitted.has(textureKey)) {
        atlasReadyEmitted.add(textureKey)
        emitter.emit('terrain:atlas-texture-ready', { textureKey })
      }
    })
    .catch((error) => {
      console.warn('[AtlasTextureProvider] Failed to resolve atlas texture:', textureKey, error)
    })

  return null
}
