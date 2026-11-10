/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import { createMinecraftBlockMaterial, minecraftBlockDaylight, minecraftFaceBrightness, setMinecraftBlockDaylight } from '../src/js/world/terrain/minecraft-block-material.js'

test('six world faces use vanilla direction weights, independent of camera', () => {
  for (const [normal, expected] of [[[0, 1, 0], 1], [[0, -1, 0], 0.5], [[1, 0, 0], 0.6], [[-1, 0, 0], 0.6], [[0, 0, 1], 0.8], [[0, 0, -1], 0.8]])
    assert.equal(minecraftFaceBrightness(...normal), expected)
  assert.ok(Math.abs(minecraftFaceBrightness(1, 1, 0) - 0.8) < 1e-10)
})

test('conversion preserves biome tint, vertex AO/tint, cutout alpha, blending and polygon offsets', () => {
  const texture = new THREE.Texture()
  const alpha = new THREE.Texture()
  const ao = new THREE.Texture()
  const source = new THREE.MeshStandardMaterial({ color: 0x70AD43, map: texture, alphaMap: alpha, aoMap: ao, vertexColors: true, transparent: true, opacity: 0.7, alphaTest: 0.2, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
  const material = createMinecraftBlockMaterial(source)
  assert.ok(material.isMeshBasicMaterial)
  assert.deepEqual(material.color, source.color)
  assert.notEqual(material.color, source.color)
  for (const key of ['map', 'alphaMap', 'aoMap', 'vertexColors', 'transparent', 'opacity', 'alphaTest', 'side', 'depthWrite', 'polygonOffset', 'polygonOffsetFactor'])
    assert.equal(material[key], source[key], key)
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace)
  assert.equal(alpha.colorSpace, THREE.NoColorSpace)
  assert.equal(material.toneMapped, false)
  assert.equal(material.fog, true)
  assert.equal(createMinecraftBlockMaterial(material), material)
})

test('shader shades linear RGB only, supports world instance/batch rotation and retains output conversion', () => {
  const material = createMinecraftBlockMaterial(new THREE.MeshStandardMaterial())
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader }
  material.onBeforeCompile(shader)
  assert.match(shader.vertexShader, /mat3\(modelMatrix\)/)
  assert.match(shader.vertexShader, /mat3\(instanceMatrix\)/)
  assert.match(shader.vertexShader, /mat3\(batchingMatrix\)/)
  assert.doesNotMatch(shader.fragmentShader, /pow\(gl_FragColor/)
  assert.match(shader.fragmentShader, /outgoingLight \*= max/)
  assert.ok(shader.fragmentShader.indexOf('outgoingLight *= max') < shader.fragmentShader.indexOf('#include <colorspace_fragment>'))
  assert.match(shader.fragmentShader, /#include <alphatest_fragment>/)
  assert.match(shader.fragmentShader, /#include <color_fragment>/)
  assert.equal(shader.uniforms.minecraftDaylight, minecraftBlockDaylight)
})

test('daylight affects shared world uniform without changing preview and emissive floor has distinct batch key', () => {
  const previewDaylight = { value: 1 }
  const dark = createMinecraftBlockMaterial(new THREE.MeshStandardMaterial(), previewDaylight)
  const glowing = createMinecraftBlockMaterial(new THREE.MeshStandardMaterial({ emissive: 0xFFFFFF }))
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' }
  dark.onBeforeCompile(shader)
  setMinecraftBlockDaylight(0)
  assert.equal(minecraftBlockDaylight.value, 0.22)
  assert.equal(shader.uniforms.minecraftDaylight.value, 1)
  glowing.onBeforeCompile(shader)
  assert.equal(shader.uniforms.minecraftEmission.value, 1)
  assert.notEqual(dark.customProgramCacheKey(), glowing.customProgramCacheKey())
  setMinecraftBlockDaylight(1)
  assert.equal(minecraftBlockDaylight.value, 1)
  const controller = readFileSync(new URL('../src/js/world/redstone-replay-controller.js', import.meta.url), 'utf8')
  assert.match(controller, /shaderKey: material\?\.customProgramCacheKey\?\.\(\)/)
})

test('custom shader materials are not destructively converted', () => {
  const custom = new THREE.ShaderMaterial()
  assert.equal(createMinecraftBlockMaterial(custom), custom)
})
