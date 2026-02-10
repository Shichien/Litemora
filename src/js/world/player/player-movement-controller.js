import * as THREE from 'three'
import { MOVEMENT_CONSTANTS, MOVEMENT_DIRECTION_WEIGHTS } from '../../config/player-config.js'
import Experience from '../../experience.js'
import { LocomotionProfiles } from './animation-config.js'
import PlayerCollisionSystem from './player-collision.js'

/**
 * 玩家移动控制器
 * - 支持 Rapier 物理与自研物理两套分支
 * - 通过胶囊体与地形方块碰撞来实现位移、跳跃与跌落处理
 */
export class PlayerMovementController {
  constructor(config) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.config = config

    this.isGrounded = false

    // 自研碰撞参数
    this.gravity = -9.81
    this.position = new THREE.Vector3(0, 0, 0) // 角色脚底点
    this.worldVelocity = new THREE.Vector3()
    this.capsule = {
      radius: 0.3,
      halfHeight: 0.55, // cylinder 半高
      offset: new THREE.Vector3(0, 0.85, 0), // 胶囊中心相对脚底位置
    }
    this.collision = new PlayerCollisionSystem()
    // 无限地形查询入口：ChunkManager（World 中会挂到 experience.terrainDataManager）
    this.terrainProvider = this.experience.terrainDataManager
    this._hasInitializedRespawn = false

    // 角色朝向角度（弧度）- 通過旋轉 group 實現
    this.facingAngle = config.facingAngle ?? Math.PI

    // 創建父容器 group
    this.group = new THREE.Group()
    this.group.rotation.y = this.facingAngle // 初始化 group 旋轉
    this.scene.add(this.group)

    setTimeout(() => {
      // 初始化重生点监听：地形数据准备后更新到地形中心顶面
      this._setupRespawnPoint()
    }, 1000)
  }

  /**
   * 設置角色朝向角度
   * @param {number} angle - 朝向角度（弧度）
   */
  setFacing(angle) {
    this.facingAngle = angle
    this.group.rotation.y = angle
  }

  /**
   * 每帧更新入口
   * @param {{forward:boolean,backward:boolean,left:boolean,right:boolean,shift:boolean,v:boolean}} inputState 输入状态
   * @param {boolean} isCombatActive 是否处于战斗减速
   */
  update(inputState, isCombatActive) {
    this._updateCustomPhysics(inputState, isCombatActive)
  }

  /**
   * 角色跳跃：依赖当前分支调用不同实现
   */
  jump() {
    if (this.isGrounded) {
      this.worldVelocity.y = this.config.jumpForce
      this.isGrounded = false
    }
  }

  /**
   * 获取胶囊体中心的世界坐标
   * @param {THREE.Vector3} target 输出向量
   * @returns {THREE.Vector3} 胶囊体中心的世界坐标
   */
  getCapsuleCenterWorld(target = new THREE.Vector3()) {
    return this.group.localToWorld(target.copy(this.capsule.offset))
  }

  /**
   * ====================== 自研物理分支 ======================
   */
  /**
   * 自研物理主循环
   * - 处理输入 -> 水平速度
   * - 应用重力 -> 预测位置 -> 碰撞修正
   * - 同步位置与状态
   * @param {{forward:boolean,backward:boolean,left:boolean,right:boolean,shift:boolean,v:boolean}} inputState 输入状态
   * @param {boolean} isCombatActive 是否战斗减速
   */
  _updateCustomPhysics(inputState, isCombatActive) {
    const dt = this.experience.time.delta * 0.001
    this.collision.prepareFrame()

    // 计算输入方向（世界坐标）
    const { worldX, worldZ } = this._computeWorldDirection(inputState)

    // 水平速度
    if (isCombatActive) {
      this.worldVelocity.multiplyScalar(MOVEMENT_CONSTANTS.COMBAT_DECELERATION)
    }
    else {
      let currentSpeed = this.config.speed.walk
      let profile = 'walk'
      if (inputState.shift) {
        currentSpeed = this.config.speed.run
        profile = 'run'
      }
      else if (inputState.v) {
        currentSpeed = this.config.speed.crouch
        profile = 'crouch'
      }

      const dirScale = this._computeDirectionScale(profile, inputState)
      this.worldVelocity.x = worldX * currentSpeed * dirScale
      this.worldVelocity.z = worldZ * currentSpeed * dirScale
    }

    // 重力
    this.worldVelocity.y += this.gravity * dt

    // 预测位置
    const nextPosition = new THREE.Vector3().copy(this.position).addScaledVector(this.worldVelocity, dt)

    // 构建胶囊状态（继承上一帧的 isGrounded 状态，避免高频切换）
    const playerState = this._buildPlayerState(nextPosition, this.isGrounded)

    // 地形查询提供者：优先使用 experience 挂载的 ChunkManager
    const provider = this.experience.terrainDataManager || this.terrainProvider
    const candidates = this.collision.broadPhase(playerState, provider)
    const collisions = this.collision.narrowPhase(candidates, playerState)
    this.collision.resolveCollisions(collisions, playerState)

    // 同步结果
    // 状态保持：如果上一帧是 grounded，且当前没有明显上升速度，保持 grounded 状态
    // 这样可以避免因数值精度或微小振荡导致的高频切换
    if (this.isGrounded && !playerState.isGrounded && playerState.worldVelocity.y < 0.5) {
      // 上一帧在地面，当前帧未检测到地面碰撞，但速度向下或很小，保持 grounded
      playerState.isGrounded = true
    }
    // 如果明显上升（跳跃），则清除 grounded 状态
    if (playerState.worldVelocity.y > 1.0) {
      playerState.isGrounded = false
    }

    this.isGrounded = playerState.isGrounded
    this.position.copy(playerState.basePosition)
    this.worldVelocity.copy(playerState.worldVelocity)

    // 超界重生
    this._checkRespawn()

    this._syncMeshCustom()
  }

  /**
   * 将输入方向从角色本地空间转换到世界空间
   * @param {{forward:boolean,backward:boolean,left:boolean,right:boolean}} inputState 输入状态
   * @returns {{worldX:number, worldZ:number}} 世界坐标系方向
   */
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

  /**
   * 依据当前档位与输入方向计算额外方向倍率
   * - 后退单独衰减
   * - 任意左右输入再叠乘侧向衰减
   * @param {'walk'|'run'|'crouch'} profile
   * @param {{forward:boolean,backward:boolean,left:boolean,right:boolean}} inputState
   * @returns {number} 方向倍率
   */
  _computeDirectionScale(profile, inputState) {
    const multipliers = this.config.directionMultiplier?.[profile]
    if (!multipliers)
      return 1

    let scale = 1
    if (inputState.backward)
      scale *= multipliers.backward ?? 1
    if (inputState.left || inputState.right)
      scale *= multipliers.lateral ?? 1

    return scale
  }

  /**
   * 构建当前胶囊体状态
   * @param {THREE.Vector3} basePosition 脚底世界坐标
   * @param {boolean} previousIsGrounded 上一帧的 isGrounded 状态（用于状态保持）
   * @returns {{ basePosition:THREE.Vector3, center:THREE.Vector3, halfHeight:number, radius:number, worldVelocity:THREE.Vector3, isGrounded:boolean }} 当前帧胶囊体状态（供碰撞系统就地修改）
   */
  _buildPlayerState(basePosition, previousIsGrounded = false) {
    const center = new THREE.Vector3().copy(basePosition).add(this.capsule.offset)
    return {
      basePosition,
      center,
      halfHeight: this.capsule.halfHeight,
      radius: this.capsule.radius,
      worldVelocity: this.worldVelocity,
      // 初始化为上一帧状态，碰撞检测会更新它
      isGrounded: previousIsGrounded,
    }
  }

  /**
   * 同步 Three.js group 位置（自研分支）
   */
  _syncMeshCustom() {
    this.group.position.copy(this.position)
  }

  /**
   * 初始化重生点：优先使用已存在的地形容器，地形生成完成后再更新
   */
  _setupRespawnPoint() {
    // Step1：chunk 场景在创建 Player 之前已初始化完成
    this._updateRespawnPoint()
  }

  /**
   * 将重生点设置为 chunk(0,0) 的中心列最高方块顶面
   */
  _updateRespawnPoint() {
    const provider = this.experience.terrainDataManager || this.terrainProvider
    if (!provider?.getTopSolidYWorld) {
      return
    }

    const centerX = Math.floor((provider.chunkWidth ?? 64) / 2)
    const centerZ = Math.floor((provider.chunkWidth ?? 64) / 2)
    const topY = provider.getTopSolidYWorld(centerX, centerZ)
    if (topY === null)
      return

    // 顶面为方块中心 +0.5，再抬高一点防止穿模
    const surfaceY = topY + 10.5
    const respawnPos = { x: centerX, y: surfaceY + 0.05, z: centerZ }

    this.config.respawn.position = respawnPos

    // 首次初始化时同步角色位置，避免出生在地形下方
    if (!this._hasInitializedRespawn) {
      this.position.set(respawnPos.x, respawnPos.y, respawnPos.z)
      this.worldVelocity.set(0, 0, 0)
      this._syncMeshCustom()
      this._hasInitializedRespawn = true
    }
  }

  /**
   * 手动移动角色到指定位置 (瞬间传送)
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.position.set(x, y, z)
    this.worldVelocity.set(0, 0, 0)
    this.isGrounded = false
    this._syncMeshCustom()
  }

  /**
   * 手动触发重生
   */
  respawn() {
    this._updateRespawnPoint()
    this._checkRespawn(true)
  }

  /**
   * 跌出世界后的重生处理
   * @param {boolean} force - 是否强制重生
   */
  _checkRespawn(force = false) {
    const threshold = this.config.respawn?.thresholdY ?? -10
    if (!force && this.position.y > threshold)
      return

    const target = this.config.respawn?.position || { x: 10, y: 10, z: 10 }
    this.position.set(target.x, target.y, target.z)
    this.worldVelocity.set(0, 0, 0)
    this.isGrounded = false
    this._syncMeshCustom()
  }

  /**
   * 获取动画速度档位
   * @param {{shift:boolean,v:boolean}} inputState 输入状态
   * @returns {LocomotionProfiles} 当前档位
   */
  getSpeedProfile(inputState) {
    if (inputState.shift)
      return LocomotionProfiles.RUN
    if (inputState.v)
      return LocomotionProfiles.CROUCH
    return LocomotionProfiles.WALK
  }

  /**
   * 是否有任何移动输入
   * @param {{forward:boolean,backward:boolean,left:boolean,right:boolean}} inputState 输入状态
   * @returns {boolean} 是否移动
   */
  isMoving(inputState) {
    return inputState.forward || inputState.backward || inputState.left || inputState.right
  }
}
