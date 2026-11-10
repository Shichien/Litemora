/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { variantBoolean, variantString } from '../src/js/world/terrain/block-state-adapter.js'

describe('variantString', () => {
  test('lowercases plain strings', () => {
    assert.equal(variantString('NORTH'), 'north')
    assert.equal(variantString('Bottom'), 'bottom')
  })

  test('unwraps { value } descriptors', () => {
    assert.equal(variantString({ value: 'EAST' }), 'east')
    assert.equal(variantString({ value: true }), 'true')
    assert.equal(variantString({ value: 12 }), '12')
  })

  test('stringifies other primitives', () => {
    assert.equal(variantString(1), '1')
    assert.equal(variantString(0), '0')
    assert.equal(variantString(false), 'false')
  })

  test('collapses null and undefined to an empty string', () => {
    assert.equal(variantString(null), '')
    assert.equal(variantString(undefined), '')
    assert.equal(variantString(), '')
  })

  test('keeps an already-empty string empty', () => {
    assert.equal(variantString(''), '')
  })
})

describe('variantBoolean', () => {
  test('accepts the truthy spellings', () => {
    assert.equal(variantBoolean('true'), true)
    assert.equal(variantBoolean('TRUE'), true)
    assert.equal(variantBoolean('1'), true)
    assert.equal(variantBoolean('yes'), true)
    assert.equal(variantBoolean({ value: 'true' }), true)
  })

  test('rejects everything else', () => {
    assert.equal(variantBoolean('false'), false)
    assert.equal(variantBoolean('0'), false)
    assert.equal(variantBoolean('no'), false)
    assert.equal(variantBoolean(''), false)
    assert.equal(variantBoolean(null), false)
    assert.equal(variantBoolean(undefined), false)
  })
})
