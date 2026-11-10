/**
 * 本地 dev mock: 图库(gallery)相关端点。
 *
 * 路由与响应完全沿用原来写在 `vite.config.js` 里的实现:
 * - GET    /api/gallery/item
 * - DELETE /api/gallery/item
 * - GET    /api/gallery/source
 * - POST   /api/gallery/items
 * - POST   /api/gallery/claim
 * - GET    /api/gallery
 *
 * 注册顺序必须保持不变: Connect 的 `use(path)` 是前缀匹配, `/api/gallery` 会同时
 * 命中 `/api/gallery/items` 等子路径, 所以具体路径必须排在 `/api/gallery` 前面。
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  findGalleryManifestItemByIdentifier,
  hasLegacyGalleryContent,
  normalizeLegacyProjectionSlug,
} from '../../functions/api/gallery/_gallery-slugs.js'
import {
  canManageMockGallery,
  createUniqueProjectionSlug,
  deleteFileIfExists,
  filterVisibleGalleryItems,
  getGallerySpaceFromBody,
  getItemIdFromRequest,
  getSpaceNameFromRequest,
  normalizeMockSourceFileMetadata,
  readJsonFileOr,
  readMockAccount,
  readRequestBody,
  resolveGalleryItemPath,
  resolveGalleryManifestPath,
  resolveGalleryProfilePath,
  resolveGallerySourcePath,
  sanitizeProjectionName,
  sendError,
  sendJson,
  writeJsonFile,
} from './helpers.js'

/**
 * mock 侧沿用历史 slug 规则(不带分隔符), 与 `public/.dev-gallery/**` 里已落盘的数据一致。
 */
const MOCK_SLUG_OPTIONS = {
  normalize: normalizeLegacyProjectionSlug,
  fallbackToTitle: false,
}

function findMockGalleryItem(items, identifier) {
  return findGalleryManifestItemByIdentifier(items, identifier, MOCK_SLUG_OPTIONS)
}

export function registerGalleryMockApi(middlewares) {
  middlewares.use('/api/gallery/item', async (req, res) => {
    const spaceName = getSpaceNameFromRequest(req)
    const itemId = getItemIdFromRequest(req)

    if (!spaceName) {
      sendError(res, 400, 'invalid_space_name')
      return
    }

    if (!itemId) {
      sendError(res, 400, 'missing_item_id')
      return
    }

    const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
    const manifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), {
      items: [],
    })
    const resolvedSummary = findMockGalleryItem(manifest?.items, itemId)
    const resolvedItemId = resolvedSummary?.id || itemId
    const item = await readJsonFileOr(resolveGalleryItemPath(spaceName, resolvedItemId), null)
    const viewer = readMockAccount(req)
    const canManage = canManageMockGallery(viewer, profile)

    if (req.method === 'GET') {
      if (!item || (item.visibility === 'private' && !canManage)) {
        sendError(res, 404, 'gallery_item_not_found')
        return
      }

      sendJson(res, 200, {
        item: {
          ...item,
          sourceFile: item.visibility === 'public' || canManage ? item.sourceFile : undefined,
        },
        viewer: {
          authenticated: !!viewer,
          account: viewer,
          canManage,
        },
      })
      return
    }

    if (req.method === 'DELETE') {
      if (!canManage) {
        sendError(res, 403, 'gallery_delete_forbidden')
        return
      }

      const deleteManifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), {
        items: [],
      })
      const deleteSummary = findMockGalleryItem(deleteManifest?.items, itemId)
      const deleteItemId = deleteSummary?.id || itemId
      const nextItems = Array.isArray(deleteManifest?.items)
        ? deleteManifest.items.filter(entry => entry?.id !== deleteItemId)
        : []
      const nextManifest = {
        ...(deleteManifest || {}),
        updatedAt: Date.now(),
        items: nextItems,
      }
      const nextProfile = profile
        ? {
            ...profile,
            itemCount: nextItems.length,
            updatedAt: Date.now(),
          }
        : null

      await deleteFileIfExists(resolveGalleryItemPath(spaceName, deleteItemId))
      await deleteFileIfExists(resolveGallerySourcePath(spaceName, deleteItemId))
      await writeJsonFile(resolveGalleryManifestPath(spaceName), nextManifest)
      if (nextProfile) {
        await writeJsonFile(resolveGalleryProfilePath(spaceName), nextProfile)
      }

      sendJson(res, 200, {
        ok: true,
        items: filterVisibleGalleryItems(nextItems, viewer, nextProfile),
        profile: nextProfile,
      })
      return
    }

    sendError(res, 405, 'method_not_allowed')
  })

  middlewares.use('/api/gallery/source', async (req, res) => {
    if (req.method !== 'GET') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    const spaceName = getSpaceNameFromRequest(req)
    const itemId = getItemIdFromRequest(req)

    if (!spaceName) {
      sendError(res, 400, 'invalid_space_name')
      return
    }

    if (!itemId) {
      sendError(res, 400, 'missing_item_id')
      return
    }

    const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
    const manifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), { items: [] })
    const resolvedSummary = findMockGalleryItem(manifest?.items, itemId)
    const resolvedItemId = resolvedSummary?.id || itemId
    const item = await readJsonFileOr(resolveGalleryItemPath(spaceName, resolvedItemId), null)
    const viewer = readMockAccount(req)
    const canManage = canManageMockGallery(viewer, profile)

    if (!item || (item.visibility === 'private' && !canManage)) {
      sendError(res, 404, 'gallery_item_not_found')
      return
    }

    try {
      const sourceBuffer = await fs.readFile(resolveGallerySourcePath(spaceName, resolvedItemId))
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', String(sourceBuffer.byteLength))
      res.end(sourceBuffer)
    }
    catch {
      const inlineBase64 = String(item?.sourceFile?.fileBase64 || '').trim()
      if (!inlineBase64) {
        sendError(res, 404, 'gallery_item_source_not_found')
        return
      }

      const sourceBuffer = Buffer.from(inlineBase64, 'base64')
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', String(sourceBuffer.byteLength))
      res.end(sourceBuffer)
    }
  })

  middlewares.use('/api/gallery/items', async (req, res) => {
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    const viewer = readMockAccount(req)
    if (!viewer) {
      sendError(res, 401, 'authentication_required')
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const spaceName = getGallerySpaceFromBody(payload)
      if (!spaceName) {
        sendError(res, 400, 'invalid_space_name')
        return
      }

      const itemId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const profilePath = resolveGalleryProfilePath(spaceName)
      const manifestPath = resolveGalleryManifestPath(spaceName)
      const existingProfile = await readJsonFileOr(profilePath, null)
      const existingManifest = await readJsonFileOr(manifestPath, {
        space: spaceName,
        ownerAccountId: viewer.id,
        updatedAt: Date.now(),
        items: [],
      })

      if (existingProfile && existingProfile.ownerAccountId !== viewer.id) {
        sendError(res, 403, 'gallery_write_forbidden')
        return
      }
      if (hasLegacyGalleryContent(existingProfile, existingManifest)) {
        sendError(res, 409, 'gallery_legacy_claim_blocked')
        return
      }

      const sourceFileMeta = normalizeMockSourceFileMetadata({
        fileName: payload?.fileName || 'uploaded.schematic',
        size: Number(payload?.fileSize || 0),
      })

      const profile = existingProfile || {
        space: spaceName,
        ownerAccountId: viewer.id,
        ownerProvider: viewer.provider,
        ownerName: viewer.name || viewer.email || spaceName,
        ownerAvatar: viewer.avatar || '',
        title: '',
        bio: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        itemCount: 0,
      }

      const projectionName = sanitizeProjectionName(
        payload?.projectionName || payload?.title || payload?.schematic?.name || payload?.fileName || 'World',
      ) || 'World'
      const projectionSlug = createUniqueProjectionSlug(
        projectionName,
        Array.isArray(existingManifest?.items) ? existingManifest.items : [],
      )

      const item = {
        id: itemId,
        space: spaceName,
        title: projectionName,
        projectionSlug,
        description: String(payload?.description || '').slice(0, 4000),
        visibility: payload?.visibility === 'private' ? 'private' : 'public',
        fileName: sourceFileMeta.fileName,
        mimeType: sourceFileMeta.mimeType,
        sourceFile: {
          fileName: sourceFileMeta.fileName,
          mimeType: sourceFileMeta.mimeType,
          size: sourceFileMeta.size,
        },
        schematic: payload?.schematic || null,
        previewModel: payload?.previewModel || null,
        placement: payload?.placement || null,
        owner: {
          id: viewer.id,
          name: viewer.name || viewer.email || spaceName,
          avatar: viewer.avatar || '',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      const summary = {
        id: item.id,
        title: item.title,
        projectionSlug: item.projectionSlug,
        description: item.description,
        visibility: item.visibility,
        fileName: item.fileName,
        schematic: item.schematic,
        placement: item.placement,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        preview: {
          totalSolidBlocks: Number(item?.previewModel?.totalSolidBlocks || 0),
          sampled: !!item?.previewModel?.sampled,
          bounds: item?.previewModel?.bounds || null,
        },
      }

      const nextItems = [
        summary,
        ...(Array.isArray(existingManifest?.items) ? existingManifest.items : []).filter(entry => entry?.id !== item.id),
      ].sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))

      const nextProfile = {
        ...profile,
        updatedAt: Date.now(),
        itemCount: nextItems.length,
      }
      const nextManifest = {
        ...existingManifest,
        space: spaceName,
        ownerAccountId: viewer.id,
        updatedAt: Date.now(),
        items: nextItems,
      }

      await writeJsonFile(resolveGalleryItemPath(spaceName, itemId), item)
      await fs.mkdir(path.dirname(resolveGallerySourcePath(spaceName, itemId)), { recursive: true })
      await fs.writeFile(resolveGallerySourcePath(spaceName, itemId), Buffer.from(String(payload?.fileBase64 || ''), 'base64'))
      await writeJsonFile(profilePath, nextProfile)
      await writeJsonFile(manifestPath, nextManifest)

      sendJson(res, 200, {
        ok: true,
        item: summary,
        profile: nextProfile,
      })
    }
    catch (error) {
      res.statusCode = error?.message === 'invalid_source_file_type' ? 415 : 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        error: error?.message === 'invalid_source_file_type'
          ? 'invalid_source_file_type'
          : 'gallery_item_create_failed',
      }))
    }
  })

  middlewares.use('/api/gallery/claim', async (req, res) => {
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    const viewer = readMockAccount(req)
    if (!viewer) {
      sendError(res, 401, 'authentication_required')
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const spaceName = getGallerySpaceFromBody(payload)
      if (!spaceName) {
        sendError(res, 400, 'invalid_space_name')
        return
      }

      const profilePath = resolveGalleryProfilePath(spaceName)
      const manifestPath = resolveGalleryManifestPath(spaceName)
      const existingProfile = await readJsonFileOr(profilePath, null)
      const existingManifest = await readJsonFileOr(manifestPath, {
        space: spaceName,
        ownerAccountId: viewer.id,
        updatedAt: Date.now(),
        items: [],
      })

      if (hasLegacyGalleryContent(existingProfile, existingManifest)) {
        sendError(res, 409, 'gallery_legacy_claim_blocked')
        return
      }

      if (existingProfile && existingProfile.ownerAccountId !== viewer.id) {
        sendError(res, 409, 'gallery_already_claimed')
        return
      }

      const profile = {
        space: spaceName,
        ownerAccountId: viewer.id,
        ownerProvider: viewer.provider,
        ownerName: String(payload?.displayName || existingProfile?.ownerName || viewer.name || viewer.email || spaceName).slice(0, 120),
        ownerAvatar: viewer.avatar || '',
        title: String(payload?.title ?? existingProfile?.title ?? '').slice(0, 160),
        bio: String(payload?.bio || existingProfile?.bio || '').slice(0, 4000),
        createdAt: existingProfile?.createdAt || Date.now(),
        updatedAt: Date.now(),
        itemCount: Number(existingProfile?.itemCount || 0),
      }
      const manifest = existingManifest

      await writeJsonFile(profilePath, profile)
      await writeJsonFile(manifestPath, manifest)

      sendJson(res, 200, { ok: true, profile })
    }
    catch {
      sendError(res, 400, 'gallery_claim_failed')
    }
  })

  middlewares.use('/api/gallery', async (req, res) => {
    if (req.method !== 'GET') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    const spaceName = getSpaceNameFromRequest(req)
    if (!spaceName) {
      sendError(res, 400, 'invalid_space_name')
      return
    }

    const viewer = readMockAccount(req)
    const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
    const manifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), {
      items: [],
    })
    const items = filterVisibleGalleryItems(Array.isArray(manifest?.items) ? manifest.items : [], viewer, profile)

    sendJson(res, 200, {
      space: spaceName,
      profile,
      items,
      legacyContent: hasLegacyGalleryContent(profile, manifest),
      spaceExists: !!profile || (Array.isArray(manifest?.items) && manifest.items.length > 0),
      viewer: {
        authenticated: !!viewer,
        account: viewer,
        canManage: canManageMockGallery(viewer, profile),
      },
    })
  })
}
