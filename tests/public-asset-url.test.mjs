/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { resolvePublicAssetPath, resolvePublicAssetUrl } from '../src/js/utils/public-asset-url.js'

// Under `node --test` the module resolves `import.meta.env` to undefined, so
// getBaseUrl() falls back to '/'. Every non-absolute path therefore becomes '/<path>'.
describe('resolvePublicAssetUrl', () => {
  test('passes protocol-relative and absolute URLs through unchanged', () => {
    assert.equal(resolvePublicAssetUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png')
    assert.equal(resolvePublicAssetUrl('//cdn.example.com/a.png'), '//cdn.example.com/a.png')
    assert.equal(resolvePublicAssetUrl('http://cdn.example.com/a.png'), 'http://cdn.example.com/a.png')
  })

  test('passes data: and blob: URLs through unchanged', () => {
    assert.equal(resolvePublicAssetUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
    assert.equal(resolvePublicAssetUrl('blob:https://x/1234'), 'blob:https://x/1234')
  })

  test('prefixes a relative path with the base url', () => {
    assert.equal(resolvePublicAssetUrl('textures/stone.png'), '/textures/stone.png')
    assert.equal(resolvePublicAssetUrl('a/b/c.json'), '/a/b/c.json')
  })

  test('strips a single leading slash so the base url is not doubled', () => {
    assert.equal(resolvePublicAssetUrl('/textures/stone.png'), '/textures/stone.png')
  })

  test('treats two or more leading slashes as an already-absolute url', () => {
    // isAbsoluteAssetUrl() matches `//` (protocol-relative), so these bypass the base url
    // entirely instead of being collapsed into a single root-relative path.
    assert.equal(resolvePublicAssetUrl('//textures/stone.png'), '//textures/stone.png')
    assert.equal(resolvePublicAssetUrl('///textures/stone.png'), '///textures/stone.png')
  })

  test('trims surrounding whitespace', () => {
    assert.equal(resolvePublicAssetUrl('  textures/stone.png  '), '/textures/stone.png')
    assert.equal(resolvePublicAssetUrl('  https://cdn.example.com/a.png  '), 'https://cdn.example.com/a.png')
  })

  test('returns empty-ish input as an empty string', () => {
    assert.equal(resolvePublicAssetUrl(''), '')
    assert.equal(resolvePublicAssetUrl('   '), '')
  })

  test('returns non-string input untouched', () => {
    assert.equal(resolvePublicAssetUrl(undefined), undefined)
    assert.equal(resolvePublicAssetUrl(null), null)
    assert.equal(resolvePublicAssetUrl(42), 42)
  })

  test('does not mistake a scheme-like relative segment for an absolute url', () => {
    // "textures:" has no "//", so it is a relative path, not a scheme.
    assert.equal(resolvePublicAssetUrl('textures:stone.png'), '/textures:stone.png')
  })
})

describe('resolvePublicAssetPath', () => {
  test('maps arrays element-wise', () => {
    assert.deepEqual(
      resolvePublicAssetPath(['a.png', 'https://cdn.example.com/b.png', '', '  c.png  ']),
      ['/a.png', 'https://cdn.example.com/b.png', '', '/c.png'],
    )
  })

  test('maps an empty array to an empty array', () => {
    assert.deepEqual(resolvePublicAssetPath([]), [])
  })

  test('behaves like resolvePublicAssetUrl for scalars', () => {
    assert.equal(resolvePublicAssetPath('a.png'), '/a.png')
    assert.equal(resolvePublicAssetPath('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
    assert.equal(resolvePublicAssetPath(undefined), undefined)
  })
})
