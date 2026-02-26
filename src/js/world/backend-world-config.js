import { buildSpaceScopedKey, getActiveSpaceName } from '../utils/space-context.js'

const BACKEND_CONFIG_URLS = [
  '/api/world-config',
  '/world-config.json',
]

const ADMIN_WORLD_CONFIG_STORAGE_KEY = 'mc-admin-world-config'

function buildAdminWorldConfigStorageKey(accountId = '') {
  const normalizedId = String(accountId || '').trim()
  if (!normalizedId) {
    return buildSpaceScopedKey(ADMIN_WORLD_CONFIG_STORAGE_KEY, getActiveSpaceName())
  }
  return `${ADMIN_WORLD_CONFIG_STORAGE_KEY}:${encodeURIComponent(normalizedId)}`
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
    },
  },
  ui: {
    pauseMenu: {
      showSettings: false,
      showSkins: true,
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
        skyMode: settings.environment?.skyMode ?? DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.skyMode,
        sunIntensity: toNumber(settings.environment?.sunIntensity, DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.sunIntensity),
        ambientIntensity: toNumber(settings.environment?.ambientIntensity, DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.ambientIntensity),
        fogDensity: toNumber(settings.environment?.fogDensity, DEFAULT_BACKEND_WORLD_CONFIG.settings.environment.fogDensity),
      },
    },
    ui: {
      ...DEFAULT_BACKEND_WORLD_CONFIG.ui,
      pauseMenu: {
        ...DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu,
        showSettings: ui.pauseMenu?.showSettings ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu.showSettings,
        showSkins: ui.pauseMenu?.showSkins ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu.showSkins,
      },
    },
  }
}

export function normalizeBackendWorldConfig(raw = {}) {
  return mergeBackendConfig(raw)
}

export function getAdminWorldConfig(accountId = '') {
  try {
    const scopedKey = buildAdminWorldConfigStorageKey(accountId)
    const raw = localStorage.getItem(scopedKey)
    if (raw) {
      const json = JSON.parse(raw)
      return mergeBackendConfig(json)
    }

    if (accountId) {
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

export function saveAdminWorldConfig(raw = {}, accountId = '') {
  const normalized = mergeBackendConfig(raw)
  const scopedKey = buildAdminWorldConfigStorageKey(accountId)
  localStorage.setItem(
    scopedKey,
    JSON.stringify(normalized),
  )
  return normalized
}

export function clearAdminWorldConfig(accountId = '') {
  const scopedKey = buildAdminWorldConfigStorageKey(accountId)
  localStorage.removeItem(scopedKey)
}

export async function saveBackendWorldConfigRemote(raw = {}, accountId = '') {
  const normalized = mergeBackendConfig(raw)
  const activeSpace = getActiveSpaceName()
  const requestUrl = activeSpace
    ? `/api/world-config?space=${encodeURIComponent(activeSpace)}`
    : '/api/world-config'

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

  saveAdminWorldConfig(normalized, accountId)
  return normalized
}

export async function loadBackendWorldConfig(accountId = '') {
  const activeSpace = getActiveSpaceName()

  for (const url of BACKEND_CONFIG_URLS) {
    try {
      const requestUrl = activeSpace ? `${url}?space=${encodeURIComponent(activeSpace)}` : url
      const res = await fetch(requestUrl, { cache: 'no-store' })
      if (!res.ok) {
        continue
      }
      const json = await res.json()
      const merged = mergeBackendConfig(json)
      saveAdminWorldConfig(merged, accountId)
      return merged
    }
    catch {
      // continue fallback
    }
  }

  const adminConfig = getAdminWorldConfig(accountId)
  if (adminConfig) {
    return adminConfig
  }

  return mergeBackendConfig()
}

export { DEFAULT_BACKEND_WORLD_CONFIG }
export { ADMIN_WORLD_CONFIG_STORAGE_KEY }
export { buildAdminWorldConfigStorageKey }
