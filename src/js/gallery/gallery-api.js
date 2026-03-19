import { getAdminAuthToken } from '../auth/admin-auth.js'
import {
  ensureProjectionDisplayName,
  normalizeProjectionSlug,
} from '../utils/projection-name.js'
import {
  claimLocalGallerySpace,
  createLocalGalleryItem,
  deleteLocalGalleryItem,
  fetchLocalGallery,
  fetchLocalGalleryItem,
  isLocalGalleryStoreEnabled,
} from './local-gallery-store.js'

const PROJECTION_CACHE_PREFIX = 'mc-projection-cache'

function buildApiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return `${url.pathname}${url.search}`
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function buildHeaders(session = null, extraHeaders = {}) {
  const token = getAdminAuthToken(session)
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  }
}

function emitGalleryChanged(detail = {}) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent('gallery:changed', {
    detail: {
      ...detail,
      timestamp: Date.now(),
    },
  }))
}

function normalizeProjectionIdentifier(value = '') {
  return String(value || '').trim().toLowerCase()
}

function normalizeProjectionVisibility(value = '') {
  return String(value || '').trim().toLowerCase() === 'private' ? 'private' : 'public'
}

function getProjectionIdentity(item = null) {
  const slug = normalizeProjectionIdentifier(item?.projectionSlug)
  if (slug) {
    return `slug:${slug}`
  }

  const id = normalizeProjectionIdentifier(item?.id)
  if (id) {
    return `id:${id}`
  }

  return ''
}

function buildProjectionPreview({
  item = null,
  preview = null,
  previewModel = null,
  schematic = null,
} = {}) {
  const safePreview = preview && typeof preview === 'object'
    ? preview
    : (item?.preview && typeof item.preview === 'object' ? item.preview : null)
  const safePreviewModel = previewModel && typeof previewModel === 'object'
    ? previewModel
    : (item?.previewModel && typeof item.previewModel === 'object' ? item.previewModel : null)
  const safeSchematic = schematic && typeof schematic === 'object'
    ? schematic
    : (item?.schematic && typeof item.schematic === 'object' ? item.schematic : null)

  const bounds = safePreview?.bounds || safePreviewModel?.bounds || safeSchematic?.bounds || null
  const totalSolidBlocks = Number(
    safePreview?.totalSolidBlocks
    || safePreviewModel?.totalSolidBlocks
    || safeSchematic?.blockCount
    || 0,
  )

  return {
    totalSolidBlocks,
    sampled: Boolean(
      safePreview?.sampled
      ?? safePreviewModel?.sampled
      ?? (bounds && totalSolidBlocks > 0),
    ),
    bounds,
  }
}

function normalizeProjectionItemIdentifier(identifier = null) {
  if (identifier && typeof identifier === 'object') {
    const id = String(identifier.id || '').trim()
    const projectionSlug = String(identifier.projectionSlug || '').trim()
    return {
      itemId: id || projectionSlug,
      item: identifier,
    }
  }

  return {
    itemId: String(identifier || '').trim(),
    item: null,
  }
}

function buildProjectionListItem(item = null) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const preview = buildProjectionPreview({ item })
  return {
    id: String(item.id || '').trim(),
    title: String(item.title || item.schematic?.name || item.sourceFile?.fileName || 'World').trim(),
    projectionSlug: String(item.projectionSlug || '').trim(),
    description: String(item.description || '').trim(),
    visibility: String(item.visibility || 'public').trim(),
    fileName: String(item.fileName || item.sourceFile?.fileName || '').trim(),
    schematic: item.schematic || null,
    placement: item.placement || null,
    preview,
    thumbnailDataUrl: String(item.thumbnailDataUrl || '').trim(),
    createdAt: Number(item.createdAt || 0),
    updatedAt: Number(item.updatedAt || 0),
    localOnly: !!item.localOnly,
  }
}

function getProjectionCacheKeys(spaceName = '', identifier = '') {
  const normalizedSpace = normalizeProjectionIdentifier(spaceName)
  const normalizedIdentifier = normalizeProjectionIdentifier(identifier)
  if (!normalizedSpace || !normalizedIdentifier) {
    return []
  }

  return [
    `${PROJECTION_CACHE_PREFIX}:space:${encodeURIComponent(normalizedSpace)}:projection:${encodeURIComponent(normalizedIdentifier)}`,
  ]
}

function saveProjectionCache(spaceName = '', item = null) {
  if (typeof window === 'undefined' || !item) {
    return
  }

  const identifiers = [item?.id, item?.projectionSlug]
    .map(value => normalizeProjectionIdentifier(value))
    .filter(Boolean)

  if (!identifiers.length) {
    return
  }

  const payload = {
    item,
    updatedAt: Date.now(),
  }

  for (const identifier of identifiers) {
    for (const cacheKey of getProjectionCacheKeys(spaceName, identifier)) {
      localStorage.setItem(cacheKey, JSON.stringify(payload))
    }
  }
}

function readProjectionCache(spaceName = '', identifier = '') {
  if (typeof window === 'undefined') {
    return null
  }

  for (const cacheKey of getProjectionCacheKeys(spaceName, identifier)) {
    try {
      const raw = localStorage.getItem(cacheKey)
      if (!raw) {
        continue
      }

      const parsed = JSON.parse(raw)
      if (parsed?.item) {
        return parsed.item
      }
    }
    catch {
      // ignore malformed cache and continue
    }
  }

  return null
}

function removeProjectionCache(spaceName = '', identifier = '') {
  if (typeof window === 'undefined') {
    return
  }

  const cachedItem = typeof identifier === 'string'
    ? readProjectionCache(spaceName, identifier)
    : null
  const identifiers = [
    typeof identifier === 'string' ? identifier : '',
    typeof identifier === 'object' ? identifier?.id : '',
    typeof identifier === 'object' ? identifier?.projectionSlug : '',
    cachedItem?.id,
    cachedItem?.projectionSlug,
  ]
    .map(value => normalizeProjectionIdentifier(value))
    .filter(Boolean)

  const deduped = [...new Set(identifiers)]
  for (const id of deduped) {
    for (const cacheKey of getProjectionCacheKeys(spaceName, id)) {
      localStorage.removeItem(cacheKey)
    }
  }
}

function listProjectionCacheItems(spaceName = '') {
  if (typeof window === 'undefined') {
    return []
  }

  const normalizedSpace = normalizeProjectionIdentifier(spaceName)
  if (!normalizedSpace) {
    return []
  }

  const prefix = `${PROJECTION_CACHE_PREFIX}:space:${encodeURIComponent(normalizedSpace)}:projection:`
  const entries = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key || !key.startsWith(prefix)) {
      continue
    }

    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null')
      if (!parsed?.item) {
        continue
      }
      entries.push(parsed.item)
    }
    catch {
      // ignore malformed cache entry
    }
  }

  const deduped = []
  const seen = new Set()
  for (const entry of entries) {
    const cacheKey = getProjectionIdentity(entry)

    if (!cacheKey || seen.has(cacheKey)) {
      continue
    }

    seen.add(cacheKey)
    const summary = buildProjectionListItem(entry)
    if (summary?.id || summary?.projectionSlug) {
      deduped.push(summary)
    }
  }

  return deduped.sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
}

function mergeProjectionLists(primaryItems = [], cachedItems = []) {
  const merged = []
  const seen = new Set()

  for (const item of [...primaryItems, ...cachedItems]) {
    const summary = buildProjectionListItem(item)
    if (!summary) {
      continue
    }

    const dedupeKey = getProjectionIdentity(summary)

    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    merged.push(summary)
  }

  return merged.sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
}

function buildProjectionCacheItem({
  spaceName,
  item,
  title = '',
  description = '',
  schematic = null,
  previewModel = null,
  placement = null,
  visibility = 'public',
  thumbnailDataUrl = '',
  fileName = '',
  mimeType = '',
  fileBase64 = '',
}) {
  const safeItem = item && typeof item === 'object' ? item : {}
  return {
    ...safeItem,
    id: String(safeItem.id || '').trim(),
    projectionSlug: String(safeItem.projectionSlug || '').trim(),
    space: String(spaceName || safeItem.space || '').trim(),
    title: String(safeItem.title || title || schematic?.name || fileName || 'World').trim(),
    description: String(safeItem.description || description || '').trim(),
    visibility: normalizeProjectionVisibility(safeItem.visibility || visibility),
    schematic: safeItem.schematic || schematic || null,
    placement: safeItem.placement || placement || null,
    preview: buildProjectionPreview({
      item: safeItem,
      preview: safeItem.preview,
      previewModel,
      schematic,
    }),
    thumbnailDataUrl: String(safeItem.thumbnailDataUrl || thumbnailDataUrl || '').trim(),
    previewModel: safeItem.previewModel || previewModel || null,
    sourceFile: safeItem.sourceFile || {
      fileName: String(fileName || safeItem.fileName || 'uploaded.schematic').trim(),
      mimeType: String(mimeType || safeItem.mimeType || 'application/octet-stream').trim(),
      fileBase64: String(fileBase64 || '').trim(),
    },
  }
}

function normalizeProjectionNameCandidate(projectionName = '', title = '', schematic = null, file = null) {
  const displayName = ensureProjectionDisplayName(
    projectionName || title || schematic?.name || file?.name || '',
    'World',
  )
  return normalizeProjectionSlug(displayName)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const contentType = String(response.headers.get('Content-Type') || '').toLowerCase()
  const rawText = await response.text()
  let payload = null
  if (rawText) {
    try {
      payload = JSON.parse(rawText)
    }
    catch {
      payload = null
    }
  }

  if (!response.ok) {
    throw new Error(payload?.details || payload?.error || 'request_failed')
  }

  if (!contentType.includes('application/json')) {
    throw new Error('当前本地 dev 没有跑起 /api Functions，请使用带 Pages Functions 的服务端环境')
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('API 返回了空响应，当前环境无法读取投影数据')
  }

  return payload
}

function shouldUseLocalGalleryApi() {
  return isLocalGalleryStoreEnabled()
}

export async function fetchGallery(spaceName, session = null) {
  if (shouldUseLocalGalleryApi()) {
    const payload = await fetchLocalGallery(spaceName)
    return {
      ...payload,
      items: mergeProjectionLists(
        Array.isArray(payload?.items) ? payload.items : [],
        listProjectionCacheItems(spaceName),
      ),
    }
  }

  return requestJson(buildApiUrl('/api/gallery', { space: spaceName }), {
    headers: buildHeaders(session),
  })
}

export async function checkSpaceNameAvailability(spaceName, session = null) {
  const normalizedSpaceName = String(spaceName || '').trim().toLowerCase()
  if (!normalizedSpaceName) {
    return {
      available: false,
      reason: 'invalid_space_name',
    }
  }

  try {
    const galleryPayload = await fetchGallery(normalizedSpaceName, session)
    if (galleryPayload?.profile) {
      return {
        available: false,
        reason: 'already_claimed',
      }
    }
  }
  catch {
    // ignore gallery lookup failures and continue with static asset check
  }

  try {
    const staticResponse = await fetch(`/spaces/${encodeURIComponent(normalizedSpaceName)}/world-config.json`, {
      method: 'GET',
      cache: 'no-store',
    })
    const contentType = String(staticResponse.headers.get('content-type') || '').toLowerCase()
    if (staticResponse.ok && contentType.includes('application/json')) {
      return {
        available: false,
        reason: 'static_space_exists',
      }
    }
  }
  catch {
    // ignore network failures and fall back to optimistic availability
  }

  return {
    available: true,
    reason: '',
  }
}

export async function claimGallerySpace({ spaceName, displayName = '', bio = '', session = null }) {
  const payload = shouldUseLocalGalleryApi()
    ? await claimLocalGallerySpace({
      spaceName,
      displayName,
      bio,
    })
    : await requestJson('/api/gallery/claim', {
      method: 'POST',
      headers: buildHeaders(session, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        space: spaceName,
        displayName,
        bio,
      }),
    })

  emitGalleryChanged({
    type: 'claim',
    spaceName,
  })

  return payload
}

export async function checkProjectionNameAvailability(spaceName, projectionName, session = null) {
  const candidateSlug = normalizeProjectionNameCandidate(projectionName)
  if (!candidateSlug) {
    return {
      available: false,
      reason: 'invalid_projection_name',
    }
  }

  try {
    const payload = await fetchGallery(spaceName, session)
    const items = Array.isArray(payload?.items) ? payload.items : []
    const duplicate = items.some((item) => {
      const itemSlug = normalizeProjectionNameCandidate(item?.projectionSlug || item?.title || '')
      return !!itemSlug && itemSlug === candidateSlug
    })
    return {
      available: !duplicate,
      reason: duplicate ? 'projection_name_exists' : '',
    }
  }
  catch {
    return {
      available: true,
      reason: '',
    }
  }
}

export async function createGalleryItem({
  spaceName,
  title = '',
  description = '',
  file,
  schematic,
  previewModel,
  placement = null,
  visibility = 'public',
  thumbnailDataUrl = '',
  projectionName = '',
  session = null,
}) {
  const projectionSlug = normalizeProjectionNameCandidate(projectionName, title, schematic, file)
  if (!projectionSlug) {
    throw new Error('invalid_projection_name')
  }

  const fileBuffer = await file.arrayBuffer()
  const fileBase64 = toBase64(fileBuffer)

  const payload = shouldUseLocalGalleryApi()
    ? await createLocalGalleryItem({
      spaceName,
      title,
      description,
      file,
      schematic,
      previewModel,
      placement,
      visibility,
      thumbnailDataUrl,
      projectionName,
    })
    : await (async () => {
      return requestJson('/api/gallery/items', {
        method: 'POST',
        headers: buildHeaders(session, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          space: spaceName,
          title,
          description,
          projectionName,
          visibility,
          fileName: file?.name || 'uploaded.schematic',
          mimeType: file?.type || 'application/octet-stream',
          fileBase64,
          schematic,
          previewModel,
          placement,
          thumbnailDataUrl,
        }),
      })
    })()

  saveProjectionCache(spaceName, buildProjectionCacheItem({
    spaceName,
    item: payload?.item || null,
    title,
    description,
    schematic,
    previewModel,
    placement,
    visibility,
    thumbnailDataUrl,
    fileName: file?.name || 'uploaded.schematic',
    mimeType: file?.type || 'application/octet-stream',
    fileBase64,
  }))

  emitGalleryChanged({
    type: 'create',
    spaceName,
    item: payload?.item || null,
  })

  return payload
}

export async function fetchGalleryItem(spaceName, itemId, session = null) {
  if (shouldUseLocalGalleryApi()) {
    try {
      return await fetchLocalGalleryItem(spaceName, itemId)
    }
    catch (error) {
      const cachedItem = readProjectionCache(spaceName, itemId)
      if (cachedItem) {
        return {
          item: cachedItem,
          profile: null,
          viewer: null,
          cached: true,
        }
      }
      throw error
    }
  }

  return requestJson(buildApiUrl('/api/gallery/item', {
    space: spaceName,
    item: itemId,
  }), {
    headers: buildHeaders(session),
  })
}

export async function deleteGalleryItem(spaceName, identifier, session = null) {
  const { itemId, item } = normalizeProjectionItemIdentifier(identifier)
  const cachedItem = item || readProjectionCache(spaceName, itemId)
  const payload = shouldUseLocalGalleryApi()
    ? await deleteLocalGalleryItem(spaceName, itemId)
    : await requestJson(buildApiUrl('/api/gallery/item', {
      space: spaceName,
      item: itemId,
    }), {
      method: 'DELETE',
      headers: buildHeaders(session),
    })

  emitGalleryChanged({
    type: 'delete',
    spaceName,
    itemId,
  })

  removeProjectionCache(spaceName, cachedItem || itemId)

  return payload
}
