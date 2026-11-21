/* eslint-disable test/no-import-node-test -- Use the repository's Node test runner. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { issueAccountSession } from '../functions/api/auth/_shared.js'
import { onRequestGet as gallery } from '../functions/api/gallery.js'
import {
  buildDiscoverProjectionEntry,
  buildGalleryItemPayload,
  buildGalleryItemSummary,
  galleryDiscoverKey,
  normalizeFilePayload,
  normalizeReplaySummary,
  normalizeSourceFileMetadata,
} from '../functions/api/gallery/_shared.js'
import { onRequestGet as item } from '../functions/api/gallery/item.js'
import { onRequestPost as upload } from '../functions/api/gallery/items.js'
import { onRequestGet as source } from '../functions/api/gallery/source.js'

const replay = { minecraftVersion: '1.20.1', protocolVersion: 763, durationMs: 12434 }
// Opaque API transport bytes only; this is not a genuine ReplayMod recording.
const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 9, 8, 7])
const thumbnail = 'data:image/png;base64,AQID'

async function fixture() {
  const records = new Map()
  const env = {
    LITEMORA_SESSION_SECRET: 'unit-test-only-secret',
    LITEMORA_SPACE_KV: {
      async get(key, format) {
        const value = records.get(key)
        if (format === 'arrayBuffer')
          return value instanceof ArrayBuffer ? value : null
        return value ?? null
      },
      async put(key, value) { records.set(key, value) },
    },
  }
  const session = await issueAccountSession(env, { id: 'replay-owner', provider: 'github', name: 'Replay owner' })
  const stranger = await issueAccountSession(env, { id: 'someone-else', provider: 'github' })
  return {
    records,
    context(endpoint, { owner = false, other = false, body = null, json = false, identifier = '' } = {}) {
      const headers = {}
      if (owner || other)
        headers.Authorization = `Bearer ${(other ? stranger : session).token}`
      if (json)
        headers['Content-Type'] = 'application/json'
      return {
        env,
        request: new Request(`https://example.test/api/${endpoint}?space=replay-test&item=${encodeURIComponent(identifier)}`, {
          method: body ? 'POST' : 'GET',
          headers,
          body: json ? JSON.stringify(body) : body,
        }),
      }
    },
  }
}

function jsonUpload(extra = {}) {
  return {
    title: 'Replay fixture',
    projectionName: 'Replay fixture',
    fileName: 'fixture.mcpr',
    fileSize: 1, // The server must use decoded length, not caller claims.
    mimeType: 'text/html',
    fileBase64: btoa(String.fromCharCode(...bytes)),
    replay,
    thumbnailDataUrl: thumbnail,
    ...extra,
  }
}

test('multipart ReplayMod upload preserves raw bytes and publishes replay type through every read path', async () => {
  const f = await fixture()
  const form = new FormData()
  form.set('title', 'Public replay')
  form.set('projectionName', 'Public replay')
  form.set('kind', 'schematic')
  form.set('replay', JSON.stringify({ ...replay, unexpected: 'discard' }))
  form.set('schematic', JSON.stringify({ name: 'Do not use as a schematic' }))
  form.set('thumbnailDataUrl', thumbnail)
  form.set('thumbnailSky', 'end-void')
  form.set('file', new Blob([bytes], { type: 'text/html' }), 'capture.MCPR')
  const response = await upload(f.context('gallery/items', { owner: true, body: form }))
  assert.equal(response.status, 200)
  const { item: summary } = await response.json()
  assert.equal(summary.kind, 'replaymod')
  assert.deepEqual(summary.replay, replay)
  assert.equal(summary.schematic, null)
  assert.equal(summary.preview, null)
  assert.equal(summary.thumbnailDataUrl, thumbnail)
  assert.equal(summary.thumbnailSky, 'end-void')

  const identifier = summary.projectionSlug
  const detail = await (await item(f.context('gallery/item', { identifier }))).json()
  assert.equal(detail.item.kind, 'replaymod')
  assert.equal(detail.item.thumbnailSky, 'end-void')
  assert.deepEqual(detail.item.replay, replay)
  assert.equal(detail.item.previewModel, null)
  assert.equal(detail.item.sourceFile.size, bytes.length)
  assert.equal(detail.item.sourceFile.mimeType, 'application/octet-stream')
  const listing = await (await gallery(f.context('gallery'))).json()
  assert.equal(listing.items[0].kind, 'replaymod')
  assert.equal(listing.items[0].thumbnailSky, 'end-void')
  assert.deepEqual(listing.items[0].replay, replay)
  const discovery = JSON.parse(f.records.get(galleryDiscoverKey()))
  assert.equal(discovery[0].kind, 'replaymod')
  assert.equal(discovery[0].thumbnailSky, 'end-void')
  assert.deepEqual(discovery[0].replay, replay)
  assert.equal(discovery[0].preview, null)

  const download = await source(f.context('gallery/source', { identifier }))
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('Content-Type'), 'application/octet-stream')
  assert.match(download.headers.get('Content-Disposition'), /capture\.MCPR/u)
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes)
})

test('private JSON ReplayMod upload preserves owner access without leaking in gallery, discovery, or source', async () => {
  const f = await fixture()
  const response = await upload(f.context('gallery/items', {
    owner: true,
    json: true,
    body: jsonUpload({ visibility: 'private', kind: 'schematic', thumbnailSky: 'dawn' }),
  }))
  assert.equal(response.status, 200)
  const { item: summary } = await response.json()
  const identifier = summary.projectionSlug
  assert.equal(summary.kind, 'replaymod')
  assert.equal(summary.thumbnailSky, 'dawn')
  assert.equal(f.records.has(galleryDiscoverKey()), false)
  assert.deepEqual((await (await gallery(f.context('gallery'))).json()).items, [])
  assert.equal((await (await gallery(f.context('gallery', { owner: true }))).json()).items[0].kind, 'replaymod')
  for (const [handler, endpoint] of [[item, 'gallery/item'], [source, 'gallery/source']]) {
    assert.equal((await handler(f.context(endpoint, { identifier }))).status, 404)
    assert.equal((await handler(f.context(endpoint, { identifier, other: true }))).status, 404)
    assert.equal((await handler(f.context(endpoint, { identifier, owner: true }))).status, 200)
  }
  const download = await source(f.context('gallery/source', { identifier, owner: true }))
  assert.match(download.headers.get('Cache-Control'), /^private/u)
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes)
})

test('source extension controls kind and schematic uploads retain redstone metadata', () => {
  const redstoneSwitch = { position: { x: 1, y: -2, z: 3 }, initialState: 'open' }
  const schematicItem = buildGalleryItemPayload({
    body: { kind: 'replaymod', fileName: 'door.litematic', replay, schematic: { name: 'Door' }, redstoneSwitch },
    itemId: 'door',
    spaceName: 'test',
  })
  assert.equal(schematicItem.kind, 'schematic')
  assert.equal(schematicItem.replay, undefined)
  assert.deepEqual(schematicItem.redstoneSwitch, redstoneSwitch)
  assert.equal(schematicItem.schematic.name, 'Door')
  assert.equal(buildGalleryItemSummary(schematicItem).kind, 'schematic')
  assert.equal(buildDiscoverProjectionEntry('test', schematicItem).kind, 'schematic')

  const replayItem = buildGalleryItemPayload({
    body: { kind: 'schematic', fileName: 'capture.mcpr', replay, redstoneSwitch, schematic: { name: 'Ignore' } },
    itemId: 'capture',
    spaceName: 'test',
  })
  assert.equal(replayItem.title, 'capture.mcpr')
  assert.equal(replayItem.kind, 'replaymod')
  assert.equal(replayItem.redstoneSwitch, undefined)
  assert.equal(replayItem.schematic, null)
  assert.equal(replayItem.placement, null)
})

test('replay metadata and thumbnails are bounded and unrelated fields are discarded', () => {
  assert.deepEqual(normalizeReplaySummary({ ...replay, minecraftVersion: ' 1.20.1 ', players: ['discard'], durationMs: '12434' }), replay)
  assert.deepEqual(normalizeReplaySummary({ minecraftVersion: '<script>', protocolVersion: -1, durationMs: Infinity }), {
    minecraftVersion: '',
    protocolVersion: null,
    durationMs: 0,
  })
  assert.deepEqual(normalizeReplaySummary({ protocolVersion: 763.5, durationMs: 2 ** 40 }), {
    minecraftVersion: '',
    protocolVersion: null,
    durationMs: 0,
  })
  const result = buildGalleryItemPayload({ body: { fileName: 'capture.mcpr', thumbnailDataUrl: 'javascript:bad()', thumbnailSky: '../other' }, itemId: 'test' })
  assert.equal(result.thumbnailDataUrl, '')
  assert.equal(result.thumbnailSky, '')
  assert.equal(buildGalleryItemSummary({ fileName: 'legacy.schem' }).thumbnailSky, '')
})

test('ReplayMod uses the existing 15 MiB source limit and disallowed extensions remain rejected', async () => {
  assert.equal(normalizeSourceFileMetadata({ fileName: 'capture.mcpr', size: 15 * 1024 * 1024 }).size, 15 * 1024 * 1024)
  assert.throws(() => normalizeSourceFileMetadata({ fileName: 'capture.mcpr', size: 15 * 1024 * 1024 + 1 }), /file_too_large_for_kv/u)
  assert.throws(() => normalizeFilePayload({ fileName: 'capture.mcpr', fileBase64: 'a'.repeat(20 * 1024 * 1024 + 1) }), /file_too_large_for_kv/u)
  const f = await fixture()
  const result = await upload(f.context('gallery/items', { owner: true, json: true, body: jsonUpload({ fileName: 'capture.html' }) }))
  assert.equal(result.status, 415)
  assert.equal((await result.json()).error, 'invalid_source_file_type')
})
