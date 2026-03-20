import { parseJsonBody } from '../auth/_shared.js'
import {
  createGalleryManifest,
  createGalleryProfile,
  galleryManifestKey,
  galleryProfileKey,
  hasLegacyGalleryContent,
  loadGalleryState,
  requireGalleryAccount,
  sendError,
  sendJson,
  updateGalleryProfile,
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

    if (hasLegacyGalleryContent(state.profile, state.manifest)) {
      return sendError(
        409,
        'gallery_legacy_claim_blocked',
        'This gallery space contains legacy content and cannot be claimed automatically',
      )
    }

    if (state.profile && state.profile.ownerAccountId !== auth.account.id) {
      return sendError(409, 'gallery_already_claimed', 'This gallery space is already owned by another account')
    }

    const profile = state.profile
      ? updateGalleryProfile(state.profile, auth.account, body)
      : createGalleryProfile(state.spaceName, auth.account, body)

    const manifest = state.manifest || createGalleryManifest(state.spaceName, profile)

    await writeGalleryJson(state.kv, galleryProfileKey(state.spaceName), profile)
    await writeGalleryJson(state.kv, galleryManifestKey(state.spaceName), manifest)

    return sendJson(200, {
      ok: true,
      profile,
    })
  }
  catch (error) {
    return sendError(500, 'gallery_claim_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
