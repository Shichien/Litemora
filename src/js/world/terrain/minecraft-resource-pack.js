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
