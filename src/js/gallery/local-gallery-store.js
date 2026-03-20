import {
  ensureProjectionDisplayName,
  normalizeProjectionSlug,
} from '../utils/projection-name.js'

const LOCAL_GALLERY_DB_NAME = 'mc-local-gallery'
const LOCAL_GALLERY_DB_STORE = 'records'
const LOCAL_GALLERY_DB_VERSION = 1
const LOCAL_GALLERY_FALLBACK_PREFIX = 'mc-local-gallery-fallback'

const LOCAL_DEV_ACCOUNT = {
  id: 'local-dev',
  provider: 'local-dev',
  name: 'Local Dev',
  email: 'local@litemora.dev',
  avatar: '',
}

function normalizeSpaceName(value = '') {
  return String(value || '').trim().toLowerCase()
}

function normalizeProjectionVisibility(value = '') {
  return String(value || '').trim().toLowerCase() === 'private' ? 'private' : 'public'
}

function profileKey(spaceName) {
  return `gallery:space:${normalizeSpaceName(spaceName)}:profile`
}

function manifestKey(spaceName) {
  return `gallery:space:${normalizeSpaceName(spaceName)}:manifest`
}

function itemKey(spaceName, itemId) {
  return `gallery:space:${normalizeSpaceName(spaceName)}:item:${encodeURIComponent(String(itemId || '').trim())}`
}

function sourceKey(spaceName, itemId) {
  return `gallery:space:${normalizeSpaceName(spaceName)}:source:${encodeURIComponent(String(itemId || '').trim())}`
}

function fallbackKey(key) {
  return `${LOCAL_GALLERY_FALLBACK_PREFIX}:${key}`
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'))
      return
    }

    const request = indexedDB.open(LOCAL_GALLERY_DB_NAME, LOCAL_GALLERY_DB_VERSION)
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(LOCAL_GALLERY_DB_STORE)) {
        db.createObjectStore(LOCAL_GALLERY_DB_STORE, { keyPath: 'id' })
      }
    }
  })
}

async function readRecord(key, fallbackValue = null) {
  try {
    const db = await openDb()
    try {
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_GALLERY_DB_STORE, 'readonly')
        const store = tx.objectStore(LOCAL_GALLERY_DB_STORE)
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result?.value ?? null)
        request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'))
      })
      if (record !== null && record !== undefined) {
        return record
      }
    }
    finally {
      db.close()
    }
  }
  catch {
    // ignore IndexedDB failures and continue with localStorage fallback
  }

  try {
    const raw = localStorage.getItem(fallbackKey(key))
    if (!raw) {
      return fallbackValue
    }
    return JSON.parse(raw)
  }
  catch {
    return fallbackValue
  }
}

async function writeRecord(key, value) {
  try {
    const db = await openDb()
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_GALLERY_DB_STORE, 'readwrite')
        const store = tx.objectStore(LOCAL_GALLERY_DB_STORE)
        store.put({
          id: key,
          value,
          updatedAt: Date.now(),
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error || new Error('indexeddb_write_failed'))
        tx.onabort = () => reject(tx.error || new Error('indexeddb_write_aborted'))
      })
    }
    finally {
      db.close()
    }
  }
  catch {
    // ignore and use localStorage fallback below
  }

  localStorage.setItem(fallbackKey(key), JSON.stringify(value))
}

async function deleteRecord(key) {
  try {
    const db = await openDb()
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_GALLERY_DB_STORE, 'readwrite')
        const store = tx.objectStore(LOCAL_GALLERY_DB_STORE)
        store.delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error || new Error('indexeddb_delete_failed'))
        tx.onabort = () => reject(tx.error || new Error('indexeddb_delete_aborted'))
      })
    }
    finally {
      db.close()
    }
  }
  catch {
    // ignore and continue with localStorage cleanup
  }

  localStorage.removeItem(fallbackKey(key))
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function fromBase64(base64) {
  const binary = atob(String(base64 || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function normalizeSourceFileMetadata(value = {}, fallback = {}) {
  return {
    fileName: String(value?.fileName || fallback?.fileName || 'uploaded.schematic').trim(),
    mimeType: String(value?.mimeType || fallback?.mimeType || 'application/octet-stream').trim(),
    size: Math.max(0, Math.round(Number(value?.size ?? fallback?.size ?? 0) || 0)),
  }
}

function normalizeStoredSourceRecord(record = null) {
  if (!record || typeof record !== 'object') {
    return null
  }

  let buffer = null
  if (record.buffer instanceof ArrayBuffer) {
    buffer = record.buffer
  }
  else if (ArrayBuffer.isView(record.buffer)) {
    buffer = record.buffer.buffer.slice(
      record.buffer.byteOffset,
      record.buffer.byteOffset + record.buffer.byteLength,
    )
  }
  else if (record.fileBase64) {
    buffer = fromBase64(record.fileBase64)
  }

  if (!(buffer instanceof ArrayBuffer)) {
    return null
  }

  return {
    ...normalizeSourceFileMetadata(record, { size: buffer.byteLength }),
    buffer,
  }
}

async function readSourceRecord(key, fallbackValue = null) {
  try {
    const db = await openDb()
    try {
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_GALLERY_DB_STORE, 'readonly')
        const store = tx.objectStore(LOCAL_GALLERY_DB_STORE)
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result?.value ?? null)
        request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'))
      })
      const normalized = normalizeStoredSourceRecord(record)
      if (normalized) {
        return normalized
      }
    }
    finally {
      db.close()
    }
  }
  catch {
    // ignore IndexedDB failures and continue with localStorage fallback
  }

  try {
    const raw = localStorage.getItem(fallbackKey(key))
    if (!raw) {
      return fallbackValue
    }
    return normalizeStoredSourceRecord(JSON.parse(raw)) || fallbackValue
  }
  catch {
    return fallbackValue
  }
}

async function writeSourceRecord(key, value = {}) {
  const normalized = normalizeStoredSourceRecord(value)
  if (!normalized) {
    throw new Error('invalid_source_record')
  }

  try {
    const db = await openDb()
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_GALLERY_DB_STORE, 'readwrite')
        const store = tx.objectStore(LOCAL_GALLERY_DB_STORE)
        store.put({
          id: key,
          value: normalized,
          updatedAt: Date.now(),
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error || new Error('indexeddb_write_failed'))
        tx.onabort = () => reject(tx.error || new Error('indexeddb_write_aborted'))
      })
    }
    finally {
      db.close()
    }
  }
  catch {
    // ignore and continue with localStorage fallback below
  }

  localStorage.setItem(fallbackKey(key), JSON.stringify({
    ...normalizeSourceFileMetadata(normalized, { size: normalized.buffer.byteLength }),
    fileBase64: toBase64(normalized.buffer),
  }))
}

function buildLocalViewer() {
  return {
    authenticated: true,
    account: { ...LOCAL_DEV_ACCOUNT },
    canManage: true,
    localOnly: true,
  }
}

function buildLocalProfile(spaceName, previousProfile = null) {
  const now = Date.now()
  const normalizedSpaceName = normalizeSpaceName(spaceName)
  return {
    space: normalizedSpaceName,
    ownerAccountId: LOCAL_DEV_ACCOUNT.id,
    ownerProvider: LOCAL_DEV_ACCOUNT.provider,
    ownerName: previousProfile?.ownerName || LOCAL_DEV_ACCOUNT.name,
    ownerAvatar: previousProfile?.ownerAvatar || LOCAL_DEV_ACCOUNT.avatar,
    title: previousProfile?.title ? String(previousProfile.title).trim() : '',
    bio: previousProfile?.bio || 'Local development gallery',
    createdAt: previousProfile?.createdAt || now,
    updatedAt: now,
    itemCount: Number(previousProfile?.itemCount || 0),
    localOnly: true,
  }
}

function buildLocalManifest(spaceName, previousManifest = null) {
  return {
    space: normalizeSpaceName(spaceName),
    ownerAccountId: LOCAL_DEV_ACCOUNT.id,
    updatedAt: Date.now(),
    items: Array.isArray(previousManifest?.items) ? previousManifest.items : [],
    localOnly: true,
  }
}

function findManifestItemByIdentifier(items = [], identifier = '') {
  const rawIdentifier = String(identifier || '').trim()
  const normalizedSlug = normalizeProjectionSlug(rawIdentifier)

  return items.find((entry) => {
    if (!entry) {
      return false
    }

    if (String(entry.id || '').trim() === rawIdentifier) {
      return true
    }

    return normalizedSlug && normalizeProjectionSlug(entry.projectionSlug || entry.slug || '') === normalizedSlug
  }) || null
}

function createItemId() {
  const randomPart = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${randomPart}`
}

async function readSpaceState(spaceName) {
  const normalizedSpaceName = normalizeSpaceName(spaceName)
  const profile = await readRecord(profileKey(normalizedSpaceName), null)
  const manifest = await readRecord(manifestKey(normalizedSpaceName), null)
  return {
    profile: profile ? buildLocalProfile(normalizedSpaceName, profile) : null,
    manifest: buildLocalManifest(normalizedSpaceName, manifest),
  }
}

async function writeSpaceState(spaceName, profile, manifest) {
  await writeRecord(profileKey(spaceName), profile)
  await writeRecord(manifestKey(spaceName), manifest)
}

export function isLocalGalleryStoreEnabled() {
  const host = String(window.location.hostname || '').toLowerCase()
  return import.meta.env.DEV && (host === 'localhost' || host === '127.0.0.1')
}

export function getLocalGalleryViewer() {
  return buildLocalViewer()
}

export async function fetchLocalGallery(spaceName) {
  const { profile, manifest } = await readSpaceState(spaceName)
  return {
    profile,
    items: Array.isArray(manifest?.items) ? manifest.items : [],
    viewer: buildLocalViewer(),
    localOnly: true,
  }
}

export async function createLocalGalleryItem({
  spaceName,
  title = '',
  description = '',
  file,
  schematic = null,
  previewModel = null,
  placement = null,
  visibility = 'public',
  thumbnailDataUrl = '',
  projectionName = '',
}) {
  const normalizedSpaceName = normalizeSpaceName(spaceName)
  const { profile: currentProfile, manifest: currentManifest } = await readSpaceState(normalizedSpaceName)
  const nextProfile = buildLocalProfile(normalizedSpaceName, currentProfile)
  const nextManifest = buildLocalManifest(normalizedSpaceName, currentManifest)
  const now = Date.now()
  const itemId = createItemId()
  const fileBuffer = await file.arrayBuffer()
  const sourceFile = {
    fileName: file?.name || 'uploaded.schematic',
    mimeType: file?.type || 'application/octet-stream',
    size: Math.max(0, Math.round(Number(file?.size || fileBuffer.byteLength || 0))),
  }

  const projectionDisplayName = ensureProjectionDisplayName(
    projectionName || title || schematic?.name || sourceFile.fileName,
    `World${Date.now().toString(36)}`,
  )
  const projectionSlug = normalizeProjectionSlug(projectionDisplayName)
  const hasDuplicateProjection = Array.isArray(nextManifest.items) && nextManifest.items.some((entry) => {
    if (!entry) {
      return false
    }

    const entrySlug = normalizeProjectionSlug(entry.projectionSlug || entry.title || '')
    return !!entrySlug && entrySlug === projectionSlug
  })
  if (!projectionSlug || hasDuplicateProjection) {
    throw new Error('projection_name_exists')
  }
  const normalizedVisibility = normalizeProjectionVisibility(visibility)

  const summary = {
    id: itemId,
    title: projectionDisplayName,
    projectionSlug,
    description: String(description || '').trim(),
    visibility: normalizedVisibility,
    fileName: sourceFile.fileName,
    schematic: schematic || null,
    placement: placement || null,
    createdAt: now,
    updatedAt: now,
    preview: {
      totalSolidBlocks: Number(previewModel?.totalSolidBlocks || 0),
      sampled: !!previewModel?.sampled,
      bounds: previewModel?.bounds || null,
    },
    thumbnailDataUrl: String(thumbnailDataUrl || '').trim(),
    localOnly: true,
  }

  const item = {
    ...summary,
    space: normalizedSpaceName,
    mimeType: sourceFile.mimeType,
    sourceFile,
    thumbnailDataUrl: String(thumbnailDataUrl || '').trim(),
    previewModel: previewModel || null,
    placement: placement || null,
    visibility: normalizedVisibility,
    owner: {
      id: LOCAL_DEV_ACCOUNT.id,
      name: LOCAL_DEV_ACCOUNT.name,
      avatar: LOCAL_DEV_ACCOUNT.avatar,
    },
  }

  nextManifest.items = [
    summary,
    ...nextManifest.items.filter(entry => entry?.id !== itemId),
  ].sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
  nextManifest.updatedAt = now

  nextProfile.itemCount = nextManifest.items.length
  nextProfile.updatedAt = now

  await writeRecord(itemKey(normalizedSpaceName, itemId), item)
  await writeSourceRecord(sourceKey(normalizedSpaceName, itemId), {
    ...sourceFile,
    buffer: fileBuffer,
  })
  await writeSpaceState(normalizedSpaceName, nextProfile, nextManifest)

  return {
    ok: true,
    item: summary,
    profile: nextProfile,
    viewer: buildLocalViewer(),
    localOnly: true,
  }
}

export async function fetchLocalGalleryItem(spaceName, itemId) {
  const normalizedSpaceName = normalizeSpaceName(spaceName)
  const { profile, manifest } = await readSpaceState(normalizedSpaceName)
  const resolvedSummary = findManifestItemByIdentifier(manifest?.items, itemId)
  const resolvedItemId = resolvedSummary?.id || String(itemId || '').trim()
  const item = await readRecord(itemKey(normalizedSpaceName, resolvedItemId), null)
  if (!item) {
    throw new Error('gallery_item_not_found')
  }

  return {
    item,
    profile,
    viewer: buildLocalViewer(),
    localOnly: true,
  }
}

export async function fetchLocalGalleryItemSource(spaceName, itemId) {
  const normalizedSpaceName = normalizeSpaceName(spaceName)
  const { manifest } = await readSpaceState(normalizedSpaceName)
  const resolvedSummary = findManifestItemByIdentifier(manifest?.items, itemId)
  const resolvedItemId = resolvedSummary?.id || String(itemId || '').trim()
  const sourceRecord = await readSourceRecord(sourceKey(normalizedSpaceName, resolvedItemId), null)
  if (sourceRecord) {
    return sourceRecord
  }

  const item = await readRecord(itemKey(normalizedSpaceName, resolvedItemId), null)
  if (item?.sourceFile?.fileBase64) {
    return normalizeStoredSourceRecord({
      ...item.sourceFile,
      fileBase64: item.sourceFile.fileBase64,
    })
  }

  throw new Error('gallery_item_source_not_found')
}

export async function deleteLocalGalleryItem(spaceName, itemId) {
  const normalizedSpaceName = normalizeSpaceName(spaceName)
  const { profile: currentProfile, manifest: currentManifest } = await readSpaceState(normalizedSpaceName)
  const resolvedSummary = findManifestItemByIdentifier(currentManifest?.items, itemId)
  const resolvedItemId = resolvedSummary?.id || String(itemId || '').trim()
  const nextManifest = buildLocalManifest(normalizedSpaceName, currentManifest)
  nextManifest.items = nextManifest.items.filter(item => item?.id !== resolvedItemId)
  nextManifest.updatedAt = Date.now()

  const nextProfile = buildLocalProfile(normalizedSpaceName, currentProfile)
  nextProfile.itemCount = nextManifest.items.length
  nextProfile.updatedAt = Date.now()

  await deleteRecord(itemKey(normalizedSpaceName, resolvedItemId))
  await deleteRecord(sourceKey(normalizedSpaceName, resolvedItemId))
  await writeSpaceState(normalizedSpaceName, nextProfile, nextManifest)

  return {
    ok: true,
    items: nextManifest.items,
    profile: nextProfile,
    viewer: buildLocalViewer(),
    localOnly: true,
  }
}

export async function claimLocalGallerySpace(options = {}) {
  const {
    spaceName,
    displayName = '',
    bio = '',
    title,
  } = options

  const normalizedSpaceName = normalizeSpaceName(spaceName)
  const { profile: currentProfile, manifest } = await readSpaceState(normalizedSpaceName)
  const nextProfile = buildLocalProfile(normalizedSpaceName, currentProfile)
  if (displayName) {
    nextProfile.ownerName = String(displayName || '').trim()
  }
  if (bio) {
    nextProfile.bio = String(bio || '').trim()
  }
  if (title !== undefined) {
    nextProfile.title = String(title || '').trim()
  }
  nextProfile.itemCount = Array.isArray(manifest?.items) ? manifest.items.length : 0
  nextProfile.updatedAt = Date.now()

  await writeSpaceState(normalizedSpaceName, nextProfile, manifest)

  return {
    ok: true,
    profile: nextProfile,
    viewer: buildLocalViewer(),
    localOnly: true,
  }
}
