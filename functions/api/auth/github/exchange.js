import {
  normalizeAccount,
  parseJsonBody,
  postForm,
  readEnv,
  sendAccount,
  sendError,
  trimString,
} from '../../_shared.js'

async function fetchGithubUser(accessToken) {
  const profileRes = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'third-person-mc-oauth',
    },
  })

  if (!profileRes.ok) {
    throw new Error('github_profile_fetch_failed')
  }

  const profile = await profileRes.json()

  const emailsRes = await fetch('https://api.github.com/user/emails', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'third-person-mc-oauth',
    },
  })

  let email = trimString(profile?.email)
  if (emailsRes.ok) {
    const emails = await emailsRes.json().catch(() => [])
    const primary = Array.isArray(emails)
      ? emails.find(entry => entry?.primary && entry?.verified)
      || emails.find(entry => entry?.verified)
      : null
    email = trimString(primary?.email) || email
  }

  const id = profile?.id
  if (!id) {
    throw new Error('github_profile_invalid')
  }

  return normalizeAccount({
    provider: 'github',
    id: String(id),
    name: trimString(profile?.name) || trimString(profile?.login),
    email,
    avatar: trimString(profile?.avatar_url),
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

    const clientId = readEnv(context.env, 'OAUTH_GITHUB_CLIENT_ID')
    const clientSecret = readEnv(context.env, 'OAUTH_GITHUB_CLIENT_SECRET')

    const { response, data } = await postForm(
      'https://github.com/login/oauth/access_token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
      {
        Accept: 'application/json',
      },
    )

    if (!response.ok || !data?.access_token) {
      return sendError(
        401,
        'oauth_exchange_failed',
        trimString(data?.error_description) || trimString(data?.error) || 'github token exchange failed',
      )
    }

    const account = await fetchGithubUser(data.access_token)
    return sendAccount(account)
  }
  catch (error) {
    if (String(error?.message || '').startsWith('missing_env:')) {
      return sendError(500, 'server_oauth_not_configured', error.message)
    }
    return sendError(500, 'github_auth_failed', error?.message || 'unknown_error')
  }
}

export function onRequest() {
  return sendError(405, 'method_not_allowed')
}
