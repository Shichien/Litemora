/**
 * 把 output/redstone-doors 里已经验证通过的红石门装进站点:
 *
 *   public/redstone-archive/<id>.litematic          结构
 *   public/redstone-archive/<id>.replay.json.gz     回放
 *   public/redstone-archive/catalog.json            条目
 *
 *   public/.dev-gallery/redstonearchive/items/<galleryId>.json
 *   public/.dev-gallery/redstonearchive/sources/<galleryId>.bin
 *   public/.dev-gallery/redstonearchive/manifest.json
 *
 *   public/spaces/redstonearchive/projections/<slug>/world-config.json
 *   public/spaces/redstonearchive/projections/<slug>/world-state.json
 *
 * 用法: node ./scripts/install-redstone-doors.mjs
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import pako from 'pako'
import { parse } from 'prismarine-nbt'

const ROOT = process.cwd()
const SOURCE = path.join(ROOT, 'output', 'redstone-doors')
const ARCHIVE = path.join(ROOT, 'public', 'redstone-archive')
const GALLERY = path.join(ROOT, 'public', '.dev-gallery', 'redstonearchive')
const PROJECTIONS = path.join(ROOT, 'public', 'spaces', 'redstonearchive', 'projections')

const AUTHOR = 'Litemora'
const MINECRAFT_VERSION = 'Java 26.1.2'
const NOW = Date.now()

const DOORS = [
  {
    id: 'piston-pull-door-2x2',
    title: '2x2 回拉式活塞门',
    description: '通电时两块门板封住门口，拨动拉杆后左右两台粘性活塞同时把门板拉进侧墙暗格，门口整片让开。',
    category: '门',
    slug: 'pistonpulldoor2x2',
    galleryId: 'seed-redstone-pull-door-2x2',
  },
  {
    id: 'piston-pull-door-2x3',
    title: '2x3 回拉式活塞门',
    description: '标准房门尺寸的回拉式活塞门，六块门板分三行被活塞收进两侧，开合干净利落。',
    category: '门',
    slug: 'pistonpulldoor2x3',
    galleryId: 'seed-redstone-pull-door-2x3',
  },
  {
    id: 'piston-pull-door-2x4',
    title: '2x4 高身回拉式活塞门',
    description: '窄而高的回拉式活塞门，八块门板分四行收进两侧墙体，适合当作走廊尽头的门洞。',
    category: '门',
    slug: 'pistonpulldoor2x4',
    galleryId: 'seed-redstone-pull-door-2x4',
  },
  {
    id: 'piston-lift-gate-3',
    title: '3 格地面闸门',
    description: '三台朝下的粘性活塞把门板压在地面上，拨动拉杆后活塞收回，门板被提起让出通道。',
    category: '门',
    slug: 'pistonliftgate3',
    galleryId: 'seed-redstone-lift-gate-3',
  },
  {
    id: 'piston-lift-gate-5',
    title: '5 格宽地面闸门',
    description: '五台朝下的粘性活塞同时提起整排门板，开口很宽，适合当作庭院大门。',
    category: '门',
    slug: 'pistonliftgate5',
    galleryId: 'seed-redstone-lift-gate-5',
  },
]

/** 读出 litematic 的包围盒与方块数。 */
async function readSchematicMeta(litematicPath) {
  const raw = pako.ungzip(await fs.readFile(litematicPath))
  const { parsed } = await parse(Buffer.from(raw), 'big')
  const metadata = parsed.value.Metadata.value
  const regions = parsed.value.Regions.value

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let blockCount = 0

  for (const rawRegion of Object.values(regions)) {
    const region = rawRegion.value ?? rawRegion
    const size = region.Size.value
    const sx = size.x.value
    const sy = size.y.value
    const sz = size.z.value

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
      if (x < minX)
        minX = x
      if (y < minY)
        minY = y
      if (z < minZ)
        minZ = z
      if (x > maxX)
        maxX = x
      if (y > maxY)
        maxY = y
      if (z > maxZ)
        maxZ = z
    }
  }

  return {
    name: metadata.Name?.value ?? '',
    author: metadata.Author?.value ?? AUTHOR,
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
    size: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
    regionCount: Object.keys(regions).length,
    blockCount,
  }
}

function readReplayStats(replay) {
  return {
    ticks: replay.totalTicks,
    stateChanges: replay.changeCount,
    touchedBlocks: new Set(
      replay.frames.flatMap(frame =>
        frame.changes.map(change => `${change.x},${change.y},${change.z}`),
      ),
    ).size,
  }
}

async function main() {
  await fs.mkdir(path.join(GALLERY, 'items'), { recursive: true })
  await fs.mkdir(path.join(GALLERY, 'sources'), { recursive: true })

  const catalogPath = path.join(ARCHIVE, 'catalog.json')
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  const manifestPath = path.join(GALLERY, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))

  for (const door of DOORS) {
    const litematicSource = path.join(SOURCE, `${door.id}.litematic`)
    const replaySource = path.join(SOURCE, `${door.id}.replay.json.gz`)

    const litematicTarget = path.join(ARCHIVE, `${door.id}.litematic`)
    const replayTarget = path.join(ARCHIVE, `${door.id}.replay.json.gz`)
    await fs.copyFile(litematicSource, litematicTarget)
    await fs.copyFile(replaySource, replayTarget)

    const litematicBytes = await fs.readFile(litematicTarget)
    const schematic = await readSchematicMeta(litematicTarget)
    const replay = JSON.parse(
      pako.ungzip
        ? (await import('node:zlib')).gunzipSync(await fs.readFile(replayTarget)).toString()
        : '',
    )
    const stats = readReplayStats(replay)

    // --- catalog ---
    catalog.items = catalog.items.filter(item => item.id !== door.id)
    catalog.items.push({
      id: door.id,
      title: door.title,
      description: door.description,
      category: door.category,
      minecraftVersion: MINECRAFT_VERSION,
      structureUrl: `/redstone-archive/${door.id}.litematic`,
      replayUrl: `/redstone-archive/${door.id}.replay.json.gz`,
      sourceUrl: 'https://github.com/azazo1/redstone-rs',
      license: 'MIT',
      stats,
    })

    // --- gallery ---
    const preview = {
      totalSolidBlocks: schematic.blockCount,
      sampled: false,
      bounds: schematic.bounds,
    }

    await fs.writeFile(
      path.join(GALLERY, 'sources', `${door.galleryId}.bin`),
      litematicBytes,
    )

    await fs.writeFile(
      path.join(GALLERY, 'items', `${door.galleryId}.json`),
      `${JSON.stringify({
        id: door.galleryId,
        space: 'redstonearchive',
        title: door.title,
        projectionSlug: door.slug,
        description: door.description,
        visibility: 'public',
        fileName: `${door.id}.litematic`,
        mimeType: 'application/octet-stream',
        sourceFile: {
          fileName: `${door.id}.litematic`,
          mimeType: 'application/octet-stream',
          size: litematicBytes.length,
        },
        schematic,
        previewModel: {
          name: schematic.name,
          sampled: false,
          totalSolidBlocks: schematic.blockCount,
          bounds: schematic.bounds,
        },
        placement: { offset: { x: 0, y: 0, z: 0 } },
        owner: { id: 'local-dev', name: 'Local Dev', avatar: '' },
        createdAt: NOW,
        updatedAt: NOW,
      }, null, 2)}\n`,
      'utf8',
    )

    manifest.items = manifest.items.filter(item => item.id !== door.galleryId)
    manifest.items.push({
      id: door.galleryId,
      title: door.title,
      projectionSlug: door.slug,
      description: door.description,
      visibility: 'public',
      fileName: `${door.id}.litematic`,
      schematic,
      placement: { offset: { x: 0, y: 0, z: 0 } },
      createdAt: NOW,
      updatedAt: NOW,
      preview,
    })

    // --- world config ---
    const projectionDir = path.join(PROJECTIONS, door.slug)
    await fs.mkdir(projectionDir, { recursive: true })

    // 门板在 z=3 平面; 玩家站在 z 负方向的门外往里看。
    const spawnZ = -6
    const centerX = Math.round((schematic.bounds.minX + schematic.bounds.maxX) / 2)

    await fs.writeFile(
      path.join(projectionDir, 'world-config.json'),
      `${JSON.stringify({
        ui: {
          pauseMenu: { showSettings: false, showSkins: true },
          controls: { allowFlightToggle: true, allowPerspectiveToggle: true },
        },
        settings: {
          portalLinks: { endPortalUrl: '', netherPortalUrl: '' },
          environment: {
            ambientIntensity: 0.9,
            sunIntensity: 3,
            timeAutoPlay: false,
            timeOfDay: 0.38,
            skyMode: 'DayCycle',
            fogDensity: 0.006,
          },
          redstoneArchive: { replayUrl: `/redstone-archive/${door.id}.replay.json.gz` },
          visualPreset: 'default',
          cameraPreset: 'default',
          chunk: { unloadPadding: 1, height: 256, viewDistance: 2 },
        },
        player: {
          spawnPoint: { x: centerX, y: 2, z: spawnZ },
          view: { yaw: 180, pitch: -10 },
          flight: { groundWalkAnimationWhenMoving: true },
        },
      }, null, 2)}\n`,
      'utf8',
    )

    await fs.writeFile(
      path.join(projectionDir, 'world-state.json'),
      `${JSON.stringify({
        worldState: { schematicOnlyMode: true },
        modifications: {},
      }, null, 2)}\n`,
      'utf8',
    )

    console.log(`installed ${door.id}  (${schematic.size.x}x${schematic.size.y}x${schematic.size.z}, ${schematic.blockCount} blocks, ${stats.ticks} ticks)`)
  }

  manifest.updatedAt = NOW
  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(`\ncatalog: ${catalog.items.length} items`)
  console.log(`gallery: ${manifest.items.length} items`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
