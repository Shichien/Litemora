/**
 * 图库清单查询 / 投影 slug 规范化的唯一实现。
 *
 * 同时被 Cloudflare Pages Functions(`functions/api/gallery/_shared.js`)和本地 dev mock
 * (`dev/mock-api/*`)使用, 因此必须只有一份代码。
 *
 * 为什么放在 `functions/api/gallery/` 里面而不是仓库根部的 `shared/`:
 * - Pages Functions 在部署时只会跟随 `functions/` 目录内部的相对导入进行打包, 仓库根部
 *   的独立目录不保证被一起打包, 线上会出现模块缺失;
 * - 文件名以下划线开头, 不会被 Cloudflare 当成路由(`_shared.js` / `_space.js` 同理);
 * - 本文件不 import 任何模块, 因此 Node 侧(vite 加载 mock 时)也能安全加载。
 *
 * 注意两套 slug 规则并存的原因(不要"顺手统一"):
 * - `normalizeProjectionSlug`  —— 去除非字母数字并折叠成 `-`, 用于 KV / 线上数据;
 * - `normalizeLegacyProjectionSlug` —— 只删除非字母数字(不插入分隔符), 用于 dev mock,
 *   因为 `public/.dev-gallery/**` 里已经落盘的历史数据就是按这套规则生成的
 *   (例如 `giantredstonedensesmoke`)。改成带 `-` 的规则会让本地既有数据全部对不上。
 */

const PROJECTION_SLUG_MAX_LENGTH = 63
const LEGACY_PROJECTION_SLUG_MAX_LENGTH = 48

function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * KV / 线上使用的 slug 规则: `Giant Redstone Dense` -> `giant-redstone-dense`
 */
export function normalizeProjectionSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, PROJECTION_SLUG_MAX_LENGTH)
}

/**
 * dev mock / `.dev-gallery` 历史数据使用的 slug 规则: `Giant Redstone Dense` -> `giantredstonedense`
 */
export function normalizeLegacyProjectionSlug(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9]/giu, '')
    .slice(0, LEGACY_PROJECTION_SLUG_MAX_LENGTH)
    .toLowerCase()
}

export function resolveProjectionSlug(value = '', fallback = '') {
  return normalizeProjectionSlug(value) || normalizeProjectionSlug(fallback)
}

/**
 * 图库清单里"还没有被 claim 过、但已有内容"的旧空间。
 */
export function hasLegacyGalleryContent(profile = null, manifest = null) {
  return !profile && Array.isArray(manifest?.items) && manifest.items.length > 0
}

/**
 * 按 item id 或 projection slug 在清单里找条目。
 *
 * 兼容两种调用方式:
 * - `_shared.js` 传整个 manifest 对象, slug 走线上规则, 且允许回退到 title;
 * - dev mock 传 `manifest.items` 数组, slug 走历史规则, 不回退 title。
 * 规则通过 options 注入, 逻辑本身只有这一份。
 */
export function findGalleryManifestItemByIdentifier(manifest, identifier = '', options = {}) {
  const {
    normalize = normalizeProjectionSlug,
    fallbackToTitle = true,
  } = options

  const normalizedIdentifier = trimString(identifier)
  if (!normalizedIdentifier) {
    return null
  }

  const items = Array.isArray(manifest) ? manifest : manifest?.items
  const normalizedSlug = normalize(normalizedIdentifier)

  return (Array.isArray(items) ? items : []).find((item) => {
    if (!item) {
      return false
    }

    if (trimString(item?.id) === normalizedIdentifier) {
      return true
    }

    if (!normalizedSlug) {
      return false
    }

    const itemSlug = fallbackToTitle
      ? (normalize(item?.projectionSlug) || normalize(item?.title))
      : normalize(item?.projectionSlug)

    return itemSlug === normalizedSlug
  }) || null
}
