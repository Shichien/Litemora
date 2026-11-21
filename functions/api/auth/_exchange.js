import { issueAccountSession, parseJsonBody, postForm, readEnv, sendAccount, sendError, trimString } from './_shared.js'

export function createOAuthExchange(provider, tokenUrl, fetchAccount) {
  const prefix = `OAUTH_${provider.toUpperCase()}`
  return async ({ request, env }) => {
    try {
      const body = await parseJsonBody(request)
      const code = trimString(body?.code)
      const codeVerifier = trimString(body?.codeVerifier)
      const redirectUri = trimString(body?.redirectUri)
      if (!code || !codeVerifier || !redirectUri) {
        return sendError(400, 'missing_required_fields', 'code, codeVerifier, redirectUri are required')
      }
      const clientId = readEnv(env, `${prefix}_CLIENT_ID`)
      const clientSecret = readEnv(env, `${prefix}_CLIENT_SECRET`)
      readEnv(env, 'LITEMORA_SESSION_SECRET')
      const form = { code, code_verifier: codeVerifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }
      const headers = { Accept: 'application/json' }
      if (provider === 'x') {
        headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`
      }
      else {
        form.client_id = clientId
        form.client_secret = clientSecret
      }
      const { response, data } = await postForm(tokenUrl, form, headers)
      if (!response.ok || !data?.access_token) {
        return sendError(401, 'oauth_exchange_failed', trimString(data?.error_description) || trimString(data?.error))
      }
      const account = await fetchAccount(data.access_token)
      return sendAccount(account, await issueAccountSession(env, account))
    }
    catch (error) {
      if (error.message?.startsWith('missing_env:')) {
        return sendError(500, 'server_oauth_not_configured', error.message)
      }
      return sendError(500, `${provider}_auth_failed`, error.message)
    }
  }
}

export function methodNotAllowed() {
  return sendError(405, 'method_not_allowed')
}
