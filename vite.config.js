import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import { partytownVite } from '@builder.io/partytown/utils'
import vue from '@vitejs/plugin-vue'
import glsl from 'vite-plugin-glsl'

import _config from './_config'

const HOST = _config.server.host
const PORT = _config.server.port
const LOCAL_DEV_MOCK_ACCOUNT = {
  id: 'local-dev',
  provider: 'local-dev',
  name: 'Local Dev',
  email: 'local@litemora.dev',
  avatar: '',
}
const SAFE_SOURCE_MIME_TYPE = 'application/octet-stream'
const ALLOWED_SOURCE_FILE_EXTENSIONS = new Set(['.litematic', '.schem', '.schematic'])

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      resolve(raw)
    })
    req.on('error', reject)
  })
}

function sanitizeSpaceName(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return /^[a-z0-9-]{3,63}$/.test(normalized) ? normalized : ''
}

function sanitizeProjectionName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9]/giu, '')
    .slice(0, 48)
}

function sanitizeSourceFileName(value, fallbackValue = 'uploaded.schematic') {
  const fallback = String(fallbackValue || 'uploaded.schematic')
    .replace(/[\\/\r\n"]/g, '-')
    .trim()
  return String(value || '')
    .replace(/[\\/\r\n"]/g, '-')
    .trim() || fallback
}

function getSourceFileExtension(fileName = '') {
  const normalized = String(fileName || '').trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return ''
  }

  return normalized.slice(dotIndex)
}

function normalizeMockSourceFileMetadata(value = {}) {
  const fileName = sanitizeSourceFileName(value?.fileName, 'uploaded.schematic')
  if (!ALLOWED_SOURCE_FILE_EXTENSIONS.has(getSourceFileExtension(fileName))) {
    throw new Error('invalid_source_file_type')
  }

  return {
    fileName,
    mimeType: SAFE_SOURCE_MIME_TYPE,
  }
}

function normalizeProjectionSlug(value) {
  return sanitizeProjectionName(value).toLowerCase()
}

function createUniqueProjectionSlug(value, items = []) {
  const baseSlug = normalizeProjectionSlug(value) || 'world'
  const usedSlugs = new Set(
    (Array.isArray(items) ? items : [])
      .map(item => normalizeProjectionSlug(item?.projectionSlug || ''))
      .filter(Boolean),
  )

  if (!usedSlugs.has(baseSlug)) {
    return baseSlug
  }

  let suffix = 2
  while (usedSlugs.has(`${baseSlug}${suffix}`)) {
    suffix += 1
  }

  return `${baseSlug}${suffix}`
}

function findGalleryManifestItemByIdentifier(items = [], identifier = '') {
  const rawIdentifier = String(identifier || '').trim()
  const normalizedSlug = normalizeProjectionSlug(rawIdentifier)

  return (Array.isArray(items) ? items : []).find((item) => {
    if (!item) {
      return false
    }

    if (String(item.id || '').trim() === rawIdentifier) {
      return true
    }

    return normalizedSlug && normalizeProjectionSlug(item.projectionSlug || '') === normalizedSlug
  }) || null
}

function getSpaceNameFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    return sanitizeSpaceName(requestUrl.searchParams.get('space'))
  }
  catch {
    return ''
  }
}

function getProjectionIdFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    return String(requestUrl.searchParams.get('projection') || '').trim()
  }
  catch {
    return ''
  }
}

function resolveSpaceJsonPath(fileName, spaceName = '') {
  if (!spaceName) {
    return path.resolve(__dirname, 'public', fileName)
  }
  return path.resolve(__dirname, 'public', 'spaces', spaceName, fileName)
}

function resolveScopedSpaceJsonPath(fileName, spaceName = '', projectionId = '') {
  const normalizedProjectionId = String(projectionId || '').trim()
  if (!normalizedProjectionId) {
    return resolveSpaceJsonPath(fileName, spaceName)
  }

  if (!spaceName) {
    return path.resolve(__dirname, 'public', 'projections', encodeURIComponent(normalizedProjectionId), fileName)
  }

  return path.resolve(
    __dirname,
    'public',
    'spaces',
    spaceName,
    'projections',
    encodeURIComponent(normalizedProjectionId),
    fileName,
  )
}

function resolveGallerySpaceDir(spaceName = '') {
  return path.resolve(__dirname, 'public', '.dev-gallery', spaceName || 'default')
}

function resolveGalleryProfilePath(spaceName = '') {
  return path.resolve(resolveGallerySpaceDir(spaceName), 'profile.json')
}

function resolveGalleryManifestPath(spaceName = '') {
  return path.resolve(resolveGallerySpaceDir(spaceName), 'manifest.json')
}

function resolveGalleryItemPath(spaceName = '', itemId = '') {
  return path.resolve(resolveGallerySpaceDir(spaceName), 'items', `${encodeURIComponent(itemId)}.json`)
}

async function readJsonFileOr(filePath, fallbackValue) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  }
  catch {
    return fallbackValue
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

async function deleteFileIfExists(filePath) {
  try {
    await fs.unlink(filePath)
  }
  catch {
    // ignore missing file in local mock mode
  }
}

function toBase64UrlText(value) {
  return Buffer.from(String(value || ''), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64UrlText(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const padded = normalized + '==='.slice((normalized.length + 3) % 4)
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function createMockSession(account) {
  return {
    token: `mock.${toBase64UrlText(JSON.stringify(account))}`,
    expiresAt: Date.now() + (1000 * 60 * 60 * 24 * 14),
  }
}

function isLocalDevMockAccount(account = null) {
  return account?.provider === LOCAL_DEV_MOCK_ACCOUNT.provider && account?.id === LOCAL_DEV_MOCK_ACCOUNT.id
}

function readMockAccount(req) {
  const authorization = String(req.headers.authorization || '')
  if (authorization === 'Bearer local-dev-session') {
    return {
      ...LOCAL_DEV_MOCK_ACCOUNT,
    }
  }

  if (!authorization.startsWith('Bearer mock.')) {
    return null
  }

  try {
    const encoded = authorization.slice('Bearer mock.'.length)
    return JSON.parse(fromBase64UrlText(encoded))
  }
  catch {
    return null
  }
}

function getGallerySpaceFromBody(body = {}) {
  return sanitizeSpaceName(body?.space)
}

function getItemIdFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    return String(requestUrl.searchParams.get('item') || '').trim()
  }
  catch {
    return ''
  }
}

function canManageMockGallery(viewerAccount = null, profile = null) {
  return !!viewerAccount?.id && viewerAccount.id === profile?.ownerAccountId
}

function hasLegacyGalleryContent(profile = null, manifest = null) {
  return !profile && Array.isArray(manifest?.items) && manifest.items.length > 0
}

function filterVisibleGalleryItems(items = [], viewerAccount = null, profile = null) {
  const canManage = canManageMockGallery(viewerAccount, profile)
  return items.filter(item => canManage || item?.visibility !== 'private')
}

function summarizeWorldState(payload = {}, key = 'world-state') {
  const format = payload?.format || 'classic'
  const isChunkV2 = format === 'chunk-v2'
  const chunks = isChunkV2 ? (payload?.chunks || {}) : (payload?.modifications || {})
  const chunkKeys = Object.keys(chunks)

  let modificationCount = 0
  if (isChunkV2) {
    for (const chunk of Object.values(chunks)) {
      modificationCount += Number(chunk?.c || 0)
    }
  }
  else {
    for (const blocks of Object.values(chunks)) {
      if (blocks && typeof blocks === 'object') {
        modificationCount += Object.keys(blocks).length
      }
    }
  }

  return {
    ok: true,
    key,
    format,
    chunkWidth: Number(payload?.chunkWidth) || null,
    chunkCount: chunkKeys.length,
    modificationCount,
    schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
    payloadBytes: JSON.stringify(payload || {}).length,
    sampleChunkKeys: chunkKeys.slice(0, 8),
  }
}

function registerMockApi(middlewares) {
  middlewares.use(/^\/api\/auth\/(github|google)\/exchange$/, async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const provider = String(req.url || '').includes('/google/') ? 'google' : 'github'
      const code = String(payload?.code || '').trim()

      if (!code) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'missing_oauth_code' }))
        return
      }

      const shortCode = code.slice(0, 8)
      const namePrefix = provider === 'google' ? 'Google' : 'GitHub'
      const account = {
        id: `${provider}:${shortCode || 'local-user'}`,
        provider,
        name: `${namePrefix} User`,
        email: `${provider}-${shortCode || 'local'}@mock.local`,
        avatar: '',
      }
      const session = createMockSession(account)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ account, session }))
    }
    catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'invalid_auth_payload' }))
    }
  })

  middlewares.use(/^\/api\/gallery\/item(?:\?.*)?$/, async (req, res) => {
    const spaceName = getSpaceNameFromRequest(req)
    const itemId = getItemIdFromRequest(req)

    if (!spaceName) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'invalid_space_name' }))
      return
    }

    if (!itemId) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'missing_item_id' }))
      return
    }

    const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
    const manifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), {
      items: [],
    })
    const resolvedSummary = findGalleryManifestItemByIdentifier(manifest?.items, itemId)
    const resolvedItemId = resolvedSummary?.id || itemId
    const item = await readJsonFileOr(resolveGalleryItemPath(spaceName, resolvedItemId), null)
    const viewer = readMockAccount(req)
    const canManage = canManageMockGallery(viewer, profile)

    if (req.method === 'GET') {
      if (!item || (item.visibility === 'private' && !canManage)) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'gallery_item_not_found' }))
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        item: {
          ...item,
          sourceFile: item.visibility === 'public' || canManage ? item.sourceFile : undefined,
        },
        viewer: {
          authenticated: !!viewer,
          account: viewer,
          canManage,
        },
      }))
      return
    }

    if (req.method === 'DELETE') {
      if (!canManage) {
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'gallery_delete_forbidden' }))
        return
      }

      const manifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), {
        items: [],
      })
      const resolvedSummary = findGalleryManifestItemByIdentifier(manifest?.items, itemId)
      const resolvedItemId = resolvedSummary?.id || itemId
      const nextItems = Array.isArray(manifest?.items)
        ? manifest.items.filter(entry => entry?.id !== resolvedItemId)
        : []
      const nextManifest = {
        ...(manifest || {}),
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

      await deleteFileIfExists(resolveGalleryItemPath(spaceName, resolvedItemId))
      await writeJsonFile(resolveGalleryManifestPath(spaceName), nextManifest)
      if (nextProfile) {
        await writeJsonFile(resolveGalleryProfilePath(spaceName), nextProfile)
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        ok: true,
        items: filterVisibleGalleryItems(nextItems, viewer, nextProfile),
        profile: nextProfile,
      }))
      return
    }

    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
  })

  middlewares.use(/^\/api\/gallery\/items(?:\?.*)?$/, async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    const viewer = readMockAccount(req)
    if (!viewer) {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'authentication_required' }))
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const spaceName = getGallerySpaceFromBody(payload)
      if (!spaceName) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'invalid_space_name' }))
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
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'gallery_write_forbidden' }))
        return
      }
      if (hasLegacyGalleryContent(existingProfile, existingManifest)) {
        res.statusCode = 409
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'gallery_legacy_claim_blocked' }))
        return
      }

      const sourceFileMeta = normalizeMockSourceFileMetadata({
        fileName: payload?.fileName || 'uploaded.schematic',
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
          fileBase64: String(payload?.fileBase64 || ''),
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
      await writeJsonFile(profilePath, nextProfile)
      await writeJsonFile(manifestPath, nextManifest)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        ok: true,
        item: summary,
        profile: nextProfile,
      }))
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

  middlewares.use(/^\/api\/gallery\/claim(?:\?.*)?$/, async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    const viewer = readMockAccount(req)
    if (!viewer) {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'authentication_required' }))
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const spaceName = getGallerySpaceFromBody(payload)
      if (!spaceName) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'invalid_space_name' }))
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
        res.statusCode = 409
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'gallery_legacy_claim_blocked' }))
        return
      }

      if (existingProfile && existingProfile.ownerAccountId !== viewer.id) {
        res.statusCode = 409
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'gallery_already_claimed' }))
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

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: true, profile }))
    }
    catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'gallery_claim_failed' }))
    }
  })

  middlewares.use(/^\/api\/gallery(?:\?.*)?$/, async (req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    const spaceName = getSpaceNameFromRequest(req)
    if (!spaceName) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'invalid_space_name' }))
      return
    }

    const viewer = readMockAccount(req)
    const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
    const manifest = await readJsonFileOr(resolveGalleryManifestPath(spaceName), {
      items: [],
    })
    const items = filterVisibleGalleryItems(Array.isArray(manifest?.items) ? manifest.items : [], viewer, profile)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({
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
    }))
  })

  middlewares.use('/api/world-config', async (req, res) => {
    const spaceName = getSpaceNameFromRequest(req)
    const projectionId = getProjectionIdFromRequest(req)
    const jsonPath = resolveScopedSpaceJsonPath('world-config.json', spaceName, projectionId)

    if (req.method === 'GET') {
      try {
        const content = await fs.readFile(jsonPath, 'utf-8')
        const payload = JSON.parse(content)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({
          ...payload,
          __meta: {
            exists: true,
            projection: projectionId || '',
          },
        }))
      }
      catch {
        try {
          const fallbackPath = resolveSpaceJsonPath('world-config.json')
          const fallbackContent = await fs.readFile(fallbackPath, 'utf-8')
          const payload = JSON.parse(fallbackContent)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            ...payload,
            __meta: {
              exists: false,
              projection: projectionId || '',
            },
          }))
        }
        catch {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'failed_to_read_world_config' }))
        }
      }
      return
    }

    if (req.method === 'POST') {
      try {
        if (!spaceName) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'invalid_space_name' }))
          return
        }

        const viewer = readMockAccount(req)
        const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
        if (!viewer) {
          res.statusCode = 401
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'authentication_required' }))
          return
        }
        if (!isLocalDevMockAccount(viewer) && !canManageMockGallery(viewer, profile)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'world_write_forbidden' }))
          return
        }

        const rawBody = await readRequestBody(req)
        const payload = rawBody ? JSON.parse(rawBody) : {}
        if (!payload || typeof payload !== 'object') {
          throw new Error('invalid_world_config_payload')
        }

        await fs.mkdir(path.dirname(jsonPath), { recursive: true })
        await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf-8')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true }))
      }
      catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'invalid_world_config_payload' }))
      }
      return
    }

    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
  })

  middlewares.use('/api/world-state', async (req, res) => {
    const spaceName = getSpaceNameFromRequest(req)
    const projectionId = getProjectionIdFromRequest(req)
    const statePath = resolveScopedSpaceJsonPath('world-state.json', spaceName, projectionId)

    if (req.method === 'GET') {
      try {
        const content = await fs.readFile(statePath, 'utf-8')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(content)
      }
      catch {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ worldState: { schematicOnlyMode: false }, modifications: {} }))
      }
      return
    }

    if (req.method === 'POST') {
      try {
        if (!spaceName) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'invalid_space_name' }))
          return
        }

        const viewer = readMockAccount(req)
        const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
        if (!viewer) {
          res.statusCode = 401
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'authentication_required' }))
          return
        }
        if (!isLocalDevMockAccount(viewer) && !canManageMockGallery(viewer, profile)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'world_write_forbidden' }))
          return
        }

        const rawBody = await readRequestBody(req)
        const payload = rawBody ? JSON.parse(rawBody) : {}
        const hasCompactChunks = payload?.format === 'chunk-v2'
          && payload?.chunks
          && typeof payload.chunks === 'object'
          && Object.keys(payload.chunks).length > 0

        const normalized = hasCompactChunks
          ? {
              format: 'chunk-v2',
              version: Number(payload?.version) || 1,
              chunkWidth: Number(payload?.chunkWidth) || 64,
              worldState: {
                schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
              },
              chunks: payload.chunks,
            }
          : {
              worldState: {
                schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
              },
              modifications: payload?.modifications && typeof payload.modifications === 'object'
                ? payload.modifications
                : {},
            }

        await fs.mkdir(path.dirname(statePath), { recursive: true })
        await fs.writeFile(statePath, JSON.stringify(normalized, null, 2), 'utf-8')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true }))
      }
      catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'invalid_world_state_payload' }))
      }
      return
    }

    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
  })

  middlewares.use('/api/debug/world-state', async (req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    const spaceName = getSpaceNameFromRequest(req)
    const statePath = resolveSpaceJsonPath('world-state.json', spaceName)

    try {
      const content = await fs.readFile(statePath, 'utf-8')
      const payload = JSON.parse(content)
      const key = spaceName ? `space:${spaceName}:world-state` : 'space:default:world-state'
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ...summarizeWorldState(payload, key), space: spaceName || 'default', found: true }))
    }
    catch {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, space: spaceName || 'default', found: false }))
    }
  })
}

export default {
  server: {
    host: HOST,
    port: PORT,
  },
  build: {
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      external: ['/_vercel/insights/script.js'],
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('/schematic-renderer/') || id.includes('\\schematic-renderer\\')) {
            return 'schematic-renderer-vendor'
          }

          if (id.includes('/three/') || id.includes('three-custom-shader-material')) {
            return 'three-vendor'
          }

          if (id.includes('/vue/') || id.includes('/vue-i18n/') || id.includes('/pinia/')) {
            return 'vue-vendor'
          }

          if (id.includes('/gsap/')) {
            return 'gsap-vendor'
          }

          if (id.includes('/pako/') || id.includes('/protodef/') || id.includes('/prismarine-nbt/')) {
            return 'schematic-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ui': path.resolve(__dirname, 'src/vue'),
      '@ui-components': path.resolve(__dirname, 'src/vue/components'),
      '@pinia': path.resolve(__dirname, 'src/pinia'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@three': path.resolve(__dirname, 'src/js'),
    },
  },
  plugins: [
    {
      name: 'mock-backend-world-config',
      configureServer(server) {
        registerMockApi(server.middlewares)
      },
      configurePreviewServer(server) {
        registerMockApi(server.middlewares)
      },
    },
    glsl(),
    vue(),
    partytownVite({
      dest: path.join(__dirname, 'dist', '~partytown'),
    }),
  ],
}
