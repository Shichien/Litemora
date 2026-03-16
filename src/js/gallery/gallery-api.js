import { getAdminAuthToken } from '../auth/admin-auth.js'
import {
  claimLocalGallerySpace,
  createLocalGalleryItem,
  deleteLocalGalleryItem,
  fetchLocalGallery,
  fetchLocalGalleryItem,
  isLocalGalleryStoreEnabled,
} from './local-gallery-store.js'

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
    return fetchLocalGallery(spaceName)
  }

  return requestJson(buildApiUrl('/api/gallery', { space: spaceName }), {
    headers: buildHeaders(session),
  })
}

export async function claimGallerySpace({ spaceName, displayName = '', bio = '', session = null }) {
  if (shouldUseLocalGalleryApi()) {
    return claimLocalGallerySpace({
      spaceName,
      displayName,
      bio,
    })
  }

  return requestJson('/api/gallery/claim', {
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
}

export async function createGalleryItem({
  spaceName,
  title = '',
  description = '',
  file,
  schematic,
  previewModel,
  session = null,
}) {
  if (shouldUseLocalGalleryApi()) {
    return createLocalGalleryItem({
      spaceName,
      title,
      description,
      file,
      schematic,
      previewModel,
    })
  }

  const fileBuffer = await file.arrayBuffer()
  return requestJson('/api/gallery/items', {
    method: 'POST',
    headers: buildHeaders(session, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      space: spaceName,
      title,
      description,
      visibility: 'public',
      fileName: file?.name || 'uploaded.litematic',
      mimeType: file?.type || 'application/octet-stream',
      fileBase64: toBase64(fileBuffer),
      schematic,
      previewModel,
    }),
  })
}

export async function fetchGalleryItem(spaceName, itemId, session = null) {
  if (shouldUseLocalGalleryApi()) {
    return fetchLocalGalleryItem(spaceName, itemId)
  }

  return requestJson(buildApiUrl('/api/gallery/item', {
    space: spaceName,
    item: itemId,
  }), {
    headers: buildHeaders(session),
  })
}

export async function deleteGalleryItem(spaceName, itemId, session = null) {
  if (shouldUseLocalGalleryApi()) {
    return deleteLocalGalleryItem(spaceName, itemId)
  }

  return requestJson(buildApiUrl('/api/gallery/item', {
    space: spaceName,
    item: itemId,
  }), {
    method: 'DELETE',
    headers: buildHeaders(session),
  })
}
