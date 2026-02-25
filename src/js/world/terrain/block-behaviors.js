function normalizeName(name) {
  if (!name) {
    return ''
  }
  return String(name).replace(/^minecraft:/u, '')
}

function geometryTypeOf(blockType) {
  return String(blockType?.geometryType || '')
}

export function isSlabBlockName(name) {
  return normalizeName(name).endsWith('_slab')
}

export function isStairBlockName(name) {
  return normalizeName(name).endsWith('_stairs')
}

export function isTrapdoorBlockName(name) {
  return normalizeName(name).endsWith('_trapdoor')
}

export function isIronBarsBlockName(name) {
  return normalizeName(name) === 'iron_bars'
}

export function isWallBlockName(name) {
  return normalizeName(name).endsWith('_wall')
}

export function isLanternBlockName(name) {
  const normalized = normalizeName(name)
  return normalized === 'lantern' || normalized === 'soul_lantern'
}

export function isSlabBlockType(blockType) {
  const geometryType = geometryTypeOf(blockType)
  return geometryType.startsWith('slab_') || isSlabBlockName(blockType?.name)
}

export function isStairBlockType(blockType) {
  const geometryType = geometryTypeOf(blockType)
  return geometryType.startsWith('stair_') || isStairBlockName(blockType?.name)
}

export function isTrapdoorBlockType(blockType) {
  const geometryType = geometryTypeOf(blockType)
  return geometryType.startsWith('trapdoor_') || isTrapdoorBlockName(blockType?.name)
}

export function isIronBarsBlockType(blockType) {
  const geometryType = geometryTypeOf(blockType)
  return geometryType.startsWith('bars_') || isIronBarsBlockName(blockType?.name)
}

export function isWallBlockType(blockType) {
  const geometryType = geometryTypeOf(blockType)
  return geometryType.startsWith('wall_') || isWallBlockName(blockType?.name)
}

export function getBlockBehavior(blockType) {
  return {
    slab: isSlabBlockType(blockType),
    stair: isStairBlockType(blockType),
    trapdoor: isTrapdoorBlockType(blockType),
    bars: isIronBarsBlockType(blockType),
    wall: isWallBlockType(blockType),
  }
}
