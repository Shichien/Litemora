/**
 * 本地 dev mock 后端的公共工具: 请求体读取, 参数清洗, public/ 路径解析,
 * JSON 文件读写, mock 会话编解码, 以及 Connect 风格的响应封装.
 *
 * 注意 `__dirname`: 本文件作为 `vite.config.js` 的子模块被 Vite 用 esbuild 打包,
 * Vite 会给每个被处理的模块注入 `__vite_injected_original_dirname`, 因此这里的
 * `__dirname` 指向 `dev/mock-api/`, 需要再上溯两级才回到仓库根目录.
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeLegacyProjectionSlug } from '../../functions/api/gallery/_gallery-slugs.js'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
export const PUBLIC_DIR = path.resolve(PROJECT_ROOT, 'public')

export const LOCAL_DEV_MOCK_ACCOUNT = {
  id: 'local-dev',
  provider: 'local-dev',
  name: 'Local Dev',
  email: 'local@litemora.dev',
  avatar: '',
}

const SAFE_SOURCE_MIME_TYPE = 'application/octet-stream'
const ALLOWED_SOURCE_FILE_EXTENSIONS = new Set(['.litematic', '.schem', '.schematic'])

/* ------------------------------------------------------------------ *
 * 响应封装 (Connect 风格, 与原来的中间件写法保持完全一致)
 * ------------------------------------------------------------------ */

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export function sendError(res, statusCode, error) {
  sendJson(res, statusCode, { error })
}

/* ------------------------------------------------------------------ *
 * 请求解析
 * ------------------------------------------------------------------ */

export function readRequestBody(req) {
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

export async function readJsonBody(req) {
  const rawBody = await readRequestBody(req)
  return rawBody ? JSON.parse(rawBody) : {}
}

export function getSpaceNameFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    return sanitizeSpaceName(requestUrl.searchParams.get('space'))
  }
  catch {
    return ''
  }
}

export function getProjectionIdFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    return String(requestUrl.searchParams.get('projection') || '').trim()
  }
  catch {
    return ''
  }
}

export function getItemIdFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    return String(requestUrl.searchParams.get('item') || '').trim()
  }
  catch {
    return ''
  }
}

export function getGallerySpaceFromBody(body = {}) {
  return sanitizeSpaceName(body?.space)
}

/* ------------------------------------------------------------------ *
 * 参数清洗
 * ------------------------------------------------------------------ */

export function sanitizeSpaceName(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return /^[a-z0-9-]{3,63}$/.test(normalized) ? normalized : ''
}

export function sanitizeProjectionName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9]/giu, '')
    .slice(0, 48)
}

export function sanitizeSourceFileName(value, fallbackValue = 'uploaded.schematic') {
  const fallback = String(fallbackValue || 'uploaded.schematic')
    .replace(/[\\/\r\n"]/g, '-')
    .trim()
  return String(value || '')
    .replace(/[\\/\r\n"]/g, '-')
    .trim() || fallback
}

export function getSourceFileExtension(fileName = '') {
  const normalized = String(fileName || '').trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return ''
  }

  return normalized.slice(dotIndex)
}

export function normalizeMockSourceFileMetadata(value = {}) {
  const fileName = sanitizeSourceFileName(value?.fileName, 'uploaded.schematic')
  if (!ALLOWED_SOURCE_FILE_EXTENSIONS.has(getSourceFileExtension(fileName))) {
    throw new Error('invalid_source_file_type')
  }

  return {
    fileName,
    mimeType: SAFE_SOURCE_MIME_TYPE,
    size: Math.max(0, Math.round(Number(value?.size || 0) || 0)),
  }
}

/**
 * 在已有条目基础上生成不冲突的投影 slug。
 * 沿用历史规则(去除非字母数字, 不插入分隔符), 与 `public/.dev-gallery/**` 里已落盘的
 * `projectionSlug` 保持一致。
 */
export function createUniqueProjectionSlug(value, items = []) {
  const baseSlug = normalizeLegacyProjectionSlug(value) || 'world'
  const usedSlugs = new Set(
    (Array.isArray(items) ? items : [])
      .map(item => normalizeLegacyProjectionSlug(item?.projectionSlug || ''))
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

/* ------------------------------------------------------------------ *
 * public/ 路径解析
 * ------------------------------------------------------------------ */

export function resolveSpaceJsonPath(fileName, spaceName = '') {
  if (!spaceName) {
    return path.resolve(PUBLIC_DIR, fileName)
  }
  return path.resolve(PUBLIC_DIR, 'spaces', spaceName, fileName)
}

export function resolveScopedSpaceJsonPath(fileName, spaceName = '', projectionId = '') {
  const normalizedProjectionId = String(projectionId || '').trim()
  if (!normalizedProjectionId) {
    return resolveSpaceJsonPath(fileName, spaceName)
  }

  if (!spaceName) {
    return path.resolve(PUBLIC_DIR, 'projections', encodeURIComponent(normalizedProjectionId), fileName)
  }

  return path.resolve(
    PUBLIC_DIR,
    'spaces',
    spaceName,
    'projections',
    encodeURIComponent(normalizedProjectionId),
    fileName,
  )
}

export function resolveGalleryRootDir() {
  return path.resolve(PUBLIC_DIR, '.dev-gallery')
}

export function resolveGallerySpaceDir(spaceName = '') {
  return path.resolve(resolveGalleryRootDir(), spaceName || 'default')
}

export function resolveGalleryProfilePath(spaceName = '') {
  return path.resolve(resolveGallerySpaceDir(spaceName), 'profile.json')
}

export function resolveGalleryManifestPath(spaceName = '') {
  return path.resolve(resolveGallerySpaceDir(spaceName), 'manifest.json')
}

export function resolveGalleryItemPath(spaceName = '', itemId = '') {
  return path.resolve(resolveGallerySpaceDir(spaceName), 'items', `${encodeURIComponent(itemId)}.json`)
}

export function resolveGallerySourcePath(spaceName = '', itemId = '') {
  return path.resolve(resolveGallerySpaceDir(spaceName), 'sources', `${encodeURIComponent(itemId)}.bin`)
}

/* ------------------------------------------------------------------ *
 * JSON 文件读写
 * ------------------------------------------------------------------ */

export async function readJsonFileOr(filePath, fallbackValue) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  }
  catch {
    return fallbackValue
  }
}

export async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

export async function deleteFileIfExists(filePath) {
  try {
    await fs.unlink(filePath)
  }
  catch {
    // ignore missing file in local mock mode
  }
}

/* ------------------------------------------------------------------ *
 * mock 会话
 * ------------------------------------------------------------------ */

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

export function createMockSession(account) {
  return {
    token: `mock.${toBase64UrlText(JSON.stringify(account))}`,
    expiresAt: Date.now() + (1000 * 60 * 60 * 24 * 14),
  }
}

export function isLocalDevMockAccount(account = null) {
  return account?.provider === LOCAL_DEV_MOCK_ACCOUNT.provider && account?.id === LOCAL_DEV_MOCK_ACCOUNT.id
}

export function readMockAccount(req) {
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

/* ------------------------------------------------------------------ *
 * 图库权限与可见性
 * ------------------------------------------------------------------ */

export function canManageMockGallery(viewerAccount = null, profile = null) {
  return !!viewerAccount?.id && viewerAccount.id === profile?.ownerAccountId
}

export function filterVisibleGalleryItems(items = [], viewerAccount = null, profile = null) {
  const canManage = canManageMockGallery(viewerAccount, profile)
  return items.filter(item => canManage || item?.visibility !== 'private')
}

/* ------------------------------------------------------------------ *
 * 世界状态摘要
 * ------------------------------------------------------------------ */

export function summarizeWorldState(payload = {}, key = 'world-state') {
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
