/**
 * 定义项目所需的静态资源列表。
 * Resources 类会根据 'type' 属性自动选择合适的加载器。
 *
 * 支持的资源类型 (type) 及其对应的加载器:
 * - gltfModel: GLTFLoader (glb/gltf 模型)
 * - texture:   TextureLoader (普通图像纹理, 如 jpg, png)
 *
 * 注意：方块贴图不再走资源加载管线。所有方块贴图统一由
 * `world/terrain/block-texture-files.js` 指向内置原版资源包，
 * 并按需加载，因此这里只保留启动时必须就绪的资源。
 */
const sources = [
  // ===== 玩家皮肤模型 =====
  {
    name: 'steveModel',
    type: 'gltfModel',
    path: 'models/character/steve.glb',
  },
  {
    name: 'alexModel',
    type: 'gltfModel',
    path: 'models/character/alex.glb',
  },
  {
    name: 'playerModel',
    type: 'gltfModel',
    path: 'models/character/player.glb',
  },
  // ===== 方块破坏纹理（10 阶段）=====
  {
    name: 'destroy_stage_0',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_0.webp',
  },
  {
    name: 'destroy_stage_1',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_1.webp',
  },
  {
    name: 'destroy_stage_2',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_2.webp',
  },
  {
    name: 'destroy_stage_3',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_3.webp',
  },
  {
    name: 'destroy_stage_4',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_4.webp',
  },
  {
    name: 'destroy_stage_5',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_5.webp',
  },
  {
    name: 'destroy_stage_6',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_6.webp',
  },
  {
    name: 'destroy_stage_7',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_7.webp',
  },
  {
    name: 'destroy_stage_8',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_8.webp',
  },
  {
    name: 'destroy_stage_9',
    type: 'texture',
    path: 'textures/destroy/destroy_stage_9.webp',
  },
]

export default sources
