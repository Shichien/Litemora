/* eslint-disable test/no-import-node-test -- Use Node's built-in test runner. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MOVEMENT_CONSTANTS, MOVEMENT_DIRECTION_WEIGHTS, PLAYER_CONFIG } from '../src/js/config/player-config.js'
import * as replayData from '../src/js/world/redstone-replay-data.js'
import { resolveSwitchType } from '../src/js/world/redstone-sim/switch-types.js'

// Run the real query, playback and collision implementations without starting
// Experience or WebGL. Collision profiles use the same minecraft-data as Vite.
async function loadImplementation(relativePath, exported, globals = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const executable = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
    .replaceAll('export default ', '')
    .replaceAll('export ', '')
  return vm.runInNewContext(`${executable}\n;({ ${exported.join(', ')} })`, globals)
}

const require = createRequire(import.meta.url)
const collisionData = await loadImplementation('../src/js/world/terrain/minecraft-block-data.js', [
  'getMinecraftBlockCollisionProfile',
  'getMinecraftBlockMovementProfile',
  'isMinecraftBlockClimbable',
  'normalizeMinecraftBlockName',
  'normalizeMinecraftBlockProperties',
], {
  blockCollisionShapes: require('minecraft-data/minecraft-data/data/pc/26.1/blockCollisionShapes.json'),
  blockDefinitions: require('minecraft-data/minecraft-data/data/pc/26.1/blocks.json'),
})
const emitter = { on() {}, off() {}, emit() {} }
const { SchematicRendererRuntimeBridge: Bridge } = await loadImplementation('../src/js/world/terrain/schematic-renderer-runtime-bridge.js', ['SchematicRendererRuntimeBridge'], {
  ...collisionData,
  THREE,
  emitter,
  setMinecraftLightField() {},
  MinecraftLightRuntime: class {
    setBlock() {}
    commit() {}
    dispose() {}
  },
})
const { RedstoneReplayController: Controller } = await loadImplementation('../src/js/world/redstone-replay-controller.js', ['RedstoneReplayController'], {
  ...replayData,
  resolveSwitchType,
  THREE,
  emitter,
  mergeGeometries,
  prepareMinecraftLightGeometry: geometry => geometry.clone(),
})
const { ChunkManager } = await loadImplementation('../src/js/world/terrain/chunk-manager.js', ['ChunkManager'], {
  blocks: { empty: { id: 0 } },
})
const { PlayerCollisionSystem } = await loadImplementation('../src/js/world/player/player-collision.js', ['PlayerCollisionSystem'], { THREE })

function createBridge(offset = { x: 0, y: 0, z: 0 }) {
  const bridge = new Bridge()
  const staticBlocks = new Map()
  const reads = []
  bridge.runtimeOffset = offset
  bridge.schematicObject = {
    getTightBoundsMin: () => [0, 0, 0],
    getTightDimensions: () => [10, 10, 2],
    getPalettes: () => ({ default: [] }),
    schematicWrapper: {
      get_block_string(x, y, z) {
        reads.push([x, y, z])
        return staticBlocks.get(`${x},${y},${z}`) || 'minecraft:air'
      },
    },
    async setBlockNoRebuild({ x, y, z }, state) { staticBlocks.set(`${x},${y},${z}`, state) },
    rebuildChunkAtPosition() {},
  }
  return { bridge, staticBlocks, reads }
}

function createProvider(bridge) {
  const provider = Object.create(ChunkManager.prototype)
  Object.assign(provider, {
    minecraftRuntimeBlockProvider: bridge,
    _sessionMinecraftBlockLayer: { getBlock() { return null } },
    minecraftSchematicLayer: { getBlock() { return null } },
    _transientRemovedMinecraftBlocks: new Map(),
  })
  return provider
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('sprint jumps keep their horizontal travel when landing across block seams, including after forward is released', async () => {
  const stone = { hasCollision: true, collisionBoxes: [[0, 0, 0, 1, 1, 1]], minecraftBlock: { name: 'minecraft:stone' } }
  const experience = {
    time: { delta: 50 },
    scene: new THREE.Scene(),
    debug: { active: false },
    terrainDataManager: { getBlockWorld: (x, y) => y === 2 ? stone : null },
  }
  class TestExperience {
    constructor() {
      Object.assign(this, experience)
    }
  }
  const globals = { THREE, Experience: TestExperience }
  const { PlayerCollisionSystem: Collision } = await loadImplementation('../src/js/world/player/player-collision.js', ['PlayerCollisionSystem'], globals)
  const { PlayerMovementController } = await loadImplementation('../src/js/world/player/player-movement-controller.js', ['PlayerMovementController'], {
    ...globals,
    ...collisionData,
    MOVEMENT_CONSTANTS,
    MOVEMENT_DIRECTION_WEIGHTS,
    PlayerCollisionSystem: Collision,
    getBlockTypeById: () => null,
    setTimeout,
    clearTimeout,
  })
  const player = new PlayerMovementController(structuredClone(PLAYER_CONFIG))
  try {
    for (const release of [false, true]) {
      for (const startZ of [0, 0.2, 0.4, 0.6, 0.8]) {
        player.setFacing(0)
        player.setPosition(0, 2.5, startZ)
        for (let t = 0; t < 30; t++) player.update({ forward: true, sprint: true }, false)
        for (let t = 0; t < 12; t++) {
          const forward = !release || t < 6
          const z = player.position.z
          const vz = player.worldVelocity.z
          player.update({ forward, space: t === 0 }, false)
          assert.equal(player.isGrounded, t === 11)
          assert.equal(player.horizontalCollision, false)
          if (t === 11) {
            assert.ok(Math.abs(player.position.y - 2.5) < 1e-8)
            const expectedDz = vz / 20 - (forward ? 0.026 * 0.98 : 0)
            assert.ok(Math.abs(player.position.z - z - expectedDz) < 1e-8)
            assert.equal(player.isSprinting, !release)
          }
        }
      }
    }
  }
  finally {
    player.destroy()
  }
})

test('swept player box stops at thin walls and ceilings, slides along walls and steps up only with headroom', () => {
  const collision = Object.create(PlayerCollisionSystem.prototype)
  const body = collision.playerBounds(new THREE.Vector3(0, 0.5, 0), PLAYER_CONFIG.pose.standing)
  const obstacle = (x0, y0, z0, x1, y1, z1) => ({ box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) })
  const ground = obstacle(-4, -0.5, -4, 4, 0.5, 4)
  const wall = obstacle(0.5, 0.5, -4, 0.5625, 3.5, 4)
  const slab = obstacle(0.5, 0.5, -4, 1.5, 1, 4)
  const ceiling = obstacle(-1, 2.5, -1, 2, 2.5625, 2)
  const move = (x, y, z, obstacles) => collision.resolveMovement(body, new THREE.Vector3(x, y, z), [ground, ...obstacles], true, 0.6, -Infinity)
  assert.deepEqual(move(2, -0.08, 0.4, [wall]).toArray(), [0.2, 0, 0.4])
  assert.ok(Math.abs(move(0, 3, 0, [ceiling]).y - 0.2) < 1e-8)
  assert.deepEqual(move(0.4, -0.08, 0, [slab]).toArray(), [0.4, 0.5, 0])
  assert.deepEqual(move(0.4, -0.08, 0, [slab, ceiling]).toArray(), [0.2, 0, 0])
})

test('sneaking at a platform edge limits unsupported travel while the remaining foot area holds the player', () => {
  const collision = Object.create(PlayerCollisionSystem.prototype)
  const block = { hasCollision: true, collisionBoxes: [[0, 0, 0, 1, 1, 1]] }
  const provider = { getBlockWorld: (x, y, z) => x === 0 && y === 2 && z === 0 ? block : null }
  const body = collision.playerBounds(new THREE.Vector3(0.74, 2.5, 0.74), PLAYER_CONFIG.pose.crouching)
  const shapes = collision.collectShapes(body.clone().expandByScalar(1), provider)
  const delta = new THREE.Vector3(0.18, -0.0784, 0.18)
  collision.backOffEdge(body, delta, shapes, 0.55, 0)
  assert.ok(delta.x > 0 && delta.x < 0.06)
  assert.equal(delta.x, delta.z)
  const allowed = collision.resolveMovement(body, delta, shapes, true, 0.6, 0)
  assert.equal(allowed.y, 0)
  assert.equal(collision.supportingBlock(body.translate(allowed), shapes), block)
})

test('logical states override static air and solid in single and batch queries, without changing static meshes', () => {
  const offset = { x: 20, y: -5, z: 30 }
  const { bridge, staticBlocks, reads } = createBridge(offset)
  staticBlocks.set('1,1,0', 'minecraft:stone')
  staticBlocks.set('2,1,0', 'minecraft:stone')
  const overlay = bridge.createLogicalBlockOverlay()
  assert.equal(overlay.setBlock(21, -4, 30, 'minecraft:air'), true)
  overlay.setBlock(23, -4, 30, 'minecraft:quartz_block')
  // Pistons can place blocks beyond the schematic's original tight bounds.
  overlay.setBlock(19, -4, 30, 'minecraft:stone_slab[type=bottom,waterlogged=false]')
  const positions = [{ x: 21, y: -4, z: 30 }, { x: 23, y: -4, z: 30 }, { x: 19, y: -4, z: 30 }, { x: 22, y: -4, z: 30 }]
  const provider = createProvider(bridge)
  const batch = provider.getBlocksWorld(positions)
  for (let index = 0; index < positions.length; index++) {
    const { x, y, z } = positions[index]
    const single = provider.getBlockWorld(x, y, z)
    assert.equal(single.hasCollision, batch[index].hasCollision)
    assert.deepEqual(plain(single.minecraftBlock), plain(batch[index].minecraftBlock))
    assert.deepEqual(plain(single.collisionBoxes || []), plain(batch[index].collisionBoxes || []))
  }
  assert.deepEqual(Array.from(batch, entry => entry.hasCollision), [false, true, true, true])
  assert.deepEqual(plain(batch[2].collisionBoxes), [[0, 0, 0, 1, 0.5, 1]])
  assert.equal(staticBlocks.get('1,1,0'), 'minecraft:stone', 'air is an override, not a mesh edit')
  assert.equal(staticBlocks.has('3,1,0'), false)
  assert.ok(reads.every(([x]) => x === 2), 'overridden positions must not query the cleared static wrapper')
  assert.equal(overlay.setBlock(Number.NaN, 0, 0, 'minecraft:stone'), false)
  overlay.dispose()
  assert.equal(provider.getBlockWorld(21, -4, 30).hasCollision, true)
  assert.equal(provider.getBlockWorld(23, -4, 30).hasCollision, false)
  assert.equal(overlay.setBlock(23, -4, 30, 'minecraft:stone'), false)
})

test('overlay disposal preserves other owners and detach/dispose invalidate stale handles', () => {
  const { bridge, staticBlocks } = createBridge()
  staticBlocks.set('1,1,0', 'minecraft:stone')
  const first = bridge.createLogicalBlockOverlay()
  first.setBlock(1, 1, 0, 'minecraft:quartz_block')
  const second = bridge.createLogicalBlockOverlay()
  second.setBlock(1, 1, 0, 'minecraft:air')
  assert.equal(bridge.getBlockWorld(1, 1, 0), null)
  second.dispose()
  assert.equal(bridge.getBlockWorld(1, 1, 0).blockName, 'quartz_block')
  bridge.detachRuntimeGroup()
  assert.equal(bridge.getBlockWorld(1, 1, 0), null)
  assert.equal(first.setBlock(1, 1, 0, 'minecraft:stone'), false)
  bridge.schematicObject = createBridge().bridge.schematicObject
  assert.equal(bridge.getBlocksWorld([{ x: 1, y: 1, z: 0 }])[0], null)
  const next = bridge.createLogicalBlockOverlay()
  next.setBlock(1, 1, 0, 'minecraft:stone')
  first.dispose()
  assert.equal(bridge.getBlockWorld(1, 1, 0).hasCollision, true)
  bridge.dispose()
  assert.equal(next.setBlock(1, 1, 0, 'minecraft:stone'), false)
  assert.equal(bridge._logicalBlockOverlays.size, 0)
})

test('real 3x3 replay closes and opens collision through playback, seek, and controller disposal', async () => {
  const rawReplay = JSON.parse(gunzipSync(await readFile(new URL('../public/redstone-archive/single-lever-piston-door-3x3.replay.json.gz', import.meta.url))))
  const manifest = JSON.parse(await readFile(new URL('../public/redstone-archive/interactive-doors.json', import.meta.url), 'utf8'))
  const doorControl = manifest.items[0].item.redstoneControl
  const offset = { x: 17, y: -3, z: 8 }
  const { bridge, staticBlocks } = createBridge(offset)
  for (const block of rawReplay.baseline) {
    staticBlocks.set(`${block.x},${block.y},${block.z}`, rawReplay.palette[block.state])
  }
  const scene = new THREE.Scene()
  const experience = {
    time: { delta: 50 },
    renderer: { async compileAsync() {}, renderFrame() {} },
    camera: { instance: new THREE.PerspectiveCamera() },
  }
  const world = {
    scene,
    experience,
    _getProjectionPlacementOffset: () => offset,
    activeProjectionContext: { item: { redstoneReplay: rawReplay, redstoneControl: doorControl } },
    minecraftSchematicRenderLayer: {
      _runtimeBridge: bridge,
      async createBlockPreviewObject() { return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()) },
      setRuntimeBlocksAtWorldAsync: patches => bridge.setBlocksAtWorldAsync(patches),
    },
  }
  const controller = new Controller({ world })
  const provider = createProvider(bridge)
  const collision = Object.create(PlayerCollisionSystem.prototype)
  Object.assign(collision, { debug: { active: false }, stats: {} })
  const body = collision.playerBounds(new THREE.Vector3(4 + offset.x, 5.1 + offset.y, 0.3 + offset.z), PLAYER_CONFIG.pose.standing)
  const doorway = []
  for (let x = 3; x <= 5; x++) {
    for (let y = 5; y <= 7; y++) {
      doorway.push({ x: x + offset.x, y: y + offset.y, z: 1 + offset.z })
    }
  }
  const check = (closed) => {
    const blocks = provider.getBlocksWorld(doorway)
    assert.equal(blocks.filter(block => block.hasCollision).length, closed ? 9 : 0)
    for (const { x, y, z } of doorway) {
      assert.equal(provider.getBlockWorld(x, y, z).hasCollision, closed)
    }
    assert.equal(collision.canOccupy(body, provider), !closed, 'player collision must agree with the door state')
  }
  try {
    assert.equal(await controller.initialize(), true)
    await controller._prepareMotionResources()
    controller.ready = true
    assert.equal(bridge._logicalBlockOverlays.size, 1, 'preparing dynamic meshes installs logical states')
    assert.ok([...staticBlocks.values()].every(state => state === 'minecraft:air'), 'static dynamic positions have been cleared')
    check(false)
    controller._advanceToTick(doorControl.segments.close.toTick)
    controller._updatePistonMotions(controller.currentTick)
    check(true)
    controller._advanceToTick(doorControl.segments.open.toTick)
    controller._updatePistonMotions(controller.currentTick)
    check(false)
    await controller.seek(doorControl.segments.close.toTick)
    check(true)
    await controller.seek(0)
    check(false)
    await controller.seek(doorControl.segments.close.toTick)
    const handle = controller._logicalBlockOverlay
    controller.destroy()
    assert.equal(bridge._logicalBlockOverlays.size, 0)
    assert.equal(handle.setBlock(doorway[0].x, doorway[0].y, doorway[0].z, 'minecraft:stone'), false)
    check(false)
  }
  finally {
    controller.destroy()
    bridge.dispose()
  }
})

test('controller reset clears positions absent from baseline and moving pistons use settled shapes', () => {
  const { bridge } = createBridge({ x: 10, y: 0, z: 0 })
  const controller = Object.create(Controller.prototype)
  Object.assign(controller, {
    world: { minecraftSchematicRenderLayer: { _runtimeBridge: bridge } },
    offset: { x: 10, y: 0, z: 0 },
    _posKeys: ['0,0,0', '1,0,0'],
    _simState: new Int32Array(2),
    _simMotion: new Int32Array(2),
    replay: { palette: ['minecraft:stone', 'minecraft:moving_piston'] },
    _timeline: { baselinePos: [0], baselineState: [0], posX: [0, 1], posY: [0, 0], posZ: [0, 0], strings: ['minecraft:quartz_block'], motionSettled: [0] },
    _logicalBlockOverlay: bridge.createLogicalBlockOverlay(),
  })
  controller._resetSimulationStates()
  controller._writeSimulationState(1, 1, 0)
  assert.equal(bridge.getBlockWorld(11, 0, 0).blockName, 'quartz_block')
  assert.equal(bridge.getBlockWorld(11, 0, 0).hasCollision, true)
  controller._resetSimulationStates()
  assert.equal(bridge.getBlockWorld(11, 0, 0), null)
  assert.equal(bridge.getBlockWorld(10, 0, 0).hasCollision, true)
  bridge.dispose()
})
