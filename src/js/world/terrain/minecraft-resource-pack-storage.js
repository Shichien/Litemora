import { buildSpaceScopedKey, getActiveProjectionId, getActiveSpaceName } from '../../utils/space-context.js'

const RESOURCE_PACK_DB_NAME = 'mc-world-storage'
const RESOURCE_PACK_DB_STORE = 'minecraft-resource-packs'
const RESOURCE_PACK_DB_VERSION = 1
const RESOURCE_PACK_FALLBACK_PREFIX = 'mc-resource-pack-fallback'

function resolveScope(options = {}) {
  return {
    spaceName: String(options.spaceName || getActiveSpaceName() || '').trim(),
    projectionId: String(options.projectionId || getActiveProjectionId() || '').trim(),
  }
}

function buildScopedPackKey(options = {}) {
  const { spaceName, projectionId } = resolveScope(options)
  return buildSpaceScopedKey('minecraft-resource-pack', spaceName, projectionId) || 'minecraft-resource-pack'
}

function buildScopeFallbackKeys(options = {}) {
  const { spaceName, projectionId } = resolveScope(options)
  const keys = []

  if (spaceName && projectionId) {
    keys.push(buildSpaceScopedKey('minecraft-resource-pack', spaceName, projectionId))
  }
  if (spaceName) {
    keys.push(buildSpaceScopedKey('minecraft-resource-pack', spaceName))
  }
  keys.push('minecraft-resource-pack')

  return [...new Set(keys.filter(Boolean))]
}

function fallbackStorageKey(scopedKey = '') {
  return `${RESOURCE_PACK_FALLBACK_PREFIX}:${scopedKey}`
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'))
      return
    }

    const request = indexedDB.open(RESOURCE_PACK_DB_NAME, RESOURCE_PACK_DB_VERSION)
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RESOURCE_PACK_DB_STORE)) {
        db.createObjectStore(RESOURCE_PACK_DB_STORE, { keyPath: 'id' })
      }
    }
  })
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function fromBase64(base64 = '') {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function createFileFromBuffer(buffer, fileName, mimeType) {
  const type = mimeType || 'application/octet-stream'
  try {
    return new File([buffer], fileName, { type })
  }
  catch {
    const blob = new Blob([buffer], { type })
    blob.name = fileName
    return blob
  }
}

function normalizeRecord(record, key) {
  if (!record?.buffer) {
    return null
  }

  return {
    key,
    fileName: record.fileName || 'resource-pack.zip',
    mimeType: record.mimeType || 'application/octet-stream',
    size: Number(record.size || record.buffer?.byteLength || 0),
    updatedAt: Number(record.updatedAt || 0),
    file: createFileFromBuffer(record.buffer, record.fileName || 'resource-pack.zip', record.mimeType),
  }
}

function readFallbackRecord(scopedKey = '') {
  const raw = localStorage.getItem(fallbackStorageKey(scopedKey))
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const buffer = fromBase64(parsed.base64 || '')
    return normalizeRecord({
      ...parsed,
      buffer,
    }, scopedKey)
  }
  catch {
    return null
  }
}

async function readIndexedDbRecord(scopedKey = '') {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RESOURCE_PACK_DB_STORE, 'readonly')
      const store = tx.objectStore(RESOURCE_PACK_DB_STORE)
      const request = store.get(scopedKey)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'))
    })
  }
  finally {
    db.close()
  }
}

export async function saveMinecraftResourcePackFile(file, options = {}) {
  if (!(file instanceof Blob)) {
    throw new Error('minecraft_resource_pack_file_required')
  }

  const scopedKey = buildScopedPackKey(options)
  const fileName = file.name || 'resource-pack.zip'
  const mimeType = file.type || 'application/zip'
  const buffer = await file.arrayBuffer()
  const payload = {
    id: scopedKey,
    fileName,
    mimeType,
    size: buffer.byteLength,
    buffer,
    updatedAt: Date.now(),
  }

  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RESOURCE_PACK_DB_STORE, 'readwrite')
      const store = tx.objectStore(RESOURCE_PACK_DB_STORE)
      store.put(payload)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('indexeddb_write_failed'))
      tx.onabort = () => reject(tx.error || new Error('indexeddb_write_aborted'))
    })
    db.close()
    localStorage.removeItem(fallbackStorageKey(scopedKey))
  }
  catch {
    localStorage.setItem(
      fallbackStorageKey(scopedKey),
      JSON.stringify({
        fileName,
        mimeType,
        size: buffer.byteLength,
        updatedAt: payload.updatedAt,
        base64: toBase64(buffer),
      }),
    )
  }

  return normalizeRecord(payload, scopedKey)
}

export async function loadMinecraftResourcePack(options = {}) {
  const scopedKeys = buildScopeFallbackKeys(options)

  for (const scopedKey of scopedKeys) {
    try {
      const record = await readIndexedDbRecord(scopedKey)
      const normalized = normalizeRecord(record, scopedKey)
      if (normalized) {
        return normalized
      }
    }
    catch {
      // ignore and continue fallback lookup
    }

    const fallback = readFallbackRecord(scopedKey)
    if (fallback) {
      return fallback
    }
  }

  return null
}

export async function clearMinecraftResourcePack(options = {}) {
  const scopedKey = buildScopedPackKey(options)

  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RESOURCE_PACK_DB_STORE, 'readwrite')
      const store = tx.objectStore(RESOURCE_PACK_DB_STORE)
      store.delete(scopedKey)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('indexeddb_delete_failed'))
      tx.onabort = () => reject(tx.error || new Error('indexeddb_delete_aborted'))
    })
    db.close()
  }
  catch {
    // ignore IndexedDB failures and clear fallback below
  }

  localStorage.removeItem(fallbackStorageKey(scopedKey))
}

export function getMinecraftResourcePackStorageKey(options = {}) {
  return buildScopedPackKey(options)
}
