// Static per-world thumbnails captured by scripts/capture-world-thumbnails.mjs.
// Files live in public/thumbnails/<space>/<routeId>.webp and are listed in
// public/thumbnails/manifest.json as { "<space>/<routeId>": { "file": "...", "updatedAt": <ms> } }.
//
// Lookup order for a card image: admin-uploaded thumbnailDataUrl → static capture → generated SVG.
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'

let manifestPromise = null

export function loadThumbnailManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(resolvePublicAssetUrl('thumbnails/manifest.json'), { cache: 'no-cache' })
      .then(res => (res.ok ? res.json() : {}))
      .catch(() => ({}))
      .then(json => (json && typeof json === 'object' ? json : {}))
  }
  return manifestPromise
}

// Returns the static thumbnail URL for a world, or '' when none was captured.
export function getStaticThumbnailUrl(manifest, space, routeId) {
  const key = `${String(space || '').trim().toLowerCase()}/${String(routeId || '').trim()}`
  const entry = manifest?.[key]
  if (!entry?.file) {
    return ''
  }
  const version = entry.updatedAt ? `?v=${entry.updatedAt}` : ''
  return `${resolvePublicAssetUrl(`thumbnails/${entry.file}`)}${version}`
}
