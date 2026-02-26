export function variantString(value) {
  if (value === undefined || value === null) {
    return ''
  }
  const raw = typeof value === 'string'
    ? value
    : (typeof value === 'object' && 'value' in value ? value.value : String(value))
  return String(raw).toLowerCase()
}

export function variantBoolean(value) {
  const normalized = variantString(value)
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

export function normalizeFacing(value, fallback = 'north') {
  const facing = variantString(value)
  if (['north', 'south', 'east', 'west'].includes(facing)) {
    return facing
  }
  return fallback
}

export function normalizeStairShape(value) {
  const shape = variantString(value)
  if (['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'].includes(shape)) {
    return shape
  }
  return 'straight'
}

export function normalizeWallSide(value) {
  const normalized = variantString(value)
  if (normalized === 'tall') {
    return 2
  }
  if (normalized === 'low' || normalized === 'true' || normalized === '1') {
    return 1
  }
  return 0
}

export function slabGeometryTypeFromProperties(properties = {}) {
  const slabType = variantString(properties?.type || properties?.slab_type || properties?.half)
  if (slabType === 'double') {
    return 'cube'
  }
  return slabType === 'top' ? 'slab_top' : 'slab_bottom'
}

export function stairGeometryTypeFromProperties(properties = {}) {
  const facing = normalizeFacing(properties?.facing)
  const half = variantString(properties?.half) === 'top' ? 'top' : 'bottom'
  const shape = normalizeStairShape(properties?.shape)
  return `stair_${half}_${facing}_${shape}`
}

export function trapdoorGeometryTypeFromProperties(properties = {}) {
  const facing = normalizeFacing(properties?.facing)
  const half = variantString(properties?.half) === 'top' ? 'top' : 'bottom'
  const open = variantBoolean(properties?.open)
  return `trapdoor_${half}_${open ? 'open' : 'closed'}_${facing}`
}

export function barsGeometryTypeFromProperties(properties = {}) {
  const north = variantBoolean(properties?.north)
  const east = variantBoolean(properties?.east)
  const south = variantBoolean(properties?.south)
  const west = variantBoolean(properties?.west)
  return `bars_${north ? 1 : 0}${east ? 1 : 0}${south ? 1 : 0}${west ? 1 : 0}`
}

export function wallGeometryTypeFromProperties(properties = {}) {
  const up = variantBoolean(properties?.up)
  const north = normalizeWallSide(properties?.north)
  const east = normalizeWallSide(properties?.east)
  const south = normalizeWallSide(properties?.south)
  const west = normalizeWallSide(properties?.west)
  return `wall_${up ? 1 : 0}_${north}${east}${south}${west}`
}

export function fenceGeometryTypeFromProperties(properties = {}) {
  const north = variantBoolean(properties?.north)
  const east = variantBoolean(properties?.east)
  const south = variantBoolean(properties?.south)
  const west = variantBoolean(properties?.west)
  return `fence_${north ? 1 : 0}${east ? 1 : 0}${south ? 1 : 0}${west ? 1 : 0}`
}

export function buildVariantKey(properties = {}) {
  const type = variantString(properties?.type || properties?.slab_type)
  const half = variantString(properties?.half)
  const facing = normalizeFacing(properties?.facing)
  const shape = variantString(properties?.shape)
  const open = variantBoolean(properties?.open) ? '1' : '0'
  const up = variantBoolean(properties?.up) ? '1' : '0'
  const north = normalizeWallSide(properties?.north)
  const east = normalizeWallSide(properties?.east)
  const south = normalizeWallSide(properties?.south)
  const west = normalizeWallSide(properties?.west)
  return `type=${type}|half=${half}|facing=${facing}|shape=${shape}|open=${open}|up=${up}|n=${north}|e=${east}|s=${south}|w=${west}`
}
