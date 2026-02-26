import {
  normalizeAccount,
  parseJsonBody,
  postForm,
  readEnv,
  sendAccount,
  sendError,
  trimString,
} from '../../_shared.js'

async function fetchGoogleUser(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('google_profile_fetch_failed')
  }

  const profile = await response.json()
  const sub = trimString(profile?.sub)
  if (!sub) {
    throw new Error('google_profile_invalid')
  }

  return normalizeAccount({
    provider: 'google',
    id: sub,
    name: trimString(profile?.name),
    email: trimString(profile?.email),
    avatar: trimString(profile?.picture),
  })
}

export async function onRequestPost(context) {
  try {
    const body = await parseJsonBody(context.request)
    const code = trimString(body?.code)
    const codeVerifier = trimString(body?.codeVerifier)
    const redirectUri = trimString(body?.redirectUri)

    if (!code || !codeVerifier || !redirectUri) {
      return sendError(400, 'missing_required_fields', 'code, codeVerifier, redirectUri are required')
    }

    const clientId = readEnv(context.env, 'OAUTH_GOOGLE_CLIENT_ID')
    const clientSecret = readEnv(context.env, 'OAUTH_GOOGLE_CLIENT_SECRET')

    const { response, data } = await postForm('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    })

    if (!response.ok || !data?.access_token) {
      const details = data?.error_description
        || (Array.isArray(data?.error_details) ? data.error_details.join('; ') : '')
        || data?.error
        || 'google token exchange failed'
      return sendError(401, 'oauth_exchange_failed', trimString(details))
    }

    const account = await fetchGoogleUser(data.access_token)
    return sendAccount(account)
  }
  catch (error) {
    if (String(error?.message || '').startsWith('missing_env:')) {
      return sendError(500, 'server_oauth_not_configured', error.message)
    }
    return sendError(500, 'google_auth_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
