/* eslint-disable test/no-import-node-test -- Use the project's built-in Node test runner. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { captureRenderedThumbnail, waitForThumbnailReady } from '../src/vue/components/admin/preview-thumbnail.js'

function fixture(pixels = [8, 18, 25, 255, 150, 150, 150, 255]) {
  const calls = []
  const scene = { background: 'editor' }
  let clearAlpha = 1
  const manager = {
    eventEmitter: new EventEmitter(),
    renderer: {
      getContext: () => ({ isContextLost: () => false }),
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (alpha) => { clearAlpha = alpha },
    },
    render() {
      assert.equal(scene.background, null)
      assert.equal(clearAlpha, 0)
      calls.push('render')
    },
    requestRender() {
      assert.equal(scene.background, 'editor')
      assert.equal(clearAlpha, 1)
    },
  }
  const context = {
    drawImage() { calls.push('copy') },
    getImageData() { return { data: Uint8ClampedArray.from(pixels) } },
  }
  const canvas = { getContext: () => context, toDataURL: mime => `data:${mime};base64,${'x'.repeat(100)}` }
  const capture = () => captureRenderedThumbnail({ renderManager: manager, sceneManager: { scene } }, { width: 2, height: 1 }, { width: 2, height: 1 }, () => canvas)
  return { manager, canvas, calls, capture }
}

test('captures a fresh synchronous frame without rAF, then copies and encodes', () => {
  const { capture, calls, manager } = fixture()
  assert.match(capture(), /^data:image\/webp;base64,/)
  assert.deepEqual(calls, ['render', 'copy'])
  assert.equal(manager.eventEmitter.listenerCount('renderError'), 0)
})

test('rejects transparent and opaque background-only frames', () => {
  for (const pixels of [[0, 0, 0, 0, 0, 0, 0, 0], [8, 18, 25, 255, 8, 18, 25, 255]]) {
    assert.throws(fixture(pixels).capture, /空白/)
  }
})

test('accepts a single-color model against its framing background', () => {
  assert.ok(fixture([8, 18, 25, 255, 12, 18, 25, 255]).capture())
  assert.ok(fixture([0, 0, 0, 0, 0, 0, 0, 128]).capture())
})

test('rejects lost contexts and disposed or busy renderers', () => {
  for (const flag of ['disposed', 'contextLost', 'isRendering']) {
    const { manager, capture, calls } = fixture()
    manager[flag] = true
    assert.throws(capture, /尚未就绪/)
    assert.deepEqual(calls, [])
  }
})

test('does not copy a stale frame after an internally caught render error', () => {
  const { manager, capture, calls } = fixture()
  manager.render = () => manager.eventEmitter.emit('renderError', { error: new Error('GPU error') })
  assert.throws(capture, /GPU error/)
  assert.deepEqual(calls, [])
  assert.equal(manager.eventEmitter.listenerCount('renderError'), 0)
})

test('rejects invalid encoding and propagates tainted canvas failures', () => {
  const { canvas, capture } = fixture()
  canvas.toDataURL = () => 'data:,'
  assert.throws(capture, /编码失败/)
  canvas.toDataURL = () => {
    throw new Error('SecurityError')
  }
  assert.throws(capture, /SecurityError/)
})

test('pending meshes time out without any rAF and readiness can be retried', async () => {
  await assert.rejects(waitForThumbnailReady(() => false, 10), /尚未就绪/)
  await waitForThumbnailReady(() => true, 10)
})

test('readiness propagates changed model and loading errors', async () => {
  await assert.rejects(waitForThumbnailReady(() => {
    throw new Error('changed model')
  }), /changed model/)
})
