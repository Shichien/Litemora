/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { MinecraftLightRuntime } from '../src/js/world/terrain/minecraft-light-runtime.js'
import { processLightMessage, sourceLightBounds } from '../src/js/world/terrain/minecraft-light.worker.js'

class FakeWorker {
  messages = []
  terminated = false
  postMessage(message) { this.messages.push(message) }
  terminate() { this.terminated = true }
  answer(version, value = 15) { this.onmessage({ data: { type: 'field', version, min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, data: new Uint8Array([value, 0, 0, 0]), cells: 1 } }) }
}
function runtimeHarness() {
  const workers = []
  const applied = []
  const statuses = []
  const runtime = new MinecraftLightRuntime({
    workerFactory: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    onField: field => applied.push(field),
    onStatus: status => statuses.push(status),
  })
  runtime.initialize({ buffer: new ArrayBuffer(1) })
  return { runtime, workers, applied, statuses }
}

test('worker latest queue coalesces blocks without starving playback results', () => {
  const { runtime, workers, applied } = runtimeHarness()
  const worker = workers[0]
  worker.answer(1)
  runtime.setBlock(0, 0, 0, 'minecraft:torch')
  runtime.commit()
  runtime.setBlock(0, 0, 0, 'minecraft:stone')
  runtime.commit()
  runtime.setBlock(0, 0, 0, 'minecraft:air')
  runtime.commit()
  assert.equal(worker.messages.length, 2)
  worker.answer(2, 14)
  assert.equal(runtime.appliedVersion, 2, 'valid intermediate frame must display during continuous playback')
  assert.equal(worker.messages.length, 3)
  assert.equal(worker.messages[2].changes.length, 1)
  assert.equal(worker.messages[2].changes[0].state, 'minecraft:air')
  worker.answer(4, 0)
  assert.equal(runtime.appliedVersion, 4)
  assert.equal(applied.at(-1).data[0], 0)
  assert.deepEqual(runtime.getLight(0, 0, 0), { sky: 0, block: 0, ao: 0, emission: 0 })
  assert.equal(runtime.getLight(0.5, 0, 0), null)
})

test('seek cutoffs and disposed worlds reject stale worker data', () => {
  const { runtime, workers } = runtimeHarness()
  const old = workers[0]
  old.answer(1)
  runtime.setBlock(0, 0, 0, 'minecraft:torch')
  runtime.commit()
  runtime.setBlock(0, 0, 0, 'minecraft:air')
  runtime.commit({ reset: true })
  old.answer(2, 14)
  assert.equal(runtime.appliedVersion, 1)
  old.answer(3, 0)
  assert.equal(runtime.appliedVersion, 3)
  runtime.initialize({ buffer: new ArrayBuffer(1) })
  assert.equal(old.terminated, true)
  old.answer(99, 15)
  assert.equal(runtime.field, null)
  workers[1].answer(1, 9)
  assert.equal(runtime.getLight(0, 0, 0).sky, 9)
  runtime.dispose()
  workers[1].answer(8, 15)
  assert.equal(runtime.status.state, 'idle')
  assert.equal(runtime.field, null)
})

test('empty explicit reset still produces a fresh field after an in-flight initialization', () => {
  const { runtime, workers } = runtimeHarness()
  runtime.commit({ reset: true })
  workers[0].answer(1)
  assert.equal(runtime.field, null)
  assert.equal(workers[0].messages[1].version, 2)
  assert.deepEqual(workers[0].messages[1].changes, [])
  workers[0].answer(2)
  assert.equal(runtime.status.state, 'ready')
  assert.equal(runtime.appliedVersion, 2)
})

test('budget failure is visible and does not throw or retain an old field', () => {
  const { runtime, workers } = runtimeHarness()
  workers[0].onmessage({ data: { type: 'limited', reason: 'field_budget_exceeded', message: '基础光照', cells: 5000000 } })
  assert.equal(runtime.status.state, 'limited')
  assert.equal(runtime.status.reason, 'field_budget_exceeded')
  assert.equal(runtime.field, null)
})

test('full source bounds account for signed region sizes and all nondefault regions', () => {
  const result = sourceLightBounds({ first: { position: { x: 4, y: 2, z: 0 }, size: { x: -3, y: 4, z: 2 } }, second: { position: { x: 50, y: 0, z: 20 }, size: { x: 2, y: 2, z: 2 } } }, { x: 10, y: -3, z: 5 })
  assert.deepEqual(result.min, { x: -3, y: -18, z: -10 })
  assert.deepEqual(result.size, { x: 80, y: 36, z: 52 })
})

test('worker parses the real source independently and enforces limits before allocating light volume', async () => {
  const bytes = await readFile(new URL('../public/redstone-archive/single-lever-piston-door-3x3.litematic', import.meta.url))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const limited = await processLightMessage({ type: 'initialize', buffer, version: 1, offset: {}, maxVoxels: 1, maxAxis: 256 })
  assert.equal(limited.type, 'limited')
  const ready = await processLightMessage({ type: 'initialize', buffer, version: 2, offset: { x: 7, y: 3, z: -4 }, maxVoxels: 4194304, maxAxis: 256 })
  assert.equal(ready.type, 'field')
  assert.equal(ready.data.length, ready.size.x * ready.size.y * ready.size.z * 4)
  assert.deepEqual(ready.min, { x: -8, y: -12, z: -19 })
  const removed = await processLightMessage({ type: 'update', version: 3, changes: [{ x: 7, y: 3, z: -4, state: 'minecraft:air' }] })
  assert.equal(removed.version, 3)
  assert.notEqual(removed.data, ready.data)
})

test('controller reset writes air for absent touched positions and settles moving piston light state', async () => {
  const source = await readFile(new URL('../src/js/world/redstone-replay-controller.js', import.meta.url), 'utf8')
  const executable = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace('export default class RedstoneReplayController', 'class RedstoneReplayController').replaceAll('export function ', 'function ')
  const Controller = vm.runInNewContext(`${executable};RedstoneReplayController`, { AIR_BLOCK_STRING: 'minecraft:air' })
  const writes = []
  const controller = Object.create(Controller.prototype)
  Object.assign(controller, { world: { minecraftSchematicRenderLayer: { _runtimeBridge: { lightRuntime: { setBlock: (...args) => writes.push(args) } } } }, offset: { x: 10, y: 0, z: 0 }, _posKeys: ['0,0,0', '1,0,0'], _simState: new Int32Array(2), _simMotion: new Int32Array(2), replay: { palette: ['minecraft:torch', 'minecraft:moving_piston'] }, _timeline: { baselinePos: [0], baselineState: [0], posX: [0, 1], posY: [0, 0], posZ: [0, 0], strings: ['minecraft:stone'], motionSettled: [0] } })
  controller._resetSimulationStates()
  assert.deepEqual(writes.map(w => w[3]), ['minecraft:air', 'minecraft:air', 'minecraft:torch'])
  controller._writeSimulationState(1, 1, 0)
  assert.deepEqual(writes.at(-1), [11, 0, 0, 'minecraft:stone'])
})
