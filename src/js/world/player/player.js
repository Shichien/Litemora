import * as THREE from 'three'
import { useSkinStore } from '../../../pinia/skinStore.js'
import { PLAYER_CONFIG } from '../../config/player-config.js'
import { SHADOW_QUALITY } from '../../config/shadow-config.js'
import { SKIN_LIST } from '../../config/skin-config.js'
import Experience from '../../experience.js'
import emitter from '../../utils/event/event-bus.js'
import {
  AnimationCategories,
  AnimationClips,
  AnimationStates,
  timeScaleConfig,
} from './animation-config.js'
import { resolveDirectionInput } from './input-resolver.js'
import { PlayerAnimationController } from './player-animation-controller.js'
import { PlayerMovementController } from './player-movement-controller.js'

const SETTINGS_MOUSE_SENSITIVITY_BASE = 0.03
const PLAYER_MOUSE_SENSITIVITY_RATIO = PLAYER_CONFIG.mouseSensitivity / SETTINGS_MOUSE_SENSITIVITY_BASE

export default class Player {
  constructor(experience = null) {
    // 使用外部传入的 experience，如果未传入则创建新的（保持向后兼容）
    this.experience = experience || new Experience()
    this.scene = this.experience.scene
    this.resources = this.experience.resources
    this.time = this.experience.time
    this.debug = this.experience.debug
    this.renderer = this.experience.renderer // 用于控制速度线效果

    // Config
    // 深拷贝配置，避免调试修改污染默认值
    this.config = JSON.parse(JSON.stringify(PLAYER_CONFIG))
    this.targetFacingAngle = this.config.facingAngle // 目标朝向，用于平滑插值

    // FPS Calculation
    this._fontFrames = 0
    this._lastTime = performance.now()
    this._currentFps = 60

    // 速度线当前透明度
    this._speedLineOpacity = 0

    // HUD 更新阈值控制：位置/朝向变化超过阈值才触发 emit
    this._lastEmitPosition = new THREE.Vector3() // 上次 emit 时的位置
    this._lastEmitFacingAngle = 0 // 上次 emit 时的朝向角度
    this._positionThreshold = 1 // 位置变化阈值：移动超过 1 单位才更新
    this._angleThreshold = Math.PI / 60 // 角度变化阈值：转动超过 1° (π/180 弧度) 才更新

    // Input state
    this.inputState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      control: false,
      sprint: false,
      shift: false,
      v: false,
      space: false,
    }

    // 攻击左右手交替状态（toggle）
    this._useLeftStraight = true // 直拳：true=左手, false=右手
    this._useLeftHook = true // 勾拳：true=左手, false=右手
    // 挖掘状态
    this.isMining = false
    this._hideForFirstPerson = false
    this.isFirstPersonView = false

    // Resource - 使用当前选中的皮肤
    const skinStore = useSkinStore()
    this.resource = this._getModelResource(skinStore.currentSkinId)

    // Controllers
    this.movement = new PlayerMovementController(this.config)

    // Only set up model if resource is available
    if (this.resource) {
      this.setModel()
      // Animation Controller needs model
      this.animation = new PlayerAnimationController(this.model, this.resource.animations)
    }
    else {
      // Create a placeholder model that will be replaced when resources load
      this.model = new THREE.Group()
      this.model.name = 'player-placeholder'
      this.movement.group.add(this.model)
      this.animation = null

      // Listen for core:ready to set up model later (emitted when resources finish loading)
      this._onCoreReady = this._onCoreReady.bind(this)
      emitter.once('core:ready', this._onCoreReady)
    }

    this.setupInputListeners()

    // 监听皮肤变更事件
    emitter.on('skin:changed', this._handleSkinChange.bind(this))

    // Shadow quality event listener
    this._handleShadowQuality = this._handleShadowQuality.bind(this)
    emitter.on('shadow:quality-changed', this._handleShadowQuality)

    // Debug
    if (this.debug.active) {
      this.debugFolder = this.debug.ui.addFolder({
        title: 'Player',
        expanded: false,
      })
      this.debugInit()
    }
  }

  /**
   * Handle shadow quality change event
   * @param {{ quality: string }} payload - Shadow quality payload
   */
  _handleShadowQuality(payload) {
    const shouldCastShadow = payload.quality !== SHADOW_QUALITY.LOW
    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = shouldCastShadow
      }
    })
  }

  _applySettingsMouseSensitivity(value) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      return
    }

    this.config.mouseSensitivity = Math.max(0.0001, numericValue * PLAYER_MOUSE_SENSITIVITY_RATIO)
  }

  /**
   * 根据 skinId 获取模型资源
   * @param {string} skinId - 皮肤 ID
   * @returns {object} GLTF resource
   */
  _getModelResource(skinId) {
    // Check if resources are loaded yet
    if (!this.resources.items) {
      console.warn('[Player] Resources not loaded yet, will retry on resources ready')
      return null
    }

    const skinConfig = SKIN_LIST.find(s => s.id === skinId)
    if (!skinConfig) {
      // Try to get playerModel, but handle case where resources aren't loaded
      const fallback = this.resources.items?.playerModel
      if (!fallback) {
        console.warn('[Player] Player model not loaded yet, will retry on resources ready')
        return null
      }
      return fallback
    }

    // 资源名称约定：skinId + 'Model' (如 steveModel, alexModel)
    const resourceName = `${skinId}Model`
    const resource = this.resources.items[resourceName] || this.resources.items.playerModel
    if (!resource) {
      console.warn('[Player] Model resource not found:', resourceName)
      return null
    }
    return resource
  }

  /**
   * Handler for when core is ready (resources loaded) - set up player model
   */
  _onCoreReady() {
    console.log('[Player] Core ready, setting up player model')
    const skinStore = useSkinStore()
    this.resource = this._getModelResource(skinStore.currentSkinId)

    if (!this.resource) {
      console.warn('[Player] Still no resource after core ready, player will use placeholder')
      return
    }

    // Remove placeholder
    if (this.model && this.model.name === 'player-placeholder') {
      this.movement.group.remove(this.model)
    }

    this.setModel()
    this.animation = new PlayerAnimationController(this.model, this.resource.animations)
    console.log('[Player] Player model set up successfully')
  }

  /**
   * 切换皮肤模型
   * @param {{ skinId: string }} payload - 皮肤变更事件参数
   */
  _handleSkinChange({ skinId }) {
    const resource = this._getModelResource(skinId)

    // 移除旧模型 (only if it's not a placeholder)
    if (this.model && this.model.name !== 'player-placeholder') {
      this.movement.group.remove(this.model)
    }

    // 设置新模型资源
    this.resource = resource
    if (!resource) {
      console.warn('[Player] Cannot change skin: resource is null')
      return
    }

    this.setModel()

    // 重新初始化动画控制器
    if (this.animation) {
      this.animation.dispose()
    }
    this.animation = new PlayerAnimationController(this.model, this.resource.animations)
  }

  setModel() {
    if (!this.resource) {
      console.warn('[Player] Cannot setModel: resource is null')
      return
    }
    this.model = this.resource.scene
    // 模型始終保持 rotation.y = Math.PI，確保動畫正常播放
    // 整體朝向通過父容器 movement.group 控制
    this.model.rotation.y = Math.PI
    this.model.updateMatrixWorld()
    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.material.side = THREE.FrontSide
        child.material.transparent = true
        // 启用 Layer 1，用于预览相机渲染
        child.layers.enable(1)
      }
    })

    this.model.children[0].children[0].traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.renderOrder = 1
      }
    })
    this.model.children[0].children[1].traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.renderOrder = 2
      }
    })

    // Add model to movement controller's group
    this.movement.group.add(this.model)
    this.setOpacity(1)
  }

  setOpacity(value) {
    const opacity = this._hideForFirstPerson ? 0 : value
    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material.opacity = opacity
        child.visible = opacity > 0.001
      }
    })
  }

  setFirstPersonHidden(hidden) {
    this._hideForFirstPerson = !!hidden
    this.setOpacity(1)
  }

  /**
   * 获取角色位置(脚底点)
   * @returns {THREE.Vector3}
   */
  getPosition() {
    return this.movement.getRenderPosition()
  }

  getEyeHeight() {
    return this.movement.getEyeHeight()
  }

  getPortalProbeState() {
    return this.movement.getPortalProbeState()
  }

  /**
   * 获取角色朝向角度
   * @returns {number}
   */
  getFacingAngle() {
    return this.config.facingAngle
  }

  /**
   * 获取角色速度
   * @returns {THREE.Vector3}
   */
  getVelocity() {
    return this.movement.worldVelocity.clone()
  }

  getHorizontalSpeed() {
    const velocity = this.movement.worldVelocity
    return Math.hypot(velocity.x, velocity.z)
  }

  isSprinting() {
    return !!this.movement.isSprinting
  }

  /**
   * 是否正在移动 (基于物理速度)
   * @returns {boolean}
   */
  isMoving() {
    const v = this.movement.worldVelocity
    // 速度大于 0.1 视为移动 (参考原 Camera 逻辑)
    return (v.x * v.x + v.z * v.z) > 0.01
  }

  /**
   * 設置角色朝向角度
   * @param {number} angle - 朝向角度（弧度），0 = +Z，Math.PI = -Z
   */
  setFacing(angle) {
    this.config.facingAngle = angle
    this.movement.setFacing(angle)
  }

  setupInputListeners() {
    this.allowFlightToggle = true

    emitter.on('input:update', (keys) => {
      this.inputState = keys
    })

    emitter.on('ui:control-permissions-changed', (payload = {}) => {
      if (payload.allowFlightToggle !== undefined) {
        this.allowFlightToggle = !!payload.allowFlightToggle
      }
    })

    emitter.on('input:jump', () => {
      // 挖掘时阻断跳跃输入
      if (this.isMining) {
        return
      }
      if (this.movement.isFlying) {
        return
      }
      if (this.movement.isGrounded && this.animation.stateMachine.currentState.name !== AnimationStates.COMBAT) {
        const { resolvedInput } = resolveDirectionInput(this.inputState)
        this.movement.jump(resolvedInput)
        this.animation.triggerJump()
      }
    })

    emitter.on('input:toggle_flight', () => {
      if (!this.allowFlightToggle) {
        return
      }
      this.movement.toggleFlight()
      emitter.emit('hud:flight-mode-changed', {
        enabled: this.movement.isFlying,
      })
    })

    emitter.on('camera:perspective-changed', (payload = {}) => {
      this.isFirstPersonView = !!payload.firstPerson
      this.targetFacingAngle = this.config.facingAngle
      this.setFirstPersonHidden(!!payload.firstPerson)
    })

    emitter.on('settings:mouse-sensitivity-changed', (value) => {
      this._applySettingsMouseSensitivity(value)
    })

    // ==================== 攻击输入 ====================

    // 直拳（Z键）- 左右交替
    emitter.on('input:punch_straight', () => {
      const anim = this._useLeftStraight
        ? AnimationClips.STRAIGHT_PUNCH // 左直拳
        : AnimationClips.RIGHT_STRAIGHT_PUNCH // 右直拳
      this._useLeftStraight = !this._useLeftStraight // 切换下次使用的手
      this.animation.triggerAttack(anim)
    })

    // 勾拳（X键）- 左右交替
    emitter.on('input:punch_hook', () => {
      const anim = this._useLeftHook
        ? AnimationClips.HOOK_PUNCH // 左勾拳
        : AnimationClips.RIGHT_HOOK_PUNCH // 右勾拳
      this._useLeftHook = !this._useLeftHook // 切换下次使用的手
      this.animation.triggerAttack(anim)
    })

    // 格挡（C键）- 保持原逻辑
    emitter.on('input:block', (isBlocking) => {
      if (isBlocking) {
        this.animation.triggerAttack(AnimationClips.BLOCK)
      }
    })

    // ==================== 挖掘事件 ====================
    emitter.on('game:mining-start', () => {
      this.isMining = true
      this.animation.triggerAttack(AnimationClips.QUICK_COMBO)
    })

    emitter.on('game:mining-cancel', () => {
      this.isMining = false
      this.animation.stateMachine.setState(AnimationStates.LOCOMOTION)
    })

    emitter.on('game:mining-complete', () => {
      this.isMining = false
      this.animation.stateMachine.setState(AnimationStates.LOCOMOTION)
    })

    // ==================== 鼠标旋转（Pointer Lock 模式） ====================
    emitter.on('input:mouse_move', ({ movementX }) => {
      const nextAngle = this.targetFacingAngle - movementX * this.config.mouseSensitivity
      this.targetFacingAngle = nextAngle
      this.setFacing(nextAngle)
    })

    // ==================== 重生 ====================
    emitter.on('input:respawn', () => {
      this.respawn()
    })
  }

  /**
   * 触发角色重生
   */
  respawn() {
    this.movement.respawn()
  }

  /**
   * 瞬间移动角色到指定位置
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.movement.setPosition(x, y, z)
  }

  /**
   * 设置重生点（由后端配置驱动）
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {boolean} [movePlayer]
   */
  setRespawnPoint(x, y, z, movePlayer = true) {
    this.config.respawn.position = { x, y, z }
    if (movePlayer) {
      this.setPosition(x, y, z)
    }
  }

  /**
   * 设置飞行行为参数
   * @param {{ignoreMiningSlowdown?:boolean, groundWalkAnimationWhenMoving?:boolean, speedMultiplier?:number}} options
   */
  setFlightOptions(options = {}) {
    this.movement.setFlightConfig(options)
  }

  /**
   * 注入额外地面采样器（例如后端上传模型）
   * @param {(x:number, z:number, originY?:number)=>number|null} sampler
   */
  setGroundSampler(sampler) {
    this.movement.setGroundSampler(sampler)
  }

  update() {
    // Skip update if animation controller not initialized yet
    if (!this.animation) {
      return
    }

    const isCombat = this.animation.stateMachine.currentState?.name === AnimationStates.COMBAT

    // Resolve Input (Conflict & Normalize)
    const { resolvedInput, weights } = resolveDirectionInput(this.inputState)

    const bypassMiningLock = this.movement.shouldIgnoreMiningSlowdown?.() ?? false
    const blockedByMining = this.isMining && !bypassMiningLock
    const simulateGroundWalk = this.movement.shouldSimulateGroundWalk?.(resolvedInput) ?? false

    // 挖掘时强制清空方向输入与水平速度，确保立即停下
    const effectiveInput = blockedByMining
      ? {
          forward: false,
          backward: false,
          left: false,
          right: false,
          control: false,
          sprint: false,
          shift: false,
          v: false,
          space: false,
          sneak: false,
        }
      : resolvedInput

    if (blockedByMining) {
      this.movement.worldVelocity.x = 0
      this.movement.worldVelocity.z = 0
    }

    // Update Movement
    this.movement.update(effectiveInput, isCombat)

    // Prepare state for animation
    const playerState = {
      inputState: effectiveInput,
      directionWeights: blockedByMining ? { forward: 0, backward: 0, left: 0, right: 0 } : weights, // Pass normalized weights
      isMoving: blockedByMining ? false : this.movement.isMoving(effectiveInput),
      isGrounded: simulateGroundWalk ? true : this.movement.isGrounded,
      speedProfile: this.movement.getSpeedProfile(effectiveInput),
      isMining: blockedByMining,
    }

    // Update Animation
    this.animation.update(this.time.delta, playerState)

    // ==================== 速度线控制 ====================
    this.updateSpeedLines(effectiveInput)

    // ==================== HUD 更新 ====================

    // Calculate FPS
    this._fontFrames++
    const now = performance.now()
    if (now >= this._lastTime + 1000) {
      this._currentFps = Math.round((this._fontFrames * 1000) / (now - this._lastTime))
      this._fontFrames = 0
      this._lastTime = now
    }

    // 获取当前位置和朝向
    const currentPosition = this.getPosition()
    const currentFacingAngle = this.getFacingAngle()

    // 计算位置变化距离
    const positionDiff = currentPosition.distanceTo(this._lastEmitPosition)

    // 计算角度变化（归一化到 [0, π] 范围）
    let angleDiff = Math.abs(currentFacingAngle - this._lastEmitFacingAngle)
    angleDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff) // 处理角度环绕

    // 判断是否需要更新：位置或角度变化超过阈值
    const shouldEmit = positionDiff >= this._positionThreshold || angleDiff >= this._angleThreshold

    if (shouldEmit) {
      emitter.emit('hud:update', {
        position: currentPosition.clone(),
        facingAngle: currentFacingAngle,
        fps: this._currentFps,
      })
      // 记录本次 emit 的状态
      this._lastEmitPosition.copy(currentPosition)
      this._lastEmitFacingAngle = currentFacingAngle
    }
  }

  /**
   * 更新速度线效果
   * 当玩家按住 Shift + 方向键冲刺时，显示速度线
   * @param {object} inputState - 输入状态
   */
  updateSpeedLines(inputState) {
    // 检查是否处于冲刺状态：Ctrl + 前进移动
    const isMoving = inputState.forward || inputState.backward || inputState.left || inputState.right
    const isSprinting = !!inputState.sprint && isMoving

    // 计算时间增量（秒）
    const deltaTime = this.time.delta * 0.001

    // 平滑过渡透明度
    if (isSprinting) {
      // 淡入：向目标透明度靠近
      this._speedLineOpacity += (this.config.speedLines.targetOpacity - this._speedLineOpacity)
        * this.config.speedLines.fadeInSpeed * deltaTime
    }
    else {
      // 淡出：向 0 靠近
      this._speedLineOpacity -= this._speedLineOpacity
        * this.config.speedLines.fadeOutSpeed * deltaTime
    }

    // 限制范围 [0, 1]
    this._speedLineOpacity = Math.max(0, Math.min(1, this._speedLineOpacity))

    // 更新渲染器中的速度线透明度
    this.renderer.setSpeedLineOpacity(this._speedLineOpacity)
  }

  debugInit() {
    // ===== 朝向控制 =====
    this.debugFolder.addBinding(this.config, 'facingAngle', {
      label: '朝向角度',
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
    }).on('change', () => {
      this.setFacing(this.config.facingAngle)
    })

    // ===== 鼠标灵敏度控制 =====
    this.debugFolder.addBinding(this.config, 'mouseSensitivity', {
      label: '鼠标灵敏度',
      min: 0.0001,
      max: 0.01,
      step: 0.0001,
    })

    this.debugFolder.addBinding(this.config, 'turnSmoothing', {
      label: '转向平滑度',
      min: 0.01,
      max: 1.0,
      step: 0.01,
    })

    // ===== HUD 更新阈值控制 =====
    const hudThresholdFolder = this.debugFolder.addFolder({
      title: 'HUD 更新阈值',
      expanded: false,
    })

    hudThresholdFolder.addBinding(this, '_positionThreshold', {
      label: '位置阈值',
      min: 0.01,
      max: 2.0,
      step: 0.01,
    })

    hudThresholdFolder.addBinding(this, '_angleThreshold', {
      label: '角度阈值(弧度)',
      min: 0.001,
      max: Math.PI / 4,
      step: 0.001,
    })

    // ===== 速度控制 =====
    this.debugFolder.addBinding(this.config.speed, 'crouch', { label: 'Crouch Speed', min: 0.1, max: 5 })
    this.debugFolder.addBinding(this.config.speed, 'walk', { label: 'Walk Speed', min: 1, max: 10 })
    this.debugFolder.addBinding(this.config.speed, 'run', { label: 'Run Speed', min: 1, max: 20 })
    this.debugFolder.addBinding(this.config, 'jumpForce', { label: 'Jump Force', min: 1, max: 20 })

    // Add Animation State Debug
    const debugState = { state: '' }
    this.debugFolder.addBinding(debugState, 'state', {
      readonly: true,
      label: 'Current State',
      multiline: true,
    })

    emitter.on('core:tick', () => {
      if (this.animation.stateMachine.currentState) {
        debugState.state = this.animation.stateMachine.currentState.name
      }
    })

    // ===== Animation Speed Control =====
    const animSpeedFolder = this.debugFolder.addFolder({
      title: 'Animation Speed',
      expanded: false,
    })

    // Helper to update time scales
    const updateTimeScales = () => {
      this.animation.updateTimeScales()
    }

    // 1. Global Speed
    animSpeedFolder.addBinding(timeScaleConfig, 'global', {
      label: 'Global Rate',
      min: 0.1,
      max: 3.0,
      step: 0.1,
    }).on('change', updateTimeScales)

    // 2. Categories
    const categoriesFolder = animSpeedFolder.addFolder({ title: 'Categories', expanded: true })

    categoriesFolder.addBinding(timeScaleConfig.categories, AnimationCategories.LOCOMOTION, {
      label: 'Locomotion',
      min: 0.1,
      max: 3.0,
      step: 0.1,
    }).on('change', updateTimeScales)

    categoriesFolder.addBinding(timeScaleConfig.categories, AnimationCategories.COMBAT, {
      label: 'Combat',
      min: 0.1,
      max: 3.0,
      step: 0.1,
    }).on('change', updateTimeScales)

    categoriesFolder.addBinding(timeScaleConfig.categories, AnimationCategories.ACTION, {
      label: 'Action',
      min: 0.1,
      max: 3.0,
      step: 0.1,
    }).on('change', updateTimeScales)

    // 3. SubGroups
    const subGroupsFolder = animSpeedFolder.addFolder({ title: 'Sub Groups', expanded: false })

    // Locomotion Subgroups
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'walk', { label: 'Walk', min: 0.1, max: 3.0 }).on('change', updateTimeScales)
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'run', { label: 'Run', min: 0.1, max: 3.0 }).on('change', updateTimeScales)
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'sneak', { label: 'Sneak', min: 0.1, max: 3.0 }).on('change', updateTimeScales)
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'idle', { label: 'Idle', min: 0.1, max: 3.0 }).on('change', updateTimeScales)

    // Combat Subgroups
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'punch', { label: 'Punch', min: 0.1, max: 3.0 }).on('change', updateTimeScales)
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'block', { label: 'Block', min: 0.1, max: 3.0 }).on('change', updateTimeScales)

    // Action Subgroups
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'jump', { label: 'Jump', min: 0.1, max: 3.0 }).on('change', updateTimeScales)
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'fall', { label: 'Fall', min: 0.1, max: 3.0 }).on('change', updateTimeScales)
    subGroupsFolder.addBinding(timeScaleConfig.subGroups, 'standup', { label: 'Standup', min: 0.1, max: 3.0 }).on('change', updateTimeScales)

    // ===== 碰撞调试 =====
    if (this.movement?.collision) {
      const collisionFolder = this.debugFolder.addFolder({
        title: '碰撞调试',
        expanded: false,
      })

      collisionFolder.addBinding(this.movement.collision.params, 'showCandidates', {
        label: '候选高亮',
      })
      collisionFolder.addBinding(this.movement.collision.params, 'showContacts', {
        label: '接触点',
      })
      collisionFolder.addBinding(this.movement.collision.stats, 'candidateCount', {
        label: '候选数量',
        readonly: true,
      })
      collisionFolder.addBinding(this.movement.collision.stats, 'collisionCount', {
        label: '碰撞数量',
        readonly: true,
      })
    }

    // ===== 重生设置 =====
    const respawnFolder = this.debugFolder.addFolder({
      title: '重生设置',
      expanded: false,
    })
    respawnFolder.addBinding(this.config.respawn, 'thresholdY', {
      label: '阈值Y',
      min: -100,
      max: 100,
      step: 1,
    })
    respawnFolder.addBinding(this.config.respawn.position, 'x', { label: '重生X', min: -200, max: 200, step: 1 })
    respawnFolder.addBinding(this.config.respawn.position, 'y', { label: '重生Y', min: -200, max: 200, step: 1 })
    respawnFolder.addBinding(this.config.respawn.position, 'z', { label: '重生Z', min: -200, max: 200, step: 1 })
  }

  destroy() {
    // Cleanup
  }
}
