import fs from 'node:fs/promises'
import path from 'node:path'

import { partytownVite } from '@builder.io/partytown/utils'
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

function sanitizeSpaceName(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return /^[a-z0-9-]{3,63}$/.test(normalized) ? normalized : ''
}

function getSpaceNameFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost')
    return sanitizeSpaceName(requestUrl.searchParams.get('space'))
  }
  catch {
    return ''
  }
}

function resolveSpaceJsonPath(fileName, spaceName = '') {
  if (!spaceName) {
    return path.resolve(__dirname, 'public', fileName)
  }
  return path.resolve(__dirname, 'public', 'spaces', spaceName, fileName)
}

function registerMockApi(middlewares) {
  middlewares.use(/^\/api\/auth\/github\/exchange$/, async (req, res) => {
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

  middlewares.use('/api/world-config', async (req, res) => {
    const spaceName = getSpaceNameFromRequest(req)
    const jsonPath = resolveSpaceJsonPath('world-config.json', spaceName)

    if (req.method === 'GET') {
      try {
        const content = await fs.readFile(jsonPath, 'utf-8')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(content)
      }
      catch {
        try {
          const fallbackPath = resolveSpaceJsonPath('world-config.json')
          const fallbackContent = await fs.readFile(fallbackPath, 'utf-8')
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(fallbackContent)
        }
        catch {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'failed_to_read_world_config' }))
        }
      }
      return
    }

    if (req.method === 'POST') {
      try {
        const rawBody = await readRequestBody(req)
        const payload = rawBody ? JSON.parse(rawBody) : {}
        if (!payload || typeof payload !== 'object') {
          throw new Error('invalid_world_config_payload')
        }

        await fs.mkdir(path.dirname(jsonPath), { recursive: true })
        await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf-8')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true }))
      }
      catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'invalid_world_config_payload' }))
      }
      return
    }

    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
  })

  middlewares.use('/api/world-state', async (req, res) => {
    const spaceName = getSpaceNameFromRequest(req)
    const statePath = resolveSpaceJsonPath('world-state.json', spaceName)

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
        const hasCompactChunks = payload?.format === 'chunk-v2'
          && payload?.chunks
          && typeof payload.chunks === 'object'
          && Object.keys(payload.chunks).length > 0

        const normalized = hasCompactChunks
          ? {
              format: 'chunk-v2',
              version: Number(payload?.version) || 1,
              chunkWidth: Number(payload?.chunkWidth) || 64,
              worldState: {
                schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
              },
              chunks: payload.chunks,
            }
          : {
              worldState: {
                schematicOnlyMode: !!payload?.worldState?.schematicOnlyMode,
              },
              modifications: payload?.modifications && typeof payload.modifications === 'object'
                ? payload.modifications
                : {},
            }

        await fs.mkdir(path.dirname(statePath), { recursive: true })
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
  build: {
    target: 'es2022',
    rollupOptions: {
      external: ['/_vercel/insights/script.js'],
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('/three/') || id.includes('three-custom-shader-material')) {
            return 'three-vendor'
          }

          if (id.includes('/vue/') || id.includes('/vue-i18n/') || id.includes('/pinia/')) {
            return 'vue-vendor'
          }

          if (id.includes('/gsap/')) {
            return 'gsap-vendor'
          }

          if (id.includes('/pako/') || id.includes('/protodef/') || id.includes('/prismarine-nbt/')) {
            return 'schematic-vendor'
          }

          return 'vendor'
        },
      },
    },
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
    glsl(),
    vue(),
    partytownVite({
      dest: path.join(__dirname, 'dist', '~partytown'),
    }),
  ],
}
