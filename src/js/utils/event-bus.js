/**
 * Event Bus - 事件总线
 *
 * 本项目使用增强型 emitter 包装 mitt，添加调试功能。
 * 保持与原 mitt 完全相同的 API，可作为 drop-in 替换。
 *
 * 调试功能仅在开发环境且 URL hash 为 #debug 时启用。
 */

import debugEmitter from './debug-emitter.js'

// 导出增强型 emitter (与原版 mitt API 完全一致)
export default debugEmitter
