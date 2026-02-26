import fs from 'node:fs/promises'
import path from 'node:path'
import { Buffer as BufferPolyfill } from 'node:buffer'
import pako from 'pako'
import { writeUncompressed } from 'prismarine-nbt'
import { javaAtlasBlockTextureRects } from '../src/js/generated/java-atlas-textures.js'
import { javaBlockTextureStemHintsByBlock } from '../src/js/generated/java-block-texture-hints.js'

const ROOT = process.cwd()
const OUTPUT_DIR = path.join(ROOT, 'litematic')
const OUTPUT_LITEMATIC = path.join(OUTPUT_DIR, 'all-blocks-test.litematic')
const OUTPUT_LIST = path.join(OUTPUT_DIR, 'all-blocks-test-block-names.txt')
const OUTPUT_CSV = path.join(OUTPUT_DIR, 'all-blocks-test-layout.csv')

const GRID_COLUMNS = 64

function sanitizeCandidateName(name) {
  const normalized = String(name || '').trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (!/^[a-z0-9_]+$/u.test(normalized)) {
    return null
  }

  if (normalized.endsWith('_top')
    || normalized.endsWith('_bottom')
    || normalized.endsWith('_side')
    || normalized.endsWith('_front')
    || normalized.endsWith('_back')
    || normalized.endsWith('_end')
    || normalized.endsWith('_inner')
    || normalized.endsWith('_outer')
    || normalized.endsWith('_overlay')
    || normalized.endsWith('_particle')
    || normalized.endsWith('_flow')) {
    return null
  }

  return normalized
}

function collectBlockNames() {
  const names = new Set()

  for (const key of Object.keys(javaBlockTextureStemHintsByBlock)) {
    const hit = sanitizeCandidateName(key)
    if (hit) {
      names.add(hit)
    }
  }

  for (const key of Object.keys(javaAtlasBlockTextureRects)) {
    if (!key.startsWith('block/')) {
      continue
    }
    const candidate = key.slice('block/'.length)
    const hit = sanitizeCandidateName(candidate)
    if (hit) {
      names.add(hit)
    }
  }

  names.delete('air')
  return [...names].sort((a, b) => a.localeCompare(b))
}

function encodeBlockIndices(indices, paletteSize) {
  const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(Math.max(1, paletteSize))))
  const totalBits = indices.length * bitsPerBlock
  const longCount = Math.ceil(totalBits / 64)
  const longs = Array.from({ length: longCount }, () => 0n)
  const valueMask = (1n << BigInt(bitsPerBlock)) - 1n

  for (let blockIndex = 0; blockIndex < indices.length; blockIndex++) {
    const value = BigInt(indices[blockIndex]) & valueMask
    const startBit = blockIndex * bitsPerBlock
    const longIndex = Math.floor(startBit / 64)
    const bitOffset = startBit % 64

    longs[longIndex] |= value << BigInt(bitOffset)

    const spillBits = bitOffset + bitsPerBlock - 64
    if (spillBits > 0) {
      const spillMask = (1n << BigInt(spillBits)) - 1n
      const spillValue = (value >> BigInt(bitsPerBlock - spillBits)) & spillMask
      if (longIndex + 1 < longs.length) {
        longs[longIndex + 1] |= spillValue
      }
    }
  }

  return longs.map(value => BigInt.asIntN(64, value))
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

function buildLitematicNbt(blockNames) {
  const paletteEntries = ['minecraft:air', ...blockNames.map(name => `minecraft:${name}`)]

  const sizeX = GRID_COLUMNS
  const sizeY = 1
  const sizeZ = Math.ceil(blockNames.length / GRID_COLUMNS)
  const totalBlocks = sizeX * sizeY * sizeZ

  const indices = Array.from({ length: totalBlocks }, () => 0)
  const layoutRows = []

  for (let index = 0; index < blockNames.length; index++) {
    const x = index % sizeX
    const z = Math.floor(index / sizeX)
    const paletteIndex = index + 1
    const blockIndex = x + z * sizeX

    indices[blockIndex] = paletteIndex
    layoutRows.push({
      name: blockNames[index],
      index,
      x,
      y: 0,
      z,
      paletteIndex,
    })
  }

  const blockStates = encodeBlockIndices(indices, paletteEntries.length)

  const paletteList = paletteEntries.map(blockName => ({ Name: nbtString(blockName) }))
  const now = BigInt(Date.now())

  const root = {
    name: '',
    type: 'compound',
    value: {
    MinecraftDataVersion: nbtInt(4189),
    Version: nbtInt(6),
    SubVersion: nbtInt(1),
    Metadata: nbtCompound({
      Name: nbtString('all-blocks-test'),
      Author: nbtString('Third-Person-MC generator'),
      Description: nbtString('Auto-generated litematic for block render verification.'),
      RegionCount: nbtInt(1),
      TotalBlocks: nbtInt(blockNames.length),
      TotalVolume: nbtInt(totalBlocks),
      TimeCreated: nbtLong(now),
      TimeModified: nbtLong(now),
      EnclosingSize: nbtCompound({
        x: nbtInt(sizeX),
        y: nbtInt(sizeY),
        z: nbtInt(sizeZ),
      }),
    }),
    Regions: nbtCompound({
      test_region: nbtCompound({
        Position: nbtCompound({
          x: nbtInt(0),
          y: nbtInt(0),
          z: nbtInt(0),
        }),
        Size: nbtCompound({
          x: nbtInt(sizeX),
          y: nbtInt(sizeY),
          z: nbtInt(sizeZ),
        }),
        BlockStatePalette: nbtList('compound', paletteList),
        BlockStates: { type: 'longArray', value: blockStates },
        Entities: nbtList('end', []),
        TileEntities: nbtList('end', []),
        PendingBlockTicks: nbtList('end', []),
        PendingFluidTicks: nbtList('end', []),
      }),
    }),
    },
  }

  return {
    root,
    layoutRows,
    sizeX,
    sizeY,
    sizeZ,
    totalBlocks,
  }
}

async function main() {
  const blockNames = collectBlockNames()
  if (!blockNames.length) {
    throw new Error('No block names found from generated datasets.')
  }

  const { root, layoutRows, sizeX, sizeY, sizeZ, totalBlocks } = buildLitematicNbt(blockNames)
  const nbtBuffer = writeUncompressed(root, 'big')
  const gzipped = BufferPolyfill.from(pako.gzip(new Uint8Array(nbtBuffer)))

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.writeFile(OUTPUT_LITEMATIC, gzipped)
  await fs.writeFile(OUTPUT_LIST, `${blockNames.map(name => `minecraft:${name}`).join('\n')}\n`, 'utf8')

  const csvLines = ['index,block_name,x,y,z,palette_index']
  for (const row of layoutRows) {
    csvLines.push(`${row.index},minecraft:${row.name},${row.x},${row.y},${row.z},${row.paletteIndex}`)
  }
  await fs.writeFile(OUTPUT_CSV, `${csvLines.join('\n')}\n`, 'utf8')

  console.log(`Generated: ${path.relative(ROOT, OUTPUT_LITEMATIC)}`)
  console.log(`Block names: ${blockNames.length}`)
  console.log(`Region size: ${sizeX} x ${sizeY} x ${sizeZ} (${totalBlocks} volume)`)
  console.log(`Name list: ${path.relative(ROOT, OUTPUT_LIST)}`)
  console.log(`Layout CSV: ${path.relative(ROOT, OUTPUT_CSV)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
