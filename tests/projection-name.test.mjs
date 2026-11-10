/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  ensureProjectionDisplayName,
  isValidProjectionName,
  normalizeProjectionSlug,
  sanitizeProjectionNameInput,
} from '../src/js/utils/projection-name.js'

describe('sanitizeProjectionNameInput', () => {
  test('strips every non-alphanumeric character', () => {
    assert.equal(sanitizeProjectionNameInput('My World!'), 'MyWorld')
    assert.equal(sanitizeProjectionNameInput('a-b_c.d'), 'abcd')
    assert.equal(sanitizeProjectionNameInput('中文'), '')
  })

  test('trims outer whitespace before sanitizing', () => {
    assert.equal(sanitizeProjectionNameInput('   castle   '), 'castle')
  })

  test('caps the result at 48 characters', () => {
    const long = 'a'.repeat(60)
    assert.equal(sanitizeProjectionNameInput(long).length, 48)
  })

  test('preserves case, unlike normalizeProjectionSlug', () => {
    assert.equal(sanitizeProjectionNameInput('Castle'), 'Castle')
  })

  test('collapses empty-ish input to an empty string', () => {
    assert.equal(sanitizeProjectionNameInput(''), '')
    assert.equal(sanitizeProjectionNameInput('   '), '')
    assert.equal(sanitizeProjectionNameInput(null), '')
    assert.equal(sanitizeProjectionNameInput(undefined), '')
  })
})

describe('normalizeProjectionSlug', () => {
  test('lowercases the sanitized name', () => {
    assert.equal(normalizeProjectionSlug('My World!'), 'myworld')
    assert.equal(normalizeProjectionSlug('CASTLE'), 'castle')
  })

  test('returns an empty string for unusable input', () => {
    assert.equal(normalizeProjectionSlug('!!!'), '')
    assert.equal(normalizeProjectionSlug(), '')
  })
})

describe('isValidProjectionName', () => {
  test('accepts a sanitized non-empty name', () => {
    assert.equal(isValidProjectionName('castle'), true)
    assert.equal(isValidProjectionName('Castle'), true)
    assert.equal(isValidProjectionName('Castle 01'), true)
  })

  test('rejects input that sanitizes down to nothing', () => {
    assert.equal(isValidProjectionName('!!!'), false)
    assert.equal(isValidProjectionName(''), false)
    assert.equal(isValidProjectionName(null), false)
  })

  test('stays valid at the 48 character boundary', () => {
    assert.equal(isValidProjectionName('a'.repeat(48)), true)
    assert.equal(isValidProjectionName('a'.repeat(120)), true) // truncated to 48 first
  })
})

describe('ensureProjectionDisplayName', () => {
  test('uses the sanitized value when there is one', () => {
    assert.equal(ensureProjectionDisplayName('My Castle'), 'MyCastle')
  })

  test('falls back when the value is empty', () => {
    assert.equal(ensureProjectionDisplayName('', 'Fallback'), 'Fallback')
    assert.equal(ensureProjectionDisplayName('!!!', 'Fallback'), 'Fallback')
  })

  test('falls back to the literal World when everything is empty', () => {
    assert.equal(ensureProjectionDisplayName('', ''), 'World')
    assert.equal(ensureProjectionDisplayName(), 'World')
    assert.equal(ensureProjectionDisplayName('!!!', '???'), 'World')
  })
})
