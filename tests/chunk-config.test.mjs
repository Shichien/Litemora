/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { CHUNK_BASIC_CONFIG } from '../src/js/config/chunk-config.js'

describe('CHUNK_BASIC_CONFIG', () => {
  test('keeps the chunk grid self-consistent', () => {
    assert.equal(CHUNK_BASIC_CONFIG.chunkWidth, 64)
    assert.equal(CHUNK_BASIC_CONFIG.chunkHeight, 32)
    assert.ok(CHUNK_BASIC_CONFIG.chunkWidth > 0)
    assert.ok(CHUNK_BASIC_CONFIG.chunkHeight > 0)
  })

  test('keeps the unload radius strictly larger than the view distance', () => {
    assert.equal(CHUNK_BASIC_CONFIG.viewDistance, 1)
    assert.equal(CHUNK_BASIC_CONFIG.unloadPadding, 1)
    assert.ok(CHUNK_BASIC_CONFIG.unloadPadding > 0)
    assert.ok(
      CHUNK_BASIC_CONFIG.viewDistance + CHUNK_BASIC_CONFIG.unloadPadding > CHUNK_BASIC_CONFIG.viewDistance,
    )
  })

  test('uses an autosave delay that actually throttles', () => {
    assert.equal(typeof CHUNK_BASIC_CONFIG.autoSaveDelay, 'number')
    assert.ok(CHUNK_BASIC_CONFIG.autoSaveDelay >= 500)
  })

  test('defaults to IndexedDB persistence under a non-empty world name', () => {
    assert.equal(CHUNK_BASIC_CONFIG.useIndexedDB, true)
    assert.equal(CHUNK_BASIC_CONFIG.worldName, 'default')
  })

  test('stays a plain, mutable config object', () => {
    // The settings panel patches these values in place; freezing them would break it.
    assert.equal(Object.isFrozen(CHUNK_BASIC_CONFIG), false)
    assert.deepEqual(Object.keys(CHUNK_BASIC_CONFIG).sort(), [
      'autoSaveDelay',
      'chunkHeight',
      'chunkWidth',
      'unloadPadding',
      'useIndexedDB',
      'viewDistance',
      'worldName',
    ])
  })
})
