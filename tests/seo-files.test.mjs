import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
// Tests run with the project's Node test runner.
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

async function readPublic(name) {
  return fs.readFile(path.join(root, 'public', name), 'utf8')
}

test('homepage exposes crawlable SEO metadata and project description', async () => {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8')

  assert.match(html, /<link rel="canonical" href="https:\/\/litemora\.art\/"\s*\/>/)
  assert.match(html, /<script type="application\/ld\+json">[\s\S]*"@type": "WebSite"/)
  assert.match(html, /<script type="application\/ld\+json">[\s\S]*"@type": "SoftwareApplication"/)
  assert.match(html, /<noscript[\s\S]*<h1>Litemora — Playable Schematic Worlds<\/h1>/)
  assert.match(html, /\.litematic, \.schem, \.schematic, and Axiom \.bp files/)
})

test('robots declares sitemap and keeps private or operational paths out of discovery', async () => {
  const robots = await readPublic('robots.txt')

  assert.match(robots, /User-agent: \*/)
  assert.match(robots, /Disallow: \/api\//)
  assert.match(robots, /Disallow: \/admin/)
  assert.match(robots, /Disallow: \/gallery\//)
  assert.match(robots, /Sitemap: https:\/\/litemora\.art\/sitemap\.xml/)
})

test('sitemap contains only the public homepage', async () => {
  const sitemap = await readPublic('sitemap.xml')
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])

  assert.deepEqual(locations, ['https://litemora.art/'])
})

test('llms description documents supported formats and privacy boundary', async () => {
  const llms = await readPublic('llms.txt')

  for (const format of ['.litematic', '.schem', '.schematic', 'Axiom `.bp`']) {
    assert.match(llms, new RegExp(format.replace('.', '\\.'), 'u'))
  }
  assert.match(llms, /Private spaces, management pages, API endpoints, and uploaded source data are not part of the public index/u)
  assert.match(llms, /JavaScript/u)
})
