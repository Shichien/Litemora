/* eslint-disable test/no-import-node-test -- Node test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readAccountSession } from '../functions/api/auth/_shared.js'
import { onRequestPost as discord } from '../functions/api/auth/discord/exchange.js'
import { onRequestPost as github } from '../functions/api/auth/github/exchange.js'
import { onRequestPost as google } from '../functions/api/auth/google/exchange.js'
import { onRequestPost as x } from '../functions/api/auth/x/exchange.js'

const providers = [
  ['github', github, 'https://github.com/login/oauth/access_token', 'https://api.github.com/user', { id: 123, login: 'builder' }],
  ['google', google, 'https://oauth2.googleapis.com/token', 'https://openidconnect.googleapis.com/v1/userinfo', { sub: '123', name: 'builder' }],
  ['x', x, 'https://api.x.com/2/oauth2/token', 'https://api.x.com/2/users/me?user.fields=profile_image_url', { data: { id: '123', name: 'builder' } }],
  ['discord', discord, 'https://discord.com/api/oauth2/token', 'https://discord.com/api/v10/users/@me', { id: '123', username: 'builder' }],
]

const redirectUri = 'https://app.example/auth-callback.html'
function request() {
  return new Request('https://app.example/api/auth', {
    method: 'POST',
    body: JSON.stringify({ code: 'code', codeVerifier: 'verifier', redirectUri }),
  })
}

for (const [provider, exchange, tokenUrl, profileUrl, profile] of providers) {
  test(`${provider} exchanges a code and issues a session for the verified profile`, async (t) => {
    const prefix = `OAUTH_${provider.toUpperCase()}`
    const env = { [`${prefix}_CLIENT_ID`]: 'id', [`${prefix}_CLIENT_SECRET`]: 'secret', LITEMORA_SESSION_SECRET: 'test-session-key' }
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url === tokenUrl) {
        const form = new URLSearchParams(options.body)
        assert.equal(options.method, 'POST')
        assert.equal(form.get('redirect_uri'), redirectUri)
        assert.equal(form.get('code_verifier'), 'verifier')
        assert.equal(form.get('code'), 'code')
        if (provider === 'x') {
          assert.equal(options.headers.Authorization, `Basic ${btoa('id:secret')}`)
          assert.equal(form.has('client_secret'), false)
        }
        else {
          assert.equal(form.get('client_id'), 'id')
          assert.equal(form.get('client_secret'), 'secret')
        }
        return Response.json({ access_token: 'provider-access' })
      }
      assert.equal(options.headers.Authorization, 'Bearer provider-access')
      if (provider === 'github' && url === 'https://api.github.com/user/emails')
        return Response.json([])
      assert.equal(url, profileUrl)
      return Response.json(profile)
    })
    const result = await exchange({ request: request(), env })
    assert.equal(result.status, 200)
    const { account, session } = await result.json()
    assert.equal(account.id, `${provider}:123`)
    assert.equal(account.name, 'builder')
    const viewer = await readAccountSession(new Request(redirectUri, { headers: { Authorization: `Bearer ${session.token}` } }), env)
    assert.equal(viewer.id, account.id)
    assert.equal((await exchange({ request: request(), env: {} })).status, 500)
    globalThis.fetch.mock.mockImplementation(() => Response.json({ error: 'invalid_grant' }, { status: 400 }))
    assert.equal((await exchange({ request: request(), env })).status, 401)
  })
}
