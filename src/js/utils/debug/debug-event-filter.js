/**
 * Debug Event Filter - 事件过滤器
 *
 * 功能:
 * - 事件黑名单管理（过滤高频事件）
 * - 时间范围筛选
 * - 与 DebugStateMonitor 集成
 *
 * 仅在开发环境启用
 */

/**
 * 默认高频事件黑名单（避免污染日志）
 * 这些事件每秒触发多次，会淹没其他重要事件
 */
export const DEFAULT_BLACKLIST = [
  'core:tick',
  'core:resize',
]

class DebugEventFilter {
  constructor() {
    // 是否在开发环境
    this.enabled = import.meta.env.DEV && window.location.hash === '#debug'

    // 黑名单（事件名前缀匹配）
    this.blacklist = new Set(DEFAULT_BLACKLIST)

    // 是否启用黑名单
    this.enableBlacklist = true

    // 时间范围（毫秒时间戳）
    this.timeRange = {
      start: null,
      end: null,
    }
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
   * 添加黑名单模式
   * @param {string} pattern - 事件名或前缀
   */
  addToBlacklist(pattern) {
    this.blacklist.add(pattern)
  }

  /**
   * 从黑名单移除
   * @param {string} pattern - 事件名或前缀
   */
  removeFromBlacklist(pattern) {
    this.blacklist.delete(pattern)
  }

  /**
   * 设置黑名单（替换整个集合）
   * @param {Array<string>} patterns - 黑名单数组
   */
  setBlacklist(patterns) {
    this.blacklist = new Set(patterns)
  }

  /**
   * 获取黑名单列表
   * @returns {Array<string>} 黑名单数组
   */
  getBlacklist() {
    return Array.from(this.blacklist)
  }

  /**
   * 设置时间范围
   * @param {number|null} start - 开始时间戳
   * @param {number|null} end - 结束时间戳
   */
  setTimeRange(start, end) {
    this.timeRange.start = start
    this.timeRange.end = end
  }

  /**
   * 清除时间范围
   */
  clearTimeRange() {
    this.timeRange.start = null
    this.timeRange.end = null
  }

  /**
   * 检查事件是否在时间范围内
   * @param {number} timestamp - 事件时间戳
   * @returns {boolean} 是否在时间范围内
   */
  isInTimeRange(timestamp) {
    if (!this.enabled)
      return true

    if (this.timeRange.start && timestamp < this.timeRange.start) {
      return false
    }
    if (this.timeRange.end && timestamp > this.timeRange.end) {
      return false
    }
    return true
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

    // 时间范围检查
    if (!this.isInTimeRange(log.timestamp)) {
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

  /**
   * 重置为默认黑名单
   */
  resetToDefault() {
    this.blacklist = new Set(DEFAULT_BLACKLIST)
    this.timeRange = { start: null, end: null }
    this.enableBlacklist = true
  }

  /**
   * 清除所有过滤器
   */
  clearAll() {
    this.blacklist.clear()
    this.timeRange = { start: null, end: null }
    this.enableBlacklist = false
  }
}

// 导出单例实例
export default new DebugEventFilter()
