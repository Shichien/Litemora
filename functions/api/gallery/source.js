import { readAccountSession } from '../auth/_shared.js'
import {
  canManageGallery,
  decodeBase64ToUint8Array,
  gallerySourceKey,
  loadGalleryItemByIdentifier,
  loadGalleryState,
  sendError,
} from './_shared.js'

function getRequestedItemId(request) {
  try {
    const url = new URL(request.url)
    return String(url.searchParams.get('item') || '').trim()
  }
  catch {
    return ''
  }
}

function normalizeDownloadFileName(value = '') {
  const normalized = String(value || '')
    .replace(/[\\/\r\n"]/g, '-')
    .trim()
  return normalized || 'download.schematic'
}

function buildContentDisposition(fileName = '') {
  const normalized = normalizeDownloadFileName(fileName)
  const asciiFallback = normalized.replace(/[^\x20-\x7E]/g, '_') || 'download.schematic'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`
}

function buildSourceResponse(item, buffer) {
  const size = buffer.byteLength || 0
  const fileName = normalizeDownloadFileName(item?.sourceFile?.fileName || item?.fileName || '')
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': buildContentDisposition(fileName),
      'Cache-Control': item?.visibility === 'public'
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'X-Download-Options': 'noopen',
    },
  })
}

export async function onRequestGet(context) {
  try {
    const state = await loadGalleryState(context)
    if (state.response) {
      return state.response
    }

    const itemId = getRequestedItemId(context.request)
    if (!itemId) {
      return sendError(400, 'missing_item_id', 'A gallery item id is required')
    }

    const { item, itemId: resolvedItemId } = await loadGalleryItemByIdentifier(
      state.kv,
      state.spaceName,
      state.manifest,
      itemId,
    )
    if (!item || !resolvedItemId) {
      return sendError(404, 'gallery_item_not_found')
    }

    const viewer = await readAccountSession(context.request, context.env)
    const canManage = canManageGallery(viewer, state.profile)
    if (item.visibility === 'private' && !canManage) {
      return sendError(404, 'gallery_item_not_found')
    }

    const sourceBuffer = await state.kv.get(gallerySourceKey(state.spaceName, resolvedItemId), 'arrayBuffer')
    if (sourceBuffer instanceof ArrayBuffer && sourceBuffer.byteLength > 0) {
      return buildSourceResponse(item, sourceBuffer)
    }

    if (item?.sourceFile?.fileBase64) {
      const legacyBuffer = decodeBase64ToUint8Array(item.sourceFile.fileBase64).buffer
      return buildSourceResponse(item, legacyBuffer)
    }

    return sendError(404, 'gallery_item_source_not_found')
  }
  catch (error) {
    return sendError(500, 'gallery_item_source_read_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
