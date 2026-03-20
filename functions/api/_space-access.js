import { readAccountSession } from './auth/_shared.js'
import {
  getKv,
  getProjectionId,
  getSpaceName,
  readSpaceJson,
  sendError,
} from './_space.js'

function galleryProfileKey(spaceName = '') {
  return `gallery:space:${spaceName}:profile`
}

export async function requireSpaceWriteAccess(context) {
  const spaceName = getSpaceName(context.request)
  if (!spaceName) {
    return {
      account: null,
      kv: null,
      profile: null,
      projectionId: '',
      response: sendError(400, 'invalid_space_name', 'A valid space is required for world writes'),
      spaceName: '',
    }
  }

  const kv = getKv(context.env)
  if (!kv) {
    return {
      account: null,
      kv: null,
      profile: null,
      projectionId: '',
      response: sendError(500, 'missing_kv_binding', 'Please bind LITEMORA_SPACE_KV in Cloudflare Pages settings'),
      spaceName,
    }
  }

  const account = await readAccountSession(context.request, context.env)
  if (!account) {
    return {
      account: null,
      kv,
      profile: null,
      projectionId: '',
      response: sendError(401, 'authentication_required', 'Please sign in before modifying world data'),
      spaceName,
    }
  }

  const profile = await readSpaceJson(kv, galleryProfileKey(spaceName), null)
  if (!profile?.ownerAccountId || profile.ownerAccountId !== account.id) {
    return {
      account,
      kv,
      profile,
      projectionId: '',
      response: sendError(403, 'world_write_forbidden', 'Only the space owner can modify world data'),
      spaceName,
    }
  }

  return {
    account,
    kv,
    profile,
    projectionId: getProjectionId(context.request),
    response: null,
    spaceName,
  }
}
