import { sendError, sendJson } from './_space.js'
import {
  buildDiscoverProjectionEntry,
  galleryDiscoverKey,
  getKv,
  readGalleryJson,
  upsertDiscoverProjectionEntry,
  writeGalleryJson,
} from './gallery/_shared.js'

function parseLimit(request) {
  try {
    const url = new URL(request.url)
    const value = Number(url.searchParams.get('limit') || 12)
    if (!Number.isFinite(value)) {
      return 12
    }
    return Math.min(24, Math.max(1, Math.round(value)))
  }
  catch {
    return 12
  }
}

function resolveSpaceNameFromManifestKey(key = '') {
  const match = String(key || '').match(/^gallery:space:([^:]+):manifest$/u)
  return match ? decodeURIComponent(match[1]) : ''
}

async function buildDiscoverEntriesFromManifests(kv, limit = 12) {
  if (!kv || typeof kv.list !== 'function') {
    return []
  }

  const manifestKeys = []
  let cursor
  do {
    const response = await kv.list({
      prefix: 'gallery:space:',
      cursor,
      limit: 100,
    })
    for (const keyInfo of response?.keys || []) {
      if (String(keyInfo?.name || '').endsWith(':manifest')) {
        manifestKeys.push(keyInfo.name)
      }
    }
    cursor = response?.list_complete ? undefined : response?.cursor
  }
  while (cursor && manifestKeys.length < 80)

  let discoverEntries = []
  for (const manifestKey of manifestKeys) {
    const spaceName = resolveSpaceNameFromManifestKey(manifestKey)
    if (!spaceName) {
      continue
    }

    const manifest = await readGalleryJson(kv, manifestKey, null)
    const profile = await readGalleryJson(kv, `gallery:space:${spaceName}:profile`, null)
    for (const item of Array.isArray(manifest?.items) ? manifest.items : []) {
      if (item?.visibility !== 'public') {
        continue
      }

      const entry = buildDiscoverProjectionEntry(spaceName, item, profile)
      if (!entry) {
        continue
      }

      discoverEntries = upsertDiscoverProjectionEntry(discoverEntries, entry, Math.max(limit, 24))
    }
  }

  return discoverEntries.slice(0, limit)
}

export async function onRequestGet(context) {
  try {
    const kv = getKv(context.env)
    if (!kv) {
      return sendJson(200, {
        items: [],
        localOnly: true,
      })
    }

    const limit = parseLimit(context.request)
    let items = await readGalleryJson(kv, galleryDiscoverKey(), [])
    if (!Array.isArray(items) || !items.length) {
      items = await buildDiscoverEntriesFromManifests(kv, Math.max(limit, 24))
      if (items.length) {
        await writeGalleryJson(kv, galleryDiscoverKey(), items)
      }
    }

    return sendJson(200, {
      items: (Array.isArray(items) ? items : []).slice(0, limit),
    })
  }
  catch (error) {
    return sendError(500, 'discover_read_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
