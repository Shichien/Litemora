const BACKEND_CONFIG_URLS = [
  '/api/world-config',
  '/world-config.json',
]

const ADMIN_WORLD_CONFIG_STORAGE_KEY = 'mc-admin-world-config'

const DEFAULT_BACKEND_WORLD_CONFIG = {
  player: {
    spawnPoint: { x: 32, y: 20, z: 32 },
  },
  settings: {
    cameraPreset: 'default',
    visualPreset: 'default',
    chunk: {
      height: 32,
      viewDistance: 2,
      unloadPadding: 1,
    },
    environment: {
      skyMode: 'Image',
      sunIntensity: 1.75,
      ambientIntensity: 0.75,
      fogDensity: 0.01,
    },
  },
  scene: {
    modelUrl: '',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    castShadow: true,
    receiveShadow: true,
  },
  ui: {
    pauseMenu: {
      showMainMenu: false,
      showSettings: true,
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
  const scene = raw.scene || {}
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
    scene: {
      ...DEFAULT_BACKEND_WORLD_CONFIG.scene,
      modelUrl: scene.modelUrl ?? DEFAULT_BACKEND_WORLD_CONFIG.scene.modelUrl,
      position: {
        x: toNumber(scene.position?.x, DEFAULT_BACKEND_WORLD_CONFIG.scene.position.x),
        y: toNumber(scene.position?.y, DEFAULT_BACKEND_WORLD_CONFIG.scene.position.y),
        z: toNumber(scene.position?.z, DEFAULT_BACKEND_WORLD_CONFIG.scene.position.z),
      },
      rotation: {
        x: toNumber(scene.rotation?.x, DEFAULT_BACKEND_WORLD_CONFIG.scene.rotation.x),
        y: toNumber(scene.rotation?.y, DEFAULT_BACKEND_WORLD_CONFIG.scene.rotation.y),
        z: toNumber(scene.rotation?.z, DEFAULT_BACKEND_WORLD_CONFIG.scene.rotation.z),
      },
      scale: {
        x: toNumber(scene.scale?.x, DEFAULT_BACKEND_WORLD_CONFIG.scene.scale.x),
        y: toNumber(scene.scale?.y, DEFAULT_BACKEND_WORLD_CONFIG.scene.scale.y),
        z: toNumber(scene.scale?.z, DEFAULT_BACKEND_WORLD_CONFIG.scene.scale.z),
      },
      castShadow: scene.castShadow ?? DEFAULT_BACKEND_WORLD_CONFIG.scene.castShadow,
      receiveShadow: scene.receiveShadow ?? DEFAULT_BACKEND_WORLD_CONFIG.scene.receiveShadow,
    },
    ui: {
      ...DEFAULT_BACKEND_WORLD_CONFIG.ui,
      pauseMenu: {
        ...DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu,
        showMainMenu: ui.pauseMenu?.showMainMenu ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu.showMainMenu,
        showSettings: ui.pauseMenu?.showSettings ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu.showSettings,
        showSkins: ui.pauseMenu?.showSkins ?? DEFAULT_BACKEND_WORLD_CONFIG.ui.pauseMenu.showSkins,
      },
    },
  }
}

export function normalizeBackendWorldConfig(raw = {}) {
  return mergeBackendConfig(raw)
}

export function getAdminWorldConfig() {
  try {
    const raw = localStorage.getItem(ADMIN_WORLD_CONFIG_STORAGE_KEY)
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

export function saveAdminWorldConfig(raw = {}) {
  const normalized = mergeBackendConfig(raw)
  localStorage.setItem(
    ADMIN_WORLD_CONFIG_STORAGE_KEY,
    JSON.stringify(normalized),
  )
  return normalized
}

export function clearAdminWorldConfig() {
  localStorage.removeItem(ADMIN_WORLD_CONFIG_STORAGE_KEY)
}

export async function loadBackendWorldConfig() {
  const adminConfig = getAdminWorldConfig()
  if (adminConfig) {
    return adminConfig
  }

  for (const url of BACKEND_CONFIG_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        continue
      }
      const json = await res.json()
      return mergeBackendConfig(json)
    }
    catch {
      // continue fallback
    }
  }

  return mergeBackendConfig()
}

export { DEFAULT_BACKEND_WORLD_CONFIG }
export { ADMIN_WORLD_CONFIG_STORAGE_KEY }
