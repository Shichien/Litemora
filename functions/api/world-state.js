import {
  DEFAULT_WORLD_STATE,
  getKv,
  getScopedKey,
  getSpaceName,
  normalizeWorldStatePayload,
  readSpaceJson,
  sendError,
  sendJson,
  writeSpaceJson,
} from './_space.js'

export async function onRequestGet(context) {
  try {
    const spaceName = getSpaceName(context.request)
    const kv = getKv(context.env)
    const key = getScopedKey('world-state', spaceName)
    const fallback = {
      ...DEFAULT_WORLD_STATE,
      worldState: {
        schematicOnlyMode: !!spaceName,
      },
    }

    const payload = await readSpaceJson(kv, key, fallback)
    return sendJson(200, payload)
  }
  catch (error) {
    return sendError(500, 'world_state_read_failed', error?.message || 'unknown_error')
  }
}

export async function onRequestPost(context) {
  try {
    const rawPayload = await context.request.json().catch(() => null)
    if (!rawPayload || typeof rawPayload !== 'object') {
      return sendError(400, 'invalid_world_state_payload')
    }

    const spaceName = getSpaceName(context.request)
    const kv = getKv(context.env)
    const key = getScopedKey('world-state', spaceName)
    const payload = normalizeWorldStatePayload(rawPayload, spaceName)

    await writeSpaceJson(kv, key, payload)
    return sendJson(200, { ok: true })
  }
  catch (error) {
    if (String(error?.message || '') === 'missing_kv_binding') {
      return sendError(500, 'missing_kv_binding', 'Please bind LITEMORA_SPACE_KV in Cloudflare Pages settings')
    }
    return sendError(500, 'world_state_write_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
