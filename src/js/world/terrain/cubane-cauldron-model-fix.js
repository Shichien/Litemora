const PATCHED = Symbol('litemora-cauldron-model-loader')

/** Cubane 1.0.19 mistakes water/lava_cauldron_* models for fluid cubes. */
export function installCauldronModelFix(cubane) {
  const loader = cubane?.getAssetLoader?.()
  if (!loader || loader[PATCHED])
    return
  const original = loader.getModel
  if (typeof original !== 'function' || typeof loader.loadAndMergeModel !== 'function')
    throw new Error('Unsupported Cubane model loader')

  loader.getModel = async function (modelPath) {
    const path = String(modelPath).replace(/^minecraft:/, '')
    if (!/^block\/(?:water|lava)_cauldron(?:_|$)/.test(path))
      return original.call(this, modelPath)
    const cacheKey = `model:${path}`
    if (this.modelCache.has(cacheKey))
      return this.modelCache.get(cacheKey)
    const source = await this.getResourceString(`models/${path}.json`)
    if (!source)
      return original.call(this, modelPath)
    const model = JSON.parse(source)
    const resolved = model.parent ? await this.loadAndMergeModel(model) : model
    this.modelCache.set(cacheKey, resolved)
    return resolved
  }
  // A renderer can have auto-restored resources before our initialization hook.
  for (const key of loader.modelCache.keys()) {
    if (/^model:block\/(?:water|lava)_cauldron(?:_|$)/.test(key))
      loader.modelCache.delete(key)
  }
  loader[PATCHED] = true
}
