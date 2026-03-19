import * as THREE from 'three'
import { javaAtlasBlockTextureRects } from '../../generated/java-atlas-textures.js'
import emitter from '../../utils/event/event-bus.js'

const ATLAS_VIRTUAL_PREFIX = 'atlas:'
const ATLAS_IMAGE_URL = '/textures/litematic/atlas.webp'

const LEGACY_TEXTURE_ALIAS_TO_ATLAS_RECT = {
  allium_plant_Texture: 'block/allium',
  andesite_Texture: 'block/andesite',
  birchLeaves_Texture: 'block/birch_leaves',
  birchTrunk_SideTexture: 'block/birch_log',
  birchTrunk_TopTexture: 'block/birch_log_top',
  cactusTrunk_SideTexture: 'block/cactus_side',
  cactusTrunk_TopTexture: 'block/cactus_top',
  cactus_flower_Texture: 'block/cactus_flower',
  cherryLeaves_Texture: 'block/cherry_leaves',
  cherryTrunk_SideTexture: 'block/cherry_log',
  cherryTrunk_TopTexture: 'block/cherry_log_top',
  coal_ore: 'block/coal_ore',
  crackedPolishedBlackstoneBricks_Texture: 'block/cracked_polished_blackstone_bricks',
  dandelion_plant_Texture: 'block/dandelion',
  deadBush_plant_Texture: 'block/dead_bush',
  diorite_Texture: 'block/diorite',
  dirt: 'block/dirt',
  grass: 'block/grass_block_top',
  grass_block_side_texture: 'block/grass_block_side',
  gravel_Texture: 'block/gravel',
  ice_Texture: 'block/ice',
  iron_ore: 'block/iron_ore',
  ochreFroglight_SideTexture: 'block/ochre_froglight_side',
  ochreFroglight_TopTexture: 'block/ochre_froglight_top',
  oxeyeDaisy_plant_Texture: 'block/oxeye_daisy',
  packedIce_Texture: 'block/packed_ice',
  pearlescentFroglight_SideTexture: 'block/pearlescent_froglight_side',
  pearlescentFroglight_TopTexture: 'block/pearlescent_froglight_top',
  pink_tulip_Texture: 'block/pink_tulip',
  polishedAndesite_Texture: 'block/polished_andesite',
  polishedBlackstoneBricks_Texture: 'block/polished_blackstone_bricks',
  polishedBlackstone_Texture: 'block/polished_blackstone',
  polishedDiorite_Texture: 'block/polished_diorite',
  poppy_plant_Texture: 'block/poppy',
  red_sand: 'block/red_sand',
  sand: 'block/sand',
  shortDryGrass_plant_Texture: 'block/short_dry_grass',
  shortGrass_plant_Texture: 'block/short_grass',
  snow: 'block/snow',
  stone: 'block/stone',
  terracotta_yellow: 'block/yellow_terracotta',
  treeLeaves_Texture: 'block/oak_leaves',
  treeTrunk_SideTexture: 'block/oak_log',
  treeTrunk_TopTexture: 'block/oak_log_top',
}

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

function toSnakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/_?texture$/iu, '')
    .replace(/_+/gu, '_')
    .toLowerCase()
}

export function resolveAtlasVirtualTextureKey(textureKey) {
  if (typeof textureKey !== 'string' || !textureKey) {
    return null
  }

  if (isAtlasTextureVirtualKey(textureKey)) {
    return textureKey
  }

  const trimmedKey = textureKey.trim()
  const candidates = []

  const aliasRect = LEGACY_TEXTURE_ALIAS_TO_ATLAS_RECT[trimmedKey]
  if (aliasRect) {
    candidates.push(aliasRect)
  }

  if (trimmedKey.startsWith('minecraft:')) {
    candidates.push(`block/${trimmedKey.slice('minecraft:'.length)}`)
  }
  else if (trimmedKey.startsWith('block/')) {
    candidates.push(trimmedKey)
  }
  else {
    candidates.push(`block/${trimmedKey}`)
  }

  const snakeCaseKey = toSnakeCase(trimmedKey)
  if (snakeCaseKey && snakeCaseKey !== trimmedKey) {
    candidates.push(`block/${snakeCaseKey}`)
  }

  for (const rectKey of candidates) {
    if (hasAtlasRectKey(rectKey)) {
      return toAtlasVirtualTextureKey(rectKey)
    }
  }

  return null
}

export function canResolveTextureKeyFromAtlas(textureKey) {
  return !!resolveAtlasVirtualTextureKey(textureKey)
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
  const resolvedTextureKey = resolveAtlasVirtualTextureKey(textureKey)
  if (!resolvedTextureKey) {
    return null
  }

  const cachedTexture = atlasTextureCache.get(resolvedTextureKey)
  if (cachedTexture) {
    return cachedTexture
  }

  const rectKey = getRectKeyFromVirtualTextureKey(resolvedTextureKey)
  if (!rectKey || !hasAtlasRectKey(rectKey)) {
    return null
  }

  if (atlasImage) {
    const texture = createTextureFromAtlasRect(rectKey)
    if (texture) {
      atlasTextureCache.set(resolvedTextureKey, texture)
      if (!atlasReadyEmitted.has(resolvedTextureKey)) {
        atlasReadyEmitted.add(resolvedTextureKey)
        emitter.emit('terrain:atlas-texture-ready', { textureKey: resolvedTextureKey })
      }
      return texture
    }
    return null
  }

  ensureAtlasImageLoaded()
    .then(() => {
      if (atlasTextureCache.has(resolvedTextureKey)) {
        return
      }

      const loadedTexture = createTextureFromAtlasRect(rectKey)
      if (!loadedTexture) {
        return
      }

      atlasTextureCache.set(resolvedTextureKey, loadedTexture)
      if (!atlasReadyEmitted.has(resolvedTextureKey)) {
        atlasReadyEmitted.add(resolvedTextureKey)
        emitter.emit('terrain:atlas-texture-ready', { textureKey: resolvedTextureKey })
      }
    })
    .catch((error) => {
      console.warn('[AtlasTextureProvider] Failed to resolve atlas texture:', resolvedTextureKey, error)
    })

  return null
}
