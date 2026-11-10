/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createMinecraftBlockMaterial } from '../src/js/world/terrain/minecraft-block-material.js'
import { interpolateMinecraftCorners, minecraftCornerAO, minecraftFaceCornerAO, minecraftLightChannels, minecraftLightFieldUniforms, minecraftMeanLight, prepareMinecraftLightGeometry, setMinecraftLightField } from '../src/js/world/terrain/minecraft-light-field-render.js'

test('four AO corners sample separate neighbors; glass contributes no occlusion', () => {
  const blocked = new Set(['-1,1,0', '0,1,-1'])
  const corners = minecraftFaceCornerAO([0, 0, 0], [0, 1, 0], (x, y, z) => blocked.has(`${x},${y},${z}`) ? 1 : 0)
  assert.deepEqual(corners.map(n => Number(n.toFixed(3))), [0.4, 0.8, 1, 0.8])
  assert.equal(minecraftCornerAO(1, 1, 0), minecraftCornerAO(1, 1, 1))
  assert.equal(minecraftCornerAO(0, 0, 0), 1)
  assert.equal(interpolateMinecraftCorners([0.4, 0.8, 1, 0.8], 0.5, 0.5), 0.75)
  assert.equal(minecraftMeanLight(12, 0, 4, 0), 10)
})

test('sky and block levels are independent; nighttime does not extinguish block sources', () => {
  assert.deepEqual(minecraftLightChannels(0, 15, 0), minecraftLightChannels(0, 15, 1))
  assert.ok(minecraftLightChannels(15, 0, 0.22)[0] < minecraftLightChannels(15, 0, 1)[0])
  assert.deepEqual(minecraftLightChannels(0, 0, 0, 15), [1, 0.9, 0.75])
  assert.deepEqual(minecraftLightChannels(0, 0, 1), [0.015, 0.015, 0.015])
})

test('3D field has explicit RGBA byte layout and nearest sampling with no fullbright failure', () => {
  const data = new Uint8Array(2 * 3 * 4 * 4)
  setMinecraftLightField({ data, min: { x: -2, y: -3, z: -4 }, size: { x: 2, y: 3, z: 4 } })
  assert.equal(minecraftLightFieldUniforms.texture.value.image.data, data)
  assert.equal(minecraftLightFieldUniforms.texture.value.minFilter, THREE.NearestFilter)
  assert.equal(minecraftLightFieldUniforms.texture.value.type, THREE.UnsignedByteType)
  assert.deepEqual(minecraftLightFieldUniforms.min.value.toArray(), [-2, -3, -4])
  assert.equal(minecraftLightFieldUniforms.enabled.value, true)
  assert.throws(() => setMinecraftLightField({ data: new Uint8Array(1), min: [0, 0, 0], size: [2, 2, 2] }))
  assert.equal(minecraftLightFieldUniforms.enabled.value, false)
  const allocated = minecraftLightFieldUniforms.texture.value
  let disposed = false
  allocated.addEventListener('dispose', () => {
    disposed = true
  })
  setMinecraftLightField(null)
  assert.equal(disposed, true)
  assert.equal(minecraftLightFieldUniforms.texture.value.image.data.length, 4)
})

test('integer centers survive negative chunk origin, fixed-point scale and rotation without source mutation', () => {
  const box = new THREE.BoxGeometry(1, 1, 1)
  box.scale(16, 16, 16)
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(-3, 4, -7), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1 / 16, 1 / 16, 1 / 16))
  const prepared = prepareMinecraftLightGeometry(box, { matrix })
  assert.equal(box.hasAttribute('mcBlockCenter'), false)
  const centers = prepared.getAttribute('mcBlockCenter')
  for (let i = 0; i < centers.count; i++) {
    const world = new THREE.Vector3().fromBufferAttribute(centers, i).applyMatrix4(matrix)
    assert.ok(world.distanceTo(new THREE.Vector3(-3, 4, -7)) < 1e-5)
  }
  const dynamic = prepareMinecraftLightGeometry(box, { blockCenter: { x: 0, y: 0, z: 0 } })
  assert.ok(dynamic.getAttribute('mcBlockCenter').array.every(n => n === 0))
})

test('shader uses world axes, four-corner vertex AO, independent channels and preserves alpha', () => {
  const material = createMinecraftBlockMaterial(new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.2 }))
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader }
  material.onBeforeCompile(shader)
  assert.match(shader.vertexShader, /sampler3D/)
  assert.match(shader.vertexShader, /mcCorner\(base,-tangentU,-tangentV\)/)
  assert.match(shader.vertexShader, /mix\(mix\(c00,c10,uv.x\)/)
  assert.match(shader.vertexShader, /float blockLight=mcCurve\(block\)/)
  assert.match(shader.fragmentShader, /vMinecraftFieldLight \* minecraftShade \* vMinecraftAO/)
  assert.match(shader.fragmentShader, /#include <alphatest_fragment>/)
  assert.equal(shader.uniforms.minecraftLightEnabled, minecraftLightFieldUniforms.enabled)
  const preview = createMinecraftBlockMaterial(new THREE.MeshBasicMaterial(), { value: 1 })
  preview.onBeforeCompile(shader)
  assert.equal(shader.uniforms.minecraftLightEnabled.value, false)
})
