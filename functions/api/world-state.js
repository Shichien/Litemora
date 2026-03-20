import {
  DEFAULT_WORLD_STATE,
  getProjectionId,
  getKv,
  getScopedKey,
  getSpaceName,
  normalizeWorldStatePayload,
  readSpaceJson,
  sendError,
  sendJson,
  writeSpaceJson,
} from './_space.js'
import { requireSpaceWriteAccess } from './_space-access.js'

function chunkStoragePrefix(spaceName, projectionId = '') {
  return getScopedKey('world-state-chunk', spaceName, projectionId)
}

function chunkStorageKey(spaceName, projectionId, chunkKey) {
  return `${chunkStoragePrefix(spaceName, projectionId)}:${encodeURIComponent(chunkKey)}`
}

async function readShardedWorldState(kv, manifest, spaceName, projectionId = '') {
  const chunkKeys = Array.isArray(manifest?.chunkKeys) ? manifest.chunkKeys : []
  const chunks = {}

  for (const chunkKey of chunkKeys) {
    const key = chunkStorageKey(spaceName, projectionId, chunkKey)
    const chunkPayload = await readSpaceJson(kv, key, null)
    if (chunkPayload && typeof chunkPayload === 'object') {
      chunks[chunkKey] = chunkPayload
    }
  }

  return {
    format: 'chunk-v2',
    version: Number(manifest?.payloadVersion) || 1,
    chunkWidth: Number(manifest?.chunkWidth) || 64,
    worldState: {
      schematicOnlyMode: !!manifest?.worldState?.schematicOnlyMode,
    },
    chunks,
  }
}

export async function onRequestGet(context) {
  try {
    const spaceName = getSpaceName(context.request)
    const projectionId = getProjectionId(context.request)
    const kv = getKv(context.env)
    const key = getScopedKey('world-state', spaceName, projectionId)
    const fallback = {
      ...DEFAULT_WORLD_STATE,
      worldState: {
        schematicOnlyMode: false,
      },
    }

    const payload = await readSpaceJson(kv, key, fallback)

    if (payload?.format === 'chunk-v2-sharded') {
      const reconstructed = await readShardedWorldState(kv, payload, spaceName, projectionId)
      return sendJson(200, reconstructed)
    }

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

    const access = await requireSpaceWriteAccess(context)
    if (access.response) {
      return access.response
    }

    const { kv, projectionId, spaceName } = access
    const key = getScopedKey('world-state', spaceName, projectionId)
    const payload = normalizeWorldStatePayload(rawPayload, spaceName, projectionId)

    await writeSpaceJson(kv, key, payload)
    return sendJson(200, { ok: true, mode: 'single' })
  }
  catch (error) {
    return sendError(500, 'world_state_write_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
