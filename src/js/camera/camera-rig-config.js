import { BOBBING_PRESETS, FOV_PRESETS } from '../config/settings-presets.js'

/**
 * CameraRig defaults. The rig only produces modifiers (FOV, bobbing, third-person
 * framing); Camera owns mode, pitch, collision and the final camera transform.
 * fov / bobbing start from the 'default' preset so the resting pose matches the
 * settings menu until settings:camera-rig-changed arrives.
 */
export const CAMERA_RIG_CONFIG = {
  // Third-person framing, relative to the player's eye position
  follow: {
    shoulderOffset: 0.9, // m to the player's right (back view only)
    distance: 4, // m behind (back view) / in front (front view)
    focusDistance: 16, // back view looks this far along the view direction
    height: 0, // extra camera height above the eyes, changed with the mouse wheel
    minHeight: 0,
    maxHeight: 3.5,
    wheelSensitivity: 0.005, // m per wheel deltaY unit (~0.5 m per notch)
  },

  // Low ceiling above the player: pull the third-person camera in and fade the model
  cave: {
    enabled: true,
    distance: 1.2,
    shoulderOffset: 0,
    playerOpacity: 0.1,
  },

  // Minecraft FOV: baseFov (vertical) times the eased flight/sprint modifier,
  // blended toward 1 by fovEffectScale (MC "FOV Effects" slider).
  fov: { ...FOV_PRESETS.default },

  // Minecraft view bobbing, scaled by intensity (1 = vanilla)
  bobbing: structuredClone(BOBBING_PRESETS.default),
}
