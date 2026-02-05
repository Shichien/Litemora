/**
 * Pinia Debug Plugin - 监听所有 Store 的状态变更
 *
 * 功能:
 * - 自动监听所有 Pinia Store 的状态变化
 * - 记录每个 state key 的变更历史
 * - 支持 patch 和 direct mutation 两种变更方式
 * - 显示 oldValue -> newValue 的 diff
 *
 * 使用方式:
 *   import { createDebugPlugin } from '@pinia/debug-plugin.js'
 *   pinia.use(createDebugPlugin())
 *
 * 仅在开发环境启用
 */

import debugStateMonitor from '@three/utils/debug/debug-state-monitor.js'

/**
 * 深拷贝值用于比较
 * @param {*} value - 任意值
 * @returns {*} 深拷贝后的值
 */
function deepClone(value) {
  if (value === null || value === undefined)
    return value

  try {
    return JSON.parse(JSON.stringify(value))
  }
  catch {
    // 处理循环引用等无法序列化的情况
    return value
  }
}

/**
 * 创建 Pinia Debug 插件
 * @returns {Function} Pinia 插件函数
 */
export function createDebugPlugin() {
  // 仅在开发环境启用
  if (!import.meta.env.DEV) {
    return () => {}
  }

  console.warn('[PiniaDebugPlugin] Initialized')

  return ({ store, _options }) => {
    // 保存 store 初始状态用于比较
    const storeId = store.$id

    // 订阅 store 的所有变更
    store.$subscribe((mutation, _state) => {
      // mutation 包含:
      //   - type: 'direct' | 'patch object' | 'patch function'
      //   - storeId: store 的 id
      //   - events: 变更事件数组或单个事件

      const events = mutation.events

      if (!events) {
        // 某些情况下 events 可能不存在 (如 patch function)
        // 这种情况下我们记录整个 state 的变化
        debugStateMonitor.logPiniaChange(
          storeId,
          '[batch update]',
          null,
          '[complex patch]',
        )
        return
      }

      // 处理单个或多个事件
      const eventList = Array.isArray(events) ? events : [events]

      for (const event of eventList) {
        // event 包含:
        //   - key: 变更的属性名
        //   - oldValue: 旧值
        //   - newValue: 新值
        //   - target: 目标对象

        const key = event.key
        const oldValue = deepClone(event.oldValue)
        const newValue = deepClone(event.newValue)

        // 记录到 DebugStateMonitor
        debugStateMonitor.logPiniaChange(storeId, key, oldValue, newValue)
      }
    })

    // 监听 store 的 actions (可选)
    store.$onAction(({ name, store: _store, args, after, onError }) => {
      // 记录 action 调用
      console.warn(`[Pinia] Action: ${storeId}.${name}`, args)

      after((result) => {
        console.warn(`[Pinia] Action completed: ${storeId}.${name}`, result)
      })

      onError((error) => {
        console.error(`[Pinia] Action failed: ${storeId}.${name}`, error)
      })
    })
  }
}

/**
 * 手动记录 Pinia 状态变更
 * 用于在需要精确控制记录时使用
 *
 * @param {string} storeName - Store 名称
 * @param {string} key - 变更的 key
 * @param {*} oldValue - 旧值
 * @param {*} newValue - 新值
 */
export function logPiniaChange(storeName, key, oldValue, newValue) {
  if (!import.meta.env.DEV)
    return

  debugStateMonitor.logPiniaChange(storeName, key, oldValue, newValue)
}

// 默认导出
export default createDebugPlugin
