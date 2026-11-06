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
 * - 保留现有胶囊碰撞系统与方块碰撞箱查询
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
    // View bobbing (MC ClientAvatarState): walked distance and bob amplitude
    this.walkDist = 0
    this.walkDistO = 0
    this.bob = 0
    this.bobO = 0
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
    this.capsule = {
      radius: 0.3,
      halfHeight: 0.6,
      offset: new THREE.Vector3(0, 0.9, 0),
    }
    this._applyPose('standing')

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

    this._tmpDirection = new THREE.Vector3()
    this._tmpNextPosition = new THREE.Vector3()
    this._tmpPreviousBase = new THREE.Vector3()
    this._tmpAttemptedBase = new THREE.Vector3()
    this._tmpResolvedBase = new THREE.Vector3()
    this._tmpStepProbeBase = new THREE.Vector3()
    this._tmpCenter = new THREE.Vector3()
    this._tmpBoxPoint = new THREE.Vector3()
    this._tmpMovementProfile = {
      slipperiness: 0.6,
      speedFactor: 1,
      jumpFactor: 1,
    }

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
      radius: this.capsule.radius,
      bodyHeight: (this.capsule.halfHeight * 2) + (this.capsule.radius * 2),
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
   * Interpolated view-bob inputs (MC ClientAvatarState).
   * @param {{walkDistance:number, bob:number}} [target]
   * @returns {{walkDistance:number, bob:number}} walkDistance is MC's
   *   "backwards interpolated" value, -(wd + (wd - wdO) * pt)
   */
  getViewBobState(target = { walkDistance: 0, bob: 0 }) {
    const pt = this.partialTick
    target.walkDistance = -(this.walkDist + (this.walkDist - this.walkDistO) * pt)
    target.bob = THREE.MathUtils.lerp(this.bobO, this.bob, pt)
    return target
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
        this._applyPose('standing')
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

  /**
   * Start-of-tick bookkeeping, in MC order: Camera.tick (eye height) and
   * AbstractClientPlayer.updateBob both read the previous tick's state.
   */
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

    // Bob target uses last tick's post-friction velocity (MC deltaMovement), in b/t.
    const horizontalBlocksPerTick = Math.hypot(this.worldVelocity.x, this.worldVelocity.z) * this.physicsTick
    const targetBob = this.isGrounded && !this.isFlying ? Math.min(0.1, horizontalBlocksPerTick) : 0
    this.bobO = this.bob
    this.bob += (targetBob - this.bob) * 0.4
    this.walkDistO = this.walkDist
  }

  _endTick() {
    const dx = this.position.x - this.previousPosition.x
    const dz = this.position.z - this.previousPosition.z
    const moved = Math.hypot(dx, dz)
    this.walkDist += moved * 0.6
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
    const jumpFactor = this._tmpMovementProfile.jumpFactor ?? 1
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

  getCapsuleCenterWorld(target = new THREE.Vector3()) {
    return this.group.localToWorld(target.copy(this.capsule.offset))
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
    this._updateGroundMovementProfile(this.position)
    const groundFriction = this._getGroundFriction()
    const usesWaterDrag = this.isInWater
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
    else if (frictionGrounded && this.worldVelocity.y < 0) {
      this.worldVelocity.y = 0
    }

    const predictedDisplacement = this._tmpDirection.copy(this.worldVelocity).multiplyScalar(this.physicsTick)
    const maxAxisDisplacement = Math.max(
      Math.abs(predictedDisplacement.x),
      Math.abs(predictedDisplacement.y),
      Math.abs(predictedDisplacement.z),
    )
    const subStepCount = THREE.MathUtils.clamp(
      Math.ceil(maxAxisDisplacement / 0.3),
      1,
      8,
    )
    const subTick = this.physicsTick / subStepCount
    const attemptedDx = predictedDisplacement.x
    const attemptedDz = predictedDisplacement.z
    const tickStartX = this.position.x
    const tickStartZ = this.position.z

    let workingGrounded = this.isGrounded
    let edgeClamped = false

    for (let stepIndex = 0; stepIndex < subStepCount; stepIndex++) {
      const previousBasePosition = this._tmpPreviousBase.copy(this.position)

      const canClimb = !this.isInWater && this._isTouchingClimbable(this.position)
      this.isClimbing = canClimb

      this._tmpNextPosition.copy(this.position).addScaledVector(this.worldVelocity, subTick)
      this._tmpAttemptedBase.copy(this._tmpNextPosition)

      const playerState = this._buildPlayerState(this._tmpNextPosition.clone(), workingGrounded)
      const candidates = this.collision.broadPhase(playerState, provider)
      const collisions = this.collision.narrowPhase(candidates, playerState)
      this.collision.resolveCollisions(collisions, playerState)

      const didStepUp = this._tryStepUp(
        previousBasePosition,
        this._tmpAttemptedBase,
        playerState,
        workingGrounded,
        collisions,
      )

      this._applyGroundSampler(playerState)

      // Snap only when walking off a small step; a falling or jumping player
      // lands through normal collision, so jump arcs keep MC's 12-tick cycle.
      if (frictionGrounded && !this.isInWater && !canClimb && !playerState.isGrounded && playerState.worldVelocity.y <= 0) {
        this._snapToGround(playerState)
      }

      if (this._shouldClampSneakMovement(inputState, playerState)) {
        const beforeX = playerState.basePosition.x
        const beforeZ = playerState.basePosition.z
        this._applySneakEdgeClamp(previousBasePosition, playerState)
        if (beforeX !== playerState.basePosition.x || beforeZ !== playerState.basePosition.z) {
          edgeClamped = true
        }
      }

      if (!this.isInWater && !canClimb && !didStepUp) {
        this._refreshGroundedState(playerState)
      }

      this._applyWorldFloor(playerState)

      this.position.copy(playerState.basePosition)
      this.worldVelocity.copy(playerState.worldVelocity)
      workingGrounded = playerState.isGrounded

      if (workingGrounded && this.worldVelocity.y < 0) {
        this.worldVelocity.y = 0
      }
    }

    this.isGrounded = workingGrounded
    this.isClimbing = !this.isInWater && this._isTouchingClimbable(this.position)
    this._updateHorizontalCollision(inputState, attemptedDx, attemptedDz, tickStartX, tickStartZ, edgeClamped)

    // Block speed factor (soul sand, honey, slime), from the block underfoot.
    this._updateGroundMovementProfile(this.position)
    const speedFactor = this.isGrounded ? (this._tmpMovementProfile.speedFactor ?? 1) : 1
    if (speedFactor !== 1) {
      this.worldVelocity.x *= speedFactor
      this.worldVelocity.z *= speedFactor
    }

    // Gravity after the move, then drag (MC: vy = (vy - 0.08) * 0.98).
    if (!this.isInWater && !this.isClimbing) {
      if (this.isGrounded) {
        if (this.worldVelocity.y < 0) {
          this.worldVelocity.y = 0
        }
      }
      else {
        const gravity = this.config.physics?.gravityPerTick ?? 1.6
        const verticalDrag = this.config.physics?.verticalDrag ?? 0.98
        this.worldVelocity.y = (this.worldVelocity.y - gravity) * verticalDrag
      }
    }

    if (usesWaterDrag) {
      // Water keeps its legacy drag, applied before the move.
    }
    else {
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
  _updateHorizontalCollision(inputState, attemptedDx, attemptedDz, startX, startZ, edgeClamped) {
    const actualDx = this.position.x - startX
    const actualDz = this.position.z - startZ
    const attemptedSq = (attemptedDx * attemptedDx) + (attemptedDz * attemptedDz)
    const differenceSq = ((attemptedDx - actualDx) ** 2) + ((attemptedDz - actualDz) ** 2)

    this.horizontalCollision = !edgeClamped && attemptedSq > 1e-8 && differenceSq > 1e-8
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
      const slip = THREE.MathUtils.clamp(this._tmpMovementProfile.slipperiness ?? 0.6, 0.01, 0.999)
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
        halfHeight: Math.max(0.05, (height - (radius * 2)) * 0.5),
        offsetY: height * 0.5,
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

    this._applyPose(nextPoseKey)
  }

  _applyPose(poseKey) {
    const pose = this.poses[poseKey] || this.poses.standing
    this.currentPoseKey = poseKey
    this.capsule.radius = pose.radius
    this.capsule.halfHeight = pose.halfHeight
    this.capsule.offset.set(0, pose.offsetY, 0)
  }

  _canOccupyPose(position, poseKey) {
    const provider = this.experience.terrainDataManager || this.terrainProvider
    if (!provider?.getBlockWorld) {
      return true
    }

    const pose = this.poses[poseKey] || this.poses.standing
    const state = {
      basePosition: position.clone(),
      center: this._tmpCenter.copy(position).add(new THREE.Vector3(0, pose.offsetY, 0)),
      halfHeight: pose.halfHeight,
      radius: pose.radius,
      worldVelocity: new THREE.Vector3(),
      isGrounded: false,
    }

    const candidates = this.collision.broadPhase(state, provider)
    const collisions = this.collision.narrowPhase(candidates, state)
    return !collisions.some((collision) => {
      if (collision?.ground) {
        return false
      }

      const normalY = Number(collision?.normal?.y || 0)
      if (normalY > 0.5) {
        return false
      }

      return Number(collision?.overlap || 0) > 1e-4
    })
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
    const slipperiness = THREE.MathUtils.clamp(this._tmpMovementProfile.slipperiness ?? 0.6, 0.01, 0.999)
    return (slipperiness / 0.6) * (this.config.physics?.groundFriction ?? 0.546)
  }

  _updateGroundMovementProfile(basePosition) {
    const maxSupportDrop = this.config.physics?.sneakSupportDrop ?? 0.55
    const supportSurface = this._getDominantSupportSurface(basePosition, maxSupportDrop)
    const profile = supportSurface?.movementProfile || getMinecraftBlockMovementProfile()
    this._tmpMovementProfile.slipperiness = profile.slipperiness ?? 0.6
    this._tmpMovementProfile.speedFactor = profile.speedFactor ?? 1
    this._tmpMovementProfile.jumpFactor = profile.jumpFactor ?? 1
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

  _buildPlayerState(basePosition, previousIsGrounded = false) {
    const center = new THREE.Vector3().copy(basePosition).add(this.capsule.offset)
    return {
      basePosition,
      center,
      halfHeight: this.capsule.halfHeight,
      radius: this.capsule.radius,
      worldVelocity: this.worldVelocity.clone(),
      isGrounded: previousIsGrounded,
    }
  }

  _getMinWorldY() {
    const minWorldY = Number(this.config.physics?.minWorldY)
    return Number.isFinite(minWorldY) ? minWorldY : null
  }

  _applyGroundSampler(playerState) {
    const provider = this.experience.terrainDataManager || this.terrainProvider
    const minWorldY = this._getMinWorldY()

    if (!this.isInWater && !playerState.isGrounded && this.groundSampler) {
      const sampledY = this.groundSampler(
        playerState.basePosition.x,
        playerState.basePosition.z,
        playerState.basePosition.y,
      )

      if (sampledY !== null && sampledY !== undefined && playerState.worldVelocity.y <= 0) {
        const targetY = minWorldY !== null && sampledY <= minWorldY + 1e-4
          ? minWorldY
          : sampledY + 0.05
        const dropDistance = playerState.basePosition.y - targetY

        if (dropDistance <= 0.6) {
          playerState.basePosition.y = targetY
          playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
          playerState.worldVelocity.y = 0
          playerState.isGrounded = true
        }
      }
    }

    if (
      !this.isInWater
      && !playerState.isGrounded
      && !provider?.getCollisionBoxesWorld
      && provider?.getTopSolidYWorld
      && playerState.worldVelocity.y <= 0
    ) {
      const topY = provider.getTopSolidYWorld(playerState.basePosition.x, playerState.basePosition.z)
      if (topY !== null && topY !== undefined) {
        const targetY = minWorldY !== null && topY <= minWorldY + 1e-4
          ? minWorldY
          : topY + 0.55
        const penetration = targetY - playerState.basePosition.y
        if (penetration > 0 && penetration <= 0.8) {
          playerState.basePosition.y = targetY
          playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
          playerState.worldVelocity.y = 0
          playerState.isGrounded = true
        }
      }
    }
  }

  _snapToGround(playerState) {
    const supportDrop = this._getSupportDrop(
      playerState.basePosition,
      0,
      0,
      null,
      this._getSupportProbeOptions(playerState),
    )
    const maxSnap = this.config.physics?.snapToGroundDistance ?? 0.14

    if (supportDrop === null || supportDrop > maxSnap) {
      return
    }

    playerState.basePosition.y -= supportDrop
    playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
    playerState.worldVelocity.y = 0
    playerState.isGrounded = true
  }

  _shouldClampSneakMovement(inputState, playerState) {
    return !!(inputState.sneak && playerState.isGrounded && (inputState.forward || inputState.backward || inputState.left || inputState.right))
  }

  _applySneakEdgeClamp(previousBasePosition, playerState) {
    const supportDrop = this._getSupportDrop(
      playerState.basePosition,
      0,
      0,
      null,
      this._getSupportProbeOptions(playerState),
    )
    if (supportDrop !== null && supportDrop <= (this.config.physics?.sneakSupportDrop ?? 0.55)) {
      return
    }

    playerState.basePosition.x = previousBasePosition.x
    playerState.basePosition.z = previousBasePosition.z
    playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
    playerState.worldVelocity.x = 0
    playerState.worldVelocity.z = 0
  }

  _tryStepUp(previousBasePosition, attemptedBasePosition, playerState, wasGrounded = false, collisions = []) {
    const desiredDeltaX = attemptedBasePosition.x - previousBasePosition.x
    const desiredDeltaZ = attemptedBasePosition.z - previousBasePosition.z
    const desiredHorizontalDistanceSq = (desiredDeltaX * desiredDeltaX) + (desiredDeltaZ * desiredDeltaZ)
    if (desiredHorizontalDistanceSq < 1e-5) {
      return false
    }

    const actualDeltaX = playerState.basePosition.x - previousBasePosition.x
    const actualDeltaZ = playerState.basePosition.z - previousBasePosition.z
    const actualHorizontalDistanceSq = (actualDeltaX * actualDeltaX) + (actualDeltaZ * actualDeltaZ)
    const horizontalBlocked = actualHorizontalDistanceSq < desiredHorizontalDistanceSq - 1e-4

    const groundedStepHeight = this.config.physics?.autoStepHeight ?? 0.6
    const jumpClimbHeight = this.config.physics?.jumpClimbHeight ?? 0.35
    const isJumpingUpward = playerState.worldVelocity.y > 0.08
    const isFalling = playerState.worldVelocity.y < -0.02
    const canUseGroundedStepHeight = (playerState.isGrounded || wasGrounded) && !isJumpingUpward
    const canUseAirborneStepHeight = !canUseGroundedStepHeight && !isJumpingUpward && !isFalling
    const maxStepHeight = canUseGroundedStepHeight
      ? groundedStepHeight
      : (canUseAirborneStepHeight ? jumpClimbHeight : 0)

    if (maxStepHeight <= 0) {
      return false
    }

    const touchesStepSurface = collisions.some((collision) => {
      const topY = Number(collision?.collisionBox?.maxY)
      if (!Number.isFinite(topY)) {
        return false
      }

      const rise = topY - previousBasePosition.y
      return rise >= 0.01 && rise <= maxStepHeight + 0.05
    })

    if (!horizontalBlocked && !touchesStepSurface) {
      return false
    }

    const probeBase = this._tmpStepProbeBase.copy(attemptedBasePosition)
    probeBase.y = previousBasePosition.y + maxStepHeight

    if (!this._canOccupyPose(probeBase, this.currentPoseKey)) {
      return false
    }

    const desiredHorizontalDistance = Math.sqrt(desiredHorizontalDistanceSq)
    const leadingFootOffset = Math.max(0.05, this.capsule.radius - 0.02)
    const supportOffsetX = (desiredDeltaX / desiredHorizontalDistance) * leadingFootOffset
    const supportOffsetZ = (desiredDeltaZ / desiredHorizontalDistance) * leadingFootOffset
    const supportDrop = this._getSupportDrop(probeBase, supportOffsetX, supportOffsetZ, maxStepHeight + 0.05, {
      directionX: desiredDeltaX,
      directionZ: desiredDeltaZ,
    })
    if (supportDrop === null) {
      return false
    }

    probeBase.y -= supportDrop

    const rise = probeBase.y - previousBasePosition.y
    if (rise < 0.01 || rise > maxStepHeight + 0.05) {
      return false
    }

    if (!this._canOccupyPose(probeBase, this.currentPoseKey)) {
      return false
    }

    playerState.basePosition.copy(probeBase)
    playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
    playerState.worldVelocity.y = 0
    playerState.isGrounded = true
    return true
  }

  _refreshGroundedState(playerState) {
    if (!playerState.isGrounded) {
      return
    }
    // Rising (jump impulse): MC only sets onGround from a downward collision,
    // so never pull a jumping player back onto the surface they just left.
    if (playerState.worldVelocity.y > 0) {
      playerState.isGrounded = false
      return
    }

    const minWorldY = this._getMinWorldY()
    const supportDrop = this._getSupportDrop(
      playerState.basePosition,
      0,
      0,
      null,
      this._getSupportProbeOptions(playerState),
    )
    const maxGroundedSupport = (this.config.physics?.snapToGroundDistance ?? 0.14) + 0.02

    if (supportDrop === null || supportDrop > maxGroundedSupport) {
      if (minWorldY !== null && playerState.basePosition.y <= minWorldY + 0.051) {
        playerState.basePosition.y = minWorldY
        playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
        playerState.worldVelocity.y = 0
        playerState.isGrounded = true
        return
      }

      playerState.isGrounded = false
      return
    }

    if (supportDrop > 0.001) {
      playerState.basePosition.y -= supportDrop
      playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
      playerState.worldVelocity.y = 0
    }
  }

  _getSupportProbeOptions(playerState) {
    const directionX = Number(playerState?.worldVelocity?.x || 0)
    const directionZ = Number(playerState?.worldVelocity?.z || 0)
    return { directionX, directionZ }
  }

  _applyWorldFloor(playerState) {
    const minWorldY = Number(this.config.physics?.minWorldY)
    if (!Number.isFinite(minWorldY)) {
      return
    }

    if (playerState.basePosition.y >= minWorldY) {
      return
    }

    playerState.basePosition.y = minWorldY
    playerState.center.copy(playerState.basePosition).add(this.capsule.offset)
    playerState.worldVelocity.y = 0
    playerState.isGrounded = true
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

  _getSupportDrop(position, offsetX = 0, offsetZ = 0, maxDropOverride = null, options = {}) {
    void options
    const maxDrop = Number.isFinite(maxDropOverride)
      ? maxDropOverride
      : (this.config.physics?.sneakSupportDrop ?? 0.55)
    const supportSurface = this._getDominantSupportSurface(position, maxDropOverride, {
      offsetX,
      offsetZ,
    })

    if (!supportSurface) {
      const minWorldY = this._getMinWorldY()
      if (minWorldY !== null) {
        const floorDrop = position.y - minWorldY
        if (floorDrop >= -0.001 && floorDrop <= maxDrop) {
          return Math.max(0, floorDrop)
        }
      }

      return null
    }

    return supportSurface.drop
  }

  _getSupportSampleOffsets(directionX = 0, directionZ = 0) {
    void directionX
    void directionZ
    const footRadius = Math.max(0.05, this.capsule.radius - 0.02)
    const innerRadius = footRadius * 0.5
    const diagonalRadius = footRadius * 0.7071
    const sampleOffsets = [
      { x: 0, z: 0 },
      { x: footRadius, z: 0 },
      { x: -footRadius, z: 0 },
      { x: 0, z: footRadius },
      { x: 0, z: -footRadius },
      { x: innerRadius, z: 0 },
      { x: -innerRadius, z: 0 },
      { x: 0, z: innerRadius },
      { x: 0, z: -innerRadius },
      { x: diagonalRadius, z: diagonalRadius },
      { x: diagonalRadius, z: -diagonalRadius },
      { x: -diagonalRadius, z: diagonalRadius },
      { x: -diagonalRadius, z: -diagonalRadius },
    ]

    const deduped = []
    const seen = new Set()
    for (const sample of sampleOffsets) {
      const key = `${Math.round(sample.x * 1000)},${Math.round(sample.z * 1000)}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      deduped.push(sample)
    }

    return deduped
  }

  _getDominantSupportSurface(position, maxDropOverride = null, options = {}) {
    const provider = this.experience.terrainDataManager || this.terrainProvider
    if (!provider?.getBlockWorld && !provider?.getCollisionBoxesWorld) {
      return null
    }

    const sampleY = position.y
    const maxDrop = Number.isFinite(maxDropOverride)
      ? maxDropOverride
      : (this.config.physics?.sneakSupportDrop ?? 0.55)
    const offsetX = Number(options.offsetX || 0)
    const offsetZ = Number(options.offsetZ || 0)
    const surfaceBuckets = new Map()

    for (const sampleOffset of this._getSupportSampleOffsets()) {
      const sampleX = position.x + offsetX + sampleOffset.x
      const sampleZ = position.z + offsetZ + sampleOffset.z
      const sampleSupport = this._getSupportSurfaceAtSample(provider, sampleX, sampleY, sampleZ, maxDrop)
      if (!sampleSupport) {
        continue
      }

      const bucketKey = Math.round(sampleSupport.topY * 1000)
      if (!surfaceBuckets.has(bucketKey)) {
        surfaceBuckets.set(bucketKey, {
          topY: sampleSupport.topY,
          drop: sampleSupport.drop,
          sampleCount: 0,
          profileCounts: new Map(),
        })
      }

      const bucket = surfaceBuckets.get(bucketKey)
      bucket.sampleCount += 1
      bucket.drop = Math.min(bucket.drop, sampleSupport.drop)
      if (sampleSupport.movementProfile) {
        bucket.profileCounts.set(
          sampleSupport.movementProfile,
          (bucket.profileCounts.get(sampleSupport.movementProfile) || 0) + 1,
        )
      }
    }

    const sampleCountThreshold = Math.max(2, Math.ceil(this._getSupportSampleOffsets().length * 0.25))
    const substantialSurfaces = [...surfaceBuckets.values()]
      .filter(surface => surface.sampleCount >= sampleCountThreshold)

    const bestSurface = this._selectBestSupportSurface(
      substantialSurfaces.length ? substantialSurfaces : [...surfaceBuckets.values()],
    )

    if (!bestSurface) {
      return null
    }

    return {
      topY: bestSurface.topY,
      drop: bestSurface.drop,
      sampleCount: bestSurface.sampleCount,
      movementProfile: this._pickDominantMovementProfile(bestSurface.profileCounts),
    }
  }

  _getSupportSurfaceAtSample(provider, sampleX, sampleY, sampleZ, maxDrop) {
    const centerX = Math.floor(sampleX + 0.5)
    const centerZ = Math.floor(sampleZ + 0.5)
    const minBlockY = Math.floor(sampleY - maxDrop + 0.5) - 1
    const maxBlockY = Math.floor(sampleY + 0.5)
    let bestSupport = null

    for (let worldX = centerX - 1; worldX <= centerX + 1; worldX += 1) {
      for (let worldZ = centerZ - 1; worldZ <= centerZ + 1; worldZ += 1) {
        for (let worldY = minBlockY; worldY <= maxBlockY; worldY += 1) {
          const block = provider?.getBlockWorld?.(worldX, worldY, worldZ) || null
          const movementProfile = this._resolveMovementProfileForSupportBlock(block)
          const boxes = this._getSupportWorldCollisionBoxes(provider, block, worldX, worldY, worldZ)
          if (!boxes.length) {
            continue
          }

          for (const box of boxes) {
            if (
              sampleX < box.minX - 1e-4
              || sampleX > box.maxX + 1e-4
              || sampleZ < box.minZ - 1e-4
              || sampleZ > box.maxZ + 1e-4
            ) {
              continue
            }

            const drop = sampleY - box.maxY
            if (drop < -0.001 || drop > maxDrop) {
              continue
            }

            if (
              !bestSupport
              || drop < bestSupport.drop - 1e-4
              || (
                Math.abs(drop - bestSupport.drop) <= 1e-4
                && box.maxY > bestSupport.topY + 1e-4
              )
            ) {
              bestSupport = {
                topY: box.maxY,
                drop: Math.max(0, drop),
                movementProfile,
              }
            }
          }
        }
      }
    }

    return bestSupport
  }

  _getSupportWorldCollisionBoxes(provider, block, worldX, worldY, worldZ) {
    if (block?.hasCollision) {
      const localBoxes = Array.isArray(block.collisionBoxes) && block.collisionBoxes.length
        ? block.collisionBoxes
        : [[0, 0, 0, 1, 1, 1]]
      return localBoxes.map(([minX, minY, minZ, maxX, maxY, maxZ]) => ({
        minX: (worldX - 0.5) + Number(minX),
        minY: (worldY - 0.5) + Number(minY),
        minZ: (worldZ - 0.5) + Number(minZ),
        maxX: (worldX - 0.5) + Number(maxX),
        maxY: (worldY - 0.5) + Number(maxY),
        maxZ: (worldZ - 0.5) + Number(maxZ),
      }))
    }

    const worldBoxes = provider?.getCollisionBoxesWorld?.(worldX, worldY, worldZ)
    return Array.isArray(worldBoxes) ? worldBoxes : []
  }

  _resolveMovementProfileForSupportBlock(block = null) {
    if (!block) {
      return null
    }

    const legacyBlockType = getBlockTypeById(block?.id)
    const minecraftBlock = block?.minecraftBlock
    return getMinecraftBlockMovementProfile(
      minecraftBlock?.name || legacyBlockType?.name || block?.name || '',
      minecraftBlock?.properties || {},
    )
  }

  _pickDominantMovementProfile(profileCounts = new Map()) {
    let bestProfile = null
    let bestCount = -1

    for (const [profile, count] of profileCounts.entries()) {
      if (count > bestCount) {
        bestProfile = profile
        bestCount = count
      }
    }

    return bestProfile || null
  }

  _selectBestSupportSurface(surfaces = []) {
    let bestSurface = null

    for (const surface of surfaces) {
      if (!bestSurface) {
        bestSurface = surface
        continue
      }

      if (surface.topY > bestSurface.topY + 1e-4) {
        bestSurface = surface
        continue
      }

      if (Math.abs(surface.topY - bestSurface.topY) <= 1e-4) {
        if (surface.sampleCount > bestSurface.sampleCount) {
          bestSurface = surface
          continue
        }

        if (surface.sampleCount === bestSurface.sampleCount && surface.drop < bestSurface.drop - 1e-4) {
          bestSurface = surface
        }
      }
    }

    return bestSurface
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

  /** Teleports must not count as walking (bob) or carry jump/collision state. */
  _resetMotionState() {
    this.walkDistO = this.walkDist
    this.bob = 0
    this.bobO = 0
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

    const bodyHeight = (this.capsule.halfHeight * 2) + (this.capsule.radius * 2)
    const probePadding = this.capsule.radius + 0.12
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
    const playerMinX = basePosition.x - this.capsule.radius
    const playerMaxX = basePosition.x + this.capsule.radius
    const playerMinY = basePosition.y
    const playerMaxY = basePosition.y + bodyHeight
    const playerMinZ = basePosition.z - this.capsule.radius
    const playerMaxZ = basePosition.z + this.capsule.radius
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
