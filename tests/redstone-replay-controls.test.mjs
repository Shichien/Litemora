/* eslint-disable test/no-import-node-test -- Use Node's built-in test runner. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { resolveSwitchType } from '../src/js/world/redstone-sim/switch-types.js'

// Execute the actual controller with only browser imports stubbed; no WebGL is
// needed to test playback state. The event bus otherwise eagerly reads Vite env.
const source = await readFile(new URL('../src/js/world/redstone-replay-controller.js', import.meta.url), 'utf8')
const executable = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  .replace('export default class RedstoneReplayController', 'class RedstoneReplayController')
  .replaceAll('export function ', 'function ')
const { Controller, getReplaySwitches, validateDoorControl } = vm.runInNewContext(`${executable}\n;({ Controller: RedstoneReplayController, getReplaySwitches, validateDoorControl })`, {
  resolveSwitchType,
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

test('pressure plates are switches; simulated controls may use any switch and a single pulse segment', () => {
  const plateTimeline = {
    ...timeline,
    palette: ['minecraft:oak_pressure_plate[powered=false]', 'minecraft:stone_button[powered=false]', 'minecraft:redstone_block'],
  }
  const switches = getReplaySwitches(plateTimeline)
  assert.deepEqual(JSON.parse(JSON.stringify(switches)), [
    { x: 3, y: 1, z: 0, type: 'pressure_plate' },
    { x: 5, y: 2, z: 0, type: 'button' },
  ])

  // Hand-written open/close metadata still needs a lever; the simulator has already
  // proved the round trip, so its result may toggle on any switch.
  assert.equal(validateDoorControl(config, 1200, switches), null)
  assert.ok(validateDoorControl(config, 1200, switches, {}, { allowAnySwitch: true }))

  const pulse = { type: 'door', mode: 'pulse', switchPosition: { x: 3, y: 1, z: 0 }, initialState: 'closed', segments: { pulse: { fromTick: 12, toTick: 60 } } }
  const validated = validateDoorControl(pulse, 60, switches)
  assert.equal(validated.mode, 'pulse')
  assert.deepEqual(JSON.parse(JSON.stringify(validated.segments)), { pulse: { fromTick: 12, toTick: 60 } })
  assert.equal(validateDoorControl(pulse, 59, switches), null)
  assert.equal(validateDoorControl({ ...pulse, segments: {} }, 60, switches), null)
})

test('a pulse door replays the same segment each time and ends back in its initial state', async () => {
  const instance = controller()
  instance.replay = { totalTicks: 60, ticksPerSecond: 20 }
  instance._doorControl = { initialState: 'closed', switchKey: '3,1,0', mode: 'pulse', segments: { pulse: { fromTick: 12, toTick: 60 } } }
  instance._doorState = 'closed'
  for (let round = 0; round < 2; round += 1) {
    await instance.toggleDoor()
    assert.equal(instance.currentTick, 12)
    assert.equal(instance.playing, true)
    instance.update()
    assert.equal(instance.currentTick, 60)
    assert.equal(instance.playing, false)
    assert.equal(instance._doorState, 'closed')
  }
  await instance.seek(30)
  assert.equal(instance._doorState, 'custom')
})

test('a rejected simulation keeps its original error after the static renderer becomes active', async () => {
  const instance = controller()
  let rendererActive = false
  Object.assign(instance, {
    available: false,
    ready: false,
    error: '',
    _timeline: null,
    world: { minecraftSchematicRenderLayer: { isRuntimeRendererActive: () => rendererActive } },
    async _resolveReplayTimeline() { throw new Error('机器没有回到初始状态') },
    _beginPreparingMotionResources() { assert.fail('a failed simulation must not prepare animation resources') },
  })
  assert.equal(await instance.initialize(), false)
  instance.update()
  rendererActive = true
  instance.update()
  assert.equal(instance.available, true, 'the HUD must remain visible with the failure reason')
  assert.equal(instance.ready, false)
  assert.equal(instance.error, '机器没有回到初始状态')
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
