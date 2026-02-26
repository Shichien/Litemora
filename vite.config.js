import fs from 'node:fs/promises'
import path from 'node:path'

import { partytownVite } from '@builder.io/partytown/utils'
import legacy from '@vitejs/plugin-legacy'
import vue from '@vitejs/plugin-vue'
import glsl from 'vite-plugin-glsl'

import _config from './_config'

const HOST = _config.server.host
const PORT = _config.server.port

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      resolve(raw)
    })
    req.on('error', reject)
  })
}

function registerMockApi(middlewares) {
  middlewares.use(/^\/api\/auth\/(github|google)\/exchange$/, async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }

    try {
      const rawBody = await readRequestBody(req)
      const payload = rawBody ? JSON.parse(rawBody) : {}
      const provider = String(req.url || '').includes('/google/') ? 'google' : 'github'
      const code = String(payload?.code || '').trim()

      if (!code) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'missing_oauth_code' }))
        return
      }

      const shortCode = code.slice(0, 8)
      const namePrefix = provider === 'google' ? 'Google' : 'GitHub'
      const account = {
        id: `${provider}:${shortCode || 'local-user'}`,
        provider,
        name: `${namePrefix} User`,
        email: `${provider}-${shortCode || 'local'}@mock.local`,
        avatar: '',
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ account }))
    }
    catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'invalid_auth_payload' }))
    }
  })

  middlewares.use('/api/world-config', async (_req, res) => {
    try {
      const jsonPath = path.resolve(__dirname, 'public', 'world-config.json')
      const content = await fs.readFile(jsonPath, 'utf-8')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(content)
    }
    catch {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'failed_to_read_world_config' }))
    }
  })

  middlewares.use('/api/world-state', async (req, res) => {
    const statePath = path.resolve(__dirname, 'public', 'world-state.json')

    if (req.method === 'GET') {
      try {
        const content = await fs.readFile(statePath, 'utf-8')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(content)
      }
      catch {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ worldState: { schematicOnlyMode: false }, modifications: {} }))
      }
      return
    }

    if (req.method === 'POST') {
      try {
        const rawBody = await readRequestBody(req)
        const payload = rawBody ? JSON.parse(rawBody) : {}
        const normalized = {
          worldState: {
            schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
          },
          modifications: payload?.modifications && typeof payload.modifications === 'object'
            ? payload.modifications
            : {},
        }

        await fs.writeFile(statePath, JSON.stringify(normalized, null, 2), 'utf-8')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true }))
      }
      catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'invalid_world_state_payload' }))
      }
      return
    }

    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
  })
}

export default {
  server: {
    host: HOST,
    port: PORT,
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ui': path.resolve(__dirname, 'src/vue'),
      '@ui-components': path.resolve(__dirname, 'src/vue/components'),
      '@pinia': path.resolve(__dirname, 'src/pinia'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@three': path.resolve(__dirname, 'src/js'),
    },
  },
  plugins: [
    {
      name: 'mock-backend-world-config',
      configureServer(server) {
        registerMockApi(server.middlewares)
      },
      configurePreviewServer(server) {
        registerMockApi(server.middlewares)
      },
    },
    legacy(),
    glsl(),
    vue(),
    partytownVite({
      dest: path.join(__dirname, 'dist', '~partytown'),
    }),
  ],
}
