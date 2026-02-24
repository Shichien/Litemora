import pako from 'pako'
import { parse } from 'prismarine-nbt'

/**
 * Litematica 原理图服务
 * 解析 .litematic 文件并注入方块到地形
 */
class SchematicService {
  constructor() {
    this.currentSchematic = null
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
    const decompressed = pako.inflate(arrayBuffer)
    const { parsed } = await parse(Buffer.from(decompressed))

    const metadata = parsed.value.Metadata || {}
    const regions = parsed.value.Regions || {}

    return {
      name: metadata.Name?.[0] || 'Unknown',
      author: metadata.Author?.[0] || 'Unknown',
      size: {
        x: metadata.Width?.[0] || 0,
        y: metadata.Height?.[0] || 0,
        z: metadata.Length?.[0] || 0,
      },
      regions: this._parseRegions(regions),
      rawNBT: parsed,
    }
  }

  /**
   * 解析原理图的区域（Regions）
   */
  _parseRegions(regionData) {
    const regions = {}

    if (!regionData || !regionData.value) {
      return regions
    }

    Object.entries(regionData.value).forEach(([regionName, regionValue]) => {
      const region = regionValue.value || {}
      const position = region.Position?.[0] || {}
      const size = region.Size?.[0] || {}
      const blockStates = region.BlockStates?.[0] || Buffer.alloc(0)
      const palette = region.Palette?.[0]?.value || {}

      regions[regionName] = {
        position: {
          x: position.x?.[0] || 0,
          y: position.y?.[0] || 0,
          z: position.z?.[0] || 0,
        },
        size: {
          x: size.x?.[0] || 0,
          y: size.y?.[0] || 0,
          z: size.z?.[0] || 0,
        },
        palette: this._parsePalette(palette),
        blockData: blockStates,
      }
    })

    return regions
  }

  /**
   * 解析调色板（方块类型映射）
   */
  _parsePalette(paletteData) {
    const palette = {}

    Object.entries(paletteData).forEach(([index, entry]) => {
      const blockName = entry.value?.Name?.[0] || 'minecraft:air'
      const properties = entry.value?.Properties?.[0]?.value || {}

      palette[Number.parseInt(index)] = {
        name: blockName,
        properties: Object.fromEntries(
          Object.entries(properties).map(([key, val]) => [
            key,
            val[0] || val,
          ]),
        ),
      }
    })

    return palette
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
  async applyToWorld(world, offsetX, offsetY, offsetZ) {
    if (!this.currentSchematic) {
      throw new Error('No schematic loaded')
    }

    const schematic = this.currentSchematic

    // TODO: 遍历 regions 并将方块置入世界
    // 这需要与现有的块管理系统进行交互

    return {
      status: 'applied',
      totalBlocks: this._estimateBlockCount(schematic.regions),
      offset: { x: offsetX, y: offsetY, z: offsetZ },
    }
  }
}

export default new SchematicService()

