const SPACE_REGEX = /^[a-z0-9-]{3,63}$/

export const DEFAULT_WORLD_CONFIG = {
  player: {
    spawnPoint: { x: 32, y: 26, z: 32 },
  },
  settings: {
    cameraPreset: 'default',
    visualPreset: 'default',
    chunk: {
      height: 256,
      viewDistance: 2,
      unloadPadding: 1,
    },
    environment: {
      skyMode: 'DayCycle',
      sunIntensity: 3,
      ambientIntensity: 0.85,
      fogDensity: 0.008,
    },
  },
  scene: {
    modelUrl: '/models/cube/grass.glb',
    position: { x: 32, y: 11, z: 32 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 8, y: 8, z: 8 },
    castShadow: true,
    receiveShadow: true,
  },
  ui: {
    pauseMenu: {
      showMainMenu: false,
      showSettings: false,
      showSkins: true,
    },
    controls: {
      allowFlightToggle: true,
      allowPerspectiveToggle: true,
    },
  },
}

export const DEFAULT_WORLD_STATE = {
  worldState: {
    schematicOnlyMode: false,
  },
  modifications: {},
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export function sendJson(status, payload) {
  return json(status, payload)
}

export function sendError(status, error, details = '') {
  return json(status, {
    error,
    ...(details ? { details } : {}),
  })
}

export function getSpaceName(request) {
  try {
    const url = new URL(request.url)
    const candidate = String(url.searchParams.get('space') || '').trim().toLowerCase()
    return SPACE_REGEX.test(candidate) ? candidate : ''
  }
  catch {
    return ''
  }
}

export function getKv(env) {
  return env?.LITEMORA_SPACE_KV || null
}

export function getScopedKey(type, spaceName = '') {
  const scope = spaceName || 'default'
  return `space:${scope}:${type}`
}

export function normalizeWorldStatePayload(payload, spaceName = '') {
  const modifications = payload?.modifications && typeof payload.modifications === 'object'
    ? payload.modifications
    : {}

  const compactChunks = payload?.chunks && typeof payload.chunks === 'object'
    ? payload.chunks
    : {}

  const compactChunkWidth = Number(payload?.chunkWidth)
  const dynamicPalette = payload?.dynamicPalette && typeof payload.dynamicPalette === 'object'
    ? payload.dynamicPalette
    : null
  const hasCompactChunks = Object.keys(compactChunks).length > 0

  if (payload?.format === 'chunk-v2' && hasCompactChunks) {
    return {
      format: 'chunk-v2',
      version: Number(payload?.version) || 1,
      chunkWidth: Number.isFinite(compactChunkWidth) ? compactChunkWidth : 64,
      worldState: {
        schematicOnlyMode: payload?.worldState?.schematicOnlyMode ?? !!spaceName,
      },
      ...(dynamicPalette ? { dynamicPalette } : {}),
      chunks: compactChunks,
    }
  }

  return {
    worldState: {
      schematicOnlyMode: payload?.worldState?.schematicOnlyMode ?? !!spaceName,
    },
    modifications,
  }
}

export async function readSpaceJson(kv, key, fallbackValue) {
  if (!kv) {
    return fallbackValue
  }

  const raw = await kv.get(key)
  if (!raw) {
    return fallbackValue
  }

  try {
    return JSON.parse(raw)
  }
  catch {
    return fallbackValue
  }
}

export async function writeSpaceJson(kv, key, value) {
  if (!kv) {
    throw new Error('missing_kv_binding')
  }

  await kv.put(key, JSON.stringify(value))
}
