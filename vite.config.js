import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import glsl from 'vite-plugin-glsl'

import _config from './_config'
import { registerMockApi } from './dev/mock-api/index.js'

const HOST = _config.server.host
const PORT = _config.server.port
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
}
const INLINE_WASM_LITERAL_PATTERN = /(["'`])data:application\/wasm;base64,([A-Za-z0-9+/=]+)\1/g

// schematic-renderer ships its 8 MB WASM binary inlined twice as base64 data URLs,
// which makes the vendor chunk ~28 MB. Cloudflare Pages rejects assets over 25 MiB,
// so production builds emit the binary once as a real .wasm file and point both
// string literals at its URL. The library already accepts a URL string there.
function externalizeInlineWasm() {
  return {
    name: 'litemora-externalize-inline-wasm',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('schematic-renderer') || !code.includes('data:application/wasm;base64,')) {
        return null
      }

      const referenceByPayload = new Map()
      const transformed = code.replace(INLINE_WASM_LITERAL_PATTERN, (_match, _quote, payload) => {
        let referenceId = referenceByPayload.get(payload)
        if (!referenceId) {
          referenceId = this.emitFile({
            type: 'asset',
            name: 'schematic-renderer.wasm',
            source: Buffer.from(payload, 'base64'),
          })
          referenceByPayload.set(payload, referenceId)
        }
        return `import.meta.ROLLUP_FILE_URL_${referenceId}`
      })

      return { code: transformed, map: null }
    },
  }
}

// 构建产物里不应该出现只供本地开发使用的内容:
// - `public/.dev-gallery/**` 是 dev mock 的图库数据(含可下载的 .schematic 源文件),
//   必须留在 public/ 里给 dev server 用, 但绝不能随 publicDir 拷贝进 dist;
// - `public/world-state.json` 是旧的本地世界状态快照(已移除), 同样不该出现在 dist。
//
// Vite 的 `prepareOutDir` / `copyDir` 会在 `rollup.write()` **之前**把 publicDir 整个
// 拷进 dist, 所以这里用 `closeBundle`(write 之后)删除才有效; `writeBundle` 也可以,
// 但它和后续的静态资源写入顺序耦合, `closeBundle` 更稳妥。
const BUILD_ONLY_EXCLUDED_PATHS = ['.dev-gallery', 'world-state.json']

// `public/spaces/<space>/projections/**` 只被 `scripts/build-kv-seed.mjs` 和
// `install-redstone-doors.mjs` 当作 KV 种子源读取, 前端从不请求这些静态路径
// (运行时只 fetch `/spaces/<space>/world-config.json`)。所以只保留各 space 顶层的
// world-config.json, 投影数据不进 dist。
const PROJECTION_DATA_DIRNAME = 'projections'

async function pruneProjectionData(spacesDir) {
  let spaceEntries = []
  try {
    spaceEntries = await fs.readdir(spacesDir, { withFileTypes: true })
  }
  catch {
    return
  }

  for (const entry of spaceEntries) {
    if (!entry.isDirectory()) {
      continue
    }
    await fs.rm(path.join(spacesDir, entry.name, PROJECTION_DATA_DIRNAME), { recursive: true, force: true })
  }
}

function excludeDevArtifactsFromBuild() {
  let resolvedOutDir = ''

  return {
    name: 'litemora-exclude-dev-artifacts',
    apply: 'build',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      if (!resolvedOutDir) {
        return
      }

      for (const relativePath of BUILD_ONLY_EXCLUDED_PATHS) {
        const targetPath = path.resolve(resolvedOutDir, relativePath)
        // 防御性检查: 只删 dist 内部的目标, 绝不越界
        if (!targetPath.startsWith(resolvedOutDir + path.sep)) {
          continue
        }
        await fs.rm(targetPath, { recursive: true, force: true })
      }

      await pruneProjectionData(path.resolve(resolvedOutDir, 'spaces'))
    },
  }
}

export default {
  worker: { format: 'es' },
  server: {
    host: HOST,
    port: PORT,
    headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS },
  },
  preview: {
    headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS },
  },
  build: {
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('/schematic-renderer/') || id.includes('\\schematic-renderer\\')) {
            return 'schematic-renderer-vendor'
          }

          if (id.includes('/three/')) {
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

          // tweakpane 只在 `#debug` 下动态 import。让它保持独立 async chunk，
          // 否则会被并回首屏必载的 vendor chunk，懒加载就白做了。
          if (id.includes('/tweakpane/') || id.includes('@tweakpane')) {
            return undefined
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
    dedupe: ['three'],
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
    externalizeInlineWasm(),
    excludeDevArtifactsFromBuild(),
    glsl(),
    vue(),
  ],
}
