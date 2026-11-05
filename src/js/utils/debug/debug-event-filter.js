/**
 * Debug Event Filter - 事件过滤器
 *
 * 功能:
 * - 事件黑名单管理（过滤高频事件）
 * - 与 DebugStateMonitor 集成
 *
 * 仅在开发环境启用
 */

/**
 * 默认高频事件黑名单（避免污染日志）
 * 这些事件每秒触发多次，会淹没其他重要事件
 */
import { DEFAULT_BLACKLIST } from './debug-config.js'

class DebugEventFilter {
  constructor() {
    // 是否在开发环境
    this.enabled = import.meta.env.DEV && window.location.hash === '#debug'

    // 黑名单（事件名前缀匹配）
    this.blacklist = new Set(DEFAULT_BLACKLIST)

    // 是否启用黑名单
    this.enableBlacklist = true
  }

  /**
   * 检查事件是否在黑名单中
   * @param {string} eventName - 事件名称
   * @returns {boolean} 是否在黑名单中
   */
  isBlacklisted(eventName) {
    if (!this.enabled || !this.enableBlacklist)
      return false

    for (const pattern of this.blacklist) {
      if (eventName.startsWith(pattern) || eventName === pattern) {
        return true
      }
    }
    return false
  }

  /**
   * 设置黑名单（替换整个集合）
   * @param {Array<string>} patterns - 黑名单数组
   */
  setBlacklist(patterns) {
    this.blacklist = new Set(patterns)
  }

  /**
   * 过滤单个日志
   * @param {object} log - 日志条目
   * @returns {boolean} 是否通过过滤
   */
  filterLog(log) {
    if (!this.enabled)
      return true

    // 黑名单检查
    if (this.isBlacklisted(log.eventName)) {
      return false
    }

    return true
  }

  /**
   * 过滤日志列表
   * @param {Array} logs - 日志列表
   * @returns {Array} 过滤后的日志
   */
  filterLogs(logs) {
    if (!this.enabled)
      return logs

    return logs.filter(log => this.filterLog(log))
  }
}

// 导出单例实例
export default new DebugEventFilter()
