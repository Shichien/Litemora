import { normalizeMinecraftBlockName } from './minecraft-block-data.js'

const LIGHT_DIRECTIONS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

const SKYLIGHT_SPREAD_DIRECTIONS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
  [0, 1, 0],
]

const DIRECT_EMISSIVE_BLOCKS = new Set([
  'beacon',
  'end_rod',
  'fire',
  'froglight',
  'glowstone',
  'jack_o_lantern',
  'lava',
  'lantern',
  'sea_lantern',
  'shroomlight',
])

function keyOf(x, y, z) {
  return `${x},${y},${z}`
}

function parseKey(key = '') {
  const [x, y, z] = String(key || '').split(',').map(value => Number(value))
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    z: Number.isFinite(z) ? z : 0,
  }
}

function updateBounds(bounds, x, y, z) {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxY = Math.max(bounds.maxY, y)
  bounds.minZ = Math.min(bounds.minZ, z)
  bounds.maxZ = Math.max(bounds.maxZ, z)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function isWithinBounds(bounds, x, y, z) {
  return x >= bounds.minX
    && x <= bounds.maxX
    && y >= bounds.minY
    && y <= bounds.maxY
    && z >= bounds.minZ
    && z <= bounds.maxZ
}

function isBlockLightPassable(entry = null) {
  if (!entry) {
    return true
  }

  const blockName = normalizeMinecraftBlockName(entry.blockName)
  if (!blockName || blockName === 'air' || blockName === 'cave_air' || blockName === 'void_air') {
    return true
  }

  if (entry.boundingBox === 'empty' || entry.hasCollision === false) {
    return true
  }

  if (entry.properties?.open === 'true' && (blockName.includes('door') || blockName.includes('trapdoor'))) {
    return true
  }

  return blockName.includes('glass')
    || blockName.endsWith('glass_pane')
    || blockName.endsWith('leaves')
    || blockName === 'iron_bars'
    || blockName === 'chain'
    || blockName === 'vine'
    || blockName === 'ladder'
    || blockName === 'scaffolding'
    || blockName === 'water'
    || blockName === 'kelp'
    || blockName === 'seagrass'
    || blockName.includes('torch')
    || blockName.includes('candle')
    || blockName.includes('lantern')
    || blockName === 'campfire'
    || blockName === 'soul_campfire'
    || blockName === 'end_rod'
  }

function resolveEmissionLevel(entry = null) {
  if (!entry) {
    return 0
  }

  const blockName = normalizeMinecraftBlockName(entry.blockName)
  const properties = entry.properties || {}

  if (!blockName) {
    return 0
  }

  if (blockName === 'light') {
    return clamp(Number(properties.level || 15), 0, 15)
  }

  if (blockName === 'redstone_lamp') {
    return properties.lit === 'true' ? 15 : 0
  }

  if (blockName.includes('torch')) {
    return blockName.startsWith('soul_') ? 10 : 14
  }

  if (blockName.includes('lantern')) {
    return blockName.startsWith('soul_') ? 10 : 15
  }

  if (blockName.includes('candle')) {
    return properties.lit === 'true' ? 6 : 0
  }

  if (blockName === 'campfire') {
    return properties.lit === 'false' ? 0 : 15
  }

  if (blockName === 'soul_campfire') {
    return properties.lit === 'false' ? 0 : 10
  }

  if (blockName === 'magma_block') {
    return 3
  }

  if (blockName === 'respawn_anchor') {
    return clamp(Number(properties.charges || 0) * 4, 0, 15)
  }

  if (
    DIRECT_EMISSIVE_BLOCKS.has(blockName)
    || blockName.endsWith('froglight')
  ) {
    return 15
  }

  return 0
}

function enqueueLight(queue, lightMap, bounds, x, y, z, nextLight, blockEntries) {
  if (nextLight <= 0 || !isWithinBounds(bounds, x, y, z)) {
    return
  }

  const key = keyOf(x, y, z)
  if (!isBlockLightPassable(blockEntries.get(key))) {
    return
  }

  if ((lightMap.get(key) || 0) >= nextLight) {
    return
  }

  lightMap.set(key, nextLight)
  queue.push({ x, y, z, light: nextLight })
}

function propagateLight(queue, lightMap, bounds, blockEntries, directions = LIGHT_DIRECTIONS) {
  while (queue.length) {
    const current = queue.shift()
    if (!current || current.light <= 1) {
      continue
    }

    for (const [dx, dy, dz] of directions) {
      enqueueLight(
        queue,
        lightMap,
        bounds,
        current.x + dx,
        current.y + dy,
        current.z + dz,
        current.light - 1,
        blockEntries,
      )
    }
  }
}

function computeBrightness(lightLevel, exposedFaces, emissionLevel, selfLightLevel) {
  const exposureRatio = clamp(exposedFaces / 6, 0, 1)
  const ambientFloor = exposedFaces > 0 ? (2 + Math.round(exposureRatio * 3)) : 0
  const effectiveLightLevel = Math.max(lightLevel, ambientFloor)
  const normalizedLight = clamp(effectiveLightLevel / 15, 0, 1)
  const curved = Math.pow(normalizedLight, 1.35)
  const exposureBoost = exposureRatio * 0.08
  const emissiveBoost = emissionLevel > 0 ? 0.06 : 0
  const selfBoost = selfLightLevel > 0 ? 0.05 : 0
  return clamp(0.18 + (curved * 0.74) + exposureBoost + emissiveBoost + selfBoost, 0.16, 1)
}

export function buildSchematicLighting(layer) {
  const blockEntries = new Map()
  const blockBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }

  layer?.forEachBlock?.((position, entry) => {
    const x = Number(position.worldX)
    const y = Number(position.worldY)
    const z = Number(position.worldZ)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return
    }

    blockEntries.set(keyOf(x, y, z), entry || null)
    updateBounds(blockBounds, x, y, z)
  })

  if (!blockEntries.size) {
    return {
      brightnessByPosition: new Map(),
      stats: {
        blockCount: 0,
        emissiveBlockCount: 0,
        skyLitCellCount: 0,
      },
    }
  }

  const lightBounds = {
    minX: blockBounds.minX - 1,
    maxX: blockBounds.maxX + 1,
    minY: blockBounds.minY - 1,
    maxY: blockBounds.maxY + 1,
    minZ: blockBounds.minZ - 1,
    maxZ: blockBounds.maxZ + 1,
  }

  const skyLightCells = new Map()
  const skyQueue = []

  for (let x = lightBounds.minX; x <= lightBounds.maxX; x += 1) {
    for (let z = lightBounds.minZ; z <= lightBounds.maxZ; z += 1) {
      let light = 15
      for (let y = lightBounds.maxY; y >= lightBounds.minY; y -= 1) {
        const key = keyOf(x, y, z)
        const entry = blockEntries.get(key)
        if (entry && !isBlockLightPassable(entry)) {
          light = 0
          continue
        }

        if (light <= 0) {
          continue
        }

        if ((skyLightCells.get(key) || 0) < light) {
          skyLightCells.set(key, light)
          if (light > 1) {
            skyQueue.push({ x, y, z, light })
          }
        }
      }
    }
  }

  propagateLight(skyQueue, skyLightCells, lightBounds, blockEntries, SKYLIGHT_SPREAD_DIRECTIONS)

  const blockLightCells = new Map()
  const blockQueue = []
  let emissiveBlockCount = 0

  for (const [key, entry] of blockEntries.entries()) {
    const emissionLevel = resolveEmissionLevel(entry)
    if (emissionLevel <= 0) {
      continue
    }

    emissiveBlockCount += 1
    const { x, y, z } = parseKey(key)

    if (isBlockLightPassable(entry)) {
      const current = blockLightCells.get(key) || 0
      if (current < emissionLevel) {
        blockLightCells.set(key, emissionLevel)
        blockQueue.push({ x, y, z, light: emissionLevel })
      }
    }

    for (const [dx, dy, dz] of LIGHT_DIRECTIONS) {
      enqueueLight(
        blockQueue,
        blockLightCells,
        lightBounds,
        x + dx,
        y + dy,
        z + dz,
        emissionLevel - 1,
        blockEntries,
      )
    }
  }

  propagateLight(blockQueue, blockLightCells, lightBounds, blockEntries)

  const brightnessByPosition = new Map()
  let minBrightness = Number.POSITIVE_INFINITY
  let maxBrightness = Number.NEGATIVE_INFINITY

  for (const [key, entry] of blockEntries.entries()) {
    const { x, y, z } = parseKey(key)
    const emissionLevel = resolveEmissionLevel(entry)
    const selfLightLevel = Math.max(
      skyLightCells.get(key) || 0,
      blockLightCells.get(key) || 0,
    )

    let neighborLight = emissionLevel
    let exposedFaces = 0

    for (const [dx, dy, dz] of LIGHT_DIRECTIONS) {
      const neighborKey = keyOf(x + dx, y + dy, z + dz)
      neighborLight = Math.max(
        neighborLight,
        skyLightCells.get(neighborKey) || 0,
        blockLightCells.get(neighborKey) || 0,
      )

      const neighborEntry = blockEntries.get(neighborKey)
      if (!neighborEntry || isBlockLightPassable(neighborEntry)) {
        exposedFaces += 1
      }
    }

    const brightness = computeBrightness(
      Math.max(neighborLight, selfLightLevel),
      exposedFaces,
      emissionLevel,
      selfLightLevel,
    )
    brightnessByPosition.set(key, brightness)
    minBrightness = Math.min(minBrightness, brightness)
    maxBrightness = Math.max(maxBrightness, brightness)
  }

  return {
    brightnessByPosition,
    stats: {
      blockCount: blockEntries.size,
      emissiveBlockCount,
      skyLitCellCount: skyLightCells.size,
      minBrightness: Number.isFinite(minBrightness) ? Number(minBrightness.toFixed(3)) : 0,
      maxBrightness: Number.isFinite(maxBrightness) ? Number(maxBrightness.toFixed(3)) : 0,
    },
  }
}
