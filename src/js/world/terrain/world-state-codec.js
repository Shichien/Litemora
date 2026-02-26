import { BLOCK_IDS, ensureDynamicBlockType, getBlockSignatureById, getBlockTypeById } from './blocks-config.js'

const FORMAT = 'chunk-v2'
const SCHEMA_VERSION = 1
const DEFAULT_CHUNK_WIDTH = 64
const MAX_Y = 4095
const DYNAMIC_BLOCK_ID_THRESHOLD = 1000

function toFiniteInt(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function encodePosition(localX, localY, localZ, chunkWidth = DEFAULT_CHUNK_WIDTH) {
  const x = toFiniteInt(localX)
  const y = toFiniteInt(localY)
  const z = toFiniteInt(localZ)

  if (x < 0 || z < 0 || y < 0) {
    return null
  }

  if (x >= chunkWidth || z >= chunkWidth || y > MAX_Y) {
    return null
  }

  return (y << 12) | (z << 6) | x
}

function decodePosition(encoded) {
  const value = toFiniteInt(encoded, -1)
  if (value < 0) {
    return null
  }

  const localX = value & 0x3F
  const localZ = (value >> 6) & 0x3F
  const localY = (value >> 12) & 0xFFF
  return { localX, localY, localZ }
}

function bytesToBase64(bytes) {
  if (!bytes?.length) {
    return ''
  }

  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
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

function normalizeWorldState(worldState = {}) {
  return {
    schematicOnlyMode: !!worldState?.schematicOnlyMode,
  }
}

function encodePaletteEntry(blockIdRaw) {
  const blockId = toFiniteInt(blockIdRaw)
  if (!Number.isFinite(blockId) || blockId <= 0) {
    return blockId
  }

  if (blockId < DYNAMIC_BLOCK_ID_THRESHOLD) {
    return blockId
  }

  const blockSignature = getBlockSignatureById(blockId)
  if (!blockSignature) {
    return blockId
  }

  const textureName = String(blockSignature.textureName || '')

  if (!textureName) {
    return blockId
  }

  return {
    id: blockSignature.id,
    textureName,
    geometryType: blockSignature.geometryType || 'cube',
    blockName: blockSignature.blockName || textureName,
    textureKeys: blockSignature.textureKeys || { all: textureName },
  }
}

function paletteEntryKey(entry) {
  if (entry && typeof entry === 'object') {
    const id = toFiniteInt(entry.id)
    const textureName = String(entry.textureName || '')
    const geometryType = String(entry.geometryType || 'cube')
    const blockName = String(entry.blockName || '')
    return `dyn:${id}:${textureName}:${geometryType}:${blockName}`
  }
  return `id:${toFiniteInt(entry)}`
}

function resolvePaletteEntryToBlockId(entry, dynamicIdMap = null) {
  if (entry && typeof entry === 'object') {
    const knownId = toFiniteInt(entry.id)
    if (Number.isFinite(knownId) && knownId > 0 && getBlockTypeById(knownId)) {
      return knownId
    }

    const textureName = String(entry.textureName || '').trim()
    if (textureName) {
      const dynamic = ensureDynamicBlockType(textureName, {
        geometryType: entry.geometryType || 'cube',
        blockName: entry.blockName || textureName,
        preferredId: Number.isFinite(knownId) && knownId >= DYNAMIC_BLOCK_ID_THRESHOLD
          ? knownId
          : undefined,
      })
      if (dynamic?.id) {
        if (dynamicIdMap && Number.isFinite(knownId) && knownId > 0) {
          dynamicIdMap.set(knownId, dynamic.id)
        }
        return dynamic.id
      }
    }

    if (Number.isFinite(knownId) && knownId > 0) {
      return knownId >= DYNAMIC_BLOCK_ID_THRESHOLD ? BLOCK_IDS.STONE : knownId
    }

    return BLOCK_IDS.STONE
  }

  const blockId = toFiniteInt(entry)
  if (!Number.isFinite(blockId) || blockId < 0) {
    return BLOCK_IDS.EMPTY
  }

  if (blockId === BLOCK_IDS.EMPTY) {
    return BLOCK_IDS.EMPTY
  }

  if (!getBlockTypeById(blockId) && blockId >= DYNAMIC_BLOCK_ID_THRESHOLD) {
    if (dynamicIdMap && dynamicIdMap.has(blockId)) {
      return dynamicIdMap.get(blockId)
    }
    return BLOCK_IDS.STONE
  }

  return blockId
}

function normalizeDynamicPalette(snapshot = {}) {
  const dynamicPalette = new Map()
  const raw = snapshot?.dynamicPalette
  if (!raw || typeof raw !== 'object') {
    return dynamicPalette
  }

  for (const [legacyIdRaw, entry] of Object.entries(raw)) {
    const legacyId = toFiniteInt(legacyIdRaw)
    if (!Number.isFinite(legacyId) || legacyId < DYNAMIC_BLOCK_ID_THRESHOLD) {
      continue
    }
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const textureName = String(entry.textureName || entry?.textureKeys?.all || '').trim()
    if (!textureName) {
      continue
    }

    const dynamic = ensureDynamicBlockType(textureName, {
      geometryType: entry.geometryType || 'cube',
      blockName: entry.blockName || textureName,
      preferredId: legacyId,
    })

    if (dynamic?.id) {
      dynamicPalette.set(legacyId, dynamic.id)
    }
  }

  return dynamicPalette
}

export function encodeWorldStateSnapshot(snapshot = {}, options = {}) {
  const chunkWidth = Number(options.chunkWidth || DEFAULT_CHUNK_WIDTH) || DEFAULT_CHUNK_WIDTH
  const worldState = normalizeWorldState(snapshot?.worldState)
  const modifications = snapshot?.modifications || {}

  const chunks = {}
  const dynamicPalette = {}

  for (const [chunkKey, blockMap] of Object.entries(modifications)) {
    if (!blockMap || typeof blockMap !== 'object') {
      continue
    }

    const palette = []
    const paletteLookup = new Map()
    const positions = []
    const paletteIndexes = []

    for (const [blockKey, blockIdRaw] of Object.entries(blockMap)) {
      const [localX, localY, localZ] = String(blockKey).split(',').map(v => toFiniteInt(v, NaN))
      if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(localZ)) {
        continue
      }

      const packedPos = encodePosition(localX, localY, localZ, chunkWidth)
      if (packedPos === null) {
        continue
      }

      const blockId = toFiniteInt(blockIdRaw)
      const encodedEntry = encodePaletteEntry(blockId)
      if (encodedEntry && typeof encodedEntry === 'object' && Number.isFinite(encodedEntry.id)) {
        dynamicPalette[String(encodedEntry.id)] = {
          id: encodedEntry.id,
          textureName: encodedEntry.textureName,
          geometryType: encodedEntry.geometryType || 'cube',
          blockName: encodedEntry.blockName || encodedEntry.textureName,
          textureKeys: encodedEntry.textureKeys || { all: encodedEntry.textureName },
        }
      }

      const paletteKey = paletteEntryKey(encodedEntry)
      let paletteIndex = paletteLookup.get(paletteKey)
      if (paletteIndex === undefined) {
        paletteIndex = palette.length
        palette.push(encodedEntry)
        paletteLookup.set(paletteKey, paletteIndex)
      }

      positions.push(packedPos)
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

  return {
    format: FORMAT,
    version: SCHEMA_VERSION,
    chunkWidth,
    worldState,
    ...(Object.keys(dynamicPalette).length ? { dynamicPalette } : {}),
    chunks,
  }
}

export function decodeWorldStateSnapshot(snapshot = {}) {
  const worldState = normalizeWorldState(snapshot?.worldState)

  if (snapshot?.format !== FORMAT || !snapshot?.chunks || typeof snapshot.chunks !== 'object') {
    return {
      worldState,
      modifications: snapshot?.modifications && typeof snapshot.modifications === 'object'
        ? snapshot.modifications
        : {},
    }
  }

  const modifications = {}
  const dynamicIdMap = normalizeDynamicPalette(snapshot)

  for (const [chunkKey, chunk] of Object.entries(snapshot.chunks)) {
    const palette = Array.isArray(chunk?.p)
      ? chunk.p.map(entry => resolvePaletteEntryToBlockId(entry, dynamicIdMap))
      : []
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

    const blockMap = {}
    for (let index = 0; index < count; index++) {
      const decoded = decodePosition(positions[index])
      if (!decoded) {
        continue
      }

      const blockId = palette[paletteIndexes[index]]
      if (!Number.isFinite(blockId)) {
        continue
      }

      const blockKey = `${decoded.localX},${decoded.localY},${decoded.localZ}`
      blockMap[blockKey] = blockId
    }

    if (Object.keys(blockMap).length) {
      modifications[chunkKey] = blockMap
    }
  }

  return {
    worldState,
    modifications,
  }
}
