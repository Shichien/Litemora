import { createOAuthExchange, methodNotAllowed } from '../_exchange.js'
import { normalizeAccount, trimString } from '../_shared.js'

async function fetchXUser(accessToken) {
  const response = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok)
    throw new Error('x_profile_fetch_failed')
  const { data } = await response.json()
  if (!trimString(data?.id))
    throw new Error('x_profile_invalid')
  return normalizeAccount({
    provider: 'x',
    id: data.id,
    name: trimString(data.name) || trimString(data.username),
    avatar: trimString(data.profile_image_url),
  })
}

export const onRequestPost = createOAuthExchange('x', 'https://api.x.com/2/oauth2/token', fetchXUser)
export const onRequest = methodNotAllowed
