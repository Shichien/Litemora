/**
 * 生成红石档案里的「能启动的红石门」。
 *
 * ## 机械原理
 *
 * 单活塞「推出」式做不到真正让开门口: 活塞伸出后活塞头必然占据门洞那一格,
 * 所以门洞永远是实心的。真正能开的是「回拉」:
 *
 *   关门 (通电, 活塞伸出)            开门 (断电, 活塞收回)
 *   x=0 拉杆                          x=0 拉杆
 *   x=1 粘性活塞 east  伸出           x=1 粘性活塞 east  收回
 *   x=2 活塞头                        x=2 门板 <- 被拉进暗格
 *   x=3 门板                          x=3 空气 <- 门洞
 *   x=4 门板                          x=4 空气 <- 门洞
 *   x=5 活塞头                        x=5 门板 <- 被拉进暗格
 *   x=6 粘性活塞 west  伸出           x=6 粘性活塞 west  收回
 *   x=7 拉杆                          x=7 拉杆
 *
 * ## 布线
 *
 * 拉杆直接贴在活塞背面 (墙面式)。这是实测最可靠的一种:
 * 红石线只会给「它正下方那一格」强充能, 而同层相邻方块不会被充能,
 * 所以「线 -> 支撑块 -> 活塞」那套接法在这里不通, 直接把拉杆接到活塞背面最省事。
 *
 * ## 堆叠
 *
 * 每行 y 不同, 拉杆和活塞各占自己那一层, 竖直方向堆叠时不会抢格子。
 *
 * ## 触发
 *
 * 每行两根拉杆。回放开场会依次拨动全部拉杆, 因此点击任意一根都能看到整扇门开合。
 *
 * 输出:
 *   output/redstone-doors/<id>.litematic
 *   output/redstone-doors/scenarios/<id>.toml
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import pako from 'pako'
import { writeUncompressed } from 'prismarine-nbt'

const ROOT = process.cwd()
const OUTPUT_DIR = path.join(ROOT, 'output', 'redstone-doors')
const SCENARIO_DIR = path.join(OUTPUT_DIR, 'scenarios')

// 与 redstone-rs 使用的 Java 26.1.2 保持一致。
const DATA_VERSION = 4790
const LITEMATIC_VERSION = 7

// 门板所在的平面。
const GATE_Z = 3

// ---------------------------------------------------------------------------
// NBT
// ---------------------------------------------------------------------------

const nbtString = value => ({ type: 'string', value: String(value) })
const nbtInt = value => ({ type: 'int', value: Math.trunc(value) })
function nbtLong(value) {
  return {
    type: 'long',
    value: typeof value === 'bigint' ? value : BigInt(Math.trunc(value)),
  }
}
const nbtCompound = value => ({ type: 'compound', value })
const nbtList = (type, value = []) => ({ type: 'list', value: { type, value } })

// ---------------------------------------------------------------------------
// 方块状态
// ---------------------------------------------------------------------------

function block(name, properties = null) {
  const normalized = properties
    ? Object.fromEntries(
        Object.entries(properties)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => [String(key), String(value)]),
      )
    : null

  return {
    name: name.startsWith('minecraft:') ? name : `minecraft:${name}`,
    properties: normalized && Object.keys(normalized).length ? normalized : null,
  }
}

function serializeBlockState(state) {
  const entries = state.properties
    ? Object.entries(state.properties).sort(([left], [right]) => left.localeCompare(right))
    : []
  return entries.length
    ? `${state.name}[${entries.map(([key, value]) => `${key}=${value}`).join(',')}]`
    : state.name
}

function buildPaletteEntry(state) {
  const entry = { Name: nbtString(state.name) }
  if (state.properties) {
    entry.Properties = nbtCompound(
      Object.fromEntries(Object.entries(state.properties).map(([key, value]) => [key, nbtString(value)])),
    )
  }
  return entry
}

/** Litematic 的 BlockStates: 每方块 bitsPerBlock 位, 低位在前。 */
function encodeBlockIndices(indices, paletteSize) {
  const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(Math.max(1, paletteSize))))
  const longCount = Math.ceil((indices.length * bitsPerBlock) / 64)
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
      longs[longIndex + 1] |= (value >> BigInt(bitsPerBlock - spillBits)) & spillMask
    }
  }

  return longs.map(value => BigInt.asIntN(64, value))
}

// ---------------------------------------------------------------------------
// 方块调色板
// ---------------------------------------------------------------------------

const FLOOR = block('minecraft:stone_bricks')
const FRAME = block('minecraft:chiseled_stone_bricks')
const GATE_A = block('minecraft:iron_block')
const GATE_B = block('minecraft:copper_block')

function sticky(facing, extended) {
  return block('minecraft:sticky_piston', {
    facing,
    extended: extended ? 'true' : 'false',
  })
}
function pistonHead(facing) {
  return block('minecraft:piston_head', {
    facing,
    short: 'false',
    type: 'sticky',
  })
}
/** 拉杆贴在活塞背面, facing 指向「活塞相对拉杆的方向」。 */
function wallLever(facing) {
  return block('minecraft:lever', {
    face: 'wall',
    facing,
    powered: 'true',
  })
}
/** 立在方块上/下的拉杆。face=floor 表示贴着下方方块朝上。facing 只能是水平四向。 */
function floorLever(facing = 'south') {
  return block('minecraft:lever', {
    face: 'floor',
    facing,
    powered: 'true',
  })
}

// ---------------------------------------------------------------------------
// 结构
// ---------------------------------------------------------------------------

class Structure {
  constructor(id, size, options = {}) {
    this.id = id
    this.size = size
    this.author = options.author || 'Litemora'
    this.description = options.description || ''
    this.blocks = new Map()
  }

  static key(x, y, z) {
    return `${x},${y},${z}`
  }

  set(x, y, z, state) {
    const { x: sx, y: sy, z: sz } = this.size
    if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) {
      throw new RangeError(`${this.id}: out of bounds at ${x},${y},${z}`)
    }
    const key = Structure.key(x, y, z)
    if (state === null) {
      this.blocks.delete(key)
    }
    else {
      this.blocks.set(key, state)
    }
  }

  get(x, y, z) {
    return this.blocks.get(Structure.key(x, y, z)) || null
  }

  fill(from, to, state) {
    for (let y = from.y; y <= to.y; y += 1) {
      for (let z = from.z; z <= to.z; z += 1) {
        for (let x = from.x; x <= to.x; x += 1) {
          this.set(x, y, z, state)
        }
      }
    }
  }

  get blockCount() {
    return this.blocks.size
  }

  toLitematic() {
    const palette = [block('minecraft:air')]
    const paletteLookup = new Map([[serializeBlockState(palette[0]), 0]])
    const indices = []

    for (let y = 0; y < this.size.y; y += 1) {
      for (let z = 0; z < this.size.z; z += 1) {
        for (let x = 0; x < this.size.x; x += 1) {
          const state = this.get(x, y, z) || palette[0]
          const serialized = serializeBlockState(state)
          let paletteIndex = paletteLookup.get(serialized)
          if (paletteIndex === undefined) {
            paletteIndex = palette.length
            paletteLookup.set(serialized, paletteIndex)
            palette.push(state)
          }
          indices.push(paletteIndex)
        }
      }
    }

    const now = BigInt(Date.now())

    return {
      name: '',
      type: 'compound',
      value: {
        MinecraftDataVersion: nbtInt(DATA_VERSION),
        Version: nbtInt(LITEMATIC_VERSION),
        SubVersion: nbtInt(1),
        Metadata: nbtCompound({
          Name: nbtString(this.id),
          Author: nbtString(this.author),
          Description: nbtString(this.description),
          RegionCount: nbtInt(1),
          TotalBlocks: nbtInt(indices.filter(value => value !== 0).length),
          TotalVolume: nbtInt(indices.length),
          TimeCreated: nbtLong(now),
          TimeModified: nbtLong(now),
          EnclosingSize: nbtCompound({
            x: nbtInt(this.size.x),
            y: nbtInt(this.size.y),
            z: nbtInt(this.size.z),
          }),
        }),
        Regions: nbtCompound({
          [this.id]: nbtCompound({
            Position: nbtCompound({ x: nbtInt(0), y: nbtInt(0), z: nbtInt(0) }),
            Size: nbtCompound({
              x: nbtInt(this.size.x),
              y: nbtInt(this.size.y),
              z: nbtInt(this.size.z),
            }),
            BlockStatePalette: nbtList('compound', palette.map(state => buildPaletteEntry(state))),
            BlockStates: { type: 'longArray', value: encodeBlockIndices(indices, palette.length) },
            Entities: nbtList('end', []),
            TileEntities: nbtList('end', []),
            PendingBlockTicks: nbtList('end', []),
            PendingFluidTicks: nbtList('end', []),
          }),
        }),
      },
    }
  }
}

// ---------------------------------------------------------------------------
// 回拉式活塞门
// ---------------------------------------------------------------------------

/**
 * 生成一扇「回拉式」活塞门。
 *
 * 每个活塞只能拉回 1 格, 所以每行左右各一个活塞, 各负责一半门板。
 * 门洞宽度固定 2 格; 高度由 rows 决定。
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {number} spec.rows 门高 (门洞竖直格数)
 */
function buildPullDoor(spec) {
  const { id, rows, description = '' } = spec

  const width = 2

  // x: 0=拉杆 1=左活塞 2=左暗格 3,4=门洞 5=右暗格 6=右活塞 7=拉杆
  const leftPistonX = 1
  const leftRecessX = 2
  const doorwayFrom = 3
  const doorwayTo = doorwayFrom + width - 1
  const rightRecessX = doorwayTo + 1
  const rightPistonX = rightRecessX + 1
  const rightLeverX = rightPistonX + 1
  const sizeX = rightLeverX + 1

  const size = { x: sizeX, y: rows + 3, z: 7 }
  const structure = new Structure(id, size, { description })

  structure.fill({ x: 0, y: 0, z: 0 }, { x: size.x - 1, y: 0, z: size.z - 1 }, FLOOR)

  const levers = []
  const pistons = []

  for (let row = 0; row < rows; row += 1) {
    const y = 1 + row

    // 门框: 门洞前后各留一圈, 让门板有地方待着
    for (let x = doorwayFrom; x <= doorwayTo; x += 1) {
      structure.set(x, y, GATE_Z - 1, FRAME)
    }

    // 左侧: 拉杆 -> 活塞(east) -> 活塞头 / 暗格
    structure.set(leftPistonX, y, GATE_Z, sticky('east', true))
    structure.set(leftRecessX, y, GATE_Z, pistonHead('east'))
    structure.set(leftPistonX - 1, y, GATE_Z, wallLever('west'))
    levers.push({ x: leftPistonX - 1, y, z: GATE_Z })
    pistons.push({ x: leftPistonX, y, z: GATE_Z })

    // 右侧: 拉杆 -> 活塞(west) -> 活塞头 / 暗格
    structure.set(rightPistonX, y, GATE_Z, sticky('west', true))
    structure.set(rightRecessX, y, GATE_Z, pistonHead('west'))
    structure.set(rightLeverX, y, GATE_Z, wallLever('east'))
    levers.push({ x: rightLeverX, y, z: GATE_Z })
    pistons.push({ x: rightPistonX, y, z: GATE_Z })

    // 门板
    for (let x = doorwayFrom; x <= doorwayTo; x += 1) {
      structure.set(x, y, GATE_Z, x % 2 === doorwayFrom % 2 ? GATE_A : GATE_B)
    }
  }

  // 顶部横梁
  for (let x = doorwayFrom; x <= doorwayTo; x += 1) {
    structure.set(x, rows + 1, GATE_Z, FRAME)
  }

  return { structure, levers, pistons, doorway: { from: doorwayFrom, to: doorwayTo, rows } }
}

/**
 * 生成一扇「地面闸门」。
 *
 * 活塞吊在门洞正上方朝下伸出, 把头压进门洞那一格; 断电后活塞收回, 门板被提上去一格,
 * 整排门洞变成空气 —— 这就是一道可以走过去的地面闸门 (portcullis 的简化版)。
 *
 *   y=3 拉杆 (立在地面式)
 *   y=2 粘性活塞 (facing=down)
 *   y=1 活塞头 (关门) / 门板 (开门后提上来)   <- 暗格
 *   y=0 门板 (关门) / 空气 (开门后让开)       <- 门洞
 *
 * 注意: 单台活塞只能带动一格, 所以闸门高度固定 1 格; 加高需要多级活塞,
 * 那是另一个结构, 这里只做可靠的单格闸门。
 */
function buildLiftGate(spec) {
  const { id, cols, description = '' } = spec

  const doorwayFrom = 2
  const doorwayTo = doorwayFrom + cols - 1
  const sizeX = doorwayTo + 2
  const size = { x: sizeX, y: 5, z: 5 }
  const structure = new Structure(id, size, { description })

  structure.fill({ x: 0, y: 0, z: 0 }, { x: size.x - 1, y: 0, z: size.z - 1 }, FLOOR)

  const levers = []
  const pistons = []

  for (let col = 0; col < cols; col += 1) {
    const x = doorwayFrom + col

    // 活塞吊在门洞上方, 朝下伸出, 头压在 y=1
    structure.set(x, 2, GATE_Z, sticky('down', true))
    structure.set(x, 1, GATE_Z, pistonHead('down'))
    // 活塞背面 (上方) 放拉杆。墙面拉杆只有水平朝向, 所以用立在地面上的拉杆。
    structure.set(x, 3, GATE_Z, floorLever('south'))
    levers.push({ x, y: 3, z: GATE_Z })
    pistons.push({ x, y: 2, z: GATE_Z })

    // 门板在 y=0 那格; 开门时被提到 y=1
    structure.set(x, 0, GATE_Z, col % 2 === 0 ? GATE_A : GATE_B)
  }

  // 门洞两侧立柱
  structure.fill({ x: 1, y: 0, z: GATE_Z }, { x: 1, y: 3, z: GATE_Z }, FRAME)
  structure.fill({ x: doorwayTo + 1, y: 0, z: GATE_Z }, { x: doorwayTo + 1, y: 3, z: GATE_Z }, FRAME)

  return { structure, levers, pistons }
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

function buildScenario({ structurePath, levers, pistons, openTick, closeTick, maxTicks }) {
  const lines = [
    'version = "26.1.2"',
    'mode = "default"',
    'seed = 0',
    `max_ticks = ${maxTicks}`,
    'strict = true',
    '',
    '[source]',
    `path = "${structurePath}"`,
    'initialization = "raw"',
    '',
  ]

  for (const leverPosition of levers) {
    lines.push('[[actions]]')
    lines.push(`tick = ${openTick}`)
    lines.push('type = "pull_lever"')
    lines.push(`pos = { x = ${leverPosition.x}, y = ${leverPosition.y}, z = ${leverPosition.z} }`)
    lines.push('')
  }
  for (const leverPosition of levers) {
    lines.push('[[actions]]')
    lines.push(`tick = ${closeTick}`)
    lines.push('type = "pull_lever"')
    lines.push(`pos = { x = ${leverPosition.x}, y = ${leverPosition.y}, z = ${leverPosition.z} }`)
    lines.push('')
  }

  // 用活塞的 extended 属性做断言。
  // 门洞格子用的是 block_state 探针, 它返回的是数值 state id 而不是方块名,
  // 没法直接和 "minecraft:air" 比较, 所以门洞是否真的让开交给
  // scripts/verify-redstone-doors.mjs 在 trace 上单独校验。
  for (let index = 0; index < pistons.length; index += 1) {
    const pistonPosition = pistons[index]
    lines.push('[[probes]]')
    lines.push(`name = "piston_${index}"`)
    lines.push('type = "property"')
    lines.push(`pos = { x = ${pistonPosition.x}, y = ${pistonPosition.y}, z = ${pistonPosition.z} }`)
    lines.push('property = "extended"')
    lines.push('')
  }

  for (let index = 0; index < pistons.length; index += 1) {
    lines.push('[[expectations]]')
    lines.push('tick = 1')
    lines.push(`probe = "piston_${index}"`)
    lines.push('equals = "true"')
    lines.push('')
  }
  for (let index = 0; index < pistons.length; index += 1) {
    lines.push('[[expectations]]')
    lines.push(`tick = ${openTick + 10}`)
    lines.push(`probe = "piston_${index}"`)
    lines.push('equals = "false"')
    lines.push('')
  }
  for (let index = 0; index < pistons.length; index += 1) {
    lines.push('[[expectations]]')
    lines.push(`tick = ${maxTicks}`)
    lines.push(`probe = "piston_${index}"`)
    lines.push('equals = "true"')
    lines.push('')
  }

  return `${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// 门目录
// ---------------------------------------------------------------------------

const DOORS = [
  {
    id: 'piston-pull-door-2x2',
    build: buildPullDoor,
    rows: 2,
    description: '2x2 回拉式活塞门。通电时门板封住门口, 拨动拉杆后活塞把两块门板分别拉进左右暗格, 门口整片让开。',
    openTick: 2,
    closeTick: 40,
    maxTicks: 80,
  },
  {
    id: 'piston-pull-door-2x3',
    build: buildPullDoor,
    rows: 3,
    description: '2x3 回拉式活塞门。六块门板分三行被活塞拉进两侧暗格, 适合当标准房门。',
    openTick: 2,
    closeTick: 40,
    maxTicks: 80,
  },
  {
    id: 'piston-pull-door-2x4',
    build: buildPullDoor,
    rows: 4,
    description: '2x4 高身回拉式活塞门。八块门板分四行收进两侧, 窄而高的门洞。',
    openTick: 2,
    closeTick: 40,
    maxTicks: 80,
  },
  {
    id: 'piston-lift-gate-3',
    build: buildLiftGate,
    cols: 3,
    description: '3 格宽的地面闸门。三台朝下的活塞把门板压在地面上, 拨动拉杆后活塞收回, 门板被提起来让出通道。',
    openTick: 2,
    closeTick: 40,
    maxTicks: 80,
  },
  {
    id: 'piston-lift-gate-5',
    build: buildLiftGate,
    cols: 5,
    description: '5 格宽的宽体地面闸门。一排活塞同时提起门板, 开口很宽。',
    openTick: 2,
    closeTick: 40,
    maxTicks: 80,
  },
]

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.mkdir(SCENARIO_DIR, { recursive: true })

  for (const door of DOORS) {
    const { structure, levers, pistons } = door.build(door)

    const nbt = writeUncompressed(structure.toLitematic(), 'big')
    const outputPath = path.join(OUTPUT_DIR, `${door.id}.litematic`)
    await fs.writeFile(outputPath, Buffer.from(pako.gzip(new Uint8Array(nbt))))

    const scenario = buildScenario({
      structurePath: `../${door.id}.litematic`,
      levers,
      pistons,
      openTick: door.openTick,
      closeTick: door.closeTick,
      maxTicks: door.maxTicks,
    })
    await fs.writeFile(path.join(SCENARIO_DIR, `${door.id}.toml`), scenario, 'utf8')

    console.log(`Generated: ${path.relative(ROOT, outputPath)}`)
    console.log(`  size: ${structure.size.x} x ${structure.size.y} x ${structure.size.z}`)
    console.log(`  blocks: ${structure.blockCount}  pistons: ${pistons.length}`)
    console.log(`  levers: ${levers.map(l => `${l.x},${l.y},${l.z}`).join(' ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
