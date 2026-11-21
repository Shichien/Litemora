// This repository runs tests with node --test, not Vitest.
/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import JSZip from 'jszip'
import * as THREE from 'three'
import { exportSchematicModel, prepareExportScene } from '../src/js/export/schematic-model-export.js'
import { createMinecraftBlockMaterial } from '../src/js/world/terrain/minecraft-block-material.js'

// GLTFExporter uses the browser FileReader API even for texture-free GLB.
// Keep this shim in tests; production never modifies browser/Node globals.
class TestFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result
      this.onloadend?.({ target: this })
    }).catch(error => this.onerror?.(error))
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`
      this.onloadend?.({ target: this })
    }).catch(error => this.onerror?.(error))
  }
}

function triangle() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 3, 0], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
  return geometry
}
function rootWithMesh(geometry = triangle(), material = new THREE.MeshBasicMaterial()) {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(geometry, material))
  return root
}
function close(actual, expected, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
}
function glbJSON(buffer) {
  const view = new DataView(buffer)
  assert.equal(view.getUint32(0, true), 0x46546C67)
  assert.equal(view.getUint32(4, true), 2)
  assert.equal(view.getUint32(8, true), buffer.byteLength)
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))))
}

test('snapshot includes nested mesh and instances, honors local transforms and excludes surrounding scene/helpers', () => {
  const background = new THREE.Scene()
  background.add(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100)))
  const root = new THREE.Group()
  root.position.set(10, 20, 30)
  background.add(root)
  background.scale.setScalar(100) // outside the requested root
  const group = new THREE.Group()
  group.position.set(3, 2, 1)
  group.rotation.z = Math.PI / 2
  root.add(group)
  const mesh = new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial())
  group.add(mesh)
  const instances = new THREE.InstancedMesh(triangle(), mesh.material, 2)
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(8, 0, 0))
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(12, 4, 0))
  root.add(instances)
  root.add(new THREE.BoxHelper(mesh))
  const helper = new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000))
  helper.userData.isHelper = true
  root.add(helper)
  root.add(new THREE.LineSegments(triangle()))
  const originalBounds = mesh.geometry.boundingBox?.clone() || null
  const originalMatrix = root.matrix.clone()
  const originalWorld = mesh.matrixWorld.clone()
  const originalPositions = mesh.geometry.attributes.position.array.slice()
  const snapshot = prepareExportScene(root, { scale: 2 })
  try {
    assert.equal(snapshot.meshCount, 3)
    assert.equal(snapshot.triangleCount, 3)
    assert.ok(root.matrix.equals(originalMatrix))
    assert.ok(mesh.matrixWorld.equals(originalWorld))
    assert.deepEqual(mesh.geometry.boundingBox, originalBounds)
    assert.deepEqual(mesh.geometry.attributes.position.array, originalPositions)
    const bounds = new THREE.Box3().setFromObject(snapshot.scene)
    close(bounds.min.y, 0)
    close(bounds.min.x + bounds.max.x, 0)
    close(bounds.min.z + bounds.max.z, 0)
    close(bounds.max.y, 14)
    close(bounds.max.x - bounds.min.x, 28)
    const first = snapshot.scene.children[0].geometry.attributes.position
    close(first.getX(0), -8)
    close(first.getY(0), 4)
    close(first.getX(1), -8)
    close(first.getY(1), 8)
    mesh.geometry.attributes.position.setX(0, 999)
    root.position.setScalar(999)
    close(first.getX(0), -8)
  }
  finally { snapshot.dispose() }
})

test('copies Minecraft PBR properties, UV, normalized colors and texture state without releasing originals', () => {
  const texture = new THREE.Texture({ width: 2, height: 2 })
  texture.colorSpace = THREE.SRGBColorSpace
  texture.offset.set(0.25, 0.5)
  const source = createMinecraftBlockMaterial(new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x80FF80,
    transparent: true,
    opacity: 0.6,
    alphaTest: 0.25,
    side: THREE.DoubleSide,
    vertexColors: true,
  }))
  const geometry = triangle()
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute([255, 128, 0, 0, 255, 0, 0, 0, 255], 3, true))
  let sourceDisposed = 0
  for (const item of [source, texture, geometry]) item.addEventListener('dispose', () => sourceDisposed++)
  const textureVersion = texture.source.version
  const snapshot = prepareExportScene(rootWithMesh(geometry, source))
  const copy = snapshot.scene.children[0]
  assert.ok(copy.material.isMeshStandardMaterial)
  assert.notEqual(copy.material, source)
  assert.notEqual(copy.geometry, geometry)
  assert.notEqual(copy.material.map, texture)
  assert.notEqual(copy.material.map.source, texture.source)
  assert.equal(texture.source.version, textureVersion)
  assert.equal(copy.material.map.image, texture.image)
  assert.deepEqual(copy.material.map.offset.toArray(), [0.25, 0.5])
  assert.equal(copy.material.transparent, true)
  assert.equal(copy.material.opacity, 0.6)
  assert.equal(copy.material.alphaTest, 0.25)
  assert.equal(copy.material.side, THREE.DoubleSide)
  assert.equal(copy.material.vertexColors, true)
  close(copy.geometry.attributes.color.getY(0), 128 / 255)
  assert.deepEqual(copy.geometry.attributes.uv.array, geometry.attributes.uv.array)
  let copiesDisposed = 0
  for (const item of [copy.geometry, copy.material, copy.material.map]) item.addEventListener('dispose', () => copiesDisposed++)
  snapshot.dispose()
  snapshot.dispose()
  assert.equal(copiesDisposed, 3)
  assert.equal(sourceDisposed, 0)
})

test('expands BatchedMesh active IDs, excludes deleted/hidden instances and reserved geometry', () => {
  const batch = new THREE.BatchedMesh(8, 50, 60, new THREE.MeshBasicMaterial())
  const geometryId = batch.addGeometry(new THREE.BoxGeometry(2, 2, 2), 30, 42)
  const deleted = batch.addInstance(geometryId)
  const hidden = batch.addInstance(geometryId)
  const visible = batch.addInstance(geometryId)
  batch.deleteInstance(deleted)
  batch.setVisibleAt(hidden, false)
  batch.setMatrixAt(visible, new THREE.Matrix4().makeTranslation(4, 6, 8))
  batch.setColorAt(visible, new THREE.Color(0.2, 0.4, 0.6))
  const snapshot = prepareExportScene(new THREE.Group().add(batch))
  try {
    assert.equal(snapshot.meshCount, 1)
    assert.equal(snapshot.triangleCount, 12)
    const bounds = new THREE.Box3().setFromObject(snapshot.scene)
    assert.deepEqual(bounds.min.toArray(), [-1, 0, -1])
    assert.deepEqual(bounds.max.toArray(), [1, 2, 1])
    close(snapshot.scene.children[0].material.color.r, 0.2)
  }
  finally {
    snapshot.dispose()
    batch.dispose()
  }
})

test('instance color multiplies material color and explicit matrices are honored', () => {
  const instances = new THREE.InstancedMesh(triangle(), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1, 1) }), 2)
  instances.matrixAutoUpdate = false
  instances.matrix.makeScale(2, 3, 4)
  instances.setMatrixAt(0, new THREE.Matrix4())
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0))
  instances.setColorAt(0, new THREE.Color(0.4, 0.5, 0.6))
  instances.setColorAt(1, new THREE.Color(1, 1, 1))
  const snapshot = prepareExportScene(instances)
  try {
    close(snapshot.scene.children[0].material.color.r, 0.2)
    close(snapshot.scene.children[1].material.color.r, 0.5)
    const bounds = new THREE.Box3().setFromObject(snapshot.scene)
    close(bounds.max.y, 9)
    close(bounds.max.x - bounds.min.x, 8)
  }
  finally { snapshot.dispose() }
})

test('draw ranges and material groups export only triangles actually drawn', () => {
  const geometry = new THREE.BoxGeometry()
  geometry.setDrawRange(6, 12)
  const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial())
  const snapshot = prepareExportScene(rootWithMesh(geometry, materials))
  try {
    assert.equal(snapshot.triangleCount, 4)
    assert.equal(snapshot.scene.children[0].geometry.attributes.position.count, 12)
    assert.equal(snapshot.scene.children[0].geometry.groups.length, 2)
  }
  finally { snapshot.dispose() }
})

test('reflection flips winding to keep outward normals', () => {
  const root = rootWithMesh()
  root.scale.x = -1
  const snapshot = prepareExportScene(root)
  try {
    const geometry = snapshot.scene.children[0].geometry
    const a = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 0)
    const b = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 1)
    const c = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 2)
    assert.ok(b.sub(a).cross(c.sub(a)).z > 0)
    assert.ok(geometry.attributes.normal.getZ(0) > 0)
  }
  finally { snapshot.dispose() }
})

test('rejects empty, invalid, huge and corrupt models before large allocation', async () => {
  assert.throws(() => prepareExportScene(null), /没有可导出/)
  assert.throws(() => prepareExportScene(new THREE.Group()), /没有可导出的可见网格/)
  for (const scale of [0, -1, Number.NaN, Infinity, 1e7])
    assert.throws(() => prepareExportScene(rootWithMesh(), { scale }), /比例/)
  const invalid = triangle()
  invalid.attributes.position.setX(0, Infinity)
  assert.throws(() => prepareExportScene(rootWithMesh(invalid)), /非有限/)
  const indexed = triangle()
  indexed.setIndex([0, 1, 999])
  assert.throws(() => prepareExportScene(rootWithMesh(indexed)), /越界/)
  const oversized = triangle()
  oversized.attributes.position.count = 3_000_000
  assert.throws(() => prepareExportScene(rootWithMesh(oversized)), /模型过大/)
  const hugeInstances = new THREE.InstancedMesh(triangle(), new THREE.MeshBasicMaterial(), 1)
  hugeInstances.count = 999999
  assert.throws(() => prepareExportScene(hugeInstances), /实例数量/)
  await assert.rejects(exportSchematicModel(rootWithMesh(), { format: 'blend' }), /不支持/)
})

test('binary STL contains all instance triangles and converts Y-up to Z-up', async () => {
  const root = rootWithMesh(new THREE.BoxGeometry(2, 4, 6))
  const instances = new THREE.InstancedMesh(triangle(), new THREE.MeshBasicMaterial(), 2)
  instances.setMatrixAt(0, new THREE.Matrix4())
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(8, 0, 0))
  root.add(instances)
  const { blob, filename } = await exportSchematicModel(root, { format: 'stl', name: '../bad:name.litematic', scale: 2 })
  assert.equal(filename, '.._bad_name.stl')
  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)
  assert.equal(view.getUint32(80, true), 14)
  assert.equal(buffer.byteLength, 84 + 50 * 14)
  let minZ = Infinity
  let maxZ = -Infinity
  for (let face = 0; face < 14; face++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const z = view.getFloat32(84 + face * 50 + 12 + vertex * 12 + 8, true)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
  }
  close(minZ, 0)
  close(maxZ, 10)
})

test('OBJ exports all meshes and UVs with a synchronous snapshot before first await', async () => {
  const root = rootWithMesh()
  root.add(new THREE.Mesh(triangle()))
  const exporting = exportSchematicModel(root, { format: 'obj', name: 'build' })
  root.children[0].geometry.attributes.position.setX(0, 9999)
  root.clear()
  const { blob, filename } = await exporting
  assert.equal(filename, 'build.obj')
  const text = await blob.text()
  assert.equal((text.match(/^o /gm) || []).length, 2)
  assert.equal((text.match(/^f /gm) || []).length, 2)
  assert.equal((text.match(/^vt /gm) || []).length, 6)
  assert.ok(!text.includes('9999'))
})

test('GLB has actual GLB framing, standard materials and Y-up geometry; ZIP carries real bpy conversion', async () => {
  const originalFileReader = globalThis.FileReader
  globalThis.FileReader = TestFileReader
  try {
    const root = rootWithMesh()
    const exported = await exportSchematicModel(root, { format: 'glb', name: 'model' })
    assert.equal(exported.filename, 'model.glb')
    const json = glbJSON(await exported.blob.arrayBuffer())
    assert.equal(json.meshes.length, 1)
    assert.ok(json.materials[0].pbrMetallicRoughness)
    const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]
    assert.deepEqual(position.min, [-1, 0, 0])
    assert.deepEqual(position.max, [1, 3, 0])
    const bundle = await exportSchematicModel(root, { format: 'blender', name: 'test' })
    assert.equal(bundle.filename, 'test-blender.zip')
    const zip = await JSZip.loadAsync(await bundle.blob.arrayBuffer())
    assert.deepEqual(Object.keys(zip.files).sort(), ['README.txt', 'convert.py', 'model.glb'])
    glbJSON(await zip.file('model.glb').async('arraybuffer'))
    const script = await zip.file('convert.py').async('string')
    assert.match(script, /bpy\.ops\.import_scene\.gltf\(filepath=str\(source\)\)/)
    assert.match(script, /bpy\.ops\.file\.pack_all\(\)/)
    assert.match(script, /bpy\.ops\.wm\.save_as_mainfile\(filepath=str\(target\)\)/)
    assert.match(script, /source\.with_suffix\("\.blend"\)/)
    const readme = await zip.file('README.txt').async('string')
    assert.match(readme, /浏览器没有生成 \.blend/)
    assert.match(readme, /blender --background --python convert\.py -- model\.glb output\.blend/)
  }
  finally {
    if (originalFileReader === undefined)
      delete globalThis.FileReader
    else globalThis.FileReader = originalFileReader
  }
})
