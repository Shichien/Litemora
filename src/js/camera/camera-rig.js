import * as THREE from 'three'
import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import { CAMERA_RIG_CONFIG } from './camera-rig-config.js'

const OPACITY_EPSILON = 0.005
const THIRD_PERSON_MODES = new Set(['third-person-back', 'third-person-front'])
const BOB_MODES = new Set(['first-person', 'third-person-back', 'third-person-front'])
const DEG = Math.PI / 180

/**
 * 帧率无关的指数阻尼
 * @param {number} current - 当前值
 * @param {number} target - 目标值
 * @param {number} lambda - 阻尼系数 (越大响应越快)
 * @param {number} dt - 时间步长 (秒)
 * @returns {number} 阻尼后的值
 */
function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt))
}

function assignFinite(target, source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key])
    if (Number.isFinite(value)) {
      target[key] = value
    }
  }
}

/**
 * CameraRig computes per-frame camera modifiers from the player state:
 * - Minecraft FOV: baseFov * lerp(effectScale, 1, modifier), where the
 *   modifier (flight x1.1, sprint x1.15) is eased per tick by the player
 * - Minecraft view bobbing (GameRenderer.bobView) as a view-space matrix that
 *   Camera multiplies into the projection only, so aiming rays stay unbobbed
 * - third-person framing: shoulder offset, wheel height, distance, cave pull-in
 *   and player fade
 * Camera owns the mode, pitch, collision and the final transform, and calls
 * update() once per frame before positioning the camera.
 */
export default class CameraRig {
  constructor() {
    this.experience = new Experience()
    this.time = this.experience.time

    this.config = structuredClone(CAMERA_RIG_CONFIG)
    this.target = null

    // Current mode as last seen in update(); gates the wheel handler.
    this.mode = null

    // Smoothed state
    this._currentFov = this.config.fov.baseFov
    this._height = this.config.follow.height
    this._heightTarget = this.config.follow.height
    this._caveBlend = 0
    this._appliedOpacity = 1
    this.isInCave = false

    // Reused output (no per-frame allocation)
    this.output = {
      fov: this._currentFov,
      // View-space bob transform; Camera post-multiplies it into the projection.
      bobMatrix: new THREE.Matrix4(),
      bobActive: false,
      shoulderOffset: 0,
      height: 0,
      distance: this.config.follow.distance,
      focusDistance: this.config.follow.focusDistance,
    }
    this._bobState = { walkDistance: 0, bob: 0 }
    this._tmpBobRotation = new THREE.Matrix4()

    this._handleWheel = ({ deltaY } = {}) => {
      // First person: the wheel belongs to the hotbar. Bird view: OrbitControls zoom.
      if (!THIRD_PERSON_MODES.has(this.mode)) {
        return
      }
      const delta = Number(deltaY)
      if (!Number.isFinite(delta)) {
        return
      }
      const { minHeight, maxHeight, wheelSensitivity } = this.config.follow
      this._heightTarget = THREE.MathUtils.clamp(
        this._heightTarget + delta * wheelSensitivity,
        minHeight,
        maxHeight,
      )
    }

    this._handleCameraRigChanged = ({ fov, bobbing } = {}) => {
      if (fov) {
        if (fov.enabled !== undefined) {
          this.config.fov.enabled = !!fov.enabled
        }
        assignFinite(this.config.fov, fov, ['baseFov', 'fovEffectScale'])
        this.config.fov.baseFov = THREE.MathUtils.clamp(this.config.fov.baseFov, 30, 120)
        this.config.fov.fovEffectScale = THREE.MathUtils.clamp(this.config.fov.fovEffectScale, 0, 2)
      }
      if (bobbing) {
        if (bobbing.enabled !== undefined) {
          this.config.bobbing.enabled = !!bobbing.enabled
        }
        assignFinite(this.config.bobbing, bobbing, ['intensity'])
        this.config.bobbing.intensity = THREE.MathUtils.clamp(this.config.bobbing.intensity, 0, 3)
      }
    }

    emitter.on('input:wheel', this._handleWheel)
    emitter.on('settings:camera-rig-changed', this._handleCameraRigChanged)
  }

  attachPlayer(player) {
    this.target = player
    this._appliedOpacity = 1
  }

  /**
   * Called by Camera.switchMode(). Player.setFirstPersonHidden() resets the model
   * to opacity 1 on every perspective change, so the cave fade restarts from 1.
   * @param {string} mode - new camera mode
   */
  setMode(mode) {
    if (mode === this.mode) {
      return
    }
    this.mode = mode
    this._appliedOpacity = 1
  }

  /**
   * Advance the rig one frame.
   * @param {string} mode - Camera mode ('first-person' | 'third-person-back' | ...)
   * @param {THREE.Vector3} playerPos - player feet position for this frame
   * @returns {object|null} reused output object
   */
  update(mode, playerPos) {
    const player = this.target
    if (!player || !playerPos) {
      return null
    }

    this.setMode(mode)

    const dt = Math.min(this.time.delta / 1000, 0.1)
    const isThirdPerson = THIRD_PERSON_MODES.has(mode)

    this._updateFov(player)
    this._updateBobbing(BOB_MODES.has(mode), player)
    this._updateFraming(mode, isThirdPerson, playerPos, dt)
    this._updatePlayerOpacity(isThirdPerson, dt)

    return this.output
  }

  /**
   * MC GameRenderer.getFov: fov = base * lerp(pt, oldMod, mod), where the
   * eased modifier already blends toward 1 by fovEffectScale.
   * @param {object} player
   */
  _updateFov(player) {
    const fov = this.config.fov
    let fovMultiplier = 1
    if (fov.enabled) {
      const rawModifier = player.movement?.getFovModifier?.() ?? 1
      const scale = Number.isFinite(fov.fovEffectScale) ? fov.fovEffectScale : 1
      fovMultiplier = THREE.MathUtils.clamp(THREE.MathUtils.lerp(1, rawModifier, scale), 0.1, 1.5)
    }
    this._currentFov = fov.baseFov * fovMultiplier
    this.output.fov = this._currentFov
  }

  /**
   * MC GameRenderer.bobView, in view space:
   *   translate(sin(w*pi)*b*0.5, -|cos(w*pi)*b|, 0)
   *   rotZ(sin(w*pi)*b*3 deg) * rotX(|cos(w*pi - 0.2)*b|*5 deg)
   * w is the backwards-interpolated walk distance and b the eased bob amount.
   * @param {boolean} isBobMode - first or third person
   * @param {object} player
   */
  _updateBobbing(isBobMode, player) {
    const out = this.output
    const bobbing = this.config.bobbing
    out.bobActive = false

    if (!isBobMode || !bobbing.enabled || !player.movement?.getViewBobState) {
      out.bobMatrix.identity()
      return
    }

    const state = player.movement.getViewBobState(this._bobState)
    const b = state.bob * (Number.isFinite(bobbing.intensity) ? bobbing.intensity : 1)
    if (b <= 1e-5) {
      out.bobMatrix.identity()
      return
    }

    const phase = state.walkDistance * Math.PI
    const sinPhase = Math.sin(phase)
    out.bobMatrix.makeTranslation(sinPhase * b * 0.5, -Math.abs(Math.cos(phase) * b), 0)
    out.bobMatrix.multiply(this._tmpBobRotation.makeRotationZ(sinPhase * b * 3 * DEG))
    out.bobMatrix.multiply(this._tmpBobRotation.makeRotationX(Math.abs(Math.cos(phase - 0.2) * b) * 5 * DEG))
    out.bobActive = true
  }

  _updateFraming(mode, isThirdPerson, playerPos, dt) {
    const follow = this.config.follow
    const cave = this.config.cave

    this.isInCave = isThirdPerson && cave.enabled && this._checkLowCeiling(playerPos)
    this._caveBlend = damp(this._caveBlend, this.isInCave ? 1 : 0, 8, dt)
    this._height = damp(this._height, this._heightTarget, 12, dt)

    const out = this.output
    const isBack = mode === 'third-person-back'
    out.shoulderOffset = isBack
      ? THREE.MathUtils.lerp(follow.shoulderOffset, cave.shoulderOffset, this._caveBlend)
      : 0
    out.height = this._height * (1 - this._caveBlend)
    out.distance = THREE.MathUtils.lerp(follow.distance, cave.distance, this._caveBlend)
    out.focusDistance = follow.focusDistance
  }

  /**
   * Low ceiling check: at least 2 of the 3 cells right above the head are solid.
   * Block centres are integer coordinates; the feet sit at the bottom of cell round(y).
   * @param {THREE.Vector3} playerPos - player feet position
   * @returns {boolean} true when the player is under a low ceiling
   */
  _checkLowCeiling(playerPos) {
    const provider = this.experience.terrainDataManager
    if (!provider?.getBlockWorld) {
      return false
    }

    const x = Math.round(playerPos.x)
    const y = Math.round(playerPos.y)
    const z = Math.round(playerPos.z)
    let blocked = 0
    for (let dy = 2; dy <= 4; dy++) {
      if (provider.getBlockWorld(x, y + dy, z)?.hasCollision) {
        blocked++
        if (blocked >= 2) {
          return true
        }
      }
    }
    return false
  }

  _updatePlayerOpacity(isThirdPerson, dt) {
    const player = this.target
    if (typeof player?.setOpacity !== 'function') {
      return
    }
    const targetOpacity = isThirdPerson
      ? THREE.MathUtils.lerp(1, this.config.cave.playerOpacity, this._caveBlend)
      : 1
    let next = damp(this._appliedOpacity, targetOpacity, 10, dt)
    if (Math.abs(next - targetOpacity) < OPACITY_EPSILON) {
      next = targetOpacity
    }
    // setOpacity traverses the model, so only call it when the value moves.
    if (next !== this._appliedOpacity) {
      player.setOpacity(next)
      this._appliedOpacity = next
    }
  }

  setDebug(debugFolder) {
    if (!debugFolder) {
      return
    }

    const followFolder = debugFolder.addFolder({ title: '第三人称', expanded: false })
    followFolder.addBinding(this.config.follow, 'shoulderOffset', { label: '肩部偏移', min: -3, max: 3, step: 0.1 })
    followFolder.addBinding(this.config.follow, 'distance', { label: '距离', min: 1, max: 10, step: 0.1 })
    followFolder.addBinding(this.config.follow, 'focusDistance', { label: '注视距离', min: 2, max: 40, step: 0.5 })
    followFolder.addBinding(this, '_heightTarget', { label: '高度 (滚轮)', min: 0, max: 3.5, step: 0.1 })
    followFolder.addBinding(this.config.cave, 'enabled', { label: '洞内拉近' })
    followFolder.addBinding(this, 'isInCave', { label: '当前洞内', readonly: true })

    const fovFolder = debugFolder.addFolder({ title: '动态 FOV', expanded: false })
    fovFolder.addBinding(this.config.fov, 'enabled', { label: '启用' })
    fovFolder.addBinding(this.config.fov, 'baseFov', { label: '基础 FOV', min: 30, max: 110, step: 1 })
    fovFolder.addBinding(this.config.fov, 'fovEffectScale', { label: 'FOV 效果', min: 0, max: 2, step: 0.05 })
    fovFolder.addBinding(this, '_currentFov', { label: '当前 FOV', readonly: true })

    const bobbing = this.config.bobbing
    const bobbingFolder = debugFolder.addFolder({ title: '视角摇晃', expanded: false })
    bobbingFolder.addBinding(bobbing, 'enabled', { label: '启用' })
    bobbingFolder.addBinding(bobbing, 'intensity', { label: '强度', min: 0, max: 3, step: 0.05 })
  }

  destroy() {
    emitter.off('input:wheel', this._handleWheel)
    emitter.off('settings:camera-rig-changed', this._handleCameraRigChanged)
    if (this.target && this._appliedOpacity !== 1) {
      this.target.setOpacity?.(1)
    }
    this.target = null
  }
}
