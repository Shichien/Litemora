import { loadMinecraftResourcePack } from './minecraft-resource-pack-storage.js'

const DEFAULT_RESOURCE_PACK_URL = '/minecraft-default-pack.pack'

export const BUNDLED_MINECRAFT_RESOURCE_PACK_NAME = 'litemora-default-pack'
export const BUNDLED_MINECRAFT_RESOURCE_PACK_URL = DEFAULT_RESOURCE_PACK_URL

let bundledMinecraftResourcePackBlobPromise = null

export async function loadBundledMinecraftResourcePackBlob(options = {}) {
  const forceReload = options.forceReload === true

  if (forceReload) {
    bundledMinecraftResourcePackBlobPromise = null
  }

  if (bundledMinecraftResourcePackBlobPromise) {
    return bundledMinecraftResourcePackBlobPromise
  }

  bundledMinecraftResourcePackBlobPromise = (async () => {
    const response = await fetch(BUNDLED_MINECRAFT_RESOURCE_PACK_URL, {
      cache: 'force-cache',
    })

    if (!response.ok) {
      throw new Error(`minecraft_resource_pack_fetch_failed:${response.status}`)
    }

    return response.blob()
  })().catch((error) => {
    bundledMinecraftResourcePackBlobPromise = null
    throw error
  })

  return bundledMinecraftResourcePackBlobPromise
}

export function clearBundledMinecraftResourcePackBlobCache() {
  bundledMinecraftResourcePackBlobPromise = null
}

export async function loadPreferredMinecraftResourcePack(options = {}) {
  const customRecord = await loadMinecraftResourcePack(options)

  if (customRecord?.file instanceof Blob) {
    return {
      blob: customRecord.file,
      name: customRecord.fileName || 'custom-resource-pack.zip',
      source: 'custom',
      size: Number(customRecord.size || customRecord.file.size || 0),
      updatedAt: Number(customRecord.updatedAt || 0),
      key: customRecord.key || '',
    }
  }

  const blob = await loadBundledMinecraftResourcePackBlob()
  return {
    blob,
    name: BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
    source: 'built-in',
    size: Number(blob.size || 0),
    updatedAt: 0,
    key: BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
  }
}
