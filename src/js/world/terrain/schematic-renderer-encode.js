// Minimal typed NBT writer for the renderer's Litematic interchange payload.
// Original uploads remain untouched; only block states/positions are rendered.
function encodeNbt(type, value, root = false) {
  const chunks = []
  const encoder = new TextEncoder()
  function number(value, size) {
    const bytes = new Uint8Array(size)
    const view = new DataView(bytes.buffer)
    if (size === 8)
      view.setBigInt64(0, BigInt.asIntN(64, BigInt(value)))
    else if (size === 4)
      view.setInt32(0, value)
    else
      view.setUint16(0, value)
    chunks.push(bytes)
  }
  function string(value) {
    const bytes = encoder.encode(String(value))
    if (bytes.length > 65535)
      throw new Error('NBT string too long')
    number(bytes.length, 2)
    chunks.push(bytes)
  }
  function payload(type, value) {
    if (type === 3 || type === 4) {
      number(value, type === 3 ? 4 : 8)
    }
    else if (type === 8) {
      string(value)
    }
    else if (type === 10) {
      for (const [name, [childType, child]] of Object.entries(value)) {
        chunks.push(Uint8Array.of(childType))
        string(name)
        payload(childType, child)
      }
      chunks.push(Uint8Array.of(0))
    }
    else if (type === 9) {
      chunks.push(Uint8Array.of(10))
      number(value.length, 4)
      value.forEach(entry => payload(10, entry))
    }
    else if (type === 12) {
      number(value.length, 4)
      value.forEach(entry => number(entry, 8))
    }
  }
  if (root) {
    chunks.push(Uint8Array.of(type))
    string('')
  }
  payload(type, value)
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

export function normalizePaletteState(entry) {
  const name = typeof entry === 'string' ? entry : entry?.id ?? entry?.Name
  if (typeof name !== 'string' || !name)
    throw new Error('原理图的方块列表中缺少方块名称')
  return { name, properties: entry?.properties ?? entry?.Properties ?? {} }
}

function encodePaletteEntry(state) {
  return {
    Name: [8, state.name],
    Properties: [10, Object.fromEntries(Object.entries(state.properties).map(([key, value]) => [key, [8, value]]))],
  }
}

export function encodeRendererPalette(entries) {
  return encodeNbt(9, entries.map(entry => encodePaletteEntry(normalizePaletteState(entry))))
}

export function encodeRendererLitematic(schematic) {
  const vector = value => [10, Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, [3, value[axis]]]))]
  const regions = {}
  for (const [name, region] of Object.entries(schematic.regions)) {
    regions[name] = [10, {
      Position: vector(region.position),
      Size: vector(region.size),
      BlockStatePalette: [9, Object.values(region.palette).map(encodePaletteEntry)],
      BlockStates: [12, region.blockData],
      TileEntities: [9, []],
      Entities: [9, []],
      PendingBlockTicks: [9, []],
      PendingFluidTicks: [9, []],
    }]
  }
  return encodeNbt(10, {
    Version: [3, 6],
    SubVersion: [3, 1],
    MinecraftDataVersion: [3, schematic.dataVersion || 3955],
    Metadata: [10, {
      Name: [8, schematic.name],
      Author: [8, schematic.author],
      Description: [8, ''],
      EnclosingSize: vector(schematic.size),
      RegionCount: [3, Object.keys(regions).length],
    }],
    Regions: [10, regions],
  }, true)
}
