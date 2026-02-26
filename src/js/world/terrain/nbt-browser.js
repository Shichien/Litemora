/* eslint-disable node/prefer-global/buffer */
import { Buffer as BufferPolyfill } from 'buffer'
import ProtoDef from 'protodef/src/protodef.js'
import compoundTypesCjs from 'prismarine-nbt/compound.js'
import nbtSchema from 'prismarine-nbt/nbt.json'
import optionalTypesCjs from 'prismarine-nbt/optional.js'

function normalizeCjs(module) {
  return module?.default || module
}

let proto = null

function getProto() {
  if (proto) {
    return proto
  }

  const instance = new ProtoDef(false)
  const compoundTypes = normalizeCjs(compoundTypesCjs)
  const optionalTypes = normalizeCjs(optionalTypesCjs)

  instance.addTypes(compoundTypes)
  instance.addTypes(optionalTypes.interpret)
  instance.addTypes(nbtSchema)
  instance.types.nbtTagName = instance.types.shortString

  proto = instance
  return proto
}

export async function parseNbt(data) {
  const buffer = data instanceof ArrayBuffer ? BufferPolyfill.from(data) : data
  if (!(buffer instanceof BufferPolyfill)) {
    throw new Error('Invalid argument: `data` must be a Buffer or ArrayBuffer object')
  }

  buffer.startOffset = buffer.startOffset || 0
  const parser = getProto()
  const parsed = parser.parsePacketBuffer('nbt', buffer, buffer.startOffset)
  return {
    parsed: parsed.data,
    type: 'big',
    metadata: parsed.metadata,
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
