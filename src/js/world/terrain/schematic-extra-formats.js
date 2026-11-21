import legacyBlocks from '../../generated/legacy-block-states.js'

// Axiom Blueprint v1 container (metadata Version 0):
// https://github.com/nahkd123/file-structures-index/tree/main/includes/mc-schematic/axiom-blueprint-v1
export function isAxiomBlueprint(buffer) {
  const bytes = new Uint8Array(buffer)
  return bytes[0] === 0x0A && bytes[1] === 0xE5 && bytes[2] === 0xBB && bytes[3] === 0x36
}

export async function parseAxiomBlueprint(buffer, service, options) {
  const view = new DataView(buffer)
  let cursor = 4
  function section() {
    if (cursor + 4 > view.byteLength)
      throw new Error('Truncated Axiom BP section length')
    const length = view.getUint32(cursor)
    cursor += 4
    if (length > view.byteLength - cursor)
      throw new Error('Truncated Axiom BP section')
    const result = buffer.slice(cursor, cursor + length)
    cursor += length
    return result
  }
  const metadata = await service._parseNbtPayload(section())
  if (BigInt(metadata.Version ?? -1) !== 0n)
    throw new Error(`Unsupported Axiom BP version: ${metadata.Version}`)
  section() // Embedded PNG thumbnail; the application renders its own preview.
  const structure = await service._parseNbtPayload(section())
  if (cursor !== view.byteLength || !Array.isArray(structure.BlockRegion) || !structure.BlockRegion.length)
    throw new Error('Invalid Axiom BP structure')
  const regions = {}
  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  structure.BlockRegion.forEach((chunk, chunkIndex) => {
    const states = chunk.BlockStates
    if (!Array.isArray(states?.palette) || !states.palette.length)
      throw new Error('Invalid Axiom BP palette')
    const palette = service._parsePalette(states.palette)
    const bits = Math.max(4, Math.ceil(Math.log2(states.palette.length)))
    const perLong = Math.floor(64 / bits)
    const data = states.data || []
    if (states.palette.length > 1 && data.length !== Math.ceil(4096 / perLong))
      throw new Error('Invalid Axiom BP block data length')
    const mask = (1n << BigInt(bits)) - 1n
    const indices = Array.from({ length: 4096 }, (_, index) => {
      const value = data.length ? Number((BigInt.asUintN(64, BigInt(data[Math.floor(index / perLong)])) >> BigInt((index % perLong) * bits)) & mask) : 0
      if (!palette[value])
        throw new Error('Invalid Axiom BP palette index')
      return value
    })
    const position = {}
    for (const [axis, key] of [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) {
      if (!Number.isInteger(chunk[key]) || Math.abs(chunk[key]) > 1875000)
        throw new Error('Invalid Axiom BP region position')
      position[axis] = chunk[key] * 16
      minimum[axis] = Math.min(minimum[axis], position[axis])
      maximum[axis] = Math.max(maximum[axis], position[axis] + 16)
    }
    regions[`Region${chunkIndex}`] = {
      position,
      size: { x: 16, y: 16, z: 16 },
      palette,
      blockData: service._encodeBlockIndices(indices, states.palette.length, 4096),
      totalBlocks: 4096,
      _decodedIndices: indices,
      _solidBlockCount: null,
      _solidYStats: null,
    }
  })
  return {
    name: metadata.Name || service._stripSchematicExtension(options.sourceName) || 'Unknown',
    author: metadata.Author || 'Unknown',
    dataVersion: Number(structure.DataVersion) || null,
    size: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, maximum[axis] - minimum[axis]])),
    regions,
    format: 'bp',
  }
}

export async function parseLegacySchematic(root, service, options) {
  const total = root.Width * root.Height * root.Length
  if (![root.Width, root.Height, root.Length].every(value => Number.isInteger(value) && value > 0)
    || !Number.isSafeInteger(total) || total > 64000000
    || root.Blocks.length !== total || root.Data.length !== total
    || (root.AddBlocks && root.AddBlocks.length !== Math.ceil(total / 2))) {
    throw new Error('Invalid MCEdit schematic dimensions or block data')
  }
  if (root.Materials && root.Materials !== 'Alpha')
    throw new Error(`Unsupported MCEdit materials: ${root.Materials}`)
  const palette = {}
  const indices = []
  const states = new Map()
  for (let index = 0; index < total; index++) {
    const high = root.AddBlocks ? ((root.AddBlocks[index >> 1] >> ((index & 1) * 4)) & 15) : 0
    const id = (root.Blocks[index] & 255) | (high << 8)
    const data = root.Data[index] & 15
    const state = legacyBlocks[`${id}:${data}`]
    if (!state)
      throw new Error(`Unsupported legacy block ID/data: ${id}:${data}`)
    if (!states.has(state)) {
      states.set(state, states.size)
      palette[state] = states.get(state)
    }
    indices.push(states.get(state))
  }
  const bytes = []
  for (let value of indices) {
    while (value > 127) {
      bytes.push((value & 127) | 128)
      value >>>= 7
    }
    bytes.push(value)
  }
  const schematic = service._parseSpongeSchematic({ ...root, Palette: palette, BlockData: bytes, Offset: [0, 0, 0], DataVersion: 1631 }, options)
  schematic.format = 'schematic'
  return schematic
}
