import { variantBoolean, variantString } from './block-state-adapter.js'

function normalizeMinecraftBlockName(blockName = '') {
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

function normalizeMinecraftBlockProperties(properties = {}) {
  const normalized = {}

  Object.keys(properties || {})
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const value = normalizePropertyValue(properties[key])
      if (value) {
        normalized[key] = value
      }
    })

  return normalized
}

function withOpenState(properties = {}, open = false) {
  return {
    ...normalizeMinecraftBlockProperties(properties),
    open: open ? 'true' : 'false',
  }
}

export function isMinecraftDoorBlockName(blockName = '') {
  return normalizeMinecraftBlockName(blockName).endsWith('_door')
}

export function isMinecraftTrapdoorBlockName(blockName = '') {
  return normalizeMinecraftBlockName(blockName).endsWith('_trapdoor')
}

export function isMinecraftFenceGateBlockName(blockName = '') {
  return normalizeMinecraftBlockName(blockName).endsWith('_fence_gate')
}

export function isMinecraftOpenableBlockName(blockName = '') {
  return isMinecraftDoorBlockName(blockName)
    || isMinecraftTrapdoorBlockName(blockName)
    || isMinecraftFenceGateBlockName(blockName)
}

export function buildMinecraftInteractableToggleUpdates({
  worldX,
  worldY,
  worldZ,
  blockName,
  properties = {},
  getBlockAt = null,
} = {}) {
  const normalizedBlockName = normalizeMinecraftBlockName(blockName)
  if (!normalizedBlockName || !isMinecraftOpenableBlockName(normalizedBlockName)) {
    return []
  }

  const normalizedProperties = normalizeMinecraftBlockProperties(properties)
  const nextOpen = !variantBoolean(normalizedProperties.open)
  const updates = [{
    x: Math.floor(worldX),
    y: Math.floor(worldY),
    z: Math.floor(worldZ),
    blockName: normalizedBlockName,
    properties: withOpenState(normalizedProperties, nextOpen),
  }]

  if (!isMinecraftDoorBlockName(normalizedBlockName) || typeof getBlockAt !== 'function') {
    return updates
  }

  const half = variantString(normalizedProperties.half) === 'upper' ? 'upper' : 'lower'
  const counterpartY = Math.floor(worldY) + (half === 'upper' ? -1 : 1)
  const counterpart = getBlockAt(Math.floor(worldX), counterpartY, Math.floor(worldZ))
  const counterpartName = normalizeMinecraftBlockName(counterpart?.blockName)

  if (counterpartName !== normalizedBlockName) {
    return updates
  }

  updates.push({
    x: Math.floor(worldX),
    y: counterpartY,
    z: Math.floor(worldZ),
    blockName: normalizedBlockName,
    properties: withOpenState(counterpart?.properties || {}, nextOpen),
  })

  return updates
}
