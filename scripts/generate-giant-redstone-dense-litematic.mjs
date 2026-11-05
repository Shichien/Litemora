import { Buffer as BufferPolyfill } from 'node:buffer'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import pako from 'pako'
import { writeUncompressed } from 'prismarine-nbt'

const require = createRequire(import.meta.url)
const minecraftData = require('minecraft-data')

const ROOT = process.cwd()
const OUTPUT_DIR = path.join(ROOT, 'litematic')
const PUBLIC_OUTPUT_DIR = path.join(ROOT, 'public', 'litematic')

const REQUIRED_BLOCK_NAMES = [
  'smooth_stone',
  'polished_andesite',
  'deepslate_bricks',
  'deepslate_tiles',
  'iron_block',
  'obsidian',
  'redstone_block',
  'slime_block',
  'honey_block',
  'target',
  'note_block',
  'redstone_wire',
  'repeater',
  'comparator',
  'observer',
  'piston',
  'sticky_piston',
  'piston_head',
  'redstone_lamp',
  'redstone_torch',
  'redstone_wall_torch',
  'hopper',
  'dispenser',
  'dropper',
  'glass_pane',
  'iron_bars',
  'cobblestone_wall',
  'oak_fence',
  'oak_trapdoor',
  'smooth_stone_slab',
  'scaffolding',
]

function parseCliArg(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] || null
}

function parseCliNumber(name, fallbackValue) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallbackValue
  }

  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallbackValue
}

function resolveDefaultMcVersion() {
  const latestStable = (minecraftData.versions.pc || [])
    .find(entry => /^\d+\.\d+(?:\.\d+)?$/u.test(String(entry?.minecraftVersion || '')))

  return latestStable?.minecraftVersion || '1.21.4'
}

const TARGET_MC_VERSION = parseCliArg('--mc-version') || resolveDefaultMcVersion()
const TARGET_VERSION_INFO = minecraftData.versionsByMinecraftVersion.pc?.[TARGET_MC_VERSION]
if (!TARGET_VERSION_INFO) {
  throw new Error(`Unknown or unsupported Minecraft version: ${TARGET_MC_VERSION}`)
}

const OUTPUT_BASENAME = String(parseCliArg('--output-base') || 'giant-redstone-dense-world').trim() || 'giant-redstone-dense-world'
const OUTPUT_NAME = `${OUTPUT_BASENAME}.litematic`
const OUTPUT_LITEMATIC = path.join(OUTPUT_DIR, OUTPUT_NAME)
const PUBLIC_OUTPUT_LITEMATIC = path.join(PUBLIC_OUTPUT_DIR, OUTPUT_NAME)
const OUTPUT_STATS = path.join(OUTPUT_DIR, `${OUTPUT_BASENAME}.json`)

const DEFAULT_REGION_SIZE = {
  x: 128,
  y: 48,
  z: 128,
}

const REGION_SIZE = {
  x: parseCliNumber('--size-x', DEFAULT_REGION_SIZE.x),
  y: parseCliNumber('--size-y', DEFAULT_REGION_SIZE.y),
  z: parseCliNumber('--size-z', DEFAULT_REGION_SIZE.z),
}

const MODULE_SIZE = 8
const DECK_HEIGHT = 6
const CORRIDOR_HALF_WIDTH = 5
const CORE_SHAFT_HALF_WIDTH = 2
const CENTER_X = Math.floor(REGION_SIZE.x / 2)
const CENTER_Z = Math.floor(REGION_SIZE.z / 2)
const DECK_COUNT = Math.floor(REGION_SIZE.y / DECK_HEIGHT)

if (REGION_SIZE.x % MODULE_SIZE !== 0 || REGION_SIZE.z % MODULE_SIZE !== 0 || REGION_SIZE.y % DECK_HEIGHT !== 0) {
  throw new Error(`Region size must align to module/deck grid: x,z multiples of ${MODULE_SIZE}; y multiple of ${DECK_HEIGHT}`)
}

const mc = minecraftData(TARGET_MC_VERSION)
const KNOWN_BLOCKS = new Set(Object.keys(mc.blocksByName || {}))
for (const blockName of REQUIRED_BLOCK_NAMES) {
  if (!KNOWN_BLOCKS.has(blockName)) {
    throw new Error(`Minecraft ${TARGET_MC_VERSION} is missing required block: ${blockName}`)
  }
}

const NOTE_INSTRUMENTS = (
  mc.blocksByName?.note_block?.states?.find(state => state.name === 'instrument')?.values
  || ['harp', 'basedrum', 'snare', 'hat', 'bass', 'flute', 'bell', 'guitar']
)

function nbtString(value) {
  return { type: 'string', value }
}

function nbtInt(value) {
  return { type: 'int', value }
}

function nbtLong(value) {
  return { type: 'long', value: BigInt(value) }
}

function nbtCompound(value) {
  return { type: 'compound', value }
}

function nbtList(type, value = []) {
  return { type: 'list', value: { type, value } }
}

function mixHash(...values) {
  let hash = 0
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.trunc(Number(values[index]) || 0)
    hash ^= Math.imul(value + ((index + 1) * 17), [73_856_093, 19_349_663, 83_492_791, 26_544_357][index % 4])
  }
  return hash >>> 0
}

function pick(values, seed) {
  return values[seed % values.length]
}

function boolString(value) {
  return value ? 'true' : 'false'
}

function createBlockState(name, properties = null) {
  const normalizedName = String(name || 'minecraft:air').trim()
  const normalizedProperties = properties && typeof properties === 'object'
    ? Object.fromEntries(
      Object.entries(properties)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [String(key), String(value)]),
    )
    : null

  return {
    name: normalizedName.startsWith('minecraft:') ? normalizedName : `minecraft:${normalizedName}`,
    properties: normalizedProperties && Object.keys(normalizedProperties).length
      ? normalizedProperties
      : null,
  }
}

function serializeBlockState(state) {
  const properties = state?.properties && typeof state.properties === 'object'
    ? Object.entries(state.properties).sort(([left], [right]) => left.localeCompare(right))
    : []

  if (!properties.length) {
    return state.name
  }

  return `${state.name}[${properties.map(([key, value]) => `${key}=${value}`).join(',')}]`
}

function buildPaletteEntry(state) {
  const entry = {
    Name: nbtString(state.name),
  }

  if (state.properties && Object.keys(state.properties).length) {
    entry.Properties = nbtCompound(
      Object.fromEntries(
        Object.entries(state.properties).map(([key, value]) => [key, nbtString(value)]),
      ),
    )
  }

  return entry
}

function createPaletteRegistry() {
  const states = [createBlockState('minecraft:air')]
  const lookup = new Map([[serializeBlockState(states[0]), 0]])

  return {
    states,
    resolve(name, properties = null) {
      const normalizedBlockName = String(name || '')
        .trim()
        .replace(/^minecraft:/u, '')
      if (!normalizedBlockName || !KNOWN_BLOCKS.has(normalizedBlockName)) {
        throw new Error(`Unknown block state requested: ${name}`)
      }

      const state = createBlockState(`minecraft:${normalizedBlockName}`, properties)
      const key = serializeBlockState(state)
      let paletteIndex = lookup.get(key)
      if (paletteIndex !== undefined) {
        return paletteIndex
      }

      paletteIndex = states.length
      if (paletteIndex > 65_535) {
        throw new Error('Palette exhausted Uint16 capacity')
      }

      states.push(state)
      lookup.set(key, paletteIndex)
      return paletteIndex
    },
  }
}

function encodeBlockIndices(indices, paletteSize) {
  const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(Math.max(1, paletteSize))))
  const totalBits = indices.length * bitsPerBlock
  const longCount = Math.ceil(totalBits / 64)
  const longs = Array.from({ length: longCount }, () => 0n)
  const valueMask = (1n << BigInt(bitsPerBlock)) - 1n

  for (let blockIndex = 0; blockIndex < indices.length; blockIndex += 1) {
    const value = BigInt(indices[blockIndex]) & valueMask
    const startBit = blockIndex * bitsPerBlock
    const longIndex = Math.floor(startBit / 64)
    const bitOffset = startBit % 64

    longs[longIndex] |= value << BigInt(bitOffset)

    const spillBits = bitOffset + bitsPerBlock - 64
    if (spillBits > 0 && longIndex + 1 < longs.length) {
      const spillMask = (1n << BigInt(spillBits)) - 1n
      const spillValue = (value >> BigInt(bitsPerBlock - spillBits)) & spillMask
      longs[longIndex + 1] |= spillValue
    }
  }

  return longs.map(value => BigInt.asIntN(64, value))
}

function getIndex(x, y, z) {
  return x + (z * REGION_SIZE.x) + (y * REGION_SIZE.x * REGION_SIZE.z)
}

function setBlock(indices, x, y, z, paletteIndex, stats) {
  if (
    x < 0 || x >= REGION_SIZE.x
    || y < 0 || y >= REGION_SIZE.y
    || z < 0 || z >= REGION_SIZE.z
  ) {
    return
  }

  const index = getIndex(x, y, z)
  if (indices[index] === 0 && paletteIndex !== 0) {
    stats.blockCount += 1
  }
  if (indices[index] !== 0 && paletteIndex === 0) {
    stats.blockCount -= 1
  }
  indices[index] = paletteIndex
}

function resolveSupportIndex(registry, seed) {
  return registry.resolve(
    pick(
      ['smooth_stone', 'polished_andesite', 'deepslate_bricks', 'deepslate_tiles', 'iron_block'],
      seed,
    ),
  )
}

function resolveCoreBlockIndex(registry, seed) {
  const variant = seed % 5
  if (variant === 0) {
    return registry.resolve('redstone_block')
  }
  if (variant === 1) {
    return registry.resolve('slime_block')
  }
  if (variant === 2) {
    return registry.resolve('honey_block')
  }
  if (variant === 3) {
    return registry.resolve('target', {
      power: String(seed % 16),
    })
  }

  return registry.resolve('note_block', {
    instrument: pick(NOTE_INSTRUMENTS, seed),
    note: String(seed % 25),
    powered: boolString((seed & 1) === 0),
  })
}

function resolveWireIndex(registry, localX, localZ, deck, seed) {
  return registry.resolve('redstone_wire', {
    north: localZ === 2 ? pick(['side', 'up'], seed) : 'side',
    east: localX === 5 ? pick(['side', 'up'], seed >>> 1) : 'side',
    south: localZ === 5 ? pick(['side', 'up'], seed >>> 2) : 'side',
    west: localX === 2 ? pick(['side', 'up'], seed >>> 3) : 'side',
    power: String((seed + deck + (localX * 3) + (localZ * 5)) % 16),
  })
}

function resolveRepeaterIndex(registry, facing, seed) {
  return registry.resolve('repeater', {
    delay: String((seed % 4) + 1),
    facing,
    locked: boolString((seed & 1) === 0),
    powered: boolString((seed & 2) === 0),
  })
}

function resolveComparatorIndex(registry, facing, seed) {
  return registry.resolve('comparator', {
    facing,
    mode: (seed & 1) === 0 ? 'compare' : 'subtract',
    powered: boolString((seed & 2) === 0),
  })
}

function resolveObserverIndex(registry, facing, seed) {
  return registry.resolve('observer', {
    facing,
    powered: boolString((seed & 1) === 0),
  })
}

function resolvePistonIndex(registry, blockName, facing, seed) {
  return registry.resolve(blockName, {
    facing,
    extended: boolString((seed & 1) === 0),
  })
}

function resolvePistonHeadIndex(registry, facing, seed) {
  return registry.resolve('piston_head', {
    facing,
    short: boolString((seed & 1) === 0),
    type: (seed & 2) === 0 ? 'normal' : 'sticky',
  })
}

function resolveHopperIndex(registry, facing, seed) {
  return registry.resolve('hopper', {
    enabled: boolString((seed & 1) === 0),
    facing,
  })
}

function resolveDropperLikeIndex(registry, blockName, facing, seed) {
  return registry.resolve(blockName, {
    facing,
    triggered: boolString((seed & 1) === 0),
  })
}

function resolvePaneIndex(registry, blockName, connections) {
  return registry.resolve(blockName, {
    north: boolString(!!connections.north),
    east: boolString(!!connections.east),
    south: boolString(!!connections.south),
    west: boolString(!!connections.west),
  })
}

function resolveFenceIndex(registry, connections) {
  return registry.resolve('oak_fence', {
    north: boolString(!!connections.north),
    east: boolString(!!connections.east),
    south: boolString(!!connections.south),
    west: boolString(!!connections.west),
  })
}

function resolveWallIndex(registry, connections, seed) {
  return registry.resolve('cobblestone_wall', {
    north: connections.north ? pick(['low', 'tall'], seed) : 'none',
    east: connections.east ? pick(['low', 'tall'], seed >>> 1) : 'none',
    south: connections.south ? pick(['low', 'tall'], seed >>> 2) : 'none',
    west: connections.west ? pick(['low', 'tall'], seed >>> 3) : 'none',
    up: boolString((seed & 1) === 0),
  })
}

function resolveTrapdoorIndex(registry, facing, seed) {
  return registry.resolve('oak_trapdoor', {
    facing,
    half: (seed & 1) === 0 ? 'top' : 'bottom',
    open: boolString((seed & 2) === 0),
    powered: boolString((seed & 4) === 0),
  })
}

function resolveLampIndex(registry, seed) {
  return registry.resolve('redstone_lamp', {
    lit: boolString((seed & 1) === 0),
  })
}

function resolveWallTorchIndex(registry, facing, seed) {
  return registry.resolve('redstone_wall_torch', {
    facing,
    lit: boolString((seed & 1) === 0),
  })
}

function resolveFloorTorchIndex(registry, seed) {
  return registry.resolve('redstone_torch', {
    lit: boolString((seed & 1) === 0),
  })
}

function resolveSlabIndex(registry, seed) {
  return registry.resolve('smooth_stone_slab', {
    type: pick(['top', 'bottom', 'double'], seed),
  })
}

function resolveScaffoldingIndex(registry, seed, isBottom = false) {
  return registry.resolve('scaffolding', {
    bottom: boolString(isBottom),
    distance: String(seed % 8),
  })
}

function getEdgeConnections(localX, localZ) {
  return {
    north: localZ > 1,
    east: localX < MODULE_SIZE - 2,
    south: localZ < MODULE_SIZE - 2,
    west: localX > 1,
  }
}

function buildDenseMachineVolume(registry) {
  const indices = new Uint16Array(REGION_SIZE.x * REGION_SIZE.y * REGION_SIZE.z)
  const stats = {
    blockCount: 0,
    moduleCount: 0,
    carvedCells: 0,
    corridorDecks: DECK_COUNT,
  }

  for (let deck = 0; deck < DECK_COUNT; deck += 1) {
    const baseY = deck * DECK_HEIGHT

    for (let moduleZ = 0; moduleZ < REGION_SIZE.z / MODULE_SIZE; moduleZ += 1) {
      for (let moduleX = 0; moduleX < REGION_SIZE.x / MODULE_SIZE; moduleX += 1) {
        stats.moduleCount += 1
        const moduleSeed = mixHash(moduleX, moduleZ, deck)

        for (let localZ = 0; localZ < MODULE_SIZE; localZ += 1) {
          for (let localX = 0; localX < MODULE_SIZE; localX += 1) {
            const worldX = (moduleX * MODULE_SIZE) + localX
            const worldZ = (moduleZ * MODULE_SIZE) + localZ
            const cellSeed = mixHash(moduleX, moduleZ, deck, (localX * 11) + localZ)
            const isOuterRing = localX === 0 || localX === MODULE_SIZE - 1 || localZ === 0 || localZ === MODULE_SIZE - 1
            const isInnerRing = localX === 1 || localX === MODULE_SIZE - 2 || localZ === 1 || localZ === MODULE_SIZE - 2
            const isCore = localX >= 3 && localX <= 4 && localZ >= 3 && localZ <= 4
            const isCornerCore = (localX === 2 || localX === 5) && (localZ === 2 || localZ === 5)

            setBlock(
              indices,
              worldX,
              baseY,
              worldZ,
              isCornerCore || isCore
                ? resolveCoreBlockIndex(registry, cellSeed + moduleSeed)
                : resolveSupportIndex(registry, cellSeed + moduleSeed),
              stats,
            )

            let lowerMechanismIndex = 0
            if (localX === 1 && localZ >= 2 && localZ <= 5) {
              lowerMechanismIndex = resolveObserverIndex(registry, 'east', cellSeed)
            }
            else if (localX === MODULE_SIZE - 2 && localZ >= 2 && localZ <= 5) {
              lowerMechanismIndex = resolveObserverIndex(registry, 'west', cellSeed)
            }
            else if (localZ === 1 && localX >= 2 && localX <= 5) {
              lowerMechanismIndex = resolveRepeaterIndex(registry, 'south', cellSeed)
            }
            else if (localZ === MODULE_SIZE - 2 && localX >= 2 && localX <= 5) {
              lowerMechanismIndex = resolveComparatorIndex(registry, 'north', cellSeed)
            }
            else if (localX >= 2 && localX <= 5 && localZ >= 2 && localZ <= 5) {
              lowerMechanismIndex = resolveWireIndex(registry, localX, localZ, deck, cellSeed)
            }
            else if ((localX === 1 || localX === MODULE_SIZE - 2) && (localZ === 1 || localZ === MODULE_SIZE - 2)) {
              lowerMechanismIndex = resolveHopperIndex(
                registry,
                pick(['north', 'south', 'west', 'east'], cellSeed),
                cellSeed,
              )
            }
            setBlock(indices, worldX, baseY + 1, worldZ, lowerMechanismIndex, stats)

            let midMechanismIndex = 0
            if ((localX === 2 || localX === 5) && (localZ === 3 || localZ === 4)) {
              midMechanismIndex = resolvePistonIndex(
                registry,
                (cellSeed & 1) === 0 ? 'piston' : 'sticky_piston',
                localX === 2 ? 'east' : 'west',
                cellSeed,
              )
            }
            else if ((localZ === 2 || localZ === 5) && (localX === 3 || localX === 4)) {
              midMechanismIndex = resolveDropperLikeIndex(
                registry,
                (cellSeed & 1) === 0 ? 'dispenser' : 'dropper',
                localZ === 2 ? 'south' : 'north',
                cellSeed,
              )
            }
            else if (isCore) {
              midMechanismIndex = resolveLampIndex(registry, cellSeed)
            }
            else if (isCornerCore) {
              midMechanismIndex = resolveFloorTorchIndex(registry, cellSeed)
            }
            setBlock(indices, worldX, baseY + 2, worldZ, midMechanismIndex, stats)

            let latticeIndex = 0
            if (isInnerRing) {
              const connections = getEdgeConnections(localX, localZ)
              if ((cellSeed & 1) === 0) {
                latticeIndex = resolvePaneIndex(
                  registry,
                  (cellSeed & 2) === 0 ? 'glass_pane' : 'iron_bars',
                  connections,
                )
              }
              else if ((cellSeed & 2) === 0) {
                latticeIndex = resolveFenceIndex(registry, connections)
              }
              else {
                latticeIndex = resolveWallIndex(registry, connections, cellSeed)
              }
            }
            else if (isCore) {
              latticeIndex = resolvePistonHeadIndex(
                registry,
                pick(['north', 'south', 'east', 'west', 'up', 'down'], cellSeed),
                cellSeed,
              )
            }
            setBlock(indices, worldX, baseY + 3, worldZ, latticeIndex, stats)

            let upperMechanismIndex = 0
            if (isCore) {
              upperMechanismIndex = resolveScaffoldingIndex(registry, cellSeed, deck === 0)
            }
            else if (localX >= 1 && localX <= 6 && localZ >= 1 && localZ <= 6 && ((localX + localZ + deck) % 2 === 0)) {
              upperMechanismIndex = resolveTrapdoorIndex(
                registry,
                pick(['north', 'south', 'east', 'west'], cellSeed),
                cellSeed,
              )
            }
            else if (
              (localX === 1 && localZ >= 2 && localZ <= 5)
              || (localX === MODULE_SIZE - 2 && localZ >= 2 && localZ <= 5)
              || (localZ === 1 && localX >= 2 && localX <= 5)
              || (localZ === MODULE_SIZE - 2 && localX >= 2 && localX <= 5)
            ) {
              const facing = localX === 1
                ? 'east'
                : localX === MODULE_SIZE - 2
                  ? 'west'
                  : localZ === 1
                    ? 'south'
                    : 'north'
              upperMechanismIndex = resolveWallTorchIndex(registry, facing, cellSeed)
            }
            setBlock(indices, worldX, baseY + 4, worldZ, upperMechanismIndex, stats)

            let ceilingIndex = 0
            if (isOuterRing) {
              ceilingIndex = resolveSupportIndex(registry, moduleSeed + cellSeed + 7)
            }
            else if (((localX + localZ + deck) % 3) !== 0) {
              ceilingIndex = resolveSlabIndex(registry, cellSeed)
            }
            else if (isCore) {
              ceilingIndex = resolveLampIndex(registry, cellSeed + 1)
            }
            setBlock(indices, worldX, baseY + 5, worldZ, ceilingIndex, stats)
          }
        }
      }
    }
  }

  carveAndRebuildCorridors(indices, stats, registry)
  return { indices, stats }
}

function isCorridor(x, z) {
  return Math.abs(x - CENTER_X) <= CORRIDOR_HALF_WIDTH
    || Math.abs(z - CENTER_Z) <= CORRIDOR_HALF_WIDTH
}

function isCoreShaft(x, z) {
  return Math.abs(x - CENTER_X) <= CORE_SHAFT_HALF_WIDTH
    && Math.abs(z - CENTER_Z) <= CORE_SHAFT_HALF_WIDTH
}

function isCorePerimeter(x, z) {
  const dx = Math.abs(x - CENTER_X)
  const dz = Math.abs(z - CENTER_Z)
  return (dx === CORE_SHAFT_HALF_WIDTH + 1 && dz <= CORE_SHAFT_HALF_WIDTH + 1)
    || (dz === CORE_SHAFT_HALF_WIDTH + 1 && dx <= CORE_SHAFT_HALF_WIDTH + 1)
}

function carveAndRebuildCorridors(indices, stats, registry) {
  for (let z = 0; z < REGION_SIZE.z; z += 1) {
    for (let x = 0; x < REGION_SIZE.x; x += 1) {
      if (!isCorridor(x, z)) {
        continue
      }

      for (let y = 0; y < REGION_SIZE.y; y += 1) {
        if (indices[getIndex(x, y, z)] !== 0) {
          stats.carvedCells += 1
        }
        setBlock(indices, x, y, z, 0, stats)
      }
    }
  }

  const corridorFloorIndex = registry.resolve('smooth_stone')
  const corridorAccentIndex = registry.resolve('polished_andesite')
  const shaftSupportIndex = registry.resolve('obsidian')
  const shaftTrimIndex = registry.resolve('iron_block')

  for (let deck = 0; deck < DECK_COUNT; deck += 1) {
    const baseY = deck * DECK_HEIGHT

    for (let z = 0; z < REGION_SIZE.z; z += 1) {
      for (let x = 0; x < REGION_SIZE.x; x += 1) {
        if (!isCorridor(x, z) || isCoreShaft(x, z)) {
          continue
        }

        const floorIndex = ((x + z + deck) % 7 === 0) ? corridorAccentIndex : corridorFloorIndex
        setBlock(indices, x, baseY, z, floorIndex, stats)

        if (baseY + 1 < REGION_SIZE.y && isCorePerimeter(x, z)) {
          const dx = Math.abs(x - CENTER_X)
          const dz = Math.abs(z - CENTER_Z)
          setBlock(
            indices,
            x,
            baseY + 1,
            z,
            resolvePaneIndex(registry, 'iron_bars', {
              north: dz !== CORE_SHAFT_HALF_WIDTH + 1 || z > CENTER_Z,
              east: dx !== CORE_SHAFT_HALF_WIDTH + 1 || x < CENTER_X,
              south: dz !== CORE_SHAFT_HALF_WIDTH + 1 || z < CENTER_Z,
              west: dx !== CORE_SHAFT_HALF_WIDTH + 1 || x > CENTER_X,
            }),
            stats,
          )
        }

        if (
          baseY + 1 < REGION_SIZE.y
          && !isCorePerimeter(x, z)
          && (Math.abs(x - CENTER_X) === CORRIDOR_HALF_WIDTH || Math.abs(z - CENTER_Z) === CORRIDOR_HALF_WIDTH)
          && ((x + z + deck) % 5 === 0)
        ) {
          setBlock(indices, x, baseY + 1, z, resolveLampIndex(registry, mixHash(x, z, deck)), stats)
        }
      }
    }
  }

  for (let y = 0; y < REGION_SIZE.y; y += 1) {
    for (const [columnX, columnZ] of [
      [CENTER_X - (CORE_SHAFT_HALF_WIDTH + 1), CENTER_Z - (CORE_SHAFT_HALF_WIDTH + 1)],
      [CENTER_X + (CORE_SHAFT_HALF_WIDTH + 1), CENTER_Z - (CORE_SHAFT_HALF_WIDTH + 1)],
      [CENTER_X - (CORE_SHAFT_HALF_WIDTH + 1), CENTER_Z + (CORE_SHAFT_HALF_WIDTH + 1)],
      [CENTER_X + (CORE_SHAFT_HALF_WIDTH + 1), CENTER_Z + (CORE_SHAFT_HALF_WIDTH + 1)],
    ]) {
      setBlock(indices, columnX, y, columnZ, (y % DECK_HEIGHT === 0) ? shaftTrimIndex : shaftSupportIndex, stats)
    }

    setBlock(
      indices,
      CENTER_X,
      y,
      CENTER_Z,
      resolveScaffoldingIndex(registry, mixHash(CENTER_X, y, CENTER_Z), y === 0),
      stats,
    )
  }
}

function buildLitematicNbt(indices, palette, stats) {
  const blockStates = encodeBlockIndices(indices, palette.length)
  const now = BigInt(Date.now())

  return {
    name: '',
    type: 'compound',
    value: {
      MinecraftDataVersion: nbtInt(Number(TARGET_VERSION_INFO.dataVersion)),
      Version: nbtInt(6),
      SubVersion: nbtInt(1),
      Metadata: nbtCompound({
        Name: nbtString('giant-redstone-dense-world'),
        Author: nbtString('Litemora generator'),
        Description: nbtString('Large vertically dense redstone-machine stress world.'),
        RegionCount: nbtInt(1),
        TotalBlocks: nbtInt(stats.blockCount),
        TotalVolume: nbtInt(indices.length),
        TimeCreated: nbtLong(now),
        TimeModified: nbtLong(now),
        EnclosingSize: nbtCompound({
          x: nbtInt(REGION_SIZE.x),
          y: nbtInt(REGION_SIZE.y),
          z: nbtInt(REGION_SIZE.z),
        }),
      }),
      Regions: nbtCompound({
        giant_redstone_dense: nbtCompound({
          Position: nbtCompound({
            x: nbtInt(0),
            y: nbtInt(0),
            z: nbtInt(0),
          }),
          Size: nbtCompound({
            x: nbtInt(REGION_SIZE.x),
            y: nbtInt(REGION_SIZE.y),
            z: nbtInt(REGION_SIZE.z),
          }),
          BlockStatePalette: nbtList('compound', palette.map(state => buildPaletteEntry(state))),
          BlockStates: { type: 'longArray', value: blockStates },
          Entities: nbtList('end', []),
          TileEntities: nbtList('end', []),
          PendingBlockTicks: nbtList('end', []),
          PendingFluidTicks: nbtList('end', []),
        }),
      }),
    },
  }
}

async function main() {
  const registry = createPaletteRegistry()
  const { indices, stats } = buildDenseMachineVolume(registry)
  const root = buildLitematicNbt(indices, registry.states, stats)
  const nbtBuffer = writeUncompressed(root, 'big')
  const gzipped = BufferPolyfill.from(pako.gzip(new Uint8Array(nbtBuffer)))

  const spawnPoint = {
    x: CENTER_X + CORRIDOR_HALF_WIDTH - 1,
    y: 1.5,
    z: CENTER_Z,
  }

  const outputStats = {
    fileName: OUTPUT_NAME,
    minecraftVersion: TARGET_MC_VERSION,
    dataVersion: TARGET_VERSION_INFO.dataVersion,
    size: REGION_SIZE,
    volume: indices.length,
    blockCount: stats.blockCount,
    paletteSize: registry.states.length,
    moduleSize: MODULE_SIZE,
    deckHeight: DECK_HEIGHT,
    deckCount: DECK_COUNT,
    moduleCount: stats.moduleCount,
    carvedCells: stats.carvedCells,
    spawnPoint,
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.mkdir(PUBLIC_OUTPUT_DIR, { recursive: true })
  await fs.writeFile(OUTPUT_LITEMATIC, gzipped)
  await fs.writeFile(PUBLIC_OUTPUT_LITEMATIC, gzipped)
  await fs.writeFile(OUTPUT_STATS, `${JSON.stringify(outputStats, null, 2)}\n`, 'utf8')

  console.log(`Generated: ${path.relative(ROOT, OUTPUT_LITEMATIC)}`)
  console.log(`Served copy: ${path.relative(ROOT, PUBLIC_OUTPUT_LITEMATIC)}`)
  console.log(`Stats: ${path.relative(ROOT, OUTPUT_STATS)}`)
  console.log(`Minecraft version: ${TARGET_MC_VERSION}`)
  console.log(`Region size: ${REGION_SIZE.x} x ${REGION_SIZE.y} x ${REGION_SIZE.z}`)
  console.log(`Volume: ${indices.length}`)
  console.log(`Blocks: ${stats.blockCount}`)
  console.log(`Palette entries: ${registry.states.length}`)
  console.log(`Modules: ${stats.moduleCount}`)
  console.log(`Spawn point: ${spawnPoint.x}, ${spawnPoint.y}, ${spawnPoint.z}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
