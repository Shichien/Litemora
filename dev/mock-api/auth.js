import { onRequestPost as discord } from '../../functions/api/auth/discord/exchange.js'
import { onRequestPost as github } from '../../functions/api/auth/github/exchange.js'
import { onRequestPost as google } from '../../functions/api/auth/google/exchange.js'
import { onRequestPost as x } from '../../functions/api/auth/x/exchange.js'
import { createMockSession, readRequestBody, sendError, sendJson } from './helpers.js'

export function registerAuthMockApi(middlewares, env) {
  for (const [provider, exchange] of Object.entries({ github, google, x, discord })) {
    middlewares.use(`/api/auth/${provider}/exchange`, async (req, res, next) => {
      if (req.method !== 'POST') {
        sendError(res, 405, 'method_not_allowed')
        return
      }
      try {
        const request = new Request(`http://localhost/api/auth/${provider}/exchange`, {
          method: 'POST',
          body: await readRequestBody(req),
        })
        const response = await exchange({ request, env })
        const payload = await response.json()
        // The filesystem-backed gallery consumes local sessions for verified accounts.
        if (response.ok)
          payload.session = createMockSession(payload.account)
        res.setHeader('Cache-Control', 'no-store')
        sendJson(res, response.status, payload)
      }
      catch (error) {
        next(error)
      }
    })
  }
}
