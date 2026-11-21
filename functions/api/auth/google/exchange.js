import { createOAuthExchange, methodNotAllowed } from '../_exchange.js'
import { normalizeAccount, trimString } from '../_shared.js'

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

export const onRequestPost = createOAuthExchange('google', 'https://oauth2.googleapis.com/token', fetchGoogleUser)
export const onRequest = methodNotAllowed
