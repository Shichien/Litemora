import { fileURLToPath } from 'node:url'

// Ship the worker, WASM and parser beside the entry so another site can host just this folder.
export default {
  base: './',
  publicDir: false,
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    outDir: 'dist/sdk',
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./litemora.js', import.meta.url)),
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'litemora.js' },
    },
  },
}
