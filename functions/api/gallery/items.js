import { parseJsonBody } from '../auth/_shared.js'
import {
  buildGalleryItemPayload,
  buildGalleryItemSummary,
  canManageGallery,
  createGalleryItemId,
  createGalleryManifest,
  createGalleryProfile,
  galleryItemKey,
  galleryManifestKey,
  galleryProfileKey,
  loadGalleryState,
  requireGalleryAccount,
  sendError,
  sendJson,
  writeGalleryJson,
} from './_shared.js'

export async function onRequestPost(context) {
  try {
    const auth = await requireGalleryAccount(context)
    if (auth.response) {
      return auth.response
    }

    const body = await parseJsonBody(context.request)
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
    const item = buildGalleryItemPayload({
      body,
      account: auth.account,
      profile,
      spaceName: state.spaceName,
      itemId,
    })
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
    await writeGalleryJson(state.kv, galleryManifestKey(state.spaceName), nextManifest)
    await writeGalleryJson(state.kv, galleryProfileKey(state.spaceName), nextProfile)

    return sendJson(200, {
      ok: true,
      item: summary,
      profile: nextProfile,
    })
  }
  catch (error) {
    if (error?.message === 'missing_file_base64') {
      return sendError(400, 'missing_file_base64', 'The uploaded .litematic file data is required')
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
