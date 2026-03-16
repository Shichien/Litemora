const ADMIN_AUTH_SESSION_KEY = 'mc-admin-auth-session'
const OAUTH_POPUP_TIMEOUT_MS = 120000
const ADMIN_AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24
const TEMP_ADMIN_PASSWORD = 'admin123'
const ROOT_OAUTH_ORIGIN = 'https://litemora.art'
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

function getRedirectUri(provider) {
  const host = String(window.location.hostname || '').toLowerCase()
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const callbackOrigin = isLocal ? window.location.origin : ROOT_OAUTH_ORIGIN
  const url = new URL('/auth-callback.html', callbackOrigin)
  url.searchParams.set('provider', provider)
  return url.toString()
}

function getProviderRuntimeConfig(provider) {
  const config = PROVIDER_CONFIG[provider]
  if (!config) {
    throw new Error(`不支持的登录提供商: ${provider}`)
  }

  const clientId = import.meta.env[config.clientIdEnv]
  if (!clientId) {
    throw new Error(`${config.label} 登录未配置，请设置 ${config.clientIdEnv}`)
  }

  return {
    ...config,
    clientId,
    redirectUri: getRedirectUri(provider),
  }
}

function openOAuthPopup(url, provider) {
  const width = 560
  const height = 700
  const left = window.screenX + Math.max(0, Math.round((window.outerWidth - width) / 2))
  const top = window.screenY + Math.max(0, Math.round((window.outerHeight - height) / 2))
  const popup = window.open(
    url,
    `mc-admin-auth-${provider}`,
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

    const onMessage = (event) => {
      if (event.origin !== expectedOrigin) {
        return
      }

      const payload = event.data
      if (!payload || payload.type !== 'mc-admin-oauth-code') {
        return
      }

      if (payload.provider !== provider) {
        return
      }

      if (payload.error) {
        fail(new Error(payload.errorDescription || payload.error))
        return
      }

      if (payload.state !== state) {
        fail(new Error('登录校验失败，请重试'))
        return
      }

      cleanup()
      resolve({ code: payload.code })
    }

    function cleanup() {
      window.removeEventListener('message', onMessage)
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
        fail(new Error('登录窗口已关闭'))
      }
    }, 500)

    window.addEventListener('message', onMessage)
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

  return [
    { id: 'github', label: PROVIDER_CONFIG.github.label },
  ]
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

export function saveAdminAuthSession(account) {
  const normalized = normalizeSessionPayload(account)
  localStorage.setItem(ADMIN_AUTH_SESSION_KEY, JSON.stringify(normalized))
  emitAdminAuthChanged(normalized)
  return normalized
}

export function clearAdminAuthSession() {
  localStorage.removeItem(ADMIN_AUTH_SESSION_KEY)
  emitAdminAuthChanged(null)
}

export async function signInWithPassword(password) {
  if (String(password || '') !== TEMP_ADMIN_PASSWORD) {
    throw new Error('密码错误')
  }

  return saveAdminAuthSession({
    id: 'temp-admin',
    provider: 'password',
    name: 'Temporary Admin',
  })
}

export async function signInWithProvider(provider) {
  if (provider === 'local-dev' || isLocalDevAuthEnabled()) {
    return saveAdminAuthSession(buildLocalDevSession())
  }

  const runtime = getProviderRuntimeConfig(provider)
  const state = randomString(24)
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

  const popup = openOAuthPopup(authUrl.toString(), provider)
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
