import { parseJsonBody } from '../auth/_shared.js'
import {
  buildGalleryItemPayload,
  buildGalleryItemSummary,
  canManageGallery,
  createGalleryItemId,
  createGalleryManifest,
  createGalleryProfile,
  decodeBase64ToUint8Array,
  galleryItemKey,
  galleryManifestHasProjectionName,
  galleryManifestKey,
  galleryProfileKey,
  gallerySourceKey,
  loadGalleryState,
  normalizeFilePayload,
  normalizeSourceFileMetadata,
  requireGalleryAccount,
  sendError,
  sendJson,
  writeGalleryJson,
} from './_shared.js'

function parseJsonField(value, fallbackValue = null) {
  if (typeof value !== 'string') {
    return fallbackValue
  }

  try {
    return JSON.parse(value)
  }
  catch {
    return fallbackValue
  }
}

async function readCreateRequestPayload(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file')
    const uploadFile = file && typeof file.arrayBuffer === 'function' ? file : null

    return {
      body: {
        space: formData.get('space'),
        title: formData.get('title'),
        description: formData.get('description'),
        projectionName: formData.get('projectionName'),
        visibility: formData.get('visibility'),
        thumbnailDataUrl: formData.get('thumbnailDataUrl'),
        schematic: parseJsonField(formData.get('schematic'), null),
        previewModel: parseJsonField(formData.get('previewModel'), null),
        placement: parseJsonField(formData.get('placement'), null),
        fileName: uploadFile?.name || formData.get('fileName'),
        mimeType: uploadFile?.type || formData.get('mimeType'),
        fileSize: Number(uploadFile?.size || 0),
      },
      uploadFile,
    }
  }

  return {
    body: await parseJsonBody(request),
    uploadFile: null,
  }
}

async function readSourceUpload(body = {}, uploadFile = null) {
  if (uploadFile) {
    const buffer = await uploadFile.arrayBuffer()
    return {
      sourceFile: normalizeSourceFileMetadata({
        fileName: uploadFile.name || body?.fileName,
        mimeType: uploadFile.type || body?.mimeType,
        size: buffer.byteLength,
      }),
      sourceBuffer: buffer,
    }
  }

  const legacyFile = normalizeFilePayload(body)
  const bytes = decodeBase64ToUint8Array(legacyFile.fileBase64)

  return {
    sourceFile: normalizeSourceFileMetadata({
      fileName: legacyFile.fileName,
      mimeType: legacyFile.mimeType,
      size: bytes.byteLength,
    }),
    sourceBuffer: bytes.buffer,
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await requireGalleryAccount(context)
    if (auth.response) {
      return auth.response
    }

    const { body, uploadFile } = await readCreateRequestPayload(context.request)
    const state = await loadGalleryState(context, body)
    if (state.response) {
      return state.response
    }

    let profile = state.profile
    if (!profile) {
      profile = createGalleryProfile(state.spaceName, auth.account, body)
      await writeGalleryJson(state.kv, galleryProfileKey(state.spaceName), profile)
    }

    if (!canManageGallery(auth.account, profile)) {
      return sendError(403, 'gallery_write_forbidden', 'Only the owner of this gallery can upload builds')
    }

    const manifest = state.manifest || createGalleryManifest(state.spaceName, profile)
    const itemId = createGalleryItemId()
    const { sourceFile, sourceBuffer } = await readSourceUpload(body, uploadFile)
    const item = buildGalleryItemPayload({
      body,
      account: auth.account,
      profile,
      spaceName: state.spaceName,
      itemId,
      sourceFile,
    })
    if (galleryManifestHasProjectionName(manifest, item.projectionSlug)) {
      return sendError(409, 'projection_name_exists', 'A projection with the same name already exists in this space')
    }
    const summary = buildGalleryItemSummary(item)

    const nextItems = [
      summary,
      ...manifest.items.filter(entry => entry?.id !== itemId),
    ].sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))

    const nextManifest = {
      ...manifest,
      ownerAccountId: profile.ownerAccountId,
      updatedAt: Date.now(),
      items: nextItems,
    }

    const nextProfile = {
      ...profile,
      itemCount: nextItems.length,
      updatedAt: Date.now(),
    }

    await writeGalleryJson(state.kv, galleryItemKey(state.spaceName, itemId), item)
    await state.kv.put(gallerySourceKey(state.spaceName, itemId), sourceBuffer)
    await writeGalleryJson(state.kv, galleryManifestKey(state.spaceName), nextManifest)
    await writeGalleryJson(state.kv, galleryProfileKey(state.spaceName), nextProfile)

    return sendJson(200, {
      ok: true,
      item: summary,
      profile: nextProfile,
    })
  }
  catch (error) {
    if (error?.message === 'projection_name_exists') {
      return sendError(409, 'projection_name_exists', 'A projection with the same name already exists in this space')
    }
    if (error?.message === 'missing_file_base64') {
      return sendError(400, 'missing_file_base64', 'The uploaded schematic file data is required')
    }
    if (error?.message === 'file_too_large_for_kv') {
      return sendError(413, 'file_too_large', 'The current gallery storage can only accept files up to roughly 15 MB raw size')
    }
    return sendError(500, 'gallery_item_create_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
