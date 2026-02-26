function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export function sendError(status, error, details = '') {
  return json(status, {
    error,
    ...(details ? { details } : {}),
  })
}

export function sendAccount(account) {
  return json(200, { account })
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
