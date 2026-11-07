/**
 * 把一个已经生成好的巨型 litematic 注册成 codexperf 空间里可访问的投影世界,
 * 用于做大规模性能测试。做法与 codexperf 里已有的 giant-* 场景完全一致:
 *
 *   public/.dev-gallery/codexperf/sources/<galleryId>.bin   结构二进制
 *   public/.dev-gallery/codexperf/items/<galleryId>.json    条目
 *   public/.dev-gallery/codexperf/manifest.json             清单
 *   public/spaces/codexperf/projections/<slug>/world-*.json 世界配置
 *
 * 用法: node ./scripts/register-perf-scene.mjs --base giant-redstone-dense-xl \
 *         --slug giantredstonedensexl --title "..." --description "..."
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import pako from 'pako'
import { parse } from 'prismarine-nbt'

const ROOT = process.cwd()
const GALLERY = path.join(ROOT, 'public', '.dev-gallery', 'codexperf')
const PROJECTIONS = path.join(ROOT, 'public', 'spaces', 'codexperf', 'projections')
const LITEMATIC_DIR = path.join(ROOT, 'public', 'litematic')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}

const BASE = arg('--base')
const SLUG = arg('--slug')
const TITLE = arg('--title', SLUG)
const DESCRIPTION = arg('--description', 'Large redstone stress world for performance testing.')
if (!BASE || !SLUG) {
  console.error('need --base <litematic basename> and --slug <projection slug>')
  process.exit(1)
}

const LITEMATIC = path.join(LITEMATIC_DIR, `${BASE}.litematic`)
const GALLERY_ID = `seed-${SLUG}`

/** 读出 litematic 的包围盒、方块数与调色板, 与 gallery 条目里的 schematic 字段对齐。 */
async function readSchematic(filePath) {
  const raw = pako.ungzip(await fs.readFile(filePath))
  const { parsed } = await parse(Buffer.from(raw), 'big')
  const metadata = parsed.value.Metadata?.value ?? {}
  const regions = parsed.value.Regions.value

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let blockCount = 0

  for (const rawRegion of Object.values(regions)) {
    const region = rawRegion.value ?? rawRegion
    const size = region.Size.value
    const sx = size.x.value, sy = size.y.value, sz = size.z.value
    const palette = region.BlockStatePalette.value.value
    const names = palette.map((entry) => {
      const props = entry.Properties?.value || {}
      const propsText = Object.keys(props).length
        ? `[${Object.keys(props).sort().map(k => `${k}=${props[k].value}`).join(',')}]`
        : ''
      return `${entry.Name.value}${propsText}`
    })
    const total = sx * sy * sz
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, names.length))))
    const longs = region.BlockStates.value
    const mask = (1n << BigInt(bits)) - 1n

    for (let index = 0; index < total; index += 1) {
      const startBit = index * bits
      const longIndex = Math.floor(startBit / 64)
      const bitOffset = startBit % 64
      let value = (longs[longIndex] >> BigInt(bitOffset)) & mask
      const spill = bitOffset + bits - 64
      if (spill > 0 && longIndex + 1 < longs.length) {
        value |= (longs[longIndex + 1] & ((1n << BigInt(spill)) - 1n)) << BigInt(bits - spill)
      }
      if (names[Number(value)] === 'minecraft:air')
        continue
      blockCount += 1
      const x = index % sx
      const z = Math.floor(index / sx) % sz
      const y = Math.floor(index / (sx * sz))
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
  }

  return {
    name: metadata.Name?.value ?? BASE,
    author: metadata.Author?.value ?? 'Litemora generator',
    size: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
    regionCount: Object.keys(regions).length,
    blockCount,
    yStats: {
      minY,
      maxY,
      hasBlocksBelowZero: minY < 0,
      blocksBelowZero: 0,
    },
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
  }
}

async function main() {
  const bytes = await fs.readFile(LITEMATIC)
  const schematic = await readSchematic(LITEMATIC)
  const NOW = Date.now()

  await fs.mkdir(path.join(GALLERY, 'items'), { recursive: true })
  await fs.mkdir(path.join(GALLERY, 'sources'), { recursive: true })

  await fs.writeFile(path.join(GALLERY, 'sources', `${GALLERY_ID}.bin`), bytes)

  const previewModel = {
    ...schematic,
    totalSolidBlocks: schematic.blockCount,
    sampled: true,
  }

  const item = {
    id: GALLERY_ID,
    space: 'codexperf',
    title: TITLE,
    projectionSlug: SLUG,
    description: DESCRIPTION,
    visibility: 'public',
    fileName: `${BASE}.litematic`,
    mimeType: 'application/octet-stream',
    sourceFile: {
      fileName: `${BASE}.litematic`,
      mimeType: 'application/octet-stream',
      size: bytes.length,
    },
    schematic,
    previewModel,
    placement: { offset: { x: 0, y: 0, z: 0 } },
    owner: { id: 'local-dev', name: 'Local Dev', avatar: '' },
    createdAt: NOW,
    updatedAt: NOW,
  }
  await fs.writeFile(path.join(GALLERY, 'items', `${GALLERY_ID}.json`), `${JSON.stringify(item, null, 2)}\n`, 'utf8')

  const manifestPath = path.join(GALLERY, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifest.items = manifest.items.filter(entry => entry.id !== GALLERY_ID)
  manifest.items.push({
    id: GALLERY_ID,
    title: TITLE,
    projectionSlug: SLUG,
    description: DESCRIPTION,
    visibility: 'public',
    fileName: `${BASE}.litematic`,
    schematic,
    placement: { offset: { x: 0, y: 0, z: 0 } },
    createdAt: NOW,
    updatedAt: NOW,
    preview: {
      totalSolidBlocks: schematic.blockCount,
      sampled: true,
      bounds: schematic.bounds,
    },
  })
  manifest.updatedAt = NOW
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  // 世界配置: 沿用 codexperf 已有的巨型场景设置, 只把出生点放到结构中心上方。
  const projectionDir = path.join(PROJECTIONS, SLUG)
  await fs.mkdir(projectionDir, { recursive: true })
  const centerX = Math.round((schematic.bounds.minX + schematic.bounds.maxX) / 2)
  const centerZ = Math.round((schematic.bounds.minZ + schematic.bounds.maxZ) / 2)
  // 站在结构顶上方一点, 进世界第一眼就能看到整片结构, 而不是卡在地面里。
  const spawnY = schematic.bounds.maxY + 1.5

  await fs.writeFile(
    path.join(projectionDir, 'world-config.json'),
    `${JSON.stringify({
      player: {
        spawnPoint: { x: centerX, y: spawnY, z: centerZ },
        flight: { groundWalkAnimationWhenMoving: true },
      },
      settings: {
        cameraPreset: 'default',
        visualPreset: 'default',
        portalLinks: { netherPortalUrl: '', endPortalUrl: '' },
        chunk: { height: 256, viewDistance: 2, unloadPadding: 1 },
        environment: {
          skyMode: 'DayCycle',
          sunIntensity: 3,
          ambientIntensity: 0.85,
          fogDensity: 0.008,
          timeOfDay: 0.25,
          timeAutoPlay: true,
        },
      },
      ui: {
        pauseMenu: { showSettings: false, showSkins: true },
        controls: { allowFlightToggle: true, allowPerspectiveToggle: true },
      },
    }, null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(projectionDir, 'world-state.json'),
    `${JSON.stringify({ worldState: { schematicOnlyMode: true }, modifications: {} }, null, 2)}\n`,
    'utf8',
  )

  console.log(JSON.stringify({
    slug: SLUG,
    galleryId: GALLERY_ID,
    route: `/codexperf/worlds/${SLUG}`,
    size: schematic.size,
    blockCount: schematic.blockCount,
    bytes: bytes.length,
    spawn: { x: centerX, y: spawnY, z: centerZ },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
