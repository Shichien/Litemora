/**
 * Settings Presets Configuration
 * Defines preset values for Camera, Visual (SpeedLines), and Environment settings
 * Based on: docs/plans/2026-01-14-menu-ui-v2-design.md
 */

// ========================================
// Camera FOV Presets
// ========================================
// Minecraft model: fov = baseFov (vertical degrees, MC default 70) * modifier,
// where the modifier comes from the movement-speed attribute (sprint 1.15)
// and creative flight (x1.1), eased per tick. fovEffectScale is MC's
// "FOV Effects" slider (0 = no change, 1 = vanilla).
export const FOV_PRESETS = {
  off: {
    enabled: false,
    baseFov: 70,
    fovEffectScale: 0,
  },
  default: {
    enabled: true,
    baseFov: 70,
    fovEffectScale: 1,
  },
  cinematic: {
    enabled: true,
    baseFov: 60,
    fovEffectScale: 0.6,
  },
  arcade: {
    enabled: true,
    baseFov: 80,
    fovEffectScale: 1.5,
  },
}

// ========================================
// Camera Bobbing Presets
// ========================================
// Minecraft "View Bobbing": driven by walked distance, so the step rhythm
// follows the real speed. intensity scales vanilla amplitudes (1 = vanilla).
export const BOBBING_PRESETS = {
  off: {
    enabled: false,
    intensity: 1,
  },
  default: {
    enabled: true,
    intensity: 1,
  },
  cinematic: {
    enabled: true,
    intensity: 0.5,
  },
  arcade: {
    enabled: true,
    intensity: 1.5,
  },
}

// ========================================
// SpeedLines Presets
// ========================================
export const SPEEDLINES_PRESETS = {
  off: {
    enabled: false,
    color: { r: 255, g: 255, b: 255 },
    density: 66,
    speed: 6.0,
    thickness: 0.24,
    minRadius: 0.40,
    maxRadius: 1.30,
    randomness: 0.50,
  },
  default: {
    enabled: true,
    color: { r: 255, g: 255, b: 255 },
    density: 66,
    speed: 6.0,
    thickness: 0.24,
    minRadius: 0.40,
    maxRadius: 1.30,
    randomness: 0.50,
  },
  cinematic: {
    enabled: true,
    color: { r: 235, g: 245, b: 255 },
    density: 48,
    speed: 4.0,
    thickness: 0.18,
    minRadius: 0.45,
    maxRadius: 1.15,
    randomness: 0.35,
  },
  arcade: {
    enabled: true,
    color: { r: 255, g: 255, b: 255 },
    density: 90,
    speed: 8.0,
    thickness: 0.30,
    minRadius: 0.35,
    maxRadius: 1.50,
    randomness: 0.70,
  },
}

// ========================================
// Environment Presets (defaults)
// ========================================
export const ENV_DEFAULTS = {
  skyMode: 'DayCycle',
  sunIntensity: 1.75,
  ambientIntensity: 0.75,
  fogDensity: 0.01,
}

// ========================================
// Chunk Presets (defaults)
// ========================================
export const CHUNK_DEFAULTS = {
  viewDistance: 1,
  unloadPadding: 1,
}

// ========================================
// Preset names for UI display
// ========================================
export const PRESET_NAMES = ['off', 'default', 'cinematic', 'arcade']
export const PRESET_LABELS = {
  off: 'Off',
  default: 'Default',
  cinematic: 'Cinematic',
  arcade: 'Arcade',
}
