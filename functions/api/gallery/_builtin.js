import { readAccountSession } from '../auth/_shared.js'
import {
  canManageGallery,
  findGalleryManifestItemByIdentifier,
  galleryItemKey,
  loadGalleryState,
  readGalleryJson,
  sendError,
} from './_shared.js'

const SPACE = 'redstonearchive'
const SLUGS = new Set(['singleleverpistondoor3x3'])
const MANIFEST_PATH = '/redstone-archive/interactive-doors.json'

function safeAssetPath(value, suffix) {
  return typeof value === 'string'
    && /^\/redstone-archive\/[a-z0-9-]+(?:\.[a-z0-9]+)+$/.test(value)
    && value.endsWith(suffix)
}

// ASSETS is an internal static binding: never fetch arbitrary caller-provided URLs.
export async function fetchBuiltinAsset(context, assetPath) {
  if (!context.env?.ASSETS?.fetch)
    return null
  try {
    const response = await context.env.ASSETS.fetch(new Request(new URL(assetPath, context.request.url)))
    return response.ok ? response : null
  }
  catch {
    return null
  }
}

export async function loadBuiltinReadState(context) {
  const state = await loadGalleryState(context)
  if (state.spaceName === SPACE && !state.kv && context.request.method === 'GET') {
    return { ...state, response: null }
  }
  return state
}

export async function availableBuiltinEntries(context, state) {
  if (state.spaceName !== SPACE)
    return []
  const response = await fetchBuiltinAsset(context, MANIFEST_PATH)
  if (!response || !response.headers.get('content-type')?.includes('application/json'))
    return []
  const document = await response.json().catch(() => null)
  if (document?.version !== 1 || !Array.isArray(document.items))
    return []
  const entries = []
  const seen = new Set()
  for (const entry of document.items) {
    const item = entry?.item
    const slug = item?.projectionSlug
    if (!SLUGS.has(slug) || item.id !== slug || item.visibility !== 'public' || seen.has(slug)
      || !entry.worldConfig || typeof entry.worldConfig !== 'object'
      || !safeAssetPath(entry.sourceUrl, '.litematic') || !safeAssetPath(entry.replayUrl, '.replay.json.gz')) {
      continue
    }
    seen.add(slug)
    // Do not filter private summaries first: even a private or stale KV entry
    // reserves its ID/slug and must suppress the static fallback.
    const collision = findGalleryManifestItemByIdentifier(state.manifest, slug)
      || (state.manifest?.items || []).some(candidate => candidate?.routeId === slug)
    const stored = await readGalleryJson(state.kv, galleryItemKey(SPACE, slug), null)
    if (collision || stored)
      continue
    entries.push({ ...entry, item: { ...item, builtin: true, readOnly: true } })
  }
  return entries
}

export async function findBuiltinEntry(context, state, identifier) {
  if (!SLUGS.has(identifier))
    return null
  return (await availableBuiltinEntries(context, state)).find(entry => entry.item.id === identifier) || null
}

// World endpoints historically did not check gallery ACLs. For the reserved
// builtin namespace, never expose a colliding private KV projection's config/state.
export async function builtinWorldRead(context, spaceName, projectionId) {
  if (spaceName !== SPACE || !SLUGS.has(projectionId))
    return { entry: null, response: null }
  const state = await loadBuiltinReadState(context)
  if (state.response)
    return { entry: null, response: state.response }
  const summary = findGalleryManifestItemByIdentifier(state.manifest, projectionId)
    || state.manifest?.items?.find(item => item?.routeId === projectionId)
  const stored = await readGalleryJson(state.kv, galleryItemKey(SPACE, summary?.id || projectionId), null)
  if ((stored || summary)?.visibility === 'private') {
    const viewer = await readAccountSession(context.request, context.env)
    if (!canManageGallery(viewer, state.profile))
      return { entry: null, response: sendError(404, 'gallery_item_not_found') }
  }
  return { entry: await findBuiltinEntry(context, state, projectionId), response: null }
}

export function builtinWorldConfig(entry) {
  return {
    ...entry.worldConfig,
    settings: {
      ...entry.worldConfig.settings,
      redstoneArchive: {
        ...entry.worldConfig.settings?.redstoneArchive,
        enabled: true,
        replayUrl: entry.replayUrl,
      },
    },
  }
}
