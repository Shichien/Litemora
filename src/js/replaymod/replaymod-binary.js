export class ReplayModError extends Error {
  constructor(message, code = 'INVALID_REPLAY') {
    super(message)
    this.name = 'ReplayModError'
    this.code = code
  }
}

export function check(condition, message, code) {
  if (!condition)
    throw new ReplayModError(message, code)
}

const textDecoder = new TextDecoder('utf-8', { fatal: true })

/** Bounded, big-endian Minecraft network reader; no Node Buffer dependency. */
export class BinaryReader {
  constructor(bytes, limits = {}) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
    this.offset = 0
    this.limits = { maxArrayLength: 1_048_576, maxStringBytes: 131_068, maxNbtNodes: 1_000_000, ...limits }
    this.nodes = 0
    this.allocatedBytes = 0
    this.maskNextByte = false
  }

  reserve(n) {
    this.allocatedBytes += n
    check(this.allocatedBytes <= (this.limits.maxDecodedBytes ?? 192 * 1024 * 1024), 'Decoded packet exceeds memory limit', 'LIMIT_EXCEEDED')
  }

  get remaining() {
    return this.bytes.byteLength - this.offset
  }

  need(n) {
    check(Number.isSafeInteger(n) && n >= 0 && n <= this.remaining, `Truncated packet at byte ${this.offset}: need ${n}, have ${this.remaining}`)
  }

  count(n, max = this.limits.maxArrayLength) {
    check(Number.isSafeInteger(n) && n >= 0 && n <= max, `Invalid or excessive array length ${n}`)
    return n
  }

  take(n, copy = false) {
    this.need(n)
    if (copy)
      this.reserve(n)
    const b = this.bytes.subarray(this.offset, this.offset += n)
    return copy ? b.slice() : b
  }

  u8() {
    this.need(1)
    let n = this.view.getUint8(this.offset++)
    if (this.maskNextByte) {
      n &= 127
      this.maskNextByte = false
    }
    return n
  }

  i8() {
    const n = this.u8()
    return n > 127 ? n - 256 : n
  }

  u16() {
    this.need(2)
    const n = this.view.getUint16(this.offset)
    this.offset += 2
    return n
  }

  i16() {
    this.need(2)
    const n = this.view.getInt16(this.offset)
    this.offset += 2
    return n
  }

  u32() {
    this.need(4)
    const n = this.view.getUint32(this.offset)
    this.offset += 4
    return n
  }

  i32() {
    this.need(4)
    const n = this.view.getInt32(this.offset)
    this.offset += 4
    return n
  }

  u64() {
    this.need(8)
    const n = this.view.getBigUint64(this.offset)
    this.offset += 8
    return n
  }

  i64() {
    return BigInt.asIntN(64, this.u64())
  }

  f32() {
    this.need(4)
    const n = this.view.getFloat32(this.offset)
    this.offset += 4
    check(Number.isFinite(n), 'Non-finite packet number')
    return n
  }

  f64() {
    this.need(8)
    const n = this.view.getFloat64(this.offset)
    this.offset += 8
    check(Number.isFinite(n), 'Non-finite packet number')
    return n
  }

  bool() {
    const n = this.u8()
    check(n <= 1, `Invalid boolean ${n}`)
    return n === 1
  }

  varint() {
    let n = 0
    for (let i = 0; i < 5; i++) {
      const b = this.u8()
      check(i !== 4 || (b & 240) === 0, 'VarInt exceeds 32 bits')
      n |= (b & 127) << (i * 7)
      if (!(b & 128))
        return n
    }
    throw new ReplayModError('VarInt is too long')
  }

  varlong() {
    let n = 0n
    for (let i = 0; i < 10; i++) {
      const b = this.u8()
      check(i !== 9 || (b & 254) === 0, 'VarLong exceeds 64 bits')
      n |= BigInt(b & 127) << BigInt(i * 7)
      if (!(b & 128))
        return BigInt.asIntN(64, n)
    }
    throw new ReplayModError('VarLong is too long')
  }

  string(length = this.varint()) {
    this.count(length, this.limits.maxStringBytes)
    this.reserve(length * 2 + 24)
    try {
      return textDecoder.decode(this.take(length))
    }
    catch {
      throw new ReplayModError('Invalid UTF-8 string')
    }
  }

  nbtString() {
    const bytes = this.take(this.count(this.u16(), this.limits.maxStringBytes))
    this.reserve(bytes.length * 2 + 24)
    const units = []
    for (let i = 0; i < bytes.length;) {
      const a = bytes[i++]
      if (a < 128) {
        units.push(a)
      }
      else if ((a & 224) === 192) {
        const b = bytes[i++]
        check(b !== undefined && (b & 192) === 128, 'Invalid modified UTF-8 NBT string')
        const value = ((a & 31) << 6) | (b & 63)
        check(value === 0 || value >= 128, 'Overlong modified UTF-8 NBT string')
        units.push(value)
      }
      else {
        const b = bytes[i++]
        const c = bytes[i++]
        check((a & 240) === 224 && b !== undefined && c !== undefined && (b & 192) === 128 && (c & 192) === 128, 'Invalid modified UTF-8 NBT string')
        const value = ((a & 15) << 12) | ((b & 63) << 6) | (c & 63)
        check(value >= 2048, 'Overlong modified UTF-8 NBT string')
        units.push(value)
      }
    }
    let text = ''
    for (let i = 0; i < units.length; i += 2048) text += String.fromCharCode(...units.slice(i, i + 2048))
    return text
  }

  nbt(named = false, depth = 0, tag) {
    check(depth <= 64 && ++this.nodes <= this.limits.maxNbtNodes, 'NBT exceeds nesting or node limit')
    this.reserve(64)
    const type = tag ?? this.u8()
    if (type === 0)
      return null
    if (named)
      this.nbtString()
    switch (type) {
      case 1: return this.i8()
      case 2: return this.i16()
      case 3: return this.i32()
      case 4: return this.i64()
      case 5: return this.f32()
      case 6: return this.f64()
      case 7: return this.take(this.count(this.i32()), true)
      case 8: return this.nbtString()
      case 9: {
        const childType = this.u8()
        const length = this.count(this.i32())
        this.reserve(length * 8 + 24)
        check(childType > 0 || length === 0, 'Nonempty NBT end-tag list')
        return Array.from({ length }, () => this.nbt(false, depth + 1, childType))
      }
      case 10: {
        const value = Object.create(null)
        for (;;) {
          const childType = this.u8()
          if (childType === 0)
            return value
          const name = this.nbtString()
          check(!Object.hasOwn(value, name), `Duplicate NBT key ${name}`)
          value[name] = this.nbt(false, depth + 1, childType)
        }
      }
      case 11: {
        const n = this.count(this.i32())
        this.need(n * 4)
        this.reserve(n * 4)
        return Int32Array.from({ length: n }, () => this.i32())
      }
      case 12: {
        const n = this.count(this.i32())
        this.need(n * 8)
        this.reserve(n * 8)
        return BigInt64Array.from({ length: n }, () => this.i64())
      }
      default: throw new ReplayModError(`Unsupported NBT tag ${type}`)
    }
  }
}

function lookup(contexts, path) {
  let index = contexts.length - 1
  while (path.startsWith('../')) {
    index--
    path = path.slice(3)
  }
  for (; index >= 0; index--) {
    let value = contexts[index]
    for (const key of path.split('/')) value = value?.[key]
    if (value !== undefined)
      return value
  }
  return undefined
}

/** Small interpreter for the generated Prismarine protocol schemas. */
export function decodeType(reader, type, types, contexts = [], args = {}, depth = 0) {
  check(depth < 96, 'Protocol value exceeds nesting limit')
  reader.reserve(32)
  const decode = (child, childContexts = contexts, childArgs = args) => decodeType(reader, child, types, childContexts, childArgs, depth + 1)
  if (typeof type === 'string') {
    if (['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'u64', 'i64', 'f32', 'f64', 'bool', 'varint', 'varlong'].includes(type))
      return reader[type]()
    if (type === 'void')
      return undefined
    if (type === 'restBuffer')
      return reader.take(reader.remaining, true)
    if (type === 'UUID') {
      const hex = [...reader.take(16)].map(b => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    if (type === 'nbt' || type === 'optionalNbt')
      return reader.nbt(true)
    if (type === 'anonymousNbt' || type === 'anonOptionalNbt')
      return reader.nbt(false)
    check(types[type] && types[type] !== 'native', `Unsupported protocol type ${type}`, 'UNSUPPORTED_PACKET')
    return decode(types[type])
  }
  check(Array.isArray(type), 'Invalid protocol schema')
  const [kind, spec] = type
  switch (kind) {
    case 'container': {
      const result = Object.create(null)
      for (const field of spec) {
        const value = decode(field.type, [...contexts, result])
        if (field.anon) {
          if (value && typeof value === 'object')
            Object.assign(result, value)
        }
        else {
          result[field.name] = value
        }
      }
      return result
    }
    case 'mapper': {
      const value = decode(spec.type)
      const mapped = spec.mappings[value] ?? spec.mappings[`0x${Number(value).toString(16).padStart(2, '0')}`]
      check(mapped !== undefined, `Unknown protocol enum value ${value}`, 'UNSUPPORTED_PACKET')
      return mapped
    }
    case 'switch': {
      const path = spec.compareTo.startsWith('$') ? args[spec.compareTo.slice(1)] : spec.compareTo
      const value = lookup(contexts, path)
      const selected = spec.fields[value] ?? spec.default
      // Some minecraft-data particle switches omit an explicit void default.
      if (selected === undefined && spec.compareTo === 'type' && typeof value === 'string' && types.Particle?.[1]?.[1]?.type === type)
        return undefined
      check(selected !== undefined, `Unsupported protocol switch ${path}=${value}`, 'UNSUPPORTED_PACKET')
      return decode(selected)
    }
    case 'option': return reader.bool() ? decode(spec) : null
    case 'pstring': return reader.string(decode(spec.countType))
    case 'buffer': return reader.take(reader.count(spec.countType ? decode(spec.countType) : typeof spec.count === 'number' ? spec.count : lookup(contexts, spec.count)), true)
    case 'array': {
      const n = reader.count(spec.countType ? decode(spec.countType) : typeof spec.count === 'number' ? spec.count : lookup(contexts, spec.count))
      reader.reserve(n * 8 + 24)
      return Array.from({ length: n }, () => decode(spec.type))
    }
    case 'bitfield': {
      const bits = spec.reduce((n, part) => n + part.size, 0)
      check(bits % 8 === 0 && bits <= 64, 'Invalid protocol bitfield')
      let packed = 0n
      for (let i = 0; i < bits / 8; i++) packed = (packed << 8n) | BigInt(reader.u8())
      let shift = bits
      return Object.fromEntries(spec.map((part) => {
        shift -= part.size
        const value = (packed >> BigInt(shift)) & ((1n << BigInt(part.size)) - 1n)
        return [part.name, Number(part.signed ? BigInt.asIntN(part.size, value) : value)]
      }))
    }
    case 'bitflags': {
      const value = decode(spec.type)
      return Object.fromEntries(spec.flags.map((flag, index) => [flag, !!(value & (1 << index))]))
    }
    case 'entityMetadataLoop': {
      const entries = []
      while (true) {
        reader.need(1)
        if (reader.bytes[reader.offset] === spec.endVal) {
          reader.offset++
          return entries
        }
        check(entries.length < 256, 'Too many entity metadata entries')
        entries.push(decode(spec.type))
      }
    }
    case 'topBitSetTerminatedArray': {
      const entries = []
      let more
      do {
        reader.need(1)
        more = !!(reader.bytes[reader.offset] & 128)
        reader.maskNextByte = true
        entries.push(decode(spec.type))
        check(entries.length <= 128, 'Too many equipment entries')
      } while (more)
      return entries
    }
    case 'registryEntryHolder': {
      const id = reader.varint()
      check(id >= 0, 'Invalid registry holder ID')
      return id ? { [spec.baseName]: id - 1 } : { [spec.otherwise.name]: decode(spec.otherwise.type) }
    }
    case 'registryEntryHolderSet': {
      const n = reader.varint()
      check(n >= 0, 'Invalid registry holder set length')
      if (n === 0)
        return { [spec.base.name]: decode(spec.base.type) }
      reader.count(n - 1)
      reader.reserve((n - 1) * 8 + 24)
      return { [spec.otherwise.name]: Array.from({ length: n - 1 }, () => decode(spec.otherwise.type)) }
    }
    default:
      check(types[kind] && types[kind] !== 'native', `Unsupported protocol constructor ${kind}`, 'UNSUPPORTED_PACKET')
      return decode(types[kind], contexts, spec)
  }
}
