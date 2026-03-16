import * as THREE from 'three'
import { MOVEMENT_CONSTANTS, MOVEMENT_DIRECTION_WEIGHTS } from '../../config/player-config.js'
import Experience from '../../experience.js'
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
    this.isSneaking = false
    this.isSprinting = false
    this.flightConfig = {
      speedMultiplier: 2.4,
      ignoreMiningSlowdown: true,
      groundWalkAnimationWhenMoving: true,
    }

    this.physicsTick = 1 / (this.config.physics?.tickRate || 20)
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

    setTimeout(() => {
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

  getEyeHeight() {
    return this.poses[this.currentPoseKey]?.eyeHeight ?? 1.62
  }

  update(inputState, isCombatActive) {
    if (this.isFlying) {
      this.isInWater = false
      this._updateFlightPhysics(inputState, isCombatActive)
      return
    }

    this._updatePose(inputState)

    const rawDt = this.experience.time.delta * 0.001
    const clampedDt = Math.min(Math.max(rawDt, 0), this.maxPhysicsDelta)
    this.tickAccumulator = Math.min(this.tickAccumulator + clampedDt, this.maxPhysicsDelta * 2)

    let stepped = false
    let iterations = 0
    while (this.tickAccumulator >= this.physicsTick && iterations < 8) {
      this.previousPosition.copy(this.position)
      this._stepCustomPhysics(inputState, isCombatActive)
      this.tickAccumulator -= this.physicsTick
      iterations++
      stepped = true
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

  shouldIgnoreMiningSlowdown() {
    return this.isFlying && this.flightConfig.ignoreMiningSlowdown
  }

  shouldSimulateGroundWalk(inputState) {
    return this.isFlying
      && this.flightConfig.groundWalkAnimationWhenMoving
      && this.isMoving(inputState)
  }

  setFlightConfig(config = {}) {
    if (config.ignoreMiningSlowdown !== undefined) {
      this.flightConfig.ignoreMiningSlowdown = !!config.ignoreMiningSlowdown
    }
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
    if (this.isFlying || !this.isGrounded) {
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
      speed *= 1.35
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

    this._updateHorizontalVelocity(inputState, movementProfile, isCombatActive)

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
    const verticalDragPerSubStep = Math.pow(this.config.physics?.verticalDrag ?? 0.98, 1 / subStepCount)

    let workingGrounded = this.isGrounded

    for (let stepIndex = 0; stepIndex < subStepCount; stepIndex++) {
      const previousBasePosition = this._tmpPreviousBase.copy(this.position)

      if (this.isInWater) {
        this._updateWaterVerticalVelocity(inputState)
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

      const didStepUp = this._tryStepUp(previousBasePosition, this._tmpAttemptedBase, playerState, workingGrounded)

      this._applyGroundSampler(playerState)

      if (!this.isInWater && !playerState.isGrounded && playerState.worldVelocity.y <= 0) {
        this._snapToGround(playerState)
      }

      if (this._shouldClampSneakMovement(inputState, playerState)) {
        this._applySneakEdgeClamp(previousBasePosition, playerState)
      }

      if (!this.isInWater && !didStepUp) {
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

    if (this.isGrounded && this.worldVelocity.y < 0) {
      this.worldVelocity.y = 0
    }
  }

  _updateHorizontalVelocity(inputState, movementProfile, isCombatActive) {
    const { worldX, worldZ } = this._computeWorldDirection(inputState)
    const isMoving = this.isMoving(inputState)
    const dirScale = this._computeDirectionScale(movementProfile, inputState)

    let targetSpeed = this._getTargetHorizontalSpeed(movementProfile) * dirScale
    if (isCombatActive) {
      targetSpeed *= MOVEMENT_CONSTANTS.COMBAT_DECELERATION
    }

    const targetVelocityX = isMoving ? worldX * targetSpeed : 0
    const targetVelocityZ = isMoving ? worldZ * targetSpeed : 0

    if (this.isInWater) {
      const response = this.config.physics?.response?.walk ?? 0.34
      this.worldVelocity.x = THREE.MathUtils.lerp(this.worldVelocity.x, targetVelocityX * 0.9, response)
      this.worldVelocity.z = THREE.MathUtils.lerp(this.worldVelocity.z, targetVelocityZ * 0.9, response)
      return
    }

    if (this.isGrounded) {
      const response = this._getGroundResponse(movementProfile)
      this.worldVelocity.x = THREE.MathUtils.lerp(this.worldVelocity.x, targetVelocityX, response)
      this.worldVelocity.z = THREE.MathUtils.lerp(this.worldVelocity.z, targetVelocityZ, response)

      if (!isMoving) {
        const friction = this.config.physics?.groundFriction ?? 0.546
        this.worldVelocity.x *= friction
        this.worldVelocity.z *= friction
      }
    }
    else {
      const response = this.config.physics?.response?.air ?? 0.08
      const drag = this.config.physics?.airDrag ?? 0.91
      this.worldVelocity.x = THREE.MathUtils.lerp(this.worldVelocity.x, targetVelocityX, response)
      this.worldVelocity.z = THREE.MathUtils.lerp(this.worldVelocity.z, targetVelocityZ, response)
      this.worldVelocity.x *= drag
      this.worldVelocity.z *= drag
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
    return collisions.length === 0
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

  _getGroundResponse(profile) {
    const response = this.config.physics?.response || {}
    if (profile === 'run') {
      return response.run ?? 0.4
    }
    if (profile === 'crouch') {
      return response.crouch ?? 0.28
    }
    return response.walk ?? 0.34
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

  _applyGroundSampler(playerState) {
    const provider = this.experience.terrainDataManager || this.terrainProvider

    if (!this.isInWater && !playerState.isGrounded && this.groundSampler) {
      const sampledY = this.groundSampler(
        playerState.basePosition.x,
        playerState.basePosition.z,
        playerState.basePosition.y,
      )

      if (sampledY !== null && sampledY !== undefined && playerState.worldVelocity.y <= 0) {
        const targetY = sampledY + 0.05
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
        const targetY = topY + 0.55
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

  _tryStepUp(previousBasePosition, attemptedBasePosition, playerState, wasGrounded = false) {
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
    const jumpClimbHeight = this.config.physics?.jumpClimbHeight ?? 1.2
    const isJumpingUpward = playerState.worldVelocity.y > 0.12
    const canUseGroundedStepHeight = (playerState.isGrounded || wasGrounded) && !isJumpingUpward
    const maxStepHeight = canUseGroundedStepHeight
      ? groundedStepHeight
      : (playerState.worldVelocity.y > 0.15 ? jumpClimbHeight : 0)

    if (maxStepHeight <= 0) {
      return false
    }

    const probeBase = this._tmpStepProbeBase.copy(attemptedBasePosition)
    probeBase.y = previousBasePosition.y + maxStepHeight

    if (!this._canOccupyPose(probeBase, this.currentPoseKey)) {
      return false
    }

    const supportDrop = this._getSupportDrop(probeBase, 0, 0, maxStepHeight + 0.05, {
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

    if (!horizontalBlocked && rise < 0.08) {
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

    const supportDrop = this._getSupportDrop(
      playerState.basePosition,
      0,
      0,
      null,
      this._getSupportProbeOptions(playerState),
    )
    const maxGroundedSupport = (this.config.physics?.snapToGroundDistance ?? 0.14) + 0.02

    if (supportDrop === null || supportDrop > maxGroundedSupport) {
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
    const provider = this.experience.terrainDataManager || this.terrainProvider
    if (!provider?.getCollisionBoxesWorld) {
      return null
    }

    const sampleY = position.y
    const maxDrop = Number.isFinite(maxDropOverride)
      ? maxDropOverride
      : (this.config.physics?.sneakSupportDrop ?? 0.55)
    let bestDrop = null
    const sampleOffsets = this._getSupportSampleOffsets(
      options.directionX ?? 0,
      options.directionZ ?? 0,
    )

    for (const sampleOffset of sampleOffsets) {
      const sampleX = position.x + offsetX + sampleOffset.x
      const sampleZ = position.z + offsetZ + sampleOffset.z
      const centerX = Math.floor(sampleX + 0.5)
      const centerZ = Math.floor(sampleZ + 0.5)
      const minBlockY = Math.floor(sampleY - maxDrop + 0.5) - 1
      const maxBlockY = Math.floor(sampleY + 0.5)

      for (let worldX = centerX - 1; worldX <= centerX + 1; worldX++) {
        for (let worldZ = centerZ - 1; worldZ <= centerZ + 1; worldZ++) {
          for (let worldY = minBlockY; worldY <= maxBlockY; worldY++) {
            const boxes = provider.getCollisionBoxesWorld(worldX, worldY, worldZ)
            if (!Array.isArray(boxes) || !boxes.length) {
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

              if (bestDrop === null || drop < bestDrop) {
                bestDrop = drop
              }
            }
          }
        }
      }
    }

    return bestDrop
  }

  _getSupportSampleOffsets(directionX = 0, directionZ = 0) {
    const footRadius = Math.max(0.05, this.capsule.radius - 0.02)
    const diagonalRadius = footRadius * 0.7071
    const sampleOffsets = [
      { x: 0, z: 0 },
      { x: footRadius, z: 0 },
      { x: -footRadius, z: 0 },
      { x: 0, z: footRadius },
      { x: 0, z: -footRadius },
      { x: diagonalRadius, z: diagonalRadius },
      { x: diagonalRadius, z: -diagonalRadius },
      { x: -diagonalRadius, z: diagonalRadius },
      { x: -diagonalRadius, z: -diagonalRadius },
    ]

    const directionLength = Math.hypot(directionX, directionZ)
    if (directionLength > 1e-5) {
      const normalX = directionX / directionLength
      const normalZ = directionZ / directionLength
      const tangentX = -normalZ
      const tangentZ = normalX
      const forwardRadius = footRadius * 0.96
      const shoulderRadius = footRadius * 0.58

      sampleOffsets.push(
        { x: normalX * forwardRadius, z: normalZ * forwardRadius },
        {
          x: (normalX * forwardRadius) + (tangentX * shoulderRadius),
          z: (normalZ * forwardRadius) + (tangentZ * shoulderRadius),
        },
        {
          x: (normalX * forwardRadius) - (tangentX * shoulderRadius),
          z: (normalZ * forwardRadius) - (tangentZ * shoulderRadius),
        },
      )
    }

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

  _syncMeshCustom() {
    this.group.position.copy(this.renderPosition)
  }

  _setupRespawnPoint() {
    this._updateRespawnPoint()
  }

  _updateRespawnPoint() {
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
    this.tickAccumulator = 0
    this._syncMeshCustom()
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
}
