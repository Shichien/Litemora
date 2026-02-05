/**
 * DebugStateMonitor - 状态与事件调试监控核心类
 *
 * 功能:
 * - 记录 mitt 事件 (emit/on/off)
 * - 记录 Pinia 状态变更
 * - 按 Scope 分类 (ui/settings/game/core/shadow/pinia)
 * - 搜索过滤
 * - JSON 导出到剪贴板
 *
 * 仅在开发环境且 URL hash 为 #debug 时启用
 */

// 生成唯一 ID
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// 简化数据用于显示 (避免循环引用和过长内容)
function simplifyData(data, maxLength = 100) {
  if (data === null || data === undefined)
    return data

  try {
    const str = JSON.stringify(data)
    if (str.length <= maxLength)
      return data

    // 返回截断的字符串表示
    return `${str.substring(0, maxLength)}... (${str.length} chars)`
  }
  catch {
    // 处理循环引用等情况
    return '[Complex Object]'
  }
}

class DebugStateMonitor {
  constructor() {
    // 仅在开发环境且 URL hash 为 #debug 时启用
    this.enabled = import.meta.env.DEV && window.location.hash === '#debug'

    // 日志存储 (环形缓冲区)
    this.logs = []
    this.maxLogs = 200

    // 暂停状态
    this.isPaused = false

    // 当前筛选条件
    this.currentScope = 'all'
    this.searchQuery = ''

    // 监听器追踪 (用于统计活跃监听器数量)
    this.listenerCount = new Map()

    // 状态快照缓存
    this.stateSnapshot = {}

    // 高频事件黑名单 - 这些事件不参与监视器（避免 console 爆满）
    this.highFrequencyEvents = new Set([
      'core:tick',
      'core:resize',
      'input:mouse_move',
      'input:update',
    ])

    if (this.enabled) {
      console.warn('[DebugStateMonitor] Initialized')
    }
  }

  /**
   * 根据事件名识别 Scope
   * @param {string} eventName - 事件名称
   * @returns {string} scope - ui/settings/game/core/shadow/pinia/other
   */
  getScope(eventName) {
    if (!eventName)
      return 'other'

    if (eventName.startsWith('ui:'))
      return 'ui'
    if (eventName.startsWith('settings:'))
      return 'settings'
    if (eventName.startsWith('game:'))
      return 'game'
    if (eventName.startsWith('core:'))
      return 'core'
    if (eventName.startsWith('shadow:'))
      return 'shadow'
    if (eventName.startsWith('pinia:'))
      return 'pinia'

    return 'other'
  }

  /**
   * 暂停监控
   */
  pause() {
    this.isPaused = true
    console.warn('[DebugStateMonitor] Paused')
  }

  /**
   * 继续监控
   */
  resume() {
    this.isPaused = false
    console.warn('[DebugStateMonitor] Resumed')
  }

  /**
   * 记录事件
   * @param {string} type - 事件类型: emit/on/off
   * @param {string} eventName - 事件名称
   * @param {*} data - 事件数据
   * @param {string} source - 调用来源 (文件:行号)
   */
  logEvent(type, eventName, data, source) {
    if (!this.enabled || this.isPaused)
      return

    // 跳过高频事件（避免 console 爆满）
    if (this.highFrequencyEvents.has(eventName))
      return

    const scope = this.getScope(eventName)

    // 更新监听器统计 (仅对 on/off 类型)
    if (type === 'on') {
      const count = this.listenerCount.get(eventName) || 0
      this.listenerCount.set(eventName, count + 1)
    }
    else if (type === 'off') {
      const count = this.listenerCount.get(eventName) || 0
      if (count > 0) {
        this.listenerCount.set(eventName, count - 1)
      }
    }

    // 创建日志条目
    const logEntry = {
      id: generateId(),
      timestamp: Date.now(),
      type,
      scope,
      eventName,
      data: simplifyData(data),
      source: source || 'unknown',
      listeners: this.listenerCount.get(eventName) || 0,
    }

    // 添加到日志 (保持 50 条限制)
    this.logs.push(logEntry)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }

    // 控制台输出 (便于开发时查看)
    console.warn(`[${scope}] ${type}: ${eventName}`, {
      data: logEntry.data,
      source: logEntry.source,
      listeners: logEntry.listeners,
    })
  }

  /**
   * 记录 Pinia 状态变更
   * @param {string} storeName - Store 名称 (如 'uiStore')
   * @param {string} key - 变更的 key
   * @param {*} oldValue - 旧值
   * @param {*} newValue - 新值
   */
  logPiniaChange(storeName, key, oldValue, newValue) {
    if (!this.enabled || this.isPaused)
      return

    const eventName = `pinia:${storeName}.${key}`

    const logEntry = {
      id: generateId(),
      timestamp: Date.now(),
      type: 'pinia',
      scope: 'pinia',
      eventName,
      data: {
        store: storeName,
        key,
        oldValue: simplifyData(oldValue),
        newValue: simplifyData(newValue),
      },
      source: `${storeName}.js`,
      listeners: 0,
    }

    this.logs.push(logEntry)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }

    // 更新状态快照
    if (!this.stateSnapshot[storeName]) {
      this.stateSnapshot[storeName] = {}
    }
    this.stateSnapshot[storeName][key] = newValue

    console.warn(`[pinia] ${storeName}.${key}:`, {
      oldValue: logEntry.data.oldValue,
      newValue: logEntry.data.newValue,
    })
  }

  /**
   * 设置当前 Scope 筛选
   * @param {string} scope - all/ui/settings/game/core/shadow/pinia
   */
  setScope(scope) {
    this.currentScope = scope
    console.warn(`[DebugStateMonitor] Scope changed to: ${scope}`)
  }

  /**
   * 设置搜索关键词
   * @param {string} query - 搜索关键词
   */
  setSearchQuery(query) {
    this.searchQuery = query.toLowerCase()
  }

  /**
   * 获取过滤后的日志列表
   * @returns {Array} 过滤后的日志条目
   */
  getFilteredLogs() {
    return this.logs.filter((log) => {
      // Scope 筛选
      if (this.currentScope !== 'all' && log.scope !== this.currentScope) {
        return false
      }

      // 搜索筛选
      if (this.searchQuery) {
        const searchableText = `${log.eventName} ${JSON.stringify(log.data)}`.toLowerCase()
        if (!searchableText.includes(this.searchQuery)) {
          return false
        }
      }

      return true
    })
  }

  /**
   * 获取当前状态快照
   * @returns {object} 所有 stores 的当前状态
   */
  getStateSnapshot() {
    return { ...this.stateSnapshot }
  }

  /**
   * 导出日志为 JSON 并复制到剪贴板
   */
  exportToJSON() {
    if (!this.enabled)
      return

    const exportData = {
      timestamp: new Date().toISOString(),
      exportedBy: 'DebugStateMonitor',
      summary: {
        totalLogs: this.logs.length,
        scopeFilter: this.currentScope,
        searchQuery: this.searchQuery,
      },
      logs: this.logs,
      snapshot: this.getStateSnapshot(),
    }

    const jsonStr = JSON.stringify(exportData, null, 2)

    // 复制到剪贴板
    navigator.clipboard.writeText(jsonStr)
      .then(() => {
        console.warn('[DebugStateMonitor] Exported to clipboard')
      })
      .catch((err) => {
        console.error('[DebugStateMonitor] Failed to export:', err)
      })

    return exportData
  }

  /**
   * 清空日志
   */
  clearLogs() {
    this.logs = []
    console.warn('[DebugStateMonitor] Logs cleared')
  }

  /**
   * 获取监听器统计
   * @returns {Map} 事件名 -> 监听器数量
   */
  getListenerStats() {
    return new Map(this.listenerCount)
  }
}

// 导出单例实例
export default new DebugStateMonitor()
