/* eslint-disable test/no-import-node-test -- Node test runner */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import init, { SchematicWrapper } from 'nucleation'
import nbt from 'prismarine-nbt'
import { issueAccountSession } from '../functions/api/auth/_shared.js'
import { normalizeSourceFileMetadata } from '../functions/api/gallery/_shared.js'
import { onRequestPost as upload } from '../functions/api/gallery/items.js'
import { onRequestGet as download } from '../functions/api/gallery/source.js'
import { prepareSchematicRendererBuffer } from '../src/js/world/terrain/schematic-renderer-input.js'
import service from '../src/js/world/terrain/schematic-service.js'

const tag = (type, value) => ({ type, value })
const compound = value => tag('compound', value)
const int = value => tag('int', value)
const string = value => tag('string', value)
const list = value => tag('list', { type: 'compound', value })
const bytes = value => tag('byteArray', value)
const bufferOf = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
const serialize = value => nbt.writeUncompressed({ name: '', ...compound(value) })
const packedLong = value => [Number(BigInt.asIntN(32, value >> 32n)), Number(BigInt.asIntN(32, value))]

function legacy(extra = {}) {
  return serialize({ Width: tag('short', 2), Height: tag('short', 1), Length: tag('short', 1), Materials: string('Alpha'), Blocks: bytes([1, 53]), Data: bytes([1, 5]), ...extra })
}
function sponge(version = 2) {
  const blocks = { Palette: compound({ 'minecraft:air': int(0), 'minecraft:stone': int(1) }), BlockData: bytes([1, 0]), BlockEntities: list([]) }
  const root = { Version: int(version), DataVersion: int(3955), Width: tag('short', 2), Height: tag('short', 1), Length: tag('short', 1), Offset: tag('intArray', [-3, 2, 1]) }
  return serialize(version === 3 ? { Schematic: compound({ ...root, Blocks: compound({ Palette: blocks.Palette, Data: blocks.BlockData, BlockEntities: blocks.BlockEntities }) }) } : { ...root, ...blocks })
}
function blueprint({ paletteSize = 17, version = 0, truncate = false } = {}) {
  const palette = Array.from({ length: paletteSize }, (_, index) => ({ Name: string(index === 0 ? 'minecraft:air' : index === 16 ? 'minecraft:gold_block' : 'minecraft:stone') }))
  const bits = Math.max(4, Math.ceil(Math.log2(paletteSize)))
  const perLong = Math.floor(64 / bits)
  const data = Array.from({ length: Math.ceil(4096 / perLong) }, () => 0n)
  // Nonzero at the boundary between padded longs and at the final voxel.
  for (const index of [perLong - 1, perLong, 4095])
    data[Math.floor(index / perLong)] |= BigInt(paletteSize - 1) << BigInt(index % perLong * bits)
  const metadata = serialize({ Version: tag('long', [0, version]), Name: string('Blueprint'), Author: string('Fixture') })
  const structure = gzipSync(serialize({ BlockRegion: list([{ X: int(-1), Y: int(2), Z: int(0), BlockStates: compound({ palette: list(palette), data: tag('longArray', data.map(packedLong)) }) }]) }))
  const sections = [metadata, Buffer.from([]), structure].map((value) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(value.length)
    return Buffer.concat([length, value])
  })
  const result = Buffer.concat([Buffer.from([10, 229, 187, 54]), ...sections])
  return truncate ? result.subarray(0, result.length - 1) : result
}

await init({ module_or_path: await readFile(new URL('../node_modules/nucleation/nucleation_bg.wasm', import.meta.url)) })

for (const version of [1, 2, 3]) {
  test(`Sponge v${version}: real NBT parsing and renderer agreement`, async () => {
    const source = bufferOf(gzipSync(sponge(version)))
    const parsed = await service.parseArrayBuffer(source, { sourceName: 'sample.schem', remember: false })
    const region = Object.values(parsed.regions)[0]
    assert.equal(parsed.format, 'schem')
    assert.deepEqual(region.position, { x: -3, y: 2, z: 1 })
    assert.deepEqual(region._decodedIndices, [1, 0])
    const wrapper = new SchematicWrapper()
    try {
      wrapper.from_data(new Uint8Array(await prepareSchematicRendererBuffer(source)))
      assert.equal(wrapper.get_block_string(0, 0, 0), 'minecraft:stone')
    }
    finally { wrapper.free() }
  })
}

test('MCEdit ID/data decode preserves variants and stair orientation in real renderer', async () => {
  const source = bufferOf(gzipSync(legacy()))
  const parsed = await service.parseArrayBuffer(source, { sourceName: 'legacy.SCHEMATIC', remember: false })
  assert.equal(parsed.name, 'legacy')
  assert.equal(parsed.format, 'schematic')
  const region = Object.values(parsed.regions)[0]
  assert.equal(region.palette[0].name, 'minecraft:granite')
  assert.equal(region.palette[1].properties.half, 'top')
  assert.equal(region.palette[1].properties.facing, 'west')
  const wrapper = new SchematicWrapper()
  try {
    wrapper.from_data(new Uint8Array(await prepareSchematicRendererBuffer(source)))
    assert.equal(wrapper.get_block_string(0, 0, 0), 'minecraft:granite')
    assert.match(wrapper.get_block_string(1, 0, 0), /facing=west/u)
    assert.match(wrapper.get_block_string(1, 0, 0), /half=top/u)
  }
  finally { wrapper.free() }
})

test('26.3 Litematic palettes agree across upload preview, renderer and simulation', async (t) => {
  const { default: initRedstone, RedstoneSim } = await import('../src/js/world/redstone-sim/pkg/redstone_wasm.js')
  await initRedstone({ module_or_path: await readFile(new URL('../src/js/world/redstone-sim/pkg/redstone_wasm_bg.wasm', import.meta.url)) })
  const vector = (x, y, z) => compound({ x: int(x), y: int(y), z: int(z) })
  const dispenser = { id: string('minecraft:dispenser'), x: int(0), y: int(0), z: int(0), Items: list([{ id: string('minecraft:arrow'), count: int(1), Slot: tag('byte', 0) }]) }
  const region = {
    Position: vector(0, 0, 0), Size: vector(2, 1, 1),
    BlockStatePalette: list([{ id: string('minecraft:air') }, { id: string('minecraft:dispenser'), properties: compound({ facing: string('east') }) }]),
    BlockStates: tag('longArray', [[0, 1]]), TileEntities: list([dispenser]),
  }
  const second = { ...region, Position: vector(0, 1, 0), TileEntities: list([]), BlockStatePalette: tag('list', { type: 'string', value: ['minecraft:air', 'minecraft:target'] }) }
  const source = bufferOf(gzipSync(serialize({
    Version: int(6), SubVersion: int(1), MinecraftDataVersion: int(5023),
    Metadata: compound({ Name: string('26.3'), Author: string('fixture'), EnclosingSize: vector(2, 2, 1), RegionCount: int(2) }),
    Regions: compound({ machine: compound(region), sensor: compound(second) }),
  })))
  const parsed = await service.parseArrayBuffer(source, { remember: false })
  assert.deepEqual(parsed.regions.machine.palette[1], { name: 'minecraft:dispenser', properties: { facing: 'east' } })
  assert.equal(parsed.regions.sensor.palette[1].name, 'minecraft:target')
  const converted = new Uint8Array(await prepareSchematicRendererBuffer(source))
  const saved = nbt.simplify((await nbt.parse(Buffer.from(converted))).parsed)
  assert.equal(saved.Regions.machine.TileEntities[0].Items[0].id, 'minecraft:arrow')
  const wrapper = new SchematicWrapper()
  t.after(() => wrapper.free())
  wrapper.from_data(converted)
  assert.match(wrapper.get_block_string(0, 0, 0), /dispenser.*facing=east/u)
  assert.match(wrapper.get_block_string(0, 1, 0), /target/u)
  const sim = new RedstoneSim(new Uint8Array(source), 'litematic', true)
  t.after(() => sim.free())
  assert.equal(JSON.parse(sim.info()).sourceRelease, '26.3')
  assert.match(sim.block_at(0, 0, 0), /dispenser.*facing=east/u)
  sim.initialize()
  sim.interact(0, 1, 0, 'target')
  sim.step(1)
  assert.match(sim.block_at(0, 0, 0), /triggered=true/u)
})

for (const paletteSize of [2, 17]) {
  test(`Axiom BP ${paletteSize} states: padded packing, negative origin and real renderer`, async () => {
    const source = bufferOf(blueprint({ paletteSize }))
    const parsed = await service.parseArrayBuffer(source, { remember: false })
    assert.equal(parsed.format, 'bp')
    assert.equal(parsed.name, 'Blueprint')
    const region = parsed.regions.Region0
    assert.deepEqual(region.position, { x: -16, y: 32, z: 0 })
    assert.equal(region._decodedIndices.filter(Boolean).length, 3)
    const wrapper = new SchematicWrapper()
    try {
      wrapper.from_data(new Uint8Array(await prepareSchematicRendererBuffer(source)))
      assert.equal(wrapper.get_block_string(-1, 47, 15), paletteSize === 17 ? 'minecraft:gold_block' : 'minecraft:stone')
    }
    finally { wrapper.free() }
  })
}

test('reject malformed BP, unsupported versions and unknown extended legacy IDs', async () => {
  await assert.rejects(service.parseArrayBuffer(bufferOf(blueprint({ truncate: true }))), /Truncated Axiom/u)
  await assert.rejects(service.parseArrayBuffer(bufferOf(blueprint({ version: 1 }))), /Unsupported Axiom BP version/u)
  await assert.rejects(service.parseArrayBuffer(bufferOf(legacy({ AddBlocks: bytes([1]) }))), /Unsupported legacy block ID\/data: 257:1/u)
  await assert.rejects(service.parseArrayBuffer(bufferOf(legacy({ Blocks: bytes([1]) }))), /Invalid MCEdit/u)
  assert.throws(() => service._decodeVarIntBlockIndices([128], 1), /Invalid schematic block data/u)
  assert.throws(() => service._decodeVarIntBlockIndices([0, 0], 1), /Invalid schematic block data/u)
})

test('schematic formats upload through JSON and multipart and download original bytes', async () => {
  const records = new Map()
  const env = {
    LITEMORA_SESSION_SECRET: 'formats-test-only',
    LITEMORA_SPACE_KV: {
      async get(key) { return records.get(key) ?? null },
      async put(key, value) { records.set(key, value) },
    },
  }
  const session = await issueAccountSession(env, { id: 'formats-owner', provider: 'github' })
  const formats = [
    ['schem', gzipSync(sponge(3))],
    ['schematic', gzipSync(legacy())],
    ['bp', blueprint()],
    ['litematic', await readFile(new URL('../public/redstone-archive/single-lever-piston-door-3x3.litematic', import.meta.url))],
  ]
  for (const [extension, content] of formats) {
    for (const mode of ['json', 'multipart']) {
      const fileName = `fixture.${extension}`
      const payload = { projectionName: `${extension}${mode}`, fileName, fileBase64: content.toString('base64') }
      const headers = { Authorization: `Bearer ${session.token}` }
      let body
      if (mode === 'json') {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(payload)
      }
      else {
        body = new FormData()
        body.set('projectionName', payload.projectionName)
        body.set('file', new Blob([content]), fileName)
      }
      const result = await upload({ env, request: new Request('https://example.test/api/gallery/items?space=formats-test', { method: 'POST', headers, body }) })
      assert.equal(result.status, 200, `${extension}/${mode}`)
      const { item } = await result.json()
      assert.equal(item.kind, 'schematic')
      const response = await download({ env, request: new Request(`https://example.test/api/gallery/source?space=formats-test&item=${item.projectionSlug}`) })
      assert.equal(response.status, 200)
      const original = await response.arrayBuffer()
      assert.deepEqual(new Uint8Array(original), new Uint8Array(content))
      const parsed = await service.parseArrayBuffer(original, { sourceName: fileName, remember: false })
      assert.equal(parsed.format, extension)
    }
  }
})

test('all five extensions survive backend metadata validation; executable suffixes do not', () => {
  for (const extension of ['schem', 'schematic', 'litematic', 'bp', 'mcpr']) {
    const name = `test.${extension.toUpperCase()}`
    assert.equal(normalizeSourceFileMetadata({ fileName: name, size: 1 }).fileName, name)
  }
  assert.throws(() => normalizeSourceFileMetadata({ fileName: 'test.bp.exe', size: 1 }), /invalid_source_file_type/u)
})
