import {
  getMinecraftBlockCollisionProfile,
  normalizeMinecraftBlockName,
  normalizeMinecraftBlockProperties,
} from './minecraft-block-data.js'

const SNAPSHOT_VERSION = 1
const DEFAULT_CHUNK_WIDTH = 64
const MAX_Y = 4095

function toFiniteInt(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback
}

function encodePosition(localX, localY, localZ, chunkWidth = DEFAULT_CHUNK_WIDTH) {
  const x = toFiniteInt(localX, Number.NaN)
  const y = toFiniteInt(localY, Number.NaN)
  const z = toFiniteInt(localZ, Number.NaN)

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }

  if (x < 0 || z < 0 || y < 0 || x >= chunkWidth || z >= chunkWidth || y > MAX_Y) {
    return null
  }

  return (y << 12) | (z << 6) | x
}

function decodePosition(encoded) {
  const value = toFiniteInt(encoded, -1)
  if (value < 0) {
    return null
  }

  return {
    localX: value & 0x3F,
    localZ: (value >> 6) & 0x3F,
    localY: (value >> 12) & 0xFFF,
  }
}

function bytesToBase64(bytes) {
  if (!bytes?.length) {
    return ''
  }

  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function base64ToBytes(base64 = '') {
  if (!base64) {
    return new Uint8Array(0)
  }

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function serializeProperties(properties = {}) {
  return Object.entries(normalizeMinecraftBlockProperties(properties))
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

function deserializeProperties(serialized = '') {
  const properties = {}

  String(serialized || '')
    .split(',')
    .forEach((pair) => {
      const separatorIndex = pair.indexOf('=')
      if (separatorIndex <= 0) {
        return
      }

      const key = pair.slice(0, separatorIndex).trim()
      const value = pair.slice(separatorIndex + 1).trim()
      if (key && value) {
        properties[key] = value
      }
    })

  return normalizeMinecraftBlockProperties(properties)
}

function paletteEntryKey(entry = {}) {
  return `${entry.n || ''}::${entry.p || ''}`
}

export default class MinecraftSchematicLayer {
  constructor(options = {}) {
    this.chunkWidth = Number(options.chunkWidth || DEFAULT_CHUNK_WIDTH) || DEFAULT_CHUNK_WIDTH
    this.chunks = new Map()
  }

  _chunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`
  }

  _blockKey(localX, localY, localZ) {
    return `${localX},${localY},${localZ}`
  }

  _splitWorldPosition(worldX, worldY, worldZ) {
    const chunkX = Math.floor(worldX / this.chunkWidth)
    const chunkZ = Math.floor(worldZ / this.chunkWidth)

    return {
      chunkX,
      chunkZ,
      chunkKey: this._chunkKey(chunkX, chunkZ),
      localX: Math.floor(worldX - chunkX * this.chunkWidth),
      localY: Math.floor(worldY),
      localZ: Math.floor(worldZ - chunkZ * this.chunkWidth),
    }
  }

  _getOrCreateChunk(chunkKey) {
    if (!this.chunks.has(chunkKey)) {
      this.chunks.set(chunkKey, new Map())
    }
    return this.chunks.get(chunkKey)
  }

  _setLocalBlock(chunkKey, localX, localY, localZ, blockName, properties = {}) {
    const normalizedBlockName = normalizeMinecraftBlockName(blockName)
    if (!normalizedBlockName) {
      return null
    }

    const profile = getMinecraftBlockCollisionProfile(normalizedBlockName, properties)
    const chunk = this._getOrCreateChunk(chunkKey)
    const blockKey = this._blockKey(localX, localY, localZ)

    const entry = {
      blockName: profile.blockName,
      properties: normalizeMinecraftBlockProperties(profile.properties),
      stateId: profile.stateId,
      collisionBoxes: profile.collisionBoxes,
      collisionSource: profile.collisionSource,
      boundingBox: profile.boundingBox,
      hasCollision: profile.hasCollision,
      isKnownBlock: profile.isKnownBlock,
      isClimbable: profile.isClimbable,
    }

    chunk.set(blockKey, entry)
    return entry
  }

  clear() {
    this.chunks.clear()
  }

  setBlock(worldX, worldY, worldZ, blockName, properties = {}) {
    const normalizedBlockName = normalizeMinecraftBlockName(blockName)
    if (!normalizedBlockName || normalizedBlockName === 'air' || normalizedBlockName === 'cave_air' || normalizedBlockName === 'void_air') {
      this.removeBlock(worldX, worldY, worldZ)
      return null
    }

    const { chunkKey, localX, localY, localZ } = this._splitWorldPosition(worldX, worldY, worldZ)
    return this._setLocalBlock(chunkKey, localX, localY, localZ, normalizedBlockName, properties)
  }

  removeBlock(worldX, worldY, worldZ) {
    const { chunkKey, localX, localY, localZ } = this._splitWorldPosition(worldX, worldY, worldZ)
    const chunk = this.chunks.get(chunkKey)
    if (!chunk) {
      return false
    }

    const removed = chunk.delete(this._blockKey(localX, localY, localZ))
    if (chunk.size === 0) {
      this.chunks.delete(chunkKey)
    }

    return removed
  }

  getBlock(worldX, worldY, worldZ) {
    const { chunkKey, localX, localY, localZ } = this._splitWorldPosition(worldX, worldY, worldZ)
    const chunk = this.chunks.get(chunkKey)
    if (!chunk) {
      return null
    }

    return chunk.get(this._blockKey(localX, localY, localZ)) || null
  }

  forEachBlock(callback) {
    if (typeof callback !== 'function') {
      return
    }

    for (const [chunkKey, blockMap] of this.chunks.entries()) {
      const [chunkX, chunkZ] = chunkKey.split(',').map(value => Number(value))
      if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
        continue
      }

      for (const [blockKey, entry] of blockMap.entries()) {
        const [localX, localY, localZ] = blockKey.split(',').map(value => Number(value))
        if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(localZ)) {
          continue
        }

        callback(
          {
            chunkX,
            chunkZ,
            localX,
            localY,
            localZ,
            worldX: (chunkX * this.chunkWidth) + localX,
            worldY: localY,
            worldZ: (chunkZ * this.chunkWidth) + localZ,
          },
          entry,
        )
      }
    }
  }

  getStats() {
    let blockCount = 0
    for (const chunk of this.chunks.values()) {
      blockCount += chunk.size
    }

    return {
      chunkCount: this.chunks.size,
      blockCount,
    }
  }

  exportSnapshot() {
    if (!this.chunks.size) {
      return null
    }

    const chunks = {}

    for (const [chunkKey, blockMap] of this.chunks.entries()) {
      const palette = []
      const paletteLookup = new Map()
      const positions = []
      const paletteIndexes = []

      for (const [blockKey, entry] of blockMap.entries()) {
        const [localX, localY, localZ] = blockKey.split(',').map(v => toFiniteInt(v, Number.NaN))
        const encodedPosition = encodePosition(localX, localY, localZ, this.chunkWidth)
        if (encodedPosition === null) {
          continue
        }

        const serializedProperties = serializeProperties(entry?.properties || {})
        const paletteEntry = {
          n: entry?.blockName || '',
          ...(serializedProperties ? { p: serializedProperties } : {}),
        }

        const key = paletteEntryKey(paletteEntry)
        let paletteIndex = paletteLookup.get(key)
        if (paletteIndex === undefined) {
          paletteIndex = palette.length
          palette.push(paletteEntry)
          paletteLookup.set(key, paletteIndex)
        }

        positions.push(encodedPosition)
        paletteIndexes.push(paletteIndex)
      }

      if (!positions.length) {
        continue
      }

      const sortable = positions.map((position, index) => ({
        position,
        paletteIndex: paletteIndexes[index],
      }))

      sortable.sort((a, b) => a.position - b.position)

      const sortedPositions = new Uint32Array(sortable.length)
      const sortedPaletteIndexes = new Uint16Array(sortable.length)

      for (let index = 0; index < sortable.length; index++) {
        sortedPositions[index] = sortable[index].position
        sortedPaletteIndexes[index] = sortable[index].paletteIndex
      }

      chunks[chunkKey] = {
        p: palette,
        pos: bytesToBase64(new Uint8Array(sortedPositions.buffer)),
        pid: bytesToBase64(new Uint8Array(sortedPaletteIndexes.buffer)),
        c: sortable.length,
      }
    }

    if (!Object.keys(chunks).length) {
      return null
    }

    return {
      version: SNAPSHOT_VERSION,
      chunkWidth: this.chunkWidth,
      chunks,
    }
  }

  importSnapshot(snapshot = null) {
    this.clear()

    if (!snapshot || typeof snapshot !== 'object' || !snapshot.chunks || typeof snapshot.chunks !== 'object') {
      return
    }

    for (const [chunkKey, chunk] of Object.entries(snapshot.chunks)) {
      const palette = Array.isArray(chunk?.p) ? chunk.p : []
      const expectedCount = Math.max(0, toFiniteInt(chunk?.c))
      if (!palette.length || !expectedCount) {
        continue
      }

      const positionBytes = base64ToBytes(String(chunk?.pos || ''))
      const paletteIndexBytes = base64ToBytes(String(chunk?.pid || ''))

      const positions = new Uint32Array(positionBytes.buffer, positionBytes.byteOffset, Math.floor(positionBytes.byteLength / 4))
      const paletteIndexes = new Uint16Array(paletteIndexBytes.buffer, paletteIndexBytes.byteOffset, Math.floor(paletteIndexBytes.byteLength / 2))
      const count = Math.min(expectedCount, positions.length, paletteIndexes.length)

      if (!count) {
        continue
      }

      for (let index = 0; index < count; index++) {
        const decoded = decodePosition(positions[index])
        if (!decoded) {
          continue
        }

        const paletteEntry = palette[paletteIndexes[index]]
        const blockName = normalizeMinecraftBlockName(paletteEntry?.n)
        if (!blockName) {
          continue
        }

        this._setLocalBlock(
          chunkKey,
          decoded.localX,
          decoded.localY,
          decoded.localZ,
          blockName,
          deserializeProperties(paletteEntry?.p || ''),
        )
      }
    }
  }
}
