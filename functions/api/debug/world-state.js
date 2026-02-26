import {
  getKv,
  getScopedKey,
  getSpaceName,
  readSpaceJson,
  sendError,
  sendJson,
} from '../_space.js'

function countModificationsFromClassic(modifications = {}) {
  let count = 0
  for (const blocks of Object.values(modifications || {})) {
    if (blocks && typeof blocks === 'object') {
      count += Object.keys(blocks).length
    }
  }
  return count
}

function countModificationsFromChunkV2(chunks = {}) {
  let count = 0
  for (const chunk of Object.values(chunks || {})) {
    count += Number(chunk?.c || 0)
  }
  return count
}

function summarizePayload(payload, key, spaceName) {
  const format = payload?.format || 'classic'
  const isChunkV2 = format === 'chunk-v2'
  const chunkCount = isChunkV2
    ? Object.keys(payload?.chunks || {}).length
    : Object.keys(payload?.modifications || {}).length

  const modificationCount = isChunkV2
    ? countModificationsFromChunkV2(payload?.chunks || {})
    : countModificationsFromClassic(payload?.modifications || {})

  return {
    ok: true,
    space: spaceName || 'default',
    key,
    format,
    chunkWidth: Number(payload?.chunkWidth) || null,
    chunkCount,
    modificationCount,
    schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
    payloadBytes: JSON.stringify(payload || {}).length,
    sampleChunkKeys: Object.keys(payload?.chunks || payload?.modifications || {}).slice(0, 8),
  }
}

export async function onRequestGet(context) {
  try {
    const spaceName = getSpaceName(context.request)
    const kv = getKv(context.env)
    const key = getScopedKey('world-state', spaceName)

    if (!kv) {
      return sendJson(200, {
        ok: false,
        space: spaceName || 'default',
        key,
        missingKvBinding: true,
      })
    }

    const payload = await readSpaceJson(kv, key, null)
    if (!payload) {
      return sendJson(200, {
        ok: false,
        space: spaceName || 'default',
        key,
        found: false,
      })
    }

    return sendJson(200, summarizePayload(payload, key, spaceName))
  }
  catch (error) {
    return sendError(500, 'debug_world_state_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
