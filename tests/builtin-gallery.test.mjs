/* eslint-disable test/no-import-node-test -- Use the repository's Node test runner. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { issueAccountSession } from '../functions/api/auth/_shared.js'
import { onRequestGet as gallery } from '../functions/api/gallery.js'
import { onRequestGet as item } from '../functions/api/gallery/item.js'
import { onRequestGet as source } from '../functions/api/gallery/source.js'
import { onRequestGet as config, onRequestPost as writeConfig } from '../functions/api/world-config.js'
import { onRequestGet as state, onRequestPost as writeState } from '../functions/api/world-state.js'

const slug = 'singleleverpistondoor3x3'
const entry = {
  item: { id: slug, projectionSlug: slug, title: 'Fixture door', visibility: 'public', sourceFile: { fileName: 'door.litematic', size: 3 }, redstoneControl: { type: 'door' } },
  worldConfig: { player: { spawnPoint: { x: 3, y: 1, z: 0 } }, settings: {} },
  sourceUrl: '/redstone-archive/door.litematic',
  replayUrl: '/redstone-archive/door.replay.json.gz',
}
const prefix = 'gallery:space:redstonearchive:'
function fixture(records = {}, entries = [entry], kv = true) {
  const requests = []
  const env = {
    ASSETS: { async fetch(request) {
      const path = new URL(request.url).pathname
      requests.push(path)
      if (path.endsWith('interactive-doors.json'))
        return Response.json({ version: 1, items: entries })
      if (path === entry.sourceUrl)
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'application/octet-stream' } })
      return new Response('not found', { status: 404 })
    } },
  }
  if (kv) {
    env.LITEMORA_SPACE_KV = { async get(key, format) {
      const value = records[key]
      if (format === 'arrayBuffer')
        return value || null
      return value == null ? null : JSON.stringify(value)
    } }
  }
  return { requests, context: (endpoint, extra = '') => ({ env, request: new Request(`https://example.test/api/${endpoint}?space=redstonearchive&item=${slug}&projection=${slug}${extra}`) }) }
}

test('builtin list, item, source, config and schematic-only state work without KV writes', async () => {
  for (const kv of [true, false]) {
    const f = fixture({}, [entry], kv)
    const listing = await (await gallery(f.context('gallery'))).json()
    assert.equal(listing.items.length, 1)
    assert.equal(listing.spaceExists, true)
    assert.equal(listing.items[0].readOnly, true)
    const detail = await (await item(f.context('gallery/item'))).json()
    assert.deepEqual(detail.item.redstoneControl, { type: 'door' })
    assert.equal(detail.viewer.canManage, false)
    assert.deepEqual([...new Uint8Array(await (await source(f.context('gallery/source'))).arrayBuffer())], [1, 2, 3])
    const worldConfig = await (await config(f.context('world-config'))).json()
    assert.deepEqual(worldConfig.player, entry.worldConfig.player)
    assert.equal(worldConfig.settings.redstoneArchive.replayUrl, entry.replayUrl)
    assert.equal(worldConfig.__meta.exists, true)
    assert.equal((await (await state(f.context('world-state'))).json()).worldState.schematicOnlyMode, true)
  }
})

test('private KV slug collision suppresses listing and every builtin fallback', async () => {
  const privateItem = { id: 'owner-item', projectionSlug: slug, visibility: 'private' }
  const f = fixture({ [`${prefix}manifest`]: { items: [privateItem] }, [`${prefix}item:owner-item`]: privateItem })
  assert.equal((await (await gallery(f.context('gallery'))).json()).items.length, 0)
  for (const [handler, path] of [[item, 'gallery/item'], [source, 'gallery/source'], [config, 'world-config'], [state, 'world-state']]) {
    assert.equal((await handler(f.context(path))).status, 404, path)
  }
  assert.ok(!f.requests.includes(entry.sourceUrl))
})

test('orphan private KV item also reserves the builtin ID', async () => {
  const f = fixture({ [`${prefix}item:${slug}`]: { id: slug, visibility: 'private' } })
  assert.equal((await (await gallery(f.context('gallery'))).json()).items.length, 0)
  assert.equal((await item(f.context('gallery/item'))).status, 404)
  assert.equal((await config(f.context('world-config'))).status, 404)
})

test('public KV collision remains authoritative, including missing source', async () => {
  const stored = { id: slug, projectionSlug: slug, title: 'User data', visibility: 'public' }
  const f = fixture({ [`${prefix}manifest`]: { items: [stored] }, [`${prefix}item:${slug}`]: stored })
  assert.equal((await (await gallery(f.context('gallery'))).json()).items.length, 1)
  assert.equal((await (await item(f.context('gallery/item'))).json()).item.title, 'User data')
  assert.equal((await source(f.context('gallery/source'))).status, 404)
  assert.equal((await (await state(f.context('world-state'))).json()).worldState.schematicOnlyMode, false)
})

test('undeclared slugs, foreign assets and empty manifest cannot create builtin entries', async () => {
  for (const entries of [[], [{ ...entry, sourceUrl: 'https://evil.test/source.litematic' }], [{ ...entry, item: { ...entry.item, id: 'other', projectionSlug: 'other' } }]]) {
    const f = fixture({}, entries)
    assert.equal((await (await gallery(f.context('gallery'))).json()).items.length, 0)
    assert.equal((await item(f.context('gallery/item'))).status, 404)
  }
  const f = fixture()
  const context = f.context('gallery')
  context.request = new Request('https://example.test/api/gallery?space=someoneelse')
  assert.equal((await (await gallery(context)).json()).items.length, 0)
  assert.equal(f.requests.length, 0)
})

test('authorized owner cannot write builtin config or world state', async () => {
  const f = fixture({ [`${prefix}profile`]: { ownerAccountId: 'fixture-owner' } })
  for (const [handler, path] of [[writeConfig, 'world-config'], [writeState, 'world-state']]) {
    const context = f.context(path)
    context.env.LITEMORA_SESSION_SECRET = 'unit-test-only-secret'
    const session = await issueAccountSession(context.env, { id: 'fixture-owner', provider: 'github' })
    context.env.LITEMORA_SPACE_KV.put = () => {
      throw new Error('unexpected write')
    }
    context.request = new Request(context.request.url, { method: 'POST', headers: { 'Authorization': `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: '{}' })
    const response = await handler(context)
    assert.equal(response.status, 403)
    assert.equal((await response.json()).error, 'builtin_projection_read_only')
  }
})

test('legacy title-derived private slug cannot leak via builtin fallback', async () => {
  const privateItem = { id: 'legacy-private', title: slug.toUpperCase(), visibility: 'private' }
  const f = fixture({ [`${prefix}manifest`]: { items: [privateItem] } })
  assert.equal((await (await gallery(f.context('gallery'))).json()).items.length, 0)
  assert.equal((await item(f.context('gallery/item'))).status, 404)
  assert.equal((await config(f.context('world-config'))).status, 404)
})

test('unavailable or invalid static manifests do not break existing gallery reads', async () => {
  const unavailable = async () => {
    throw new Error('assets unavailable')
  }
  for (const fetch of [unavailable, async () => new Response('invalid', { headers: { 'Content-Type': 'application/json' } })]) {
    const f = fixture()
    const context = f.context('gallery')
    context.env.ASSETS.fetch = fetch
    const response = await gallery(context)
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).items, [])
  }
})
