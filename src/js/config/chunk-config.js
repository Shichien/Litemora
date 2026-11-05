// Chunk 基础配置参数
export const CHUNK_BASIC_CONFIG = {
  chunkWidth: 64, // Chunk 宽度（方块数），决定每个 chunk 在 X/Z 方向上的大小
  chunkHeight: 32, // Chunk 高度（方块数），决定每个 chunk 在 Y 方向上的大小
  viewDistance: 1, // 加载半径（chunk 数量），玩家周围加载的 chunk 范围，值为 1 表示 3×3 网格
  unloadPadding: 1, // 卸载滞后（chunk 数量），卸载半径 = viewDistance + unloadPadding，用于减少边界抖动
  worldName: 'default', // 世界名称，用于持久化存储的标识符
  useIndexedDB: true, // 是否使用 IndexedDB 进行持久化存储，适合保存大型原理图语义快照
  autoSaveDelay: 2000, // 自动保存延迟（毫秒），玩家修改地形后的节流保存时间
}

// 渲染参数（影响视觉效果，可实时调整）
export const RENDER_PARAMS = {
  scale: 1, // 整体缩放倍率（范围: 0.1-3），控制所有 chunk 的整体大小
  heightScale: 1, // 高度缩放倍率（范围: 0.5-5），控制地形高度的拉伸程度
  showOresOnly: false, // 仅显示矿产模式，true 时只渲染矿石类方块，用于调试
}
