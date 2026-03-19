import { buildSpaceScopedKey, getActiveProjectionId, getActiveSpaceName } from '../utils/space-context.js'

const BACKEND_CONFIG_URLS = [
  '/api/world-config',
  '/world-config.json',
]

const ADMIN_WORLD_CONFIG_STORAGE_KEY = 'mc-admin-world-config'

function resolveScopedRouteOptions(options = {}) {
  return {
    spaceName: String(options.spaceName || getActiveSpaceName() || '').trim(),
    projectionId: String(options.projectionId || getActiveProjectionId() || '').trim(),
  }
}

function buildWorldConfigRequestUrl(baseUrl, options = {}) {
  const { spaceName, projectionId } = resolveScopedRouteOptions(options)
  const url = new URL(baseUrl, window.location.origin)
  if (spaceName) {
    url.searchParams.set('space', spaceName)
  }
  if (projectionId) {
    url.searchParams.set('projection', projectionId)
  }
  return `${url.pathname}${url.search}`
}

function buildAdminWorldConfigStorageKey(accountId = '', options = {}) {
  const { spaceName, projectionId } = resolveScopedRouteOptions(options)

  if (spaceName) {
    return buildSpaceScopedKey(ADMIN_WORLD_CONFIG_STORAGE_KEY, spaceName, projectionId)
  }

  const normalizedId = String(accountId || '').trim()
  if (!normalizedId) {
    return ADMIN_WORLD_CONFIG_STORAGE_KEY
  }

  return `${ADMIN_WORLD_CONFIG_STORAGE_KEY}:account:${encodeURIComponent(normalizedId)}`
}

const DEFAULT_BACKEND_WORLD_CONFIG = {
  player: {
    spawnPoint: { x: 32, y: 20, z: 32 },
    flight: {
      ignoreMiningSlowdown: true,
      groundWalkAnimationWhenMoving: true,
    },
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
      ambientIntensity: 0.75,
      fogDensity: 0.01,
      timeOfDay: 0.25,
      timeAutoPlay: true,
    },
  },
  ui: {
    pauseMenu: {
      showSettings: false,
      showSkins: true,
    },
    controls: {
      allowFlightToggle: true,
      allowPerspectiveToggle: true,
    },
  },
}

function toNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function toInt(value, fallback) {
  return Math.round(toNumber(value, fallback))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function mergeBackendConfig(raw = {}) {
  const player = raw.player || {}
  const settings = raw.settings || {}
  const ui = raw.ui || {}

  return {
    ...DEFAULT_BACKEND_WORLD_CONFIG,
    player: {
      ...DEFAULT_BACKEND_WORLD_CONFIG.player,
      spawnPoint: {
        x: toNumber(player.spawnPoint?.x, DEFAULT_BACKEND_WORLD_CONFIG.player.spawnPoint.x),
        y: toNumber(player.spawnPoint?.y, DEFAULT_BACKEND_WORLD_CONFIG.player.spawnPoint.y),
        z: toNumber(player.spawnPoint?.z, DEFAULT_BACKEND_WORLD_CONFIG.player.spawnPoint.z),
      },
      flight: {
        ignoreMiningSlowdown: player.flight?.ignoreMiningSlowdown
          ?? DEFAULT_BACKEND_WORLD_CONFIG.player.flight.ignoreMiningSlowdown,
        groundWalkAnimationWhenMoving: player.flight?.groundWalkAnimationWhenMoving
          ?? DEFAULT_BACKEND_WORLD_CONFIG.player.flight.groundWalkAnimationWhenMoving,
      },
    },
    settings: {
      ...DEFAULT_BACKEND_WORLD_CONFIG.settings,
      cameraPreset: settings.cameraPreset ?? DEFAULT_BACKEND_WORLD_CONFIG.settings.cameraPreset,
      visualPreset: settings.visualPreset ?? DEFAULT_BACKEND_WORLD_CONFIG.settings.visualPreset,
      chunk: {
        height: clamp(
          toInt(settings.chunk?.height, DEFAULT_BACKEND_WORLD_CONFIG.settings.chunk.height),
          16,
          256,
        ),
        viewDistance: clamp(
          toInt(settings.chunk?.viewDistance, DEFAULT_BACKEND_WORLD_CONFIG.settings.chunk.viewDistance),
          1,
          8,
        ),
        unloadPadding: clamp(
          toInt(settings.chunk?.unloadPadding, DEFAULT_BACKEND_WORLD_CONFIG.settings.chunk.unloadPadding),
          0,
          8,
        ),
      },
      environment: {
        skyMode: DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.skyMode,
        sunIntensity: toNumber(settings.environment?.sunIntensity, DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.sunIntensity),
        ambientIntensity: toNumber(settings.environment?.ambientIntensity, DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.ambientIntensity),
        fogDensity: toNumber(settings.environment?.fogDensity, DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.fogDensity),
        timeOfDay: clamp(
          toNumber(settings.environment?.timeOfDay, DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.timeOfDay),
          0,
          1,
        ),
        timeAutoPlay: settings.environment?.timeAutoPlay ?? DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.timeAutoPlay,
      },
    },
    ui: {
      ...DEFAULT_BACKEND_WORLD_CONFIG.ui,
      pauseMenu: {
        ...DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu,
        showSettings: ui.pauseMenu?.showSettings ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu.showSettings,
        showSkins: ui.pauseMenu?.showSkins ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu.showSkins,
      },
      controls: {
        ...DEFAULT_BACKEND_WORLD_CONFIG.ui.controls,
        allowFlightToggle: ui.controls?.allowFlightToggle
          ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.controls.allowFlightToggle,
        allowPerspectiveToggle: ui.controls?.allowPerspectiveToggle
          ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.controls.allowPerspectiveToggle,
      },
    },
  }
}

export function normalizeBackendWorldConfig(raw = {}) {
  return mergeBackendConfig(raw)
}

export function getAdminWorldConfig(accountId = '', options = {}) {
  try {
    const scopedKey = buildAdminWorldConfigStorageKey(accountId, options)
    const raw = localStorage.getItem(scopedKey)
    if (raw) {
      const json = JSON.parse(raw)
      return mergeBackendConfig(json)
    }

    if (accountId && !options.spaceName && !options.projectionId && !getActiveSpaceName()) {
      const legacyRaw = localStorage.getItem(ADMIN_WORLD_CONFIG_STORAGE_KEY)
      if (!legacyRaw) {
        return null
      }

      const legacy = mergeBackendConfig(JSON.parse(legacyRaw))
      localStorage.setItem(scopedKey, JSON.stringify(legacy))
      return legacy
    }

    if (!raw) {
      return null
    }

    const json = JSON.parse(raw)
    return mergeBackendConfig(json)
  }
  catch {
    return null
  }
}

export function saveAdminWorldConfig(raw = {}, accountId = '', options = {}) {
  const normalized = mergeBackendConfig(raw)
  const scopedKey = buildAdminWorldConfigStorageKey(accountId, options)
  localStorage.setItem(
    scopedKey,
    JSON.stringify(normalized),
  )
  return normalized
}

export function clearAdminWorldConfig(accountId = '', options = {}) {
  const scopedKey = buildAdminWorldConfigStorageKey(accountId, options)
  localStorage.removeItem(scopedKey)
}

export async function saveBackendWorldConfigRemote(raw = {}, accountId = '', options = {}) {
  const normalized = mergeBackendConfig(raw)
  const requestUrl = buildWorldConfigRequestUrl('/api/world-config', options)

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(normalized),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'save_world_config_remote_failed')
  }

  saveAdminWorldConfig(normalized, accountId, options)
  return normalized
}

export async function loadBackendWorldConfigRecord(accountId = '', options = {}) {
  const { spaceName: activeSpace, projectionId: activeProjectionId } = resolveScopedRouteOptions(options)
  let fallbackRecord = null

  for (const url of BACKEND_CONFIG_URLS) {
    try {
      const requestUrl = buildWorldConfigRequestUrl(url, {
        spaceName: activeSpace,
        projectionId: activeProjectionId,
      })
      const res = await fetch(requestUrl, { cache: 'no-store' })
      if (!res.ok) {
        continue
      }
      const json = await res.json()
      const merged = mergeBackendConfig(json)
      const exists = !!json?.__meta?.exists
      if (exists) {
        saveAdminWorldConfig(merged, accountId, options)
      }
      else if (url.startsWith('/api/')) {
        clearAdminWorldConfig(accountId, options)
      }
      const record = {
        config: merged,
        exists,
        source: url.startsWith('/api/') ? 'remote-api' : 'remote-fallback',
      }
      if (exists) {
        return record
      }
      if (!fallbackRecord) {
        fallbackRecord = record
      }
    }
    catch {
      // continue fallback
    }
  }

  const adminConfig = getAdminWorldConfig(accountId, options)
  if (adminConfig) {
    return {
      config: adminConfig,
      exists: true,
      source: 'local-admin-cache',
    }
  }

  if (fallbackRecord) {
    return fallbackRecord
  }

  return {
    config: mergeBackendConfig(),
    exists: false,
    source: 'default',
  }
}

export async function loadBackendWorldConfig(accountId = '', options = {}) {
  const record = await loadBackendWorldConfigRecord(accountId, options)
  return record.config
}

export { DEFAULT_BACKEND_WORLD_CONFIG }
export { ADMIN_WORLD_CONFIG_STORAGE_KEY }
export { buildAdminWorldConfigStorageKey }
export { buildWorldConfigRequestUrl }
