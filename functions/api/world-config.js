import {
  DEFAULT_WORLD_CONFIG,
  getProjectionId,
  getKv,
  getScopedKey,
  getSpaceName,
  readSpaceJson,
  sendError,
  sendJson,
  writeSpaceJson,
} from './_space.js'

export async function onRequestGet(context) {
  try {
    const spaceName = getSpaceName(context.request)
    const projectionId = getProjectionId(context.request)
    const kv = getKv(context.env)
    const key = getScopedKey('world-config', spaceName, projectionId)
    const storedConfig = await readSpaceJson(kv, key, null)
    const config = storedConfig && typeof storedConfig === 'object'
      ? storedConfig
      : DEFAULT_WORLD_CONFIG
    return sendJson(200, {
      ...config,
      __meta: {
        exists: !!storedConfig,
        projection: projectionId || '',
      },
    })
  }
  catch (error) {
    return sendError(500, 'world_config_read_failed', error?.message || 'unknown_error')
  }
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return sendError(400, 'invalid_world_config_payload')
    }

    const spaceName = getSpaceName(context.request)
    const projectionId = getProjectionId(context.request)
    const kv = getKv(context.env)
    const key = getScopedKey('world-config', spaceName, projectionId)

    await writeSpaceJson(kv, key, payload)
    return sendJson(200, { ok: true })
  }
  catch (error) {
    if (String(error?.message || '') === 'missing_kv_binding') {
      return sendError(500, 'missing_kv_binding', 'Please bind LITEMORA_SPACE_KV in Cloudflare Pages settings')
    }
    return sendError(500, 'world_config_write_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
