/* eslint-disable test/no-import-node-test -- Exercise the WASM shipped to the browser. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import nbt from 'prismarine-nbt'
import { issueAccountSession } from '../functions/api/auth/_shared.js'
import { normalizeRedstoneSwitch as storedConfig } from '../functions/api/gallery/_shared.js'
import { onRequestGet as getItem } from '../functions/api/gallery/item.js'
import { onRequestPost as upload } from '../functions/api/gallery/items.js'
import { onRequestGet as getSource } from '../functions/api/gallery/source.js'
import { RedstoneSim as BrowserSim } from '../sdk/litemora.js'
import { packRedstoneReplay } from '../src/js/world/redstone-replay-data.js'
import init, { RedstoneSim } from '../src/js/world/redstone-sim/pkg/redstone_wasm.js'
import { normalizeRedstoneSwitch, recordSwitchReplay } from '../src/js/world/redstone-sim/switch-recorder.js'

await init({ module_or_path: await readFile(new URL('../src/js/world/redstone-sim/pkg/redstone_wasm_bg.wasm', import.meta.url)) })

const tag = (type, value) => ({ type, value })

function schematic(blocks, containers = [], entities = [], dataVersion = 4790) {
  const dimensions = [0, 1, 2].map(axis => Math.max(...blocks.map(block => block[axis])) + 1)
  const [width, height, length] = dimensions
  const states = new Map([['minecraft:air', 0]])
  const indices = Array.from({ length: width * height * length }, () => 0)
  for (const [x, y, z, name] of blocks) {
    const state = `minecraft:${name}`
    if (!states.has(state))
      states.set(state, states.size)
    indices[(y * length + z) * width + x] = states.get(state)
  }
  const palette = Object.fromEntries([...states].map(([state, index]) => [state, tag('int', index)]))
  return gzipSync(nbt.writeUncompressed({ name: 'Schematic', type: 'compound', value: {
    Version: tag('int', 2),
    DataVersion: tag('int', dataVersion),
    Width: tag('short', width),
    Height: tag('short', height),
    Length: tag('short', length),
    Palette: tag('compound', palette),
    BlockData: tag('byteArray', indices),
    Entities: tag('list', { type: 'compound', value: entities.map(([name, pos, fields = {}]) => ({
      Id: tag('string', `minecraft:${name}`),
      Pos: tag('list', { type: 'double', value: pos }),
      ...fields,
    })) }),
    BlockEntities: tag('list', { type: 'compound', value: containers.map(([pos, id, items]) => ({
      Pos: tag('intArray', pos),
      Id: tag('string', `minecraft:${id}`),
      Items: tag('list', { type: 'compound', value: items.map(([slot, name, count]) => ({
        Slot: tag('byte', slot),
        id: tag('string', `minecraft:${name}`),
        count: tag('int', count),
      })) }),
    })) }),
  } }))
}

test('SDK completes a pressure-plate pulse and can resume a bounded wait without retriggering it', (t) => {
  const sim = new BrowserSim(schematic([[0, 0, 0, 'stone'], [0, 1, 0, 'stone_pressure_plate']]), 'schem', true)
  t.after(() => sim.free())
  const pulse = sim.runAnimation({ x: 0, y: 1, z: 0 })
  assert.equal(pulse.settled, true)
  const plateStates = pulse.frames.flatMap(frame => frame.changes.filter(c => c.y === 1).map(c => c.state))
  assert.deepEqual(plateStates, ['minecraft:stone_pressure_plate[powered=true]', 'minecraft:stone_pressure_plate[powered=false]'])

  sim.interact(0, 1, 0, 'plate_on')
  const held = sim.runAnimation()
  assert.equal(held.settled, false)
  assert.equal(held.toTick - held.fromTick, 2400)
  assert.equal(held.frames.length, 2400)
  assert.ok(held.frames.at(-1).pendingScheduledTicks > 0)
  sim.interact(0, 1, 0, 'plate_off')
  const released = sim.runAnimation()
  assert.equal(released.fromTick, held.toTick + 1)
  assert.equal(released.settled, true)
  assert.equal(sim.block_at(0, 1, 0), 'minecraft:stone_pressure_plate[powered=false]')
})

function run(t, blocks, position = { x: 0, y: 1, z: 0 }, recording = 'machine', containers = [], entities = [], durationTicks) {
  const native = new RedstoneSim(schematic(blocks, containers, entities), 'schem', true)
  t.after(() => native.free())
  const sim = {
    blockAt: (x, y, z) => native.block_at(x, y, z),
    initialize: () => JSON.parse(native.initialize()),
    step: ticks => JSON.parse(native.step(ticks)),
    interact: (...args) => JSON.parse(native.interact(...args)),
    fingerprint: () => native.fingerprint(),
    auxiliaryFingerprint: () => native.auxiliary_fingerprint(),
  }
  const { replay, control } = recordSwitchReplay(sim, { position, recording, durationTicks })
  const packed = packRedstoneReplay(replay)
  const at = (x, y, z) => replay.frames.flatMap(frame => frame.changes
    .filter(c => c.x === x && c.y === y && c.z === z)
    .map(c => [frame.tick, replay.palette[c.state].replace('minecraft:', '')]))
  return { at, control, packed }
}

test('26.2 and 26.3 schematics with known states run and retain their source version', (t) => {
  const blocks = [[0, 0, 0, 'target'], [1, 0, 0, 'redstone_lamp']]
  for (const [dataVersion, release] of [[4903, '26.2'], [5023, '26.3']]) {
    const sim = new RedstoneSim(schematic(blocks, [], [], dataVersion), 'schem', false)
    t.after(() => sim.free())
    const info = JSON.parse(sim.info())
    assert.equal(info.dataVersion, dataVersion)
    assert.equal(info.sourceRelease, release)
    sim.initialize()
    sim.interact(0, 0, 0, 'target')
    sim.step(1)
    assert.match(sim.block_at(1, 0, 0), /lit=true/)
  }
  assert.throws(() => new RedstoneSim(schematic(blocks, [], [], 5024), 'schem', false), /5024/)
  assert.throws(() => new RedstoneSim(schematic([[0, 0, 0, 'poplar_planks']], [], [], 5023), 'schem', false), /poplar_planks/)
})

test('arrow at the center of a marked target powers a trapdoor for twenty ticks', (t) => {
  const { at, control } = run(t, [[0, 1, 0, 'target'], [1, 1, 0, 'iron_trapdoor']], undefined, 'door')
  assert.equal(control.mode, 'pulse')
  const [[on, hit], [off, reset]] = at(0, 1, 0)
  assert.deepEqual([hit, reset, off - on], ['target[power=15]', 'target[power=0]', 20])
  assert.deepEqual(at(1, 1, 0).map(([, state]) => state.includes('open=true,powered=true')), [true, false])
})

for (const [name, activeTicks] of [['sculk_sensor', 30], ['calibrated_sculk_sensor', 10]]) {
  test(`${name} triggers its door, cools down and can be used again`, (t) => {
    const { at, control } = run(t, [[0, 1, 0, name], [1, 1, 0, 'iron_trapdoor']], undefined, 'door')
    assert.equal(control.mode, 'pulse')
    const [on, off, idle] = at(0, 1, 0)
    assert.match(on[1], /power=15,sculk_sensor_phase=active/)
    assert.equal(off[0] - on[0], activeTicks)
    assert.equal(idle[0] - off[0], 10)
  })
}

test('calibrated sensor listens on its amethyst side, with distance and wool occlusion', (t) => {
  const blocks = [[0, 0, 0, 'stone'], [0, 1, 0, 'lever'], [12, 1, 0, 'calibrated_sculk_sensor[facing=east]']]
  const normal = run(t, blocks)
  assert.deepEqual(normal.at(12, 1, 0)[0], [13, 'calibrated_sculk_sensor[facing=east,power=4,sculk_sensor_phase=active,waterlogged=false]'])
  assert.deepEqual(run(t, [...blocks, [5, 1, 0, 'blue_wool']]).at(12, 1, 0), [])
  assert.deepEqual(run(t, [...blocks, [11, 1, 0, 'redstone_block']]).at(12, 1, 0), [])
  assert.deepEqual(run(t, [...blocks.slice(0, 2), [12, 1, 0, 'sculk_sensor']]).at(12, 1, 0), [])
})

test('amethyst relays the incoming frequency to another sensor outside the original radius', (t) => {
  const { at } = run(t, [[0, 1, 0, 'target'], [7, 1, 0, 'sculk_sensor'], [8, 1, 0, 'amethyst_block'], [15, 1, 0, 'sculk_sensor']])
  assert.equal(at(15, 1, 0)[0][0], 15)
  assert.match(at(15, 1, 0)[0][1], /power=2,sculk_sensor_phase=active/)
})

test('copper rods pulse through their base and dripleaves finish the full tilt cycle', (t) => {
  const { at } = run(t, [[0, 1, 0, 'waxed_oxidized_lightning_rod[facing=up]'], [0, 0, 0, 'stone'], [1, 0, 0, 'redstone_lamp']])
  assert.deepEqual(at(0, 1, 0).map(([tick]) => tick), [1, 9])
  assert.match(at(1, 0, 0)[0][1], /lit=true/)
  assert.deepEqual(run(t, [[0, 1, 0, 'big_dripleaf']]).at(0, 1, 0).map(([tick]) => tick), [1, 11, 21, 121])
})

test('a honey piston moves its attached load while the neighboring slime assembly stays put', (t) => {
  const { at } = run(t, [
    [0, 0, 0, 'stone'],
    [0, 1, 0, 'lever'],
    [1, 1, 0, 'piston[facing=east]'],
    [2, 1, 0, 'honey_block'],
    [2, 2, 0, 'gold_block'],
    [2, 1, 1, 'slime_block'],
    [2, 1, 2, 'diamond_block'],
  ])
  assert.equal(at(3, 1, 0).at(-1)[1], 'honey_block')
  assert.equal(at(3, 2, 0).at(-1)[1], 'gold_block')
  assert.deepEqual(at(2, 1, 1), [])
  assert.deepEqual(at(2, 1, 2), [])
})

test('machines without a switch survive gallery normalization and run the imported circuit', (t) => {
  const config = { recording: 'machine', position: null }
  assert.deepEqual(normalizeRedstoneSwitch(storedConfig(config)), config)
  const { packed, at } = run(t, [[0, 0, 0, 'redstone_block'], [1, 0, 0, 'waxed_weathered_copper_bulb']], null)
  assert.equal(packed.meta.totalTicks, 200)
  assert.match(at(1, 0, 0)[0][1], /lit=true,powered=true/)
})

test('a crafter uses imported ingredients and powers a comparator on the receiving copper chest', (t) => {
  const circuit = [[0, 0, 0, 'redstone_block'], [1, 0, 0, 'crafter[orientation=east_up]'], [2, 0, 0, 'waxed_copper_chest'], [3, 0, 0, 'comparator[facing=west]'], [4, 0, 0, 'redstone_lamp']]
  const record = items => run(t, circuit, null, 'machine', [
    [[1, 0, 0], 'crafter', items],
    [[2, 0, 0], 'copper_chest', []],
  ])
  const crafted = record([[4, 'oak_log', 1]])
  assert.ok(crafted.at(1, 0, 0).some(([, state]) => state.includes('crafting=true')))
  assert.match(crafted.at(4, 0, 0).at(-1)[1], /lit=true/)
  assert.deepEqual(record([[0, 'dirt', 1]]).at(4, 0, 0), [])
})

test('an uploaded furnace consumes two sticks and a hopper receives its smelted ingot', (t) => {
  const blocks = [[0, 1, 0, 'furnace'], [0, 0, 0, 'hopper[facing=east]'], [1, 0, 0, 'barrel'], [2, 0, 0, 'comparator[facing=west]'], [3, 0, 0, 'redstone_lamp']]
  const sim = new RedstoneSim(schematic(blocks, [
    [[0, 1, 0], 'furnace', [[0, 'raw_iron', 1], [1, 'stick', 2]]],
    [[0, 0, 0], 'hopper', []],
    [[1, 0, 0], 'barrel', []],
  ]), 'schem', true)
  t.after(() => sim.free())
  sim.initialize()
  sim.step(1)
  assert.match(sim.block_at(0, 1, 0), /lit=true/)
  sim.step(198)
  assert.match(sim.block_at(3, 0, 0), /lit=false/)
  sim.step(13)
  assert.match(sim.block_at(0, 1, 0), /lit=false/)
  assert.match(sim.block_at(3, 0, 0), /lit=true/)
})

test('shelves connect when powered and stepping on ore or a shrieker changes their state', (t) => {
  const { at } = run(t, [[0, 0, 0, 'redstone_block'], [1, 0, 0, 'redstone_block'], [0, 1, 0, 'oak_shelf[facing=north]'], [1, 1, 0, 'spruce_shelf[facing=north]']], null)
  for (const x of [0, 1]) assert.match(at(x, 1, 0).at(-1)[1], /side_chain=(left|right)/)
  assert.match(run(t, [[0, 1, 0, 'redstone_ore']]).at(0, 1, 0)[0][1], /lit=true/)
  assert.deepEqual(run(t, [[0, 1, 0, 'sculk_shrieker']]).at(0, 1, 0).map(([tick]) => tick), [1, 91])
})

// CreativeModeTabs.REDSTONE_BLOCKS, Java 26.1.2. Item-only names use their placed state.
const tabBlocks = [
  'redstone_wire',
  'redstone_torch',
  'redstone_block',
  'repeater',
  'comparator',
  'target',
  'waxed_copper_bulb',
  'waxed_exposed_copper_bulb',
  'waxed_weathered_copper_bulb',
  'waxed_oxidized_copper_bulb',
  'lever',
  'oak_button',
  'stone_button',
  'oak_pressure_plate',
  'stone_pressure_plate',
  'light_weighted_pressure_plate',
  'heavy_weighted_pressure_plate',
  'sculk_sensor',
  'calibrated_sculk_sensor',
  'sculk_shrieker',
  'amethyst_block',
  'white_wool',
  'tripwire_hook',
  'tripwire',
  'lectern',
  'daylight_detector',
  'waxed_lightning_rod',
  'piston',
  'sticky_piston',
  'slime_block',
  'honey_block',
  'dispenser',
  'dropper',
  'crafter',
  'hopper',
  'chest',
  'waxed_copper_chest',
  'barrel',
  'chiseled_bookshelf',
  'oak_shelf',
  'furnace',
  'trapped_chest',
  'jukebox',
  'decorated_pot',
  'observer',
  'note_block',
  'composter',
  'cauldron',
  'rail',
  'powered_rail',
  'detector_rail',
  'activator_rail',
  'oak_door',
  'iron_door',
  'oak_fence_gate',
  'oak_trapdoor',
  'iron_trapdoor',
  'tnt',
  'redstone_lamp',
  'bell',
  'big_dripleaf',
  'redstone_ore',
]

test('all 62 placeable redstone tab entries load in the shipped simulator and bundled pack', async (t) => {
  const { default: JSZip } = await import('jszip')
  const bytes = await readFile(new URL('../public/minecraft-default-pack.pack', import.meta.url))
  const pack = await JSZip.loadAsync(bytes)
  const sim = new RedstoneSim(schematic(tabBlocks.map((block, x) => [x, 0, 0, block])), 'schem', true)
  t.after(() => sim.free())
  assert.equal(tabBlocks.length, 62)
  for (const [x, name] of tabBlocks.entries()) {
    assert.equal(sim.block_at(x, 0, 0).split('[')[0], `minecraft:${name}`)
    assert.ok(pack.file(`assets/minecraft/blockstates/${name}.json`), name)
  }
})

test('a dispenser arrow strikes a distant target, while a wall blocks the shot', (t) => {
  const blocks = [[0, 1, 0, 'redstone_block'], [1, 1, 0, 'dispenser[facing=east]'], [4, 1, 0, 'target'], [5, 1, 0, 'redstone_lamp']]
  const inventory = [[[1, 1, 0], 'dispenser', [[0, 'arrow', 1]]]]
  const { at } = run(t, blocks, null, 'machine', inventory)
  const [[on, hit], [off]] = at(4, 1, 0)
  assert.match(hit, /power=([1-9]|1[0-5])\]/)
  assert.equal(off - on, 20)
  assert.match(at(5, 1, 0)[0][1], /lit=true/)
  for (const item of ['egg', 'snowball']) {
    const thrown = run(t, blocks, null, 'machine', [[[1, 1, 0], 'dispenser', [[0, item, 1]]]])
    const [hit, reset] = thrown.at(4, 1, 0)
    assert.equal(reset[0] - hit[0], 8)
  }
  assert.deepEqual(run(t, [...blocks, [3, 1, 0, 'stone']], null, 'machine', inventory).at(4, 1, 0), [])
})

test('TNT waits for its fuse, breaks nearby glass and leaves obsidian intact', (t) => {
  const blocks = [[2, 1, 2, 'tnt'], [1, 1, 2, 'redstone_block'], [3, 1, 2, 'glass'], [2, 1, 3, 'obsidian']]
  for (let x = 0; x < 6; x++) {
    for (let z = 0; z < 6; z++) blocks.push([x, 0, z, 'obsidian'])
  }
  const { at } = run(t, blocks, null)
  const [[tick, result]] = at(3, 1, 2)
  assert.equal(tick, 80)
  assert.equal(result, 'air')
  assert.deepEqual(at(2, 1, 3), [])
})

for (const vehicle of ['minecart', 'hopper_minecart', 'chest_minecart', 'furnace_minecart', 'tnt_minecart']) {
  test(`${vehicle} travels from a powered rail to a detector and lights the output`, (t) => {
    const blocks = [[0, 1, 0, 'stone'], [4, 1, 0, 'detector_rail[shape=east_west]'], [4, 1, 1, 'redstone_lamp']]
    for (let x = 1; x < 4; x++) blocks.push([x, 0, 0, 'redstone_block'], [x, 1, 0, 'powered_rail[shape=east_west]'])
    for (let x = 4; x < 9; x++) {
      blocks.push([x, 0, 0, 'stone'])
      if (x > 4)
        blocks.push([x, 1, 0, 'rail[shape=east_west]'])
    }
    const { at } = run(t, blocks, null, 'machine', [], [[vehicle, [1.5, 1.0625, 0.5]]])
    assert.match(at(4, 1, 0)[0][1], /powered=true/)
    assert.match(at(4, 1, 1)[0][1], /lit=true/)
  })
}

for (const boat of ['oak_chest_boat', 'bamboo_chest_raft']) {
  test(`a hopper unloads an imported ${boat} and the receiving barrel changes comparator output`, (t) => {
    const blocks = [[0, 0, 0, 'hopper[facing=east]'], [1, 0, 0, 'barrel'], [2, 0, 0, 'comparator[facing=west]'], [3, 0, 0, 'redstone_lamp']]
    const items = tag('list', { type: 'compound', value: [{ Slot: tag('byte', 0), id: tag('string', 'minecraft:stone'), count: tag('int', 1) }] })
    const { at } = run(t, blocks, null, 'machine', [[[0, 0, 0], 'hopper', []], [[1, 0, 0], 'barrel', []]], [[boat, [0.5, 1.05, 0.5], { Items: items }]])
    assert.match(at(3, 0, 0).at(-1)[1], /lit=true/)
  })
}

test('an uploaded furnace cart pushes cargo far enough for a detector comparator to light a lamp', (t) => {
  const blocks = [[7, 0, 1, 'stone'], [7, 1, 1, 'comparator[facing=north]'], [7, 1, 2, 'redstone_lamp']]
  for (let x = 0; x < 24; x++)
    blocks.push([x, 0, 0, 'stone'], [x, 1, 0, x === 7 ? 'detector_rail[shape=east_west]' : 'rail[shape=east_west]'])
  const cargo = ['chest_minecart', [3, 1.0625, 0.5], { Items: tag('list', { type: 'compound', value: [{ Slot: tag('byte', 0), id: tag('string', 'minecraft:iron_ingot'), count: tag('int', 64) }] }) }]
  const engine = ['furnace_minecart', [1.5, 1.0625, 0.5], { Fuel: tag('short', 200), PushX: tag('double', 1) }]
  assert.deepEqual(run(t, blocks, null, 'machine', [], [cargo]).at(7, 1, 2), [])
  const { at } = run(t, blocks, null, 'machine', [], [engine, cargo])
  assert.match(at(7, 1, 2)[0][1], /lit=true/)
})

test('bubbles lift an uploaded armor stand into tripwire and switch a lamp', (t) => {
  const blocks = [[2, 0, 0, 'soul_sand'], [0, 4, 0, 'stone'], [4, 4, 0, 'stone'], [4, 4, 1, 'redstone_lamp'],
    [1, 4, 0, 'tripwire_hook[facing=east,attached=true]'], [2, 4, 0, 'tripwire[attached=true]'], [3, 4, 0, 'tripwire_hook[facing=west,attached=true]']]
  for (let y = 1; y <= 3; y++) blocks.push([2, y, 0, 'water'])
  const stand = ['armor_stand', [2.5, 1, 0.5]]
  const { at } = run(t, blocks, null, 'machine', [], [stand])
  assert.deepEqual(at(2, 3, 0)[0], [20, 'bubble_column[drag=false]'])
  assert.match(at(4, 4, 1)[0][1], /lit=true/)
  assert.deepEqual(run(t, blocks, null, 'machine', [], [[...stand, { Marker: tag('byte', 1) }]]).at(4, 4, 1), [])
})

test('an uploaded hopper cart respects the saved absorption setting', (t) => {
  const blocks = [[0, 0, 0, 'stone'], [0, 1, 0, 'detector_rail'], [0, 2, 0, 'barrel'], [1, 1, 0, 'comparator[facing=west]'], [1, 0, 0, 'stone'], [2, 1, 0, 'redstone_lamp']]
  const stock = [[[0, 2, 0], 'barrel', [[0, 'iron_ingot', 64]]]]
  const lamp = enabled => run(t, blocks, null, 'machine', stock, [['hopper_minecart', [0.5, 1.0625, 0.5], { Enabled: tag('byte', enabled) }]]).at(2, 1, 0)
  assert.match(lamp(1)[0][1], /lit=true/)
  assert.deepEqual(lamp(0), [])
})

test('a normal armor stand activates a stone plate, a marker stand and a cart do not', (t) => {
  const blocks = [[0, 0, 0, 'stone'], [0, 1, 0, 'stone_pressure_plate'], [1, 0, 0, 'redstone_lamp']]
  const trigger = (kind, fields) => run(t, blocks, null, 'machine', [], [[kind, [0.5, 1, 0.5], fields]]).at(1, 0, 0)
  assert.match(trigger('armor_stand')[0][1], /lit=true/)
  assert.deepEqual(trigger('armor_stand', { Marker: tag('byte', 1) }), [])
  assert.deepEqual(trigger('minecart'), [])
})

test('a saved 30-second machine keeps running after the first ten seconds', (t) => {
  const config = { recording: 'machine', position: null, durationTicks: 600 }
  assert.deepEqual(storedConfig(config), config)
  const { packed } = run(t, [[0, 0, 0, 'stone']], null, 'machine', [], [], config.durationTicks)
  assert.equal(packed.meta.totalTicks, 600)
  assert.equal(storedConfig({ ...config, durationTicks: -1 }), null)
})

test('schematic setup actions do not create clickable switches in an archived replay', () => {
  const actions = ['set_block', 'break_block', 'set_block_entity', 'hit_target'].map((type, x) => ({
    action: { type, pos: { x, y: 0, z: 0 } },
  }))
  const timeline = packRedstoneReplay({ format: 'litemora-redstone-replay-v1', palette: ['minecraft:target'], baseline: [], frames: [{ tick: 0, actions, changes: [] }] })
  assert.deepEqual([...timeline.actionTargets], [3, 0, 0])
})

test('a multipart schematic upload retains its input, duration and usable source bytes for a visitor', async (t) => {
  const records = new Map()
  const env = { LITEMORA_SESSION_SECRET: 'redstone-test-only', LITEMORA_SPACE_KV: {
    async put(key, value) { records.set(key, value) },
    async get(key) { return records.get(key) ?? null },
  } }
  const session = await issueAccountSession(env, { id: 'redstone-author', provider: 'github' })
  const bytes = schematic([[0, 0, 0, 'target'], [1, 0, 0, 'redstone_lamp']])
  const config = { recording: 'machine', durationTicks: 600, position: { x: 0, y: 0, z: 0 } }
  const form = new FormData()
  form.set('title', 'Target lamp')
  form.set('projectionName', 'Target lamp')
  form.set('redstoneSwitch', JSON.stringify(config))
  form.set('file', new Blob([bytes]), 'target.schem')
  const root = 'https://example.test/api/gallery/'
  const response = await upload({ env, request: new Request(`${root}items?space=redstone-test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
    body: form,
  }) })
  assert.equal(response.status, 200)
  const id = (await response.json()).item.projectionSlug
  const request = name => ({ env, request: new Request(`${root}${name}?space=redstone-test&item=${id}`) })
  const detail = (await (await getItem(request('item'))).json()).item
  assert.deepEqual(detail.redstoneSwitch, config)
  const native = new RedstoneSim(new Uint8Array(await (await getSource(request('source'))).arrayBuffer()), 'schem', true)
  t.after(() => native.free())
  native.initialize()
  const { x, y, z } = detail.redstoneSwitch.position
  native.interact(x, y, z, 'target')
  assert.match(native.block_at(1, 0, 0), /lit=true/)
})
