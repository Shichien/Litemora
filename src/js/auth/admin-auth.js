const ADMIN_AUTH_SESSION_KEY = 'mc-admin-auth-session'
const ADMIN_AUTH_OAUTH_RESULT_KEY = 'mc-admin-oauth-result'
const OAUTH_POPUP_TIMEOUT_MS = 120000
const ADMIN_AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24
const OAUTH_POPUP_CLOSE_GRACE_MS = 1500
const CONFIGURED_OAUTH_CALLBACK_ORIGIN = typeof import.meta !== 'undefined'
  ? String(import.meta.env.VITE_OAUTH_CALLBACK_ORIGIN || '').trim()
  : ''
const LOCAL_DEV_ADMIN_SESSION = {
  account: {
    id: 'local-dev',
    provider: 'local-dev',
    name: 'Local Dev',
    email: 'local@litemora.dev',
    avatar: '',
  },
  token: 'local-dev-session',
  expiresAt: 0,
  updatedAt: 0,
  localOnly: true,
}

const PROVIDER_CONFIG = {
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    scope: 'read:user user:email',
    clientIdEnv: 'VITE_OAUTH_GITHUB_CLIENT_ID',
  },
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    clientIdEnv: 'VITE_OAUTH_GOOGLE_CLIENT_ID',
  },
}

function readProviderClientId(config) {
  if (!config?.clientIdEnv) {
    return ''
  }

  return String(import.meta.env[config.clientIdEnv] || '').trim()
}

function isLocalDevHost() {
  const host = String(window.location.hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
}

export function isLocalDevAuthEnabled() {
  return import.meta.env.DEV && isLocalDevHost()
}

function buildLocalDevSession() {
  return {
    ...LOCAL_DEV_ADMIN_SESSION,
    account: {
      ...LOCAL_DEV_ADMIN_SESSION.account,
    },
    updatedAt: Date.now(),
  }
}

export function isLocalDevAuthSession(session = null) {
  const account = session?.account || null
  return account?.provider === 'local-dev' && account?.id === 'local-dev'
}

function toBase64Url(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromUtf8ToBytes(text) {
  return new TextEncoder().encode(text)
}

function randomString(size = 32) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

async function sha256Base64Url(input) {
  const digest = await crypto.subtle.digest('SHA-256', fromUtf8ToBytes(input))
  return toBase64Url(new Uint8Array(digest))
}

// Google (and GitHub) require the redirect_uri to match a pre-registered value
// exactly, query string included. A `?provider=` suffix would mean registering
// one URI per provider, so the callback stays a single provider-agnostic path
// and the provider travels in the cryptographically random state instead.
function getRedirectUri() {
  const host = String(window.location.hostname || '').toLowerCase()
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const callbackOrigin = isLocal
    ? window.location.origin
    : (CONFIGURED_OAUTH_CALLBACK_ORIGIN || window.location.origin)
  return new URL('/auth-callback.html', callbackOrigin).toString()
}

function getProviderRuntimeConfig(provider) {
  const config = PROVIDER_CONFIG[provider]
  if (!config) {
    throw new Error(`不支持的登录提供商: ${provider}`)
  }

  const clientId = readProviderClientId(config)
  if (!clientId) {
    throw new Error(`${config.label} 登录未配置，请设置 ${config.clientIdEnv}`)
  }

  return {
    ...config,
    clientId,
    redirectUri: getRedirectUri(),
  }
}

function openOAuthPopup(url, state) {
  const width = 560
  const height = 700
  const left = window.screenX + Math.max(0, Math.round((window.outerWidth - width) / 2))
  const top = window.screenY + Math.max(0, Math.round((window.outerHeight - height) / 2))
  const popup = window.open(
    url,
    `mc-admin-auth-${state}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  )

  if (!popup) {
    throw new Error('无法打开登录窗口，请允许弹窗后重试')
  }

  return popup
}

function waitForOAuthCode({ provider, state, popup, expectedOrigin }) {
  return new Promise((resolve, reject) => {
    let timeoutId = null
    let closedCheckId = null
    let closedAt = 0

    const callbackOrigin = expectedOrigin || window.location.origin

    const finalizePayload = (payload) => {
      if (!payload || payload.type !== 'mc-admin-oauth-code') {
        return
      }

      // Unrelated attempts (including errors) must not settle this promise.
      // The provider prefix only routes the result; the full nonce authenticates it.
      if (payload.provider !== provider || payload.state !== state) {
        return
      }

      if (payload.error) {
        fail(new Error(payload.errorDescription || payload.error))
        return
      }

      if (typeof payload.code !== 'string' || !payload.code.trim()) {
        fail(new Error('登录回调缺少授权码，请重试'))
        return
      }

      cleanup()
      resolve({ code: payload.code })
    }

    const onMessage = (event) => {
      if (event.origin !== callbackOrigin || event.source !== popup) {
        return
      }

      finalizePayload(event.data)
    }

    const onStorage = (event) => {
      // Storage is only a same-origin fallback; never trust it for a remote callback.
      if (callbackOrigin !== window.location.origin
        || event.key !== ADMIN_AUTH_OAUTH_RESULT_KEY || !event.newValue) {
        return
      }

      try {
        // Do not delete a shared slot: another simultaneous attempt may own it.
        // In particular, unavailable storage must not prevent payload processing.
        finalizePayload(JSON.parse(event.newValue))
      }
      catch {
        // ignore malformed payloads
      }
    }

    function cleanup() {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('storage', onStorage)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (closedCheckId) {
        clearInterval(closedCheckId)
      }
    }

    function fail(error) {
      cleanup()
      reject(error)
    }

    timeoutId = setTimeout(() => {
      fail(new Error('登录超时，请重试'))
    }, OAUTH_POPUP_TIMEOUT_MS)

    closedCheckId = setInterval(() => {
      if (popup.closed) {
        if (!closedAt) {
          closedAt = Date.now()
          return
        }

        if ((Date.now() - closedAt) >= OAUTH_POPUP_CLOSE_GRACE_MS) {
          fail(new Error('登录窗口已关闭'))
        }
      }
      else {
        closedAt = 0
      }
    }, 500)

    window.addEventListener('message', onMessage)
    window.addEventListener('storage', onStorage)
  })
}

async function exchangeCode({ provider, code, codeVerifier, redirectUri }) {
  const response = await fetch(`/api/auth/${provider}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      codeVerifier,
      redirectUri,
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || `${provider} 登录失败`)
  }

  const payload = await response.json()
  if (!payload?.account?.id) {
    throw new Error('登录成功但账户信息无效')
  }

  return payload
}

function emitAdminAuthChanged(session = null) {
  window.dispatchEvent(new CustomEvent('admin-auth-changed', {
    detail: {
      session,
    },
  }))
}

function normalizeAccountPayload(account) {
  return {
    id: String(account?.id || ''),
    provider: String(account?.provider || ''),
    name: account?.name ? String(account.name) : '',
    email: account?.email ? String(account.email) : '',
    avatar: account?.avatar ? String(account.avatar) : '',
  }
}

function normalizeSessionPayload(input) {
  const account = input?.account ? input.account : input
  const session = input?.session || input || null

  return {
    account: normalizeAccountPayload(account),
    token: session?.token ? String(session.token) : '',
    expiresAt: Number(session?.expiresAt || 0),
    updatedAt: Date.now(),
    localOnly: !!session?.localOnly,
  }
}

export function getAuthProviders() {
  if (isLocalDevAuthEnabled()) {
    return [
      { id: 'local-dev', label: 'Local Dev' },
    ]
  }

  // 只暴露已经配好 client id 的提供商，避免出现点了才报错的死按钮。
  const providers = Object.entries(PROVIDER_CONFIG)
    .filter(([, config]) => !!readProviderClientId(config))
    .map(([id, config]) => ({ id, label: config.label }))

  // 全部未配置时保留 GitHub 入口，维持既有行为不变。
  if (!providers.length) {
    return [
      { id: 'github', label: PROVIDER_CONFIG.github.label },
    ]
  }

  return providers
}

export function loadAdminAuthSession() {
  const fallbackLocalSession = isLocalDevAuthEnabled() ? buildLocalDevSession() : null

  try {
    const raw = localStorage.getItem(ADMIN_AUTH_SESSION_KEY)
    if (!raw) {
      return fallbackLocalSession
    }
    const session = JSON.parse(raw)
    if (!session?.account?.id || !session?.account?.provider) {
      return fallbackLocalSession
    }
    if (session.account.provider === 'password') {
      localStorage.removeItem(ADMIN_AUTH_SESSION_KEY)
      emitAdminAuthChanged(null)
      return fallbackLocalSession
    }

    const updatedAt = Number(session.updatedAt || 0)
    const expiresAt = Number(session.expiresAt || 0)
    const tokenExpired = expiresAt > 0 && Date.now() > expiresAt
    const ttlExpired = !updatedAt || (Date.now() - updatedAt) > ADMIN_AUTH_SESSION_TTL_MS
    const isExpired = tokenExpired || ttlExpired
    if (isExpired) {
      localStorage.removeItem(ADMIN_AUTH_SESSION_KEY)
      emitAdminAuthChanged(null)
      return fallbackLocalSession
    }

    const touchedSession = {
      ...session,
      updatedAt: Date.now(),
    }
    localStorage.setItem(ADMIN_AUTH_SESSION_KEY, JSON.stringify(touchedSession))

    return touchedSession
  }
  catch {
    return fallbackLocalSession
  }
}

function saveAdminAuthSession(account) {
  const normalized = normalizeSessionPayload(account)
  try {
    localStorage.setItem(ADMIN_AUTH_SESSION_KEY, JSON.stringify(normalized))
  }
  catch {
    // Authentication still succeeds when persistence is unavailable.
  }
  emitAdminAuthChanged(normalized)
  return normalized
}

export function clearAdminAuthSession() {
  localStorage.removeItem(ADMIN_AUTH_SESSION_KEY)
  emitAdminAuthChanged(null)
}

export async function signInWithProvider(provider) {
  if (provider === 'local-dev' || isLocalDevAuthEnabled()) {
    return saveAdminAuthSession(buildLocalDevSession())
  }

  const runtime = getProviderRuntimeConfig(provider)
  const state = `${provider}.${randomString(24)}`
  const codeVerifier = randomString(64)
  const codeChallenge = await sha256Base64Url(codeVerifier)

  const authUrl = new URL(runtime.authorizeUrl)
  authUrl.searchParams.set('client_id', runtime.clientId)
  authUrl.searchParams.set('redirect_uri', runtime.redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', runtime.scope)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  const popup = openOAuthPopup(authUrl.toString(), state)
  const { code } = await waitForOAuthCode({
    provider,
    state,
    popup,
    expectedOrigin: new URL(runtime.redirectUri).origin,
  })

  popup.close()

  const payload = await exchangeCode({
    provider,
    code,
    codeVerifier,
    redirectUri: runtime.redirectUri,
  })

  return saveAdminAuthSession(payload)
}

export function getAdminAuthToken(session = null) {
  const resolvedSession = session || loadAdminAuthSession()
  const token = resolvedSession?.token ? String(resolvedSession.token) : ''
  return token || ''
}
