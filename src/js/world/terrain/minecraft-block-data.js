import blockCollisionShapes from 'minecraft-data/minecraft-data/data/pc/1.21.4/blockCollisionShapes.json'
import blockDefinitions from 'minecraft-data/minecraft-data/data/pc/1.21.4/blocks.json'

const blocksByName = new Map(blockDefinitions.map(block => [block.name, block]))
const defaultStateValueCache = new Map()
const collisionProfileCache = new Map()
const CLIMBABLE_BLOCK_NAMES = new Set([
  'ladder',
  'scaffolding',
  'vine',
  'twisting_vines',
  'twisting_vines_plant',
  'weeping_vines',
  'weeping_vines_plant',
  'cave_vines',
  'cave_vines_plant',
])

export function normalizeMinecraftBlockName(blockName = '') {
  return String(blockName || '')
    .trim()
    .replace(/^minecraft:/u, '')
}

function normalizePropertyValue(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

export function normalizeMinecraftBlockProperties(properties = {}) {
  const normalized = {}

  Object.keys(properties || {})
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const normalizedValue = normalizePropertyValue(properties[key])
      if (normalizedValue) {
        normalized[key] = normalizedValue
      }
    })

  return normalized
}

export function isMinecraftBlockClimbable(blockName = '', properties = {}) {
  const normalizedBlockName = normalizeMinecraftBlockName(blockName)
  if (!normalizedBlockName) {
    return false
  }

  if (CLIMBABLE_BLOCK_NAMES.has(normalizedBlockName)) {
    return true
  }

  if (normalizedBlockName.endsWith('_vines') || normalizedBlockName.endsWith('_vines_plant')) {
    return true
  }

  if (normalizedBlockName.endsWith('_trapdoor')) {
    const normalizedProperties = normalizeMinecraftBlockProperties(properties)
    return normalizedProperties.open === 'true' && normalizedProperties.half === 'top'
  }

  return false
}

function buildVariantKey(properties = {}) {
  return Object.entries(normalizeMinecraftBlockProperties(properties))
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

function stateValueFromIndex(state = {}, index = 0) {
  if (state.type === 'bool') {
    return index === 0 ? 'true' : 'false'
  }

  if (Array.isArray(state.values) && state.values[index] !== undefined) {
    return String(state.values[index])
  }

  return String(index)
}

function stateValueIndexFromNormalized(state = {}, normalizedValue = '') {
  if (state.type === 'bool') {
    return normalizedValue === 'true' ? 0 : normalizedValue === 'false' ? 1 : -1
  }

  if (Array.isArray(state.values)) {
    return state.values.indexOf(normalizedValue)
  }

  const numeric = Number(normalizedValue)
  if (!Number.isFinite(numeric)) {
    return -1
  }

  const valueIndex = Math.floor(numeric)
  if (valueIndex < 0 || valueIndex >= Number(state.num_values || 0)) {
    return -1
  }

  return valueIndex
}

function getDefaultStateValues(block = null) {
  const cacheKey = block?.name || ''
  if (!cacheKey) {
    return {}
  }

  if (defaultStateValueCache.has(cacheKey)) {
    return defaultStateValueCache.get(cacheKey)
  }

  const values = {}
  const states = Array.isArray(block?.states) ? block.states : []
  let offset = Math.max(0, Number(block?.defaultState || 0) - Number(block?.minStateId || 0))

  for (let index = states.length - 1; index >= 0; index--) {
    const state = states[index]
    const radix = Math.max(1, Number(state?.num_values || 1))
    const valueIndex = offset % radix
    offset = Math.floor(offset / radix)
    values[state.name] = stateValueFromIndex(state, valueIndex)
  }

  defaultStateValueCache.set(cacheKey, values)
  return values
}

function resolveStateValueIndex(state = {}, rawValue, fallbackValue = '') {
  const resolved = stateValueIndexFromNormalized(state, normalizePropertyValue(rawValue))
  if (resolved >= 0) {
    return resolved
  }

  const fallbackIndex = stateValueIndexFromNormalized(state, normalizePropertyValue(fallbackValue))
  if (fallbackIndex >= 0) {
    return fallbackIndex
  }

  return 0
}

function resolveStateId(block = null, properties = {}) {
  if (!block) {
    return null
  }

  const states = Array.isArray(block.states) ? block.states : []
  if (!states.length) {
    return Number(block.defaultState || block.minStateId || 0)
  }

  const normalizedProperties = normalizeMinecraftBlockProperties(properties)
  const defaultStateValues = getDefaultStateValues(block)

  let offset = 0
  for (const state of states) {
    const valueIndex = resolveStateValueIndex(
      state,
      normalizedProperties[state.name],
      defaultStateValues[state.name],
    )
    offset = (offset * Math.max(1, Number(state.num_values || 1))) + valueIndex
  }

  return Number(block.minStateId || 0) + offset
}

function cloneCollisionBoxes(boxes = null) {
  if (!Array.isArray(boxes)) {
    return boxes
  }
  return boxes.map(box => Array.isArray(box) ? box.map(value => Number(value)) : box)
}

function getFallbackCollisionBoxes(block = null) {
  if (!block) {
    return null
  }

  if (block.boundingBox === 'empty') {
    return []
  }

  return [[0, 0, 0, 1, 1, 1]]
}

export function getMinecraftBlockDefinition(blockName = '') {
  return blocksByName.get(normalizeMinecraftBlockName(blockName)) || null
}

export function getMinecraftBlockCollisionProfile(blockName = '', properties = {}) {
  const normalizedBlockName = normalizeMinecraftBlockName(blockName)
  const normalizedProperties = normalizeMinecraftBlockProperties(properties)
  const cacheKey = `${normalizedBlockName}::${buildVariantKey(normalizedProperties)}`

  if (collisionProfileCache.has(cacheKey)) {
    return collisionProfileCache.get(cacheKey)
  }

  if (!normalizedBlockName || normalizedBlockName === 'air' || normalizedBlockName === 'cave_air' || normalizedBlockName === 'void_air') {
    const emptyProfile = {
      blockName: normalizedBlockName || 'air',
      properties: normalizedProperties,
      stateId: 0,
      collisionBoxes: [],
      collisionSource: 'minecraft',
      boundingBox: 'empty',
      hasCollision: false,
      isKnownBlock: true,
      isClimbable: false,
    }
    collisionProfileCache.set(cacheKey, emptyProfile)
    return emptyProfile
  }

  const block = getMinecraftBlockDefinition(normalizedBlockName)
  if (!block) {
    const fallbackProfile = {
      blockName: normalizedBlockName,
      properties: normalizedProperties,
      stateId: null,
      collisionBoxes: null,
      collisionSource: 'fallback',
      boundingBox: null,
      hasCollision: null,
      isKnownBlock: false,
      isClimbable: isMinecraftBlockClimbable(normalizedBlockName, normalizedProperties),
    }
    collisionProfileCache.set(cacheKey, fallbackProfile)
    return fallbackProfile
  }

  const stateId = resolveStateId(block, normalizedProperties)
  const collisionShapeRef = blockCollisionShapes?.blocks?.[normalizedBlockName]

  let collisionBoxes = null
  let collisionSource = 'fallback'

  if (collisionShapeRef !== undefined) {
    const shapeId = Array.isArray(collisionShapeRef)
      ? collisionShapeRef[Math.max(0, Math.min(collisionShapeRef.length - 1, Number(stateId || 0) - Number(block.minStateId || 0)))]
      : collisionShapeRef

    collisionBoxes = cloneCollisionBoxes(blockCollisionShapes?.shapes?.[shapeId])
    if (!Array.isArray(collisionBoxes)) {
      collisionBoxes = getFallbackCollisionBoxes(block)
      collisionSource = 'fallback'
    }
    else {
      collisionSource = 'minecraft'
    }
  }
  else {
    collisionBoxes = getFallbackCollisionBoxes(block)
  }

  const profile = {
    blockName: normalizedBlockName,
    properties: normalizedProperties,
    stateId,
    collisionBoxes,
    collisionSource,
    boundingBox: block.boundingBox || 'block',
    hasCollision: Array.isArray(collisionBoxes) ? collisionBoxes.length > 0 : null,
    isKnownBlock: true,
    isClimbable: isMinecraftBlockClimbable(normalizedBlockName, normalizedProperties),
  }

  collisionProfileCache.set(cacheKey, profile)
  return profile
}
