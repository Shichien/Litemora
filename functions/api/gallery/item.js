import { readAccountSession } from '../auth/_shared.js'
import {
  canManageGallery,
  deleteGalleryKey,
  galleryItemKey,
  galleryManifestKey,
  galleryProfileKey,
  loadGalleryState,
  publicGalleryItems,
  readGalleryJson,
  sendError,
  sendJson,
  writeGalleryJson,
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

    const item = await readGalleryJson(state.kv, galleryItemKey(state.spaceName, itemId), null)
    if (!item) {
      return sendError(404, 'gallery_item_not_found')
    }

    const viewer = await readAccountSession(context.request, context.env)
    const canManage = canManageGallery(viewer, state.profile)
    if (item.visibility === 'private' && !canManage) {
      return sendError(404, 'gallery_item_not_found')
    }

    return sendJson(200, {
      item: {
        ...item,
        sourceFile: item.visibility === 'public' || canManage ? item.sourceFile : undefined,
      },
      viewer: {
        authenticated: !!viewer,
        account: viewer,
        canManage,
      },
    })
  }
  catch (error) {
    return sendError(500, 'gallery_item_read_failed', error?.message || 'unknown_error')
  }
}

export async function onRequestDelete(context) {
  try {
    const state = await loadGalleryState(context)
    if (state.response) {
      return state.response
    }

    const viewer = await readAccountSession(context.request, context.env)
    if (!canManageGallery(viewer, state.profile)) {
      return sendError(403, 'gallery_delete_forbidden', 'Only the gallery owner can delete builds')
    }

    const itemId = getRequestedItemId(context.request)
    if (!itemId) {
      return sendError(400, 'missing_item_id', 'A gallery item id is required')
    }

    const manifest = state.manifest || {
      items: [],
    }
    const nextItems = publicGalleryItems({
      items: manifest.items.filter(item => item?.id !== itemId),
    }, state.profile, viewer)

    const nextManifest = {
      ...manifest,
      updatedAt: Date.now(),
      items: manifest.items.filter(item => item?.id !== itemId),
    }
    const nextProfile = state.profile
      ? {
          ...state.profile,
          itemCount: nextManifest.items.length,
          updatedAt: Date.now(),
        }
      : null

    await deleteGalleryKey(state.kv, galleryItemKey(state.spaceName, itemId))
    await writeGalleryJson(state.kv, galleryManifestKey(state.spaceName), nextManifest)
    if (nextProfile) {
      await writeGalleryJson(state.kv, galleryProfileKey(state.spaceName), nextProfile)
    }

    return sendJson(200, {
      ok: true,
      items: nextItems,
      profile: nextProfile,
    })
  }
  catch (error) {
    return sendError(500, 'gallery_item_delete_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
