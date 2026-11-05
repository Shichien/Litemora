import emitter from '../event/event-bus.js'

const GAMEPLAY_SHORTCUT_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'r',
  'f',
  'q',
  'y',
  'z',
  'x',
  'c',
  'v',
  ' ',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'tab',
])

/**
 * InputManager - 统一管理键盘和鼠标输入
 * 负责监听用户输入并通过 mitt 发送事件
 */
export default class InputManager {
  constructor() {
    this.controlPermissions = {
      allowFlightToggle: true,
      allowPerspectiveToggle: true,
    }

    // 键盘状态
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      control: false,
      sprint: false,
      shift: false,
      v: false,
      space: false,
      z: false,
      x: false,
      c: false,
      q: false,
      r: false,
      f: false,
      y: false,
    }

    // 鼠标按键状态
    this.mouse = {
      left: false,
      right: false,
      middle: false,
    }

    // Minecraft-style sprint window is about 7 ticks at 20 TPS.
    this._forwardTapWindowMs = 350
    this._lastForwardTapAt = 0

    // 绑定方法（用于移除监听器）
    this._onKeyDown = this.onKeyDown.bind(this)
    this._onKeyUp = this.onKeyUp.bind(this)
    this._onMouseDown = this.onMouseDown.bind(this)
    this._onMouseUp = this.onMouseUp.bind(this)
    this._onContextMenu = this.onContextMenu.bind(this)
    this._onWheel = this.onWheel.bind(this)
    this._onControlPermissionsChanged = this.onControlPermissionsChanged.bind(this)
    this._onBlockEditModeChanged = this.onBlockEditModeChanged.bind(this)

    // 方块编辑模式 ('remove' | 'add')，决定滚轮用于快捷栏还是相机
    this.blockEditMode = 'remove'

    this.init()
  }

  init() {
    // 键盘事件
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)

    // 鼠标按键事件
    window.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mouseup', this._onMouseUp)
    // 处理器从不调用 preventDefault，使用 passive 监听避免阻塞滚动
    window.addEventListener('wheel', this._onWheel, { passive: true })

    // 阻止右键菜单（避免影响 PointerLock / 场景交互）
    window.addEventListener('contextmenu', this._onContextMenu)

    emitter.on('ui:control-permissions-changed', this._onControlPermissionsChanged)
    emitter.on('game:block_edit_mode_changed', this._onBlockEditModeChanged)
  }

  onControlPermissionsChanged(payload = {}) {
    if (payload.allowFlightToggle !== undefined) {
      this.controlPermissions.allowFlightToggle = !!payload.allowFlightToggle
      if (!this.controlPermissions.allowFlightToggle) {
        this.keys.f = false
      }
    }

    if (payload.allowPerspectiveToggle !== undefined) {
      this.controlPermissions.allowPerspectiveToggle = !!payload.allowPerspectiveToggle
      if (!this.controlPermissions.allowPerspectiveToggle) {
        this.keys.y = false
      }
    }

    emitter.emit('input:update', this.keys)
  }

  // ==================== 键盘事件 ====================

  onKeyDown(event) {
    const key = event.key.toLowerCase()

    // 如果焦点在输入框或文本域，忽略游戏控制逻辑 (允许打字)
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      return
    }

    // 防止浏览器把游戏按键当成快捷键处理，尤其是 Ctrl+W / Ctrl+R
    if ((event.ctrlKey || event.metaKey) && GAMEPLAY_SHORTCUT_KEYS.has(key)) {
      event.preventDefault()
    }

    // 阻止游戏控制键的默认行为（如空格滚动页面）
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(key)) {
      event.preventDefault()
    }

    // ESC key - emit ui:escape for menu system
    if (event.key === 'Escape') {
      emitter.emit('ui:escape')
      return
    }

    if (key === 'tab') {
      emitter.emit('input:toggle_camera_side')
      return
    }

    // 1-9: hotbar slot (Minecraft layout)
    if (!event.repeat && key >= '1' && key <= '9' && key.length === 1) {
      emitter.emit('hud:select-slot', Number(key) - 1)
      return
    }

    this.updateKey(key, true)
  }

  onKeyUp(event) {
    // 如果焦点在输入框，忽略
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      return
    }

    const key = event.key.toLowerCase()
    this.updateKey(key, false)
  }

  updateKey(key, isPressed) {
    switch (key) {
      case 'w':
      case 'arrowup':
        if (isPressed && !this.keys.forward) {
          const now = performance.now()
          if (now - this._lastForwardTapAt <= this._forwardTapWindowMs) {
            this.keys.sprint = true
          }
          this._lastForwardTapAt = now
        }
        this.keys.forward = isPressed
        if (!isPressed) {
          this.keys.sprint = false
        }
        break
      case 's':
      case 'arrowdown':
        this.keys.backward = isPressed
        break
      case 'a':
      case 'arrowleft':
        this.keys.left = isPressed
        break
      case 'd':
      case 'arrowright':
        this.keys.right = isPressed
        break
      case 'shift':
        this.keys.shift = isPressed
        if (isPressed) {
          this.keys.sprint = false
        }
        break
      case 'control':
        this.keys.control = isPressed
        break
      case 'v':
        this.keys.v = isPressed
        break
      case ' ':
        if (isPressed && !this.keys.space) {
          // 跳跃：仅在初次按下时触发
          emitter.emit('input:jump')
        }
        this.keys.space = isPressed
        break
      // Z/X 键保留作为备用攻击键
      case 'z':
        if (isPressed && !this.keys.z) {
          emitter.emit('input:punch_straight')
        }
        this.keys.z = isPressed
        break
      case 'x':
        if (isPressed && !this.keys.x) {
          emitter.emit('input:punch_hook')
        }
        this.keys.x = isPressed
        break
      case 'c':
        this.keys.c = isPressed
        // 格挡：需要持续状态
        emitter.emit('input:block', isPressed)
        break
      case 'q':
        if (isPressed && !this.keys.q) {
          emitter.emit('input:toggle_block_edit_mode')
        }
        this.keys.q = isPressed
        break
      case 'r':
        if (isPressed && !this.keys.r) {
          emitter.emit('input:respawn')
        }
        this.keys.r = isPressed
        break
      case 'f':
        if (!this.controlPermissions.allowFlightToggle) {
          this.keys.f = false
          break
        }
        if (isPressed && !this.keys.f) {
          emitter.emit('input:toggle_flight')
        }
        this.keys.f = isPressed
        break
      case 'y':
        if (!this.controlPermissions.allowPerspectiveToggle) {
          this.keys.y = false
          break
        }
        if (isPressed && !this.keys.y) {
          emitter.emit('input:toggle_perspective')
        }
        this.keys.y = isPressed
        break
    }

    // 发送连续状态更新
    emitter.emit('input:update', this.keys)
  }

  // ==================== 鼠标事件 ====================

  /**
   * 鼠标按下事件
   * - 仅记录按键状态，并通过 mitt 广播基础鼠标事件，供后续射线交互模块使用
   */
  onMouseDown(event) {
    switch (event.button) {
      case 0: // 左键
        this.mouse.left = true
        emitter.emit('input:mouse_down', { button: 0 })
        break
      case 2: // 右键
        this.mouse.right = true
        emitter.emit('input:mouse_down', { button: 2 })
        break
      case 1: // 中键（预留）
        this.mouse.middle = true
        emitter.emit('input:mouse_down', { button: 1 })
        break
    }
  }

  /**
   * 鼠标松开事件
   */
  onMouseUp(event) {
    switch (event.button) {
      case 0: // 左键
        this.mouse.left = false
        emitter.emit('input:mouse_up', { button: 0 })
        break
      case 2: // 右键
        this.mouse.right = false
        emitter.emit('input:mouse_up', { button: 2 })
        break
      case 1: // 中键
        this.mouse.middle = false
        emitter.emit('input:mouse_up', { button: 1 })
        break
    }
  }

  /**
   * 阻止右键菜单弹出
   */
  onContextMenu(event) {
    event.preventDefault()
  }

  /**
   * 鼠标滚轮事件
   * - 放置模式 (Q) 下滚轮切换快捷栏格子
   * - 其他情况下作为 input:wheel 交给相机 (第三人称调高度)
   */
  onWheel(event) {
    if (!event.deltaY) {
      return
    }
    if (this.blockEditMode === 'add') {
      emitter.emit('hud:cycle-slot', event.deltaY > 0 ? 1 : -1)
      return
    }
    // 发送滚轮事件，deltaY 通常为 ±100 或类似值
    emitter.emit('input:wheel', { deltaY: event.deltaY })
  }

  onBlockEditModeChanged({ mode } = {}) {
    this.blockEditMode = mode
  }

  // ==================== 清理 ====================

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('mousedown', this._onMouseDown)
    window.removeEventListener('mouseup', this._onMouseUp)
    window.removeEventListener('wheel', this._onWheel)
    window.removeEventListener('contextmenu', this._onContextMenu)
    emitter.off('ui:control-permissions-changed', this._onControlPermissionsChanged)
    emitter.off('game:block_edit_mode_changed', this._onBlockEditModeChanged)
  }
}
