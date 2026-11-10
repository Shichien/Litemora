import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'
import nbt from 'prismarine-nbt'
import { litematicOccupiedBounds, normalizeLitematicForCapture } from '../scripts/litematic-thumbnail-bounds.mjs'

function region(position, size, indices) {
  const words = Array.from({ length: Math.ceil(indices.length * 2 / 64) }, () => 0n)
  indices.forEach((value, index) => {
    words[Math.floor(index / 32)] |= BigInt(value) << BigInt(index % 32 * 2)
  })
  return {
    Position: position,
    Size: size,
    BlockStatePalette: [{ Name: 'minecraft:air' }, { Name: 'minecraft:stone' }],
    BlockStates: words.map(word => [Number(word >> 32n), Number(word & 0xFFFFFFFFn)]),
  }
}

test('bounds combine occupied blocks in every region and ignore an empty first region', () => {
  assert.deepEqual(litematicOccupiedBounds({ Regions: {
    empty: region({ x: 100, y: 100, z: 100 }, { x: 1, y: 1, z: 1 }, [0]),
    lower: region({ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }, [1, 0]),
    upper: region({ x: 28, y: 89, z: 3 }, { x: 2, y: 1, z: 1 }, [0, 1]),
  } }), { minX: 0, minY: 0, minZ: 0, maxX: 30, maxY: 90, maxZ: 4 })
})

test('negative region sizes place packed coordinates from the region minimum', () => {
  assert.deepEqual(litematicOccupiedBounds({ Regions: {
    reversed: region({ x: 5, y: 3, z: -2 }, { x: -2, y: -2, z: -2 }, [1, 0, 0, 0, 0, 0, 0, 1]),
  } }), { minX: 4, minY: 2, minZ: -3, maxX: 6, maxY: 4, maxZ: -1 })
})

test('three-bit palette entries span two 64-bit words', () => {
  const source = region({ x: 0, y: 0, z: 0 }, { x: 22, y: 1, z: 1 }, Array.from({ length: 22 }, () => 0))
  source.BlockStatePalette = [{ Name: 'minecraft:air' }, ...Array.from({ length: 4 }, () => ({ Name: 'minecraft:stone' }))]
  // Entry 21 starts at bit 63; palette index 4 stores its high bit in word 1.
  source.BlockStates = [[0, 0], [0, 2]]
  assert.deepEqual(litematicOccupiedBounds({ Regions: { source } }), { minX: 21, minY: 0, minZ: 0, maxX: 22, maxY: 1, maxZ: 1 })
})

function encodeRegions(regions) {
  const vector = value => ({ type: 'compound', value: Object.fromEntries(Object.entries(value).map(([key, number]) => [key, { type: 'int', value: number }])) })
  return nbt.writeUncompressed({ type: 'compound', name: '', value: { Regions: { type: 'compound', value: Object.fromEntries(Object.entries(regions).map(([name, value]) => [name, { type: 'compound', value: {
    Position: vector(value.Position),
    Size: vector(value.Size),
    BlockStates: { type: 'longArray', value: value.BlockStates },
    BlockStatePalette: { type: 'list', value: { type: 'compound', value: value.BlockStatePalette.map(block => ({ Name: { type: 'string', value: block.Name } })) } },
  } }])) } } })
}

test('capture normalization preserves occupied negative coordinates and ignores overlapping air', async () => {
  const source = encodeRegions({
    first: region({ x: -2, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }, [1, 0]),
    second: region({ x: -2, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }, [0, 1]),
  })
  const normalized = await normalizeLitematicForCapture(source)
  const { parsed } = await nbt.parse(normalized.buffer)
  const blocks = []
  const bounds = litematicOccupiedBounds(nbt.simplify(parsed), (coordinates, block) => blocks.push({ coordinates, block }))
  assert.equal(normalized.blockCount, 2)
  assert.deepEqual(bounds, normalized.bounds)
  assert.deepEqual(blocks.map(block => block.coordinates), [[-2, 0, 0], [-1, 0, 0]])
  assert.ok(blocks.every(block => block.block.Name === 'minecraft:stone'))
})

test('capture normalization rejects conflicting occupied region overlaps', async () => {
  const stone = region({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, [1])
  const dirt = region({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, [1])
  dirt.BlockStatePalette[1].Name = 'minecraft:dirt'
  await assert.rejects(normalizeLitematicForCapture(encodeRegions({ stone, dirt })), /Conflicting overlapping regions/)
})

test('capture normalization preserves block properties and typed tile entity metadata', async () => {
  const { parsed: source } = await nbt.parse(encodeRegions({ part: region({ x: -4, y: 3, z: 2 }, { x: -2, y: 1, z: 1 }, [1, 0]) }))
  const part = source.value.Regions.value.part.value
  part.BlockStatePalette.value.value[1].Properties = { type: 'compound', value: { facing: { type: 'string', value: 'north' } } }
  part.TileEntities = { type: 'list', value: { type: 'compound', value: [{ x: { type: 'int', value: 0 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 }, id: { type: 'string', value: 'minecraft:furnace' }, BurnTime: { type: 'short', value: 12 } }] } }
  const normalized = await normalizeLitematicForCapture(nbt.writeUncompressed(source))
  const { parsed } = await nbt.parse(normalized.buffer)
  const result = nbt.simplify(parsed).Regions.capture
  assert.deepEqual(result.BlockStatePalette[1].Properties, { facing: 'north' })
  assert.deepEqual(result.TileEntities[0], { x: 0, y: 0, z: 0, id: 'minecraft:furnace', BurnTime: 12 })
  assert.equal(parsed.value.Regions.value.capture.value.TileEntities.value.value[0].BurnTime.type, 'short')
  assert.deepEqual(result.Position, { x: -5, y: 3, z: 2 })
})

test('empty source yields no capture bounds; corrupt packed data is rejected', () => {
  assert.equal(litematicOccupiedBounds({ Regions: { empty: region({}, { x: 1, y: 1, z: 1 }, [0]) } }), null)
  assert.throws(() => litematicOccupiedBounds({ Regions: { bad: region({}, { x: 100, y: 1, z: 1 }, [1]) } }), /Invalid litematic region/)
})
