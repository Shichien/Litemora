/* eslint-disable node/prefer-global/buffer */
// eslint-disable-next-line unicorn/prefer-node-protocol
import { Buffer as BufferPolyfill } from 'buffer'

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BufferPolyfill
}

const EMPTY_BLOCK_NAMES = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
])

/**
 * Litematica 原理图服务
 * 解析 .litematic 文件并注入方块到地形
 */
class SchematicService {
  constructor() {
    this.currentSchematic = null
    this.pako = null
    this.nbtParser = null
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

  async _loadNbtParser() {
    if (this.nbtParser) {
      return this.nbtParser
    }

    const nbtParserModule = await import('./nbt-browser.js')
    this.nbtParser = {
      parseNbt: nbtParserModule.parseNbt,
      simplifyNbt: nbtParserModule.simplifyNbt,
    }
    return this.nbtParser
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
          const schematic = await this.parseArrayBuffer(arrayBuffer)
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
   * 从 ArrayBuffer 解析原理图
   * @param {ArrayBuffer} arrayBuffer
   * @param {{remember?: boolean}} options
   * @returns {Promise<object>} 解析后的原理图对象
   */
  async parseArrayBuffer(arrayBuffer, options = {}) {
    const schematic = await this._parseBuffer(arrayBuffer, options)
    if (options.remember !== false) {
      this.currentSchematic = schematic
    }
    return schematic
  }

  /**
   * 内部方法：从 ArrayBuffer 解析原理图
   */
  async _parseBuffer(arrayBuffer, options = {}) {
    // Litematica 文件是 gzip 压缩的 NBT 格式
    const pako = await this._loadPako()
    const nbtParser = await this._loadNbtParser()
    const decompressed = pako.inflate(arrayBuffer)
    const { parsed } = await nbtParser.parseNbt(BufferPolyfill.from(decompressed))
    const simplified = nbtParser.simplifyNbt(parsed)

    const metadata = simplified.Metadata || {}
    const regions = simplified.Regions || {}

    const schematic = {
      name: metadata.Name || 'Unknown',
      author: metadata.Author || 'Unknown',
      dataVersion: Number(simplified.MinecraftDataVersion) || null,
      size: {
        x: metadata.EnclosingSize?.x || 0,
        y: metadata.EnclosingSize?.y || 0,
        z: metadata.EnclosingSize?.z || 0,
      },
      regions: this._parseRegions(regions),
    }

    if (options.includeRawNbt) {
      schematic.rawNBT = simplified
    }

    return schematic
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

  _toInt64BigInt(value) {
    return BigInt.asIntN(64, this._toUint64BigInt(value))
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

  _buildRuntimePalette(region) {
    if (region._runtimePalette) {
      return region._runtimePalette
    }

    region._runtimePalette = Object.values(region.palette || {}).map((entry) => {
      return {
        name: entry?.name || 'minecraft:air',
        properties: Object.fromEntries(
          Object.entries(entry?.properties || {}).map(([key, value]) => [String(key), String(value)]),
        ),
      }
    })

    return region._runtimePalette
  }

  _buildRuntimeBlockData(region) {
    if (region._runtimeBlockData) {
      return region._runtimeBlockData
    }

    const sourceValues = Array.from(region.blockData || [], value => this._toUint64BigInt(value))
    const packed = new Int32Array(sourceValues.length * 2)

    for (let index = 0; index < sourceValues.length; index++) {
      const value = sourceValues[index]
      packed[index * 2] = Number(BigInt.asIntN(32, value >> 32n))
      packed[(index * 2) + 1] = Number(BigInt.asIntN(32, value & 0xFFFFFFFFn))
    }

    region._runtimeBlockData = packed

    return region._runtimeBlockData
  }

  buildRuntimePayload(schematic = this.currentSchematic) {
    if (!schematic) {
      throw new Error('No schematic loaded')
    }

    const runtimeRegions = {}

    for (const [regionName, region] of Object.entries(schematic.regions || {})) {
      runtimeRegions[regionName] = {
        position: {
          x: Number(region?.position?.x || 0),
          y: Number(region?.position?.y || 0),
          z: Number(region?.position?.z || 0),
        },
        size: {
          x: Number(region?.size?.x || 0),
          y: Number(region?.size?.y || 0),
          z: Number(region?.size?.z || 0),
        },
        palette: this._buildRuntimePalette(region),
        blockData: this._buildRuntimeBlockData(region),
        totalBlocks: Number(region?.totalBlocks || 0),
      }
    }

    return {
      name: schematic.name || 'Unknown',
      author: schematic.author || 'Unknown',
      dataVersion: Number(schematic.dataVersion) || null,
      size: {
        x: Number(schematic?.size?.x || 0),
        y: Number(schematic?.size?.y || 0),
        z: Number(schematic?.size?.z || 0),
      },
      regions: runtimeRegions,
    }
  }

  _countSolidBlocks(region) {
    if (typeof region._solidBlockCount === 'number') {
      return region._solidBlockCount
    }

    const blockIndices = this._getDecodedIndices(region)

    let solidCount = 0
    for (let index = 0; index < blockIndices.length; index++) {
      const paletteIndex = blockIndices[index] ?? 0
      const blockName = region.palette?.[paletteIndex]?.name || 'minecraft:air'
      if (!EMPTY_BLOCK_NAMES.has(blockName)) {
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

  /**
   * 遍历所有实体方块
   * @param {(entry:{x:number,y:number,z:number,blockName:string,properties:Record<string,string>,paletteIndex:number,regionName:string,region:object})=>void} callback
   * @param {object|null} schematic
   */
  forEachSolidBlock(callback, schematic = this.currentSchematic) {
    if (!schematic) {
      throw new Error('No schematic loaded')
    }

    for (const [regionName, region] of Object.entries(schematic.regions || {})) {
      const sizeX = Math.abs(region.size.x)
      const sizeY = Math.abs(region.size.y)
      const sizeZ = Math.abs(region.size.z)
      const totalBlocks = sizeX * sizeY * sizeZ
      if (totalBlocks <= 0) {
        continue
      }

      const blockIndices = this._getDecodedIndices(region)
      const worldBase = this._getRegionWorldBase(region)

      let linearIndex = 0
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          for (let x = 0; x < sizeX; x++) {
            const paletteIndex = blockIndices[linearIndex++] ?? 0
            const paletteEntry = region.palette[paletteIndex]
            const blockName = paletteEntry?.name || 'minecraft:air'
            if (EMPTY_BLOCK_NAMES.has(blockName)) {
              continue
            }

            callback({
              x: worldBase.x + x,
              y: worldBase.y + y,
              z: worldBase.z + z,
              blockName,
              properties: paletteEntry?.properties || {},
              paletteIndex,
              regionName,
              region,
            })
          }
        }
      }
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
    const worldBase = this._getRegionWorldBase(region)

    let linearIndex = 0
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let belowZeroCount = 0

    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        for (let x = 0; x < sizeX; x++) {
          const paletteIndex = blockIndices[linearIndex++] ?? 0
          const blockName = region.palette?.[paletteIndex]?.name || 'minecraft:air'
          if (EMPTY_BLOCK_NAMES.has(blockName)) {
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
      bounds: this._collectSolidBounds(regions),
    }
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

  _collectSolidBounds(regions) {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY

    for (const region of Object.values(regions)) {
      const sizeX = Math.abs(region.size.x)
      const sizeY = Math.abs(region.size.y)
      const sizeZ = Math.abs(region.size.z)
      const totalBlocks = sizeX * sizeY * sizeZ
      if (totalBlocks <= 0) {
        continue
      }

      const blockIndices = this._getDecodedIndices(region)
      const worldBase = this._getRegionWorldBase(region)
      let linearIndex = 0

      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          for (let x = 0; x < sizeX; x++) {
            const paletteIndex = blockIndices[linearIndex++] ?? 0
            const blockName = region.palette?.[paletteIndex]?.name || 'minecraft:air'
            if (EMPTY_BLOCK_NAMES.has(blockName)) {
              continue
            }

            const worldX = x + worldBase.x
            const worldY = y + worldBase.y
            const worldZ = z + worldBase.z

            minX = Math.min(minX, worldX)
            minY = Math.min(minY, worldY)
            minZ = Math.min(minZ, worldZ)
            maxX = Math.max(maxX, worldX)
            maxY = Math.max(maxY, worldY)
            maxZ = Math.max(maxZ, worldZ)
          }
        }
      }
    }

    if (!Number.isFinite(minX)) {
      return {
        minX: null,
        minY: null,
        minZ: null,
        maxX: null,
        maxY: null,
        maxZ: null,
      }
    }

    return {
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
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
      touchedChunks: 0,
      worldClearedChunks: 0,
      skippedOutOfHeight: 0,
    }
    const placedBounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
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

    reportProgress('prepare', {
      replaceWorld,
    })

    try {
      if (replaceWorld) {
        chunkManager.setMinecraftRenderOverlayActive?.(false)
        chunkManager.minecraftSchematicLayer?.clear?.()
        chunkManager.setSchematicOnlyMode?.(true)
        chunkManager.persistence?.clearAllModifications?.()

        const loadedChunks = Array.from(chunkManager.chunks?.entries?.() || [])
        for (let index = 0; index < loadedChunks.length; index++) {
          const [chunkKey, chunk] = loadedChunks[index]
          if (!chunk || chunk.state === 'disposed') {
            continue
          }

          chunk.dispose?.()
          chunkManager.chunks?.delete?.(chunkKey)
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
        const worldBase = this._getRegionWorldBase(region)

        let linearIndex = 0
        for (let y = 0; y < sizeY; y++) {
          for (let z = 0; z < sizeZ; z++) {
            for (let x = 0; x < sizeX; x++) {
              const paletteIndex = blockIndices[linearIndex++] ?? 0
              const paletteEntry = region.palette[paletteIndex]
              const blockName = paletteEntry?.name || 'minecraft:air'
              if (
                blockName === 'minecraft:air'
                || blockName === 'minecraft:cave_air'
                || blockName === 'minecraft:void_air'
              ) {
                continue
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

              const existing = chunkManager.minecraftSchematicLayer?.getBlock?.(worldX, worldY, worldZ)
              chunkManager.setImportedMinecraftBlock?.(
                worldX,
                worldY,
                worldZ,
                blockName,
                paletteEntry?.properties || {},
              )

              if (existing) {
                stats.replaced++
              }
              else {
                stats.placed++
              }

              placedBounds.minX = Math.min(placedBounds.minX, worldX)
              placedBounds.minY = Math.min(placedBounds.minY, worldY)
              placedBounds.minZ = Math.min(placedBounds.minZ, worldZ)
              placedBounds.maxX = Math.max(placedBounds.maxX, worldX)
              placedBounds.maxY = Math.max(placedBounds.maxY, worldY)
              placedBounds.maxZ = Math.max(placedBounds.maxZ, worldZ)

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

      chunkManager.syncMinecraftSchematicLayerState?.({
        scheduleSave: persistModifications,
      })

      if (persistModifications) {
        stats.persisted = stats.placed + stats.replaced
        chunkManager.persistence.save()
      }

      stats.touchedChunks = touchedChunkKeys.size
      chunkManager._updateStats?.()

      reportProgress('done', {
        touchedChunks: stats.touchedChunks,
        skipped: stats.skipped,
      })

      return {
        status: 'applied',
        totalBlocks: totalSolidBlocks,
        offset: { x: offsetX, y: offsetY, z: offsetZ },
        placedBounds: Number.isFinite(placedBounds.minX)
          ? { ...placedBounds }
          : {
              minX: null,
              minY: null,
              minZ: null,
              maxX: null,
              maxY: null,
              maxZ: null,
            },
        importDiagnostics: {
          renderMode: 'minecraft-native',
          importedChunkCount: touchedChunkKeys.size,
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
