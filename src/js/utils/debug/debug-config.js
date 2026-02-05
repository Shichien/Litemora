// 统一高频事件黑名单（记录与显示共用）
export const DEFAULT_BLACKLIST = [
  'core:tick', // 每帧触发
  'core:resize', // 窗口 resize
  'core:ready', // 资源就绪（可能多次）
  'input:mouse_move',
  'input:update', // 输入更新（每帧）
  'input:wheel', // 滚轮
]
