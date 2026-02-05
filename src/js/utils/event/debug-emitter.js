/**
 * Debug Emitter - 增强型事件总线
 *
 * 包装 mitt，添加调试功能:
 * - 自动记录所有 emit/on/off 操作
 * - 识别事件 Scope (ui/settings/game/core/shadow)
 * - 记录调用来源 (文件:行号)
 * - 追踪活跃监听器数量
 *
 * API 与原 mitt 完全一致，可作为 drop-in 替换
 *
 * 仅在开发环境启用调试功能，生产环境零开销
 */

import mitt from 'mitt'
import debugStateMonitor from '../debug/debug-state-monitor.js'

// 基础 mitt 实例
const baseEmitter = mitt()

// 是否在开发环境
const isDev = import.meta.env.DEV

/**
 * 提取调用来源信息
 * @returns {string} 来源信息 (文件名:行号)
 */
function getCallerInfo() {
  if (!isDev)
    return undefined

  try {
    const stack = new Error('caller info').stack
    const lines = stack.split('\n')

    // 找到调用 debugEmitter 的代码位置
    // stack 结构:
    //   0: Error
    //   1: at getCallerInfo (debug-emitter.js)
    //   2: at Object.emit (debug-emitter.js) <- 包装器
    //   3: at actualCaller (调用者文件) <- 我们需要这一行
    const callerLine = lines[3] || lines[2]

    if (!callerLine)
      return undefined

    // 简化版正则 - 直接提取最后的 "文件名:行号:列号"
    const match = callerLine.match(/\/?([^/:]+):(\d+):\d+\)?$/)

    if (match) {
      const [, fileName, line] = match
      return `${fileName}:${line}`
    }
  }
  catch {
    // 忽略解析错误
  }

  return undefined
}

/**
 * 增强型 emitter
 * 包装 mitt 的所有方法，添加调试日志
 */
const debugEmitter = {
  /**
   * 触发事件
   * @param {string} eventName - 事件名称
   * @param {*} data - 事件数据
   * @returns {void}
   */
  emit(eventName, data) {
    // 记录调试日志 (仅在开发环境)
    if (isDev) {
      const source = getCallerInfo()
      debugStateMonitor.logEvent('emit', eventName, data, source)
    }

    // 调用原始 emit
    return baseEmitter.emit(eventName, data)
  },

  /**
   * 监听事件
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 事件处理函数
   * @returns {void}
   */
  on(eventName, handler) {
    if (isDev) {
      const source = getCallerInfo()
      debugStateMonitor.logEvent('on', eventName, null, source)
    }

    return baseEmitter.on(eventName, handler)
  },

  /**
   * 监听事件 (一次性)
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 事件处理函数
   * @returns {void}
   */
  once(eventName, handler) {
    if (isDev) {
      const source = getCallerInfo()
      debugStateMonitor.logEvent('on', `${eventName} (once)`, null, source)
    }

    return baseEmitter.once(eventName, handler)
  },

  /**
   * 移除事件监听
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 事件处理函数
   * @returns {void}
   */
  off(eventName, handler) {
    if (isDev) {
      const source = getCallerInfo()
      debugStateMonitor.logEvent('off', eventName, null, source)
    }

    return baseEmitter.off(eventName, handler)
  },

  /**
   * 获取所有监听器 Map
   * 这是 mitt 的一个属性，不是方法
   */
  get all() {
    return baseEmitter.all
  },
}

// 兼容 mitt 的默认导出
export default debugEmitter

// 也导出命名导出，方便解构
export const { emit, on, once, off, all } = debugEmitter
