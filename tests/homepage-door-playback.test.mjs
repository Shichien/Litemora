/* eslint-disable test/no-import-node-test -- Node test runner */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = new URL('../public/homepage/piston-door-56.litematic', import.meta.url)
const playback = JSON.parse(await readFile(new URL('../public/homepage/piston-door-56-playback.json', import.meta.url), 'utf8'))
const key = block => block.slice(0, 3).join(',')
const sorted = blocks => [...blocks].sort((a, b) => key(a).localeCompare(key(b)))
const name = state => state.split('[')[0]
function counts(blocks) {
  return blocks.reduce((result, block) => {
    const type = name(block[3])
    result[type] = (result[type] || 0) + 1
    return result
  }, {})
}
const stateMap = blocks => new Map(blocks.map(block => [key(block), block[3]]))

test('homepage playback preserves source identity and actual block inventory outside retracted heads', async () => {
  assert.equal(playback.format, 'litemora-homepage-door-states-v1')
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), playback.sourceSha256)
  const closed = counts(playback.closed)
  const open = counts(playback.open)
  assert.equal(playback.closed.length, 49)
  assert.equal(playback.open.length, 47)
  assert.equal(closed['minecraft:lime_concrete'], 12)
  assert.equal(closed['minecraft:sticky_piston'], 10)
  assert.equal(closed['minecraft:observer'], 11)
  assert.deepEqual(open, Object.fromEntries(Object.entries(closed).filter(([type]) => type !== 'minecraft:piston_head')))
  assert.equal(closed['minecraft:piston_head'], 2)
  assert.deepEqual(playback.simulation.unsupported, {})
  assert.equal(playback.verification.continuousLeverCycle, false)
})

test('all nine aperture cells become air while door panels are transported to storage cells', () => {
  const closed = stateMap(playback.closed)
  const open = stateMap(playback.open)
  assert.equal(playback.aperture.length, 9)
  assert.equal(new Set(playback.aperture.map(cell => cell.join(','))).size, 9)
  for (const cell of playback.aperture) {
    assert.deepEqual(cell.slice(0, 1), [0])
    assert.ok(cell[1] >= 2 && cell[1] <= 4 && cell[2] >= 2 && cell[2] <= 4)
    assert.equal(closed.get(cell.join(',')), 'minecraft:lime_concrete')
    assert.equal(open.get(cell.join(',')) || 'minecraft:air', 'minecraft:air')
  }
  const newStorage = playback.open.filter(block => block[3] === 'minecraft:lime_concrete' && closed.get(key(block)) !== block[3])
  assert.equal(newStorage.length, 9)
})

for (const direction of ['open', 'close']) {
  test(`${direction} sequence verifies every previousState, transport source, and exact endpoint`, () => {
    const sequence = playback.sequences[direction]
    const expectedInitial = direction === 'open' ? playback.closed : playback.open
    const expectedFinal = direction === 'open' ? playback.open : playback.closed
    assert.deepEqual(sorted(sequence.initial), sorted(expectedInitial))
    assert.deepEqual(sorted(sequence.final), sorted(expectedFinal))
    const map = stateMap(sequence.initial)
    for (const motion of sequence.motions.filter(m => m.cause === 'piston_moving_head')) {
      assert.match(motion.state, /^minecraft:piston_head\[facing=(up|down|north|south|east|west),short=false,type=(sticky|normal)\]$/)
      assert.equal(motion.state.includes(`facing=${motion.facing}`), true)
      assert.ok(motion.settledState)
    }
    let previousTick = -1
    let changes = 0
    let movedBlocks = 0
    for (const frame of sequence.frames) {
      assert.ok(frame.tick > previousTick)
      previousTick = frame.tick
      for (const motion of sequence.motions.filter(m => m.startTick === frame.tick && m.cause === 'piston_moving_block')) {
        assert.ok(motion.endTick > motion.startTick)
        assert.ok(motion.source)
        assert.equal(map.get(motion.source.join(',')), motion.state)
        assert.equal(motion.source.reduce((sum, coordinate, axis) => sum + Math.abs(coordinate - motion.position[axis]), 0), 1)
        movedBlocks++
      }
      for (const change of frame.changes) {
        const position = `${change.x},${change.y},${change.z}`
        assert.equal(map.get(position) || 'minecraft:air', change.previousState, `${direction} tick ${frame.tick}: ${position}`)
        if (change.state === 'minecraft:air')
          map.delete(position)
        else map.set(position, change.state)
        changes++
      }
    }
    assert.ok(sequence.totalTicks > previousTick)
    assert.ok(movedBlocks > 9)
    assert.equal(changes, direction === 'open' ? 294 : 162)
    assert.deepEqual(sorted([...map].map(([position, state]) => [...position.split(',').map(Number), state])), sorted(expectedFinal))
  })
}
