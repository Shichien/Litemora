import assert from 'node:assert/strict'
/* eslint test/no-import-node-test: off */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import test from 'node:test'
import JSZip from 'jszip'
import { BinaryReader } from '../src/js/replaymod/replaymod-binary.js'
import { loadReplayMod } from '../src/js/replaymod/replaymod-loader.js'
import { decodeRecording, parseReplayMod, SUPPORTED_REPLAYMOD_VERSIONS } from '../src/js/replaymod/replaymod-parser.js'
import { ReplayModPlayback } from '../src/js/replaymod/replaymod-playback.js'

// Hand-written wire fixtures: the decoder's schema interpreter is deliberately NOT used to encode.
const cat = (...parts) => Buffer.concat(parts.flat(Infinity).map(p => typeof p === 'number' ? Buffer.from([p & 255]) : p))
function i16(n) {
  const b = Buffer.alloc(2)
  b.writeInt16BE(n)
  return b
}
function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}
function i32(n) {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n)
  return b
}
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
function long(n) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt.asUintN(64, BigInt(n)))
  return b
}
function f32(n) {
  const b = Buffer.alloc(4)
  b.writeFloatBE(n)
  return b
}
function f64(n) {
  const b = Buffer.alloc(8)
  b.writeDoubleBE(n)
  return b
}
function vi(n) {
  const b = []
  let v = n >>> 0
  do {
    const x = v & 127
    v >>>= 7
    b.push(x | (v ? 128 : 0))
  } while (v)
  return Buffer.from(b)
}
function vl(n) {
  const b = []
  let v = BigInt(n)
  do {
    const x = Number(v & 127n)
    v >>= 7n
    b.push(x | (v ? 128 : 0))
  } while (v)
  return Buffer.from(b)
}
const str = s => cat(vi(Buffer.byteLength(s)), Buffer.from(s))
const nstr = s => cat(u16(Buffer.byteLength(s)), Buffer.from(s))
const tag = (type, name, payload) => cat(type, nstr(name), payload)
const compound = (tags, named = false) => cat(10, named ? u16(0) : [], tags, 0)
const dims = () => [tag(3, 'min_y', i32(-16)), tag(3, 'height', i32(16))]
const dimElement = () => cat(dims(), 0)
function codec(named) {
  const entry = cat(tag(8, 'name', nstr('minecraft:overworld')), tag(3, 'id', i32(0)), tag(10, 'element', dimElement()), 0)
  return compound([tag(10, 'minecraft:dimension_type', cat(tag(8, 'type', nstr('minecraft:dimension_type')), tag(9, 'value', cat(10, i32(1), entry)), 0))], named)
}
const uuid = Buffer.from('00000000000040008000000000000001', 'hex')
const packedPos = (x, y, z) => long((BigInt.asUintN(26, BigInt(x)) << 38n) | (BigInt.asUintN(26, BigInt(z)) << 12n) | BigInt.asUintN(12, BigInt(y)))
const packedSection = (x, y, z) => long((BigInt.asUintN(22, BigInt(x)) << 42n) | (BigInt.asUintN(22, BigInt(z)) << 20n) | BigInt.asUintN(20, BigInt(y)))
const tables = Object.fromEntries(await Promise.all([763, 765, 767, 769].map(async p => [p, (await import(`../src/js/replaymod/data/protocol-${p}.js`)).default])))
const meta = p => ({ fileFormat: 'MCPR', fileFormatVersion: 14, protocolVersion: p, mcversion: tables[p].version, duration: 5000, generator: 'hand-written binary test fixture' })
function packet(p, state, name, body = Buffer.alloc(0), time = 0) {
  const id = Object.entries(tables[p].states[state].names).find(([, n]) => n === name)?.[0]
  assert.notEqual(id, undefined, `${p}/${state}/${name} must exist`)
  const payload = cat(vi(Number(id)), body)
  return cat(i32(time), i32(payload.length), payload)
}
function spawnInfo(p, name = 'minecraft:overworld') {
  return cat(vi(0), str(name), long(0), 0, 255, 0, 0, 0, vi(0), p === 769 ? vi(63) : [])
}
function join(p) {
  if (p === 763)
    return cat(i32(-99), 0, 0, 255, vi(1), str('minecraft:overworld'), codec(true), str('minecraft:overworld'), str('minecraft:overworld'), long(0), vi(20), vi(8), vi(8), 0, 1, 0, 0, 0, vi(0))
  const prefix = cat(i32(-99), 0, vi(1), str('minecraft:overworld'), vi(20), vi(8), vi(8), 0, 1, 0)
  if (p === 765)
    return cat(prefix, str('minecraft:overworld'), str('minecraft:overworld'), long(0), 0, 255, 0, 0, 0, vi(0))
  return cat(prefix, spawnInfo(p), 0)
}
function initial(p) {
  const records = [packet(p, 'login', 'success', cat(uuid, str('FixturePlayer'), vi(0), p === 767 ? [0] : []))]
  if (p >= 765) {
    records.push(packet(p, 'configuration', 'registry_data', p === 765 ? codec(false) : cat(str('minecraft:dimension_type'), vi(1), str('minecraft:overworld'), 1, compound(dims()))))
    records.push(packet(p, 'configuration', 'finish_configuration'))
  }
  records.push(packet(p, 'play', 'login', join(p)))
  return records
}
function chunk(p, { uniform = 1, indirect = false, direct = false, x = -2, z = 3, padding = 0, badLongCount = false, nonAir = 4096 } = {}) {
  let states
  if (indirect || direct) {
    const bits = direct ? 15 : 4
    const perLong = Math.floor(64 / bits)
    const words = []
    for (let i = 0; i < Math.ceil(4096 / perLong); i++) {
      let value = 0n
      for (let j = 0; j < perLong && i * perLong + j < 4096; j++) {
        const index = i * perLong + j
        const state = index === 4095 || index === 271 ? 1 : 0
        value |= BigInt(state) << BigInt(j * bits)
      }
      words.push(long(value))
    }
    states = cat(bits, indirect ? cat(vi(2), vi(0), vi(1)) : [], vi(words.length + (badLongCount ? 1 : 0)), words)
  }
  else {
    states = cat(0, vi(uniform), vi(0))
  }
  const section = cat(i16(nonAir), states, 0, vi(0), vi(0), Buffer.alloc(padding))
  return cat(i32(x), i32(z), compound([], p === 763), vi(section.length), section, vi(1), 0x1F, i16(-1), vi(1), compound([tag(8, 'test', nstr('block-entity'))], p === 763), vi(0), vi(0), vi(0), vi(0), vi(0), vi(0))
}
function spawn(p, { id = 7, type = 'item', player = false } = {}) {
  const typeId = tables[p].entities.find(([, n]) => n === type)[0]
  if (player && p === 763)
    return packet(p, 'play', 'named_entity_spawn', cat(vi(id), uuid, f64(1), f64(-2), f64(3), 64, 32), 30)
  return packet(p, 'play', 'spawn_entity', cat(vi(id), player ? uuid : Buffer.alloc(16, 2), vi(typeId), f64(1), f64(-2), f64(3), 32, 64, 0, vi(0), i16(0), i16(0), i16(0)), 30)
}
function slot(p, withComponents = false) {
  const item = tables[p].items.find(([, n]) => n === 'diamond')[0]
  if (p <= 765)
    return cat(1, vi(item), 3, compound([tag(3, 'Damage', i32(4))], p === 763))
  // Component 3=damage, an independent scalar component followed by removed custom_name(5).
  return cat(vi(3), vi(item), vi(withComponents ? 1 : 0), vi(withComponents ? 1 : 0), withComponents ? cat(vi(3), vi(4), vi(5)) : [])
}
async function archive(p, records, extra = {}) {
  const zip = new JSZip()
  zip.file('metaData.json', JSON.stringify({ ...meta(p), ...extra }))
  zip.file('recording.tmcpr', cat(records))
  // Deliberately conflicting private sidecar; the raw decoder must never use it.
  zip.file('redstone/render-v2.bin', new Uint8Array([255, 1, 2, 3]))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

for (const p of [763, 765, 767, 769]) {
  test(`raw ${tables[p].version}: chunks, item data, movement, teleport, unload, dimension reset, millisecond seek events`, async () => {
    const records = initial(p)
    records.push(packet(p, 'play', 'map_chunk', chunk(p, { indirect: true }), 12))
    records.push(packet(p, 'play', 'block_change', cat(packedPos(-31, -1, 49), vi(1)), 21))
    records.push(packet(p, 'play', 'multi_block_change', cat(packedSection(-2, -1, 3), vi(1), vl((1n << 12n) | 0x23Fn)), 22))
    records.push(spawn(p), spawn(p, { id: 8, type: 'player', player: true }))
    records.push(packet(p, 'play', 'entity_metadata', cat(vi(7), 8, vi(7), slot(p, true), 255), 31))
    records.push(packet(p, 'play', 'rel_entity_move', cat(vi(7), i16(4096), i16(-2048), i16(0), 1), 250))
    records.push(packet(p, 'play', 'entity_move_look', cat(vi(8), i16(4096), i16(0), i16(0), 128, 0, 1), 260))
    const teleport = p === 769 ? cat(vi(7), f64(9), f64(-3), f64(12), f64(0), f64(0), f64(0), f32(90), f32(45), u32(0), 1) : cat(vi(7), f64(9), f64(-3), f64(12), 64, 32, 1)
    records.push(packet(p, 'play', 'entity_teleport', teleport, 999))
    records.push(packet(p, 'play', 'entity_destroy', cat(vi(1), vi(7)), 1000))
    records.push(packet(p, 'play', 'unload_chunk', p === 763 ? cat(i32(-2), i32(3)) : cat(i32(3), i32(-2)), 1001))
    const respawn = p >= 767 ? cat(spawnInfo(p, 'test:second'), 0) : cat(str('minecraft:overworld'), str('test:second'), long(0), 0, 255, 0, 0, p === 763 ? [0, 0, vi(0)] : [0, vi(0), 0])
    records.push(packet(p, 'play', 'respawn', respawn, 1234))
    const r = await parseReplayMod(await archive(p, records))
    assert.equal(r.durationMs, 5000)
    assert.equal(r.metadata.protocolVersion, p)
    assert.equal(r.metadata.playerEntityId, 8)
    assert.deepEqual(r.initialCamera, { x: 1, y: -2, z: 3, yaw: 90, pitch: 45, dimension: 'minecraft:overworld' })
    const c = r.events.find(e => e.type === 'chunk')
    assert.deepEqual([c.x, c.z, c.sections[0].y, c.timeMs], [-2, 3, -1, 12])
    assert.equal(c.sections[0].states[271], 1)
    assert.equal(c.sections[0].states[4095], 1)
    assert.equal(c.sections[0].states[270], 0)
    assert.equal(c.blockEntities[0].data.test, 'block-entity')
    assert.deepEqual([c.blockEntities[0].x, c.blockEntities[0].y, c.blockEntities[0].z], [-31, -1, 63])
    assert.equal(r.events.find(e => e.type === 'entitySpawn' && e.id === 7).entityType, 'minecraft:item')
    const item = r.events.find(e => e.type === 'entityData').item
    assert.deepEqual([item.name, item.count], ['minecraft:diamond', 3])
    if (p <= 765) {
      assert.equal(item.nbt.Damage, 4)
    }
    else {
      assert.equal(item.components[0].type, 'damage')
      assert.equal(item.components[0].data, 4)
    }
    assert.deepEqual(r.events.find(e => e.type === 'blocks').changes[0], { x: -30, y: -1, z: 51, state: 1 })
    const moves = r.events.filter(e => e.type === 'entityMove' && e.id === 7)
    assert.deepEqual(moves.map(e => [e.timeMs, e.x, e.y, e.z, e.yaw]), [[250, 2, -2.5, 3, 90], [999, 9, -3, 12, 90]])
    assert.equal(r.events.find(e => e.type === 'camera' && e.timeMs === 260).x, 2)
    assert.equal(r.events.at(-1).dimension, 'test:second')
    assert.equal(r.events.at(-1).timeMs, 1234)
    assert.equal(r.blockStates[1].name, 'minecraft:stone')
    assert.equal(r.blockStates[1].boundingBox, 'block')
    assert.equal(r.blockStates[1].transparent, false)
    const piston = r.blockStates.find(b => b.name === 'minecraft:piston' && b.properties.facing === 'east' && b.properties.extended === 'true')
    assert.ok(piston, 'canonical block state properties retained')
    // Reconstruct independently from the event stream both forwards and backwards.
    const at = (time) => {
      let state = 0
      for (const event of r.events) {
        if (event.timeMs > time)
          break
        if (event.type === 'dimension' || event.type === 'unloadChunk')
          state = 0
        if (event.type === 'chunk')
          state = event.sections[0].states[15 * 256 + 1 * 16 + 1]
        if (event.type === 'block' && event.x === -31 && event.y === -1 && event.z === 49)
          state = event.state
      }
      return state
    }
    assert.deepEqual([at(21), at(20), at(1001), at(21)], [1, 0, 0, 1])
    assert.ok(r.events.every(event => Number.isFinite(event.timeMs)))
    const playback = new ReplayModPlayback(r)
    assert.equal(playback.seek(21).blockAt(-31, -1, 49), 1)
    assert.equal(playback.seek(20).blockAt(-31, -1, 49), 0)
    const movingItem = playback.seek(250).entities.get(7)
    assert.deepEqual([movingItem.x, movingItem.y, movingItem.z], [2, -2.5, 3])
    assert.equal(playback.seek(1001).sections.size, 0)
    assert.equal(playback.seek(21).blockAt(-31, -1, 49), 1)
    assert.equal(playback.seek(1234).entities.size, 0)
  })
}

test('direct 15-bit state palette uses padded longs, singleton sections and bounded zero padding', async () => {
  const r = await decodeRecording(cat(initial(763), packet(763, 'play', 'map_chunk', chunk(763, { direct: true, padding: 7 }), 1), packet(763, 'play', 'map_chunk', chunk(763, { uniform: 1 }), 2)), meta(763))
  const chunks = r.events.filter(e => e.type === 'chunk')
  assert.equal(chunks[0].sections[0].states[4095], 1)
  assert.equal(chunks[0].sections[0].states[4094], 0)
  assert.equal(chunks[1].sections[0].states[0], 1)
})

test('legacy explosion clears blocks and piston action stays explicit', async () => {
  const pistonId = tables[763].blocks.find(b => b[2] === 'piston')[6]
  const records = cat(initial(763), packet(763, 'play', 'explosion', cat(f64(-1.5), f64(-2.2), f64(2.9), f32(3), vi(1), 1, 0, 255, f32(0), f32(0), f32(0)), 55), packet(763, 'play', 'block_action', cat(packedPos(1, -1, 2), 0, 5, vi(pistonId)), 56))
  const r = await decodeRecording(records, meta(763))
  assert.deepEqual(r.events.find(e => e.type === 'blocks').changes, [{ x: -1, y: -3, z: 1, state: 0 }])
  assert.equal(r.events.find(e => e.type === 'blockAction').block, 'minecraft:piston')
  assert.ok(r.warnings.some(w => w.code === 'PISTON_SIMULATION_REQUIRED'))
})

test('1.21.4 absolute entity sync, relative teleport, and camera flags use corrected layout', async () => {
  const p = 769
  const camera = (x, flags) => cat(vi(1), f64(x), f64(-4), f64(6), f64(0), f64(0), f64(0), f32(15), f32(5), u32(flags))
  const r = await decodeRecording(cat(initial(p), spawn(p), packet(p, 'play', 'sync_entity_position', cat(vi(7), f64(10), f64(-2), f64(20), f64(0), f64(0), f64(0), f32(45), f32(0), 1), 50), packet(p, 'play', 'entity_teleport', cat(vi(7), f64(2), f64(-1), f64(3), f64(0), f64(0), f64(0), f32(5), f32(0), u32(1 | 4 | 8), 1), 60), packet(p, 'play', 'position', camera(1, 0), 70), packet(p, 'play', 'position', camera(2, 1), 80)), meta(p))
  const last = r.events.filter(e => e.type === 'entityMove').at(-1)
  assert.deepEqual([last.x, last.y, last.z, last.yaw], [12, -1, 23, 50])
  assert.equal(r.events.at(-1).x, 3)
})

test('metadata optional global position consumes dimension and packed coordinates', async () => {
  for (const p of [763, 765, 767, 769]) {
    const r = await decodeRecording(cat(initial(p), spawn(p), packet(p, 'play', 'entity_metadata', cat(vi(7), 9, vi(p < 767 ? 23 : 25), 1, str('minecraft:overworld'), packedPos(1, -3, 4), 10, vi(1), vi(73), 255), 40)), meta(p))
    const entries = r.events.find(e => e.type === 'entityData').metadata
    assert.equal(entries[0].value.position.y, -3)
    assert.equal(entries[1].value, 73)
  }
})

test('reject unsupported versions, missing raw stream, invalid timestamps and malformed packet/palette lengths', async () => {
  assert.ok(SUPPORTED_REPLAYMOD_VERSIONS.includes('1.21.4'))
  await assert.rejects(parseReplayMod(await archive(763, initial(763), { mcversion: '1.22', protocolVersion: 999 })), /Supported Java versions/)
  const zip = new JSZip()
  zip.file('metaData.json', JSON.stringify(meta(763)))
  zip.file('redstone/render-v2.bin', 'not raw')
  await assert.rejects(parseReplayMod(await zip.generateAsync({ type: 'uint8array' })), /missing recording.tmcpr/)
  await assert.rejects(decodeRecording(cat(initial(763), i32(1), i32(0x7FFFFFFF)), meta(763)), /packet length/)
  await assert.rejects(decodeRecording(cat(initial(763), i32(-1), i32(0)), meta(763)), /timestamp/)
  await assert.rejects(decodeRecording(cat(initial(763), i32(1), i32(3), 1), meta(763)), /Truncated/)
  await assert.rejects(decodeRecording(cat(initial(763), packet(763, 'play', 'map_chunk', chunk(763, { indirect: true, badLongCount: true }), 1)), meta(763)), /Palette long count/)
  await assert.rejects(decodeRecording(cat(initial(763), packet(763, 'play', 'map_chunk', chunk(763, { x: 2_000_000 }), 1)), meta(763)), /coordinate/)
  await assert.rejects(decodeRecording(cat(initial(763), packet(763, 'play', 'block_change', cat(packedPos(0, 1000, 0), vi(1)), 1)), meta(763)), /outside current dimension/)
  await assert.rejects(decodeRecording(cat(initial(763), i32(1), i32(2), vi(0x7F)), meta(763)), /Truncated|Unknown/)
  assert.throws(() => new BinaryReader(new Uint8Array([255, 255, 255, 255, 255])).varint(), /32 bits/)
})

test('archive and decoded memory ceilings, decompression CRC, cancellation, browser-safe entrypoint', async () => {
  const bytes = await archive(763, initial(763))
  await assert.rejects(parseReplayMod(bytes, { limits: { maxArchiveBytes: 10 } }), /exceeds/)
  await assert.rejects(parseReplayMod(bytes, { limits: { maxRecordingBytes: 10 } }), /memory limit/)
  await assert.rejects(parseReplayMod(bytes, { limits: { maxArchiveBytes: Number.MAX_SAFE_INTEGER } }), /only lower defaults/)
  await assert.rejects(decodeRecording(cat(initial(763), packet(763, 'play', 'map_chunk', chunk(763), 1)), meta(763), { limits: { maxDecodedBytes: 1000 } }), /memory limit/)
  const storedZip = new JSZip()
  storedZip.file('metaData.json', JSON.stringify(meta(763)))
  storedZip.file('recording.tmcpr', cat(initial(763)))
  const corrupted = await storedZip.generateAsync({ type: 'uint8array', compression: 'STORE' })
  const marker = Buffer.from(corrupted).indexOf(Buffer.from('FixturePlayer'))
  assert.ok(marker > 0)
  corrupted[marker] ^= 1
  await assert.rejects(parseReplayMod(corrupted), /CRC mismatch/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(loadReplayMod(bytes, { signal: controller.signal }), { name: 'AbortError' })
  const result = await loadReplayMod(bytes)
  assert.equal(result.format, 'replaymod')
})

test('Java modified UTF-8 NBT supports nulls and supplementary Unicode', () => {
  // Java DataOutput.writeUTF writes a NUL as C0 80 and emoji as two UTF-16 surrogates.
  const bytes = cat(8, u16(9), 65, 0xC0, 0x80, 0xED, 0xA0, 0xBD, 0xED, 0xB8, 0x80)
  assert.equal(new BinaryReader(bytes).nbt(), 'A\0😀')
  assert.throws(() => new BinaryReader(cat(8, u16(2), 0xC0, 0x41)).nbt(), /modified UTF-8/)
  assert.throws(() => new BinaryReader(compound(dims()), { maxDecodedBytes: 32 }).nbt(), /memory limit/)
})

test('1.21.4 experimental minecart uses verified 54-byte steps', async () => {
  const p = 769
  const step = cat(f64(12.5), f64(-1.25), f64(8.75), f64(0.25), f64(0), f64(-0.5), 64, 32, f32(0.75))
  assert.equal(step.length, 54)
  const r = await decodeRecording(cat(initial(p), spawn(p, { type: 'minecart' }), packet(p, 'play', 'move_minecart', cat(vi(7), vi(1), step), 80)), meta(p))
  const e = r.events.find(event => event.type === 'minecartMove')
  assert.deepEqual([e.steps[0].position.x, e.steps[0].position.y, e.steps[0].yaw, e.steps[0].weight], [12.5, -1.25, 90, 0.75])
  assert.equal(r.events.findLast(event => event.type === 'entityMove').z, 8.75)
  assert.ok(r.warnings.some(w => w.code === 'MINECART_INTERPOLATION'))
})

test('metadata particle payloads consume corrected vibration and packed-color layouts', async () => {
  for (const p of [763, 765, 767, 769]) {
    const particle = p <= 765 ? cat(vi(p === 763 ? 41 : 43), str('minecraft:block'), packedPos(1, -2, 3), vi(5)) : p === 767 ? cat(vi(13), f32(1), f32(0), f32(0), f32(1)) : cat(vi(13), i32(0xFF0000), f32(1))
    const r = await decodeRecording(cat(initial(p), spawn(p), packet(p, 'play', 'entity_metadata', cat(vi(7), 9, vi(17), particle, 10, vi(1), vi(73), 255), 50)), meta(p))
    const values = r.events.find(e => e.type === 'entityData').metadata
    assert.equal(values[1].value, 73, `${p} particle must consume exactly its payload`)
  }
})

test('every supported play packet is decoded or explicitly classified', () => {
  for (const table of Object.values(tables)) {
    for (const name of Object.values(table.states.play.names)) assert.ok(table.states.play.packets[name] || table.nonWorld.includes(name), `${table.protocol}:${name}`)
  }
})

test('official ReplayMod issue 927 raw excerpt retains real chunks, dimensions and camera', async (t) => {
  const fixtureUrl = new URL('../output/replaymod-validation/issue-927-1.20.1-initial.mcpr', import.meta.url)
  let fixture
  try {
    fixture = new Uint8Array(await fs.readFile(fixtureUrl))
  }
  catch (error) {
    if (error.code !== 'ENOENT')
      throw error
    t.skip('Optional public recording fixture: see tests/fixtures/replaymod/README.md')
    return
  }
  const r = await parseReplayMod(fixture)
  assert.equal(r.metadata.generator, 'ReplayMod v1.20.1-2.6.14')
  assert.equal(r.metadata.protocolVersion, 763)
  assert.equal(r.stats.packets, 24)
  assert.equal(r.stats.chunks, 1)
  assert.equal(r.metadata.playerEntityId, 282)
  assert.deepEqual([r.initialCamera.x, r.initialCamera.y, r.initialCamera.z], [9.5, 63, -34.5])
  const c = r.events.find(e => e.type === 'chunk')
  assert.deepEqual([c.timeMs, c.x, c.z, c.sections[0].y], [423, -10, -12, -4])
  assert.ok(c.sections.some(s => s.states.some(id => r.blockStates[id].name === 'minecraft:stone')))
})
