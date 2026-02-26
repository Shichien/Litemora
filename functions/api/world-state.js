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

function chunkStoragePrefix(spaceName) {
  return getScopedKey('world-state-chunk', spaceName)
}

function chunkStorageKey(spaceName, chunkKey) {
  return `${chunkStoragePrefix(spaceName)}:${encodeURIComponent(chunkKey)}`
}

async function readShardedWorldState(kv, manifest, spaceName) {
  const chunkKeys = Array.isArray(manifest?.chunkKeys) ? manifest.chunkKeys : []
  const chunks = {}

  for (const chunkKey of chunkKeys) {
    const key = chunkStorageKey(spaceName, chunkKey)
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

async function deleteStaleShardKeys(kv, spaceName, nextChunkKeys = []) {
  if (!kv) {
    return
  }

  const expected = new Set(nextChunkKeys)
  const prefix = `${chunkStoragePrefix(spaceName)}:`
  let cursor = undefined

  do {
    const listed = await kv.list({ prefix, cursor })
    for (const keyInfo of listed?.keys || []) {
      const rawKey = String(keyInfo?.name || '')
      const encoded = rawKey.slice(prefix.length)
      const decodedChunkKey = decodeURIComponent(encoded)
      if (!expected.has(decodedChunkKey)) {
        await kv.delete(rawKey)
      }
    }
    cursor = listed?.list_complete ? undefined : listed?.cursor
  } while (cursor)
}

async function writeShardedWorldState(kv, payload, spaceName) {
  const chunks = payload?.chunks && typeof payload.chunks === 'object' ? payload.chunks : {}
  const chunkKeys = Object.keys(chunks)

  for (const chunkKey of chunkKeys) {
    const key = chunkStorageKey(spaceName, chunkKey)
    await writeSpaceJson(kv, key, chunks[chunkKey])
  }

  await deleteStaleShardKeys(kv, spaceName, chunkKeys)

  const manifest = {
    format: 'chunk-v2-sharded',
    version: 1,
    payloadVersion: Number(payload?.version) || 1,
    chunkWidth: Number(payload?.chunkWidth) || 64,
    worldState: {
      schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
    },
    chunkKeys,
  }

  const manifestKey = getScopedKey('world-state', spaceName)
  await writeSpaceJson(kv, manifestKey, manifest)
}

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

    if (payload?.format === 'chunk-v2-sharded') {
      const reconstructed = await readShardedWorldState(kv, payload, spaceName)
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

    const spaceName = getSpaceName(context.request)
    const kv = getKv(context.env)
    const key = getScopedKey('world-state', spaceName)
    const payload = normalizeWorldStatePayload(rawPayload, spaceName)

    if (payload?.format === 'chunk-v2' && payload?.chunks && typeof payload.chunks === 'object') {
      await writeShardedWorldState(kv, payload, spaceName)
      return sendJson(200, { ok: true, mode: 'sharded' })
    }

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
