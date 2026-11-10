/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'

import {
  buildSpaceProjectionUrl,
  buildSpaceScopedKey,
  buildSpaceUrl,
  buildSpaceWorldsAdminUrl,
  buildSpaceWorldsUrl,
  getActiveProjectionId,
  getActiveSpaceName,
  getLegacyGallerySpaceName,
  isSpaceProjectionRoute,
  isSpaceWorldsRoute,
  isValidSpaceName,
  normalizeSpaceName,
  shouldUseRootPortalView,
} from '../src/js/utils/space-context.js'

const ORIGIN = 'https://litemora.art'

/**
 * The module reads `window.location` in default parameters, so a plain global stub
 * is enough to drive it from Node.
 */
function useLocation({ pathname = '/', search = '', hostname = 'litemora.art' } = {}) {
  globalThis.window = {
    location: { origin: ORIGIN, pathname, search, hostname, href: `${ORIGIN}${pathname}${search}` },
  }
}

beforeEach(() => useLocation())
afterEach(() => {
  delete globalThis.window
})

describe('normalizeSpaceName', () => {
  test('trims and lowercases', () => {
    assert.equal(normalizeSpaceName('  MySpace  '), 'myspace')
    assert.equal(normalizeSpaceName('ALREADY-lower'), 'already-lower')
  })

  test('collapses empty-ish input to an empty string', () => {
    assert.equal(normalizeSpaceName(), '')
    assert.equal(normalizeSpaceName(null), '')
    assert.equal(normalizeSpaceName(undefined), '')
    assert.equal(normalizeSpaceName('   '), '')
  })

  test('stringifies non-string input', () => {
    assert.equal(normalizeSpaceName(123), '123')
  })
})

describe('isValidSpaceName', () => {
  test('enforces the 3..63 length window', () => {
    assert.equal(isValidSpaceName('ab'), false)
    assert.equal(isValidSpaceName('abc'), true)
    assert.equal(isValidSpaceName('a'.repeat(63)), true)
    assert.equal(isValidSpaceName('a'.repeat(64)), false)
  })

  test('accepts lowercase alphanumerics and dashes only', () => {
    assert.equal(isValidSpaceName('my-space-01'), true)
    assert.equal(isValidSpaceName('MY-SPACE-01'), true)
    assert.equal(isValidSpaceName('my_space'), false)
    assert.equal(isValidSpaceName('my space'), false)
    assert.equal(isValidSpaceName('my/space'), false)
  })

  test('rejects empty and missing input', () => {
    assert.equal(isValidSpaceName(''), false)
    assert.equal(isValidSpaceName(), false)
    assert.equal(isValidSpaceName(null), false)
  })
})

describe('space url builders', () => {
  test('buildSpaceUrl normalizes before building', () => {
    assert.equal(buildSpaceUrl('MySpace'), `${ORIGIN}/myspace`)
    assert.equal(buildSpaceUrl('  abc  '), `${ORIGIN}/abc`)
  })

  test('buildSpaceUrl rejects invalid names', () => {
    assert.throws(() => buildSpaceUrl('ab'), /invalid_space_name/)
    assert.throws(() => buildSpaceUrl('bad_name'), /invalid_space_name/)
    assert.throws(() => buildSpaceUrl(), /invalid_space_name/)
  })

  test('buildSpaceWorldsUrl appends the worlds segment', () => {
    assert.equal(buildSpaceWorldsUrl('space1'), `${ORIGIN}/space1/worlds`)
  })

  test('buildSpaceProjectionUrl encodes the projection id and rejects an empty one', () => {
    assert.equal(buildSpaceProjectionUrl('space1', 'proj 1'), `${ORIGIN}/space1/worlds/proj%201`)
    assert.throws(() => buildSpaceProjectionUrl('space1', '   '), /invalid_projection_id/)
    assert.throws(() => buildSpaceProjectionUrl('ab', 'p1'), /invalid_space_name/)
  })

  test('buildSpaceWorldsAdminUrl carries the projection query and the admin hash', () => {
    assert.equal(
      buildSpaceWorldsAdminUrl('space1', 'p1'),
      `${ORIGIN}/space1/worlds?projection=p1#admin-config`,
    )
    assert.equal(buildSpaceWorldsAdminUrl('space1'), `${ORIGIN}/space1/worlds#admin-config`)
  })
})

describe('route detection', () => {
  test('isSpaceWorldsRoute only matches <space>/worlds', () => {
    assert.equal(isSpaceWorldsRoute('/space1/worlds'), true)
    assert.equal(isSpaceWorldsRoute('/space1/WORLDS'), true)
    assert.equal(isSpaceWorldsRoute('/space1/worlds/p1'), false)
    assert.equal(isSpaceWorldsRoute('/space1'), false)
    assert.equal(isSpaceWorldsRoute('/'), false)
  })

  test('reserved first segments are never treated as a space', () => {
    assert.equal(isSpaceWorldsRoute('/gallery/worlds'), false)
    assert.equal(isSpaceWorldsRoute('/api/worlds'), false)
    assert.equal(getLegacyGallerySpaceName('/gallery/myspace'), 'myspace')
    assert.equal(getLegacyGallerySpaceName('/gallery/ab'), '')
    assert.equal(getLegacyGallerySpaceName('/space1/worlds'), '')
  })

  test('isSpaceProjectionRoute needs a third segment', () => {
    assert.equal(isSpaceProjectionRoute('/space1/worlds/p1'), true)
    assert.equal(isSpaceProjectionRoute('/space1/worlds'), false)
    assert.equal(isSpaceProjectionRoute('/space1/p1'), false)
  })

  test('getActiveProjectionId reads the path first, then the query', () => {
    assert.equal(getActiveProjectionId('/space1/worlds/p1', ''), 'p1')
    assert.equal(getActiveProjectionId('/space1/worlds', '?projection=p2'), 'p2')
    assert.equal(getActiveProjectionId('/space1/worlds/p1', '?projection=p2'), 'p1')
    assert.equal(getActiveProjectionId('/space1', '?projection=p2'), '')
  })
})

describe('getActiveSpaceName', () => {
  test('reads the space from the pathname', () => {
    useLocation({ pathname: '/myspace/worlds' })
    assert.equal(getActiveSpaceName(), 'myspace')
  })

  test('falls back to the subdomain', () => {
    useLocation({ pathname: '/', hostname: 'myspace.litemora.art' })
    assert.equal(getActiveSpaceName(), 'myspace')
  })

  test('ignores the root portal host', () => {
    useLocation({ pathname: '/', hostname: 'litemora.art' })
    assert.equal(getActiveSpaceName(), '')
    useLocation({ pathname: '/', hostname: 'www.litemora.art' })
    assert.equal(getActiveSpaceName(), '')
  })

  test('falls back to a valid ?space= query and rejects an invalid one', () => {
    useLocation({ pathname: '/', hostname: 'example.com', search: '?space=myspace' })
    assert.equal(getActiveSpaceName(), 'myspace')

    useLocation({ pathname: '/', hostname: 'example.com', search: '?space=ab' })
    assert.equal(getActiveSpaceName(), '')
  })

  test('shouldUseRootPortalView is the inverse of having an active space', () => {
    useLocation({ pathname: '/' })
    assert.equal(shouldUseRootPortalView(), true)

    useLocation({ pathname: '/myspace' })
    assert.equal(shouldUseRootPortalView(), false)
  })
})

describe('buildSpaceScopedKey', () => {
  test('returns an empty key for blank input', () => {
    assert.equal(buildSpaceScopedKey(''), '')
    assert.equal(buildSpaceScopedKey('   '), '')
    assert.equal(buildSpaceScopedKey(), '')
  })

  test('appends space and projection scopes in a stable order', () => {
    assert.equal(buildSpaceScopedKey('base', 'space1'), 'base:space:space1')
    assert.equal(buildSpaceScopedKey('base', 'space1', 'p 1'), 'base:space:space1:projection:p%201')
    assert.equal(buildSpaceScopedKey('base', 'space1', '   '), 'base:space:space1')
  })

  test('omits the space scope when there is no active space', () => {
    useLocation({ pathname: '/' })
    assert.equal(buildSpaceScopedKey('base'), 'base')
    assert.equal(buildSpaceScopedKey('base', '', 'p1'), 'base:projection:p1')
  })
})
