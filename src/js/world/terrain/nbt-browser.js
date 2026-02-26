/* eslint-disable node/prefer-global/buffer */
import { Buffer as BufferPolyfill } from 'buffer'

const TAG_TYPE = {
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12,
}

const TAG_NAME = {
  [TAG_TYPE.END]: 'end',
  [TAG_TYPE.BYTE]: 'byte',
  [TAG_TYPE.SHORT]: 'short',
  [TAG_TYPE.INT]: 'int',
  [TAG_TYPE.LONG]: 'long',
  [TAG_TYPE.FLOAT]: 'float',
  [TAG_TYPE.DOUBLE]: 'double',
  [TAG_TYPE.BYTE_ARRAY]: 'byteArray',
  [TAG_TYPE.STRING]: 'string',
  [TAG_TYPE.LIST]: 'list',
  [TAG_TYPE.COMPOUND]: 'compound',
  [TAG_TYPE.INT_ARRAY]: 'intArray',
  [TAG_TYPE.LONG_ARRAY]: 'longArray',
}

class NbtReader {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  ensure(size) {
    if (this.offset + size > this.buffer.length) {
      throw new Error('Unexpected EOF while reading NBT')
    }
  }

  readUInt8() {
    this.ensure(1)
    const value = this.buffer.readUInt8(this.offset)
    this.offset += 1
    return value
  }

  readInt8() {
    this.ensure(1)
    const value = this.buffer.readInt8(this.offset)
    this.offset += 1
    return value
  }

  readInt16() {
    this.ensure(2)
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readUInt16() {
    this.ensure(2)
    const value = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readInt32() {
    this.ensure(4)
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  readFloat() {
    this.ensure(4)
    const value = this.buffer.readFloatBE(this.offset)
    this.offset += 4
    return value
  }

  readDouble() {
    this.ensure(8)
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  readBigInt64() {
    this.ensure(8)

    if (typeof this.buffer.readBigInt64BE === 'function') {
      const value = this.buffer.readBigInt64BE(this.offset)
      this.offset += 8
      return value
    }

    const high = this.buffer.readInt32BE(this.offset)
    const low = this.buffer.readUInt32BE(this.offset + 4)
    this.offset += 8
    return BigInt(high) * 4294967296n + BigInt(low)
  }

  readString() {
    const length = this.readUInt16()
    this.ensure(length)
    const value = this.buffer.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return value
  }

  readTagPayload(tagType) {
    switch (tagType) {
      case TAG_TYPE.BYTE:
        return this.readInt8()
      case TAG_TYPE.SHORT:
        return this.readInt16()
      case TAG_TYPE.INT:
        return this.readInt32()
      case TAG_TYPE.LONG:
        return this.readBigInt64()
      case TAG_TYPE.FLOAT:
        return this.readFloat()
      case TAG_TYPE.DOUBLE:
        return this.readDouble()
      case TAG_TYPE.BYTE_ARRAY: {
        const length = this.readInt32()
        if (length < 0) {
          throw new Error('Invalid TAG_Byte_Array length')
        }
        this.ensure(length)
        const bytes = new Uint8Array(length)
        for (let i = 0; i < length; i++) {
          bytes[i] = this.buffer.readUInt8(this.offset + i)
        }
        this.offset += length
        return bytes
      }
      case TAG_TYPE.STRING:
        return this.readString()
      case TAG_TYPE.LIST: {
        const listType = this.readUInt8()
        const length = this.readInt32()
        if (length < 0) {
          throw new Error('Invalid TAG_List length')
        }
        const values = new Array(length)
        for (let i = 0; i < length; i++) {
          values[i] = this.readTagPayload(listType)
        }
        return {
          type: TAG_NAME[listType] || 'unknown',
          value: values,
        }
      }
      case TAG_TYPE.COMPOUND: {
        const result = {}
        while (true) {
          const childType = this.readUInt8()
          if (childType === TAG_TYPE.END) {
            break
          }
          const childName = this.readString()
          const childPayload = this.readTagPayload(childType)
          result[childName] = {
            type: TAG_NAME[childType] || 'unknown',
            value: childPayload,
          }
        }
        return result
      }
      case TAG_TYPE.INT_ARRAY: {
        const length = this.readInt32()
        if (length < 0) {
          throw new Error('Invalid TAG_Int_Array length')
        }
        const values = new Array(length)
        for (let i = 0; i < length; i++) {
          values[i] = this.readInt32()
        }
        return values
      }
      case TAG_TYPE.LONG_ARRAY: {
        const length = this.readInt32()
        if (length < 0) {
          throw new Error('Invalid TAG_Long_Array length')
        }
        const values = new Array(length)
        for (let i = 0; i < length; i++) {
          values[i] = this.readBigInt64()
        }
        return values
      }
      default:
        throw new Error(`Unsupported NBT tag type: ${tagType}`)
    }
  }

  readRootTag() {
    const rootType = this.readUInt8()
    if (rootType === TAG_TYPE.END) {
      throw new Error('Invalid root TAG_End')
    }

    const rootName = this.readString()
    const rootPayload = this.readTagPayload(rootType)

    return {
      name: rootName,
      type: TAG_NAME[rootType] || 'unknown',
      value: rootPayload,
    }
  }
}

export async function parseNbt(data) {
  const buffer = data instanceof ArrayBuffer ? BufferPolyfill.from(data) : data
  if (!(buffer instanceof BufferPolyfill)) {
    throw new Error('Invalid argument: `data` must be a Buffer or ArrayBuffer object')
  }

  const reader = new NbtReader(buffer)
  const root = reader.readRootTag()

  return {
    parsed: root,
    type: 'big',
    metadata: {
      size: reader.offset,
    },
  }
}

export function simplifyNbt(data) {
  function transform(value, type) {
    if (type === 'compound') {
      return Object.keys(value).reduce((acc, key) => {
        acc[key] = simplifyNbt(value[key])
        return acc
      }, {})
    }

    if (type === 'list') {
      return value.value.map(v => transform(v, value.type))
    }

    return value
  }

  return transform(data.value, data.type)
}
