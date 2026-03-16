function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14

function toBinaryString(bytes) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return binary
}

function fromBinaryString(binary) {
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function toBase64Url(bytes) {
  return btoa(toBinaryString(bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const padded = normalized + '==='.slice((normalized.length + 3) % 4)
  return fromBinaryString(atob(padded))
}

function getSessionSecret(env) {
  return trimString(env?.LITEMORA_SESSION_SECRET)
}

async function importSessionKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signSessionBody(secret, body) {
  const key = await importSessionKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return toBase64Url(new Uint8Array(signature))
}

export function sendError(status, error, details = '', extra = {}) {
  return json(status, {
    error,
    ...(details ? { details } : {}),
    ...extra,
  })
}

export function sendAccount(account, session = null) {
  return json(200, {
    account,
    ...(session ? { session } : {}),
  })
}

export function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeAccount({ provider, id, name = '', email = '', avatar = '' }) {
  return {
    id: `${provider}:${id}`,
    provider,
    name,
    email,
    avatar,
  }
}

export function readEnv(env, name) {
  const value = env?.[name]
  if (!value) {
    throw new Error(`missing_env:${name}`)
  }
  return String(value)
}

export async function parseJsonBody(request) {
  try {
    return await request.json()
  }
  catch {
    return {}
  }
}

export async function postForm(url, payload, headers = {}) {
  const form = new URLSearchParams()
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      form.set(key, String(value))
    }
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: form.toString(),
  })

  const data = await response.json().catch(() => null)
  return { response, data }
}

export async function issueAccountSession(env, account) {
  const secret = getSessionSecret(env)
  if (!secret) {
    return null
  }

  const issuedAt = Date.now()
  const expiresAt = issuedAt + SESSION_TTL_MS
  const payload = {
    sub: trimString(account?.id),
    provider: trimString(account?.provider),
    name: trimString(account?.name),
    email: trimString(account?.email),
    avatar: trimString(account?.avatar),
    iat: issuedAt,
    exp: expiresAt,
  }

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await signSessionBody(secret, body)

  return {
    token: `${body}.${signature}`,
    expiresAt,
  }
}

export async function readAccountSession(request, env) {
  const secret = getSessionSecret(env)
  if (!secret) {
    return null
  }

  const authorization = trimString(request.headers.get('Authorization'))
  const bearerPrefix = 'Bearer '
  const token = authorization.startsWith(bearerPrefix)
    ? authorization.slice(bearerPrefix.length).trim()
    : trimString(request.headers.get('X-Litemora-Session'))

  if (!token) {
    return null
  }

  const [body, signature] = token.split('.')
  if (!body || !signature) {
    return null
  }

  try {
    const expectedSignature = await signSessionBody(secret, body)
    if (expectedSignature !== signature) {
      return null
    }

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
    const expiresAt = Number(payload?.exp || 0)
    if (!expiresAt || Date.now() > expiresAt) {
      return null
    }

    const id = trimString(payload?.sub)
    const provider = trimString(payload?.provider)
    if (!id || !provider) {
      return null
    }

    return {
      id,
      provider,
      name: trimString(payload?.name),
      email: trimString(payload?.email),
      avatar: trimString(payload?.avatar),
      expiresAt,
      token,
    }
  }
  catch {
    return null
  }
}
