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
const OUTPUT_NAME = 'giant-block-mix-world.litematic'
const OUTPUT_LITEMATIC = path.join(OUTPUT_DIR, OUTPUT_NAME)
const PUBLIC_OUTPUT_LITEMATIC = path.join(PUBLIC_OUTPUT_DIR, OUTPUT_NAME)
const OUTPUT_STATS = path.join(OUTPUT_DIR, 'giant-block-mix-world.json')

const REGION_SIZE = {
  x: 512,
  y: 20,
  z: 512,
}
const CENTER_X = Math.floor(REGION_SIZE.x / 2)
const CENTER_Z = Math.floor(REGION_SIZE.z / 2)
const ROAD_HALF_WIDTH = 5
const COLOR_PATCH = {
  x: 80,
  z: 96,
  size: 64,
  tileSize: 4,
}

const BLOCK_NAMES = [
  'stone',
  'cobblestone',
  'mossy_cobblestone',
  'stone_bricks',
  'cracked_stone_bricks',
  'mossy_stone_bricks',
  'smooth_stone',
  'polished_andesite',
  'polished_diorite',
  'polished_granite',
  'deepslate_bricks',
  'deepslate_tiles',
  'tuff',
  'bricks',
  'mud_bricks',
  'sandstone',
  'smooth_sandstone',
  'red_sandstone',
  'smooth_red_sandstone',
  'quartz_block',
  'smooth_quartz',
  'purpur_block',
  'prismarine',
  'prismarine_bricks',
  'dark_prismarine',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'mangrove_planks',
  'cherry_planks',
  'bamboo_planks',
  'terracotta',
  'white_terracotta',
  'orange_terracotta',
  'magenta_terracotta',
  'light_blue_terracotta',
  'yellow_terracotta',
  'lime_terracotta',
  'pink_terracotta',
  'gray_terracotta',
  'light_gray_terracotta',
  'cyan_terracotta',
  'purple_terracotta',
  'blue_terracotta',
  'brown_terracotta',
  'green_terracotta',
  'red_terracotta',
  'black_terracotta',
  'white_concrete',
  'orange_concrete',
  'magenta_concrete',
  'light_blue_concrete',
  'yellow_concrete',
  'lime_concrete',
  'pink_concrete',
  'gray_concrete',
  'light_gray_concrete',
  'cyan_concrete',
  'purple_concrete',
  'blue_concrete',
  'brown_concrete',
  'green_concrete',
  'red_concrete',
  'black_concrete',
  'white_wool',
  'orange_wool',
  'magenta_wool',
  'light_blue_wool',
  'yellow_wool',
  'lime_wool',
  'pink_wool',
  'gray_wool',
  'light_gray_wool',
  'cyan_wool',
  'purple_wool',
  'blue_wool',
  'brown_wool',
  'green_wool',
  'red_wool',
  'black_wool',
  'iron_block',
  'gold_block',
  'diamond_block',
  'emerald_block',
  'lapis_block',
  'redstone_block',
  'amethyst_block',
  'obsidian',
  'crying_obsidian',
  'glass',
  'sea_lantern',
  'glowstone',
  'shroomlight',
  'bookshelf',
  'hay_block',
  'target',
  'slime_block',
  'honey_block',
]

const COLOR_PATCH_BLOCK_NAMES = [
  'red_wool',
  'orange_wool',
  'yellow_wool',
  'lime_wool',
  'cyan_wool',
  'blue_wool',
  'magenta_wool',
  'red_concrete',
  'orange_concrete',
  'yellow_concrete',
  'lime_concrete',
  'cyan_concrete',
  'blue_concrete',
  'magenta_concrete',
  'gold_block',
  'diamond_block',
  'emerald_block',
  'lapis_block',
  'redstone_block',
  'amethyst_block',
]

function parseCliNumber(name, fallbackValue) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallbackValue
  }
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallbackValue
}

function parseCliArg(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] || null
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

const mc = minecraftData(TARGET_MC_VERSION)
const KNOWN_BLOCKS = new Set(Object.keys(mc.blocksByName || {}))
const EXTRA_SPACING = parseCliNumber('--spacing', 32)

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

function createPalette() {
  const names = BLOCK_NAMES.filter(name => KNOWN_BLOCKS.has(name))
  if (!names.length) {
    throw new Error(`No compatible block names found for Minecraft ${TARGET_MC_VERSION}`)
  }

  return ['air', ...names].map(name => `minecraft:${name}`)
}

function buildPaletteEntries(palette) {
  return palette.map(blockName => ({
    Name: nbtString(blockName),
  }))
}

function selectFloorPaletteIndex(x, z, paletteLength) {
  const usablePaletteLength = paletteLength - 1
  const mixed = Math.imul(x + 37, 73_856_093) ^ Math.imul(z + 91, 19_349_663)
  return 1 + (Math.abs(mixed) % usablePaletteLength)
}

function isRoad(x, z) {
  return Math.abs(x - CENTER_X) <= ROAD_HALF_WIDTH
    || Math.abs(z - CENTER_Z) <= ROAD_HALF_WIDTH
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

function buildVolume(palette) {
  const indices = new Uint16Array(REGION_SIZE.x * REGION_SIZE.y * REGION_SIZE.z)
  const stats = { blockCount: 0, structureCount: 0 }
  const paletteLookup = new Map(palette.map((blockName, index) => [blockName, index]))
  const roadPaletteIndex = palette.indexOf('minecraft:smooth_stone') > 0
    ? palette.indexOf('minecraft:smooth_stone')
    : 1
  const roadAccentIndex = palette.indexOf('minecraft:quartz_block')
  const columnIndex = palette.indexOf('minecraft:polished_blackstone_bricks') > 0
    ? palette.indexOf('minecraft:polished_blackstone_bricks')
    : palette.indexOf('minecraft:obsidian')
  const lightIndex = palette.indexOf('minecraft:sea_lantern')
  const platformIndex = palette.indexOf('minecraft:bricks')

  for (let z = 0; z < REGION_SIZE.z; z += 1) {
    for (let x = 0; x < REGION_SIZE.x; x += 1) {
      const road = isRoad(x, z)
      const paletteIndex = road
        ? (((x + z) % 9 === 0 && roadAccentIndex > 0) ? roadAccentIndex : roadPaletteIndex)
        : selectFloorPaletteIndex(x, z, palette.length)
      setBlock(indices, x, 0, z, paletteIndex, stats)
    }
  }

  const colorPatchIndices = COLOR_PATCH_BLOCK_NAMES
    .map(blockName => paletteLookup.get(`minecraft:${blockName}`))
    .filter(index => Number.isInteger(index) && index > 0)
  if (colorPatchIndices.length) {
    for (let dz = 0; dz < COLOR_PATCH.size; dz += 1) {
      for (let dx = 0; dx < COLOR_PATCH.size; dx += 1) {
        const tileX = Math.floor(dx / COLOR_PATCH.tileSize)
        const tileZ = Math.floor(dz / COLOR_PATCH.tileSize)
        const paletteIndex = colorPatchIndices[(tileX + tileZ * 7) % colorPatchIndices.length]
        setBlock(indices, COLOR_PATCH.x + dx, 0, COLOR_PATCH.z + dz, paletteIndex, stats)
      }
    }
  }

  for (let z = EXTRA_SPACING; z < REGION_SIZE.z - EXTRA_SPACING; z += EXTRA_SPACING) {
    for (let x = EXTRA_SPACING; x < REGION_SIZE.x - EXTRA_SPACING; x += EXTRA_SPACING) {
      if (Math.abs(x - CENTER_X) < EXTRA_SPACING || Math.abs(z - CENTER_Z) < EXTRA_SPACING) {
        continue
      }

      const localBlockIndex = selectFloorPaletteIndex(x, z, palette.length)
      for (let dx = -3; dx <= 3; dx += 1) {
        for (let dz = -3; dz <= 3; dz += 1) {
          setBlock(indices, x + dx, 1, z + dz, platformIndex > 0 ? platformIndex : localBlockIndex, stats)
        }
      }

      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        for (let y = 2; y <= 6; y += 1) {
          setBlock(indices, x + dx, y, z + dz, columnIndex > 0 ? columnIndex : localBlockIndex, stats)
        }
        if (lightIndex > 0) {
          setBlock(indices, x + dx, 7, z + dz, lightIndex, stats)
        }
      }
      stats.structureCount += 1
    }
  }

  return { indices, stats }
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
        Name: nbtString('giant-block-mix-world'),
        Author: nbtString('Litemora generator'),
        Description: nbtString('Large mixed-block walkability test world.'),
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
        giant_block_mix: nbtCompound({
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
          BlockStatePalette: nbtList('compound', buildPaletteEntries(palette)),
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
  const palette = createPalette()
  const { indices, stats } = buildVolume(palette)
  const root = buildLitematicNbt(indices, palette, stats)
  const nbtBuffer = writeUncompressed(root, 'big')
  const gzipped = BufferPolyfill.from(pako.gzip(new Uint8Array(nbtBuffer)))
  const outputStats = {
    fileName: OUTPUT_NAME,
    minecraftVersion: TARGET_MC_VERSION,
    dataVersion: TARGET_VERSION_INFO.dataVersion,
    size: REGION_SIZE,
    volume: indices.length,
    blockCount: stats.blockCount,
    paletteSize: palette.length,
    structureCount: stats.structureCount,
    spawnPoint: {
      x: CENTER_X,
      y: 0.5,
      z: CENTER_Z,
    },
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
  console.log(`Palette entries: ${palette.length}`)
  console.log(`Structures: ${stats.structureCount}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
