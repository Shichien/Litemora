import { createOAuthExchange, methodNotAllowed } from '../_exchange.js'
import { normalizeAccount, trimString } from '../_shared.js'

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

export const onRequestPost = createOAuthExchange('github', 'https://github.com/login/oauth/access_token', fetchGithubUser)
export const onRequest = methodNotAllowed
