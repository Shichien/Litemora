// Standalone integration check; start Vite before running this script.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import JSZip from 'jszip'

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const testUrl = process.env.MODEL_EXPORT_URL || 'http://127.0.0.1:5173'
  // Isolate unrelated homepage assets; import the real Vite modules and Vue panel.
  await page.route(`${testUrl}/`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="export-test"></div></body></html>' }))
  await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const { exportSchematicModel } = await import('/src/js/export/schematic-model-export.js')
    const root = new THREE.Group()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    const context = canvas.getContext('2d')
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 2, 2)
    context.fillStyle = '#00ff00'
    context.fillRect(1, 0, 1, 1)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0 })
    const mesh = new THREE.InstancedMesh(geometry, material, 2)
    mesh.name = 'textured_blocks'
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 4, 5))
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5, 4, 5))
    root.add(mesh)
    root.add(new THREE.BoxHelper(mesh))
    const hidden = new THREE.Mesh(geometry, material)
    hidden.visible = false
    root.add(hidden)
    const before = Array.from(mesh.instanceMatrix.array)
    let sourceDisposals = 0
    for (const resource of [geometry, material, texture]) resource.addEventListener('dispose', () => sourceDisposals++)
    const output = {}
    for (const format of ['stl', 'obj', 'glb', 'blender']) {
      const result = await exportSchematicModel(root, { format, name: 'browser-fixture.litematic' })
      const data = new Uint8Array(await result.blob.arrayBuffer())
      output[format] = { filename: result.filename, mime: result.blob.type, base64: btoa(Array.from(data, byte => String.fromCharCode(byte)).join('')) }
    }
    output.sourceIntact = sourceDisposals === 0 && before.every((n, i) => n === mesh.instanceMatrix.array[i]) && root.children.length === 3
    return output
  })
  assert.equal(results.sourceIntact, true, 'exports must preserve source resources and instances')
  const bytes = format => Buffer.from(results[format].base64, 'base64')
  const stl = bytes('stl')
  assert.equal(stl.readUInt32LE(80), 24, 'two boxes, no hidden mesh/helper')
  assert.equal(stl.length, 84 + 24 * 50)
  const obj = bytes('obj').toString('utf8')
  assert.equal((obj.match(/^f /gm) || []).length, 24)
  assert.equal((obj.match(/^o /gm) || []).length, 2)
  function parseGlb(buffer) {
    assert.equal(buffer.toString('ascii', 0, 4), 'glTF')
    assert.equal(buffer.readUInt32LE(4), 2)
    assert.equal(buffer.readUInt32LE(8), buffer.length)
    assert.equal(buffer.readUInt32LE(16), 0x4E4F534A)
    const jsonLength = buffer.readUInt32LE(12)
    const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
    const binStart = 20 + jsonLength
    assert.equal(buffer.readUInt32LE(binStart + 4), 0x004E4942)
    return { json, bin: buffer.subarray(binStart + 8) }
  }
  const glb = parseGlb(bytes('glb'))
  assert.equal(glb.json.meshes.length, 2)
  assert.equal(glb.json.images.length, 1)
  const image = glb.json.images[0]
  assert.equal(image.mimeType, 'image/png')
  assert.equal(image.uri, undefined, 'texture must be embedded')
  const view = glb.json.bufferViews[image.bufferView]
  const png = glb.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const pixels = await page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    return { width: image.width, height: image.height, data: [...ctx.getImageData(0, 0, image.width, image.height).data] }
  }, png.toString('base64'))
  assert.equal(pixels.width, 2)
  assert.equal(pixels.height, 2)
  const rgba = Array.from({ length: 4 }, (_, i) => pixels.data.slice(i * 4, i * 4 + 4))
  assert.equal(rgba.filter(p => p.join(',') === '255,0,0,255').length, 3)
  assert.equal(rgba.filter(p => p.join(',') === '0,255,0,255').length, 1)
  assert.ok(glb.json.materials[0].pbrMetallicRoughness.baseColorTexture)
  const zip = await JSZip.loadAsync(bytes('blender'))
  assert.deepEqual(Object.keys(zip.files).sort(), ['README.txt', 'convert.py', 'model.glb'])
  const zipGlb = parseGlb(await zip.file('model.glb').async('nodebuffer'))
  assert.equal(zipGlb.json.images.length, 1)
  const script = await zip.file('convert.py').async('string')
  assert.match(script, /bpy\.ops\.import_scene\.gltf/)
  assert.match(script, /bpy\.ops\.wm\.save_as_mainfile/)
  assert.match(await zip.file('README.txt').async('string'), /浏览器没有生成 \.blend/)
  assert.deepEqual(errors, [], 'page must not raise uncaught JavaScript errors')
  console.log(JSON.stringify({ status: 'passed', stlTriangles: 24, objObjects: 2, glbMeshes: glb.json.meshes.length, embeddedPng: { width: 2, height: 2, verifiedPixels: true }, zipEntries: Object.keys(zip.files), sourceIntact: true, pageErrors: errors, nativeBlender: 'not tested; Blender is not on PATH' }, null, 2))
}
finally {
  await browser.close()
}
