import * as THREE from 'three'
import { MOVEMENT_CONSTANTS, MOVEMENT_DIRECTION_WEIGHTS } from '../../config/player-config.js'
import Experience from '../../experience.js'
import { getBlockTypeById } from '../terrain/blocks-config.js'
import { getMinecraftBlockMovementProfile, isMinecraftBlockClimbable } from '../terrain/minecraft-block-data.js'
import { LocomotionProfiles } from './animation-config.js'
import PlayerCollisionSystem from './player-collision.js'

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1)
}

// MC creative flight reaches 10.89 m/s; speedMultiplier is relative to run speed.
const DEFAULT_FLIGHT_SPEED_MULTIPLIER = 10.89 / 5.612
// MC Entity.isHorizontalCollisionMinor: deflection under 8 degrees keeps sprinting.
const MINOR_COLLISION_ANGLE = THREE.MathUtils.degToRad(8)

/**
 * 玩家移动控制器
 * - 采用固定 20 TPS 的近 Minecraft 运动更新
 * - 按 Minecraft 的轴顺序裁剪玩家包围盒的位移
 */
export class PlayerMovementController {
  constructor(config) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.config = config

    this.isGrounded = false
    this.isFlying = false
    this.isInWater = false
    this.isClimbing = false
    this.isSneaking = false
    // Latched like MC LocalPlayer: starts on a sprint request with forward
    // impulse, stops when forward impulse ends or on a head-on collision.
    this.isSprinting = false
    this.groundedGraceTimer = 0
    // Tick-based input state (MC LivingEntity.noJumpDelay / LocalPlayer.jumpTriggerTime)
    this.jumpDelayTicks = 0
    this.flightToggleTicks = 0
    this._wasJumpHeld = false
    this.allowFlightToggle = true
    this.onJump = null
    this.onFlightToggled = null
    this.horizontalCollision = false
    this.minorHorizontalCollision = false
    // Last tick's horizontal displacement (m/s), for HUD / camera consumers
    this.horizontalMoveSpeed = 0
    // Eased eye height and FOV modifier (MC Camera.tick)
    this.eyeHeight = null
    this.eyeHeightO = null
    this.fovModifier = 1
    this.fovModifierO = 1
    this.partialTick = 0
    this.tickCount = 0
    this.flightConfig = {
      speedMultiplier: DEFAULT_FLIGHT_SPEED_MULTIPLIER,
      groundWalkAnimationWhenMoving: true,
    }

    this.physicsTickRate = this.config.physics?.tickRate || 20
    this.physicsTick = 1 / this.physicsTickRate
    this.maxPhysicsDelta = this.config.physics?.maxTickDelta || 0.25
    this.tickAccumulator = 0

    this.position = new THREE.Vector3(0, 0, 0)
    this.previousPosition = new THREE.Vector3(0, 0, 0)
    this.renderPosition = new THREE.Vector3(0, 0, 0)
    this.worldVelocity = new THREE.Vector3()

    this.poses = this._createPoseProfiles()
    this.currentPoseKey = 'standing'
    this.collision = new PlayerCollisionSystem()
    this.terrainProvider = this.experience.terrainDataManager
    this._hasInitializedRespawn = false
    this._hasExplicitRespawnPoint = false
    this._respawnSetupTimer = null
    this.groundSampler = null

    this.facingAngle = config.facingAngle ?? Math.PI
    this.group = new THREE.Group()
    this.group.rotation.y = this.facingAngle
    this.scene.add(this.group)

    this.groundMovementProfile = getMinecraftBlockMovementProfile()

    this._respawnSetupTimer = setTimeout(() => {
      this._respawnSetupTimer = null
      this._setupRespawnPoint()
    }, 1000)
  }

  setFacing(angle) {
    this.facingAngle = angle
    this.group.rotation.y = angle
  }

  setGroundSampler(sampler) {
    this.groundSampler = sampler
  }

  getRenderPosition() {
    return this.renderPosition.clone()
  }

  getPortalProbeState() {
    return {
      basePosition: this.position.clone(),
      radius: this.currentPose.radius,
      bodyHeight: this.currentPose.height,
    }
  }

  getEyeHeight() {
    const target = this.poses[this.currentPoseKey]?.eyeHeight ?? 1.62
    if (this.eyeHeight === null || this.eyeHeightO === null) {
      return target
    }
    return THREE.MathUtils.lerp(this.eyeHeightO, this.eyeHeight, this.partialTick)
  }

  /**
   * Interpolated raw FOV modifier (flight x1.1, sprint speed attribute),
   * before the settings effect scale is applied.
   * @returns {number} raw FOV modifier (1 = no change)
   */
  getFovModifier() {
    return THREE.MathUtils.lerp(this.fovModifierO, this.fovModifier, this.partialTick)
  }

  update(inputState, isCombatActive) {
    if (this.isFlying) {
      this.isInWater = false
      this.isClimbing = false
      // MC never crouches while flying; stand up when there is room.
      if (this.currentPoseKey !== 'standing' && this._canOccupyPose(this.position, 'standing')) {
        this.currentPoseKey = 'standing'
      }
    }
    else {
      this._updatePose(inputState)
    }

    const rawDt = this.experience.time.delta * 0.001
    const clampedDt = Math.min(Math.max(rawDt, 0), this.maxPhysicsDelta)
    this.groundedGraceTimer = Math.max(0, this.groundedGraceTimer - clampedDt)
    this.tickAccumulator = Math.min(this.tickAccumulator + clampedDt, this.maxPhysicsDelta * 2)

    let iterations = 0
    while (this.tickAccumulator >= this.physicsTick && iterations < 8) {
      this.previousPosition.copy(this.position)
      this._beginTick()
      this._tickControls(inputState, isCombatActive)
      if (this.isFlying) {
        this._stepFlightPhysics(inputState, isCombatActive)
      }
      else {
        this._stepCustomPhysics(inputState, isCombatActive)
      }
      this._endTick()
      this.tickAccumulator -= this.physicsTick
      iterations++
    }

    const alpha = clamp01(this.tickAccumulator / this.physicsTick)
    this.partialTick = alpha
    this.renderPosition.lerpVectors(this.previousPosition, this.position, alpha)

    if (!this.isFlying) {
      this._checkRespawn()
    }
    this._syncMeshCustom()
  }

  _beginTick() {
    const ease = this.config.physics?.eyeHeightEase ?? 0.5
    const targetEyeHeight = this.poses[this.currentPoseKey]?.eyeHeight ?? 1.62
    if (this.eyeHeight === null) {
      this.eyeHeight = targetEyeHeight
    }
    this.eyeHeightO = this.eyeHeight
    this.eyeHeight += (targetEyeHeight - this.eyeHeight) * ease

    this.fovModifierO = this.fovModifier
    this.fovModifier += (this._getTargetFovModifier() - this.fovModifier) * ease
    this.fovModifier = THREE.MathUtils.clamp(this.fovModifier, 0.1, 1.5)
  }

  _endTick() {
    const dx = this.position.x - this.previousPosition.x
    const dz = this.position.z - this.previousPosition.z
    const moved = Math.hypot(dx, dz)
    this.horizontalMoveSpeed = moved * this.physicsTickRate
    this.tickCount++
  }

  _getTargetFovModifier() {
    let modifier = 1
    if (this.isFlying) {
      modifier *= 1.1
    }
    if (this.isSprinting) {
      // movement-speed attribute / walking speed = 1.3 -> (1.3 + 1) / 2
      const walk = this.config.speed?.walk || 4.317
      const run = this.config.speed?.run || 5.612
      modifier *= ((run / walk) + 1) / 2
    }
    return modifier
  }

  _hasForwardImpulse(inputState) {
    return !!(inputState.forward && !inputState.backward)
  }

  /**
   * Per-tick input handling (MC LocalPlayer.aiStep / LivingEntity.aiStep):
   * sprint latch, double-tap-Space flight toggle and held-Space jumping.
   */
  _tickControls(inputState, isCombatActive) {
    const jumpHeld = !!inputState.space
    const jumpPressed = jumpHeld && !this._wasJumpHeld
    this._wasJumpHeld = jumpHeld
    const hasForwardImpulse = this._hasForwardImpulse(inputState)
    const isMovingSlowly = !this.isFlying && this.currentPoseKey === 'crouching'

    // Sprint latch. inputState.sprint is the request (Ctrl held or W double-tap).
    if (!this.isSprinting && inputState.sprint && hasForwardImpulse && !isMovingSlowly && !isCombatActive) {
      this.isSprinting = true
    }
    if (this.isSprinting && (!hasForwardImpulse || (this.horizontalCollision && !this.minorHorizontalCollision))) {
      this.isSprinting = false
    }

    // Double-tap Space toggles creative flight.
    if (this.flightToggleTicks > 0) {
      this.flightToggleTicks--
    }
    let toggledFlight = false
    if (this.allowFlightToggle && jumpPressed) {
      if (this.flightToggleTicks === 0) {
        this.flightToggleTicks = this.config.physics?.flightToggleWindowTicks ?? 7
      }
      else {
        const wasGrounded = this.isGrounded
        this._setFlying(!this.isFlying)
        if (this.isFlying && wasGrounded) {
          this._jumpFromGround()
        }
        this.flightToggleTicks = 0
        toggledFlight = true
        this.onFlightToggled?.(this.isFlying)
      }
    }

    // Held-Space jumping with MC's 10-tick noJumpDelay.
    if (this.jumpDelayTicks > 0) {
      this.jumpDelayTicks--
    }
    if (this.isFlying || toggledFlight) {
      return
    }
    if (!jumpHeld) {
      this.jumpDelayTicks = 0
      return
    }
    // Coyote grace only for a fresh press, so holding Space off a ledge does not jump.
    const canJumpFromGround = this.isGrounded || (jumpPressed && this.groundedGraceTimer > 0)
    if (canJumpFromGround && this.jumpDelayTicks === 0 && !isCombatActive && !this.isInWater && !this.isClimbing) {
      this._jumpFromGround()
      this.jumpDelayTicks = this.config.physics?.jumpDelayTicks ?? 10
    }
  }

  _jumpFromGround() {
    const jumpFactor = this.groundMovementProfile.jumpFactor ?? 1
    this.worldVelocity.y = Math.max(this.config.jumpForce * jumpFactor, this.worldVelocity.y)

    if (this.isSprinting) {
      const boost = this.config.physics?.sprintJumpBoost ?? 4
      this.worldVelocity.x += -Math.sin(this.facingAngle) * boost
      this.worldVelocity.z += -Math.cos(this.facingAngle) * boost
    }

    this.groundedGraceTimer = 0
    this.onJump?.()
  }

  _setFlying(isFlying) {
    this.isFlying = !!isFlying
    this.isGrounded = false
    this.flightToggleTicks = 0
  }

  toggleFlight() {
    this._setFlying(!this.isFlying)
    this.worldVelocity.set(0, 0, 0)
  }

  shouldSimulateGroundWalk(inputState) {
    return this.isFlying
      && this.flightConfig.groundWalkAnimationWhenMoving
      && this.isMoving(inputState)
  }

  setFlightConfig(config = {}) {
    if (config.groundWalkAnimationWhenMoving !== undefined) {
      this.flightConfig.groundWalkAnimationWhenMoving = !!config.groundWalkAnimationWhenMoving
    }
    if (config.speedMultiplier !== undefined) {
      const speedMultiplier = Number(config.speedMultiplier)
      if (Number.isFinite(speedMultiplier)) {
        this.flightConfig.speedMultiplier = Math.max(0.5, Math.min(8, speedMultiplier))
      }
    }
  }

  /**
   * Creative flight, one tick (MC Player.travel with abilities.flying):
   * horizontal accel flyingSpeed (x2 sprinting), drag 0.91; vertical input
   * +-3*flyingSpeed per tick and vy = vy_before * 0.6. Noclip, floor clamped.
   */
  _stepFlightPhysics(inputState, isCombatActive) {
    const tickRate = this.physicsTickRate
    const defaultMultiplier = DEFAULT_FLIGHT_SPEED_MULTIPLIER
    const scale = (this.flightConfig.speedMultiplier || defaultMultiplier) / defaultMultiplier
    const abilitySpeed = 0.05 * scale
    let horizontalAccel = abilitySpeed * (this.isSprinting ? 2 : 1)
    if (isCombatActive) {
      horizontalAccel *= MOVEMENT_CONSTANTS.COMBAT_DECELERATION
    }

    const ascend = inputState.space ? 1 : 0
    const descend = inputState.sneak || inputState.shift || inputState.v ? 1 : 0
    const verticalInput = ascend - descend
    let vy = this.worldVelocity.y / tickRate
    vy += verticalInput * abilitySpeed * 3

    const { worldX, worldZ, magnitude } = this._computeMoveInput(inputState, false)
    let vx = this.worldVelocity.x / tickRate + worldX * magnitude * horizontalAccel
    let vz = this.worldVelocity.z / tickRate + worldZ * magnitude * horizontalAccel

    this.position.x += vx
    this.position.y += vy
    this.position.z += vz
    this.worldVelocity.set(vx * tickRate, vy * tickRate, vz * tickRate)
    this._applyWorldFloorClampToPosition(this.position, this.worldVelocity)

    vx *= 0.91
    vz *= 0.91
    vy = (this.worldVelocity.y / tickRate) * 0.6
    if (Math.hypot(vx, vz) < 0.003) {
      vx = 0
      vz = 0
    }
    if (Math.abs(vy) < 0.003) {
      vy = 0
    }
    this.worldVelocity.set(vx * tickRate, vy * tickRate, vz * tickRate)

    this.horizontalCollision = false
    this.minorHorizontalCollision = false
    if (this.isSprinting && !this._hasForwardImpulse(inputState)) {
      this.isSprinting = false
    }
    this.isGrounded = this.position.y <= (this.config.physics?.minWorldY ?? Number.NEGATIVE_INFINITY)
  }

  /**
   * One 20 TPS tick, in MC LivingEntity.travelInAir order:
   * accelerate -> move/collide -> block speed factor -> gravity -> friction.
   * worldVelocity therefore holds the post-friction velocity between ticks,
   * like MC deltaMovement. Units are m/s (= blocks/tick * 20).
   */
  _stepCustomPhysics(inputState, isCombatActive) {
    this.collision.prepareFrame()

    const provider = this.experience.terrainDataManager || this.terrainProvider
    const tickRate = this.physicsTickRate
    const minVelocity = this.config.physics?.minVelocity ?? 0.06

    this.isSneaking = this.currentPoseKey === 'crouching'
    this.isInWater = this._isPositionInWater(this.position)
    this.isClimbing = !this.isInWater && this._isTouchingClimbable(this.position)

    // MC aiStep: drop tiny residual velocity before applying input.
    if (Math.hypot(this.worldVelocity.x, this.worldVelocity.z) < minVelocity) {
      this.worldVelocity.x = 0
      this.worldVelocity.z = 0
    }
    if (Math.abs(this.worldVelocity.y) < minVelocity) {
      this.worldVelocity.y = 0
    }

    // Friction uses the ground state from before the move.
    const frictionGrounded = this.isGrounded
    const groundFriction = this._getGroundFriction()
    this._applyMoveAcceleration(inputState, isCombatActive, frictionGrounded)

    if (this.isInWater) {
      this._updateWaterVerticalVelocity(inputState)
    }
    else if (this.isClimbing) {
      // MC handleOnClimbable: horizontal speed clamped to 0.15 b/t on ladders.
      const climbClamp = 0.15 * tickRate
      this.worldVelocity.x = THREE.MathUtils.clamp(this.worldVelocity.x, -climbClamp, climbClamp)
      this.worldVelocity.z = THREE.MathUtils.clamp(this.worldVelocity.z, -climbClamp, climbClamp)
      this._updateClimbVerticalVelocity(inputState)
    }

    const movement = this.worldVelocity.clone().multiplyScalar(this.physicsTick)
    const body = this.collision.playerBounds(this.position, this.currentPose)
    const stepHeight = this.config.physics?.autoStepHeight ?? 0.6
    const sneakDrop = this.config.physics?.sneakSupportDrop ?? stepHeight
    const sneakingOnGround = inputState.sneak && frictionGrounded && movement.y <= 0
    const area = body.clone().union(body.clone().translate(movement))
    area.max.y += stepHeight
    area.min.y -= sneakingOnGround ? sneakDrop : 0
    const shapes = this.collision.collectShapes(area.expandByScalar(1e-7), provider)
    const floorY = this._getMinWorldY() ?? -Infinity
    if (sneakingOnGround) {
      this.collision.backOffEdge(body, movement, shapes, sneakDrop, floorY)
    }
    const clipped = this.collision.resolveMovement(body, movement, shapes, frictionGrounded, stepHeight, floorY)
    this.position.add(clipped)
    this.isGrounded = movement.y < 0 && movement.y !== clipped.y
    this._updateHorizontalCollision(inputState, movement, clipped)
    if (clipped.x !== movement.x)
      this.worldVelocity.x = 0
    if (clipped.z !== movement.z)
      this.worldVelocity.z = 0
    if (clipped.y !== movement.y)
      this.worldVelocity.y = 0

    this._applySampledFloor(provider, body.min.y)
    if (this._applyWorldFloorClampToPosition(this.position, this.worldVelocity)) {
      this.isGrounded = true
    }
    this.isClimbing = !this.isInWater && this._isTouchingClimbable(this.position)
    const finalBounds = this.collision.playerBounds(this.position, this.currentPose)
    this.collision.finishFrame(finalBounds, shapes, movement, clipped)
    const support = this.collision.supportingBlock(finalBounds, shapes)
    this.groundMovementProfile = this._resolveMovementProfileForSupportBlock(support)
    const speedFactor = this.isGrounded ? (this.groundMovementProfile.speedFactor ?? 1) : 1
    if (speedFactor !== 1) {
      this.worldVelocity.x *= speedFactor
      this.worldVelocity.z *= speedFactor
    }

    // Gravity after the move, then drag (MC: vy = (vy - 0.08) * 0.98).
    if (!this.isInWater && !this.isClimbing) {
      const gravity = this.config.physics?.gravityPerTick ?? 1.6
      const verticalDrag = this.config.physics?.verticalDrag ?? 0.98
      this.worldVelocity.y = (this.worldVelocity.y - gravity) * verticalDrag
    }

    if (!this.isInWater) {
      const airDrag = this.config.physics?.airDrag ?? 0.91
      const friction = frictionGrounded ? groundFriction : airDrag
      this.worldVelocity.x *= friction
      this.worldVelocity.z *= friction
    }

    if (this.isGrounded) {
      this.groundedGraceTimer = Math.max(
        this.groundedGraceTimer,
        Number(this.config.physics?.jumpCoyoteTime ?? 0.1),
      )
    }
  }

  /**
   * MC Entity.move: horizontalCollision when the clipped move differs from the
   * attempted one; "minor" when the deflection from the input direction is
   * under 8 degrees (a glancing wall hit keeps the sprint going).
   */
  _updateHorizontalCollision(inputState, attempted, actual) {
    const actualDx = actual.x
    const actualDz = actual.z
    this.horizontalCollision = Math.abs(attempted.x - actualDx) > 1e-5 || Math.abs(attempted.z - actualDz) > 1e-5
    this.minorHorizontalCollision = false
    if (!this.horizontalCollision) {
      return
    }

    const { worldX, worldZ, magnitude } = this._computeMoveInput(inputState, false)
    const actualLength = Math.hypot(actualDx, actualDz)
    if (magnitude <= 0 || actualLength < 1e-5) {
      return
    }
    const cosAngle = ((worldX * actualDx) + (worldZ * actualDz)) / actualLength
    this.minorHorizontalCollision = Math.acos(THREE.MathUtils.clamp(cosAngle, -1, 1)) < MINOR_COLLISION_ANGLE
  }

  /**
   * MC moveRelative with getFrictionInfluencedSpeed: ground accel is the
   * movement-speed attribute (x0.216/f^3 on slippery blocks), air accel is
   * 0.02 (0.026 sprinting). Friction is applied after the move.
   */
  _applyMoveAcceleration(inputState, isCombatActive, isGrounded) {
    const tickRate = this.physicsTickRate
    const { worldX, worldZ, magnitude } = this._computeMoveInput(inputState, this.currentPoseKey === 'crouching')

    if (this.isInWater) {
      const waterDrag = this.config.physics?.waterDrag ?? 0.85
      this.worldVelocity.x *= waterDrag
      this.worldVelocity.z *= waterDrag
    }

    if (magnitude <= 0) {
      return
    }

    const walk = this.config.speed?.walk || 4.317
    const sprintRatio = (this.config.speed?.run || 5.612) / walk
    // Movement-speed attribute in b/t: 0.1 walking, x1.3 sprinting.
    let attribute = 0.1 * (walk / 4.317)
    if (this.isSprinting) {
      attribute *= sprintRatio
    }
    if (isCombatActive) {
      attribute *= MOVEMENT_CONSTANTS.COMBAT_DECELERATION
    }

    let acceleration
    if (this.isInWater) {
      acceleration = 0.02 * (walk / 4.317)
    }
    else if (isGrounded) {
      const slip = THREE.MathUtils.clamp(this.groundMovementProfile.slipperiness ?? 0.6, 0.01, 0.999)
      acceleration = slip > 0.6 ? attribute * (0.21600002 / (slip * slip * slip)) : attribute
    }
    else {
      acceleration = (this.isSprinting ? 0.026 : 0.02) * (walk / 4.317)
      if (isCombatActive) {
        acceleration *= MOVEMENT_CONSTANTS.COMBAT_DECELERATION
      }
    }

    const step = acceleration * magnitude * tickRate
    this.worldVelocity.x += worldX * step
    this.worldVelocity.z += worldZ * step
  }

  /**
   * MC input shaping: unit key vector -> x0.98 -> x sneak speed when moving
   * slowly -> stretched toward the unit square, capped at 1. Diagonal walking
   * therefore matches straight walking; diagonal sneaking is a bit faster.
   * @returns {{worldX:number, worldZ:number, magnitude:number}} unit world
   *   direction and input length
   */
  _computeMoveInput(inputState, isMovingSlowly) {
    const { worldX, worldZ } = this._computeWorldDirection(inputState)
    const directionLength = Math.hypot(worldX, worldZ)
    if (directionLength < 1e-6) {
      return { worldX: 0, worldZ: 0, magnitude: 0 }
    }

    const walk = this.config.speed?.walk || 4.317
    const sneakRatio = (this.config.speed?.crouch || 1.295) / walk
    let length = this.config.physics?.inputFriction ?? 0.98
    if (isMovingSlowly) {
      length *= sneakRatio
    }

    let localX = 0
    let localZ = 0
    if (inputState.left)
      localX -= 1
    if (inputState.right)
      localX += 1
    if (inputState.forward)
      localZ -= 1
    if (inputState.backward)
      localZ += 1
    const ax = Math.abs(localX)
    const az = Math.abs(localZ)
    const tan = az > ax ? ax / az : (ax > 0 ? az / ax : 0)
    const magnitude = Math.min(length * Math.sqrt(1 + (tan * tan)), 1)
      * this._computeDirectionScale(this._resolveMovementProfile(inputState), inputState)

    return {
      worldX: worldX / directionLength,
      worldZ: worldZ / directionLength,
      magnitude,
    }
  }

  _updateWaterVerticalVelocity(inputState) {
    const swimSpeed = this.config.speed.walk * 0.9
    const ascend = inputState.space ? 1 : 0
    const descend = inputState.sneak ? 1 : 0
    const verticalInput = ascend - descend
    const surfaceY = this._getWaterSurfaceY()
    const immersion = surfaceY === null
      ? 0
      : THREE.MathUtils.clamp((surfaceY - this.position.y + 0.6) / 1.4, 0, 1)

    const targetVerticalSpeed = verticalInput * swimSpeed + (verticalInput === 0 ? immersion * 1.35 : 0)
    this.worldVelocity.y = THREE.MathUtils.lerp(this.worldVelocity.y, targetVerticalSpeed, 0.24)

    if (surfaceY !== null && this.position.y < surfaceY - 0.45 && verticalInput === 0) {
      this.worldVelocity.y = Math.max(this.worldVelocity.y, 0.6)
    }
  }

  _updateClimbVerticalVelocity(inputState) {
    const climbSpeed = Math.max(this.config.speed.walk * 0.9, 1.6)
    const ascend = inputState.space || inputState.forward ? 1 : 0
    const descend = inputState.sneak || inputState.shift || inputState.v || inputState.backward ? 1 : 0
    const verticalInput = ascend - descend

    if (verticalInput === 0) {
      this.worldVelocity.y = THREE.MathUtils.lerp(this.worldVelocity.y, 0, 0.72)
      if (Math.abs(this.worldVelocity.y) < 0.02) {
        this.worldVelocity.y = 0
      }
      return
    }

    this.worldVelocity.y = THREE.MathUtils.lerp(this.worldVelocity.y, verticalInput * climbSpeed, 0.58)
  }

  _createPoseProfiles() {
    const rawPoses = this.config.pose || {}
    const buildPose = (pose = {}) => {
      const radius = Number(pose.radius ?? 0.3)
      const height = Number(pose.height ?? 1.8)
      return {
        radius,
        height,
        eyeHeight: Number(pose.eyeHeight ?? (height - 0.18)),
      }
    }

    return {
      standing: buildPose(rawPoses.standing),
      crouching: buildPose(rawPoses.crouching),
    }
  }

  _updatePose(inputState) {
    const wantsCrouch = !!inputState.sneak
    const nextPoseKey = wantsCrouch ? 'crouching' : 'standing'

    if (nextPoseKey === this.currentPoseKey) {
      return
    }

    if (nextPoseKey === 'standing' && !this._canOccupyPose(this.position, 'standing')) {
      return
    }

    this.currentPoseKey = nextPoseKey
  }

  get currentPose() {
    return this.poses[this.currentPoseKey]
  }

  _canOccupyPose(position, poseKey) {
    const provider = this.experience.terrainDataManager || this.terrainProvider
    return this.collision.canOccupy(this.collision.playerBounds(position, this.poses[poseKey]), provider)
  }

  _resolveMovementProfile(inputState) {
    if (inputState.sneak) {
      return 'crouch'
    }
    if (this.isSprinting) {
      return 'run'
    }
    return 'walk'
  }

  _getGroundFriction() {
    const slipperiness = THREE.MathUtils.clamp(this.groundMovementProfile.slipperiness ?? 0.6, 0.01, 0.999)
    return (slipperiness / 0.6) * (this.config.physics?.groundFriction ?? 0.546)
  }

  _computeWorldDirection(inputState) {
    let localX = 0
    let localZ = 0

    if (inputState.forward)
      localZ -= MOVEMENT_DIRECTION_WEIGHTS.FORWARD
    if (inputState.backward)
      localZ += MOVEMENT_DIRECTION_WEIGHTS.BACKWARD
    if (inputState.left)
      localX -= MOVEMENT_DIRECTION_WEIGHTS.LEFT
    if (inputState.right)
      localX += MOVEMENT_DIRECTION_WEIGHTS.RIGHT

    const length = Math.sqrt(localX * localX + localZ * localZ)
    if (length > 0) {
      localX /= length
      localZ /= length
    }

    const cos = Math.cos(this.facingAngle)
    const sin = Math.sin(this.facingAngle)
    const worldX = localX * cos + localZ * sin
    const worldZ = -localX * sin + localZ * cos

    return { worldX, worldZ }
  }

  _computeDirectionScale(profile, inputState) {
    const multipliers = this.config.directionMultiplier?.[profile]
    if (!multipliers) {
      return 1
    }

    let scale = 1
    if (inputState.backward) {
      scale *= multipliers.backward ?? 1
    }
    if (inputState.left || inputState.right) {
      scale *= multipliers.lateral ?? 1
    }
    return scale
  }

  _getMinWorldY() {
    const minWorldY = Number(this.config.physics?.minWorldY)
    return Number.isFinite(minWorldY) ? minWorldY : null
  }

  _applySampledFloor(provider, previousY) {
    if (this.isInWater || this.isGrounded || this.position.y > previousY) {
      return
    }
    const { x, y, z } = this.position
    let surface
    if (this.groundSampler) {
      surface = this.groundSampler(x, z, y)
    }
    else if (!provider?.getCollisionBoxesWorld && provider?.getTopSolidYWorld) {
      const top = provider.getTopSolidYWorld(x, z)
      if (Number.isFinite(top)) {
        const floor = this._getMinWorldY()
        surface = floor !== null && top <= floor ? floor : top + 0.5
      }
    }
    if (Number.isFinite(surface) && y <= surface && surface <= previousY) {
      this.position.y = surface
      this.worldVelocity.y = 0
      this.isGrounded = true
    }
  }

  _applyWorldFloorClampToPosition(position, velocity = null) {
    const minWorldY = Number(this.config.physics?.minWorldY)
    if (!Number.isFinite(minWorldY) || position.y >= minWorldY) {
      return false
    }

    position.y = minWorldY
    if (velocity && velocity.y < 0) {
      velocity.y = 0
    }
    return true
  }

  _resolveMovementProfileForSupportBlock(block = null) {
    if (!block) {
      return getMinecraftBlockMovementProfile()
    }

    const legacyBlockType = getBlockTypeById(block?.id)
    const minecraftBlock = block?.minecraftBlock
    return getMinecraftBlockMovementProfile(
      minecraftBlock?.name || legacyBlockType?.name || block?.name || '',
      minecraftBlock?.properties || {},
    )
  }

  _syncMeshCustom() {
    this.group.position.copy(this.renderPosition)
  }

  _setupRespawnPoint() {
    this._updateRespawnPoint()
  }

  _updateRespawnPoint() {
    if (this._hasExplicitRespawnPoint) {
      if (!this._hasInitializedRespawn) {
        const target = this.config.respawn?.position
        if (target) {
          this.position.set(target.x, target.y, target.z)
          this.previousPosition.copy(this.position)
          this.renderPosition.copy(this.position)
          this.worldVelocity.set(0, 0, 0)
          this.groundedGraceTimer = 0
          this._syncMeshCustom()
          this._hasInitializedRespawn = true
        }
      }
      return
    }

    const provider = this.experience.terrainDataManager || this.terrainProvider
    if (!provider?.getTopSolidYWorld) {
      return
    }

    const centerX = Math.floor((provider.chunkWidth ?? 64) / 2)
    const centerZ = Math.floor((provider.chunkWidth ?? 64) / 2)
    const topY = provider.getTopSolidYWorld(centerX, centerZ)
    if (topY === null) {
      return
    }

    const surfaceY = topY + 10.5
    const respawnPos = { x: centerX, y: surfaceY + 0.05, z: centerZ }
    this.config.respawn.position = respawnPos

    if (!this._hasInitializedRespawn) {
      this.position.set(respawnPos.x, respawnPos.y, respawnPos.z)
      this.previousPosition.copy(this.position)
      this.renderPosition.copy(this.position)
      this.worldVelocity.set(0, 0, 0)
      this.groundedGraceTimer = 0
      this._syncMeshCustom()
      this._hasInitializedRespawn = true
    }
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z)
    this.previousPosition.copy(this.position)
    this.renderPosition.copy(this.position)
    this.worldVelocity.set(0, 0, 0)
    this.isGrounded = false
    this.groundedGraceTimer = 0
    this.tickAccumulator = 0
    this._resetMotionState()
    this._syncMeshCustom()
  }

  setRespawnPoint(x, y, z, movePlayer = true) {
    const nextPoint = {
      x: Number(x),
      y: Number(y),
      z: Number(z),
    }
    if (!Number.isFinite(nextPoint.x) || !Number.isFinite(nextPoint.y) || !Number.isFinite(nextPoint.z)) {
      return
    }

    this.config.respawn.position = nextPoint
    this._hasExplicitRespawnPoint = true

    if (movePlayer || !this._hasInitializedRespawn) {
      this.setPosition(nextPoint.x, nextPoint.y, nextPoint.z)
      this._hasInitializedRespawn = true
    }
  }

  respawn() {
    this._updateRespawnPoint()
    this._checkRespawn(true)
  }

  _checkRespawn(force = false) {
    const threshold = this.config.respawn?.thresholdY ?? -10
    if (!force && this.position.y > threshold) {
      return
    }

    const target = this.config.respawn?.position || { x: 10, y: 10, z: 10 }
    this.position.set(target.x, target.y, target.z)
    this.previousPosition.copy(this.position)
    this.renderPosition.copy(this.position)
    this.worldVelocity.set(0, 0, 0)
    this.isGrounded = false
    this.groundedGraceTimer = 0
    this.tickAccumulator = 0
    this._resetMotionState()
    this._syncMeshCustom()
  }

  _resetMotionState() {
    this.groundMovementProfile = getMinecraftBlockMovementProfile()
    this.jumpDelayTicks = 0
    this.horizontalCollision = false
    this.minorHorizontalCollision = false
    this.horizontalMoveSpeed = 0
  }

  getSpeedProfile(inputState) {
    if (inputState.sneak) {
      return LocomotionProfiles.CROUCH
    }
    if (this.isSprinting) {
      return LocomotionProfiles.RUN
    }
    return LocomotionProfiles.WALK
  }

  isMoving(inputState) {
    if (inputState.forward || inputState.backward || inputState.left || inputState.right) {
      return true
    }

    const horizontalSpeedSq = (this.worldVelocity.x * this.worldVelocity.x) + (this.worldVelocity.z * this.worldVelocity.z)
    return horizontalSpeedSq > 0.01
  }

  _getWaterSurfaceY() {
    // 世界里没有程序化生成的水面，原理图里的水方块不参与游泳判定
    return null
  }

  _isPositionInWater() {
    return false
  }

  _isTouchingClimbable(basePosition) {
    const provider = this.experience.terrainDataManager || this.terrainProvider
    if (!provider?.getBlockWorld) {
      return false
    }

    const bodyHeight = this.currentPose.height
    const probePadding = this.currentPose.radius + 0.12
    const minBlockX = Math.floor(basePosition.x - probePadding + 0.5) - 1
    const maxBlockX = Math.floor(basePosition.x + probePadding + 0.5) + 1
    const minBlockY = Math.floor(basePosition.y + 0.1 + 0.5) - 1
    const maxBlockY = Math.floor(basePosition.y + bodyHeight - 0.1 + 0.5) + 1
    const minBlockZ = Math.floor(basePosition.z - probePadding + 0.5) - 1
    const maxBlockZ = Math.floor(basePosition.z + probePadding + 0.5) + 1

    for (let worldX = minBlockX; worldX <= maxBlockX; worldX += 1) {
      for (let worldY = minBlockY; worldY <= maxBlockY; worldY += 1) {
        for (let worldZ = minBlockZ; worldZ <= maxBlockZ; worldZ += 1) {
          const block = provider.getBlockWorld(worldX, worldY, worldZ)
          const blockName = block?.minecraftBlock?.name || ''
          const blockProperties = block?.minecraftBlock?.properties || {}
          const isClimbable = block?.isClimbable || isMinecraftBlockClimbable(blockName, blockProperties)
          if (!isClimbable) {
            continue
          }

          if (this._isClimbableBlockOverlapping(basePosition, worldX, worldY, worldZ, block, bodyHeight)) {
            return true
          }
        }
      }
    }

    return false
  }

  _isClimbableBlockOverlapping(basePosition, worldX, worldY, worldZ, block, bodyHeight) {
    const playerMinX = basePosition.x - this.currentPose.radius
    const playerMaxX = basePosition.x + this.currentPose.radius
    const playerMinY = basePosition.y
    const playerMaxY = basePosition.y + bodyHeight
    const playerMinZ = basePosition.z - this.currentPose.radius
    const playerMaxZ = basePosition.z + this.currentPose.radius
    const sourceBoxes = Array.isArray(block?.collisionBoxes) && block.collisionBoxes.length
      ? block.collisionBoxes
      : [[0, 0, 0, 1, 1, 1]]

    for (const [minX, minY, minZ, maxX, maxY, maxZ] of sourceBoxes) {
      const boxMinX = (worldX - 0.5 + Number(minX)) - 0.08
      const boxMaxX = (worldX - 0.5 + Number(maxX)) + 0.08
      const boxMinY = worldY - 0.5 + Number(minY)
      const boxMaxY = worldY - 0.5 + Number(maxY)
      const boxMinZ = (worldZ - 0.5 + Number(minZ)) - 0.08
      const boxMaxZ = (worldZ - 0.5 + Number(maxZ)) + 0.08

      const intersects = playerMaxX >= boxMinX
        && playerMinX <= boxMaxX
        && playerMaxY >= boxMinY
        && playerMinY <= boxMaxY
        && playerMaxZ >= boxMinZ
        && playerMinZ <= boxMaxZ

      if (intersects) {
        return true
      }
    }

    return false
  }

  destroy() {
    if (this._respawnSetupTimer) {
      clearTimeout(this._respawnSetupTimer)
      this._respawnSetupTimer = null
    }
  }
}
