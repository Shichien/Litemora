import {
  getMinecraftBlockDefinition,
  normalizeMinecraftBlockName,
} from './minecraft-block-data.js'

const LEGACY_BLOCK_ID_TO_ITEM_KEY = {
  1: 'grass_block',
  2: 'dirt',
  3: 'stone',
  4: 'coal_ore',
  5: 'iron_ore',
  6: 'oak_log',
  7: 'oak_leaves',
  8: 'sand',
  9: 'birch_log',
  10: 'birch_leaves',
  11: 'cherry_log',
  12: 'cherry_leaves',
  13: 'cactus',
  15: 'yellow_terracotta',
  16: 'red_sand',
  17: 'ice',
  18: 'packed_ice',
  19: 'snow_block',
  21: 'gravel',
  22: 'diorite',
  23: 'polished_diorite',
  24: 'andesite',
  25: 'polished_andesite',
  26: 'polished_blackstone',
  27: 'polished_blackstone_bricks',
  28: 'cracked_polished_blackstone_bricks',
  29: 'ochre_froglight',
  30: 'pearlescent_froglight',
  31: 'stone_slab',
  32: 'stone_stairs',
}

function toPositiveInt(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null
}

export function normalizeInventoryItemKey(rawItemKey = '') {
  const normalized = normalizeMinecraftBlockName(rawItemKey)
  if (!normalized) {
    return ''
  }

  return getMinecraftBlockDefinition(normalized) ? normalized : ''
}

export function resolveLegacyBlockIdToMinecraftItemKey(blockId) {
  const normalizedBlockId = toPositiveInt(blockId)
  if (!normalizedBlockId) {
    return ''
  }

  return normalizeInventoryItemKey(LEGACY_BLOCK_ID_TO_ITEM_KEY[normalizedBlockId] || '')
}

export function resolveInventoryItemKey(input = null) {
  if (typeof input === 'string') {
    return normalizeInventoryItemKey(input)
  }

  if (typeof input === 'number') {
    return resolveLegacyBlockIdToMinecraftItemKey(input)
  }

  if (!input || typeof input !== 'object') {
    return ''
  }

  const explicitItemKey = normalizeInventoryItemKey(
    input.itemKey
    || input.minecraftBlock?.name
    || '',
  )
  if (explicitItemKey) {
    return explicitItemKey
  }

  return resolveLegacyBlockIdToMinecraftItemKey(input.blockId)
}

export function resolvePlaceableMinecraftBlockName(input = null) {
  return resolveInventoryItemKey(input)
}

export function buildInventoryItemDescriptor(input = null, count = 1) {
  const normalizedCount = Math.max(1, Math.trunc(Number(count) || 1))
  const itemKey = resolveInventoryItemKey(input)
  const blockId = toPositiveInt(input?.blockId ?? input)

  if (!itemKey && !blockId) {
    return null
  }

  return {
    itemKey: itemKey || '',
    blockId,
    count: normalizedCount,
  }
}
