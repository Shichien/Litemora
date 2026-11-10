/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'
import { getMinecraftLightProperties as props } from '../src/js/world/terrain/minecraft-light-properties.js'
import { createVoxelLightField } from '../src/js/world/terrain/minecraft-voxel-light-field.js'

const field = blocks => createVoxelLightField({ min: { x: 0, y: 0, z: 0 }, size: { x: 9, y: 9, z: 9 }, blocks })
function room() {
  const blocks = []
  for (let x = 2; x <= 6; x++) {
    for (let y = 2; y <= 6; y++) {
      for (let z = 2; z <= 6; z++) {
        if ([x, y, z].some(v => v === 2 || v === 6))
          blocks.push({ x, y, z, state: 'minecraft:stone' })
      }
    }
  }
  return blocks
}
test('sealed room is dark and opening/removing roof admits direct sky, closing removes it', () => {
  const f = field(room())
  assert.equal(f.getLight(4, 4, 4).sky, 0)
  f.setBlock(4, 6, 4, 'air').rebuild()
  assert.equal(f.getLight(4, 4, 4).sky, 15)
  assert.equal(f.getLight(5, 4, 4).sky, 14)
  f.setBlock(4, 6, 4, 'stone').rebuild()
  assert.equal(f.getLight(4, 4, 4).sky, 0)
})
test('torch gives Manhattan gradient and source removal clears all residual light', () => {
  const f = field([{ x: 4, y: 4, z: 4, state: 'torch' }])
  assert.equal(f.getLight(4, 4, 4).block, 14)
  assert.equal(f.getLight(5, 4, 4).block, 13)
  assert.equal(f.getLight(5, 5, 5).block, 11)
  f.setBlock(4, 4, 4, 'air').rebuild()
  for (let i = 1; i < f.data.length; i += 4) assert.equal(f.data[i], 0)
})
test('opaque lamp emits outward, switches off, and cannot light through an opaque shell', () => {
  const f = field([...room(), { x: 4, y: 4, z: 4, state: 'redstone_lamp[lit=true]' }])
  assert.equal(f.getLight(4, 4, 4).block, 15)
  assert.equal(f.getLight(5, 4, 4).block, 14)
  assert.equal(f.getLight(7, 4, 4).block, 0)
  f.setBlock(6, 4, 4, 'air').rebuild()
  assert.equal(f.getLight(7, 4, 4).block, 12)
  f.setBlock(6, 4, 4, 'stone').setBlock(4, 4, 4, 'redstone_lamp[lit=false]').rebuild()
  assert.equal(f.getLight(5, 4, 4).block, 0)
})
test('vertical sky through water attenuates and glass transmits while tinted glass blocks', () => {
  const f = createVoxelLightField({ min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 6, z: 1 }, blocks: [{ x: 0, y: 4, z: 0, state: 'water' }] })
  assert.equal(f.getLight(0, 4, 0).sky, 14)
  assert.equal(f.getLight(0, 3, 0).sky, 13)
  f.setBlock(0, 4, 0, 'glass').rebuild()
  assert.equal(f.getLight(0, 0, 0).sky, 15)
  f.setBlock(0, 4, 0, 'tinted_glass').rebuild()
  assert.equal(f.getLight(0, 3, 0).sky, 0)
  assert.equal(f.getLight(0, 4, 0).ao, 0)
})
test('state emission rules preserve zero values and oxidation levels', () => {
  for (const [state, expected] of [['redstone_torch[lit=false]', 0], ['redstone_torch[lit=true]', 7], ['furnace[lit=true]', 13], ['candle[lit=true,candles=4]', 12], ['candle[lit=true,waterlogged=true]', 0], ['respawn_anchor[charges=0]', 0], ['respawn_anchor[charges=3]', 11], ['light[level=0]', 0], ['light[level=12]', 12], ['oxidized_copper_bulb[lit=true]', 4], ['waxed_weathered_copper_bulb[lit=true]', 8], ['exposed_copper_bulb[lit=true]', 12], ['copper_bulb[lit=false]', 0], ['cave_vines[berries=true]', 14], ['sea_pickle[waterlogged=true,pickles=4]', 15], ['sea_pickle[waterlogged=false]', 0], ['lava_cauldron', 15]]) assert.equal(props(state).emission, expected, state)
})
test('AO is an independent full opaque rule, not collision or light opacity', () => {
  assert.equal(props('stone').ao, 255)
  for (const state of ['glass', 'tinted_glass', 'oak_leaves', 'oak_slab[type=bottom]', 'oak_stairs', 'cauldron']) assert.equal(props(state).ao, 0, state)
  assert.equal(props('oak_slab[type=double]').ao, 255)
  assert.equal(props('oak_slab[type=bottom,waterlogged=true]').opacity, 1)
})
test('slab and stair roofs block direct skylight without becoming full AO cubes', () => {
  for (const state of ['oak_slab[type=top]', 'oak_slab[type=bottom]', 'oak_stairs[half=top]', 'oak_stairs[half=bottom]']) {
    const blocks = room().map(b => b.y === 6 && b.x > 2 && b.x < 6 && b.z > 2 && b.z < 6 ? { ...b, state } : b)
    const f = field(blocks)
    assert.equal(f.getLight(4, 4, 4).sky, 0, state)
    assert.equal(f.getLight(4, 6, 4).ao, 0, state)
    f.setBlock(4, 6, 4, 'air').rebuild()
    assert.equal(f.getLight(4, 4, 4).sky, 15, state)
  }
})
test('partial slab accepts side light but blocks its complete source and target boundary faces', () => {
  const solid = []
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 9; y++) {
      for (let z = 0; z < 9; z++) solid.push({ x, y, z, state: 'stone' })
    }
  }
  for (const type of ['top', 'bottom']) {
    const f = field(solid)
    f.setBlock(3, 4, 4, 'torch').setBlock(4, 4, 4, `oak_slab[type=${type}]`).setBlock(4, 3, 4, 'air').setBlock(4, 5, 4, 'air').rebuild()
    assert.equal(f.getLight(4, 4, 4).block, 13)
    const blockedY = type === 'top' ? 5 : 3
    const openY = type === 'top' ? 3 : 5
    assert.equal(f.getLight(4, blockedY, 4).block, 0, type)
    assert.equal(f.getLight(4, openY, 4).block, 12, type)
    f.setBlock(3, 4, 4, 'stone').setBlock(4, blockedY, 4, 'torch').rebuild()
    assert.equal(f.getLight(4, 4, 4).block, 0, `target ${type}`)
  }
})
test('fixed layout is x then y then z and reports unknown states and bounded memory', () => {
  const f = field([{ x: 2, y: 3, z: 4, state: 'light[level=9]' }, { x: 1, y: 1, z: 1, state: 'mod:unlisted' }])
  const i = 4 * (2 + 9 * (3 + 9 * 4))
  assert.equal(f.data[i + 3], 9)
  assert.deepEqual(f.unknownStates, ['mod:unlisted'])
  assert.equal(f.memoryBytes, 9 ** 3 * 11)
  assert.throws(() => f.setBlock(-1, 0, 0, 'stone'), RangeError)
  assert.throws(() => createVoxelLightField({ min: { x: 0, y: 0, z: 0 }, size: { x: 1000, y: 1000, z: 1000 } }), RangeError)
  assert.throws(() => createVoxelLightField({ min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, blocks: [{ x: 0, y: 0, z: 0, state: 'mod:nope' }], strictUnknown: true }), /Unknown/)
})
