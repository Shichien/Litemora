import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'smol-toml'

// Read-only export; never writes to Cloudflare. Output may contain private data.
function arg(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? '' : process.argv[index + 1] || ''
}
const space = arg('--space')
const account = arg('--account')
const namespace = arg('--namespace')
const output = arg('--output')
if (!/^[a-z0-9-]{3,63}$/.test(space) || !/^[a-f0-9]{32}$/.test(account) || !/^[a-f0-9]{32}$/.test(namespace) || !process.argv.includes('--output') || !output) {
  throw new Error('Usage: node scripts/backup-space.mjs --space NAME --account ID --namespace ID --output DIRECTORY')
}
let token = process.env.CLOUDFLARE_API_TOKEN
if (!token) {
  const configPath = process.env.WRANGLER_CONFIG_PATH || (process.env.APPDATA
    ? path.join(process.env.APPDATA, 'xdg.config/.wrangler/config/default.toml')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config'), '.wrangler/config/default.toml'))
  const config = parse(await fs.readFile(configPath, 'utf8'))
  token = config.oauth_token
}
if (!token)
  throw new Error('No Cloudflare token available; run wrangler whoami first')
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}`
async function request(suffix) {
  const response = await fetch(`${base}${suffix}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok)
    throw new Error(`Cloudflare request failed (${response.status}); backup incomplete`)
  return response
}
const keys = []
for (const prefix of [`gallery:space:${space}:`, `space:${space}:`]) {
  let cursor = ''
  do {
    const response = await request(`/keys?${new URLSearchParams({ prefix, limit: '1000', ...(cursor ? { cursor } : {}) })}`)
    const payload = await response.json()
    if (!payload.success)
      throw new Error('Cloudflare key listing failed')
    keys.push(...payload.result)
    cursor = payload.result_info?.cursor || ''
  } while (cursor)
}
if (!keys.length)
  throw new Error(`No stored keys found for ${space}`)
await fs.mkdir(output, { recursive: true })
const entries = []
const inventory = []
for (const key of keys) {
  const response = await request(`/values/${encodeURIComponent(key.name)}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  entries.push({ key: key.name, value: bytes.toString('base64'), base64: true, ...(key.metadata ? { metadata: key.metadata } : {}) })
  inventory.push({ key: key.name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), expiration: key.expiration || null })
}
// Exclusive creation prevents accidental replacement of an earlier snapshot.
await fs.writeFile(path.join(output, 'restore-kv.json'), JSON.stringify(entries), { flag: 'wx' })
await fs.writeFile(path.join(output, 'inventory.json'), JSON.stringify({ version: 1, space, account, namespace, capturedAt: new Date().toISOString(), keys: inventory }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ space, keys: entries.length, bytes: inventory.reduce((sum, item) => sum + item.bytes, 0), expiringKeys: inventory.filter(item => item.expiration), output }, null, 2))
