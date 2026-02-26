/* eslint-disable node/prefer-global/buffer */
// eslint-disable-next-line unicorn/prefer-node-protocol
import { Buffer as BufferPolyfill } from 'buffer'
import { parseNbt, simplifyNbt } from './nbt-browser.js'
import { javaAtlasBlockTextureRects } from '../../generated/java-atlas-textures.js'
import { javaBlockTextureStemHintsByBlock } from '../../generated/java-block-texture-hints.js'
import {
  isIronBarsBlockName,
  isLanternBlockName,
  isSlabBlockName,
  isStairBlockName,
  isTrapdoorBlockName,
  isWallBlockName,
} from './block-behaviors.js'
import {
  barsGeometryTypeFromProperties,
  buildVariantKey,
  normalizeFacing,
  normalizeStairShape,
  slabGeometryTypeFromProperties,
  trapdoorGeometryTypeFromProperties,
  variantBoolean,
  variantString,
  wallGeometryTypeFromProperties,
} from './block-state-adapter.js'
import { BLOCK_IDS, ensureDynamicBlockType, getBlockTypeById } from './blocks-config.js'

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BufferPolyfill
}

const ATLAS_TEXTURE_PREFIX = 'atlas:'

/**
 * Litematica 原理图服务
 * 解析 .litematic 文件并注入方块到地形
 */
class SchematicService {
  constructor() {
    this.currentSchematic = null
    this.pako = null
    this._blockResolveCache = new Map()
  }

  async _yieldToMainThread() {
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve())
        return
      }
      setTimeout(resolve, 0)
    })
  }

  /**
   * 延迟加载 pako（用于浏览器环境）
   */
  async _loadPako() {
    if (this.pako) {
      return this.pako
    }
    const pakoModule = await import('pako')
    this.pako = pakoModule.default || pakoModule
    return this.pako
  }

  /**
   * 从文件解析 Litematica 原理图
   * @param {File} file - .litematic 文件
   * @returns {Promise<object>} 解析后的原理图数据
   */
  async parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result
          const schematic = await this._parseBuffer(arrayBuffer)
          this.currentSchematic = schematic
          resolve(schematic)
        }
        catch (error) {
          reject(new Error(`Failed to parse schematic: ${error.message}`))
        }
      }

      reader.onerror = () => {
        reject(new Error('Failed to read file'))
      }

      reader.readAsArrayBuffer(file)
    })
  }

  /**
   * 内部方法：从 ArrayBuffer 解析原理图
   */
  async _parseBuffer(arrayBuffer) {
    // Litematica 文件是 gzip 压缩的 NBT 格式
    const pako = await this._loadPako()
    const decompressed = pako.inflate(arrayBuffer)
    const { parsed } = await parseNbt(BufferPolyfill.from(decompressed))
    const simplified = simplifyNbt(parsed)

    const metadata = simplified.Metadata || {}
    const regions = simplified.Regions || {}

    return {
      name: metadata.Name || 'Unknown',
      author: metadata.Author || 'Unknown',
      size: {
        x: metadata.EnclosingSize?.x || 0,
        y: metadata.EnclosingSize?.y || 0,
        z: metadata.EnclosingSize?.z || 0,
      },
      regions: this._parseRegions(regions),
      rawNBT: simplified,
    }
  }

  /**
   * 解析原理图的区域（Regions）
   */
  _parseRegions(regionData) {
    const regions = {}

    if (!regionData) {
      return regions
    }

    Object.entries(regionData).forEach(([regionName, region]) => {
      const position = region.Position || {}
      const size = region.Size || {}
      const blockStates = region.BlockStates || BufferPolyfill.alloc(0)
      const palette = region.BlockStatePalette || []

      regions[regionName] = {
        position: {
          x: position.x || 0,
          y: position.y || 0,
          z: position.z || 0,
        },
        size: {
          x: size.x || 0,
          y: size.y || 0,
          z: size.z || 0,
        },
        palette: this._parsePalette(palette),
        blockData: blockStates,
        totalBlocks: Math.abs(size.x || 0) * Math.abs(size.y || 0) * Math.abs(size.z || 0),
        _decodedIndices: null,
        _paletteResolved: null,
        _solidBlockCount: null,
        _solidYStats: null,
      }
    })

    return regions
  }

  /**
   * 解析调色板（方块类型映射）
   */
  _parsePalette(paletteData) {
    const palette = {}

    paletteData.forEach((entry, index) => {
      const blockName = entry.Name || 'minecraft:air'
      const properties = entry.Properties || {}

      palette[index] = {
        name: blockName,
        properties,
      }
    })

    return palette
  }

  _toUint64BigInt(value) {
    let source = value
    if (source && typeof source === 'object' && 'value' in source) {
      source = source.value
    }
    return BigInt.asUintN(64, BigInt(source ?? 0))
  }

  _decodeBlockIndices(blockData, paletteSize, totalBlocks) {
    if (!blockData || totalBlocks <= 0) {
      return []
    }

    const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(Math.max(1, paletteSize))))
    const mask = (1n << BigInt(bitsPerBlock)) - 1n
    const longArray = Array.from(blockData, value => this._toUint64BigInt(value))
    const indices = Array.from({ length: totalBlocks }, () => 0)

    for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
      const startBit = blockIndex * bitsPerBlock
      const longIndex = Math.floor(startBit / 64)
      const bitOffset = startBit % 64

      if (longIndex >= longArray.length) {
        indices[blockIndex] = 0
        continue
      }

      let value = (longArray[longIndex] >> BigInt(bitOffset)) & mask
      const spillBits = bitOffset + bitsPerBlock - 64
      if (spillBits > 0 && longIndex + 1 < longArray.length) {
        const nextMask = (1n << BigInt(spillBits)) - 1n
        const nextBits = longArray[longIndex + 1] & nextMask
        value |= nextBits << BigInt(64 - bitOffset)
      }

      indices[blockIndex] = Number(value)
    }

    return indices
  }

  _getDecodedIndices(region) {
    if (region._decodedIndices) {
      return region._decodedIndices
    }

    const paletteSize = Object.keys(region.palette).length
    region._decodedIndices = this._decodeBlockIndices(region.blockData, paletteSize, region.totalBlocks)
    return region._decodedIndices
  }

  _buildResolvedPalette(region) {
    if (region._paletteResolved) {
      return region._paletteResolved
    }

    const resolved = {}
    for (const [index, entry] of Object.entries(region.palette)) {
      const blockName = entry?.name || 'minecraft:air'
      resolved[index] = this._resolveProjectBlock(blockName, entry?.properties || {})
    }
    region._paletteResolved = resolved
    return resolved
  }

  _countSolidBlocks(region) {
    if (typeof region._solidBlockCount === 'number') {
      return region._solidBlockCount
    }

    const blockIndices = this._getDecodedIndices(region)
    const resolvedPalette = this._buildResolvedPalette(region)

    let solidCount = 0
    for (let index = 0; index < blockIndices.length; index++) {
      const paletteIndex = blockIndices[index] ?? 0
      const resolved = resolvedPalette[paletteIndex]
      if (resolved?.id && resolved.id !== BLOCK_IDS.EMPTY) {
        solidCount++
      }
    }

    region._solidBlockCount = solidCount
    return solidCount
  }

  _regionAxisOrigin(position = 0, size = 0) {
    if (size < 0) {
      return position + size + 1
    }
    return position
  }

  _getRegionWorldBase(region) {
    return {
      x: this._regionAxisOrigin(region?.position?.x || 0, region?.size?.x || 0),
      y: this._regionAxisOrigin(region?.position?.y || 0, region?.size?.y || 0),
      z: this._regionAxisOrigin(region?.position?.z || 0, region?.size?.z || 0),
    }
  }

  _getSolidYStats(region) {
    if (region._solidYStats) {
      return region._solidYStats
    }

    const sizeX = Math.abs(region.size.x)
    const sizeY = Math.abs(region.size.y)
    const sizeZ = Math.abs(region.size.z)
    const totalBlocks = sizeX * sizeY * sizeZ
    if (totalBlocks <= 0) {
      region._solidYStats = {
        minY: null,
        maxY: null,
        belowZeroCount: 0,
      }
      return region._solidYStats
    }

    const blockIndices = this._getDecodedIndices(region)
    const resolvedPalette = this._buildResolvedPalette(region)
    const worldBase = this._getRegionWorldBase(region)

    let linearIndex = 0
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let belowZeroCount = 0

    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        for (let x = 0; x < sizeX; x++) {
          const paletteIndex = blockIndices[linearIndex++] ?? 0
          const resolved = resolvedPalette[paletteIndex]
          if (!resolved?.id || resolved.id === BLOCK_IDS.EMPTY) {
            continue
          }

          const worldY = y + worldBase.y
          minY = Math.min(minY, worldY)
          maxY = Math.max(maxY, worldY)
          if (worldY < 0) {
            belowZeroCount++
          }
        }
      }
    }

    if (!Number.isFinite(minY)) {
      minY = null
      maxY = null
    }

    region._solidYStats = { minY, maxY, belowZeroCount }
    return region._solidYStats
  }

  _resolveProjectBlock(blockName, properties = {}) {
    const cacheKey = `${blockName}::${buildVariantKey(properties)}`
    if (this._blockResolveCache.has(cacheKey)) {
      return this._blockResolveCache.get(cacheKey)
    }

    if (!blockName || blockName === 'minecraft:air') {
      const result = { id: BLOCK_IDS.EMPTY, source: 'air' }
      this._blockResolveCache.set(cacheKey, result)
      return result
    }

    const normalizedName = blockName.replace('minecraft:', '')

    if (isSlabBlockName(normalizedName)) {
      const slabBaseName = normalizedName.replace(/_slab$/u, '')
      const geometryType = slabGeometryTypeFromProperties(properties)

      const slabTextureName = this._resolveTextureName(slabBaseName)
        || this._resolveTextureName(`${slabBaseName}_planks`)
        || this._resolveTextureName(`planks_${slabBaseName}`)
        || this._resolveTextureName(normalizedName)
      if (slabTextureName) {
        const slabBlock = ensureDynamicBlockType(slabTextureName, {
          blockName: normalizedName,
          geometryType,
        })

        if (slabBlock?.id) {
          const result = {
            id: slabBlock.id,
            source: 'atlas-dynamic',
            textureName: slabTextureName,
          }
          this._blockResolveCache.set(cacheKey, result)
          return result
        }
      }
    }

    if (isStairBlockName(normalizedName)) {
      const stairBaseName = normalizedName.replace(/_stairs$/u, '')
      const stairTextureName = this._resolveTextureName(stairBaseName)
        || this._resolveTextureName(`${stairBaseName}_planks`)
        || this._resolveTextureName(`planks_${stairBaseName}`)
        || this._resolveTextureName(normalizedName)

      if (stairTextureName) {
        const geometryType = this._stairGeometryTypeFromProperties(properties)
        const stairBlock = ensureDynamicBlockType(stairTextureName, {
          blockName: normalizedName,
          geometryType,
        })

        if (stairBlock?.id) {
          const result = {
            id: stairBlock.id,
            source: 'atlas-dynamic',
            textureName: stairTextureName,
          }
          this._blockResolveCache.set(cacheKey, result)
          return result
        }
      }
    }

    if (isTrapdoorBlockName(normalizedName)) {
      const trapdoorBaseName = normalizedName.replace(/_trapdoor$/u, '')
      const trapdoorTextureName = this._resolveTextureName(trapdoorBaseName)
        || this._resolveTextureName(`${trapdoorBaseName}_trapdoor`)
        || this._resolveTextureName(normalizedName)

      if (trapdoorTextureName) {
        const mappedProperties = this._mapHorizontalPropertiesForWorld(properties)
        const geometryType = trapdoorGeometryTypeFromProperties(mappedProperties)
        const trapdoorBlock = ensureDynamicBlockType(trapdoorTextureName, {
          blockName: normalizedName,
          geometryType,
        })

        if (trapdoorBlock?.id) {
          const result = {
            id: trapdoorBlock.id,
            source: 'atlas-dynamic',
            textureName: trapdoorTextureName,
          }
          this._blockResolveCache.set(cacheKey, result)
          return result
        }
      }
    }

    if (isIronBarsBlockName(normalizedName)) {
      const barsTextureName = this._resolveTextureName(normalizedName)
      if (barsTextureName) {
        const mappedProperties = this._mapHorizontalPropertiesForWorld(properties)
        const geometryType = barsGeometryTypeFromProperties(mappedProperties)
        const barsBlock = ensureDynamicBlockType(barsTextureName, {
          blockName: normalizedName,
          geometryType,
        })

        if (barsBlock?.id) {
          const result = {
            id: barsBlock.id,
            source: 'atlas-dynamic',
            textureName: barsTextureName,
          }
          this._blockResolveCache.set(cacheKey, result)
          return result
        }
      }
    }

    if (isWallBlockName(normalizedName)) {
      const wallBaseName = normalizedName.replace(/_wall$/u, '')
      const wallTextureName = this._resolveTextureName(wallBaseName)
        || this._resolveTextureName(`${wallBaseName}_wall`)
        || this._resolveTextureName(normalizedName)

      if (wallTextureName) {
        const geometryType = wallGeometryTypeFromProperties(properties)
        const wallBlock = ensureDynamicBlockType(wallTextureName, {
          blockName: normalizedName,
          geometryType,
        })

        if (wallBlock?.id) {
          const result = {
            id: wallBlock.id,
            source: 'atlas-dynamic',
            textureName: wallTextureName,
          }
          this._blockResolveCache.set(cacheKey, result)
          return result
        }
      }
    }

    if (isLanternBlockName(normalizedName)) {
      const lanternTextureName = this._resolveTextureName(normalizedName)
      if (lanternTextureName) {
        const geometryType = this._lanternGeometryTypeFromProperties(properties)
        const lanternBlock = ensureDynamicBlockType(lanternTextureName, {
          blockName: normalizedName,
          geometryType,
        })

        if (lanternBlock?.id) {
          const result = {
            id: lanternBlock.id,
            source: 'atlas-dynamic',
            textureName: lanternTextureName,
          }
          this._blockResolveCache.set(cacheKey, result)
          return result
        }
      }
    }

    const textureName = this._resolveTextureName(normalizedName)
    if (textureName) {
      const dynamicBlock = ensureDynamicBlockType(textureName, {
        blockName: normalizedName,
      })

      if (dynamicBlock?.id) {
        const result = {
          id: dynamicBlock.id,
          source: 'atlas-dynamic',
          textureName,
        }
        this._blockResolveCache.set(cacheKey, result)
        return result
      }
    }

    const fallbackTextureName = this._resolveAtlasTextureName('stone') || `${ATLAS_TEXTURE_PREFIX}block/${normalizedName}`
    const fallbackDynamicBlock = ensureDynamicBlockType(fallbackTextureName, {
      blockName: normalizedName,
    })

    if (fallbackDynamicBlock?.id) {
      const fallback = {
        id: fallbackDynamicBlock.id,
        source: 'default-atlas-fallback',
        textureName: fallbackTextureName,
      }
      this._blockResolveCache.set(cacheKey, fallback)
      return fallback
    }

    const emptyFallback = { id: BLOCK_IDS.EMPTY, source: 'default-empty' }
    this._blockResolveCache.set(cacheKey, emptyFallback)
    return emptyFallback
  }

  _normalizeVariantString(value) {
    return variantString(value)
  }

  _mapHorizontalFacingForWorld(facing) {
    if (facing === 'east') {
      return 'west'
    }
    if (facing === 'west') {
      return 'east'
    }
    return facing
  }

  _mapStairShapeForWorld(shape) {
    if (shape === 'inner_left') {
      return 'inner_right'
    }
    if (shape === 'inner_right') {
      return 'inner_left'
    }
    if (shape === 'outer_left') {
      return 'outer_right'
    }
    if (shape === 'outer_right') {
      return 'outer_left'
    }
    return shape
  }

  _mapHorizontalPropertiesForWorld(properties = {}) {
    return {
      ...properties,
      facing: this._mapHorizontalFacingForWorld(variantString(properties?.facing)),
      east: properties?.west,
      west: properties?.east,
    }
  }

  _normalizeFacing(value) {
    return this._mapHorizontalFacingForWorld(normalizeFacing(value))
  }

  _normalizeStairShape(value) {
    return this._mapStairShapeForWorld(normalizeStairShape(value))
  }

  _stairGeometryTypeFromProperties(properties = {}) {
    const facing = this._normalizeFacing(properties?.facing)
    const half = this._normalizeVariantString(properties?.half) === 'top' ? 'top' : 'bottom'
    const shape = this._normalizeStairShape(properties?.shape)
    return `stair_${half}_${facing}_${shape}`
  }

  _normalizeBoolean(value) {
    return variantBoolean(value)
  }

  _normalizeWallSide(value) {
    const normalized = this._normalizeVariantString(value)
    if (normalized === 'tall') {
      return 2
    }
    if (normalized === 'low' || normalized === 'true' || normalized === '1') {
      return 1
    }
    return 0
  }

  _lanternGeometryTypeFromProperties(properties = {}) {
    const hanging = this._normalizeBoolean(properties?.hanging)
    return hanging ? 'lantern_hanging' : 'lantern_standing'
  }

  _buildBlockVariantKey(properties = {}) {
    return buildVariantKey(properties)
  }

  _resolveTextureName(normalizedName) {
    return this._resolveAtlasTextureName(normalizedName)
  }

  _resolveAtlasTextureName(normalizedName) {
    if (!normalizedName) {
      return null
    }

    const baseCandidates = this._buildTextureBaseNameCandidates(normalizedName)
    const javaTextureHints = javaBlockTextureStemHintsByBlock[normalizedName]
    if (Array.isArray(javaTextureHints)) {
      for (const hint of javaTextureHints) {
        if (typeof hint === 'string' && hint) {
          baseCandidates.push(hint)
        }
      }
    }

    const atlasCandidates = []
    const seen = new Set()

    for (const base of baseCandidates) {
      const variants = [
        base,
        `${base}_top`,
        `${base}_side`,
        `${base}_front`,
        `${base}_on`,
        `${base}_off`,
        `${base}_bottom`,
        `${base}_end`,
      ]

      for (const variant of variants) {
        if (seen.has(variant)) {
          continue
        }
        seen.add(variant)
        atlasCandidates.push(variant)
      }
    }

    for (const candidate of atlasCandidates) {
      const rectKey = `block/${candidate}`
      if (javaAtlasBlockTextureRects[rectKey]) {
        return `${ATLAS_TEXTURE_PREFIX}${rectKey}`
      }
    }

    return null
  }

  _buildTextureBaseNameCandidates(normalizedName) {
    const candidates = [normalizedName]

    const shapeStripped = normalizedName.replace(/_(stairs|slab|wall|fence|fence_gate|door|trapdoor)$/u, '')
    if (shapeStripped && shapeStripped !== normalizedName) {
      candidates.push(shapeStripped)
    }

    const swapPairs = [
      ['_planks', 'planks_'],
      ['_concrete', 'concrete_'],
      ['_stained_glass', 'glass_'],
    ]

    for (const source of [...candidates]) {
      for (const [suffix, prefix] of swapPairs) {
        if (!source.endsWith(suffix)) {
          continue
        }
        const material = source.slice(0, -suffix.length)
        if (!material) {
          continue
        }
        candidates.push(`${prefix}${material}`)
      }
    }

    for (const source of [...candidates]) {
      if (source === 'stone_bricks' || source === 'stone_brick') {
        candidates.push('stonebrick')
      }
      if (source === 'nether_bricks') {
        candidates.push('nether_brick')
      }
      if (source.endsWith('_brick')) {
        candidates.push(`${source}s`)
      }
      if (source.endsWith('_bricks')) {
        candidates.push(source.slice(0, -1))
      }
      if (source.endsWith('_tile')) {
        candidates.push(`${source}s`)
      }
      if (source.endsWith('_tiles')) {
        candidates.push(source.slice(0, -1))
      }
    }

    return [...new Set(candidates)]
  }

  /**
   * 构建原理图预览体素（采样）
   * @param {{maxBlocks?:number}} options
   * @returns {{blocks:Array<{x:number,y:number,z:number,id:number,name:string}>,bounds:{min:{x:number,y:number,z:number},max:{x:number,y:number,z:number}},totalSolidBlocks:number,sampled:boolean}} 预览模型数据
   */
  buildPreviewModel(options = {}) {
    if (!this.currentSchematic) {
      throw new Error('No schematic loaded')
    }

    const maxBlocks = Math.max(500, Number(options.maxBlocks) || 12000)
    const sampledBlocks = []
    let seenSolidBlocks = 0

    const bounds = {
      min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
      max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
    }

    for (const region of Object.values(this.currentSchematic.regions)) {
      const sizeX = Math.abs(region.size.x)
      const sizeY = Math.abs(region.size.y)
      const sizeZ = Math.abs(region.size.z)
      const totalBlocks = sizeX * sizeY * sizeZ
      if (totalBlocks <= 0) {
        continue
      }

      const blockIndices = this._getDecodedIndices(region)
      const resolvedPalette = this._buildResolvedPalette(region)
      const worldBase = this._getRegionWorldBase(region)

      let linearIndex = 0
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          for (let x = 0; x < sizeX; x++) {
            const paletteIndex = blockIndices[linearIndex++] ?? 0
            const paletteEntry = region.palette[paletteIndex]
            const blockName = paletteEntry?.name || 'minecraft:air'
            const projectBlock = resolvedPalette[paletteIndex] || this._resolveProjectBlock(blockName, paletteEntry?.properties || {})
            const projectBlockId = projectBlock.id
            if (projectBlockId === BLOCK_IDS.EMPTY) {
              continue
            }

            const worldX = x + worldBase.x
            const worldY = y + worldBase.y
            const worldZ = z + worldBase.z

            bounds.min.x = Math.min(bounds.min.x, worldX)
            bounds.min.y = Math.min(bounds.min.y, worldY)
            bounds.min.z = Math.min(bounds.min.z, worldZ)
            bounds.max.x = Math.max(bounds.max.x, worldX)
            bounds.max.y = Math.max(bounds.max.y, worldY)
            bounds.max.z = Math.max(bounds.max.z, worldZ)

            seenSolidBlocks++

            const blockType = getBlockTypeById(projectBlockId)

            const candidate = {
              x: worldX,
              y: worldY,
              z: worldZ,
              id: projectBlockId,
              name: blockName,
              geometryType: blockType?.geometryType || 'cube',
              textureName: blockType?.textureKeys?.all
                || blockType?.textureKeys?.top
                || blockType?.textureKeys?.side
                || null,
            }

            if (sampledBlocks.length < maxBlocks) {
              sampledBlocks.push(candidate)
              continue
            }

            const replaceIndex = Math.floor(Math.random() * seenSolidBlocks)
            if (replaceIndex < maxBlocks) {
              sampledBlocks[replaceIndex] = candidate
            }
          }
        }
      }
    }

    if (!Number.isFinite(bounds.min.x)) {
      bounds.min = { x: 0, y: 0, z: 0 }
      bounds.max = { x: 0, y: 0, z: 0 }
    }

    return {
      blocks: sampledBlocks,
      bounds,
      totalSolidBlocks: seenSolidBlocks,
      sampled: seenSolidBlocks > maxBlocks,
    }
  }

  _ensureChunkReady(chunkManager, chunkX, chunkZ) {
    let chunk = chunkManager.getChunk(chunkX, chunkZ)
    if (chunk) {
      return chunk
    }

    if (typeof chunkManager._ensureChunk !== 'function') {
      return null
    }

    chunk = chunkManager._ensureChunk(chunkX, chunkZ)
    if (!chunk) {
      return null
    }

    if (chunk.state === 'init') {
      if (typeof chunkManager._prepareChunkData === 'function') {
        const prepared = chunkManager._prepareChunkData(chunk)
        if (!prepared) {
          return null
        }
      }
      else {
        chunk.generator.params.seed = chunkManager.seed
        const generated = chunk.generateData()
        if (!generated) {
          return null
        }
      }

      if (typeof chunkManager._applyChunkModifications === 'function') {
        chunkManager._applyChunkModifications(chunk)
      }
    }

    return chunk
  }

  /**
   * 获取原理图的预览信息
   */
  getPreview() {
    if (!this.currentSchematic) {
      return null
    }

    const { name, author, size, regions } = this.currentSchematic
    const regionCount = Object.keys(regions).length

    return {
      name,
      author,
      size,
      regionCount,
      blockCount: this._estimateSolidBlockCount(regions),
      yStats: this._collectSolidYStats(regions),
    }
  }

  getRequiredTextureNames() {
    if (!this.currentSchematic) {
      return []
    }

    const textureNames = new Set()

    for (const region of Object.values(this.currentSchematic.regions)) {
      const blockIndices = this._getDecodedIndices(region)
      if (!blockIndices.length) {
        continue
      }

      const usedPalette = new Set(blockIndices)
      for (const paletteIndex of usedPalette) {
        const paletteEntry = region.palette[paletteIndex]
        const blockName = paletteEntry?.name || 'minecraft:air'
        const projectBlock = this._resolveProjectBlock(blockName, paletteEntry?.properties || {})
        if (!projectBlock?.id || projectBlock.id === BLOCK_IDS.EMPTY) {
          continue
        }

        const blockType = getBlockTypeById(projectBlock.id)
        const keys = blockType?.textureKeys ? Object.values(blockType.textureKeys) : []
        keys.forEach((key) => {
          if (key) {
            textureNames.add(key)
          }
        })
      }
    }

    return [...textureNames]
  }

  async preloadTextures(resources) {
    if (!resources?.loadByNames) {
      return []
    }

    const names = this.getRequiredTextureNames()
    if (!names.length) {
      return []
    }

    return resources.loadByNames(names)
  }

  /**
   * 估算原理图中的方块数量
   */
  _estimateBlockCount(regions) {
    return Object.values(regions).reduce((sum, region) => {
      const { x, y, z } = region.size
      return sum + (x * y * z)
    }, 0)
  }

  _estimateSolidBlockCount(regions) {
    return Object.values(regions).reduce((sum, region) => {
      return sum + this._countSolidBlocks(region)
    }, 0)
  }

  _collectSolidYStats(regions) {
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let belowZeroCount = 0

    for (const region of Object.values(regions)) {
      const stats = this._getSolidYStats(region)
      if (stats.minY === null || stats.maxY === null) {
        continue
      }
      minY = Math.min(minY, stats.minY)
      maxY = Math.max(maxY, stats.maxY)
      belowZeroCount += stats.belowZeroCount
    }

    if (!Number.isFinite(minY)) {
      minY = null
      maxY = null
    }

    return {
      minY,
      maxY,
      hasBlocksBelowZero: belowZeroCount > 0,
      blocksBelowZero: belowZeroCount,
    }
  }

  /**
   * 将原理图注入到世界
   * 这是一个占位符，实现需要与 World/Terrain 系统集成
   */
  async applyToWorld(chunkManager, worldOffset = { x: 0, y: 0, z: 0 }, options = {}) {
    if (!this.currentSchematic) {
      throw new Error('No schematic loaded')
    }

    if (!chunkManager) {
      throw new Error('ChunkManager is required')
    }

    const schematic = this.currentSchematic
    const replaceWorld = options.replaceWorld !== false
    const persistModifications = options.persistModifications ?? replaceWorld
    const keepSchematicOnlyMode = options.keepSchematicOnlyMode ?? replaceWorld
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const previousSchematicOnlyMode = !!chunkManager.schematicOnlyMode

    const offsetX = Math.floor(worldOffset.x ?? 0)
    const offsetY = Math.floor(worldOffset.y ?? 0)
    const offsetZ = Math.floor(worldOffset.z ?? 0)

    const stats = {
      placed: 0,
      replaced: 0,
      persisted: 0,
      skipped: 0,
      mappedByExact: 0,
      mappedByKeyword: 0,
      mappedByAtlasDynamic: 0,
      mappedByAtlasFallback: 0,
      unknownMappedToAtlasFallback: 0,
      touchedChunks: 0,
      worldClearedChunks: 0,
      skippedOutOfHeight: 0,
    }

    const blocksPerFrame = 1400
    const chunksPerFrame = 6
    let processedSinceYield = 0

    const totalSolidBlocks = this._estimateSolidBlockCount(schematic.regions)
    let processedSolidBlocks = 0
    const reportProgress = (phase, extra = {}) => {
      if (!onProgress) {
        return
      }
      const progress = totalSolidBlocks > 0 ? Math.min(1, processedSolidBlocks / totalSolidBlocks) : 1
      onProgress({
        phase,
        processedBlocks: processedSolidBlocks,
        totalBlocks: totalSolidBlocks,
        progress,
        ...extra,
      })
    }

    const touchedChunkKeys = new Set()
    const textureUsage = new Map()
    const shapeUsage = {
      stairs: 0,
      slabs: 0,
      walls: 0,
    }

    reportProgress('prepare', {
      replaceWorld,
    })

    try {
      if (replaceWorld) {
        chunkManager.setSchematicOnlyMode?.(true)
        chunkManager.persistence?.clearAllModifications?.()

        const loadedChunks = Array.from(chunkManager.chunks?.values?.() || [])
        for (let index = 0; index < loadedChunks.length; index++) {
          const chunk = loadedChunks[index]
          if (!chunk || chunk.state === 'disposed') {
            continue
          }

          if (chunk.state === 'init') {
            if (typeof chunkManager._prepareChunkData === 'function') {
              const prepared = chunkManager._prepareChunkData(chunk)
              if (!prepared) {
                continue
              }
            }
            else {
              chunk.generator.params.seed = chunkManager.seed
              const generated = chunk.generateData()
              if (!generated) {
                continue
              }
            }
          }

          chunk.container.clear()
          touchedChunkKeys.add(`${chunk.chunkX},${chunk.chunkZ}`)
          stats.worldClearedChunks++

          reportProgress('clearing-world', {
            clearedChunks: stats.worldClearedChunks,
            totalLoadedChunks: loadedChunks.length,
          })

          if ((index + 1) % chunksPerFrame === 0) {
            await this._yieldToMainThread()
          }
        }
      }

      for (const region of Object.values(schematic.regions)) {
        const sizeX = Math.abs(region.size.x)
        const sizeY = Math.abs(region.size.y)
        const sizeZ = Math.abs(region.size.z)
        const totalBlocks = sizeX * sizeY * sizeZ
        if (totalBlocks <= 0) {
          continue
        }

        const blockIndices = this._getDecodedIndices(region)
        const resolvedPalette = this._buildResolvedPalette(region)
        const worldBase = this._getRegionWorldBase(region)

        let linearIndex = 0
        for (let y = 0; y < sizeY; y++) {
          for (let z = 0; z < sizeZ; z++) {
            for (let x = 0; x < sizeX; x++) {
              const paletteIndex = blockIndices[linearIndex++] ?? 0
              const paletteEntry = region.palette[paletteIndex]
              const blockName = paletteEntry?.name || 'minecraft:air'
              const projectBlock = resolvedPalette[paletteIndex] || this._resolveProjectBlock(blockName, paletteEntry?.properties || {})
              const projectBlockId = projectBlock.id
              if (projectBlockId === BLOCK_IDS.EMPTY) {
                continue
              }

              if (projectBlock.source === 'exact') {
                stats.mappedByExact++
              }
              else if (projectBlock.source === 'keyword') {
                stats.mappedByKeyword++
              }
              else if (projectBlock.source === 'atlas-dynamic') {
                stats.mappedByAtlasDynamic++
              }
              else if (projectBlock.source === 'default-atlas-fallback') {
                stats.mappedByAtlasFallback++
                stats.unknownMappedToAtlasFallback++
              }

              const worldX = x + worldBase.x + offsetX
              const worldY = y + worldBase.y + offsetY
              const worldZ = z + worldBase.z + offsetZ

              if (worldY < 0 || worldY >= chunkManager.chunkHeight) {
                stats.skipped++
                stats.skippedOutOfHeight++
                continue
              }

              const chunkX = Math.floor(worldX / chunkManager.chunkWidth)
              const chunkZ = Math.floor(worldZ / chunkManager.chunkWidth)
              const chunkKey = `${chunkX},${chunkZ}`

              const chunk = this._ensureChunkReady(chunkManager, chunkX, chunkZ)
              if (!chunk) {
                stats.skipped++
                continue
              }

              const localX = Math.floor(worldX - chunkX * chunkManager.chunkWidth)
              const localZ = Math.floor(worldZ - chunkZ * chunkManager.chunkWidth)
              const existing = chunk.container.getBlock(localX, worldY, localZ)
              if (!existing) {
                stats.skipped++
                continue
              }

              if (existing.id === projectBlockId) {
                continue
              }

              if (existing.id !== BLOCK_IDS.EMPTY) {
                stats.replaced++
              }
              stats.placed++

              const normalizedName = blockName.replace('minecraft:', '')
              if (isStairBlockName(normalizedName)) {
                shapeUsage.stairs++
              }
              else if (isSlabBlockName(normalizedName)) {
                shapeUsage.slabs++
              }
              else if (isWallBlockName(normalizedName)) {
                shapeUsage.walls++
              }

              const blockType = getBlockTypeById(projectBlockId)
              const textureName = projectBlock.textureName
                || blockType?.textureKeys?.all
                || blockType?.textureKeys?.top
                || blockType?.textureKeys?.side
              if (textureName) {
                textureUsage.set(textureName, (textureUsage.get(textureName) || 0) + 1)
              }

              chunk.container.setBlockId(localX, worldY, localZ, projectBlockId)
              if (persistModifications) {
                chunkManager.persistence.recordChunkLocalModification(
                  chunkX,
                  chunkZ,
                  localX,
                  worldY,
                  localZ,
                  projectBlockId,
                )
                stats.persisted++
              }
              touchedChunkKeys.add(chunkKey)
              processedSolidBlocks++

              processedSinceYield++
              if (processedSinceYield >= blocksPerFrame) {
                processedSinceYield = 0
                reportProgress('placing-blocks', {
                  touchedChunks: touchedChunkKeys.size,
                })
                await this._yieldToMainThread()
              }
            }
          }
        }
      }

      const touchedChunks = Array.from(touchedChunkKeys)
      for (let index = 0; index < touchedChunks.length; index++) {
        const chunkKey = touchedChunks[index]
        const [chunkX, chunkZ] = chunkKey.split(',').map(Number)
        const chunk = chunkManager.getChunk(chunkX, chunkZ)
        if (!chunk || chunk.state === 'disposed') {
          continue
        }

        if (chunk.state === 'dataReady') {
          const built = chunk.buildMesh()
          if (built) {
            chunk.renderer?.group?.scale?.setScalar?.(chunkManager.renderParams?.scale ?? 1)
          }
        }
        else if (chunk.state === 'meshReady') {
          chunk.renderer?._rebuildFromContainer?.()
          chunk.renderer?.group?.scale?.setScalar?.(chunkManager.renderParams?.scale ?? 1)
        }

        if ((index + 1) % chunksPerFrame === 0) {
          reportProgress('rebuilding-chunks', {
            rebuiltChunks: index + 1,
            totalTouchedChunks: touchedChunks.length,
          })
          await this._yieldToMainThread()
        }
      }

      if (persistModifications) {
        chunkManager.persistence.save()
      }

      stats.touchedChunks = touchedChunkKeys.size

      reportProgress('done', {
        touchedChunks: stats.touchedChunks,
        skipped: stats.skipped,
        importedShapes: shapeUsage,
      })

      const topTextures = [...textureUsage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, count]) => ({ name, count }))

      return {
        status: 'applied',
        totalBlocks: totalSolidBlocks,
        offset: { x: offsetX, y: offsetY, z: offsetZ },
        importDiagnostics: {
          shapeUsage,
          topTextures,
        },
        ...stats,
      }
    }
    finally {
      if (!keepSchematicOnlyMode) {
        chunkManager.setSchematicOnlyMode?.(previousSchematicOnlyMode)
      }
    }
  }
}

export default new SchematicService()
