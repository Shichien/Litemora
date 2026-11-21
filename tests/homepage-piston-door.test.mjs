/* eslint-disable test/no-import-node-test -- Node test runner */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import nbt from 'prismarine-nbt'
import service from '../src/js/world/terrain/schematic-service.js'

test('homepage door is the preserved 56-volume entity-free Litematic, with credited provenance', async () => {
  const bytes = await readFile(new URL('../public/homepage/piston-door-56.litematic', import.meta.url))
  const manifest = JSON.parse(await readFile(new URL('../public/homepage/piston-door-56.json', import.meta.url), 'utf8'))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  const { parsed } = await nbt.parse(bytes)
  const data = nbt.simplify(parsed)
  const size = data.Metadata.EnclosingSize
  assert.equal(size.x * size.y * size.z, 56)
  assert.equal(data.Metadata.TotalVolume, 56)
  assert.equal(data.Metadata.TotalBlocks, 49)
  for (const region of Object.values(data.Regions)) {
    assert.deepEqual(region.Entities, [])
  }
  const schematic = await service.parseArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { remember: false, sourceName: 'piston-door-56.litematic' })
  assert.equal(schematic.format, 'litematic')
  assert.equal(Object.keys(schematic.regions).length, 1)
  assert.equal(manifest.archiveAuthor, data.Metadata.Author)
  assert.match(manifest.notes, /存档变体/)
})

test('baked door retains depth-writing alpha cutouts for redstone and its supports', async () => {
  const bytes = await readFile(new URL('../public/homepage/piston-door-56.glb', import.meta.url))
  assert.equal(bytes.readUInt32LE(0), 0x46546C67)
  const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
  const wires = model.nodes.filter(node => node.extras?.blockState?.startsWith('minecraft:redstone_wire['))
  assert.ok(wires.length > 0)
  // This palette has no translucent blocks. BLEND loses the alpha cutoff and
  // makes the loader disable depth writes, hiding dust at oblique camera angles.
  assert.ok(model.materials.length > 0)
  for (const material of model.materials) {
    assert.equal(material.alphaMode, 'MASK')
    assert.ok(material.alphaCutoff > 0 && material.alphaCutoff <= 0.1)
  }
})
