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
