/* eslint-disable test/no-import-node-test -- Use Node's built-in test runner. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { blockStateString, ReplayModPlayback } from '../src/js/replaymod/replaymod-playback.js'

const registry = [
  { name: 'minecraft:air', properties: {} },
  { name: 'minecraft:stone', properties: {} },
  { name: 'minecraft:oak_log', properties: { axis: 'x' } },
]
function recording(events) {
  return { durationMs: 1000, blockStates: registry, events, metadata: {}, initialCamera: { x: 1, y: 65, z: 1, yaw: 0, pitch: 0 } }
}
function state(world) {
  return {
    sections: [...world.sections].map(([key, section]) => [key, Array.from(section.states)]),
    entities: [...world.entities],
    blockEntities: [...world.blockEntities],
    dimension: world.dimension,
  }
}

test('seeks preserve same-time packet order and never mutate recorded chunk arrays', () => {
  const states = new Uint32Array(4096)
  states[0] = 1
  const world = new ReplayModPlayback(recording([
    { type: 'chunk', timeMs: 0, x: 0, z: 0, sections: [{ y: 0, states }] },
    { type: 'block', timeMs: 100, x: 0, y: 0, z: 0, state: 2 },
    { type: 'block', timeMs: 100, x: 0, y: 0, z: 0, state: 0 },
    { type: 'block', timeMs: 101, x: 0, y: 0, z: 0, state: 2 },
  ]))
  world.seek(100)
  assert.equal(world.blockAt(0, 0, 0), 0)
  world.seek(101)
  const final = state(world)
  world.seek(0)
  assert.equal(world.blockAt(0, 0, 0), 1)
  assert.equal(states[0], 1)
  world.seek(101)
  assert.deepEqual(state(world), final)
})

test('negative coordinates and section boundaries resolve independently', () => {
  const world = new ReplayModPlayback(recording([
    { type: 'blocks', timeMs: 0, changes: [
      { x: -1, y: -64, z: -17, state: 2 },
      { x: 0, y: 16, z: 16, state: 1 },
    ] },
  ]))
  world.seek(0)
  assert.equal(world.blockAt(-1, -64, -17), 2)
  assert.equal(world.blockAt(0, 16, 16), 1)
  assert.equal(world.blockAt(-1, -63, -17), 0)
  assert.ok(world.sections.has('-1,-4,-2'))
  assert.ok(world.dirtySections.has('-2,-4,-2'))
})

test('replacement chunks remove obsolete sections and embedded block entities', () => {
  const filled = new Uint32Array(4096).fill(1)
  const world = new ReplayModPlayback(recording([
    { type: 'chunk', timeMs: 0, x: 0, z: 0, sections: [{ y: 0, states: filled }, { y: 1, states: filled }], blockEntities: [{ x: 1, y: 1, z: 1, type: 'chest', data: {} }] },
    { type: 'chunk', timeMs: 10, x: 0, z: 0, sections: [{ y: 1, states: filled }] },
    { type: 'unloadChunk', timeMs: 20, x: 0, z: 0 },
  ]))
  world.seek(0)
  assert.equal(world.blockEntities.size, 1)
  world.seek(10)
  assert.equal(world.blockAt(0, 0, 0), 0)
  assert.equal(world.blockAt(0, 16, 0), 1)
  assert.equal(world.blockEntities.size, 0)
  world.seek(20)
  assert.equal(world.sections.size, 0)
})

test('dimension switch clears old world and entities, backward seek reconstructs them', () => {
  const world = new ReplayModPlayback(recording([
    { type: 'dimension', timeMs: 0, dimension: 'minecraft:overworld' },
    { type: 'block', timeMs: 0, x: 1, y: 64, z: 1, state: 1 },
    { type: 'entitySpawn', timeMs: 0, id: 4, entityType: 'minecraft:iron_golem', x: 1, y: 64, z: 2 },
    { type: 'dimension', timeMs: 10, dimension: 'minecraft:the_nether' },
  ]))
  world.seek(0)
  const before = state(world)
  world.seek(10)
  assert.equal(world.entities.size, 0)
  assert.equal(world.sections.size, 0)
  assert.equal(world.dimension, 'minecraft:the_nether')
  world.seek(0)
  assert.deepEqual(state(world), before)
})

test('entity movement, partial metadata, item stack, removal and reused id remain ordered', () => {
  const world = new ReplayModPlayback(recording([
    { type: 'entitySpawn', timeMs: 0, id: 7, entityType: 'minecraft:item', x: 0, y: 65, z: 0 },
    { type: 'entityData', timeMs: 1, id: 7, metadata: [{ key: 0, value: 0 }, { key: 8, value: 'stack' }], item: { id: 1, name: 'minecraft:stone', count: 2 } },
    { type: 'entityData', timeMs: 2, id: 7, metadata: [{ key: 0, value: 32 }] },
    { type: 'entityMove', timeMs: 3, id: 7, x: 1.25, y: 64, z: -0.125, yaw: 90 },
    { type: 'entityRemove', timeMs: 5, ids: [7] },
    { type: 'entitySpawn', timeMs: 6, id: 7, entityType: 'minecraft:villager', x: 10, y: 65, z: 0 },
  ]))
  world.seek(3)
  assert.equal(world.entities.get(7).type, 'minecraft:item')
  assert.equal(world.entities.get(7).item.count, 2)
  assert.deepEqual(world.entities.get(7).metadata, [{ key: 0, value: 32 }, { key: 8, value: 'stack' }])
  assert.equal(world.entities.get(7).x, 1.25)
  world.seek(5)
  assert.equal(world.entities.size, 0)
  world.seek(6)
  assert.equal(world.entities.get(7).type, 'minecraft:villager')
  assert.equal(world.entities.get(7).item, undefined)
  assert.equal(world.entities.get(7).spawnedAt, 6)
})

test('registry properties remain explicit in resource model requests', () => {
  assert.equal(blockStateString(registry[2]), 'minecraft:oak_log[axis=x]')
  assert.equal(blockStateString({ name: 'stone' }), 'minecraft:stone')
})
