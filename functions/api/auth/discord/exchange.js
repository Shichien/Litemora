import { createOAuthExchange, methodNotAllowed } from '../_exchange.js'
import { normalizeAccount, trimString } from '../_shared.js'

async function fetchDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok)
    throw new Error('discord_profile_fetch_failed')
  const user = await response.json()
  if (!trimString(user?.id))
    throw new Error('discord_profile_invalid')
  return normalizeAccount({
    provider: 'discord',
    id: user.id,
    name: trimString(user.global_name) || trimString(user.username),
    email: user.verified ? trimString(user.email) : '',
    avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : '',
  })
}

export const onRequestPost = createOAuthExchange('discord', 'https://discord.com/api/oauth2/token', fetchDiscordUser)
export const onRequest = methodNotAllowed
