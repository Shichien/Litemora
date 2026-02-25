/* eslint-disable node/prefer-global/buffer */
// eslint-disable-next-line unicorn/prefer-node-protocol
import { Buffer as BufferPolyfill } from 'buffer'
import { parse, simplify } from 'prismarine-nbt'
import { BLOCK_IDS } from './blocks-config.js'

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BufferPolyfill
}

const MC_TO_PROJECT_MAPPING = {
  'minecraft:grass_block': BLOCK_IDS.GRASS,
  'minecraft:dirt': BLOCK_IDS.DIRT,
  'minecraft:stone': BLOCK_IDS.STONE,
  'minecraft:smooth_stone': BLOCK_IDS.STONE,
  'minecraft:andesite': BLOCK_IDS.GRAVEL,
  'minecraft:polished_andesite': BLOCK_IDS.STONE,
  'minecraft:diorite': BLOCK_IDS.SNOW,
  'minecraft:polished_diorite': BLOCK_IDS.PACKED_ICE,
  'minecraft:clay': BLOCK_IDS.TERRACOTTA,
  'minecraft:polished_blackstone': BLOCK_IDS.TERRACOTTA,
  'minecraft:polished_blackstone_bricks': BLOCK_IDS.TERRACOTTA,
  'minecraft:cracked_polished_blackstone_bricks': BLOCK_IDS.GRAVEL,
  'minecraft:ochre_froglight': BLOCK_IDS.SAND,
  'minecraft:pearlescent_froglight': BLOCK_IDS.SNOW,
  'minecraft:coal_ore': BLOCK_IDS.COAL_ORE,
  'minecraft:iron_ore': BLOCK_IDS.IRON_ORE,
  'minecraft:oak_log': BLOCK_IDS.TREE_TRUNK,
  'minecraft:oak_leaves': BLOCK_IDS.TREE_LEAVES,
  'minecraft:birch_log': BLOCK_IDS.BIRCH_TRUNK,
  'minecraft:birch_leaves': BLOCK_IDS.BIRCH_LEAVES,
  'minecraft:cherry_log': BLOCK_IDS.CHERRY_TRUNK,
  'minecraft:cherry_leaves': BLOCK_IDS.CHERRY_LEAVES,
  'minecraft:sand': BLOCK_IDS.SAND,
  'minecraft:gravel': BLOCK_IDS.GRAVEL,
  'minecraft:red_sand': BLOCK_IDS.RED_SAND,
  'minecraft:terracotta': BLOCK_IDS.TERRACOTTA,
  'minecraft:ice': BLOCK_IDS.ICE,
  'minecraft:packed_ice': BLOCK_IDS.PACKED_ICE,
  'minecraft:snow_block': BLOCK_IDS.SNOW,
  'minecraft:cactus': BLOCK_IDS.CACTUS,
}

const KEYWORD_MAPPING = [
  { keywords: ['coal_ore'], id: BLOCK_IDS.COAL_ORE },
  { keywords: ['iron_ore'], id: BLOCK_IDS.IRON_ORE },
  { keywords: ['red_sand'], id: BLOCK_IDS.RED_SAND },
  { keywords: ['sand'], id: BLOCK_IDS.SAND },
  { keywords: ['snow'], id: BLOCK_IDS.SNOW },
  { keywords: ['packed_ice'], id: BLOCK_IDS.PACKED_ICE },
  { keywords: ['ice'], id: BLOCK_IDS.ICE },
  { keywords: ['gravel'], id: BLOCK_IDS.GRAVEL },
  { keywords: ['terracotta', 'clay', 'mud_bricks'], id: BLOCK_IDS.TERRACOTTA },
  { keywords: ['leaves'], id: BLOCK_IDS.TREE_LEAVES },
  { keywords: ['birch_log'], id: BLOCK_IDS.BIRCH_TRUNK },
  { keywords: ['cherry_log'], id: BLOCK_IDS.CHERRY_TRUNK },
  { keywords: ['log', 'wood', 'stem', 'hyphae'], id: BLOCK_IDS.TREE_TRUNK },
  { keywords: ['grass_block'], id: BLOCK_IDS.GRASS },
  { keywords: ['dirt', 'podzol', 'coarse_dirt', 'mycelium'], id: BLOCK_IDS.DIRT },
  { keywords: ['blackstone', 'deepslate', 'andesite', 'diorite', 'granite', 'cobblestone'], id: BLOCK_IDS.GRAVEL },
]

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
    const { parsed } = await parse(BufferPolyfill.from(decompressed))
    const simplified = simplify(parsed)

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
      resolved[index] = this._resolveProjectBlock(blockName)
    }
    region._paletteResolved = resolved
    return resolved
  }

  _resolveProjectBlock(blockName) {
    if (this._blockResolveCache.has(blockName)) {
      return this._blockResolveCache.get(blockName)
    }

    if (!blockName || blockName === 'minecraft:air') {
      const result = { id: BLOCK_IDS.EMPTY, source: 'air' }
      this._blockResolveCache.set(blockName, result)
      return result
    }

    const exact = MC_TO_PROJECT_MAPPING[blockName]
    if (exact) {
      const result = { id: exact, source: 'exact' }
      this._blockResolveCache.set(blockName, result)
      return result
    }

    const normalizedName = blockName.replace('minecraft:', '')
    for (const rule of KEYWORD_MAPPING) {
      if (rule.keywords.some(keyword => normalizedName.includes(keyword))) {
        const result = { id: rule.id, source: 'keyword' }
        this._blockResolveCache.set(blockName, result)
        return result
      }
    }

    const fallback = { id: BLOCK_IDS.STONE, source: 'default-stone' }
    this._blockResolveCache.set(blockName, fallback)
    return fallback
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

      let linearIndex = 0
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          for (let x = 0; x < sizeX; x++) {
            const paletteIndex = blockIndices[linearIndex++] ?? 0
            const paletteEntry = region.palette[paletteIndex]
            const blockName = paletteEntry?.name || 'minecraft:air'
            const projectBlock = resolvedPalette[paletteIndex] || this._resolveProjectBlock(blockName)
            const projectBlockId = projectBlock.id
            if (projectBlockId === BLOCK_IDS.EMPTY) {
              continue
            }

            const worldX = x + region.position.x
            const worldY = y + region.position.y
            const worldZ = z + region.position.z

            bounds.min.x = Math.min(bounds.min.x, worldX)
            bounds.min.y = Math.min(bounds.min.y, worldY)
            bounds.min.z = Math.min(bounds.min.z, worldZ)
            bounds.max.x = Math.max(bounds.max.x, worldX)
            bounds.max.y = Math.max(bounds.max.y, worldY)
            bounds.max.z = Math.max(bounds.max.z, worldZ)

            seenSolidBlocks++

            const candidate = {
              x: worldX,
              y: worldY,
              z: worldZ,
              id: projectBlockId,
              name: blockName,
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
      chunk.generator.params.seed = chunkManager.seed
      const generated = chunk.generateData()
      if (!generated) {
        return null
      }

      if (typeof chunkManager._applyChunkModifications === 'function') {
        chunkManager._applyChunkModifications(chunk)
      }

      chunk.buildMesh()
      chunk.renderer?.group?.scale?.setScalar?.(chunkManager.renderParams?.scale ?? 1)
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
      blockCount: this._estimateBlockCount(regions),
    }
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

  /**
   * 将原理图注入到世界
   * 这是一个占位符，实现需要与 World/Terrain 系统集成
   */
  async applyToWorld(chunkManager, worldOffset = { x: 0, y: 0, z: 0 }) {
    if (!this.currentSchematic) {
      throw new Error('No schematic loaded')
    }

    if (!chunkManager) {
      throw new Error('ChunkManager is required')
    }

    const schematic = this.currentSchematic

    const offsetX = Math.floor(worldOffset.x ?? 0)
    const offsetY = Math.floor(worldOffset.y ?? 0)
    const offsetZ = Math.floor(worldOffset.z ?? 0)

    const stats = {
      placed: 0,
      replaced: 0,
      skipped: 0,
      mappedByExact: 0,
      mappedByKeyword: 0,
      mappedByDefaultStone: 0,
      unknownMappedToStone: 0,
      touchedChunks: 0,
    }

    const touchedChunkKeys = new Set()

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

      let linearIndex = 0
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          for (let x = 0; x < sizeX; x++) {
            const paletteIndex = blockIndices[linearIndex++] ?? 0
            const paletteEntry = region.palette[paletteIndex]
            const blockName = paletteEntry?.name || 'minecraft:air'
            const projectBlock = resolvedPalette[paletteIndex] || this._resolveProjectBlock(blockName)
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
            else if (projectBlock.source === 'default-stone') {
              stats.mappedByDefaultStone++
              stats.unknownMappedToStone++
            }

            const worldX = x + region.position.x + offsetX
            const worldY = y + region.position.y + offsetY
            const worldZ = z + region.position.z + offsetZ

            const chunkX = Math.floor(worldX / chunkManager.chunkWidth)
            const chunkZ = Math.floor(worldZ / chunkManager.chunkWidth)
            const chunkKey = `${chunkX},${chunkZ}`
            if (!touchedChunkKeys.has(chunkKey)) {
              const chunk = this._ensureChunkReady(chunkManager, chunkX, chunkZ)
              if (!chunk) {
                stats.skipped++
                continue
              }
              touchedChunkKeys.add(chunkKey)
            }

            const existing = chunkManager.getBlockWorld(worldX, worldY, worldZ)
            if (!existing) {
              stats.skipped++
              continue
            }

            if (existing.id === projectBlockId) {
              continue
            }

            if (existing.id !== BLOCK_IDS.EMPTY) {
              chunkManager.removeBlockWorld(worldX, worldY, worldZ)
              stats.replaced++
            }

            const added = chunkManager.addBlockWorld(worldX, worldY, worldZ, projectBlockId)
            if (added) {
              stats.placed++
            }
            else {
              stats.skipped++
            }
          }
        }
      }
    }

    stats.touchedChunks = touchedChunkKeys.size

    return {
      status: 'applied',
      totalBlocks: this._estimateBlockCount(schematic.regions),
      offset: { x: offsetX, y: offsetY, z: offsetZ },
      ...stats,
    }
  }
}

export default new SchematicService()
