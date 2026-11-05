import * as THREE from 'three'
import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import { CAMERA_RIG_CONFIG } from './camera-rig-config.js'

const TWO_PI = Math.PI * 2
const DEFAULT_WALK_SPEED = 4.317
const OPACITY_EPSILON = 0.005
const THIRD_PERSON_MODES = new Set(['third-person-back', 'third-person-front'])

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

/**
 * Convert a per-frame (60 fps) smoothing factor from the presets into an
 * exponential damping rate, so FOV smoothing is frame-rate independent.
 * @param {number} smoothSpeed - per-frame lerp factor in (0, 1)
 * @returns {number} damping lambda (1/s)
 */
function smoothSpeedToLambda(smoothSpeed) {
  const s = THREE.MathUtils.clamp(Number(smoothSpeed) || 0.05, 0.001, 0.95)
  return -Math.log(1 - s) * 60
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
 * - dynamic FOV (speed based, replaces Camera's old sprint FOV)
 * - first-person head bobbing / idle breathing (offset + roll)
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
      bobOffset: new THREE.Vector3(),
      bobRoll: 0,
      shoulderOffset: 0,
      height: 0,
      distance: this.config.follow.distance,
      focusDistance: this.config.follow.focusDistance,
    }

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
        const previousBase = this.config.fov.baseFov
        if (fov.enabled !== undefined) {
          this.config.fov.enabled = !!fov.enabled
        }
        assignFinite(this.config.fov, fov, ['baseFov', 'maxFov', 'speedThreshold', 'smoothSpeed'])
        this.config.fov.baseFov = THREE.MathUtils.clamp(this.config.fov.baseFov, 30, 120)
        this.config.fov.maxFov = THREE.MathUtils.clamp(this.config.fov.maxFov, this.config.fov.baseFov, 140)
        // Base FOV changes apply immediately; only speed-driven changes are smoothed.
        this._currentFov += this.config.fov.baseFov - previousBase
      }
      if (bobbing) {
        if (bobbing.enabled !== undefined) {
          this.config.bobbing.enabled = !!bobbing.enabled
        }
        assignFinite(this.config.bobbing, bobbing, [
          'verticalFrequency',
          'verticalAmplitude',
          'horizontalFrequency',
          'horizontalAmplitude',
          'rollFrequency',
          'rollAmplitude',
          'speedMultiplier',
        ])
        if (bobbing.idleBreathing) {
          const breathing = this.config.bobbing.idleBreathing
          if (bobbing.idleBreathing.enabled !== undefined) {
            breathing.enabled = !!bobbing.idleBreathing.enabled
          }
          assignFinite(breathing, bobbing.idleBreathing, ['frequency', 'amplitude'])
        }
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
    const speed = player.getHorizontalSpeed?.() ?? 0
    const isThirdPerson = THIRD_PERSON_MODES.has(mode)

    this._updateFov(speed, dt)
    this._updateBobbing(mode === 'first-person', speed, player)
    this._updateFraming(mode, isThirdPerson, playerPos, dt)
    this._updatePlayerOpacity(isThirdPerson, dt)

    return this.output
  }

  _updateFov(speed, dt) {
    const fov = this.config.fov
    let targetFov = fov.baseFov
    if (fov.enabled) {
      const walkSpeed = this.target.config?.speed?.walk || DEFAULT_WALK_SPEED
      const threshold = Math.max(0.1, fov.speedThreshold)
      const ratio = THREE.MathUtils.clamp((speed - walkSpeed) / threshold, 0, 1)
      targetFov = fov.baseFov + (fov.maxFov - fov.baseFov) * ratio
    }
    this._currentFov = damp(this._currentFov, targetFov, smoothSpeedToLambda(fov.smoothSpeed), dt)
    if (Math.abs(this._currentFov - targetFov) < 0.01) {
      this._currentFov = targetFov
    }
    this.output.fov = this._currentFov
  }

  _updateBobbing(isFirstPerson, speed, player) {
    const out = this.output
    const bobbing = this.config.bobbing
    out.bobOffset.set(0, 0, 0)
    out.bobRoll = 0

    if (!isFirstPerson || !bobbing.enabled) {
      return
    }

    const elapsed = this.time.elapsed / 1000
    const movement = player.movement
    const onFoot = !movement?.isFlying && movement?.isGrounded !== false

    if (onFoot && speed > 0.1) {
      const speedFactor = Math.min(speed / 3.5, 1) * bobbing.speedMultiplier
      out.bobOffset.set(
        Math.sin(elapsed * bobbing.horizontalFrequency * TWO_PI) * bobbing.horizontalAmplitude * speedFactor,
        Math.sin(elapsed * bobbing.verticalFrequency * TWO_PI) * bobbing.verticalAmplitude * speedFactor,
        0,
      )
      out.bobRoll = Math.sin(elapsed * bobbing.rollFrequency * TWO_PI) * bobbing.rollAmplitude * speedFactor
    }
    else if (speed <= 0.1 && bobbing.idleBreathing.enabled) {
      out.bobOffset.y = Math.sin(elapsed * bobbing.idleBreathing.frequency * TWO_PI)
        * bobbing.idleBreathing.amplitude
    }
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
    fovFolder.addBinding(this.config.fov, 'baseFov', { label: '基础 FOV', min: 30, max: 90, step: 1 })
    fovFolder.addBinding(this.config.fov, 'maxFov', { label: '最大 FOV', min: 45, max: 120, step: 1 })
    fovFolder.addBinding(this.config.fov, 'speedThreshold', { label: '超出步行速度', min: 0.5, max: 10, step: 0.5 })
    fovFolder.addBinding(this, '_currentFov', { label: '当前 FOV', readonly: true })

    const bobbing = this.config.bobbing
    const bobbingFolder = debugFolder.addFolder({ title: '镜头震动', expanded: false })
    bobbingFolder.addBinding(bobbing, 'enabled', { label: '启用' })
    bobbingFolder.addBinding(bobbing, 'verticalFrequency', { label: '垂直频率', min: 1, max: 20, step: 0.5 })
    bobbingFolder.addBinding(bobbing, 'verticalAmplitude', { label: '垂直幅度', min: 0, max: 0.2, step: 0.005 })
    bobbingFolder.addBinding(bobbing, 'horizontalFrequency', { label: '水平频率', min: 1, max: 20, step: 0.5 })
    bobbingFolder.addBinding(bobbing, 'horizontalAmplitude', { label: '水平幅度', min: 0, max: 0.1, step: 0.005 })
    bobbingFolder.addBinding(bobbing, 'rollFrequency', { label: 'Roll 频率', min: 1, max: 20, step: 0.5 })
    bobbingFolder.addBinding(bobbing, 'rollAmplitude', { label: 'Roll 幅度', min: 0, max: 0.05, step: 0.001 })
    bobbingFolder.addBinding(bobbing, 'speedMultiplier', { label: '速度因子', min: 0, max: 3, step: 0.1 })
    bobbingFolder.addBinding(bobbing.idleBreathing, 'enabled', { label: '静止呼吸' })
    bobbingFolder.addBinding(bobbing.idleBreathing, 'frequency', { label: '呼吸频率', min: 0.1, max: 2, step: 0.1 })
    bobbingFolder.addBinding(bobbing.idleBreathing, 'amplitude', { label: '呼吸幅度', min: 0, max: 0.05, step: 0.001 })
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
