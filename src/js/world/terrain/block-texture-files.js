/**
 * Maps every `textureKeys` value used by `blocks-config.js` to the PNG file
 * that ships inside the bundled vanilla resource pack.
 *
 * The loose `public/textures/blocks/*.png` copies were removed in 15277ea, so
 * this table is the single source of truth for "which file backs which key".
 * Both the HUD hotbar icons and the block-break fly-in animation read from it,
 * which is why it lives in a neutral module instead of inside either consumer.
 *
 * Key naming mirrors the historic `sources.js` entry names so that any code
 * that still thinks in those terms keeps working.
 */

import { resolvePublicAssetUrl } from '../../utils/public-asset-url.js'

/** Directory (relative to `public/`) holding the vanilla block textures. */
export const PACK_BLOCK_TEXTURE_DIR = 'minecraft-default-pack/assets/minecraft/textures/block'

/**
 * Directory (relative to `public/`) holding project-local overrides.
 *
 * Some vanilla textures are grayscale in the pack because the game tints them
 * at runtime from the biome colour. The old project shipped pre-tinted copies
 * instead, so those keys resolve here to keep the original look.
 */
export const LOCAL_BLOCK_TEXTURE_DIR = 'textures/blocks'

/**
 * textureKey -> file name.
 *
 * Entries are looked up in {@link PACK_BLOCK_TEXTURE_DIR} first and fall back
 * to {@link LOCAL_BLOCK_TEXTURE_DIR}; see {@link resolveBlockTextureUrl}.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BLOCK_TEXTURE_FILES = Object.freeze({
  // ===== 草方块 =====
  // 资源包里的 grass_block_top 是灰度图（游戏内靠 biome tint 上色），旧版用的是
  // 预先染色好的彩色图。本地覆盖一份，避免草顶发灰。
  grass: 'grass.png',
  grass_block_side_texture: 'grass_block_side.png',

  // ===== 基础方块 =====
  dirt: 'dirt.png',
  stone: 'stone.png',
  sand: 'sand.png',
  red_sand: 'red_sand.png',
  snow: 'snow.png',
  gravel_Texture: 'gravel.png',
  ice_Texture: 'ice.png',
  packedIce_Texture: 'packed_ice.png',

  // ===== 矿石 =====
  coal_ore: 'coal_ore.png',
  iron_ore: 'iron_ore.png',

  // ===== 橡树 =====
  treeTrunk_TopTexture: 'oak_log_top.png',
  treeTrunk_SideTexture: 'oak_log.png',
  // 旧版 tree_leaves 与 birch_leaves 都指向 azalea_leaves.png（彩色，非灰度）；
  // pack 里的 oak_leaves / birch_leaves 是灰度图，直接用会发灰。
  treeLeaves_Texture: 'azalea_leaves.png',

  // ===== 白桦 =====
  birchTrunk_TopTexture: 'birch_log_top.png',
  birchTrunk_SideTexture: 'birch_log.png',
  birchLeaves_Texture: 'azalea_leaves.png',

  // ===== 樱花 =====
  // 旧资产实际是去皮樱花木（像素级一致），此处忠实还原
  cherryTrunk_TopTexture: 'stripped_cherry_log_top.png',
  cherryTrunk_SideTexture: 'stripped_cherry_log.png',
  cherryLeaves_Texture: 'cherry_leaves.png',

  // ===== 仙人掌 =====
  cactusTrunk_TopTexture: 'cactus_top.png',
  cactusTrunk_SideTexture: 'cactus_side.png',

  // ===== 陶瓦 =====
  terracotta_yellow: 'yellow_terracotta.png',

  // ===== 石材变种 =====
  diorite_Texture: 'diorite.png',
  polishedDiorite_Texture: 'polished_diorite.png',
  andesite_Texture: 'andesite.png',
  polishedAndesite_Texture: 'polished_andesite.png',
  polishedBlackstone_Texture: 'polished_blackstone.png',
  polishedBlackstoneBricks_Texture: 'polished_blackstone_bricks.png',
  crackedPolishedBlackstoneBricks_Texture: 'cracked_polished_blackstone_bricks.png',

  // ===== 蛙明灯 =====
  ochreFroglight_SideTexture: 'ochre_froglight_side.png',
  ochreFroglight_TopTexture: 'ochre_froglight_top.png',
  pearlescentFroglight_SideTexture: 'pearlescent_froglight_side.png',
  pearlescentFroglight_TopTexture: 'pearlescent_froglight_top.png',
})

/**
 * Keys whose file lives in {@link LOCAL_BLOCK_TEXTURE_DIR} instead of the pack.
 *
 * These are the textures that are grayscale in the vanilla pack (the game tints
 * them from the biome colour) but were pre-tinted in this project's own assets.
 *
 * @type {ReadonlySet<string>}
 */
export const LOCAL_TEXTURE_KEYS = Object.freeze(new Set([
  'grass',
]))

/**
 * Resolve the pack file name for a texture key.
 *
 * @param {string | null | undefined} key Texture key from `blocks-config.js`.
 * @returns {string | null} File name, or null when the key is unknown.
 */
export function getBlockTextureFileName(key) {
  if (typeof key !== 'string' || !key)
    return null

  return BLOCK_TEXTURE_FILES[key] ?? null
}

/**
 * Resolve a browser-usable URL for a texture key.
 *
 * Keys listed in {@link LOCAL_TEXTURE_KEYS} resolve against the project-local
 * override directory; everything else resolves against the bundled pack.
 *
 * @param {string | null | undefined} key Texture key from `blocks-config.js`.
 * @returns {string | null} Absolute-from-base URL, or null when unknown.
 */
export function resolveBlockTextureUrl(key) {
  const fileName = getBlockTextureFileName(key)
  if (!fileName)
    return null

  const dir = LOCAL_TEXTURE_KEYS.has(key) ? LOCAL_BLOCK_TEXTURE_DIR : PACK_BLOCK_TEXTURE_DIR
  return resolvePublicAssetUrl(`${dir}/${fileName}`)
}
