/**
 * 方块与矿产元数据配置
 * 仅声明 id / 名称 / 纹理键 / 稀有度，不直接持有纹理实例
 * 渲染阶段统一使用共享几何体：new THREE.BoxGeometry(1, 1, 1)
 */
import * as THREE from 'three'
import CustomShaderMaterial from 'three-custom-shader-material/vanilla'

import aoFragmentShader from '../../../shaders/blocks/ao.frag.glsl'
// 导入 AO 着色器
import aoVertexShader from '../../../shaders/blocks/ao.vert.glsl'
// 导入动画着色器
import windVertexShader from '../../../shaders/blocks/wind.vert.glsl'
import { requestAtlasTexture, resolveAtlasVirtualTextureKey } from './java-atlas-texture-provider.js'

// 方块 ID 常量，便于在代码中保持一致引用
export const BLOCK_IDS = {
  EMPTY: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COAL_ORE: 4,
  IRON_ORE: 5,
  // 树（体素）
  TREE_TRUNK: 6,
  TREE_LEAVES: 7,
  // 沙子（水下地表层）
  SAND: 8,
  // 白桦木相关
  BIRCH_TRUNK: 9,
  BIRCH_LEAVES: 10,
  // 樱花树相关
  CHERRY_TRUNK: 11,
  CHERRY_LEAVES: 12,
  // 沙漠相关
  CACTUS: 13,
  // deadBush (ID: 14) 暂不实现（纹理缺失）
  // 恶地相关
  TERRACOTTA: 15,
  RED_SAND: 16,
  // 冻洋相关
  ICE: 17,
  PACKED_ICE: 18,
  SNOW: 19,
  // snowLayer (ID: 20) 暂不实现（纹理缺失）
  // 其他
  GRAVEL: 21,
  DIORITE: 22,
  POLISHED_DIORITE: 23,
  ANDESITE: 24,
  POLISHED_ANDESITE: 25,
  POLISHED_BLACKSTONE: 26,
  POLISHED_BLACKSTONE_BRICKS: 27,
  CRACKED_POLISHED_BLACKSTONE_BRICKS: 28,
  OCHRE_FROGLIGHT: 29,
  PEARLESCENT_FROGLIGHT: 30,
  STONE_SLAB: 31,
  STONE_STAIRS: 32,
}

// 植物 ID 常量（使用 200+ 区间与方块区分）
export const PLANT_IDS = {
  DEAD_BUSH: 200,
  SHORT_DRY_GRASS: 201,
  SHORT_GRASS: 202,
  DANDELION: 203,
  POPPY: 204,
  OXEYE_DAISY: 205,
  ALLIUM: 206,
  CACTUS_FLOWER: 207,
  PINK_TULIP: 208,
}

/**
 * 动画类型默认参数
 * 用于配置不同类型的方块动画效果
 */
export const ANIMATION_DEFAULTS = {
  wind: {
    windSpeed: 2.0, // 风速，影响摇摆频率
    swayAmplitude: 0.7, // 摇摆幅度
    phaseScale: 2.0, // 相位缩放，控制不同树的差异程度
  },
  // 预留其他动画类型
  // pulse: { frequency: 1.0, intensity: 0.1 },
  // wave: { speed: 1.0, amplitude: 0.05 },
}

/**
 * 动画着色器映射表
 * 根据 animationType 获取对应的着色器代码
 */
const ANIMATION_SHADERS = {
  wind: windVertexShader,
  // pulse: pulseVertexShader, // 预留
  // wave: waveVertexShader,   // 预留
}

/**
 * 约定各方块使用的纹理键，需与 sources.js 中的资源名称一致
 * - grass_top: grass_block_top_texture
 * - grass_side: grass_block_side_texture
 * - dirt: dirt
 * - stone: stone
 * - coal_ore: coal_ore
 * - iron_ore: iron_ore
 */
export const blocks = {
  empty: {
    id: BLOCK_IDS.EMPTY,
    name: 'empty',
    visible: false,
  },
  grass: {
    id: BLOCK_IDS.GRASS,
    name: 'grass',
    visible: true,
    textureKeys: {
      top: 'grass',
      bottom: 'dirt',
      side: 'grass_block_side_texture',
    },
    mixColor: 0x7FBF3F,
  },
  dirt: {
    id: BLOCK_IDS.DIRT,
    name: 'dirt',
    visible: true,
    textureKeys: {
      all: 'dirt',
    },
  },
  stone: {
    id: BLOCK_IDS.STONE,
    name: 'stone',
    visible: true,
    textureKeys: {
      all: 'stone',
    },
    scale: { x: 30, y: 30, z: 30 },
    scarcity: 0.8,
  },
  coalOre: {
    id: BLOCK_IDS.COAL_ORE,
    name: 'coal_ore',
    visible: true,
    textureKeys: {
      all: 'coal_ore',
    },
    scale: { x: 20, y: 20, z: 20 },
    scarcity: 0.8,
  },
  ironOre: {
    id: BLOCK_IDS.IRON_ORE,
    name: 'iron_ore',
    visible: true,
    textureKeys: {
      all: 'iron_ore',
    },
    scale: { x: 40, y: 40, z: 40 },
    scarcity: 0.9,
  },
  // ===== 树（体素方块）=====
  treeTrunk: {
    id: BLOCK_IDS.TREE_TRUNK,
    name: 'tree_trunk',
    visible: true,
    // 树干：六面贴图（侧面/顶面）
    textureKeys: {
      top: 'treeTrunk_TopTexture',
      bottom: 'treeTrunk_TopTexture',
      side: 'treeTrunk_SideTexture',
    },
  },
  treeLeaves: {
    id: BLOCK_IDS.TREE_LEAVES,
    name: 'tree_leaves',
    visible: true,
    // 树叶：使用 alphaTest 构建镂空效果
    textureKeys: {
      all: 'treeLeaves_Texture',
    },
    mixColor: 0x5E9C45,
    alphaTest: 0.5,
    transparent: true,
    // 动画配置：风动效果
    animated: true,
    animationType: 'wind',
    animationParams: {}, // 使用 ANIMATION_DEFAULTS.wind 的默认值
  },
  // ===== 沙子（水下地表层）=====
  sand: {
    id: BLOCK_IDS.SAND,
    name: 'sand',
    visible: true,
    textureKeys: {
      all: 'sand', // 对应 sources.js 中的 'sand' 纹理
    },
  },
  // ===== 白桦树（体素方块）=====
  birchTrunk: {
    id: BLOCK_IDS.BIRCH_TRUNK,
    name: 'birch_trunk',
    visible: true,
    textureKeys: {
      top: 'birchTrunk_TopTexture',
      bottom: 'birchTrunk_TopTexture',
      side: 'birchTrunk_SideTexture',
    },
  },
  birchLeaves: {
    id: BLOCK_IDS.BIRCH_LEAVES,
    name: 'birch_leaves',
    visible: true,
    textureKeys: {
      all: 'birchLeaves_Texture',
    },
    mixColor: 0x77AD5D,
    alphaTest: 0.5,
    transparent: true,
    // 动画配置：风动效果
    animated: true,
    animationType: 'wind',
    animationParams: {},
  },
  // ===== 樱花树（体素方块）=====
  cherryTrunk: {
    id: BLOCK_IDS.CHERRY_TRUNK,
    name: 'cherry_trunk',
    visible: true,
    textureKeys: {
      top: 'cherryTrunk_TopTexture',
      bottom: 'cherryTrunk_TopTexture',
      side: 'cherryTrunk_SideTexture',
    },
  },
  cherryLeaves: {
    id: BLOCK_IDS.CHERRY_LEAVES,
    name: 'cherry_leaves',
    visible: true,
    textureKeys: {
      all: 'cherryLeaves_Texture',
    },
    mixColor: 0xD9B7C8,
    alphaTest: 0.5,
    transparent: true,
    // 动画配置：风动效果
    animated: true,
    animationType: 'wind',
    animationParams: {},
  },
  // ===== 仙人掌（体素方块）=====
  cactus: {
    id: BLOCK_IDS.CACTUS,
    name: 'cactus',
    visible: true,
    textureKeys: {
      top: 'cactusTrunk_TopTexture',
      bottom: 'cactusTrunk_TopTexture',
      side: 'cactusTrunk_SideTexture',
    },
  },
  // ===== 恶地相关（体素方块）=====
  terracotta: {
    id: BLOCK_IDS.TERRACOTTA,
    name: 'terracotta',
    visible: true,
    // 使用黄色陶瓦作为默认纹理，后续可根据需要扩展为随机选择
    textureKeys: {
      all: 'terracotta_yellow',
    },
  },
  redSand: {
    id: BLOCK_IDS.RED_SAND,
    name: 'red_sand',
    visible: true,
    textureKeys: {
      all: 'red_sand',
    },
  },
  // ===== 冻洋相关（体素方块）=====
  ice: {
    id: BLOCK_IDS.ICE,
    name: 'ice',
    visible: true,
    textureKeys: {
      all: 'ice_Texture',
    },
  },
  packedIce: {
    id: BLOCK_IDS.PACKED_ICE,
    name: 'packed_ice',
    visible: true,
    textureKeys: {
      all: 'packedIce_Texture',
    },
  },
  snow: {
    id: BLOCK_IDS.SNOW,
    name: 'snow',
    visible: true,
    textureKeys: {
      all: 'snow',
    },
  },
  // ===== 沙砾（体素方块）=====
  gravel: {
    id: BLOCK_IDS.GRAVEL,
    name: 'gravel',
    visible: true,
    textureKeys: {
      all: 'gravel_Texture',
    },
  },
  // ===== 闪长岩（体素方块）=====
  diorite: {
    id: BLOCK_IDS.DIORITE,
    name: 'diorite',
    visible: true,
    textureKeys: {
      all: 'diorite_Texture',
    },
  },
  polishedDiorite: {
    id: BLOCK_IDS.POLISHED_DIORITE,
    name: 'polished_diorite',
    visible: true,
    textureKeys: {
      all: 'polishedDiorite_Texture',
    },
  },
  // ===== 安山岩（体素方块）=====
  andesite: {
    id: BLOCK_IDS.ANDESITE,
    name: 'andesite',
    visible: true,
    textureKeys: {
      all: 'andesite_Texture',
    },
  },
  polishedAndesite: {
    id: BLOCK_IDS.POLISHED_ANDESITE,
    name: 'polished_andesite',
    visible: true,
    textureKeys: {
      all: 'polishedAndesite_Texture',
    },
  },
  // ===== 黑石（体素方块）=====
  polishedBlackstone: {
    id: BLOCK_IDS.POLISHED_BLACKSTONE,
    name: 'polished_blackstone',
    visible: true,
    textureKeys: {
      all: 'polishedBlackstone_Texture',
    },
  },
  polishedBlackstoneBricks: {
    id: BLOCK_IDS.POLISHED_BLACKSTONE_BRICKS,
    name: 'polished_blackstone_bricks',
    visible: true,
    textureKeys: {
      all: 'polishedBlackstoneBricks_Texture',
    },
  },
  crackedPolishedBlackstoneBricks: {
    id: BLOCK_IDS.CRACKED_POLISHED_BLACKSTONE_BRICKS,
    name: 'cracked_polished_blackstone_bricks',
    visible: true,
    textureKeys: {
      all: 'crackedPolishedBlackstoneBricks_Texture',
    },
  },
  // ===== 蛙明灯（体素方块）=====
  ochreFroglight: {
    id: BLOCK_IDS.OCHRE_FROGLIGHT,
    name: 'ochre_froglight',
    visible: true,
    textureKeys: {
      top: 'ochreFroglight_TopTexture',
      bottom: 'ochreFroglight_TopTexture',
      side: 'ochreFroglight_SideTexture',
    },
  },
  pearlescentFroglight: {
    id: BLOCK_IDS.PEARLESCENT_FROGLIGHT,
    name: 'pearlescent_froglight',
    visible: true,
    textureKeys: {
      top: 'pearlescentFroglight_TopTexture',
      bottom: 'pearlescentFroglight_TopTexture',
      side: 'pearlescentFroglight_SideTexture',
    },
  },
  stoneSlab: {
    id: BLOCK_IDS.STONE_SLAB,
    name: 'stone_slab',
    visible: true,
    textureKeys: {
      all: 'stone',
    },
    geometryType: 'slab_bottom',
  },
  stoneStairs: {
    id: BLOCK_IDS.STONE_STAIRS,
    name: 'stone_stairs',
    visible: true,
    textureKeys: {
      all: 'stone',
    },
    geometryType: 'stair_bottom_north',
  },
}

const DYNAMIC_BLOCK_ID_START = 1000
const dynamicBlockBySignature = new Map()

let blockByIdCache = null
let blockByIdCacheSize = -1

function rebuildBlockByIdCacheIfNeeded() {
  const entries = Object.values(blocks)
  if (blockByIdCache && blockByIdCacheSize === entries.length) {
    return
  }

  blockByIdCache = entries.reduce((map, item) => {
    map[item.id] = item
    return map
  }, {})
  blockByIdCacheSize = entries.length
}

export function getBlockTypeById(id) {
  rebuildBlockByIdCacheIfNeeded()
  return blockByIdCache[id]
}

function normalizeTextureKeys(textureName, textureKeys = null) {
  const normalized = {}

  if (textureKeys && typeof textureKeys === 'object') {
    for (const [key, value] of Object.entries(textureKeys)) {
      const normalizedValue = String(value || '').trim()
      if (normalizedValue) {
        normalized[key] = normalizedValue
      }
    }
  }

  const primaryTexture = String(textureName || '').trim()
  if (!Object.keys(normalized).length && primaryTexture) {
    normalized.all = primaryTexture
  }

  return normalized
}

function pickPrimaryTextureName(textureKeys = {}) {
  return textureKeys.all
    || textureKeys.top
    || textureKeys.side
    || textureKeys.bottom
    || textureKeys.north
    || textureKeys.south
    || textureKeys.east
    || textureKeys.west
    || textureKeys.front
    || textureKeys.back
    || ''
}

function textureKeySignature(textureKeys = {}) {
  return Object.entries(textureKeys)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join('|')
}

export function getBlockSignatureById(id) {
  const blockType = getBlockTypeById(id)
  if (!blockType) {
    return null
  }

  const textureKeys = normalizeTextureKeys('', blockType.textureKeys)
  const textureName = pickPrimaryTextureName(textureKeys)

  return {
    id: Number(blockType.id),
    blockName: blockType.name || textureName || `block_${Number(blockType.id)}`,
    geometryType: blockType.geometryType || 'cube',
    textureName,
    textureKeys,
  }
}

export function ensureDynamicBlockType(textureName, options = {}) {
  const textureKeys = normalizeTextureKeys(textureName, options.textureKeys)
  const primaryTextureName = pickPrimaryTextureName(textureKeys)
  if (!primaryTextureName) {
    return null
  }

  const geometryType = options.geometryType || 'cube'
  const blockName = String(options.blockName || primaryTextureName)
  const signature = `${geometryType}::${blockName}::${textureKeySignature(textureKeys)}`

  if (dynamicBlockBySignature.has(signature)) {
    return dynamicBlockBySignature.get(signature)
  }

  const preferredId = Number(options.preferredId)
  const canUsePreferredId = Number.isFinite(preferredId)
    && preferredId > 0
    && !getBlockTypeById(preferredId)

  const dynamicIndex = dynamicBlockBySignature.size
  const blockType = {
    id: canUsePreferredId ? preferredId : (DYNAMIC_BLOCK_ID_START + dynamicIndex),
    name: blockName,
    visible: true,
    textureKeys,
    geometryType,
  }

  const hintSource = `${blockName} ${Object.values(textureKeys).join(' ')}`.toLowerCase()
  if (hintSource.includes('glass') || hintSource.includes('ice')) {
    blockType.transparent = true
    blockType.opacity = 0.45
    blockType.depthWrite = false
  }
  else if (hintSource.includes('iron_bars') || hintSource.includes('_bars')) {
    blockType.transparent = true
    blockType.alphaTest = 0.5
    blockType.depthWrite = false
  }

  if (hintSource.includes('vine') || hintSource.includes('torch') || hintSource.includes('lever')) {
    blockType.transparent = true
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.depthWrite = false
  }

  if (geometryType === 'plant_cross') {
    blockType.transparent = true
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.depthWrite = false
    blockType.side = THREE.DoubleSide
  }

  if (geometryType === 'potted_plant') {
    blockType.transparent = true
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.depthWrite = false
    blockType.side = THREE.DoubleSide
  }

  if (geometryType === 'fire_cross' || geometryType.startsWith('rail_')) {
    blockType.transparent = true
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.depthWrite = false
  }

  if (geometryType.startsWith('redstone_device_')) {
    blockType.transparent = true
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.depthWrite = false
    blockType.side = THREE.DoubleSide
  }

  if (geometryType.startsWith('wire_') || geometryType === 'tripwire') {
    blockType.transparent = true
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.depthWrite = false
    blockType.side = THREE.DoubleSide
  }

  if (geometryType.startsWith('ladder_')) {
    blockType.transparent = true
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.depthWrite = false
  }

  if (hintSource.includes('leaves')) {
    blockType.mixColor = 0x5E9C45
    blockType.alphaTest = blockType.alphaTest ?? 0.5
    blockType.transparent = true
  }

  if (hintSource.includes('grass_block') || hintSource.includes('grass')) {
    blockType.mixColor = blockType.mixColor ?? 0x7FBF3F
  }

  const key = `dynamicBedrock_${dynamicIndex}`
  blocks[key] = blockType
  dynamicBlockBySignature.set(signature, blockType)

  blockByIdCache = null
  blockByIdCacheSize = -1

  return blockType
}

// 需要通过 3D 噪声生成的矿产列表
export const resources = [
  blocks.stone,
  blocks.coalOre,
  blocks.ironOre,
]

/**
 * 根据方块类型和资源纹理，生成材质（草方块返回 6 面材质数组）
 * @param {object} blockType 方块配置
 * @param {Record<string, THREE.Texture>} textureItems 资源管理器加载的纹理
 * @returns {THREE.Material|THREE.Material[]|null} 生成的材质（或材质数组），缺失纹理时返回 null
 */
export function createMaterials(blockType, textureItems) {
  if (blockType.id === blocks.empty.id)
    return null

  const getOrCreateMissingTexture = () => {
    if (textureItems.__missing_block_texture) {
      return textureItems.__missing_block_texture
    }

    let texture = null
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const context = canvas.getContext('2d')

      if (context) {
        context.fillStyle = '#ff00ff'
        context.fillRect(0, 0, 16, 16)
        context.fillStyle = '#111111'
        context.fillRect(0, 0, 8, 8)
        context.fillRect(8, 8, 8, 8)
      }

      texture = new THREE.CanvasTexture(canvas)
    }
    else {
      const pixels = new Uint8Array([
        255,
        0,
        255,
        255,
        17,
        17,
        17,
        255,
        17,
        17,
        17,
        255,
        255,
        0,
        255,
        255,
      ])
      texture = new THREE.DataTexture(pixels, 2, 2)
      texture.needsUpdate = true
    }

    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    textureItems.__missing_block_texture = texture
    return texture
  }

  const ensureTexture = (key) => {
    const atlasResolvedKey = resolveAtlasVirtualTextureKey(key)
    const tex = requestAtlasTexture(atlasResolvedKey || key) || textureItems[key] || getOrCreateMissingTexture()
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  /**
   * 构建动画材质的 uniforms 和着色器
   * @param {object} blockType 方块配置
   * @returns {{ uniforms: object, vertexShader: string } | null} 动画配置对象，无动画时返回 null
   */
  const buildAnimationConfig = (blockType) => {
    if (!blockType.animated || !blockType.animationType)
      return null

    const animationType = blockType.animationType
    const shaderCode = ANIMATION_SHADERS[animationType]

    if (!shaderCode) {
      console.warn(`Unknown animation type: ${animationType}`)
      return null
    }

    // 合并默认参数和自定义参数
    const defaults = ANIMATION_DEFAULTS[animationType] || {}
    const params = { ...defaults, ...blockType.animationParams }

    // 构建 uniforms 对象
    const uniforms = {
      uTime: { value: 0 },
    }

    // 根据动画类型添加特定 uniforms
    if (animationType === 'wind') {
      uniforms.uWindSpeed = { value: params.windSpeed }
      uniforms.uSwayAmplitude = { value: params.swayAmplitude }
      uniforms.uPhaseScale = { value: params.phaseScale }
    }
    // 预留其他动画类型的 uniforms 配置
    // else if (animationType === 'pulse') { ... }

    return {
      uniforms,
      vertexShader: shaderCode,
    }
  }

  // 使用 custom shader 包装的标准材质，便于后续扩展
  const makeCustomMaterial = (tex, options = {}) => {
    // 获取动画配置（如果有）
    const animConfig = buildAnimationConfig(blockType)

    // 基础材质配置
    const materialConfig = {
      baseMaterial: THREE.MeshPhongMaterial,
      map: tex,
      flatShading: true,
      // 合并额外的材质参数，如 alphaTest, transparent 等
      ...options,
    }

    // 始终注入 AO 着色器（非透明方块）
    // 透明方块（如树叶）不使用 AO，避免视觉问题
    const useAO = !blockType.transparent

    if (useAO) {
      // 合并 AO 顶点着色器
      let vertexShader = aoVertexShader

      // 如果同时有动画，需要合并着色器
      if (animConfig) {
        // 动画材质：AO + 动画
        // TODO: 合并两个顶点着色器（当前先使用动画着色器，后续迭代）
        vertexShader = animConfig.vertexShader
        materialConfig.uniforms = animConfig.uniforms
      }

      materialConfig.vertexShader = vertexShader
      materialConfig.fragmentShader = aoFragmentShader
    }
    else if (animConfig) {
      // 仅动画（透明方块如树叶）
      materialConfig.uniforms = animConfig.uniforms
      materialConfig.vertexShader = animConfig.vertexShader
    }

    const material = new CustomShaderMaterial(materialConfig)

    // 标记是否为动画材质，供渲染器追踪
    material._isAnimated = !!animConfig
    material._animationType = blockType.animationType || null

    return material
  }

  // 提取通用的材质参数
  const materialOptions = {}
  if (blockType.alphaTest !== undefined)
    materialOptions.alphaTest = blockType.alphaTest
  if (blockType.transparent !== undefined)
    materialOptions.transparent = blockType.transparent
  if (blockType.mixColor !== undefined)
    materialOptions.color = new THREE.Color(blockType.mixColor)
  if (blockType.opacity !== undefined)
    materialOptions.opacity = blockType.opacity
  if (blockType.depthWrite !== undefined)
    materialOptions.depthWrite = blockType.depthWrite
  if (blockType.side !== undefined)
    materialOptions.side = blockType.side

  // 六面贴图方块：草/树干（右、左、上、下、前、后）
  if (blockType.textureKeys?.side && blockType.textureKeys?.top && blockType.textureKeys?.bottom) {
    const side = ensureTexture(blockType.textureKeys.side)
    const top = ensureTexture(blockType.textureKeys.top)
    const bottom = ensureTexture(blockType.textureKeys.bottom)
    if (!side || !top || !bottom)
      return null

    return [
      makeCustomMaterial(side, materialOptions), // right
      makeCustomMaterial(side, materialOptions), // left
      makeCustomMaterial(top, materialOptions), // top
      makeCustomMaterial(bottom, materialOptions), // bottom
      makeCustomMaterial(side, materialOptions), // front
      makeCustomMaterial(side, materialOptions), // back
    ]
  }

  // 其余方块：单一材质
  const mainTexture = ensureTexture(blockType.textureKeys.all)
  if (!mainTexture)
    return null
  return makeCustomMaterial(mainTexture, materialOptions)
}

/**
 * 共享几何体，避免重复创建
 */
export const sharedGeometry = new THREE.BoxGeometry(1, 1, 1)

function mergeToSingleGeometry(geometries = []) {
  const positions = []
  const normals = []
  const uvs = []

  geometries.forEach((geometry) => {
    const nonIndexed = geometry.toNonIndexed()
    const position = nonIndexed.getAttribute('position')
    const normal = nonIndexed.getAttribute('normal')
    const uv = nonIndexed.getAttribute('uv')

    if (position) {
      positions.push(...position.array)
    }
    if (normal) {
      normals.push(...normal.array)
    }
    if (uv) {
      uvs.push(...uv.array)
    }

    nonIndexed.dispose()
  })

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2))
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

const slabBottomGeometry = (() => {
  const geometry = new THREE.BoxGeometry(1, 0.5, 1)
  geometry.translate(0, -0.25, 0)
  return geometry
})()

const slabTopGeometry = (() => {
  const geometry = new THREE.BoxGeometry(1, 0.5, 1)
  geometry.translate(0, 0.25, 0)
  return geometry
})()

function createStairGeometry({ half = 'bottom', facing = 'north', shape = 'straight' } = {}) {
  const isTop = half === 'top'
  const lower = new THREE.BoxGeometry(1, 0.5, 1)
  lower.translate(0, isTop ? 0.25 : -0.25, 0)

  const topY = isTop ? -0.25 : 0.25
  const topPieces = []
  const normalizedShape = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'].includes(shape)
    ? shape
    : 'straight'

  const addNorthHalf = () => {
    const g = new THREE.BoxGeometry(1, 0.5, 0.5)
    g.translate(0, topY, -0.25)
    topPieces.push(g)
  }
  const addWestHalf = () => {
    const g = new THREE.BoxGeometry(0.5, 0.5, 1)
    g.translate(-0.25, topY, 0)
    topPieces.push(g)
  }
  const addEastHalf = () => {
    const g = new THREE.BoxGeometry(0.5, 0.5, 1)
    g.translate(0.25, topY, 0)
    topPieces.push(g)
  }
  const addNorthWestQuarter = () => {
    const g = new THREE.BoxGeometry(0.5, 0.5, 0.5)
    g.translate(-0.25, topY, -0.25)
    topPieces.push(g)
  }
  const addNorthEastQuarter = () => {
    const g = new THREE.BoxGeometry(0.5, 0.5, 0.5)
    g.translate(0.25, topY, -0.25)
    topPieces.push(g)
  }

  if (normalizedShape === 'inner_left') {
    addNorthHalf()
    addEastHalf()
  }
  else if (normalizedShape === 'inner_right') {
    addNorthHalf()
    addWestHalf()
  }
  else if (normalizedShape === 'outer_left') {
    addNorthEastQuarter()
  }
  else if (normalizedShape === 'outer_right') {
    addNorthWestQuarter()
  }
  else {
    addNorthHalf()
  }

  const merged = mergeToSingleGeometry([lower, ...topPieces])

  const rotationY = {
    north: 0,
    east: Math.PI / 2,
    south: Math.PI,
    west: -Math.PI / 2,
  }[facing] ?? 0

  if (rotationY !== 0) {
    merged.rotateY(rotationY)
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
  }

  lower.dispose()
  topPieces.forEach(piece => piece.dispose())
  return merged
}

const stairGeometries = {
}

const fenceGeometryCache = new Map()
;['bottom', 'top'].forEach((half) => {
  ;['north', 'south', 'east', 'west'].forEach((facing) => {
    ;['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'].forEach((shape) => {
      const key = `stair_${half}_${facing}_${shape}`
      stairGeometries[key] = createStairGeometry({ half, facing, shape })
      if (shape === 'straight') {
        stairGeometries[`stair_${half}_${facing}`] = stairGeometries[key]
      }
    })
  })
})

const trapdoorGeometryCache = new Map()
const barsGeometryCache = new Map()
const wallGeometryCache = new Map()
const lanternGeometryCache = new Map()
const doorGeometryCache = new Map()
const torchGeometryCache = new Map()
const vineGeometryCache = new Map()
const redstoneDeviceGeometryCache = new Map()
const leverGeometryCache = new Map()
const hopperGeometryCache = new Map()
const buttonGeometryCache = new Map()
const ladderGeometryCache = new Map()
const signGeometryCache = new Map()
const hangingSignGeometryCache = new Map()
const bannerGeometryCache = new Map()
const chainGeometryCache = new Map()
const rodGeometryCache = new Map()
const candleGeometryCache = new Map()
const wireGeometryCache = new Map()
const tripwireHookGeometryCache = new Map()
const cocoaGeometryCache = new Map()
const amethystBudGeometryCache = new Map()
const fenceGateGeometryCache = new Map()

const carpetGeometry = (() => {
  const geometry = new THREE.BoxGeometry(1, 0.0625, 1)
  geometry.translate(0, -0.46875, 0)
  return geometry
})()

const pressurePlateGeometry = (() => {
  const geometry = new THREE.BoxGeometry(0.875, 0.0625, 0.875)
  geometry.translate(0, -0.46875, 0)
  return geometry
})()

function horizontalRotationForFacing(facing = 'north') {
  return {
    north: 0,
    east: Math.PI / 2,
    south: Math.PI,
    west: -Math.PI / 2,
  }[facing] ?? 0
}

function rotateGeometryToFacing(geometry, facing = 'north') {
  const rotationY = horizontalRotationForFacing(facing)
  if (rotationY !== 0) {
    geometry.rotateY(rotationY)
  }
  return geometry
}

function translateWallMountedGeometry(geometry, facing = 'north', offset = 0.4375) {
  if (facing === 'north') {
    geometry.translate(0, 0, -offset)
  }
  else if (facing === 'south') {
    geometry.translate(0, 0, offset)
  }
  else if (facing === 'east') {
    geometry.translate(offset, 0, 0)
  }
  else {
    geometry.translate(-offset, 0, 0)
  }
  return geometry
}

function rotateGeometryToAxis(geometry, axis = 'y') {
  if (axis === 'x') {
    geometry.rotateZ(Math.PI / 2)
  }
  else if (axis === 'z') {
    geometry.rotateX(Math.PI / 2)
  }
  return geometry
}

function createRedstoneDeviceGeometry(facing = 'north') {
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)

  const rotationY = {
    north: 0,
    east: Math.PI / 2,
    south: Math.PI,
    west: -Math.PI / 2,
  }[facing] ?? 0

  if (rotationY !== 0) {
    geometry.rotateY(rotationY)
  }

  geometry.translate(0, -0.498, 0)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createTrapdoorGeometry({ half = 'bottom', facing = 'north', open = false } = {}) {
  const thickness = 0.1875

  if (!open) {
    const geometry = new THREE.BoxGeometry(1, thickness, 1)
    const y = half === 'top'
      ? (0.5 - thickness / 2)
      : (-0.5 + thickness / 2)
    geometry.translate(0, y, 0)
    return geometry
  }

  if (facing === 'east' || facing === 'west') {
    const geometry = new THREE.BoxGeometry(thickness, 1, 1)
    const x = facing === 'east'
      ? (0.5 - thickness / 2)
      : (-0.5 + thickness / 2)
    geometry.translate(x, 0, 0)
    return geometry
  }

  const geometry = new THREE.BoxGeometry(1, 1, thickness)
  const z = facing === 'south'
    ? (-0.5 + thickness / 2)
    : (0.5 - thickness / 2)
  geometry.translate(0, 0, z)
  return geometry
}

function createIronBarsGeometry({ north = false, east = false, south = false, west = false } = {}) {
  const pieces = []
  const postThickness = 0.125
  const armThickness = 0.125

  pieces.push(new THREE.BoxGeometry(postThickness, 1, postThickness))

  if (north) {
    const g = new THREE.BoxGeometry(armThickness, 1, 0.5)
    g.translate(0, 0, -0.25)
    pieces.push(g)
  }
  if (south) {
    const g = new THREE.BoxGeometry(armThickness, 1, 0.5)
    g.translate(0, 0, 0.25)
    pieces.push(g)
  }
  if (east) {
    const g = new THREE.BoxGeometry(0.5, 1, armThickness)
    g.translate(0.25, 0, 0)
    pieces.push(g)
  }
  if (west) {
    const g = new THREE.BoxGeometry(0.5, 1, armThickness)
    g.translate(-0.25, 0, 0)
    pieces.push(g)
  }

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createFenceGeometry({ north = false, east = false, south = false, west = false } = {}) {
  const pieces = []
  const postWidth = 0.25
  const railWidth = 0.125
  const railLength = 0.5
  const upperRailY = 0.2
  const lowerRailY = -0.15

  pieces.push(new THREE.BoxGeometry(postWidth, 1, postWidth))

  const addNorthSouthRails = (dir) => {
    const z = dir === 'north' ? -0.25 : 0.25
    const topRail = new THREE.BoxGeometry(railWidth, railWidth, railLength)
    topRail.translate(0, upperRailY, z)
    pieces.push(topRail)

    const bottomRail = new THREE.BoxGeometry(railWidth, railWidth, railLength)
    bottomRail.translate(0, lowerRailY, z)
    pieces.push(bottomRail)
  }

  const addEastWestRails = (dir) => {
    const x = dir === 'west' ? -0.25 : 0.25
    const topRail = new THREE.BoxGeometry(railLength, railWidth, railWidth)
    topRail.translate(x, upperRailY, 0)
    pieces.push(topRail)

    const bottomRail = new THREE.BoxGeometry(railLength, railWidth, railWidth)
    bottomRail.translate(x, lowerRailY, 0)
    pieces.push(bottomRail)
  }

  if (north) {
    addNorthSouthRails('north')
  }
  if (south) {
    addNorthSouthRails('south')
  }
  if (east) {
    addEastWestRails('east')
  }
  if (west) {
    addEastWestRails('west')
  }

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createWallGeometry({ up = true, north = 0, east = 0, south = 0, west = 0 } = {}) {
  const pieces = []
  const postWidth = 0.5

  const sideValues = [north, east, south, west]
  const hasSide = sideValues.some(value => value > 0)
  if (up || !hasSide) {
    const postHeight = up ? 1 : 0.75
    const post = new THREE.BoxGeometry(postWidth, postHeight, postWidth)
    if (!up) {
      post.translate(0, -0.125, 0)
    }
    pieces.push(post)
  }

  const addArmZ = (dir, level) => {
    if (level <= 0) {
      return
    }
    const height = level === 2 ? 1 : 0.8125
    const y = level === 2 ? 0 : -0.09375
    const arm = new THREE.BoxGeometry(0.25, height, 0.5)
    arm.translate(0, y, dir === 'north' ? -0.25 : 0.25)
    pieces.push(arm)
  }

  const addArmX = (dir, level) => {
    if (level <= 0) {
      return
    }
    const height = level === 2 ? 1 : 0.8125
    const y = level === 2 ? 0 : -0.09375
    const arm = new THREE.BoxGeometry(0.5, height, 0.25)
    arm.translate(dir === 'west' ? -0.25 : 0.25, y, 0)
    pieces.push(arm)
  }

  addArmZ('north', north)
  addArmX('east', east)
  addArmZ('south', south)
  addArmX('west', west)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createLanternGeometry({ hanging = false } = {}) {
  const pieces = []

  const body = new THREE.BoxGeometry(0.5, 0.5, 0.5)
  body.translate(0, -0.125, 0)
  pieces.push(body)

  const topCap = new THREE.BoxGeometry(0.375, 0.125, 0.375)
  topCap.translate(0, 0.1875, 0)
  pieces.push(topCap)

  const stem = new THREE.BoxGeometry(0.125, hanging ? 0.3125 : 0.25, 0.125)
  stem.translate(0, hanging ? 0.34375 : 0.3125, 0)
  pieces.push(stem)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createDoorGeometry({ facing = 'north', open = false, hinge = 'left' } = {}) {
  const thickness = 0.1875
  const facingNormalized = ['north', 'south', 'east', 'west'].includes(facing) ? facing : 'north'
  const hingeNormalized = hinge === 'right' ? 'right' : 'left'

  let orientation = facingNormalized
  if (open) {
    const rotateLeft = {
      north: 'west',
      west: 'south',
      south: 'east',
      east: 'north',
    }
    const rotateRight = {
      north: 'east',
      east: 'south',
      south: 'west',
      west: 'north',
    }
    orientation = hingeNormalized === 'right'
      ? rotateRight[facingNormalized]
      : rotateLeft[facingNormalized]
  }

  if (orientation === 'east' || orientation === 'west') {
    const geometry = new THREE.BoxGeometry(thickness, 1, 1)
    const x = orientation === 'east'
      ? (0.5 - thickness / 2)
      : (-0.5 + thickness / 2)
    geometry.translate(x, 0, 0)
    return geometry
  }

  const geometry = new THREE.BoxGeometry(1, 1, thickness)
  const z = orientation === 'south'
    ? (0.5 - thickness / 2)
    : (-0.5 + thickness / 2)
  geometry.translate(0, 0, z)
  return geometry
}

function createTorchGeometry({ wall = false, facing = 'north' } = {}) {
  const pieces = []

  const stem = new THREE.BoxGeometry(0.125, 0.625, 0.125)
  const tip = new THREE.BoxGeometry(0.25, 0.25, 0.25)

  if (!wall) {
    stem.translate(0, -0.1875, 0)
    tip.translate(0, 0.25, 0)
    pieces.push(stem, tip)
  }
  else {
    const validFacing = ['north', 'south', 'east', 'west'].includes(facing) ? facing : 'north'
    const facingOffset = 0.34375

    if (validFacing === 'north') {
      stem.translate(0, -0.0625, -facingOffset)
      tip.translate(0, 0.28125, -0.1875)
    }
    else if (validFacing === 'south') {
      stem.translate(0, -0.0625, facingOffset)
      tip.translate(0, 0.28125, 0.1875)
    }
    else if (validFacing === 'east') {
      stem.translate(facingOffset, -0.0625, 0)
      tip.translate(0.1875, 0.28125, 0)
    }
    else {
      stem.translate(-facingOffset, -0.0625, 0)
      tip.translate(-0.1875, 0.28125, 0)
    }

    pieces.push(stem, tip)
  }

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createLeverGeometry({ face = 'wall', facing = 'north', powered = false } = {}) {
  const pieces = []
  const base = new THREE.BoxGeometry(0.375, 0.125, 0.25)
  base.translate(0, -0.4375, 0)
  pieces.push(base)

  const handle = new THREE.BoxGeometry(0.125, 0.625, 0.125)
  handle.rotateX(powered ? (Math.PI / 5) : (-Math.PI / 5))
  handle.translate(0, -0.15625, 0)
  pieces.push(handle)

  const geometry = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())

  if (face === 'ceiling') {
    geometry.rotateX(Math.PI)
  }
  else if (face === 'wall') {
    const wallRotation = {
      north: { axis: 'x', angle: Math.PI / 2 },
      south: { axis: 'x', angle: -Math.PI / 2 },
      east: { axis: 'z', angle: Math.PI / 2 },
      west: { axis: 'z', angle: -Math.PI / 2 },
    }[facing] || { axis: 'x', angle: Math.PI / 2 }

    if (wallRotation.axis === 'x') {
      geometry.rotateX(wallRotation.angle)
    }
    else {
      geometry.rotateZ(wallRotation.angle)
    }
  }
  else {
    const rotationY = {
      north: 0,
      east: Math.PI / 2,
      south: Math.PI,
      west: -Math.PI / 2,
    }[facing] ?? 0

    if (rotationY !== 0) {
      geometry.rotateY(rotationY)
    }
  }

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createButtonGeometry({ face = 'wall', facing = 'north', powered = false } = {}) {
  const depth = powered ? 0.0625 : 0.125

  if (face === 'wall') {
    const geometry = new THREE.BoxGeometry(0.375, 0.125, depth)
    geometry.translate(0, 0, -0.5 + depth / 2)
    rotateGeometryToFacing(geometry, facing)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }

  const geometry = new THREE.BoxGeometry(0.375, depth, 0.25)
  const y = face === 'ceiling'
    ? (0.5 - depth / 2)
    : (-0.5 + depth / 2)
  geometry.translate(0, y, 0)
  rotateGeometryToFacing(geometry, facing)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createLadderGeometry(facing = 'north') {
  const geometry = new THREE.BoxGeometry(1, 1, 0.0625)
  geometry.translate(0, 0, -0.46875)
  rotateGeometryToFacing(geometry, facing)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function standingRotationToRadians(rotation = 0) {
  return Math.PI + (rotation * Math.PI / 8)
}

function createStandingSignGeometry(rotation = 0) {
  const pieces = []
  const board = new THREE.BoxGeometry(0.875, 0.625, 0.125)
  board.translate(0, 0.0625, 0)
  pieces.push(board)

  const post = new THREE.BoxGeometry(0.125, 0.5, 0.125)
  post.translate(0, -0.25, 0)
  pieces.push(post)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  merged.rotateY(standingRotationToRadians(rotation))
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createWallSignGeometry(facing = 'north') {
  const geometry = new THREE.BoxGeometry(0.875, 0.625, 0.125)
  geometry.translate(0, 0.0625, -0.4375)
  rotateGeometryToFacing(geometry, facing)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createStandingHangingSignGeometry(rotation = 0) {
  const pieces = []
  const board = new THREE.BoxGeometry(1, 0.625, 0.125)
  board.translate(0, -0.03125, 0)
  pieces.push(board)

  const beam = new THREE.BoxGeometry(1.125, 0.125, 0.25)
  beam.translate(0, 0.34375, 0)
  pieces.push(beam)

  for (const x of [-0.3125, 0.3125]) {
    const hanger = new THREE.BoxGeometry(0.0625, 0.25, 0.0625)
    hanger.translate(x, 0.1875, 0)
    pieces.push(hanger)
  }

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  merged.rotateY(standingRotationToRadians(rotation))
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createWallHangingSignGeometry(facing = 'north') {
  const pieces = []
  const board = new THREE.BoxGeometry(1, 0.625, 0.125)
  board.translate(0, -0.03125, 0)
  pieces.push(board)

  const beam = new THREE.BoxGeometry(1.125, 0.125, 0.25)
  beam.translate(0, 0.34375, 0)
  pieces.push(beam)

  for (const x of [-0.3125, 0.3125]) {
    const hanger = new THREE.BoxGeometry(0.0625, 0.25, 0.0625)
    hanger.translate(x, 0.1875, 0)
    pieces.push(hanger)
  }

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  translateWallMountedGeometry(merged, 'north', 0.40625)
  rotateGeometryToFacing(merged, facing)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createStandingBannerGeometry(rotation = 0) {
  const pieces = []
  const cloth = new THREE.BoxGeometry(0.75, 0.875, 0.0625)
  cloth.translate(0, -0.03125, 0)
  pieces.push(cloth)

  const post = new THREE.BoxGeometry(0.125, 1, 0.125)
  post.translate(0, 0, 0)
  pieces.push(post)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  merged.rotateY(standingRotationToRadians(rotation))
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createWallBannerGeometry(facing = 'north') {
  const geometry = new THREE.BoxGeometry(0.75, 0.875, 0.0625)
  geometry.translate(0, -0.03125, -0.46875)
  rotateGeometryToFacing(geometry, facing)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createChainGeometry(axis = 'y') {
  const geometry = new THREE.BoxGeometry(0.125, 1, 0.125)
  rotateGeometryToAxis(geometry, axis)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createRodGeometry(facing = 'up') {
  const geometry = new THREE.BoxGeometry(0.1875, 1, 0.1875)

  if (facing === 'north' || facing === 'south') {
    geometry.rotateX(Math.PI / 2)
  }
  else if (facing === 'east' || facing === 'west') {
    geometry.rotateZ(Math.PI / 2)
  }

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createCandleGeometry(count = 1) {
  const pieces = []
  const normalizedCount = Math.max(1, Math.min(4, count))
  const positions = {
    1: [[0, 0]],
    2: [[-0.125, 0], [0.125, 0]],
    3: [[0, -0.125], [-0.15625, 0.125], [0.15625, 0.125]],
    4: [[-0.15625, -0.15625], [0.15625, -0.15625], [-0.15625, 0.15625], [0.15625, 0.15625]],
  }[normalizedCount]

  positions.forEach(([x, z], index) => {
    const height = 0.375 + ((index % 2) * 0.0625)
    const candle = new THREE.BoxGeometry(0.125, height, 0.125)
    candle.translate(x, -0.5 + height / 2, z)
    pieces.push(candle)
  })

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createWireGeometry({ north = false, east = false, south = false, west = false } = {}) {
  const planes = []
  const y = -0.498

  const center = new THREE.PlaneGeometry(0.375, 0.375)
  center.rotateX(-Math.PI / 2)
  center.translate(0, y, 0)
  planes.push(center)

  const addArm = (width, height, x, z) => {
    const arm = new THREE.PlaneGeometry(width, height)
    arm.rotateX(-Math.PI / 2)
    arm.translate(x, y, z)
    planes.push(arm)
  }

  if (north) {
    addArm(0.25, 0.5, 0, -0.25)
  }
  if (south) {
    addArm(0.25, 0.5, 0, 0.25)
  }
  if (east) {
    addArm(0.5, 0.25, 0.25, 0)
  }
  if (west) {
    addArm(0.5, 0.25, -0.25, 0)
  }

  const merged = mergeToSingleGeometry(planes)
  planes.forEach(plane => plane.dispose())
  return merged
}

function createTripwireGeometry() {
  const planes = []
  const y = -0.498

  const lineX = new THREE.PlaneGeometry(1, 0.0625)
  lineX.rotateX(-Math.PI / 2)
  lineX.translate(0, y, 0)
  planes.push(lineX)

  const lineZ = new THREE.PlaneGeometry(0.0625, 1)
  lineZ.rotateX(-Math.PI / 2)
  lineZ.translate(0, y, 0)
  planes.push(lineZ)

  const merged = mergeToSingleGeometry(planes)
  planes.forEach(plane => plane.dispose())
  return merged
}

function createTripwireHookGeometry({ facing = 'north', powered = false } = {}) {
  const pieces = []
  const base = new THREE.BoxGeometry(0.25, 0.375, 0.125)
  base.translate(0, 0, -0.4375)
  pieces.push(base)

  const arm = new THREE.BoxGeometry(0.0625, 0.1875, powered ? 0.3125 : 0.25)
  arm.rotateX(powered ? -0.35 : -0.65)
  arm.translate(0, 0.0625, -0.25)
  pieces.push(arm)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  rotateGeometryToFacing(merged, facing)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createCocoaGeometry({ age = 0, facing = 'north' } = {}) {
  const sizes = [
    { width: 0.25, height: 0.3125, depth: 0.25 },
    { width: 0.375, height: 0.4375, depth: 0.375 },
    { width: 0.5, height: 0.5625, depth: 0.5 },
  ]
  const size = sizes[Math.max(0, Math.min(2, age))]
  const pieces = []

  const fruit = new THREE.BoxGeometry(size.width, size.height, size.depth)
  fruit.translate(0, -0.125 + size.height / 4, -0.5 + size.depth / 2)
  pieces.push(fruit)

  const stem = new THREE.BoxGeometry(0.0625, 0.125, 0.125)
  stem.translate(0, 0.0625, -0.4375)
  pieces.push(stem)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  rotateGeometryToFacing(merged, facing)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createAmethystBudGeometry({ size = 'cluster', facing = 'up' } = {}) {
  const sizeMap = {
    small: { stem: 0.125, width: 0.25, height: 0.25 },
    medium: { stem: 0.125, width: 0.3125, height: 0.375 },
    large: { stem: 0.125, width: 0.375, height: 0.5 },
    cluster: { stem: 0.1875, width: 0.5, height: 0.625 },
  }
  const config = sizeMap[size] || sizeMap.cluster
  const pieces = []

  const stem = new THREE.BoxGeometry(config.stem, 0.1875, config.stem)
  stem.translate(0, -0.40625, 0)
  pieces.push(stem)

  const crystal = new THREE.BoxGeometry(config.width, config.height, config.width)
  crystal.translate(0, -0.5 + 0.1875 + config.height / 2, 0)
  pieces.push(crystal)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())

  if (facing === 'down') {
    merged.rotateX(Math.PI)
  }
  else if (facing === 'north') {
    merged.rotateX(-Math.PI / 2)
  }
  else if (facing === 'south') {
    merged.rotateX(Math.PI / 2)
  }
  else if (facing === 'east') {
    merged.rotateZ(-Math.PI / 2)
  }
  else if (facing === 'west') {
    merged.rotateZ(Math.PI / 2)
  }

  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createFenceGateGeometry({ facing = 'north', open = false, inWall = false } = {}) {
  const pieces = []
  const postHeight = inWall ? 0.8125 : 1
  const postY = inWall ? -0.09375 : 0

  for (const x of [-0.375, 0.375]) {
    const post = new THREE.BoxGeometry(0.25, postHeight, 0.25)
    post.translate(x, postY, 0)
    pieces.push(post)
  }

  if (open) {
    for (const x of [-0.25, 0.25]) {
      const leaf = new THREE.BoxGeometry(0.125, 0.75, 0.75)
      leaf.translate(x === -0.25 ? -0.3125 : 0.3125, -0.0625, 0)
      pieces.push(leaf)
    }
  }
  else {
    for (const y of [0.1875, -0.1875]) {
      const bar = new THREE.BoxGeometry(0.75, 0.125, 0.125)
      bar.translate(0, y, 0)
      pieces.push(bar)
    }
  }

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  rotateGeometryToFacing(merged, facing)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function createCampfireGeometry() {
  const pieces = []

  const logA = new THREE.BoxGeometry(1, 0.25, 0.25)
  logA.translate(0, -0.375, 0)
  pieces.push(logA)

  const logB = new THREE.BoxGeometry(0.25, 0.25, 1)
  logB.translate(0, -0.375, 0)
  pieces.push(logB)

  const center = new THREE.BoxGeometry(0.5, 0.125, 0.5)
  center.translate(0, -0.1875, 0)
  pieces.push(center)

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createHopperGeometry({ facing = 'down' } = {}) {
  const pieces = []

  const rim = new THREE.BoxGeometry(1, 0.125, 1)
  rim.translate(0, 0.1875, 0)
  pieces.push(rim)

  const body = new THREE.BoxGeometry(0.875, 0.5, 0.875)
  body.translate(0, -0.125, 0)
  pieces.push(body)

  let spout = null
  if (facing === 'down') {
    spout = new THREE.BoxGeometry(0.375, 0.25, 0.375)
    spout.translate(0, -0.375, 0)
  }
  else if (facing === 'north' || facing === 'south') {
    spout = new THREE.BoxGeometry(0.375, 0.25, 0.5)
    spout.translate(0, -0.3125, facing === 'north' ? -0.25 : 0.25)
  }
  else {
    spout = new THREE.BoxGeometry(0.5, 0.25, 0.375)
    spout.translate(facing === 'east' ? 0.25 : -0.25, -0.3125, 0)
  }

  if (spout) {
    pieces.push(spout)
  }

  const merged = mergeToSingleGeometry(pieces)
  pieces.forEach(piece => piece.dispose())
  return merged
}

function createVineGeometry({ up = false, north = false, east = false, south = false, west = false } = {}) {
  const planes = []
  const offset = 0.499

  if (north) {
    const g = new THREE.PlaneGeometry(1, 1)
    g.translate(0, 0, -offset)
    planes.push(g)
  }
  if (south) {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateY(Math.PI)
    g.translate(0, 0, offset)
    planes.push(g)
  }
  if (east) {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateY(Math.PI / 2)
    g.translate(offset, 0, 0)
    planes.push(g)
  }
  if (west) {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateY(-Math.PI / 2)
    g.translate(-offset, 0, 0)
    planes.push(g)
  }
  if (up) {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    g.translate(0, offset, 0)
    planes.push(g)
  }

  if (planes.length === 0) {
    const fallback = new THREE.PlaneGeometry(1, 1)
    fallback.translate(0, 0, -offset)
    planes.push(fallback)
  }

  const merged = mergeToSingleGeometry(planes)
  planes.forEach(plane => plane.dispose())
  return merged
}

function createRailGeometry(shape = 'north_south') {
  const thickness = 0.0625
  const normalized = String(shape || 'north_south')

  if (normalized.startsWith('ascending_')) {
    const geometry = new THREE.BoxGeometry(1, thickness, Math.SQRT2)
    const direction = normalized.replace('ascending_', '')

    let rotationX = 0
    let rotationY = 0

    if (direction === 'north') {
      rotationX = Math.PI / 4
      rotationY = 0
    }
    else if (direction === 'south') {
      rotationX = -Math.PI / 4
      rotationY = 0
    }
    else if (direction === 'east') {
      rotationX = -Math.PI / 4
      rotationY = Math.PI / 2
    }
    else if (direction === 'west') {
      rotationX = Math.PI / 4
      rotationY = Math.PI / 2
    }

    if (rotationY !== 0) {
      geometry.rotateY(rotationY)
    }
    if (rotationX !== 0) {
      geometry.rotateX(rotationX)
    }

    geometry.translate(0, -0.46875, 0)
    return geometry
  }

  const geometry = new THREE.BoxGeometry(1, thickness, 1)
  geometry.translate(0, -0.46875, 0)
  return geometry
}

function createFireGeometry() {
  const planes = []

  const planeA = new THREE.PlaneGeometry(1, 1)
  planeA.rotateY(Math.PI / 4)
  planes.push(planeA)

  const planeB = new THREE.PlaneGeometry(1, 1)
  planeB.rotateY(-Math.PI / 4)
  planes.push(planeB)

  const merged = mergeToSingleGeometry(planes)
  planes.forEach(plane => plane.dispose())
  return merged
}

const flowerPotGeometry = (() => {
  const geometry = new THREE.BoxGeometry(0.625, 0.375, 0.625)
  geometry.translate(0, -0.3125, 0)
  return geometry
})()

const plantCrossGeometry = (() => {
  const planes = []

  const planeA = new THREE.PlaneGeometry(1, 1)
  planeA.rotateY(Math.PI / 4)
  planes.push(planeA)

  const planeB = new THREE.PlaneGeometry(1, 1)
  planeB.rotateY(-Math.PI / 4)
  planes.push(planeB)

  const merged = mergeToSingleGeometry(planes)
  planes.forEach(plane => plane.dispose())
  return merged
})()

const pottedPlantGeometry = (() => {
  const parts = []

  const pot = new THREE.BoxGeometry(0.625, 0.375, 0.625)
  pot.translate(0, -0.3125, 0)
  parts.push(pot)

  const plantA = new THREE.PlaneGeometry(0.75, 0.75)
  plantA.rotateY(Math.PI / 4)
  plantA.translate(0, 0.25, 0)
  parts.push(plantA)

  const plantB = new THREE.PlaneGeometry(0.75, 0.75)
  plantB.rotateY(-Math.PI / 4)
  plantB.translate(0, 0.25, 0)
  parts.push(plantB)

  const merged = mergeToSingleGeometry(parts)
  parts.forEach(part => part.dispose())
  return merged
})()

const fireGeometry = createFireGeometry()
const tripwireGeometry = createTripwireGeometry()
const campfireGeometry = createCampfireGeometry()
const railGeometryCache = new Map()

export function getGeometryForBlockType(blockType) {
  const geometryType = blockType?.geometryType || 'cube'
  if (geometryType === 'fire_cross') {
    return fireGeometry
  }
  if (geometryType === 'flower_pot') {
    return flowerPotGeometry
  }
  if (geometryType === 'potted_plant') {
    return pottedPlantGeometry
  }
  if (geometryType === 'plant_cross') {
    return plantCrossGeometry
  }
  const railMatch = geometryType.match(/^rail_(north_south|east_west|ascending_north|ascending_south|ascending_east|ascending_west|north_east|north_west|south_east|south_west)$/u)
  if (railMatch) {
    if (!railGeometryCache.has(geometryType)) {
      railGeometryCache.set(geometryType, createRailGeometry(railMatch[1]))
    }
    return railGeometryCache.get(geometryType)
  }
  if (geometryType === 'carpet') {
    return carpetGeometry
  }
  if (geometryType === 'pressure_plate') {
    return pressurePlateGeometry
  }
  if (geometryType === 'tripwire') {
    return tripwireGeometry
  }
  if (geometryType === 'campfire') {
    return campfireGeometry
  }
  const redstoneDeviceMatch = geometryType.match(/^redstone_device_(north|south|east|west)$/u)
  if (redstoneDeviceMatch) {
    if (!redstoneDeviceGeometryCache.has(geometryType)) {
      redstoneDeviceGeometryCache.set(geometryType, createRedstoneDeviceGeometry(redstoneDeviceMatch[1]))
    }
    return redstoneDeviceGeometryCache.get(geometryType)
  }
  const wireMatch = geometryType.match(/^wire_([01])([01])([01])([01])$/u)
  if (wireMatch) {
    if (!wireGeometryCache.has(geometryType)) {
      wireGeometryCache.set(geometryType, createWireGeometry({
        north: wireMatch[1] === '1',
        east: wireMatch[2] === '1',
        south: wireMatch[3] === '1',
        west: wireMatch[4] === '1',
      }))
    }
    return wireGeometryCache.get(geometryType)
  }
  if (geometryType === 'slab_bottom') {
    return slabBottomGeometry
  }
  if (geometryType === 'slab_top') {
    return slabTopGeometry
  }
  if (stairGeometries[geometryType]) {
    return stairGeometries[geometryType]
  }

  const trapdoorMatch = geometryType.match(/^trapdoor_(top|bottom)_(open|closed)_(north|south|east|west)$/u)
  if (trapdoorMatch) {
    if (!trapdoorGeometryCache.has(geometryType)) {
      trapdoorGeometryCache.set(geometryType, createTrapdoorGeometry({
        half: trapdoorMatch[1],
        open: trapdoorMatch[2] === 'open',
        facing: trapdoorMatch[3],
      }))
    }
    return trapdoorGeometryCache.get(geometryType)
  }

  const barsMatch = geometryType.match(/^bars_([01])([01])([01])([01])$/u)
  if (barsMatch) {
    if (!barsGeometryCache.has(geometryType)) {
      barsGeometryCache.set(geometryType, createIronBarsGeometry({
        north: barsMatch[1] === '1',
        east: barsMatch[2] === '1',
        south: barsMatch[3] === '1',
        west: barsMatch[4] === '1',
      }))
    }
    return barsGeometryCache.get(geometryType)
  }

  const fenceMatch = geometryType.match(/^fence_([01])([01])([01])([01])$/u)
  if (fenceMatch) {
    if (!fenceGeometryCache.has(geometryType)) {
      fenceGeometryCache.set(geometryType, createFenceGeometry({
        north: fenceMatch[1] === '1',
        east: fenceMatch[2] === '1',
        south: fenceMatch[3] === '1',
        west: fenceMatch[4] === '1',
      }))
    }
    return fenceGeometryCache.get(geometryType)
  }

  const wallMatch = geometryType.match(/^wall_([01])_([0-2])([0-2])([0-2])([0-2])$/u)
  if (wallMatch) {
    if (!wallGeometryCache.has(geometryType)) {
      wallGeometryCache.set(geometryType, createWallGeometry({
        up: wallMatch[1] === '1',
        north: Number(wallMatch[2]),
        east: Number(wallMatch[3]),
        south: Number(wallMatch[4]),
        west: Number(wallMatch[5]),
      }))
    }
    return wallGeometryCache.get(geometryType)
  }

  const lanternMatch = geometryType.match(/^lantern_(hanging|standing)$/u)
  if (lanternMatch) {
    if (!lanternGeometryCache.has(geometryType)) {
      lanternGeometryCache.set(geometryType, createLanternGeometry({
        hanging: lanternMatch[1] === 'hanging',
      }))
    }
    return lanternGeometryCache.get(geometryType)
  }

  const doorMatch = geometryType.match(/^door_(upper|lower)_(open|closed)_(north|south|east|west)_(left|right)$/u)
  if (doorMatch) {
    if (!doorGeometryCache.has(geometryType)) {
      doorGeometryCache.set(geometryType, createDoorGeometry({
        facing: doorMatch[3],
        open: doorMatch[2] === 'open',
        hinge: doorMatch[4],
      }))
    }
    return doorGeometryCache.get(geometryType)
  }

  const torchMatch = geometryType.match(/^torch_(floor|wall_(north|south|east|west))$/u)
  if (torchMatch) {
    if (!torchGeometryCache.has(geometryType)) {
      torchGeometryCache.set(geometryType, createTorchGeometry({
        wall: torchMatch[1] !== 'floor',
        facing: torchMatch[2] || 'north',
      }))
    }
    return torchGeometryCache.get(geometryType)
  }

  const buttonMatch = geometryType.match(/^button_(floor|wall|ceiling)_(north|south|east|west)_(on|off)$/u)
  if (buttonMatch) {
    if (!buttonGeometryCache.has(geometryType)) {
      buttonGeometryCache.set(geometryType, createButtonGeometry({
        face: buttonMatch[1],
        facing: buttonMatch[2],
        powered: buttonMatch[3] === 'on',
      }))
    }
    return buttonGeometryCache.get(geometryType)
  }

  const leverMatch = geometryType.match(/^lever_(floor|wall|ceiling)_(north|south|east|west)_(on|off)$/u)
  if (leverMatch) {
    if (!leverGeometryCache.has(geometryType)) {
      leverGeometryCache.set(geometryType, createLeverGeometry({
        face: leverMatch[1],
        facing: leverMatch[2],
        powered: leverMatch[3] === 'on',
      }))
    }
    return leverGeometryCache.get(geometryType)
  }

  const ladderMatch = geometryType.match(/^ladder_(north|south|east|west)$/u)
  if (ladderMatch) {
    if (!ladderGeometryCache.has(geometryType)) {
      ladderGeometryCache.set(geometryType, createLadderGeometry(ladderMatch[1]))
    }
    return ladderGeometryCache.get(geometryType)
  }

  const signMatch = geometryType.match(/^sign_(standing_(\d+)|wall_(north|south|east|west))$/u)
  if (signMatch) {
    if (!signGeometryCache.has(geometryType)) {
      if (signMatch[2] !== undefined) {
        signGeometryCache.set(geometryType, createStandingSignGeometry(Number(signMatch[2])))
      }
      else {
        signGeometryCache.set(geometryType, createWallSignGeometry(signMatch[3] || 'north'))
      }
    }
    return signGeometryCache.get(geometryType)
  }

  const hangingSignMatch = geometryType.match(/^hanging_sign_(standing_(\d+)|wall_(north|south|east|west))$/u)
  if (hangingSignMatch) {
    if (!hangingSignGeometryCache.has(geometryType)) {
      if (hangingSignMatch[2] !== undefined) {
        hangingSignGeometryCache.set(geometryType, createStandingHangingSignGeometry(Number(hangingSignMatch[2])))
      }
      else {
        hangingSignGeometryCache.set(geometryType, createWallHangingSignGeometry(hangingSignMatch[3] || 'north'))
      }
    }
    return hangingSignGeometryCache.get(geometryType)
  }

  const bannerMatch = geometryType.match(/^banner_(standing_(\d+)|wall_(north|south|east|west))$/u)
  if (bannerMatch) {
    if (!bannerGeometryCache.has(geometryType)) {
      if (bannerMatch[2] !== undefined) {
        bannerGeometryCache.set(geometryType, createStandingBannerGeometry(Number(bannerMatch[2])))
      }
      else {
        bannerGeometryCache.set(geometryType, createWallBannerGeometry(bannerMatch[3] || 'north'))
      }
    }
    return bannerGeometryCache.get(geometryType)
  }

  const chainMatch = geometryType.match(/^chain_([xyz])$/u)
  if (chainMatch) {
    if (!chainGeometryCache.has(geometryType)) {
      chainGeometryCache.set(geometryType, createChainGeometry(chainMatch[1]))
    }
    return chainGeometryCache.get(geometryType)
  }

  const rodMatch = geometryType.match(/^rod_(up|down|north|south|east|west)$/u)
  if (rodMatch) {
    if (!rodGeometryCache.has(geometryType)) {
      rodGeometryCache.set(geometryType, createRodGeometry(rodMatch[1]))
    }
    return rodGeometryCache.get(geometryType)
  }

  const candleMatch = geometryType.match(/^candle_([1-4])$/u)
  if (candleMatch) {
    if (!candleGeometryCache.has(geometryType)) {
      candleGeometryCache.set(geometryType, createCandleGeometry(Number(candleMatch[1])))
    }
    return candleGeometryCache.get(geometryType)
  }

  const tripwireHookMatch = geometryType.match(/^tripwire_hook_(north|south|east|west)_(on|off)$/u)
  if (tripwireHookMatch) {
    if (!tripwireHookGeometryCache.has(geometryType)) {
      tripwireHookGeometryCache.set(geometryType, createTripwireHookGeometry({
        facing: tripwireHookMatch[1],
        powered: tripwireHookMatch[2] === 'on',
      }))
    }
    return tripwireHookGeometryCache.get(geometryType)
  }

  const cocoaMatch = geometryType.match(/^cocoa_([0-2])_(north|south|east|west)$/u)
  if (cocoaMatch) {
    if (!cocoaGeometryCache.has(geometryType)) {
      cocoaGeometryCache.set(geometryType, createCocoaGeometry({
        age: Number(cocoaMatch[1]),
        facing: cocoaMatch[2],
      }))
    }
    return cocoaGeometryCache.get(geometryType)
  }

  const amethystBudMatch = geometryType.match(/^amethyst_bud_(small|medium|large|cluster)_(up|down|north|south|east|west)$/u)
  if (amethystBudMatch) {
    if (!amethystBudGeometryCache.has(geometryType)) {
      amethystBudGeometryCache.set(geometryType, createAmethystBudGeometry({
        size: amethystBudMatch[1],
        facing: amethystBudMatch[2],
      }))
    }
    return amethystBudGeometryCache.get(geometryType)
  }

  const fenceGateMatch = geometryType.match(/^fence_gate_(north|south|east|west)_(open|closed)_(wall|free)$/u)
  if (fenceGateMatch) {
    if (!fenceGateGeometryCache.has(geometryType)) {
      fenceGateGeometryCache.set(geometryType, createFenceGateGeometry({
        facing: fenceGateMatch[1],
        open: fenceGateMatch[2] === 'open',
        inWall: fenceGateMatch[3] === 'wall',
      }))
    }
    return fenceGateGeometryCache.get(geometryType)
  }

  const hopperMatch = geometryType.match(/^hopper_(down|north|south|east|west)$/u)
  if (hopperMatch) {
    if (!hopperGeometryCache.has(geometryType)) {
      hopperGeometryCache.set(geometryType, createHopperGeometry({
        facing: hopperMatch[1],
      }))
    }
    return hopperGeometryCache.get(geometryType)
  }

  const vineMatch = geometryType.match(/^vine_([01])([01])([01])([01])([01])$/u)
  if (vineMatch) {
    if (!vineGeometryCache.has(geometryType)) {
      vineGeometryCache.set(geometryType, createVineGeometry({
        up: vineMatch[1] === '1',
        north: vineMatch[2] === '1',
        east: vineMatch[3] === '1',
        south: vineMatch[4] === '1',
        west: vineMatch[5] === '1',
      }))
    }
    return vineGeometryCache.get(geometryType)
  }

  return sharedGeometry
}

/**
 * 植物配置
 * 植物使用 X 形交叉平面几何体渲染
 */
export const plants = {
  deadBush: {
    id: PLANT_IDS.DEAD_BUSH,
    name: 'dead_bush',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'deadBush_plant_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: false,
  },
  shortDryGrass: {
    id: PLANT_IDS.SHORT_DRY_GRASS,
    name: 'short_dry_grass',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'shortDryGrass_plant_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.3 },
  },
  shortGrass: {
    id: PLANT_IDS.SHORT_GRASS,
    name: 'short_grass',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'shortGrass_plant_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.3 },
    mixColor: 0x5B8731, // grass green color for grayscale texture
  },
  dandelion: {
    id: PLANT_IDS.DANDELION,
    name: 'dandelion',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'dandelion_plant_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.2 },
  },
  poppy: {
    id: PLANT_IDS.POPPY,
    name: 'poppy',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'poppy_plant_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.2 },
  },
  oxeyeDaisy: {
    id: PLANT_IDS.OXEYE_DAISY,
    name: 'oxeye_daisy',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'oxeyeDaisy_plant_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.2 },
  },
  allium: {
    id: PLANT_IDS.ALLIUM,
    name: 'allium',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'allium_plant_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.2 },
  },
  cactusFlower: {
    id: PLANT_IDS.CACTUS_FLOWER,
    name: 'cactus_flower',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'cactus_flower_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.2 },
  },
  pinkTulip: {
    id: PLANT_IDS.PINK_TULIP,
    name: 'pink_tulip',
    visible: true,
    isPlant: true,
    textureKeys: { all: 'pink_tulip_Texture' },
    alphaTest: 0.5,
    transparent: true,
    animated: true,
    animationType: 'wind',
    animationParams: { swayAmplitude: 0.2 },
  },
}

// 植物 ID -> 配置映射
export const PLANT_BY_ID = Object.values(plants).reduce((map, item) => {
  map[item.id] = item
  return map
}, {})

/**
 * X 形交叉平面几何体（共享，供植物渲染使用）
 * 两个相互垂直的 1x1 平面，呈 X 形
 */
export const sharedCrossPlaneGeometry = (() => {
  const geometry = new THREE.BufferGeometry()

  // 两个对角交叉的平面 (不需要背面三角形，使用 DoubleSide 材质)
  // prettier-ignore
  const vertices = new Float32Array([
    // 平面1: 沿对角线 (-0.5,-0.5) 到 (0.5,0.5)
    -0.5,
    0,
    -0.5,
    0.5,
    0,
    0.5,
    0.5,
    1,
    0.5,
    -0.5,
    0,
    -0.5,
    0.5,
    1,
    0.5,
    -0.5,
    1,
    -0.5,
    // 平面2: 沿对角线 (-0.5,0.5) 到 (0.5,-0.5)
    -0.5,
    0,
    0.5,
    0.5,
    0,
    -0.5,
    0.5,
    1,
    -0.5,
    -0.5,
    0,
    0.5,
    0.5,
    1,
    -0.5,
    -0.5,
    1,
    0.5,
  ])

  // prettier-ignore
  const uvs = new Float32Array([
    // 平面1
    0,
    0,
    1,
    0,
    1,
    1,
    0,
    0,
    1,
    1,
    0,
    1,
    // 平面2
    0,
    0,
    1,
    0,
    1,
    1,
    0,
    0,
    1,
    1,
    0,
    1,
  ])

  // 使用向上的垂直法线，这样无论从哪个方向看都能正确接收光照
  // 这是 Minecraft 风格植物的常用做法
  // prettier-ignore
  const normals = new Float32Array([
    // 平面1 - 全部使用 (0, 1, 0) 向上法线
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    // 平面2 - 全部使用 (0, 1, 0) 向上法线
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
  ])

  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))

  return geometry
})()

/**
 * 创建植物材质
 * @param {object} plantType 植物配置
 * @param {Record<string, THREE.Texture>} textureItems 资源管理器加载的纹理
 * @returns {THREE.Material|null} 生成的材质，缺失纹理时返回 null
 */
export function createPlantMaterials(plantType, textureItems) {
  if (!plantType.visible)
    return null

  const tex = textureItems[plantType.textureKeys.all]
  if (!tex)
    return null

  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace

  const materialConfig = {
    baseMaterial: THREE.MeshLambertMaterial,
    map: tex,
    flatShading: true,
    alphaTest: plantType.alphaTest ?? 0.5,
    transparent: plantType.transparent ?? true,
    side: THREE.DoubleSide,
    // 草类使用绿色自发光，其余使用白色
    emissive: new THREE.Color(plantType.mixColor !== undefined ? '#83CE54' : '#FFFFFF'),
    emissiveMap: tex,
    emissiveIntensity: 0.6,
    // 草类使用指定的混色，其余使用白色
    color: new THREE.Color(plantType.mixColor !== undefined ? plantType.mixColor : '#FFFFFF'),
  }

  // 动画配置
  if (plantType.animated && plantType.animationType) {
    const defaults = ANIMATION_DEFAULTS[plantType.animationType] || {}
    const params = { ...defaults, ...plantType.animationParams }

    materialConfig.uniforms = {
      uTime: { value: 0 },
      uWindSpeed: { value: params.windSpeed ?? 2.0 },
      uSwayAmplitude: { value: params.swayAmplitude ?? 0.3 },
      uPhaseScale: { value: params.phaseScale ?? 2.0 },
    }
    materialConfig.vertexShader = windVertexShader
  }

  const material = new CustomShaderMaterial(materialConfig)
  material._isAnimated = !!plantType.animated
  material._animationType = plantType.animationType || null

  return material
}
