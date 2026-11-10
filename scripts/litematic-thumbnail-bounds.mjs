import { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import nbt from 'prismarine-nbt'

// Decode every region, including regions the renderer's default-region tight bounds omit.
// Coordinates follow Litematica's x/z/y packing and signed region sizes.
export function litematicOccupiedBounds(document, onBlock = null) {
  if (!document?.Regions)
    return null
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }
  for (const region of Object.values(document.Regions)) {
    const axes = ['x', 'y', 'z']
    const sizes = axes.map(axis => Math.abs(Number(region.Size?.[axis] || 0)))
    const palette = region.BlockStatePalette || []
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
    const mask = (1n << BigInt(bits)) - 1n
    const words = (region.BlockStates || []).map(([high, low]) => (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0))
    const volume = sizes[0] * sizes[1] * sizes[2]
    if (!Number.isSafeInteger(volume) || volume < 0 || words.length * 64 < volume * bits) {
      throw new Error('Invalid litematic region block data')
    }
    for (let index = 0; index < volume; index++) {
      const bit = index * bits
      const wordIndex = Math.floor(bit / 64)
      const shift = bit % 64
      let packed = words[wordIndex] >> BigInt(shift)
      if (shift + bits > 64)
        packed |= words[wordIndex + 1] << BigInt(64 - shift)
      const block = palette[Number(packed & mask)]
      if (!block)
        throw new Error('Invalid litematic palette index')
      if (['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(block.Name))
        continue
      const coordinates = [index % sizes[0], Math.floor(index / (sizes[0] * sizes[2])), Math.floor(index / sizes[0]) % sizes[2]]
      const worldCoordinates = []
      axes.forEach((axis, dimension) => {
        const value = coordinates[dimension] + Number(region.Position?.[axis] || 0) + Math.min(0, Number(region.Size[axis]) + 1)
        worldCoordinates.push(value)
        const suffix = axis.toUpperCase()
        bounds[`min${suffix}`] = Math.min(bounds[`min${suffix}`], value)
        bounds[`max${suffix}`] = Math.max(bounds[`max${suffix}`], value + 1)
      })
      onBlock?.(worldCoordinates, block)
    }
  }
  return Number.isFinite(bounds.minX) ? bounds : null
}

export async function normalizeLitematicForCapture(buffer) {
  const { parsed } = await nbt.parse(Buffer.from(buffer))
  const document = nbt.simplify(parsed)
  const blocks = new Map()
  const bounds = litematicOccupiedBounds(document, (coordinates, block) => {
    const key = coordinates.join(',')
    const previous = blocks.get(key)
    if (previous && JSON.stringify(previous.block) !== JSON.stringify(block)) {
      throw new Error(`Conflicting overlapping regions at ${key}; capture requires an explicit source decision`)
    }
    blocks.set(key, { coordinates, block })
  })
  if (!bounds)
    throw new Error('No occupied blocks')
  const size = [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ]
  const palette = [{ Name: 'minecraft:air' }]
  const paletteIds = new Map([[JSON.stringify(palette[0]), 0]])
  for (const entry of blocks.values()) {
    const key = JSON.stringify(entry.block)
    if (!paletteIds.has(key)) {
      paletteIds.set(key, palette.length)
      palette.push(entry.block)
    }
    entry.paletteIndex = paletteIds.get(key)
  }
  const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
  const words = Array.from({ length: Math.ceil(size[0] * size[1] * size[2] * bits / 64) }, () => 0n)
  for (const { coordinates: [x, y, z], paletteIndex } of blocks.values()) {
    const index = (y - bounds.minY) * size[0] * size[2] + (z - bounds.minZ) * size[0] + x - bounds.minX
    const bit = index * bits
    const wordIndex = Math.floor(bit / 64)
    const shift = bit % 64
    words[wordIndex] |= BigInt(paletteIndex) << BigInt(shift)
    if (shift + bits > 64)
      words[wordIndex + 1] |= BigInt(paletteIndex) >> BigInt(64 - shift)
  }
  const vector = values => ({ type: 'compound', value: Object.fromEntries(['x', 'y', 'z'].map((axis, index) => [axis, { type: 'int', value: values[index] }])) })
  const tileEntities = []
  for (const region of Object.values(parsed.value.Regions.value)) {
    if (region.value.Entities?.value?.value?.length)
      throw new Error('Entity-bearing sources require explicit coordinate normalization')
    const position = region.value.Position.value
    const regionSize = region.value.Size.value
    for (const sourceEntity of region.value.TileEntities?.value?.value || []) {
      const entity = structuredClone(sourceEntity)
      for (const axis of ['x', 'y', 'z']) {
        if (!entity[axis])
          throw new Error('Block entity has no coordinate')
        entity[axis].value += position[axis].value + Math.min(0, regionSize[axis].value + 1) - bounds[`min${axis.toUpperCase()}`]
      }
      tileEntities.push(entity)
    }
  }
  if (parsed.value.Metadata?.value) {
    parsed.value.Metadata.value.RegionCount = { type: 'int', value: 1 }
  }
  parsed.value.Regions = { type: 'compound', value: { capture: { type: 'compound', value: {
    Position: vector([bounds.minX, bounds.minY, bounds.minZ]),
    Size: vector(size),
    BlockStatePalette: { type: 'list', value: { type: 'compound', value: palette.map(block => ({
      Name: { type: 'string', value: block.Name },
      ...(block.Properties ? { Properties: { type: 'compound', value: Object.fromEntries(Object.entries(block.Properties).map(([key, value]) => [key, { type: 'string', value }])) } } : {}),
    })) } },
    BlockStates: { type: 'longArray', value: words.map(word => [Number(BigInt.asIntN(32, word >> 32n)), Number(BigInt.asIntN(32, word))]) },
    Entities: { type: 'list', value: { type: 'compound', value: [] } },
    TileEntities: { type: 'list', value: { type: 'compound', value: tileEntities } },
  } } } }
  return { bounds, buffer: gzipSync(nbt.writeUncompressed(parsed)), blockCount: blocks.size }
}

export async function readLitematicOccupiedBounds(buffer) {
  const { parsed } = await nbt.parse(Buffer.from(buffer))
  return litematicOccupiedBounds(nbt.simplify(parsed))
}
