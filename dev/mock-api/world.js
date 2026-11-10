/**
 * 本地 dev mock: world-config / world-state 相关端点。
 *
 * 路由与响应完全沿用原来写在 `vite.config.js` 里的实现:
 * - GET  /api/world-config
 * - POST /api/world-config
 * - GET  /api/world-state
 * - POST /api/world-state
 * - GET  /api/debug/world-state
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  canManageMockGallery,
  getProjectionIdFromRequest,
  getSpaceNameFromRequest,
  isLocalDevMockAccount,
  readJsonFileOr,
  readMockAccount,
  readRequestBody,
  resolveGalleryProfilePath,
  resolveScopedSpaceJsonPath,
  resolveSpaceJsonPath,
  sendError,
  sendJson,
  summarizeWorldState,
} from './helpers.js'

/**
 * 根目录 `public/world-state.json` 已从仓库移除(它同时是一份 780KB 的损坏 JSON,
 * 又会被 vite 原样拷进 dist)。这里用等价的默认值代替, 保证"文件不存在"这条分支
 * 的返回值不变。
 */
const DEFAULT_WORLD_STATE = {
  worldState: { schematicOnlyMode: false },
  modifications: {},
}

export function registerWorldMockApi(middlewares) {
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
          sendError(res, 500, 'failed_to_read_world_config')
        }
      }
      return
    }

    if (req.method === 'POST') {
      try {
        if (!spaceName) {
          sendError(res, 400, 'invalid_space_name')
          return
        }

        const viewer = readMockAccount(req)
        const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
        if (!viewer) {
          sendError(res, 401, 'authentication_required')
          return
        }
        if (!isLocalDevMockAccount(viewer) && !canManageMockGallery(viewer, profile)) {
          sendError(res, 403, 'world_write_forbidden')
          return
        }

        const rawBody = await readRequestBody(req)
        const payload = rawBody ? JSON.parse(rawBody) : {}
        if (!payload || typeof payload !== 'object') {
          throw new Error('invalid_world_config_payload')
        }

        await fs.mkdir(path.dirname(jsonPath), { recursive: true })
        await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf-8')
        sendJson(res, 200, { ok: true })
      }
      catch {
        sendError(res, 400, 'invalid_world_config_payload')
      }
      return
    }

    sendError(res, 405, 'method_not_allowed')
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
        sendJson(res, 200, DEFAULT_WORLD_STATE)
      }
      return
    }

    if (req.method === 'POST') {
      try {
        if (!spaceName) {
          sendError(res, 400, 'invalid_space_name')
          return
        }

        const viewer = readMockAccount(req)
        const profile = await readJsonFileOr(resolveGalleryProfilePath(spaceName), null)
        if (!viewer) {
          sendError(res, 401, 'authentication_required')
          return
        }
        if (!isLocalDevMockAccount(viewer) && !canManageMockGallery(viewer, profile)) {
          sendError(res, 403, 'world_write_forbidden')
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
        sendJson(res, 200, { ok: true })
      }
      catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'invalid_world_state_payload' }))
      }
      return
    }

    sendError(res, 405, 'method_not_allowed')
  })

  middlewares.use('/api/debug/world-state', async (req, res) => {
    if (req.method !== 'GET') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    const spaceName = getSpaceNameFromRequest(req)
    const statePath = resolveSpaceJsonPath('world-state.json', spaceName)

    try {
      const content = await fs.readFile(statePath, 'utf-8')
      const payload = JSON.parse(content)
      const key = spaceName ? `space:${spaceName}:world-state` : 'space:default:world-state'
      sendJson(res, 200, {
        ...summarizeWorldState(payload, key),
        space: spaceName || 'default',
        found: true,
      })
    }
    catch {
      sendJson(res, 200, { ok: false, space: spaceName || 'default', found: false })
    }
  })
}
