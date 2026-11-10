/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import {
  buildPositionShareUrl,
  formatSharedPosition,
  readSharedPosition,
} from '../src/js/utils/share-position.js'

const BASE = 'https://litemora.art/space1/worlds/p1'

afterEach(() => {
  delete globalThis.window
})

describe('formatSharedPosition', () => {
  test('rounds each axis to two decimals', () => {
    assert.equal(formatSharedPosition({ x: 1.234, y: 2.5, z: -3.999 }), '1.23,2.5,-4')
  })

  test('coerces numeric strings', () => {
    assert.equal(formatSharedPosition({ x: '10', y: '20.456', z: '0' }), '10,20.46,0')
  })

  test('replaces non-finite axes with 0', () => {
    assert.equal(formatSharedPosition({ x: Number.NaN, y: Infinity, z: 'abc' }), '0,0,0')
  })

  test('handles a missing or empty position', () => {
    assert.equal(formatSharedPosition(), '0,0,0')
    assert.equal(formatSharedPosition({}), '0,0,0')
  })

  test('normalizes negative zero to 0', () => {
    assert.equal(formatSharedPosition({ x: -0, y: 0, z: 0 }), '0,0,0')
  })
})

describe('buildPositionShareUrl', () => {
  test('adds the position as the `at` query parameter', () => {
    const url = buildPositionShareUrl({ x: 1, y: 2, z: 3 }, BASE)

    assert.equal(url, `${BASE}?at=1%2C2%2C3`)
  })

  test('drops the view-state hash', () => {
    const url = buildPositionShareUrl({ x: 1, y: 2, z: 3 }, `${BASE}#admin-config`)

    assert.equal(new URL(url).hash, '')
  })

  test('replaces an existing `at` parameter instead of duplicating it', () => {
    const url = buildPositionShareUrl({ x: 9, y: 9, z: 9 }, `${BASE}?at=1,1,1`)
    const params = new URL(url).searchParams

    assert.deepEqual(params.getAll('at'), ['9,9,9'])
  })

  test('defaults the base url to window.location.href', () => {
    globalThis.window = { location: { href: BASE, search: '' } }

    assert.equal(buildPositionShareUrl({ x: 1, y: 2, z: 3 }), `${BASE}?at=1%2C2%2C3`)
  })

  test('throws on an unparsable base url', () => {
    assert.throws(() => buildPositionShareUrl({ x: 1, y: 2, z: 3 }, 'not a url'))
  })
})

describe('readSharedPosition', () => {
  test('parses a well-formed position', () => {
    assert.deepEqual(readSharedPosition('?at=1,2,3'), { x: 1, y: 2, z: 3 })
  })

  test('tolerates whitespace and decimals', () => {
    assert.deepEqual(readSharedPosition('?at=1.5, -2 ,3.25'), { x: 1.5, y: -2, z: 3.25 })
  })

  test('returns null when the parameter is absent', () => {
    assert.equal(readSharedPosition(''), null)
    assert.equal(readSharedPosition('?other=1,2,3'), null)
  })

  test('returns null for a malformed position', () => {
    assert.equal(readSharedPosition('?at=1,2'), null)
    assert.equal(readSharedPosition('?at=1,2,3,4'), null)
    assert.equal(readSharedPosition('?at=a,b,c'), null)
    assert.equal(readSharedPosition('?at='), null)
  })

  test('round-trips with buildPositionShareUrl', () => {
    const position = { x: -12.34, y: 64.5, z: 7 }
    const search = new URL(buildPositionShareUrl(position, BASE)).search

    assert.deepEqual(readSharedPosition(search), position)
  })

  test('defaults the query string to window.location.search', () => {
    globalThis.window = { location: { search: '?at=4,5,6', href: BASE } }

    assert.deepEqual(readSharedPosition(), { x: 4, y: 5, z: 6 })
  })
})
