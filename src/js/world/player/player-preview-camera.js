import * as THREE from 'three'
import Experience from '../../experience.js'
import emitter from '../../utils/event/event-bus.js'

/**
 * 玩家正面预览相机
 * 用于在 HUD 左下角渲染玩家模型的正面视图
 * 采用 Viewport 方案直接渲染到主画布，无需 GPU→CPU 回读
 */
export default class PlayerPreviewCamera {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.sizes = this.experience.sizes

    // 配置参数
    this.config = {
      size: 250, // 渲染尺寸（CSS 像素）
      margin: {
        left: 180,
        bottom: 20,
      },
      distance: -2.0, // 相机与玩家的距离
      heightOffset: 0.5, // 相机高度偏移（约腰部）
      lookAtOffset: 0.9, // 注视点高度偏移
      orthoSize: 1.1, // 正交相机视野大小 (Vertical)
    }

    // 状态
    this.enabled = true
    this.player = null

    // 创建预览相机 (正交)
    this.camera = new THREE.OrthographicCamera(
      -this.config.orthoSize, // left
      this.config.orthoSize, // right
      this.config.orthoSize, // top
      -this.config.orthoSize, // bottom
      0.1, // near
      10, // far
    )

    // 设置 Layers 隔离
    // 预览相机只看 Layer 1（玩家模型专用层）
    this.camera.layers.set(1)
    this.camera.layers.disable(0)

    // 监听设置变更
    this._handleSettingChange = this._handleSettingChange.bind(this)
    emitter.on('settings:front-view-changed', this._handleSettingChange)
  }

  /**
   * 设置要拍摄的玩家引用
   * @param {Player} player
   */
  setPlayer(player) {
    this.player = player
  }

  /**
   * 设置启用状态
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled
  }

  /**
   * 处理设置变更事件
   */
  _handleSettingChange({ enabled }) {
    this.setEnabled(enabled)
  }

  /**
   * 更新相机位置（每帧调用）
   * 相机固定在玩家正前方，不跟随玩家旋转
   */
  update() {
    if (!this.enabled || !this.player)
      return

    const playerPos = this.player.getPosition()
    const facingAngle = this.player.getFacingAngle()

    // 计算相机位置：在玩家正前方
    // 使用玩家朝向角度来确定"正面"
    const cameraX = playerPos.x + Math.sin(facingAngle) * this.config.distance
    const cameraY = playerPos.y + this.config.heightOffset
    const cameraZ = playerPos.z + Math.cos(facingAngle) * this.config.distance

    this.camera.position.set(cameraX, cameraY, cameraZ)

    // 注视玩家腰部
    this.camera.lookAt(
      playerPos.x,
      playerPos.y + this.config.lookAtOffset,
      playerPos.z,
    )
  }

  /**
   * 获取相机实例
   */
  getCamera() {
    return this.camera
  }

  /**
   * 调整尺寸
   */
  resize() {
    // 预览尺寸固定，不需要响应窗口变化
  }

  /**
   * 销毁资源
   */
  destroy() {
    emitter.off('settings:front-view-changed', this._handleSettingChange)
    this.scene.remove(this.camera)
  }
}
