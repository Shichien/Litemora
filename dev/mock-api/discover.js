/**
 * 本地 dev mock: 首页发现流(discover)。
 *
 * 线上实现 `functions/api/discover.js` 从 KV 里读 `gallery:discover:public`, 为空时
 * 回退到扫描所有 `gallery:space:*:manifest` 现算一份。本地 mock 没有 KV, 所以直接
 * 走"扫描清单现算"这条同样的分支, 只是数据源换成 `public/.dev-gallery/**\/manifest.json`。
 *
 * 条目结构复用 `functions/api/gallery/_shared.js` 里的 `buildDiscoverProjectionEntry`
 * 与 `upsertDiscoverProjectionEntry`, 保证和线上字段完全一致。
 */
import fs from 'node:fs/promises'
import {
  buildDiscoverProjectionEntry,
  upsertDiscoverProjectionEntry,
} from '../../functions/api/gallery/_shared.js'
import {
  readJsonFileOr,
  resolveGalleryManifestPath,
  resolveGalleryProfilePath,
  resolveGalleryRootDir,
  sanitizeSpaceName,
  sendError,
  sendJson,
} from './helpers.js'

/** 与 `functions/api/discover.js` 的 `parseLimit` 保持一致: 默认 12, 夹在 1..24 */
function parseLimit(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    const value = Number(requestUrl.searchParams.get('limit') || 12)
    if (!Number.isFinite(value)) {
      return 12
    }
    return Math.min(24, Math.max(1, Math.round(value)))
  }
  catch {
    return 12
  }
}

async function listGallerySpaceNames() {
  try {
    const entries = await fs.readdir(resolveGalleryRootDir(), { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => sanitizeSpaceName(entry.name))
      .filter(Boolean)
      .sort()
  }
  catch {
    return []
  }
}

async function buildDiscoverEntriesFromManifests(limit = 12) {
  const spaceNames = await listGallerySpaceNames()
  let discoverEntries = []

  for (const spaceName of spaceNames) {
    const manifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), null)
    const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)

    for (const item of Array.isArray(manifest?.items) ? manifest.items : []) {
      if (item?.visibility !== 'public') {
        continue
      }

      const entry = buildDiscoverProjectionEntry(spaceName, item, profile)
      if (!entry) {
        continue
      }

      discoverEntries = upsertDiscoverProjectionEntry(discoverEntries, entry, Math.max(limit, 24))
    }
  }

  return discoverEntries.slice(0, limit)
}

export function registerDiscoverMockApi(middlewares) {
  middlewares.use('/api/discover', async (req, res) => {
    if (req.method !== 'GET') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    try {
      const limit = parseLimit(req)
      const items = await buildDiscoverEntriesFromManifests(limit)
      sendJson(res, 200, { items })
    }
    catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        error: 'discover_read_failed',
        details: error?.message || 'unknown_error',
      }))
    }
  })
}
