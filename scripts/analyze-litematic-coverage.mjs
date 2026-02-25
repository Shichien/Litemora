import fs from 'node:fs/promises'
import path from 'node:path'
import pako from 'pako'
import { parse, simplify } from 'prismarine-nbt'
import { Buffer as BufferPolyfill } from 'buffer'
import { bedrockTextureNameByRelative, bedrockTextureNameByStem } from '../src/js/generated/bedrock-texture-sources.js'

const ROOT = process.cwd()
const LITEMATIC_DIR = path.join(ROOT, 'litematic')
const REPORT_PATH = path.join(ROOT, 'docs', 'litematic-texture-coverage.txt')

const BLOCK_IDS = {
  EMPTY: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COAL_ORE: 4,
  IRON_ORE: 5,
  TREE_TRUNK: 6,
  TREE_LEAVES: 7,
  SAND: 8,
  BIRCH_TRUNK: 9,
  BIRCH_LEAVES: 10,
  CHERRY_TRUNK: 11,
  CHERRY_LEAVES: 12,
  CACTUS: 13,
  TERRACOTTA: 15,
  RED_SAND: 16,
  ICE: 17,
  PACKED_ICE: 18,
  SNOW: 19,
  GRAVEL: 21,
  DIORITE: 22,
  POLISHED_DIORITE: 23,
  ANDESITE: 24,
  POLISHED_ANDESITE: 25,
  POLISHED_BLACKSTONE: 26,
  POLISHED_BLACKSTONE_BRICKS: 27,
  CRACKED_POLISHED_BLACKSTONE_BRICKS: 28,
  OCHRE_FROGLIGHT: 29,
  PEARLESCENT_FROGLIGHT: 30,
}

const MC_TO_PROJECT_MAPPING = {
  'minecraft:grass_block': BLOCK_IDS.GRASS,
  'minecraft:dirt': BLOCK_IDS.DIRT,
  'minecraft:stone': BLOCK_IDS.STONE,
  'minecraft:smooth_stone': BLOCK_IDS.STONE,
  'minecraft:andesite': BLOCK_IDS.ANDESITE,
  'minecraft:polished_andesite': BLOCK_IDS.POLISHED_ANDESITE,
  'minecraft:diorite': BLOCK_IDS.DIORITE,
  'minecraft:polished_diorite': BLOCK_IDS.POLISHED_DIORITE,
  'minecraft:clay': BLOCK_IDS.TERRACOTTA,
  'minecraft:polished_blackstone': BLOCK_IDS.POLISHED_BLACKSTONE,
  'minecraft:polished_blackstone_bricks': BLOCK_IDS.POLISHED_BLACKSTONE_BRICKS,
  'minecraft:cracked_polished_blackstone_bricks': BLOCK_IDS.CRACKED_POLISHED_BLACKSTONE_BRICKS,
  'minecraft:ochre_froglight': BLOCK_IDS.OCHRE_FROGLIGHT,
  'minecraft:pearlescent_froglight': BLOCK_IDS.PEARLESCENT_FROGLIGHT,
  'minecraft:coal_ore': BLOCK_IDS.COAL_ORE,
  'minecraft:iron_ore': BLOCK_IDS.IRON_ORE,
  'minecraft:oak_log': BLOCK_IDS.TREE_TRUNK,
  'minecraft:oak_leaves': BLOCK_IDS.TREE_LEAVES,
  'minecraft:birch_log': BLOCK_IDS.BIRCH_TRUNK,
  'minecraft:birch_leaves': BLOCK_IDS.BIRCH_LEAVES,
  'minecraft:cherry_log': BLOCK_IDS.CHERRY_TRUNK,
  'minecraft:cherry_leaves': BLOCK_IDS.CHERRY_LEAVES,
  'minecraft:sand': BLOCK_IDS.SAND,
  'minecraft:gravel': BLOCK_IDS.GRAVEL,
  'minecraft:red_sand': BLOCK_IDS.RED_SAND,
  'minecraft:terracotta': BLOCK_IDS.TERRACOTTA,
  'minecraft:ice': BLOCK_IDS.ICE,
  'minecraft:packed_ice': BLOCK_IDS.PACKED_ICE,
  'minecraft:snow_block': BLOCK_IDS.SNOW,
  'minecraft:cactus': BLOCK_IDS.CACTUS,
}

const KEYWORD_MAPPING = [
  { keywords: ['coal_ore'], id: BLOCK_IDS.COAL_ORE },
  { keywords: ['iron_ore'], id: BLOCK_IDS.IRON_ORE },
  { keywords: ['ochre_froglight'], id: BLOCK_IDS.OCHRE_FROGLIGHT },
  { keywords: ['pearlescent_froglight'], id: BLOCK_IDS.PEARLESCENT_FROGLIGHT },
  { keywords: ['cracked_polished_blackstone_bricks'], id: BLOCK_IDS.CRACKED_POLISHED_BLACKSTONE_BRICKS },
  { keywords: ['polished_blackstone_bricks'], id: BLOCK_IDS.POLISHED_BLACKSTONE_BRICKS },
  { keywords: ['polished_blackstone'], id: BLOCK_IDS.POLISHED_BLACKSTONE },
  { keywords: ['polished_diorite'], id: BLOCK_IDS.POLISHED_DIORITE },
  { keywords: ['diorite'], id: BLOCK_IDS.DIORITE },
  { keywords: ['polished_andesite'], id: BLOCK_IDS.POLISHED_ANDESITE },
  { keywords: ['andesite'], id: BLOCK_IDS.ANDESITE },
  { keywords: ['red_sand'], id: BLOCK_IDS.RED_SAND },
  { keywords: ['sand'], id: BLOCK_IDS.SAND },
  { keywords: ['snow'], id: BLOCK_IDS.SNOW },
  { keywords: ['packed_ice'], id: BLOCK_IDS.PACKED_ICE },
  { keywords: ['ice'], id: BLOCK_IDS.ICE },
  { keywords: ['gravel'], id: BLOCK_IDS.GRAVEL },
  { keywords: ['terracotta', 'clay', 'mud_bricks'], id: BLOCK_IDS.TERRACOTTA },
  { keywords: ['leaves'], id: BLOCK_IDS.TREE_LEAVES },
  { keywords: ['birch_log'], id: BLOCK_IDS.BIRCH_TRUNK },
  { keywords: ['cherry_log'], id: BLOCK_IDS.CHERRY_TRUNK },
  { keywords: ['log', 'wood', 'stem', 'hyphae'], id: BLOCK_IDS.TREE_TRUNK },
  { keywords: ['grass_block'], id: BLOCK_IDS.GRASS },
  { keywords: ['dirt', 'podzol', 'coarse_dirt', 'mycelium'], id: BLOCK_IDS.DIRT },
  { keywords: ['blackstone', 'deepslate', 'granite', 'cobblestone'], id: BLOCK_IDS.GRAVEL },
]

function toUint64BigInt(value) {
  let source = value
  if (source && typeof source === 'object' && 'value' in source) {
    source = source.value
  }
  return BigInt.asUintN(64, BigInt(source ?? 0))
}

function decodeBlockIndices(blockData, paletteSize, totalBlocks) {
  if (!blockData || totalBlocks <= 0) {
    return []
  }

  const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(Math.max(1, paletteSize))))
  const mask = (1n << BigInt(bitsPerBlock)) - 1n
  const longArray = Array.from(blockData, value => toUint64BigInt(value))
  const indices = Array.from({ length: totalBlocks }, () => 0)

  for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
    const startBit = blockIndex * bitsPerBlock
    const longIndex = Math.floor(startBit / 64)
    const bitOffset = startBit % 64

    if (longIndex >= longArray.length) {
      indices[blockIndex] = 0
      continue
    }

    let value = (longArray[longIndex] >> BigInt(bitOffset)) & mask
    const spillBits = bitOffset + bitsPerBlock - 64
    if (spillBits > 0 && longIndex + 1 < longArray.length) {
      const nextMask = (1n << BigInt(spillBits)) - 1n
      const nextBits = longArray[longIndex + 1] & nextMask
      value |= nextBits << BigInt(64 - bitOffset)
    }

    indices[blockIndex] = Number(value)
  }

  return indices
}

function buildBedrockBaseNameCandidates(normalizedName) {
  const candidates = [normalizedName]

  const shapeStripped = normalizedName.replace(/_(stairs|slab|wall|fence|fence_gate|door|trapdoor)$/u, '')
  if (shapeStripped && shapeStripped !== normalizedName) {
    candidates.push(shapeStripped)
  }

  const swapPairs = [
    ['_planks', 'planks_'],
    ['_concrete', 'concrete_'],
    ['_stained_glass', 'glass_'],
  ]

  for (const source of [...candidates]) {
    for (const [suffix, prefix] of swapPairs) {
      if (!source.endsWith(suffix)) {
        continue
      }
      const material = source.slice(0, -suffix.length)
      if (!material) {
        continue
      }
      candidates.push(`${prefix}${material}`)
    }
  }

  for (const source of [...candidates]) {
    if (source === 'stone_bricks' || source === 'stone_brick') {
      candidates.push('stonebrick')
    }
    if (source === 'nether_bricks') {
      candidates.push('nether_brick')
    }
  }

  return [...new Set(candidates)]
}

function resolveBedrockTextureName(normalizedName) {
  if (!normalizedName) {
    return null
  }

  const baseCandidates = buildBedrockBaseNameCandidates(normalizedName)
  const candidates = []
  const seen = new Set()

  for (const base of baseCandidates) {
    const variants = [
      base,
      `${base}_top`,
      `${base}_side`,
      `${base}_front`,
      `${base}_on`,
      `${base}_off`,
      `${base}_bottom`,
      `${base}_end`,
    ]

    for (const variant of variants) {
      if (seen.has(variant)) {
        continue
      }
      seen.add(variant)
      candidates.push(variant)
    }
  }

  for (const candidate of candidates) {
    const hit = bedrockTextureNameByStem[candidate] || bedrockTextureNameByRelative[candidate]
    if (hit) {
      return hit
    }
  }

  return null
}

function resolveProjectBlock(blockName) {
  if (!blockName || blockName === 'minecraft:air') {
    return { id: BLOCK_IDS.EMPTY, source: 'air' }
  }

  const exact = MC_TO_PROJECT_MAPPING[blockName]
  if (exact) {
    return { id: exact, source: 'exact' }
  }

  const normalizedName = blockName.replace('minecraft:', '')

  if (normalizedName.endsWith('_slab')) {
    const slabBaseName = normalizedName.replace(/_slab$/u, '')
    const slabTextureName = resolveBedrockTextureName(slabBaseName)
      || resolveBedrockTextureName(`${slabBaseName}_planks`)
      || resolveBedrockTextureName(`planks_${slabBaseName}`)
      || resolveBedrockTextureName(normalizedName)
    if (slabTextureName) {
      return { id: 1001, source: 'bedrock-dynamic', textureName: slabTextureName }
    }
  }

  for (const rule of KEYWORD_MAPPING) {
    if (rule.keywords.some(keyword => normalizedName.includes(keyword))) {
      return { id: rule.id, source: 'keyword' }
    }
  }

  const bedrockTextureName = resolveBedrockTextureName(normalizedName)
  if (bedrockTextureName) {
    return { id: 1000, source: 'bedrock-dynamic', textureName: bedrockTextureName }
  }

  return { id: BLOCK_IDS.STONE, source: 'default-stone' }
}

function countByName(map, name, increment = 1) {
  map.set(name, (map.get(name) || 0) + increment)
}

function getRelatedStemExamples(normalizedName, limit = 5) {
  const needle = `${normalizedName}_`
  const hits = []
  for (const [stem, textureName] of Object.entries(bedrockTextureNameByStem)) {
    if (stem.startsWith(needle)) {
      hits.push(textureName)
      if (hits.length >= limit) {
        break
      }
    }
  }
  return hits
}

async function analyzeOne(filePath) {
  const binary = await fs.readFile(filePath)
  const decompressed = pako.inflate(binary)
  const { parsed } = await parse(BufferPolyfill.from(decompressed))
  const simplified = simplify(parsed)

  const regions = simplified.Regions || {}
  const stats = {
    fileName: path.basename(filePath),
    totalSolidBlocks: 0,
    bySource: {
      exact: 0,
      keyword: 0,
      'bedrock-dynamic': 0,
      'default-stone': 0,
    },
    defaultStoneByBlock: new Map(),
  }

  for (const region of Object.values(regions)) {
    const size = region.Size || {}
    const sizeX = Math.abs(size.x || 0)
    const sizeY = Math.abs(size.y || 0)
    const sizeZ = Math.abs(size.z || 0)
    const totalBlocks = sizeX * sizeY * sizeZ
    if (totalBlocks <= 0) {
      continue
    }

    const palette = region.BlockStatePalette || []
    const blockStates = region.BlockStates || []
    const indices = decodeBlockIndices(blockStates, palette.length, totalBlocks)

    const countByPaletteIndex = new Map()
    for (const paletteIndex of indices) {
      countByName(countByPaletteIndex, paletteIndex)
    }

    for (const [paletteIndex, blockCount] of countByPaletteIndex.entries()) {
      const entry = palette[paletteIndex]
      const blockName = entry?.Name || 'minecraft:air'
      const resolved = resolveProjectBlock(blockName)

      if (resolved.source === 'air') {
        continue
      }

      stats.totalSolidBlocks += blockCount
      stats.bySource[resolved.source] += blockCount

      if (resolved.source === 'default-stone') {
        countByName(stats.defaultStoneByBlock, blockName, blockCount)
      }
    }
  }

  return stats
}

function pct(value, total) {
  if (!total) {
    return '0.00%'
  }
  return `${((value / total) * 100).toFixed(2)}%`
}

function formatDefaultTop(defaultStoneByBlock) {
  const rows = [...defaultStoneByBlock.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)
  if (!rows.length) {
    return ['  (none)']
  }

  return rows.map(([blockName, count], index) => {
    const normalized = blockName.replace('minecraft:', '')
    const related = getRelatedStemExamples(normalized)
    const relatedText = related.length
      ? ` | related bedrock stems: ${related.join(', ')}`
      : ' | related bedrock stems: none'
    return `  ${String(index + 1).padStart(2, '0')}. ${blockName} -> ${count}${relatedText}`
  })
}

async function main() {
  const entries = await fs.readdir(LITEMATIC_DIR, { withFileTypes: true })
  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.litematic'))
    .map(entry => path.join(LITEMATIC_DIR, entry.name))
    .sort((a, b) => a.localeCompare(b))

  if (!files.length) {
    throw new Error('No .litematic files found')
  }

  const reports = []
  const aggregate = {
    totalSolidBlocks: 0,
    bySource: {
      exact: 0,
      keyword: 0,
      'bedrock-dynamic': 0,
      'default-stone': 0,
    },
    defaultStoneByBlock: new Map(),
  }

  for (const filePath of files) {
    const report = await analyzeOne(filePath)
    reports.push(report)

    aggregate.totalSolidBlocks += report.totalSolidBlocks
    aggregate.bySource.exact += report.bySource.exact
    aggregate.bySource.keyword += report.bySource.keyword
    aggregate.bySource['bedrock-dynamic'] += report.bySource['bedrock-dynamic']
    aggregate.bySource['default-stone'] += report.bySource['default-stone']

    for (const [blockName, count] of report.defaultStoneByBlock.entries()) {
      countByName(aggregate.defaultStoneByBlock, blockName, count)
    }
  }

  const lines = []
  lines.push(`Generated at: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('=== Aggregate Coverage ===')
  lines.push(`Total solid blocks: ${aggregate.totalSolidBlocks}`)
  lines.push(`Exact: ${aggregate.bySource.exact} (${pct(aggregate.bySource.exact, aggregate.totalSolidBlocks)})`)
  lines.push(`Keyword: ${aggregate.bySource.keyword} (${pct(aggregate.bySource.keyword, aggregate.totalSolidBlocks)})`)
  lines.push(`Bedrock dynamic: ${aggregate.bySource['bedrock-dynamic']} (${pct(aggregate.bySource['bedrock-dynamic'], aggregate.totalSolidBlocks)})`)
  lines.push(`Default stone fallback: ${aggregate.bySource['default-stone']} (${pct(aggregate.bySource['default-stone'], aggregate.totalSolidBlocks)})`)
  lines.push('')
  lines.push('Top default-stone fallback block names (aggregate):')
  lines.push(...formatDefaultTop(aggregate.defaultStoneByBlock))

  for (const report of reports) {
    lines.push('')
    lines.push(`=== File: ${report.fileName} ===`)
    lines.push(`Total solid blocks: ${report.totalSolidBlocks}`)
    lines.push(`Exact: ${report.bySource.exact} (${pct(report.bySource.exact, report.totalSolidBlocks)})`)
    lines.push(`Keyword: ${report.bySource.keyword} (${pct(report.bySource.keyword, report.totalSolidBlocks)})`)
    lines.push(`Bedrock dynamic: ${report.bySource['bedrock-dynamic']} (${pct(report.bySource['bedrock-dynamic'], report.totalSolidBlocks)})`)
    lines.push(`Default stone fallback: ${report.bySource['default-stone']} (${pct(report.bySource['default-stone'], report.totalSolidBlocks)})`)
    lines.push('Top default-stone fallback block names:')
    lines.push(...formatDefaultTop(report.defaultStoneByBlock))
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8')

  console.log(`Coverage report generated: ${path.relative(ROOT, REPORT_PATH)}`)
  console.log(`Aggregate fallback ratio: ${pct(aggregate.bySource['default-stone'], aggregate.totalSolidBlocks)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
