import { getKv, sendError, sendJson } from '../_space.js'
import { readAccountSession, trimString } from '../auth/_shared.js'

const SPACE_REGEX = /^[a-z0-9-]{3,63}$/
const MAX_TEXT_LENGTH = 4000
const MAX_FILE_BASE64_LENGTH = 20 * 1024 * 1024
const MAX_PREVIEW_BLOCKS = 40000
const MAX_THUMBNAIL_DATA_URL_LENGTH = 1.5 * 1024 * 1024

function toNumber(value, fallback = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function sanitizeText(value, maxLength = 240) {
  return trimString(value).slice(0, maxLength)
}

function sanitizeLongText(value) {
  return sanitizeText(value, MAX_TEXT_LENGTH)
}

function sanitizeThumbnailDataUrl(value = '') {
  const normalized = trimString(value)
  if (!normalized) {
    return ''
  }

  if (normalized.length > MAX_THUMBNAIL_DATA_URL_LENGTH) {
    return ''
  }

  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/iu.test(normalized)) {
    return ''
  }

  return normalized
}

export function normalizeSpaceName(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  return SPACE_REGEX.test(normalized) ? normalized : ''
}

export function getGallerySpaceName(request, body = null) {
  try {
    const url = new URL(request.url)
    const querySpace = normalizeSpaceName(url.searchParams.get('space'))
    if (querySpace) {
      return querySpace
    }
  }
  catch {
    // ignore malformed URL and continue to payload fallback
  }

  return normalizeSpaceName(body?.space)
}

export function galleryProfileKey(spaceName) {
  return `gallery:space:${spaceName}:profile`
}

export function galleryManifestKey(spaceName) {
  return `gallery:space:${spaceName}:manifest`
}

export function galleryItemKey(spaceName, itemId) {
  return `gallery:space:${spaceName}:item:${encodeURIComponent(itemId)}`
}

export async function readGalleryJson(kv, key, fallbackValue = null) {
  if (!kv) {
    return fallbackValue
  }

  const raw = await kv.get(key)
  if (!raw) {
    return fallbackValue
  }

  try {
    return JSON.parse(raw)
  }
  catch {
    return fallbackValue
  }
}

export async function writeGalleryJson(kv, key, value) {
  if (!kv) {
    throw new Error('missing_kv_binding')
  }

  await kv.put(key, JSON.stringify(value))
}

export async function deleteGalleryKey(kv, key) {
  if (!kv) {
    throw new Error('missing_kv_binding')
  }

  await kv.delete(key)
}

export function createGalleryProfile(spaceName, account, input = {}) {
  const now = Date.now()
  return {
    space: spaceName,
    ownerAccountId: trimString(account?.id),
    ownerProvider: trimString(account?.provider),
    ownerName: sanitizeText(input?.displayName || account?.name || account?.email || spaceName, 120),
    ownerAvatar: sanitizeText(account?.avatar, 1024),
    bio: sanitizeLongText(input?.bio),
    createdAt: now,
    updatedAt: now,
    itemCount: 0,
  }
}

export function updateGalleryProfile(profile, account, input = {}) {
  const now = Date.now()
  return {
    ...profile,
    ownerName: sanitizeText(input?.displayName || profile?.ownerName || account?.name || account?.email || profile?.space, 120),
    ownerAvatar: sanitizeText(account?.avatar || profile?.ownerAvatar, 1024),
    bio: sanitizeLongText(input?.bio ?? profile?.bio),
    updatedAt: now,
  }
}

export function createGalleryManifest(spaceName, profile) {
  return {
    space: spaceName,
    ownerAccountId: trimString(profile?.ownerAccountId),
    updatedAt: Date.now(),
    items: [],
  }
}

function normalizeVisibility(value) {
  return value === 'private' ? 'private' : 'public'
}

function normalizeProjectionSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 63)
}

function resolveProjectionSlug(value = '', fallback = '') {
  return normalizeProjectionSlug(value) || normalizeProjectionSlug(fallback)
}

function normalizePlacement(value = null) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const offset = value.offset && typeof value.offset === 'object' ? value.offset : {}
  return {
    offset: {
      x: toNumber(offset.x),
      y: toNumber(offset.y),
      z: toNumber(offset.z),
    },
  }
}

function normalizeBounds(bounds = {}) {
  const min = bounds?.min || {}
  const max = bounds?.max || {}
  return {
    min: {
      x: toNumber(min.x),
      y: toNumber(min.y),
      z: toNumber(min.z),
    },
    max: {
      x: toNumber(max.x),
      y: toNumber(max.y),
      z: toNumber(max.z),
    },
  }
}

function normalizePreviewBlocks(blocks = []) {
  return blocks
    .slice(0, MAX_PREVIEW_BLOCKS)
    .map(block => ({
      x: Math.round(toNumber(block?.x)),
      y: Math.round(toNumber(block?.y)),
      z: Math.round(toNumber(block?.z)),
      id: Math.round(toNumber(block?.id)),
      name: sanitizeText(block?.name, 120),
      geometryType: sanitizeText(block?.geometryType, 64) || 'cube',
      textureName: sanitizeText(block?.textureName, 160),
    }))
}

export function normalizePreviewModel(value = {}) {
  return {
    blocks: normalizePreviewBlocks(Array.isArray(value?.blocks) ? value.blocks : []),
    bounds: normalizeBounds(value?.bounds),
    totalSolidBlocks: Math.max(0, Math.round(toNumber(value?.totalSolidBlocks))),
    sampled: !!value?.sampled,
  }
}

export function normalizeSchematicSummary(value = {}) {
  const size = value?.size || {}
  const yStats = value?.yStats || {}
  return {
    name: sanitizeText(value?.name, 160) || 'Untitled schematic',
    author: sanitizeText(value?.author, 120) || 'Unknown',
    size: {
      x: Math.round(toNumber(size.x)),
      y: Math.round(toNumber(size.y)),
      z: Math.round(toNumber(size.z)),
    },
    regionCount: Math.max(0, Math.round(toNumber(value?.regionCount))),
    blockCount: Math.max(0, Math.round(toNumber(value?.blockCount))),
    yStats: {
      minY: Number.isFinite(Number(yStats?.minY)) ? Math.round(Number(yStats.minY)) : null,
      maxY: Number.isFinite(Number(yStats?.maxY)) ? Math.round(Number(yStats.maxY)) : null,
      hasBlocksBelowZero: !!yStats?.hasBlocksBelowZero,
      blocksBelowZero: Math.max(0, Math.round(toNumber(yStats?.blocksBelowZero))),
    },
  }
}

export function buildGalleryItemSummary(item) {
  return {
    id: trimString(item?.id),
    title: sanitizeText(item?.title, 160),
    projectionSlug: sanitizeText(item?.projectionSlug, 80),
    description: sanitizeLongText(item?.description),
    visibility: normalizeVisibility(item?.visibility),
    fileName: sanitizeText(item?.fileName, 240),
    schematic: normalizeSchematicSummary(item?.schematic),
    placement: normalizePlacement(item?.placement),
    createdAt: Math.round(toNumber(item?.createdAt, Date.now())),
    updatedAt: Math.round(toNumber(item?.updatedAt, Date.now())),
    preview: {
      totalSolidBlocks: Math.max(0, Math.round(toNumber(item?.previewModel?.totalSolidBlocks))),
      sampled: !!item?.previewModel?.sampled,
      bounds: normalizeBounds(item?.previewModel?.bounds),
    },
    thumbnailDataUrl: sanitizeThumbnailDataUrl(item?.thumbnailDataUrl),
  }
}

export function createGalleryItemId() {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

export function canManageGallery(account, profile) {
  return !!account?.id && !!profile?.ownerAccountId && account.id === profile.ownerAccountId
}

export function normalizeFilePayload(body = {}) {
  const fileBase64 = String(body?.fileBase64 || '').trim()
  if (!fileBase64) {
    throw new Error('missing_file_base64')
  }
  if (fileBase64.length > MAX_FILE_BASE64_LENGTH) {
    throw new Error('file_too_large_for_kv')
  }

  return {
    fileName: sanitizeText(body?.fileName, 240) || 'uploaded.schematic',
    mimeType: sanitizeText(body?.mimeType, 120) || 'application/octet-stream',
    fileBase64,
  }
}

export function buildGalleryItemPayload({ body, account, profile, spaceName, itemId }) {
  const now = Date.now()
  const sourceFile = normalizeFilePayload(body)
  const schematic = normalizeSchematicSummary(body?.schematic)
  const previewModel = normalizePreviewModel(body?.previewModel)
  const title = sanitizeText(body?.title, 160) || schematic.name || sourceFile.fileName
  const projectionSlug = resolveProjectionSlug(body?.projectionName, title)

  return {
    id: itemId,
    space: spaceName,
    title,
    projectionSlug,
    description: sanitizeLongText(body?.description),
    visibility: normalizeVisibility(body?.visibility),
    fileName: sourceFile.fileName,
    mimeType: sourceFile.mimeType,
    sourceFile,
    schematic,
    previewModel,
    placement: normalizePlacement(body?.placement),
    thumbnailDataUrl: sanitizeThumbnailDataUrl(body?.thumbnailDataUrl),
    owner: {
      id: trimString(profile?.ownerAccountId || account?.id),
      name: sanitizeText(profile?.ownerName || account?.name || account?.email || spaceName, 120),
      avatar: sanitizeText(account?.avatar || profile?.ownerAvatar, 1024),
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function galleryManifestHasProjectionName(manifest, projectionSlug = '') {
  const normalizedProjectionSlug = normalizeProjectionSlug(projectionSlug)
  if (!normalizedProjectionSlug) {
    return false
  }

  const items = Array.isArray(manifest?.items) ? manifest.items : []
  return items.some((item) => {
    const itemSlug = resolveProjectionSlug(item?.projectionSlug, item?.title)
    return !!itemSlug && itemSlug === normalizedProjectionSlug
  })
}

export async function requireGalleryAccount(context) {
  const account = await readAccountSession(context.request, context.env)
  if (!account) {
    return {
      account: null,
      response: sendError(401, 'authentication_required', 'Please sign in with GitHub or Google first'),
    }
  }

  return { account, response: null }
}

export async function loadGalleryState(context, body = null) {
  const spaceName = getGallerySpaceName(context.request, body)
  if (!spaceName) {
    return {
      spaceName: '',
      kv: null,
      profile: null,
      manifest: null,
      response: sendError(400, 'invalid_space_name', 'A valid gallery space is required'),
    }
  }

  const kv = getKv(context.env)
  if (!kv) {
    return {
      spaceName,
      kv: null,
      profile: null,
      manifest: null,
      response: sendError(500, 'missing_kv_binding', 'Please bind LITEMORA_SPACE_KV in Cloudflare Pages settings'),
    }
  }

  const profile = await readGalleryJson(kv, galleryProfileKey(spaceName), null)
  const manifest = await readGalleryJson(kv, galleryManifestKey(spaceName), null)

  return {
    spaceName,
    kv,
    profile,
    manifest,
    response: null,
  }
}

export function publicGalleryItems(manifest, profile, account = null) {
  const canManage = canManageGallery(account, profile)
  const items = Array.isArray(manifest?.items) ? manifest.items : []
  return items.filter(item => canManage || item?.visibility !== 'private')
}

export { sendError, sendJson }
