/* eslint-disable test/no-import-node-test -- Use Node's built-in test runner. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Execute the actual controller with only browser imports stubbed; no WebGL is
// needed to test playback state. The event bus otherwise eagerly reads Vite env.
const source = await readFile(new URL('../src/js/world/redstone-replay-controller.js', import.meta.url), 'utf8')
const executable = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  .replace('export default class RedstoneReplayController', 'class RedstoneReplayController')
  .replaceAll('export function ', 'function ')
const { Controller, getReplaySwitches, validateDoorControl } = vm.runInNewContext(`${executable}\n;({ Controller: RedstoneReplayController, getReplaySwitches, validateDoorControl })`, {
  blockKey: (x, y, z) => `${x},${y},${z}`,
  emitter: { emit() {} },
})

const timeline = {
  baselinePos: [0, 1, 2],
  baselineState: [0, 1, 2],
  palette: ['minecraft:lever[powered=true]', 'minecraft:stone_button[powered=false]', 'minecraft:redstone_block'],
  posX: [3, 5, 7],
  posY: [1, 2, 3],
  posZ: [0, 0, 0],
  actionTargets: [3, 1, 0, 5, 2, 0, 7, 3, 0, 3, 1, 0, 99, 0, 0],
}
const config = { type: 'door', switchPosition: { x: 3, y: 1, z: 0 }, initialState: 'open', segments: { close: { fromTick: 99, toTick: 122 }, open: { fromTick: 499, toTick: 536 } } }

test('only initial lever/button action targets are switches; offsets and deduplication apply', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(getReplaySwitches(timeline, { x: -10, y: 4, z: 8 }))), [
    { x: -7, y: 5, z: 8, type: 'lever' },
    { x: -5, y: 6, z: 8, type: 'button' },
  ])
  assert.equal(getReplaySwitches({ ...timeline, actionTargets: [7, 3, 0] }).length, 0)
  assert.equal(getReplaySwitches(null).length, 0)
})

test('door metadata requires an actual lever and bounded forward segments', () => {
  const switches = getReplaySwitches(timeline)
  assert.ok(validateDoorControl(config, 1200, switches))
  assert.equal(validateDoorControl({ ...config, switchPosition: { x: 7, y: 3, z: 0 } }, 1200, switches), null)
  assert.equal(validateDoorControl(config, 500, switches), null)
  assert.equal(validateDoorControl({ ...config, segments: { ...config.segments, close: { fromTick: 122, toTick: 99 } } }, 1200, switches), null)
  assert.ok(validateDoorControl(config, 1200, getReplaySwitches(timeline, { x: 10 }), { x: 10 }))
})

function controller() {
  const instance = Object.create(Controller.prototype)
  Object.assign(instance, {
    available: true,
    ready: true,
    playing: false,
    speed: 1,
    currentTick: 0,
    tickAccumulator: 0,
    replay: { totalTicks: 1200, ticksPerSecond: 20 },
    experience: { time: { delta: 5000 } },
    _doorControl: validateDoorControl(config, 1200, getReplaySwitches(timeline)),
    _doorState: 'open',
    _doorSegment: null,
    _doorStarting: false,
    _timeline: { frameCount: 0 },
    _posKeys: [],
    _emitState() {},
    _clearActiveMotions() {},
    _clearDynamicBlocks() {},
    _resetSimulationStates() {},
    _updatePistonMotions() {},
    _advanceToTick(tick) { this.currentTick = tick },
  })
  return instance
}

test('close and open play forward and stop exactly at stable endpoints even with a large delta', async () => {
  const instance = controller()
  for (const [from, to, state] of [[99, 122, 'closed'], [499, 536, 'open'], [99, 122, 'closed']]) {
    await instance.toggleDoor()
    assert.equal(instance.currentTick, from)
    assert.equal(instance.playing, true)
    await instance.toggleDoor() // busy input cannot restart or reverse the segment
    assert.equal(instance.currentTick, from)
    instance.update()
    assert.equal(instance.currentTick, to)
    assert.equal(instance.playing, false)
    assert.equal(instance._doorState, state)
    instance.update()
    assert.equal(instance.currentTick, to)
  }
})

test('K toggle pauses/resumes an active segment; seeking cancels it and custom reset is explicit', async () => {
  const instance = controller()
  await instance.toggleDoor()
  instance._handleCommand({ type: 'toggle' })
  instance.update()
  assert.equal(instance.currentTick, 99)
  instance._handleCommand({ type: 'toggle' })
  instance.update()
  assert.equal(instance.currentTick, 122)
  instance._handleCommand({ type: 'toggle' })
  await Promise.resolve()
  assert.equal(instance.currentTick, 499)
  instance.update()
  assert.equal(instance.currentTick, 536)
  assert.equal(instance.playing, false)
  await instance.seek(300)
  assert.equal(instance._doorState, 'custom')
  assert.equal(instance._doorSegment, null)
  await instance.toggleDoor()
  assert.equal(instance.currentTick, 0)
  assert.equal(instance._doorState, 'open')
  assert.equal(instance.playing, false)
})

test('ordinary replay restart starts at zero with autoplay; unavailable worlds ignore commands', async () => {
  const instance = controller()
  instance._doorControl = null
  instance.currentTick = 700
  await instance.restart({ autoplay: true })
  assert.equal(instance.currentTick, 0)
  assert.equal(instance.playing, true)
  instance.available = false
  instance._handleCommand({ type: 'pause' })
  assert.equal(instance.playing, true)
})
