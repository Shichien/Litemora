/* eslint-disable test/no-import-node-test -- Use Node's built-in test runner. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadProtocol } from '../src/js/replaymod/replaymod-data.js'
import { applyRecordedPiston } from '../src/js/replaymod/replaymod-piston.js'

const DIRECTIONS = [
  ['down', 0, -1, 0],
  ['up', 0, 1, 0],
  ['north', 0, 0, -1],
  ['south', 0, 0, 1],
  ['west', -1, 0, 0],
  ['east', 1, 0, 0],
]
const states = []
function add(name, properties = {}, metadata = {}) {
  states.push(Object.freeze({
    name: `minecraft:${name}`,
    properties: Object.freeze(properties),
    boundingBox: 'block',
    transparent: false,
    ...metadata,
  }))
}
add('air', {}, { boundingBox: 'empty', transparent: true })
add('stone')
add('diamond_block')
add('oak_log', { axis: 'z' })
add('glass', {}, { transparent: true })
add('cave_air', {}, { boundingBox: 'empty', transparent: true })
add('void_air', {}, { boundingBox: 'empty', transparent: true })
for (const name of ['piston', 'sticky_piston']) {
  for (const [facing] of DIRECTIONS) {
    for (const extended of ['false', 'true'])
      add(name, { facing, extended })
  }
}
for (const type of ['normal', 'sticky']) {
  for (const [facing] of DIRECTIONS) {
    for (const short of ['false', 'true'])
      add('piston_head', { type, short, facing })
  }
}
for (const name of ['slime_block', 'honey_block', 'obsidian', 'bedrock', 'chest', 'furnace', 'white_shulker_box', 'melon', 'pumpkin', 'white_glazed_terracotta', 'future_full_cube'])
  add(name)
add('stone_slab', { type: 'bottom', waterlogged: 'false' })
add('water', { level: '0' }, { boundingBox: 'empty', transparent: true })
add('moving_piston', { facing: 'east', type: 'normal' })
add('stone', { waterlogged: 'true' })
add('stone', { unusual_shape: 'true' }, { boundingBox: 'empty' })
states.push(Object.freeze({ name: 'custom:stone', properties: Object.freeze({}), boundingBox: 'block', transparent: false }))
Object.freeze(states)

function stateId(name, properties = {}, registry = states) {
  const fullName = name.includes(':') ? name : `minecraft:${name}`
  const id = registry.findIndex(state => state?.name === fullName
    && Object.keys(state.properties || {}).length === Object.keys(properties).length
    && Object.entries(properties).every(([key, value]) => String(state.properties[key]) === String(value)))
  assert.notEqual(id, -1, `fixture state ${fullName} ${JSON.stringify(properties)} must exist`)
  return id
}
const piston = (extended = false, facing = 'east', sticky = false) => stateId(sticky ? 'sticky_piston' : 'piston', { facing, extended })
const head = (facing = 'east', sticky = false, short = false) => stateId('piston_head', { facing, type: sticky ? 'sticky' : 'normal', short })
const localIndex = (x, y, z) => (x & 15) | ((z & 15) << 4) | ((y & 15) << 8)
const sectionKey = (x, y, z) => `${Math.floor(x / 16)},${Math.floor(y / 16)},${Math.floor(z / 16)}`

// Match the playback's copy-on-write setter and unloaded-blockAt fallback. Keep
// this fixture independent of the parent's concurrent playback integration.
function makeWorld({ blocks = [], loaded = [[0, 0, 0]], registry = states, blockEntities = [], isPositionLoaded } = {}) {
  const sections = new Map(loaded.map(([x, y, z]) => [`${x},${y},${z}`, {
    x,
    y,
    z,
    states: new Uint32Array(4096).fill(stateId('air', {}, registry)),
  }]))
  for (const [x, y, z, state] of blocks) {
    assert.ok(sections.has(sectionKey(x, y, z)), 'fixture blocks must be in loaded sections')
    sections.get(sectionKey(x, y, z)).states[localIndex(x, y, z)] = state
  }
  const sourceSections = [...sections.values()]
  const world = {
    replay: { blockStates: registry },
    sections,
    blockEntities: new Map(blockEntities),
    writes: [],
    sourceSections,
    blockAt(x, y, z) {
      return this.sections.get(sectionKey(x, y, z))?.states[localIndex(x, y, z)] || 0
    },
    setBlock({ x, y, z, state }) {
      const key = sectionKey(x, y, z)
      const section = this.sections.get(key)
      const next = section ? section.states.slice() : new Uint32Array(4096)
      next[localIndex(x, y, z)] = state
      this.sections.set(key, { x: Math.floor(x / 16), y: Math.floor(y / 16), z: Math.floor(z / 16), states: next })
      this.blockEntities.delete(`${x},${y},${z}`)
      this.writes.push({ x, y, z, state })
    },
  }
  if (isPositionLoaded)
    world.isPositionLoaded = isPositionLoaded
  return world
}

function action(overrides = {}) {
  return { type: 'blockAction', timeMs: 100, x: 1, y: 8, z: 8, block: 'minecraft:piston', blockId: 999, action: 0, parameter: 5, ...overrides }
}
function at(world, x, y = 8, z = 8) {
  return world.blockAt(x, y, z)
}
function refused(world, event, reason) {
  const before = [...world.sections].map(([key, value]) => [key, { ...value, states: value.states.slice() }])
  const entities = [...world.blockEntities]
  const writes = world.writes.length
  const result = applyRecordedPiston(world, event)
  assert.equal(result.handled, false)
  assert.match(result.warning, reason)
  assert.deepEqual([...world.sections], before, 'refusal must leave every cell unchanged')
  assert.deepEqual([...world.blockEntities], entities, 'refusal must preserve block entities')
  assert.equal(world.writes.length, writes, 'preflight must complete before any setter call')
  return result
}

test('unrelated block actions and non-action events are not claimed', () => {
  const world = makeWorld()
  assert.deepEqual(applyRecordedPiston(world, action({ block: 'minecraft:chest' })), { handled: false })
  assert.deepEqual(applyRecordedPiston(world, action({ type: 'block' })), { handled: false })
  assert.deepEqual(applyRecordedPiston(world, null), { handled: false })
  assert.deepEqual(world.writes, [])
})

test('ordinary push preserves state IDs/properties and source recording arrays', () => {
  const log = stateId('oak_log', { axis: 'z' })
  const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, log], [3, 8, 8, stateId('glass')]] })
  const source = world.sourceSections[0].states
  const original = source.slice()
  const registryBefore = JSON.stringify(states)
  assert.deepEqual(applyRecordedPiston(world, action()), { handled: true })
  assert.equal(at(world, 1), piston(true))
  assert.equal(at(world, 2), head())
  assert.equal(at(world, 3), log)
  assert.equal(at(world, 4), stateId('glass'), 'transparent full cubes can be pushed')
  assert.deepEqual(source, original)
  assert.equal(JSON.stringify(states), registryBefore)
  assert.notEqual(world.sections.get('0,0,0').states, source)
})

test('pushes and sticky pulls use all six protocol direction IDs', async (t) => {
  for (const [parameter, [facing, dx, dy, dz]] of DIRECTIONS.entries()) {
    await t.test(facing, () => {
      const pos = distance => [8 + dx * distance, 8 + dy * distance, 8 + dz * distance]
      const world = makeWorld({ blocks: [
        [...pos(0), piston(false, facing, true)],
        [...pos(1), stateId('stone')],
        [...pos(2), stateId('diamond_block')],
      ] })
      const event = action({ x: 8, block: 'minecraft:sticky_piston', parameter })
      assert.deepEqual(applyRecordedPiston(world, event), { handled: true })
      assert.equal(world.blockAt(...pos(0)), piston(true, facing, true))
      assert.equal(world.blockAt(...pos(1)), head(facing, true))
      assert.equal(world.blockAt(...pos(2)), stateId('stone'))
      assert.equal(world.blockAt(...pos(3)), stateId('diamond_block'))
      assert.deepEqual(applyRecordedPiston(world, { ...event, action: 1 }), { handled: true })
      assert.equal(world.blockAt(...pos(0)), piston(false, facing, true))
      assert.equal(world.blockAt(...pos(1)), stateId('stone'))
      assert.equal(world.blockAt(...pos(2)), stateId('air'))
      assert.equal(world.blockAt(...pos(3)), stateId('diamond_block'), 'simple pull must not pull a train')
    })
  }
})

test('exactly twelve blocks can be pushed; thirteen refuses atomically', () => {
  for (const count of [12, 13]) {
    const blocks = [[1, 8, 8, piston()], ...Array.from({ length: count }, (_, i) => [i + 2, 8, 8, stateId('stone')])]
    const world = makeWorld({ blocks })
    if (count === 13) {
      refused(world, action(), /12-block limit/)
    }
    else {
      assert.deepEqual(applyRecordedPiston(world, action()), { handled: true })
      assert.equal(at(world, 2), head())
      for (let x = 3; x <= 14; x++)
        assert.equal(at(world, x), stateId('stone'))
    }
  }
})

test('normal retraction removes the head but leaves the forward block alone', () => {
  const world = makeWorld({ blocks: [[1, 8, 8, piston(true)], [2, 8, 8, head()], [3, 8, 8, stateId('stone')]] })
  assert.deepEqual(applyRecordedPiston(world, action({ action: 1 })), { handled: true })
  assert.equal(at(world, 1), piston())
  assert.equal(at(world, 2), stateId('air'))
  assert.equal(at(world, 3), stateId('stone'))
})

test('sticky action 2 retracts without pulling or checking adhesion ahead', () => {
  const world = makeWorld({ blocks: [[1, 8, 8, piston(true, 'east', true)], [2, 8, 8, head('east', true)], [3, 8, 8, stateId('slime_block')]] })
  assert.deepEqual(applyRecordedPiston(world, action({ action: 2, block: 'minecraft:sticky_piston' })), { handled: true })
  assert.equal(at(world, 1), piston(false, 'east', true))
  assert.equal(at(world, 2), stateId('air'))
  assert.equal(at(world, 3), stateId('slime_block'))
})

test('normal and drop retractions do not require the untouched forward chunk', () => {
  for (const sticky of [false, true]) {
    const world = makeWorld({ blocks: [[14, 8, 8, piston(true, 'east', sticky)], [15, 8, 8, head('east', sticky)]] })
    assert.deepEqual(applyRecordedPiston(world, action({ x: 14, action: sticky ? 2 : 1, block: sticky ? 'minecraft:sticky_piston' : 'minecraft:piston' })), { handled: true })
    assert.equal(at(world, 14), piston(false, 'east', sticky))
    assert.equal(at(world, 15), stateId('air'))
    assert.equal(world.sections.has('1,0,0'), false)
  }
})

test('sticky retraction into an empty target clears the head', () => {
  const world = makeWorld({ blocks: [[1, 8, 8, piston(true, 'east', true)], [2, 8, 8, head('east', true)]] })
  assert.deepEqual(applyRecordedPiston(world, action({ action: 1, block: 'minecraft:sticky_piston' })), { handled: true })
  assert.equal(at(world, 1), piston(false, 'east', true))
  assert.equal(at(world, 2), stateId('air'))
})

test('early base update packets do not suppress required extension or pull', () => {
  const push = makeWorld({ blocks: [[1, 8, 8, piston(true)], [2, 8, 8, stateId('stone')]] })
  assert.deepEqual(applyRecordedPiston(push, action()), { handled: true })
  assert.equal(at(push, 2), head())
  assert.equal(at(push, 3), stateId('stone'))
  for (const front of [head('east', true), stateId('air')]) {
    const pull = makeWorld({ blocks: [[1, 8, 8, piston(false, 'east', true)], [2, 8, 8, front], [3, 8, 8, stateId('stone')]] })
    assert.deepEqual(applyRecordedPiston(pull, action({ action: 1, block: 'minecraft:sticky_piston' })), { handled: true })
    assert.equal(at(pull, 2), stateId('stone'))
    assert.equal(at(pull, 3), stateId('air'))
  }
})

test('a settled extension is idempotent and later block packets stay authoritative', () => {
  const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, stateId('stone')]] })
  assert.equal(applyRecordedPiston(world, action()).handled, true)
  const writes = world.writes.length
  assert.deepEqual(applyRecordedPiston(world, action()), { handled: true })
  assert.equal(world.writes.length, writes)
  assert.equal(at(world, 3), stateId('stone'))
  assert.equal(at(world, 4), stateId('air'))
  world.setBlock({ x: 3, y: 8, z: 8, state: stateId('diamond_block') })
  assert.equal(at(world, 3), stateId('diamond_block'))
})

test('unloaded base, push destination and sticky pull source all refuse', () => {
  refused(makeWorld({ loaded: [] }), action(), /unloaded/)
  const push = makeWorld({ blocks: [[14, 8, 8, piston()], [15, 8, 8, stateId('stone')]] })
  refused(push, action({ x: 14 }), /unloaded.*16,8,8/)
  const pull = makeWorld({ blocks: [[14, 8, 8, piston(true, 'east', true)], [15, 8, 8, head('east', true)]] })
  refused(pull, action({ x: 14, action: 1, block: 'minecraft:sticky_piston' }), /unloaded.*16,8,8/)
})

test('loaded predicate recognizes omitted air sections and refuses dimension bounds', () => {
  const world = makeWorld({
    blocks: [[14, 8, 8, piston()], [15, 8, 8, stateId('stone')]],
    isPositionLoaded: (x, y, z) => x >= 0 && x < 32 && y >= 0 && y < 16 && z >= 0 && z < 16,
  })
  assert.equal(world.sections.has('1,0,0'), false)
  assert.deepEqual(applyRecordedPiston(world, action({ x: 14 })), { handled: true })
  assert.equal(at(world, 16), stateId('stone'))
  assert.equal(world.sections.has('1,0,0'), true)
  const bounded = makeWorld({ blocks: [[1, 8, 8, piston()]], isPositionLoaded: () => false })
  refused(bounded, action(), /out-of-bounds/)
})

test('negative coordinates use floor section coordinates across chunk boundaries', () => {
  const world = makeWorld({ loaded: [[-1, -1, -1], [-2, -1, -1]], blocks: [
    [-15, -1, -1, piston(false, 'west')],
    [-16, -1, -1, stateId('stone')],
  ] })
  assert.deepEqual(applyRecordedPiston(world, action({ x: -15, y: -1, z: -1, parameter: 4 })), { handled: true })
  assert.equal(world.blockAt(-16, -1, -1), head('west'))
  assert.equal(world.blockAt(-17, -1, -1), stateId('stone'))
})

test('slime and honey are explicitly refused in push lines and sticky pulls', () => {
  for (const name of ['slime_block', 'honey_block']) {
    const push = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, stateId('stone')], [3, 8, 8, stateId(name)]] })
    refused(push, action(), /slime\/honey adhesion is unsupported/)
    const pull = makeWorld({ blocks: [[1, 8, 8, piston(true, 'east', true)], [2, 8, 8, head('east', true)], [3, 8, 8, stateId(name)]] })
    refused(pull, action({ action: 1, block: 'minecraft:sticky_piston' }), /slime\/honey adhesion is unsupported/)
  }
})

test('a stationary adjacent slime block does not attach itself to an ordinary pushed cube', () => {
  const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, stateId('stone')], [2, 9, 8, stateId('slime_block')]] })
  assert.deepEqual(applyRecordedPiston(world, action()), { handled: true })
  assert.equal(world.blockAt(2, 9, 8), stateId('slime_block'))
})

test('immovable and block-entity blocks refuse even if entity data is absent', () => {
  for (const name of ['obsidian', 'bedrock', 'chest', 'furnace', 'white_shulker_box']) {
    const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, stateId(name)]] })
    refused(world, action(), /immovable\/block-entity/)
    const pull = makeWorld({ blocks: [[1, 8, 8, piston(true, 'east', true)], [2, 8, 8, head('east', true)], [3, 8, 8, stateId(name)]] })
    refused(pull, action({ action: 1, block: 'minecraft:sticky_piston' }), /immovable\/block-entity/)
  }
})

test('existing block entities cannot be silently moved or overwritten', () => {
  for (const x of [1, 2, 3]) {
    const world = makeWorld({
      blocks: [[1, 8, 8, piston()], [2, 8, 8, stateId('stone')]],
      blockEntities: [[`${x},8,8`, { x, y: 8, z: 8, nbt: { keep: true } }]],
    })
    refused(world, action(), /block entity/)
  }
})

test('unknown shapes, destruction, push-only reactions, fluids and custom blocks refuse', () => {
  const unsupported = [
    stateId('future_full_cube'),
    stateId('stone_slab', { type: 'bottom', waterlogged: 'false' }),
    stateId('melon'),
    stateId('pumpkin'),
    stateId('white_glazed_terracotta'),
    stateId('water', { level: '0' }),
    stateId('custom:stone'),
    stateId('stone', { waterlogged: 'true' }),
    stateId('stone', { unusual_shape: 'true' }),
  ]
  for (const state of unsupported) {
    const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, state]] })
    refused(world, action(), /unknown shape or piston reaction|waterlogged/)
  }
})

test('moving blocks, short heads, nested pistons and mismatched heads refuse', () => {
  for (const state of [stateId('moving_piston', { facing: 'east', type: 'normal' }), head(), piston()]) {
    const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, state]] })
    refused(world, action(), /transient or nested piston/)
  }
  for (const state of [head('east', false, true), head('north'), head('east', true), stateId('stone')]) {
    const world = makeWorld({ blocks: [[1, 8, 8, piston(true)], [2, 8, 8, state]] })
    refused(world, action({ action: 1 }), /ambiguous\/transient/)
  }
})

test('missing registry variants never cause invented state IDs or partial writes', () => {
  for (const missing of [piston(true), head(), stateId('air')]) {
    const registry = states.map((state, id) => id === missing ? undefined : state)
    // A sparse registry models a missing variant; retain a fixture air entry only
    // while constructing the world, then install the actual incomplete registry.
    const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, stateId('stone')]] })
    world.replay.blockStates = registry
    if (missing === stateId('air')) {
      world.sections.get('0,0,0').states[localIndex(1, 8, 8)] = piston(true)
      world.sections.get('0,0,0').states[localIndex(2, 8, 8)] = head()
      refused(world, action({ action: 1 }), /missing registry variant minecraft:air/)
    }
    else {
      refused(world, action(), /missing registry variant/)
    }
  }
})

test('registry property order and nonstandard state IDs are respected', () => {
  const registry = Object.freeze([...states].reverse())
  const base = stateId('piston', { extended: false, facing: 'east' }, registry)
  const stone = stateId('stone', {}, registry)
  const world = makeWorld({ registry, blocks: [[1, 8, 8, base], [2, 8, 8, stone]] })
  assert.deepEqual(applyRecordedPiston(world, action()), { handled: true })
  assert.equal(at(world, 1), stateId('piston', { extended: true, facing: 'east' }, registry))
  assert.equal(at(world, 2), stateId('piston_head', { facing: 'east', short: false, type: 'normal' }, registry))
  assert.equal(at(world, 3), stone)
  assert.equal(applyRecordedPiston(world, action({ action: 1 })).handled, true)
  assert.equal(at(world, 2), stateId('air', {}, registry), 'clearing uses the registered air ID')
})

test('push and pull resolve actual state variants from every bundled protocol registry', async (t) => {
  for (const mcversion of ['1.20.1', '1.20.4', '1.21.1', '1.21.4']) {
    await t.test(mcversion, async () => {
      const { blockStates: registry } = await loadProtocol({ mcversion })
      const base = stateId('sticky_piston', { extended: 'false', facing: 'east' }, registry)
      const stone = stateId('stone', {}, registry)
      const world = makeWorld({ registry, blocks: [[1, 8, 8, base], [2, 8, 8, stone]] })
      const event = action({ block: 'minecraft:sticky_piston' })
      const source = world.sourceSections[0].states.slice()
      assert.deepEqual(applyRecordedPiston(world, event), { handled: true })
      assert.equal(at(world, 1), stateId('sticky_piston', { extended: 'true', facing: 'east' }, registry))
      assert.equal(at(world, 2), stateId('piston_head', { short: 'false', type: 'sticky', facing: 'east' }, registry))
      assert.equal(at(world, 3), stone)
      assert.deepEqual(applyRecordedPiston(world, { ...event, action: 1 }), { handled: true })
      assert.equal(at(world, 1), base)
      assert.equal(at(world, 2), stone)
      assert.equal(at(world, 3), stateId('air', {}, registry))
      assert.deepEqual(world.sourceSections[0].states, source)
    })
  }
})

test('all registered air kinds terminate an ordinary push', () => {
  for (const name of ['air', 'cave_air', 'void_air']) {
    const world = makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, stateId('stone')], [3, 8, 8, stateId(name)]] })
    assert.deepEqual(applyRecordedPiston(world, action()), { handled: true })
    assert.equal(at(world, 3), stateId('stone'))
  }
})

test('malformed actions, directions, base states and unknown states refuse safely', () => {
  for (const [overrides, reason] of [
    [{ action: 3 }, /unknown piston action/],
    [{ parameter: 6 }, /invalid piston direction/],
    [{ parameter: -1 }, /invalid piston direction/],
    [{ parameter: 2.5 }, /invalid piston direction/],
    [{ parameter: 4 }, /does not match/],
    [{ x: 1.25 }, /invalid block position/],
    [{ block: 'minecraft:sticky_piston' }, /block mismatch/],
  ]) {
    const world = makeWorld({ blocks: [[1, 8, 8, piston()]] })
    refused(world, action(overrides), reason)
  }
  refused(makeWorld({ blocks: [[1, 8, 8, piston()], [2, 8, 8, 99999]] }), action(), /unknown block state/)
  refused(makeWorld({ blocks: [[1, 8, 8, stateId('stone')]] }), action(), /block mismatch/)
  assert.match(applyRecordedPiston({}, action()).warning, /incomplete playback world contract/)
})
