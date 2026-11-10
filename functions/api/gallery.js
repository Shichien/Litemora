import { availableBuiltinEntries, loadBuiltinReadState } from './gallery/_builtin.js'
import { readAccountSession } from './auth/_shared.js'
import {
  canManageGallery,
  hasLegacyGalleryContent,
  publicGalleryItems,
  sendError,
  sendJson,
} from './gallery/_shared.js'

export async function onRequestGet(context) {
  try {
    const viewerAccount = await readAccountSession(context.request, context.env)

    const state = await loadBuiltinReadState(context)
    if (state.response) {
      return state.response
    }

    const profile = state.profile
    const manifest = state.manifest
    const builtins = await availableBuiltinEntries(context, state)
    const items = [...publicGalleryItems(manifest, profile, viewerAccount), ...builtins.map(entry => entry.item)]

    return sendJson(200, {
      space: state.spaceName,
      profile,
      items,
      legacyContent: hasLegacyGalleryContent(profile, manifest),
      spaceExists: !!profile || items.length > 0,
      viewer: {
        authenticated: !!viewerAccount,
        account: viewerAccount,
        canManage: canManageGallery(viewerAccount, profile),
      },
    })
  }
  catch (error) {
    return sendError(500, 'gallery_read_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
