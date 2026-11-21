import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Keep /docs available as a space name. Only this subdirectory hosts the book.
export const bookBase = '/docs/api'
export const bookDir = path.dirname(fileURLToPath(import.meta.url))
export const bookHtml = path.join(bookDir, '_build', 'html')

export async function buildBook() {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('jupyter-book/package.json')
  const cli = path.resolve(path.dirname(manifest), require(manifest).bin['jupyter-book'])
  // MyST copies this cache into the published book, including sources of removed chapters.
  await rm(path.join(bookDir, '_build', 'site'), { recursive: true, force: true })
  const child = spawn(process.execPath, [cli, 'build', '--html', '--strict', '--ci'], {
    cwd: bookDir,
    env: { ...process.env, BASE_URL: bookBase },
    stdio: 'inherit',
  })
  const [code, signal] = await once(child, 'exit')
  if (code !== 0)
    throw new Error(`Jupyter Book build failed (${signal || code})`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildBook().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
