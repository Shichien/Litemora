/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  getBlockBehavior,
  isIronBarsBlockType,
  isSlabBlockName,
  isSlabBlockType,
  isStairBlockName,
  isStairBlockType,
  isWallBlockType,
} from '../src/js/world/terrain/block-behaviors.js'

describe('block name predicates', () => {
  test('match the vanilla suffixes', () => {
    assert.equal(isSlabBlockName('stone_slab'), true)
    assert.equal(isStairBlockName('oak_stairs'), true)
    assert.equal(isSlabBlockName('stone'), false)
    assert.equal(isStairBlockName('oak_slab'), false)
  })

  test('ignore the minecraft: namespace prefix', () => {
    assert.equal(isSlabBlockName('minecraft:stone_slab'), true)
    assert.equal(isStairBlockName('minecraft:oak_stairs'), true)
  })

  test('reject empty-ish input', () => {
    assert.equal(isSlabBlockName(''), false)
    assert.equal(isSlabBlockName(), false)
    assert.equal(isSlabBlockName(null), false)
    assert.equal(isStairBlockName(undefined), false)
  })
})

describe('block type predicates', () => {
  test('detect slabs from the geometryType prefix', () => {
    assert.equal(isSlabBlockType({ geometryType: 'slab_bottom' }), true)
    assert.equal(isSlabBlockType({ geometryType: 'slab_top' }), true)
    assert.equal(isSlabBlockType({ geometryType: 'cube' }), false)
  })

  test('fall back to the block name when geometryType is missing', () => {
    assert.equal(isSlabBlockType({ name: 'stone_slab' }), true)
    assert.equal(isStairBlockType({ name: 'oak_stairs' }), true)
    assert.equal(isStairBlockType({ name: 'oak_stairs', geometryType: '' }), true)
  })

  test('prefer geometryType over the name', () => {
    // A "stone" name with a stair geometry is still a stair block.
    assert.equal(isStairBlockType({ name: 'stone', geometryType: 'stair_north' }), true)
  })

  test('detect iron bars and walls', () => {
    assert.equal(isIronBarsBlockType({ name: 'iron_bars' }), true)
    assert.equal(isIronBarsBlockType({ name: 'minecraft:iron_bars' }), true)
    assert.equal(isIronBarsBlockType({ name: 'oak_fence' }), false)
    assert.equal(isIronBarsBlockType({ geometryType: 'bars_post' }), true)

    assert.equal(isWallBlockType({ name: 'cobblestone_wall' }), true)
    assert.equal(isWallBlockType({ geometryType: 'wall_post' }), true)
    assert.equal(isWallBlockType({ name: 'cobblestone' }), false)
  })

  test('never throw on nullish block types', () => {
    assert.equal(isSlabBlockType(), false)
    assert.equal(isSlabBlockType(null), false)
    assert.equal(isStairBlockType(undefined), false)
    assert.equal(isWallBlockType({}), false)
  })
})

describe('getBlockBehavior', () => {
  test('reports every behavior flag at once', () => {
    assert.deepEqual(getBlockBehavior({ name: 'stone_slab', geometryType: 'slab_bottom' }), {
      slab: true,
      stair: false,
      trapdoor: false,
      bars: false,
      wall: false,
    })
  })

  test('returns all-false for a plain cube block', () => {
    assert.deepEqual(getBlockBehavior({ name: 'stone', geometryType: 'cube' }), {
      slab: false,
      stair: false,
      trapdoor: false,
      bars: false,
      wall: false,
    })
  })

  test('handles a missing block type', () => {
    assert.deepEqual(getBlockBehavior(), {
      slab: false,
      stair: false,
      trapdoor: false,
      bars: false,
      wall: false,
    })
  })

  test('flags trapdoors from the geometryType', () => {
    assert.equal(getBlockBehavior({ geometryType: 'trapdoor_open' }).trapdoor, true)
  })
})
