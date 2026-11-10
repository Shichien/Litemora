/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { test } from 'node:test'
import { Cubane } from 'cubane'
import JSZip from 'jszip'
import { installCauldronModelFix } from '../src/js/world/terrain/cubane-cauldron-model-fix.js'

const zip = await JSZip.loadAsync(await fs.readFile(new URL('../public/minecraft-default-pack.pack', import.meta.url)))

function createLoader() {
  const cubane = new Cubane({ autoRestore: false })
  const loader = cubane.getAssetLoader()
  // Only replace I/O: model parsing, parent merging and caching are actual Cubane.
  loader.getResourceString = async path => zip.file(`assets/minecraft/${path}`)?.async('string') || null
  return { cubane, loader }
}

test('real resource pack cauldron models retain fourteen body/content elements', async () => {
  const { cubane, loader } = createLoader()
  try {
    const broken = await loader.getModel('minecraft:block/water_cauldron_full')
    assert.equal(broken.elements.length, 1, 'pin the upstream regression being repaired')
    installCauldronModelFix(cubane)
    const installed = loader.getModel
    installCauldronModelFix(cubane)
    assert.equal(loader.getModel, installed, 'install is idempotent')
    for (const name of ['water_cauldron_level1', 'water_cauldron_level2', 'water_cauldron_full', 'lava_cauldron', 'powder_snow_cauldron_full']) {
      const model = await loader.getModel(`minecraft:block/${name}`)
      assert.equal(model.elements.length, 14, name)
      assert.ok(model.textures.side.includes('cauldron_side'), name)
      assert.ok(model.elements.some(element => Object.values(element.faces).some(face => face.texture === '#content')), name)
      assert.equal(model.parent, undefined, 'parents have been resolved')
      assert.equal(await loader.getModel(`block/${name}`), model, 'resolved model is cached')
    }
  }
  finally { cubane.dispose() }
})

test('normal water and lava retain the exact upstream liquid model behavior', async () => {
  const original = createLoader()
  const patched = createLoader()
  try {
    installCauldronModelFix(patched.cubane)
    for (const name of ['water', 'water_level_1', 'water_level_7', 'lava', 'lava_level_3', 'cauldron']) {
      assert.deepEqual(await patched.loader.getModel(`block/${name}`), await original.loader.getModel(`block/${name}`), name)
    }
  }
  finally {
    original.cubane.dispose()
    patched.cubane.dispose()
  }
})
