import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- This project runs node --test.
import test from 'node:test'
import { initRedstoneWasm, inspectSchematic, RedstoneSim } from '../sdk/litemora.js'

const sampleUrl = new URL('../public/redstone-archive/single-lever-piston-door-3x3.litematic', import.meta.url)

test('inspectSchematic returns the documented bounds and keeps the source available', async () => {
  const source = Uint8Array.from(await readFile(sampleUrl))
  const stats = await inspectSchematic(source.buffer)
  assert.equal(stats.format, 'litematic')
  assert.equal(stats.regionCount, 1)
  assert.equal(stats.blockCount, 80)
  assert.deepEqual(stats.size, { x: 10, y: 10, z: 2 })
  assert.deepEqual(stats.bounds, { minX: 0, minY: 0, minZ: 0, maxX: 9, maxY: 9, maxZ: 1 })
  assert.ok(source.byteLength > 0)
  await assert.rejects(inspectSchematic(source), TypeError)
})

test('WASM startup can retry and concurrent callers share one instance', async (t) => {
  await assert.rejects(initRedstoneWasm({ module_or_path: new Uint8Array() }), WebAssembly.CompileError)
  const wasm = await readFile(new URL('../src/js/world/redstone-sim/pkg/redstone_wasm_bg.wasm', import.meta.url))
  const ready = initRedstoneWasm({ module_or_path: wasm })
  assert.equal(initRedstoneWasm(), ready)
  await ready
  const sim = new RedstoneSim(await readFile(sampleUrl), 'litematic', false)
  t.after(() => sim.free())
  assert.equal(JSON.parse(sim.initialize())[0].tick, 0)
  const [frame] = JSON.parse(sim.interact(3, 1, 0, 'lever'))
  assert.equal(frame.tick, 1)
  assert.equal(frame.changes[0].previousState, 'minecraft:lever[face=wall,facing=north,powered=true]')
  assert.equal(sim.block_at(3, 1, 0), 'minecraft:lever[face=wall,facing=north,powered=false]')
})

test('one SDK call completes a real door movement and the next call reopens the same door', async (t) => {
  const wasm = await readFile(new URL('../src/js/world/redstone-sim/pkg/redstone_wasm_bg.wasm', import.meta.url))
  await initRedstoneWasm({ module_or_path: wasm })
  const sim = new RedstoneSim(await readFile(sampleUrl), 'litematic', false)
  t.after(() => sim.free())
  const position = { x: 3, y: 1, z: 0 }
  assert.throws(() => sim.runAnimation({ ...position, x: 3.5 }), { code: 'invalid_switch' })
  assert.throws(() => sim.runAnimation({ x: 100, y: 100, z: 100 }), { code: 'not_a_switch' })
  assert.equal(sim.tick(), 0)

  const blocks = () => new Map(JSON.parse(sim.blocks()).map(([x, y, z, state]) => [`${x},${y},${z}`, state]))
  const replay = blocks()
  for (const [firstTick, endTick, doorBlock] of [[0, 33, 'minecraft:quartz_block'], [34, 80, 'minecraft:air']]) {
    const before = sim.tick()
    const { frames, fromTick, toTick, settled } = sim.runAnimation(position)
    assert.equal(settled, true)
    assert.equal(fromTick, before)
    assert.equal(toTick, endTick)
    assert.equal(sim.tick(), endTick)
    assert.deepEqual(frames.map(frame => frame.tick), Array.from({ length: endTick - firstTick + 1 }, (_, i) => firstTick + i))
    for (const frame of frames) {
      for (const change of frame.changes) {
        const key = `${change.x},${change.y},${change.z}`
        assert.equal(replay.get(key) ?? 'minecraft:air', change.previousState)
        if (change.state === 'minecraft:air')
          replay.delete(key)
        else
          replay.set(key, change.state)
      }
    }
    assert.deepEqual(replay, blocks())
    for (let y = 5; y <= 7; y++) {
      for (let x = 3; x <= 5; x++)
        assert.equal(sim.block_at(x, y, 1), doorBlock)
    }
  }
})
