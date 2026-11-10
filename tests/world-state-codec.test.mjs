/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  decodeWorldStateSnapshot,
  encodeWorldStateSnapshot,
} from '../src/js/world/terrain/world-state-codec.js'

const FORMAT = 'chunk-v2'

describe('encodeWorldStateSnapshot', () => {
  test('emits the chunk-v2 envelope and defaults', () => {
    const encoded = encodeWorldStateSnapshot()

    assert.equal(encoded.format, FORMAT)
    assert.equal(encoded.version, 1)
    assert.equal(encoded.chunkWidth, 64)
    assert.deepEqual(encoded.chunks, {})
  })

  test('tolerates a null snapshot instead of throwing', () => {
    const encoded = encodeWorldStateSnapshot(null)

    assert.equal(encoded.format, FORMAT)
    assert.deepEqual(encoded.chunks, {})
  })

  test('drops out-of-range and malformed block keys', () => {
    const encoded = encodeWorldStateSnapshot({
      modifications: {
        '0,0': {
          '0,0,0': 1, // kept
          '64,0,0': 1, // x beyond chunk width
          '0,0,64': 1, // z beyond chunk width
          '0,4096,0': 1, // y beyond MAX_Y
          '-1,0,0': 1, // negative
          '0,0': 1, // missing component
          'a,b,c': 1, // not numeric
          '1,2,3,4': 1, // extra component is ignored, x/y/z = 1,2,3
        },
      },
    })

    assert.equal(encoded.chunks['0,0'].c, 2)
  })

  test('truncates fractional coordinates and tolerates padding whitespace', () => {
    const encoded = encodeWorldStateSnapshot({
      modifications: { '0,0': { '1.9,2.2,3.7': 5, ' 4 , 5 , 6 ': 5 } },
    })
    const decoded = decodeWorldStateSnapshot(encoded)

    assert.deepEqual(Object.keys(decoded.modifications['0,0']).sort(), ['1,2,3', '4,5,6'])
  })

  test('collapses repeated block ids into a single palette entry', () => {
    const encoded = encodeWorldStateSnapshot({
      modifications: { '0,0': { '0,0,0': 7, '1,0,0': 7, '2,0,0': 7 } },
    })

    assert.deepEqual(encoded.chunks['0,0'].p, [7])
    assert.equal(encoded.chunks['0,0'].c, 3)
  })

  test('normalizes non-positive and unparsable block ids to the empty id', () => {
    const encoded = encodeWorldStateSnapshot({
      modifications: { '0,0': { '0,0,0': -5, '1,0,0': 0, '2,0,0': 'nope', '3,0,0': 7 } },
    })

    assert.deepEqual(encoded.chunks['0,0'].p, [0, 7])
  })

  test('honours a custom chunkWidth and falls back when it is not usable', () => {
    const narrow = encodeWorldStateSnapshot({
      modifications: { '0,0': { '31,0,0': 1, '32,0,0': 1 } },
    }, { chunkWidth: 32 })

    assert.equal(narrow.chunkWidth, 32)
    assert.equal(narrow.chunks['0,0'].c, 1)

    assert.equal(encodeWorldStateSnapshot({}, { chunkWidth: 0 }).chunkWidth, 64)
  })

  test('keeps only well-formed transient removed blocks', () => {
    const encoded = encodeWorldStateSnapshot({
      worldState: {
        minecraftTransientRemovedBlocks: {
          '1,2,3': { blockName: 'minecraft:stone', properties: { facing: 'north' } },
          '4,5,6': { blockName: '   ' }, // blank name is dropped
          '   ': { blockName: 'stone' }, // blank key is dropped
          '7,8,9': null, // not an object
        },
      },
    })

    assert.deepEqual(encoded.worldState.minecraftTransientRemovedBlocks, {
      '1,2,3': { blockName: 'stone', properties: { facing: 'north' } },
    })
  })

  test('coerces an unusable worldState into safe defaults', () => {
    const encoded = encodeWorldStateSnapshot({ worldState: { schematicOnlyMode: 1, minecraftSchematicLayer: 'nope' } })

    assert.equal(encoded.worldState.schematicOnlyMode, true)
    assert.equal(encoded.worldState.minecraftSchematicLayer, null)
  })
})

describe('decodeWorldStateSnapshot', () => {
  test('round-trips a multi-chunk modification map exactly', () => {
    const snapshot = {
      worldState: { schematicOnlyMode: true, minecraftSchematicLayer: { name: 'demo' } },
      modifications: {
        '0,0': { '0,0,0': 1, '63,4095,63': 2, '10,5,20': 3 },
        '1,-1': { '0,1,0': 4 },
        '-2,3': { '12,34,56': 99 },
      },
    }

    const decoded = decodeWorldStateSnapshot(encodeWorldStateSnapshot(snapshot))

    assert.deepEqual(decoded.modifications, snapshot.modifications)
    assert.equal(decoded.worldState.schematicOnlyMode, true)
    assert.deepEqual(decoded.worldState.minecraftSchematicLayer, { name: 'demo' })
  })

  test('round-trips through JSON.stringify, the way persistence stores it', () => {
    const snapshot = { modifications: { '0,0': { '1,2,3': 11, '60,70,62': 12 } } }
    const encoded = encodeWorldStateSnapshot(snapshot)

    const decoded = decodeWorldStateSnapshot(JSON.parse(JSON.stringify(encoded)))

    assert.deepEqual(decoded.modifications, snapshot.modifications)
  })

  test('passes legacy (non chunk-v2) payloads through untouched', () => {
    const legacy = {
      worldState: { schematicOnlyMode: false },
      modifications: { '0,0': { '1,2,3': 4 } },
    }

    const decoded = decodeWorldStateSnapshot(legacy)

    assert.deepEqual(decoded.modifications, legacy.modifications)
    assert.equal(decoded.worldState.schematicOnlyMode, false)
  })

  test('falls back to an empty modification map for unusable input', () => {
    assert.deepEqual(decodeWorldStateSnapshot(null).modifications, {})
    assert.deepEqual(decodeWorldStateSnapshot({ format: FORMAT }).modifications, {})
    assert.deepEqual(decodeWorldStateSnapshot({ format: FORMAT, chunks: 'nope' }).modifications, {})
  })

  test('clamps a lying block count instead of over-reading the buffers', () => {
    const encoded = encodeWorldStateSnapshot({ modifications: { '0,0': { '0,0,0': 1, '1,0,0': 2 } } })
    encoded.chunks['0,0'].c = 1000

    const decoded = decodeWorldStateSnapshot(encoded)

    assert.deepEqual(decoded.modifications['0,0'], { '0,0,0': 1, '1,0,0': 2 })
  })

  test('skips chunks with no palette or no declared blocks', () => {
    const decoded = decodeWorldStateSnapshot({
      format: FORMAT,
      chunks: {
        '0,0': { p: [], pos: '', pid: '', c: 3 },
        '1,0': { p: [5], pos: '', pid: '', c: 0 },
        '2,0': { p: [5], pos: '', pid: '', c: 2 },
      },
    })

    assert.deepEqual(decoded.modifications, {})
  })

  test('resolves legacy palette descriptors that only carry a shape hint', () => {
    const encoded = encodeWorldStateSnapshot({ modifications: { '0,0': { '0,0,0': 1 } } })
    encoded.chunks['0,0'].p = [{ textureName: 'stone' }]

    const decoded = decodeWorldStateSnapshot(encoded)

    // The legacy fallback id (3) keeps a texture-only palette entry renderable.
    assert.deepEqual(decoded.modifications['0,0'], { '0,0,0': 3 })
  })
})
