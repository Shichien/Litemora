import process from 'node:process'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function setJsonHeaders(res) {
  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value)
  })
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  setJsonHeaders(res)
  res.end(JSON.stringify(payload))
}

export function sendError(res, statusCode, error, details = '') {
  sendJson(res, statusCode, {
    error,
    ...(details ? { details } : {}),
  })
}

export function sendAccount(res, account) {
  sendJson(res, 200, { account })
}

export function readEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`missing_env:${name}`)
  }
  return value
}

export async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body
  }

  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      }
      catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export function ensurePost(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, 'method_not_allowed')
    return false
  }
  return true
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

export function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
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
