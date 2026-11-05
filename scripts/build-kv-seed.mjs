// Builds a `wrangler kv bulk put` JSON file that publishes one local dev space
// (public/.dev-gallery/<space> + public/spaces/<space>) into the production KV
// layout used by functions/api.
//
// Usage:
//   node scripts/build-kv-seed.mjs --space redstonearchive \
//     --owner-id github:150573175 --owner-name "Shiqian Xia" \
//     [--discover-from https://litemora.art] --output output/kv-seed/redstonearchive.json
//
// Then: npx wrangler kv bulk put output/kv-seed/redstonearchive.json --namespace-id <id> --remote

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const SPACE_REGEX = /^[a-z0-9-]{3,63}$/
const DISCOVER_KEY = 'gallery:discover:public'
const DISCOVER_MAX_ITEMS = 24

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : String(process.argv[index + 1] || '').trim()
}

function requireArg(name) {
  const value = readArg(name)
  if (!value) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return value
}

async function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  }
  catch (error) {
    if (fallback !== undefined && error?.code === 'ENOENT') {
      return fallback
    }
    throw new Error(`Failed to read ${path.relative(ROOT, filePath)}: ${error.message}`)
  }
}

function scopedKey(type, space, projection = '') {
  return projection
    ? `space:${space}:projection:${encodeURIComponent(projection)}:${type}`
    : `space:${space}:${type}`
}

function galleryKey(space, kind, itemId = '') {
  return itemId
    ? `gallery:space:${space}:${kind}:${encodeURIComponent(itemId)}`
    : `gallery:space:${space}:${kind}`
}

function buildDiscoverEntry(space, item, profile) {
  const routeId = String(item?.projectionSlug || item?.id || '').trim()
  if (!routeId || item?.visibility === 'private') {
    return null
  }
  return {
    id: item.id,
    projectionSlug: item.projectionSlug || '',
    routeId,
    space,
    title: item.title || item.schematic?.name || item.fileName || 'World',
    ownerName: item.owner?.name || profile.ownerName || space,
    ownerAvatar: item.owner?.avatar || profile.ownerAvatar || '',
    thumbnailDataUrl: item.thumbnailDataUrl || '',
    updatedAt: Math.round(Number(item.updatedAt) || Date.now()),
    preview: {
      totalSolidBlocks: Math.max(0, Math.round(Number(item.previewModel?.totalSolidBlocks ?? item.preview?.totalSolidBlocks) || 0)),
      sampled: !!(item.previewModel?.sampled || item.preview?.sampled),
      bounds: item.previewModel?.bounds || item.preview?.bounds || null,
    },
  }
}

async function fetchExistingDiscover(origin) {
  const response = await fetch(new URL(`/api/discover?limit=${DISCOVER_MAX_ITEMS}`, origin))
  if (!response.ok) {
    throw new Error(`Discover request failed: ${response.status}`)
  }
  const payload = await response.json()
  return Array.isArray(payload?.items) ? payload.items : []
}

async function main() {
  const space = requireArg('--space')
  if (!SPACE_REGEX.test(space)) {
    throw new Error(`Invalid space name: ${space}`)
  }
  const ownerId = requireArg('--owner-id')
  const ownerName = requireArg('--owner-name')
  const ownerProvider = ownerId.split(':')[0]
  const outputPath = path.resolve(requireArg('--output'))
  const discoverOrigin = readArg('--discover-from')

  const galleryDir = path.join(ROOT, 'public', '.dev-gallery', space)
  const spaceDir = path.join(ROOT, 'public', 'spaces', space)
  const now = Date.now()

  const localProfile = await readJson(path.join(galleryDir, 'profile.json'))
  const localManifest = await readJson(path.join(galleryDir, 'manifest.json'))

  const profile = {
    ...localProfile,
    space,
    ownerAccountId: ownerId,
    ownerProvider,
    ownerName,
    ownerAvatar: localProfile.ownerAvatar || '',
    itemCount: localManifest.items.length,
    updatedAt: now,
  }
  const manifest = { ...localManifest, space, ownerAccountId: ownerId, updatedAt: now }

  const entries = [
    { key: galleryKey(space, 'profile'), value: JSON.stringify(profile) },
    { key: galleryKey(space, 'manifest'), value: JSON.stringify(manifest) },
  ]

  const discoverEntries = []
  for (const summary of manifest.items) {
    const item = await readJson(path.join(galleryDir, 'items', `${summary.id}.json`))
    if (item.owner?.id === localProfile.ownerAccountId) {
      item.owner = { ...item.owner, id: ownerId }
    }
    entries.push({ key: galleryKey(space, 'item', item.id), value: JSON.stringify(item) })

    const source = await fs.readFile(path.join(galleryDir, 'sources', `${item.id}.bin`))
    if (item.sourceFile?.size && item.sourceFile.size !== source.length) {
      throw new Error(`Source size mismatch for ${item.id}: item says ${item.sourceFile.size}, file has ${source.length}`)
    }
    entries.push({ key: galleryKey(space, 'source', item.id), value: source.toString('base64'), base64: true })

    const projection = item.projectionSlug || item.id
    const projectionDir = path.join(spaceDir, 'projections', projection)
    const worldConfig = await readJson(path.join(projectionDir, 'world-config.json'), null)
    if (worldConfig) {
      entries.push({ key: scopedKey('world-config', space, projection), value: JSON.stringify(worldConfig) })
    }
    const worldState = await readJson(path.join(projectionDir, 'world-state.json'), null)
    if (worldState) {
      entries.push({ key: scopedKey('world-state', space, projection), value: JSON.stringify(worldState) })
    }

    const discoverEntry = buildDiscoverEntry(space, item, profile)
    if (discoverEntry) {
      discoverEntries.push(discoverEntry)
    }
  }

  const spaceConfig = await readJson(path.join(spaceDir, 'world-config.json'), null)
  if (spaceConfig) {
    entries.push({ key: scopedKey('world-config', space), value: JSON.stringify(spaceConfig) })
  }

  if (discoverOrigin) {
    const existing = await fetchExistingDiscover(discoverOrigin)
    const seen = new Set(discoverEntries.map(entry => `${entry.space}:${entry.routeId}`))
    const merged = [
      ...discoverEntries,
      ...existing.filter(entry => !seen.has(`${entry.space}:${entry.routeId || entry.projectionSlug || entry.id}`)),
    ]
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, DISCOVER_MAX_ITEMS)
    entries.push({ key: DISCOVER_KEY, value: JSON.stringify(merged) })
    console.log(`Discover feed: ${existing.length} existing + ${discoverEntries.length} new -> ${merged.length}`)
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(entries))
  console.log(`Wrote ${entries.length} KV entries for space "${space}" to ${outputPath}`)
  for (const entry of entries) {
    console.log(`  ${entry.key} (${entry.base64 ? 'binary ' : ''}${Math.round(entry.value.length / 1024)} KB)`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
