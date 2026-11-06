/**
 * 校验红石门: 在 replay 上逐 tick 重放, 确认
 *   1. 开场门洞是实心的 (门板)
 *   2. 拨动拉杆后门洞整片变成空气
 *   3. 再拨回去后门洞重新被门板封住
 *   4. 过程中活塞/活塞头有真实位移 (动画看得见)
 *
 * 门洞格子取自结构文件 (litematic) 里所有门板方块的位置, 而不是 replay 的 baseline ——
 * baseline 只包含「会变化的方块」, 单看它拿不到完整的门板集合。
 *
 * 用法: node ./scripts/verify-redstone-doors.mjs [id...]
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import pako from 'pako'
import { parse } from 'prismarine-nbt'

const ROOT = process.cwd()
const ARCHIVE = path.join(ROOT, 'output', 'redstone-doors')

const GATE_BLOCKS = ['minecraft:iron_block', 'minecraft:copper_block']

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(ARCHIVE)
      .filter(name => name.endsWith('.replay.json.gz'))
      .map(name => name.replace('.replay.json.gz', ''))

const nameOf = (replay, state) => (state === undefined ? 'absent' : replay.palette[state])

/** 从 litematic 读出所有门板方块的坐标。 */
async function readGateCells(litematicPath) {
  const raw = pako.ungzip(fs.readFileSync(litematicPath))
  const { parsed } = await parse(Buffer.from(raw), 'big')
  const regions = parsed.value.Regions.value
  const cells = []

  for (const rawRegion of Object.values(regions)) {
    const region = rawRegion.value ?? rawRegion
    const palette = region.BlockStatePalette.value.value
    const names = palette.map((entry) => {
      const name = entry.Name.value
      const props = entry.Properties?.value || {}
      const propsText = Object.keys(props).length
        ? `[${Object.keys(props).sort().map(k => `${k}=${props[k].value}`).join(',')}]`
        : ''
      return `${name}${propsText}`
    })

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
      const stateName = names[Number(value)]
      if (!GATE_BLOCKS.includes(stateName))
        continue

      // 迭代顺序 y -> z -> x
      const x = index % sx
      const z = Math.floor(index / sx) % sz
      const y = Math.floor(index / (sx * sz))
      cells.push({ x, y, z })
    }
  }

  return cells
}

let failures = 0

for (const id of ids) {
  const replayPath = path.join(ARCHIVE, `${id}.replay.json.gz`)
  const litematicPath = path.join(ARCHIVE, `${id}.litematic`)
  if (!fs.existsSync(replayPath) || !fs.existsSync(litematicPath)) {
    console.log(`SKIP ${id} (缺少 replay 或 litematic)`)
    continue
  }

  const replay = JSON.parse(zlib.gunzipSync(fs.readFileSync(replayPath)).toString())
  const cells = await readGateCells(litematicPath)

  if (cells.length === 0) {
    console.log(`FAIL ${id}: 结构里找不到门板方块`)
    failures += 1
    continue
  }

  const stateAt = new Map()
  for (const block of replay.baseline) {
    stateAt.set(`${block.x},${block.y},${block.z}`, block.state)
  }

  // 结构里的初始状态: replay baseline 里没有的格子, 用结构自己的状态推断。
  // 门板格子开场一定是门板, 所以直接视为「实心」起点。
  const keys = cells.map(cell => `${cell.x},${cell.y},${cell.z}`)
  const isSolid = () => keys.every((key) => {
    const state = stateAt.get(key)
    if (state === undefined)
      return true // 未被 replay 触及 -> 仍是结构里的原样 (门板)
    return GATE_BLOCKS.includes(nameOf(replay, state))
  })
  const isEmpty = () => keys.every(key => nameOf(replay, stateAt.get(key)) === 'minecraft:air')

  const framesByTick = new Map()
  for (const frame of replay.frames) {
    if (!framesByTick.has(frame.tick))
      framesByTick.set(frame.tick, [])
    framesByTick.get(frame.tick).push(frame)
  }

  const startSolid = isSolid()
  let openedAtTick = null
  let closedAtTick = null
  let sawMovingPiston = false

  for (let tick = 0; tick <= replay.totalTicks; tick += 1) {
    for (const frame of framesByTick.get(tick) || []) {
      for (const change of frame.changes) {
        stateAt.set(`${change.x},${change.y},${change.z}`, change.state)
        if (nameOf(replay, change.state).startsWith('minecraft:moving_piston')) {
          sawMovingPiston = true
        }
      }
    }
    if (openedAtTick === null && isEmpty())
      openedAtTick = tick
    else if (openedAtTick !== null && closedAtTick === null && isSolid())
      closedAtTick = tick
  }

  const endSolid = isSolid()
  const ok = startSolid && openedAtTick !== null && closedAtTick !== null && endSolid && sawMovingPiston

  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}`)
  console.log(`      门板格 ${cells.length} 个, 总 tick=${replay.totalTicks}, 变更 ${replay.changeCount} 次`)
  console.log(`      开场实心=${startSolid}  门洞全开于 tick=${openedAtTick}  重新封上于 tick=${closedAtTick}  收尾实心=${endSolid}`)
  console.log(`      有活塞位移动画=${sawMovingPiston}`)

  if (!ok)
    failures += 1
}

if (failures > 0) {
  console.log(`\n${failures} 扇门未通过校验`)
  process.exit(1)
}
console.log('\n全部通过')
