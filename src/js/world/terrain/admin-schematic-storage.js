const SCHEMATIC_DB_NAME = 'mc-admin-storage'
const SCHEMATIC_DB_STORE = 'schematic-files'
const SCHEMATIC_DB_VERSION = 1
const SCHEMATIC_FALLBACK_PREFIX = 'mc-admin-schematic-fallback'

function buildSchematicKey(accountId = '') {
  const normalizedId = String(accountId || '').trim()
  return normalizedId ? `account:${encodeURIComponent(normalizedId)}` : 'account:default'
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'))
      return
    }

    const request = indexedDB.open(SCHEMATIC_DB_NAME, SCHEMATIC_DB_VERSION)
    request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SCHEMATIC_DB_STORE)) {
        db.createObjectStore(SCHEMATIC_DB_STORE, { keyPath: 'id' })
      }
    }
  })
}

function toDataUrlBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function fromDataUrlBase64(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function fallbackStorageKey(accountId = '') {
  return `${SCHEMATIC_FALLBACK_PREFIX}:${buildSchematicKey(accountId)}`
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

export async function saveAdminSchematicFile({ accountId = '', file }) {
  const key = buildSchematicKey(accountId)
  const fileName = file?.name || 'uploaded.litematic'
  const mimeType = file?.type || 'application/octet-stream'
  const buffer = await file.arrayBuffer()

  const payload = {
    id: key,
    fileName,
    mimeType,
    buffer,
    updatedAt: Date.now(),
  }

  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEMATIC_DB_STORE, 'readwrite')
      const store = tx.objectStore(SCHEMATIC_DB_STORE)
      store.put(payload)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('indexeddb_write_failed'))
      tx.onabort = () => reject(tx.error || new Error('indexeddb_write_aborted'))
    })
    db.close()
    localStorage.removeItem(fallbackStorageKey(accountId))
  }
  catch {
    localStorage.setItem(
      fallbackStorageKey(accountId),
      JSON.stringify({
        fileName,
        mimeType,
        updatedAt: Date.now(),
        base64: toDataUrlBase64(buffer),
      }),
    )
  }
}

export async function loadAdminSchematicFile(accountId = '') {
  const key = buildSchematicKey(accountId)

  try {
    const db = await openDb()
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEMATIC_DB_STORE, 'readonly')
      const store = tx.objectStore(SCHEMATIC_DB_STORE)
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'))
    })
    db.close()

    if (!record?.buffer) {
      return null
    }

    return {
      file: createFileFromBuffer(record.buffer, record.fileName || 'uploaded.litematic', record.mimeType),
      fileName: record.fileName || 'uploaded.litematic',
      updatedAt: record.updatedAt || 0,
    }
  }
  catch {
    const raw = localStorage.getItem(fallbackStorageKey(accountId))
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw)
      if (!parsed?.base64) {
        return null
      }
      const buffer = fromDataUrlBase64(parsed.base64)
      return {
        file: createFileFromBuffer(buffer, parsed.fileName || 'uploaded.litematic', parsed.mimeType),
        fileName: parsed.fileName || 'uploaded.litematic',
        updatedAt: parsed.updatedAt || 0,
      }
    }
    catch {
      return null
    }
  }
}

export async function clearAdminSchematicFile(accountId = '') {
  const key = buildSchematicKey(accountId)

  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEMATIC_DB_STORE, 'readwrite')
      const store = tx.objectStore(SCHEMATIC_DB_STORE)
      store.delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('indexeddb_delete_failed'))
      tx.onabort = () => reject(tx.error || new Error('indexeddb_delete_aborted'))
    })
    db.close()
  }
  catch {
    // ignore and fallback
  }

  localStorage.removeItem(fallbackStorageKey(accountId))
}
