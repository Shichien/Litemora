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
const OUTPUT_LITEMATIC = path.join(OUTPUT_DIR, 'portal-link-demo.litematic')

const REGION_SIZE = {
  x: 19,
  y: 6,
  z: 25,
}

function resolveDefaultMcVersion() {
  const latestStable = (minecraftData.versions.pc || [])
    .find(entry => /^\d+\.\d+(?:\.\d+)?$/u.test(String(entry?.minecraftVersion || '')))

  return latestStable?.minecraftVersion || '1.21.4'
}

const TARGET_MC_VERSION = resolveDefaultMcVersion()
const TARGET_VERSION_INFO = minecraftData.versionsByMinecraftVersion.pc?.[TARGET_MC_VERSION]

if (!TARGET_VERSION_INFO) {
  throw new Error(`Unknown or unsupported Minecraft version: ${TARGET_MC_VERSION}`)
}

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

function createBlockState(name, properties = null) {
  const normalizedProperties = properties && typeof properties === 'object'
    ? Object.fromEntries(
      Object.entries(properties)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [String(key), String(value)]),
    )
    : null

  return {
    name: String(name || 'minecraft:air').trim(),
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

function createBlockVolume(size) {
  return Array.from({ length: size.x * size.y * size.z }, () => createBlockState('minecraft:air'))
}

function getIndex(x, y, z) {
  return x + (z * REGION_SIZE.x) + (y * REGION_SIZE.x * REGION_SIZE.z)
}

function setBlock(volume, x, y, z, state) {
  if (
    x < 0 || x >= REGION_SIZE.x
    || y < 0 || y >= REGION_SIZE.y
    || z < 0 || z >= REGION_SIZE.z
  ) {
    throw new Error(`Block out of bounds at ${x},${y},${z}`)
  }

  volume[getIndex(x, y, z)] = state
}

function fill(volume, from, to, state) {
  for (let x = from.x; x <= to.x; x += 1) {
    for (let y = from.y; y <= to.y; y += 1) {
      for (let z = from.z; z <= to.z; z += 1) {
        setBlock(volume, x, y, z, state)
      }
    }
  }
}

function buildDemoVolume() {
  const volume = createBlockVolume(REGION_SIZE)

  const smoothStone = createBlockState('minecraft:smooth_stone')
  const border = createBlockState('minecraft:polished_blackstone_bricks')
  const pathBlock = createBlockState('minecraft:cut_copper')
  const glowstone = createBlockState('minecraft:glowstone')
  const obsidian = createBlockState('minecraft:obsidian')
  const netherPortal = createBlockState('minecraft:nether_portal', { axis: 'x' })
  const endPortal = createBlockState('minecraft:end_portal')
  const endPortalFrame = createBlockState('minecraft:end_portal_frame')

  fill(volume, { x: 0, y: 0, z: 0 }, { x: 18, y: 0, z: 24 }, smoothStone)
  fill(volume, { x: 0, y: 0, z: 0 }, { x: 18, y: 0, z: 0 }, border)
  fill(volume, { x: 0, y: 0, z: 24 }, { x: 18, y: 0, z: 24 }, border)
  fill(volume, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 24 }, border)
  fill(volume, { x: 18, y: 0, z: 0 }, { x: 18, y: 0, z: 24 }, border)
  fill(volume, { x: 8, y: 0, z: 1 }, { x: 10, y: 0, z: 23 }, pathBlock)

  setBlock(volume, 4, 1, 4, glowstone)
  setBlock(volume, 14, 1, 4, glowstone)
  setBlock(volume, 4, 1, 20, glowstone)
  setBlock(volume, 14, 1, 20, glowstone)

  for (let x = 7; x <= 10; x += 1) {
    setBlock(volume, x, 1, 5, obsidian)
    setBlock(volume, x, 5, 5, obsidian)
  }
  for (let y = 2; y <= 4; y += 1) {
    setBlock(volume, 7, y, 5, obsidian)
    setBlock(volume, 10, y, 5, obsidian)
  }
  for (let x = 8; x <= 9; x += 1) {
    for (let y = 2; y <= 4; y += 1) {
      setBlock(volume, x, y, 5, netherPortal)
    }
  }

  fill(volume, { x: 6, y: 0, z: 16 }, { x: 12, y: 0, z: 22 }, createBlockState('minecraft:end_stone_bricks'))
  for (let x = 7; x <= 11; x += 1) {
    setBlock(volume, x, 0, 17, endPortalFrame)
    setBlock(volume, x, 0, 21, endPortalFrame)
  }
  for (let z = 18; z <= 20; z += 1) {
    setBlock(volume, 7, 0, z, endPortalFrame)
    setBlock(volume, 11, 0, z, endPortalFrame)
  }
  for (let x = 8; x <= 10; x += 1) {
    for (let z = 18; z <= 20; z += 1) {
      setBlock(volume, x, 0, z, endPortal)
    }
  }

  return volume
}

function buildLitematicNbt(volume) {
  const palette = [createBlockState('minecraft:air')]
  const paletteLookup = new Map([[serializeBlockState(palette[0]), 0]])
  const indices = []

  for (const state of volume) {
    const key = serializeBlockState(state)
    let paletteIndex = paletteLookup.get(key)
    if (paletteIndex === undefined) {
      paletteIndex = palette.length
      paletteLookup.set(key, paletteIndex)
      palette.push(state)
    }
    indices.push(paletteIndex)
  }

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
        Name: nbtString('portal-link-demo'),
        Author: nbtString('Litemora'),
        Description: nbtString('Walk into the Nether or End portal to test URL teleport triggers.'),
        RegionCount: nbtInt(1),
        TotalBlocks: nbtInt(indices.filter(value => value !== 0).length),
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
        portal_link_demo: nbtCompound({
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
  const volume = buildDemoVolume()
  const root = buildLitematicNbt(volume)
  const nbtBuffer = writeUncompressed(root, 'big')
  const gzipped = BufferPolyfill.from(pako.gzip(new Uint8Array(nbtBuffer)))

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.writeFile(OUTPUT_LITEMATIC, gzipped)

  console.log(`Generated: ${path.relative(ROOT, OUTPUT_LITEMATIC)}`)
  console.log(`Minecraft version: ${TARGET_MC_VERSION}`)
  console.log(`Data version: ${TARGET_VERSION_INFO.dataVersion}`)
  console.log(`Region size: ${REGION_SIZE.x} x ${REGION_SIZE.y} x ${REGION_SIZE.z}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
