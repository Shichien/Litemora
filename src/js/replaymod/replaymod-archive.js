import JSZip from 'jszip'
import { check, ReplayModError } from './replaymod-binary.js'

export const DEFAULT_REPLAYMOD_LIMITS = Object.freeze({
  maxArchiveBytes: 128 * 1024 * 1024,
  maxEntries: 256,
  maxMetadataBytes: 256 * 1024,
  maxRecordingBytes: 256 * 1024 * 1024,
  maxExpandedBytes: 384 * 1024 * 1024,
  maxPacketBytes: 8 * 1024 * 1024,
  maxPackets: 2_000_000,
  maxEvents: 500_000,
  maxDecodedBytes: 192 * 1024 * 1024,
  maxArrayLength: 1_048_576,
  maxStringBytes: 131_068,
  maxNbtNodes: 1_000_000,
  maxEntities: 100_000,
  maxDimensionHeight: 1024,
  maxDurationMs: 7 * 24 * 60 * 60 * 1000,
})

export function replayLimits(overrides = {}) {
  const limits = { ...DEFAULT_REPLAYMOD_LIMITS }
  for (const [name, value] of Object.entries(overrides)) {
    check(Object.hasOwn(limits, name) && Number.isSafeInteger(value) && value > 0 && value <= limits[name], `Invalid limit ${name}; callers may only lower defaults`)
    limits[name] = value
  }
  return limits
}
export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Replay import was cancelled')
    error.name = 'AbortError'
    throw error
  }
}

/** Inspect the central directory before letting JSZip allocate decompressed buffers. */
function inspectZip(bytes, limits) {
  check(bytes.byteLength <= limits.maxArchiveBytes, `MCPR archive exceeds ${limits.maxArchiveBytes} bytes`, 'LIMIT_EXCEEDED')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const valid = (offset, n) => offset >= 0 && offset + n <= bytes.byteLength
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054B50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      end = i
      break
    }
  }
  check(end >= 0, 'Not a valid MCPR ZIP archive')
  const entries = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  let cursor = view.getUint32(end + 16, true)
  check(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0 && view.getUint16(end + 8, true) === entries, 'Split ZIP archives are unsupported')
  check(entries > 0 && entries <= limits.maxEntries && size !== 0xFFFFFFFF && cursor !== 0xFFFFFFFF, 'ZIP64 or excessive ZIP entries are unsupported', 'LIMIT_EXCEEDED')
  check(cursor + size === end, 'Invalid ZIP central directory bounds')
  const result = new Map()
  let expanded = 0
  for (let i = 0; i < entries; i++) {
    check(valid(cursor, 46) && view.getUint32(cursor, true) === 0x02014B50, 'Invalid ZIP directory entry')
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    check(next <= end && !(flags & 1) && (method === 0 || method === 8), 'Encrypted or unsupported ZIP entry')
    check(compressedSize !== 0xFFFFFFFF && uncompressedSize !== 0xFFFFFFFF && valid(localOffset, 30), 'ZIP64 or invalid local ZIP entry')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    check(!result.has(name) && !name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..'), 'Duplicate or unsafe ZIP entry name')
    check(view.getUint32(localOffset, true) === 0x04034B50 && view.getUint16(localOffset + 8, true) === method, 'Invalid local ZIP header')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const start = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true)
    check(valid(start, compressedSize) && start + compressedSize <= view.getUint32(end + 16, true), 'ZIP entry overlaps directory or exceeds archive')
    const localName = new TextDecoder().decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))
    check(localName === name, 'ZIP local and central names disagree')
    expanded += uncompressedSize
    check(expanded <= limits.maxExpandedBytes, 'Expanded ZIP exceeds memory limit', 'LIMIT_EXCEEDED')
    result.set(name, { uncompressedSize, compressedSize, crc: view.getUint32(cursor + 16, true) })
    cursor = next
  }
  check(cursor === end, 'ZIP directory length mismatch')
  for (const [name, limit] of [['metaData.json', limits.maxMetadataBytes], ['recording.tmcpr', limits.maxRecordingBytes]]) {
    check(result.has(name), `MCPR is missing ${name}`)
    check(result.get(name).uncompressedSize <= limit, `${name} exceeds memory limit`, 'LIMIT_EXCEEDED')
  }
  return result
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xEDB88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function extract(entry, info, limit, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let crc = 0xFFFFFFFF
    const stream = entry.internalStream('uint8array')
    const stop = (error) => {
      stream.pause()
      chunks.length = 0
      reject(error)
    }
    stream.on('data', (chunk, metadata) => {
      try {
        throwIfAborted(signal)
        size += chunk.length
        check(size <= limit && size <= info.uncompressedSize, 'ZIP decompression exceeds declared size or memory limit', 'LIMIT_EXCEEDED')
        for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8)
        chunks.push(chunk)
        onProgress?.(metadata.percent / 100)
      }
      catch (error) {
        stop(error)
      }
    })
    stream.on('error', stop)
    stream.on('end', () => {
      try {
        throwIfAborted(signal)
        check(size === info.uncompressedSize && ((crc ^ 0xFFFFFFFF) >>> 0) === info.crc, 'ZIP size or CRC mismatch')
        const output = new Uint8Array(size)
        let cursor = 0
        for (const chunk of chunks) {
          output.set(chunk, cursor)
          cursor += chunk.length
        }
        chunks.length = 0
        resolve(output)
      }
      catch (error) {
        reject(error)
      }
    })
    stream.resume()
  })
}

export async function readReplayArchive(input, limits, options = {}) {
  throwIfAborted(options.signal)
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null
  check(bytes, 'Replay input must be an ArrayBuffer or Uint8Array')
  const directory = inspectZip(bytes, limits)
  let zip
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false })
  }
  catch (error) {
    throw new ReplayModError(`Invalid MCPR archive: ${error.message}`)
  }
  const metadataBytes = await extract(zip.file('metaData.json'), directory.get('metaData.json'), limits.maxMetadataBytes, options.signal)
  let metadata
  try {
    metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes))
  }
  catch {
    throw new ReplayModError('Invalid metaData.json')
  }
  check(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'Invalid replay metadata object')
  const recording = () => extract(zip.file('recording.tmcpr'), directory.get('recording.tmcpr'), limits.maxRecordingBytes, options.signal, progress => options.onProgress?.({ phase: 'decompress', progress }))
  return { metadata, recording }
}
