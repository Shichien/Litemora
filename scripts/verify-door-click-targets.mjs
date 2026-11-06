/**
 * 校验「点击拉杆触发动画」这条链路在数据层面是通的:
 *   replay 里每个 action 的坐标, 必须在结构文件里真的有一个拉杆/按钮方块。
 *
 * 浏览器里 _handleUseBlock 拿被点方块的坐标去比对 _actionTargets,
 * 而 _actionTargets 就是 action.pos 的集合。所以只要结构里那块确实是拉杆,
 * 玩家对着它点一下就能触发回放。
 *
 * 用法: node ./scripts/verify-door-click-targets.mjs [id...]
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import pako from 'pako'
import { parse } from 'prismarine-nbt'

const ROOT = process.cwd()
const ARCHIVE = path.join(ROOT, 'output', 'redstone-doors')

const TRIGGER_PREFIXES = ['minecraft:lever', 'minecraft:stone_button', 'minecraft:oak_button']

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(ARCHIVE)
      .filter(name => name.endsWith('.replay.json.gz'))
      .map(name => name.replace('.replay.json.gz', ''))

/** 把结构读成 Map<'x,y,z', 方块名>。 */
async function readBlocks(litematicPath) {
  const raw = pako.ungzip(fs.readFileSync(litematicPath))
  const { parsed } = await parse(Buffer.from(raw), 'big')
  const regions = parsed.value.Regions.value
  const blocks = new Map()

  for (const rawRegion of Object.values(regions)) {
    const region = rawRegion.value ?? rawRegion
    const palette = region.BlockStatePalette.value.value
    const names = palette.map(entry => entry.Name.value)

    const size = region.Size.value
    const sx = size.x.value
    const sy = size.y.value
    const sz = size.z.value
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
      const name = names[Number(value)]
      if (name === 'minecraft:air')
        continue

      const x = index % sx
      const z = Math.floor(index / sx) % sz
      const y = Math.floor(index / (sx * sz))
      blocks.set(`${x},${y},${z}`, name)
    }
  }

  return blocks
}

let failures = 0

for (const id of ids) {
  const replayPath = path.join(ARCHIVE, `${id}.replay.json.gz`)
  const litematicPath = path.join(ARCHIVE, `${id}.litematic`)
  if (!fs.existsSync(replayPath) || !fs.existsSync(litematicPath)) {
    console.log(`SKIP ${id}`)
    continue
  }

  const replay = JSON.parse(zlib.gunzipSync(fs.readFileSync(replayPath)).toString())
  const blocks = await readBlocks(litematicPath)

  const targets = new Map()
  for (const frame of replay.frames) {
    for (const entry of frame.actions || []) {
      const pos = entry?.action?.pos
      if (!pos)
        continue
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
      targets.set(key, entry.action.type)
    }
  }

  if (targets.size === 0) {
    console.log(`FAIL ${id}: 回放里没有任何 action, 玩家没有可点的东西`)
    failures += 1
    continue
  }

  const missing = []
  for (const key of targets.keys()) {
    const name = blocks.get(key)
    if (!name || !TRIGGER_PREFIXES.some(prefix => name.startsWith(prefix))) {
      missing.push(`${key} -> ${name ?? '空气'}`)
    }
  }

  if (missing.length > 0) {
    console.log(`FAIL ${id}: ${missing.length} 个 action 坐标上没有拉杆/按钮`)
    for (const entry of missing) console.log(`      ${entry}`)
    failures += 1
    continue
  }

  console.log(`PASS ${id}: ${targets.size} 个可点目标全部落在真实的拉杆方块上`)
}

if (failures > 0) {
  console.log(`\n${failures} 扇门的点击目标有问题`)
  process.exit(1)
}
console.log('\n全部可点')
