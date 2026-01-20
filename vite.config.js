import path from 'node:path'

import { partytownVite } from '@builder.io/partytown/utils'
import legacy from '@vitejs/plugin-legacy'
import vue from '@vitejs/plugin-vue'
import glsl from 'vite-plugin-glsl'

import _config from './_config'

const HOST = _config.server.host
const PORT = _config.server.port

export default {
  server: {
    host: HOST,
    port: PORT,
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
    legacy(),
    glsl(),
    vue(),
    partytownVite({
      dest: path.join(__dirname, 'dist', '~partytown'),
    }),
  ],
}
