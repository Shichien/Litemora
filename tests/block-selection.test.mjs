/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import * as THREE from 'three'
import { getOverlayGeometryForTarget } from '../src/js/world/terrain/block-overlay-geometry.js'

// Exercise the game picker with a real Three camera, without starting WebGL or Experience.
async function loadGameModule(path, exports, globals) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const script = source.replace(/^import .*$/gm, '').replaceAll('export default ', '').replaceAll('export ', '')
  return vm.runInNewContext(`${script}\n;({ ${exports.join(', ')} })`, globals)
}

const require = createRequire(import.meta.url)
const blockDefinitions = require('minecraft-data/minecraft-data/data/pc/26.1/blocks.json')
const selectionShapes = require('../src/js/generated/minecraft-selection-shapes.json')

const data = await loadGameModule('../src/js/world/terrain/minecraft-block-data.js', [
  'getMinecraftBlockCollisionProfile',
  'getMinecraftBlockDefinition',
  'getMinecraftSelectionBoxes',
], {
  blockDefinitions,
  selectionShapes,
  blockCollisionShapes: require('minecraft-data/minecraft-data/data/pc/26.1/blockCollisionShapes.json'),
})
const { BlockRaycaster } = await loadGameModule('../src/js/interaction/block-raycaster.js', ['BlockRaycaster'], {
  ...data,
  THREE,
  blocks: { empty: { id: 0 } },
})
const { BlockMiningController } = await loadGameModule('../src/js/interaction/block-mining-controller.js', ['BlockMiningController'], {})

function block(name, properties = {}) {
  const { stateId, collisionBoxes } = data.getMinecraftBlockCollisionProfile(name, properties)
  return { stateId, collisionBoxes, minecraftBlock: { name, properties }, isImportedMinecraft: true }
}

function picker(targets, cells, dynamic = []) {
  const camera = new THREE.PerspectiveCamera()
  const ray = Object.assign(Object.create(BlockRaycaster.prototype), {
    camera,
    raycaster: new THREE.Raycaster(),
    params: { enabled: true, maxDistance: 6 },
    chunkManager: { getBlockWorld: (x, y, z) => cells.get(`${x},${y},${z}`) },
    debug: { active: false },
    experience: { world: {
      minecraftSchematicRenderLayer: { getRaycastTargets: () => targets },
      redstoneReplayController: { getRaycastTargets: () => dynamic },
    } },
  })
  return (x, y, z, dx, dy, dz) => {
    camera.position.set(x, y, z)
    camera.lookAt(x + dx, y + dy, z + dz)
    ray.update()
    return ray.current
  }
}

test('every supported Java state has an explicit selection shape, including empty shapes', () => {
  assert.equal(selectionShapes.states.length, blockDefinitions.at(-1).maxStateId + 1)
  for (const shape of selectionShapes.states) assert.ok(Array.isArray(selectionShapes.shapes[shape]))
  for (const name of ['air', 'water', 'lava']) {
    assert.deepEqual(data.getMinecraftSelectionBoxes(block(name).stateId), [])
  }
  for (const name of ['rail', 'powered_rail', 'detector_rail', 'activator_rail']) {
    for (const [shape, height] of [['east_west', 0.125], ['ascending_east', 0.5]]) {
      const rail = block(name, { shape })
      assert.equal(rail.collisionBoxes.length, 0)
      assert.deepEqual(data.getMinecraftSelectionBoxes(rail.stateId), [[0, 0, 0, 1, height, 1]])
    }
  }
})

for (const renderer of ['runtime', 'instanced']) {
  test(`${renderer} picking and overlay agree on thin blocks, empty space and state changes`, () => {
    const cells = new Map([['-1,0,0', block('rail')], ['-1,0,-1', block('stone')]])
    const targets = renderer === 'runtime'
      ? [{ userData: { litemoraWasmSchematicLayer: true } }]
      : [
          'rail',
          'stone',
          'oak_slab[type=top]',
          'oak_fence',
          'oak_stairs',
          'water',
        ].map(state => ({ userData: { blockName: state.split('[')[0], blockString: `minecraft:${state}`, instanceToWorldBlock: [-1, 0, 0] } }))
    const aim = picker(targets, cells)
    const rail = aim(-1, -0.44, 2, 0, 0, -1)
    assert.equal(rail.blockName, 'rail')
    assert.equal(rail.point.z, 0.5)
    assert.equal(rail.face.normal.z, 1)
    const cache = new Map()
    const geometry = getOverlayGeometryForTarget(rail, cache)
    geometry.computeBoundingBox()
    assert.equal(geometry.boundingBox.min.y, -0.5)
    assert.equal(geometry.boundingBox.max.y, -0.375)
    const miningTarget = BlockMiningController.prototype._captureTarget(rail)
    assert.equal(getOverlayGeometryForTarget(miningTarget, cache), geometry)
    assert.equal(aim(-1, -0.44, 0, 1, 0, 0).face.normal.x, -1)
    assert.equal(aim(-1, 0.2, 2, 0, 0, -1).blockName, 'stone')
    cells.set('-1,0,0', block('oak_slab', { type: 'top' }))
    assert.equal(aim(-1, -0.25, 2, 0, 0, -1).blockName, 'stone')
    assert.equal(aim(-1, 0.25, 2, 0, 0, -1).blockName, 'oak_slab')
    cells.set('-1,0,0', block('oak_fence'))
    assert.equal(aim(-0.6, 0.2, 2, 0, 0, -1).blockName, 'stone')
    assert.ok(Math.abs(aim(-1, 2, 0, 0, -1, 0).point.y - 0.5) < 1e-6)
    cells.set('-1,0,0', block('oak_stairs'))
    assert.ok(aim(-1, -0.25, 2, 0, 0, -1).selectionBoxes.length > 1)
    cells.set('-1,0,0', block('water'))
    assert.equal(aim(-1, 0.2, 2, 0, 0, -1).blockName, 'stone')
    assert.equal(aim(-1, 1, 2, 0, 0, -1), null)
    geometry.dispose()
  })
}

test('the replay interaction mesh only selects the current switch shape', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1)
  mesh.setMatrixAt(0, new THREE.Matrix4())
  const states = ['minecraft:stone_button[face=wall,facing=north,powered=false]']
  mesh.userData.minecraftDynamicBlockBatch = { worldBlocks: [{ x: 0, y: 0, z: 0 }], blockStrings: states }
  const aim = picker([], new Map(), [mesh])
  assert.equal(aim(0.4, 0.4, -2, 0, 0, 1), null)
  assert.equal(aim(0, 0, -2, 0, 0, 1).point.z, 0.375)
  states[0] = states[0].replace('false', 'true')
  assert.equal(aim(0, 0, -2, 0, 0, 1).point.z, 0.4375)
  states[0] = 'minecraft:air'
  assert.equal(aim(0, 0, -2, 0, 0, 1), null)
  mesh.geometry.dispose()
  mesh.material.dispose()
})
