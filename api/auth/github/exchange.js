import {
  ensurePost,
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

export default async function handler(req, res) {
  if (!ensurePost(req, res)) {
    return
  }

  try {
    const body = await parseJsonBody(req)
    const code = trimString(body?.code)
    const codeVerifier = trimString(body?.codeVerifier)
    const redirectUri = trimString(body?.redirectUri)

    if (!code || !codeVerifier || !redirectUri) {
      sendError(res, 400, 'missing_required_fields', 'code, codeVerifier, redirectUri are required')
      return
    }

    const clientId = readEnv('OAUTH_GITHUB_CLIENT_ID')
    const clientSecret = readEnv('OAUTH_GITHUB_CLIENT_SECRET')

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
      sendError(
        res,
        401,
        'oauth_exchange_failed',
        trimString(data?.error_description) || trimString(data?.error) || 'github token exchange failed',
      )
      return
    }

    const account = await fetchGithubUser(data.access_token)
    sendAccount(res, account)
  }
  catch (error) {
    if (String(error?.message || '').startsWith('missing_env:')) {
      sendError(res, 500, 'server_oauth_not_configured', error.message)
      return
    }
    sendError(res, 500, 'github_auth_failed', error?.message || 'unknown_error')
  }
}
