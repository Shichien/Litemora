import { resolvePublicAssetUrl } from '../utils/public-asset-url.js'

export const THUMBNAIL_SKIES = ['noon', 'sunset', 'end-void', 'dawn', 'moonrise', 'overworld-void']

export function normalizeThumbnailSky(value) {
  return THUMBNAIL_SKIES.includes(value) ? value : ''
}

export function thumbnailSkyImage(value) {
  if (normalizeThumbnailSky(value))
    return `url("${resolvePublicAssetUrl(`homepage/skies/${value}.webp`)}")`
}
