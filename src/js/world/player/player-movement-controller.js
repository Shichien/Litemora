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
    this.isSprinting = false
    this.groundedGraceTimer = 0
    this.flightConfig = {
      speedMultiplier: 10.79 / (this.config.speed?.run || 5.612),
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
      speedMultiplier: 1,
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
    return this.poses[this.currentPoseKey]?.eyeHeight ?? 1.62
  }

  update(inputState, isCombatActive) {
    if (this.isFlying) {
      this.isInWater = false
      this.isClimbing = false
      this._updateFlightPhysics(inputState, isCombatActive)
      return
    }

    this._updatePose(inputState)

    const rawDt = this.experience.time.delta * 0.001
    const clampedDt = Math.min(Math.max(rawDt, 0), this.maxPhysicsDelta)
    this.groundedGraceTimer = Math.max(0, this.groundedGraceTimer - clampedDt)
    this.tickAccumulator = Math.min(this.tickAccumulator + clampedDt, this.maxPhysicsDelta * 2)

    let iterations = 0
    while (this.tickAccumulator >= this.physicsTick && iterations < 8) {
      this.previousPosition.copy(this.position)
      this._stepCustomPhysics(inputState, isCombatActive)
      this.tickAccumulator -= this.physicsTick
      iterations++
    }

    const alpha = clamp01(this.tickAccumulator / this.physicsTick)
    this.renderPosition.lerpVectors(this.previousPosition, this.position, alpha)

    this._checkRespawn()
    this._syncMeshCustom()
  }

  toggleFlight() {
    this.isFlying = !this.isFlying
    this.isGrounded = false
    this.worldVelocity.set(0, 0, 0)
    this.tickAccumulator = 0
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

  jump(inputState = {}) {
    const canUseGroundedGrace = this.groundedGraceTimer > 0
    if (this.isFlying || (!this.isGrounded && !canUseGroundedGrace)) {
      return
    }

    this.worldVelocity.y = this.config.jumpForce

    if (inputState.sprint && inputState.forward && !inputState.backward && !inputState.sneak) {
      const boost = this.config.physics?.sprintJumpBoost ?? 4
      const forwardX = -Math.sin(this.facingAngle)
      const forwardZ = -Math.cos(this.facingAngle)
      this.worldVelocity.x += forwardX * boost
      this.worldVelocity.z += forwardZ * boost
    }

    this.isGrounded = false
    this.groundedGraceTimer = 0
  }

  _updateFlightPhysics(inputState, isCombatActive) {
    const rawDt = this.experience.time.delta * 0.001
    const clampedDt = Math.min(rawDt, 0.05)
    const { worldX, worldZ } = this._computeWorldDirection(inputState)

    const ascend = inputState.space ? 1 : 0
    const descend = inputState.sneak || inputState.shift || inputState.v ? 1 : 0
    const verticalInput = ascend - descend

    let speed = this.config.speed.run * this.flightConfig.speedMultiplier
    if (inputState.sprint) {
      speed *= 2
    }
    if (isCombatActive) {
      speed *= MOVEMENT_CONSTANTS.COMBAT_DECELERATION
    }

    this.worldVelocity.set(
      worldX * speed,
      verticalInput * speed,
      worldZ * speed,
    )

    this.position.addScaledVector(this.worldVelocity, clampedDt)
    this._applyWorldFloorClampToPosition(this.position, this.worldVelocity)
    this.previousPosition.copy(this.position)
    this.renderPosition.copy(this.position)
    this.isGrounded = this.position.y <= (this.config.physics?.minWorldY ?? Number.NEGATIVE_INFINITY)
    this._syncMeshCustom()
  }

  getCapsuleCenterWorld(target = new THREE.Vector3()) {
    return this.group.localToWorld(target.copy(this.capsule.offset))
  }

  _stepCustomPhysics(inputState, isCombatActive) {
    this.collision.prepareFrame()

    const provider = this.experience.terrainDataManager || this.terrainProvider
    const movementProfile = this._resolveMovementProfile(inputState)

    this.isSneaking = this.currentPoseKey === 'crouching'
    this.isSprinting = movementProfile === 'run'
    this.isInWater = this._isPositionInWater(this.position)
    this.isClimbing = !this.isInWater && this._isTouchingClimbable(this.position)

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
    const gravityPerSubStep = (this.config.physics?.gravityPerTick ?? 1.6) / subStepCount
    const verticalDragPerSubStep = (this.config.physics?.verticalDrag ?? 0.98) ** (1 / subStepCount)

    let workingGrounded = this.isGrounded

    for (let stepIndex = 0; stepIndex < subStepCount; stepIndex++) {
      const previousBasePosition = this._tmpPreviousBase.copy(this.position)

      const canClimb = !this.isInWater && this._isTouchingClimbable(this.position)
      this.isClimbing = canClimb
      this._updateGroundMovementProfile(this.position)
      const groundFriction = this._getGroundFriction()
      this._updateHorizontalVelocity(inputState, movementProfile, isCombatActive, groundFriction)

      if (this.isInWater) {
        this._updateWaterVerticalVelocity(inputState)
      }
      else if (canClimb) {
        this._updateClimbVerticalVelocity(inputState)
      }
      else if (!workingGrounded) {
        this.worldVelocity.y = (this.worldVelocity.y - gravityPerSubStep) * verticalDragPerSubStep
      }
      else if (this.worldVelocity.y < 0) {
        this.worldVelocity.y = 0
      }

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

      if (!this.isInWater && !canClimb && !playerState.isGrounded && playerState.worldVelocity.y <= 0) {
        this._snapToGround(playerState)
      }

      if (this._shouldClampSneakMovement(inputState, playerState)) {
        this._applySneakEdgeClamp(previousBasePosition, playerState)
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
    if (this.isGrounded) {
      this.groundedGraceTimer = Math.max(
        this.groundedGraceTimer,
        Number(this.config.physics?.jumpCoyoteTime ?? 0.1),
      )
    }

    if (this.isGrounded && this.worldVelocity.y < 0) {
      this.worldVelocity.y = 0
    }
  }

  _updateHorizontalVelocity(inputState, movementProfile, isCombatActive, groundFriction = null) {
    const { worldX, worldZ } = this._computeWorldDirection(inputState)
    const isMoving = this.isMoving(inputState)
    const dirScale = this._computeDirectionScale(movementProfile, inputState)

    let targetSpeed = this._getTargetHorizontalSpeed(movementProfile) * dirScale
    if (isCombatActive) {
      targetSpeed *= MOVEMENT_CONSTANTS.COMBAT_DECELERATION
    }

    const normalWalkSpeed = this.config.speed.walk || 4.317
    const speedRatio = normalWalkSpeed > 0 ? (targetSpeed / normalWalkSpeed) : 1

    if (this.isInWater) {
      const waterDrag = this.config.physics?.waterDrag ?? 0.85
      const waterAcceleration = this._getWaterAcceleration(speedRatio)
      this.worldVelocity.x *= waterDrag
      this.worldVelocity.z *= waterDrag
      if (isMoving) {
        this.worldVelocity.x += worldX * waterAcceleration
        this.worldVelocity.z += worldZ * waterAcceleration
      }
      return
    }

    if (this.isClimbing) {
      const climbDrag = this.config.physics?.climbDrag ?? 0.75
      const climbAcceleration = this._getClimbAcceleration(speedRatio)
      this.worldVelocity.x *= climbDrag
      this.worldVelocity.z *= climbDrag
      if (isMoving) {
        this.worldVelocity.x += worldX * climbAcceleration
        this.worldVelocity.z += worldZ * climbAcceleration
      }
      return
    }

    if (this.isGrounded) {
      const friction = Number.isFinite(groundFriction) ? groundFriction : this._getGroundFriction()
      const acceleration = isMoving ? this._getGroundAcceleration(speedRatio) : 0
      this.worldVelocity.x *= friction
      this.worldVelocity.z *= friction
      if (isMoving) {
        this.worldVelocity.x += worldX * acceleration
        this.worldVelocity.z += worldZ * acceleration
      }
    }
    else {
      const drag = this.config.physics?.airDrag ?? 0.91
      const acceleration = isMoving ? this._getAirAcceleration(speedRatio) : 0
      this.worldVelocity.x *= drag
      this.worldVelocity.z *= drag
      if (isMoving) {
        this.worldVelocity.x += worldX * acceleration
        this.worldVelocity.z += worldZ * acceleration
      }
    }

    if (Math.abs(this.worldVelocity.x) < 0.001) {
      this.worldVelocity.x = 0
    }
    if (Math.abs(this.worldVelocity.z) < 0.001) {
      this.worldVelocity.z = 0
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
    if (inputState.sprint && inputState.forward && !inputState.backward && !inputState.sneak) {
      return 'run'
    }
    if (inputState.sneak) {
      return 'crouch'
    }
    return 'walk'
  }

  _getTargetHorizontalSpeed(profile) {
    if (profile === 'run') {
      return this.config.speed.run
    }
    if (profile === 'crouch') {
      return this.config.speed.crouch
    }
    return this.config.speed.walk
  }

  _getGroundFriction() {
    const slipperiness = THREE.MathUtils.clamp(this._tmpMovementProfile.slipperiness ?? 0.6, 0.01, 0.999)
    return (slipperiness / 0.6) * (this.config.physics?.groundFriction ?? 0.546)
  }

  _getGroundAcceleration(speedRatio) {
    return 0.098 * this.physicsTickRate * Math.max(0, Number(speedRatio) || 0)
  }

  _getAirAcceleration(speedRatio) {
    return 0.02 * this.physicsTickRate * Math.max(0, Number(speedRatio) || 0)
  }

  _getWaterAcceleration(speedRatio) {
    return 0.015 * this.physicsTickRate * Math.max(0, Number(speedRatio) || 0)
  }

  _getClimbAcceleration(speedRatio) {
    return 0.04 * this.physicsTickRate * Math.max(0, Number(speedRatio) || 0)
  }

  _updateGroundMovementProfile(basePosition) {
    const maxSupportDrop = this.config.physics?.sneakSupportDrop ?? 0.55
    const supportSurface = this._getDominantSupportSurface(basePosition, maxSupportDrop)
    const profile = supportSurface?.movementProfile || getMinecraftBlockMovementProfile()
    this._tmpMovementProfile.slipperiness = profile.slipperiness ?? 0.6
    this._tmpMovementProfile.speedMultiplier = profile.speedMultiplier ?? 1
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
    this._syncMeshCustom()
  }

  getSpeedProfile(inputState) {
    if (inputState.sprint && inputState.forward && !inputState.backward && !inputState.sneak) {
      return LocomotionProfiles.RUN
    }
    if (inputState.sneak) {
      return LocomotionProfiles.CROUCH
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
    const provider = this.experience.terrainDataManager || this.terrainProvider
    if (!provider) {
      return null
    }

    if (provider.schematicOnlyMode) {
      return null
    }

    const waterOffset = provider.waterParams?.waterOffset
    if (!Number.isFinite(waterOffset)) {
      return null
    }

    const heightScale = provider.renderParams?.heightScale ?? 1
    return waterOffset * heightScale
  }

  _isPositionInWater(position) {
    const surfaceY = this._getWaterSurfaceY()
    if (surfaceY === null) {
      return false
    }

    if (position.y < (this.config.physics?.minWorldY ?? 0)) {
      return false
    }

    const provider = this.experience.terrainDataManager || this.terrainProvider
    const topSolidY = provider?.getTopSolidYWorld?.(position.x, position.z)
    if (Number.isFinite(topSolidY) && topSolidY >= (provider?.waterParams?.waterOffset ?? Number.POSITIVE_INFINITY)) {
      return false
    }

    return position.y <= surfaceY + 0.3
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
