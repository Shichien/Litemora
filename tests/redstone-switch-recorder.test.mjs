/* eslint-disable test/no-import-node-test -- Use Node's built-in test runner. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { packRedstoneReplay } from '../src/js/world/redstone-replay-data.js'
import {
  normalizeRedstoneSwitch,
  recordSwitchReplay,
  resolveSwitchType,
  SwitchSimulationError,
  translateSimulator,
} from '../src/js/world/redstone-sim/switch-recorder.js'

const WASM_URL = new URL('../src/js/world/redstone-sim/pkg/redstone_wasm_bg.wasm', import.meta.url)
const DOOR_URL = new URL('../public/redstone-archive/single-lever-piston-door-3x3.litematic', import.meta.url)
const hasWasm = existsSync(fileURLToPath(WASM_URL))

// A scripted stand-in for the simulator: `reactions[kind]` lists, per tick after an
// interaction, the [x, y, z, state] writes that happen on that tick.
function fakeSim({ blocks, reactions, idle = [], initialization = [] }) {
  const world = new Map(Object.entries(blocks))
  let tick = 0
  let queue = idle.map(writes => writes)
  const apply = (writes = [], advance = true) => {
    tick += advance ? 1 : 0
    const changes = writes.map(([x, y, z, state], microStep) => {
      const key = `${x},${y},${z}`
      const previousState = world.get(key) || 'minecraft:air'
      world.set(key, state)
      return { x, y, z, state, previousState, microStep, cause: 'test' }
    })
    return { tick, changes, pendingScheduledTicks: queue.length }
  }
  return {
    blockAt: (x, y, z) => world.get(`${x},${y},${z}`) || 'minecraft:air',
    fingerprint: () => JSON.stringify([...world].sort()),
    initialize: () => initialization.length ? [apply(initialization, false)] : [],
    step: ticks => Array.from({ length: ticks }, () => apply(queue.shift())),
    interact(x, y, z, kind) {
      const script = reactions[kind]
      if (!script) {
        throw new Error(`unexpected interaction ${kind}`)
      }
      const [first, ...rest] = typeof script === 'function' ? script(world) : script
      queue = rest.map(writes => writes)
      return [apply(first)]
    },
  }
}

test('switch type and item metadata are validated', () => {
  assert.equal(resolveSwitchType('minecraft:lever[face=wall,facing=north,powered=true]'), 'lever')
  assert.equal(resolveSwitchType('minecraft:polished_blackstone_button[powered=false]'), 'button')
  assert.equal(resolveSwitchType('minecraft:heavy_weighted_pressure_plate[power=0]'), 'pressure_plate')
  assert.equal(resolveSwitchType('minecraft:redstone_block'), '')
  assert.deepEqual(
    normalizeRedstoneSwitch({ position: { x: 3, y: 1, z: 0 }, initialState: 'open' }),
    { position: { x: 3, y: 1, z: 0 }, initialState: 'open' },
  )
  assert.equal(normalizeRedstoneSwitch({ position: { x: 1, y: 2, z: 3 } }).initialState, 'closed')
  assert.equal(normalizeRedstoneSwitch({ position: { x: 1.5, y: 2, z: 3 } }), null)
  assert.equal(normalizeRedstoneSwitch({ position: { x: 1, y: 2 } }), null)
  assert.equal(normalizeRedstoneSwitch(null), null)
})

test('a button that returns to idle after one press records a single pulse segment', () => {
  const sim = fakeSim({
    blocks: { '0,0,0': 'minecraft:stone_button[powered=false]', '1,0,0': 'minecraft:stone' },
    reactions: {
      button: [
        [[0, 0, 0, 'minecraft:stone_button[powered=true]']],
        [[1, 0, 0, 'minecraft:air']],
        [],
        [],
        [],
        [[0, 0, 0, 'minecraft:stone_button[powered=false]']],
        [[1, 0, 0, 'minecraft:stone']],
      ],
    },
  })
  const { control, replay, switchType } = recordSwitchReplay(sim, { position: { x: 0, y: 0, z: 0 } })
  assert.equal(switchType, 'button')
  assert.equal(control.mode, 'pulse')
  // Idle for 12 quiet ticks, press on tick 13, last change on tick 19.
  assert.deepEqual(control.segments, { pulse: { fromTick: 12, toTick: 21 } })
  assert.equal(replay.totalTicks, 21)
  assert.equal(replay.changeCount, 4)
  assert.deepEqual(replay.frames[0].actions[0].action, { type: 'press_button', pos: { x: 0, y: 0, z: 0 } })
  assert.deepEqual(replay.baseline.map(entry => replay.palette[entry.state]), [
    'minecraft:stone_button[powered=false]',
    'minecraft:stone',
  ])
  assert.doesNotThrow(() => packRedstoneReplay(replay))
})

test('a translated simulator reports and accepts coordinates in the shifted frame', () => {
  // The simulator has the button at (10, 64, -5); the renderer sees it at the origin.
  const sim = translateSimulator(fakeSim({
    blocks: { '10,64,-5': 'minecraft:stone_button[powered=false]', '11,64,-5': 'minecraft:stone' },
    reactions: {
      button: [
        [[10, 64, -5, 'minecraft:stone_button[powered=true]'], [11, 64, -5, 'minecraft:air']],
        [[10, 64, -5, 'minecraft:stone_button[powered=false]'], [11, 64, -5, 'minecraft:stone']],
      ],
    },
  }), { x: -10, y: -64, z: 5 })
  const { control, replay } = recordSwitchReplay(sim, { position: { x: 0, y: 0, z: 0 } })
  assert.deepEqual(control.switchPosition, { x: 0, y: 0, z: 0 })
  assert.deepEqual(replay.baseline.map(({ x, y, z }) => [x, y, z]), [[0, 0, 0], [1, 0, 0]])
  assert.ok(replay.frames.every(frame => frame.changes.every(change => (change.x === 0 || change.x === 1) && change.y === 0 && change.z === 0)))

  const untouched = fakeSim({ blocks: {}, reactions: {} })
  assert.equal(translateSimulator(untouched, { x: 0, y: 0, z: 0 }), untouched)
})

test('a pressure plate is held until the machine settles, then released', () => {
  const sim = fakeSim({
    blocks: { '2,1,2': 'minecraft:oak_pressure_plate[powered=false]', '2,1,3': 'minecraft:stone' },
    reactions: {
      plate_on: [[[2, 1, 2, 'minecraft:oak_pressure_plate[powered=true]']], [[2, 1, 3, 'minecraft:air']]],
      plate_off: [[], [[2, 1, 2, 'minecraft:oak_pressure_plate[powered=false]']], [[2, 1, 3, 'minecraft:stone']]],
    },
  })
  const { control, replay, switchType } = recordSwitchReplay(sim, { position: { x: 2, y: 1, z: 2 }, initialState: 'closed' })
  assert.equal(switchType, 'pressure_plate')
  assert.equal(control.mode, 'pulse')
  const actions = replay.frames.flatMap(frame => frame.actions.map(entry => [frame.tick, entry.action.type]))
  // Stepped on at tick 13, door open by 14, held 20 quiet ticks, stepped off at 35.
  assert.deepEqual(actions, [[13, 'step_on_pressure_plate'], [35, 'step_off_pressure_plate']])
  assert.deepEqual(control.segments.pulse, { fromTick: 12, toTick: 39 })
})

test('machines that never idle, never react, or do not come back are rejected with a reason', () => {
  const code = (run) => {
    try {
      run()
    }
    catch (error) {
      assert.ok(error instanceof SwitchSimulationError)
      return error.code
    }
    return 'no_error'
  }
  const lever = 'minecraft:lever[powered=false]'
  const position = { x: 0, y: 0, z: 0 }

  assert.equal(code(() => recordSwitchReplay(fakeSim({ blocks: { '0,0,0': 'minecraft:stone' }, reactions: {} }), { position })), 'not_a_switch')
  assert.equal(code(() => recordSwitchReplay(fakeSim({ blocks: {}, reactions: {} }), { position: { x: 0.5, y: 0, z: 0 } })), 'invalid_switch')

  // A clock: something changes every tick forever.
  const clock = fakeSim({ blocks: { '0,0,0': lever }, reactions: {} })
  const step = clock.step
  let flip = false
  clock.step = () => {
    flip = !flip
    const [frame] = step(1)
    frame.changes.push({ x: 5, y: 0, z: 0, state: flip ? 'minecraft:redstone_lamp[lit=true]' : 'minecraft:redstone_lamp[lit=false]', previousState: 'minecraft:air', microStep: 0, cause: 'clock' })
    return [frame]
  }
  assert.equal(code(() => recordSwitchReplay(clock, { position })), 'never_idle')

  assert.equal(code(() => recordSwitchReplay(fakeSim({ blocks: { '0,0,0': lever }, reactions: { lever: [[]] } }), { position })), 'switch_inactive')

  // Every pull consumes another block: the world never returns to its idle state.
  let pulls = 0
  const oneWay = fakeSim({
    blocks: { '0,0,0': lever, '1,0,0': 'minecraft:stone', '2,0,0': 'minecraft:stone' },
    reactions: {
      lever: (world) => {
        pulls += 1
        const powered = world.get('0,0,0').includes('powered=false')
        return [[[0, 0, 0, `minecraft:lever[powered=${powered}]`], [pulls, 0, 0, 'minecraft:air']]]
      },
    },
  })
  assert.equal(code(() => recordSwitchReplay(oneWay, { position })), 'not_reversible')
})

test('isolated switches and wire-only reactions are not accepted as doors', () => {
  for (const wire of [false, true]) {
    const sim = fakeSim({
      blocks: { '0,0,0': 'minecraft:stone_button[powered=false]', '2,0,0': 'minecraft:redstone_wire[power=0]' },
      reactions: {
        button: [
          [[0, 0, 0, 'minecraft:stone_button[powered=true]'], ...(wire ? [[2, 0, 0, 'minecraft:redstone_wire[power=15]']] : [])],
          [[0, 0, 0, 'minecraft:stone_button[powered=false]'], ...(wire ? [[2, 0, 0, 'minecraft:redstone_wire[power=0]']] : [])],
        ],
      },
    })
    assert.throws(() => recordSwitchReplay(sim, { position: { x: 0, y: 0, z: 0 } }), { code: 'no_door_motion' })
  }
})

test('wire connection warmup preserves geometry and power, then requires an exact cycle', () => {
  const raw = 'minecraft:redstone_wire[east=none,north=none,power=0,south=none,west=none]'
  const normalized = 'minecraft:redstone_wire[east=side,north=none,power=0,south=none,west=side]'
  const makeSim = (endWire = normalized, endBlock = 'minecraft:stone', unstable = false) => {
    let presses = 0
    return fakeSim({
      blocks: { '0,0,0': 'minecraft:stone_button[powered=false]', '1,0,0': 'minecraft:stone', '2,0,0': raw },
      reactions: {
        button: () => {
          presses += 1
          return [
            [[0, 0, 0, 'minecraft:stone_button[powered=true]'], [1, 0, 0, 'minecraft:air']],
            [[0, 0, 0, 'minecraft:stone_button[powered=false]'], [1, 0, 0, endBlock], [2, 0, 0, unstable && presses > 2 ? endWire.replace('power=0', `power=${presses}`) : endWire]],
          ]
        },
      },
    })
  }
  const options = { position: { x: 0, y: 0, z: 0 } }
  const result = recordSwitchReplay(makeSim(), options)
  assert.equal(result.normalizedWireConnections, true)
  assert.equal(result.control.mode, 'pulse')
  const wireBaseline = result.replay.baseline.find(entry => entry.x === 2)
  assert.equal(result.replay.palette[wireBaseline.state], normalized)
  assert.equal(result.control.segments.pulse.fromTick, 0)
  assert.equal(result.replay.frames[0].tick, 1)
  assert.throws(() => recordSwitchReplay(makeSim(normalized.replace('power=0', 'power=1')), options), { code: 'not_reversible' })
  assert.throws(() => recordSwitchReplay(makeSim(normalized, 'minecraft:dirt'), options), { code: 'not_reversible' })
  assert.throws(() => recordSwitchReplay(makeSim(normalized, 'minecraft:stone', true), options), { code: 'not_reversible' })
})

test('initialization changes survive translation and playback without counting as door motion', () => {
  const make = (movesDoor) => {
    const native = fakeSim({
      blocks: { '10,5,0': 'minecraft:stone_button[powered=false]', '11,5,0': 'minecraft:stone', '12,5,0': 'minecraft:redstone_lamp[lit=false]' },
      initialization: [[12, 5, 0, 'minecraft:redstone_lamp[lit=true]']],
      reactions: {
        button: [
          [[10, 5, 0, 'minecraft:stone_button[powered=true]'], ...(movesDoor ? [[11, 5, 0, 'minecraft:air']] : [])],
          [[10, 5, 0, 'minecraft:stone_button[powered=false]'], ...(movesDoor ? [[11, 5, 0, 'minecraft:stone']] : [])],
        ],
      },
    })
    native.auxiliaryFingerprint = () => 'stable'
    return translateSimulator(native, { x: -10, y: -5, z: 0 })
  }
  const options = { position: { x: 0, y: 0, z: 0 } }
  const sim = make(true)
  assert.equal(sim.auxiliaryFingerprint(), 'stable')
  const { replay } = recordSwitchReplay(sim, options)
  const initialization = replay.frames.find(frame => frame.tick === 0)
  assert.equal(initialization.changes.length, 1)
  assert.equal(initialization.changes[0].x, 2)
  assert.equal(initialization.changes[0].y, 0)
  assert.equal(replay.palette[initialization.changes[0].state], 'minecraft:redstone_lamp[lit=true]')
  assert.equal(replay.palette[replay.baseline.find(block => block.x === 2).state], 'minecraft:redstone_lamp[lit=false]')
  assert.doesNotThrow(() => packRedstoneReplay(replay))
  assert.throws(() => recordSwitchReplay(make(false), options), { code: 'no_door_motion' })
})

test('invisible inventory activity must settle before recording an interaction', () => {
  let inventory = 0
  const sim = fakeSim({
    blocks: { '0,0,0': 'minecraft:stone_button[powered=false]', '1,0,0': 'minecraft:stone' },
    reactions: { button: [[[0, 0, 0, 'minecraft:stone_button[powered=true]'], [1, 0, 0, 'minecraft:air']], [[0, 0, 0, 'minecraft:stone_button[powered=false]'], [1, 0, 0, 'minecraft:stone']]] },
  })
  const step = sim.step
  sim.step = (ticks) => {
    const frames = step(ticks)
    inventory = Math.min(35, frames.at(-1).tick)
    return frames
  }
  const fingerprint = sim.fingerprint
  sim.auxiliaryFingerprint = () => String(inventory)
  sim.fingerprint = () => `${fingerprint()}|${inventory}`
  const { replay } = recordSwitchReplay(sim, { position: { x: 0, y: 0, z: 0 } })
  assert.equal(replay.frames.find(frame => frame.actions.length).tick, 48)
})

test('wire warmup cannot hide consumed inventory even when a later cycle repeats', () => {
  let consumed = false
  const sim = fakeSim({
    blocks: { '0,0,0': 'minecraft:stone_button[powered=false]', '1,0,0': 'minecraft:stone', '2,0,0': 'minecraft:redstone_wire[east=none,power=0]' },
    reactions: {
      button: () => {
        consumed = true
        return [
          [[0, 0, 0, 'minecraft:stone_button[powered=true]'], [1, 0, 0, 'minecraft:air']],
          [[0, 0, 0, 'minecraft:stone_button[powered=false]'], [1, 0, 0, 'minecraft:stone'], [2, 0, 0, 'minecraft:redstone_wire[east=side,power=0]']],
        ]
      },
    },
  })
  const fingerprint = sim.fingerprint
  sim.auxiliaryFingerprint = () => String(consumed)
  sim.fingerprint = () => `${fingerprint()}|${consumed}`
  assert.throws(() => recordSwitchReplay(sim, { position: { x: 0, y: 0, z: 0 } }), { code: 'not_reversible' })
})

test('the real simulator records the single-lever 3x3 door as an open/close toggle', { skip: !hasWasm && 'redstone WASM build is not present' }, async () => {
  const wasm = await import('../src/js/world/redstone-sim/pkg/redstone_wasm.js')
  wasm.initSync({ module: await readFile(WASM_URL) })
  const native = new wasm.RedstoneSim(new Uint8Array(await readFile(DOOR_URL)), 'litematic', false)
  const sim = {
    blockAt: (x, y, z) => native.block_at(x, y, z),
    fingerprint: () => native.fingerprint(),
    auxiliaryFingerprint: () => native.auxiliary_fingerprint(),
    initialize: () => JSON.parse(native.initialize()),
    step: ticks => JSON.parse(native.step(ticks)),
    interact: (x, y, z, kind) => JSON.parse(native.interact(x, y, z, kind)),
  }

  const { control, replay, switchType } = recordSwitchReplay(sim, {
    position: { x: 3, y: 1, z: 0 },
    initialState: 'open',
    title: 'door',
  })
  assert.equal(switchType, 'lever')
  assert.equal(control.mode, 'toggle')
  // The hand-verified archive replay uses 99 -> 122 to close and 499 -> 536 to open.
  assert.equal(control.segments.close.toTick - control.segments.close.fromTick, 122 - 99)
  assert.equal(control.segments.open.toTick - control.segments.open.fromTick, 536 - 499)
  assert.ok(control.segments.close.toTick <= control.segments.open.fromTick)
  assert.equal(replay.totalTicks, control.segments.open.toTick)

  // The 3x3 doorway (x 3..5, y 5..7, z 1) is clear at rest and filled after the first pull.
  const doorway = []
  for (let y = 5; y <= 7; y += 1) {
    for (let x = 3; x <= 5; x += 1) {
      doorway.push(`${x},${y},1`)
    }
  }
  const state = new Map(replay.baseline.map(entry => [`${entry.x},${entry.y},${entry.z}`, replay.palette[entry.state]]))
  const blockAt = key => state.get(key) || 'minecraft:air'
  assert.ok(doorway.every(key => blockAt(key) === 'minecraft:air'))
  for (const frame of replay.frames) {
    for (const change of frame.changes) {
      state.set(`${change.x},${change.y},${change.z}`, replay.palette[change.state])
    }
    if (frame.tick === control.segments.close.toTick - 2) {
      assert.ok(doorway.every(key => blockAt(key) === 'minecraft:quartz_block'), 'door is shut at the end of the close segment')
    }
  }
  assert.ok(doorway.every(key => blockAt(key) === 'minecraft:air'), 'door is open again at the end')

  const packed = packRedstoneReplay(replay)
  assert.equal(packed.meta.totalTicks, replay.totalTicks)
  assert.deepEqual([...packed.actionTargets], [3, 1, 0])
  assert.ok(packed.motionCount > 0)
})
