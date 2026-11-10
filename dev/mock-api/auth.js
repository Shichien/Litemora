/**
 * 本地 dev mock: 认证相关端点。
 *
 * - POST /api/auth/github/exchange  —— 沿用原有 mock 行为(不请求真实 GitHub)
 * - POST /api/auth/google/exchange  —— 新增, 与 `functions/api/auth/google/exchange.js` 对齐:
 *   mock 环境没有 OAUTH_GOOGLE_CLIENT_ID/SECRET, 真实实现会返回
 *   `500 server_oauth_not_configured`。这里保持同样的状态码与错误码, 并额外给出
 *   `details` 说明这是本地 mock, 方便前端在本地看到明确的失败原因。
 */
import { createMockSession, readRequestBody, sendError, sendJson } from './helpers.js'

export function registerAuthMockApi(middlewares) {
  middlewares.use('/api/auth/github/exchange', async (req, res) => {
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const provider = 'github'
      const code = String(payload?.code || '').trim()

      if (!code) {
        sendError(res, 400, 'missing_oauth_code')
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

      sendJson(res, 200, { account, session })
    }
    catch {
      sendError(res, 400, 'invalid_auth_payload')
    }
  })

  middlewares.use('/api/auth/google/exchange', async (req, res) => {
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed')
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const code = String(payload?.code || '').trim()
      const codeVerifier = String(payload?.codeVerifier || '').trim()
      const redirectUri = String(payload?.redirectUri || '').trim()

      // 与线上实现一致: 三个字段缺一不可
      if (!code || !codeVerifier || !redirectUri) {
        sendError(res, 400, 'missing_required_fields')
        return
      }

      // mock 环境没有配置 Google OAuth 凭据, 线上此时也是 500 server_oauth_not_configured
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        error: 'server_oauth_not_configured',
        details: 'missing_env:OAUTH_GOOGLE_CLIENT_ID (local mock: Google OAuth is unavailable)',
      }))
    }
    catch {
      sendError(res, 400, 'invalid_auth_payload')
    }
  })
}
