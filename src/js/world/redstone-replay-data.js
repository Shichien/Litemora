// 红石回放的解析与预处理。纯函数，不依赖 DOM / three.js，
// 同时供 Web Worker（redstone-replay.worker.js）和主线程兜底路径使用。
//
// 原始回放 JSON 里有几十万个 change 对象，在主线程上 JSON.parse + 遍历要 1 秒以上
// （慢 CPU 上 7 秒）。这里把它压成按列存放的类型化数组，worker 里算完后零拷贝转移给主线程。

const REPLAY_FORMAT = 'litemora-redstone-replay-v1'
export const PISTON_MOTION_DURATION_TICKS = 2
export const AIR_BLOCK_STRING = 'minecraft:air'

export const MOTION_CAUSE_MOVING_BLOCK = 'piston_moving_block'
const MOTION_CAUSE_RETRACTING_BASE = 'piston_retracting_base'

const BLOCK_DIRECTIONS = Object.freeze({
  down: Object.freeze({ x: 0, y: -1, z: 0 }),
  east: Object.freeze({ x: 1, y: 0, z: 0 }),
  north: Object.freeze({ x: 0, y: 0, z: -1 }),
  south: Object.freeze({ x: 0, y: 0, z: 1 }),
  up: Object.freeze({ x: 0, y: 1, z: 0 }),
  west: Object.freeze({ x: -1, y: 0, z: 0 }),
})

export function blockKey(x, y, z) {
  return `${x},${y},${z}`
}

function getBlockProperty(blockString, propertyName) {
  const propertiesMatch = String(blockString || '').match(/\[([^\]]*)\]$/u)
  if (!propertiesMatch) {
    return ''
  }

  for (const entry of propertiesMatch[1].split(',')) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex < 0) {
      continue
    }
    if (entry.slice(0, separatorIndex).trim() === propertyName) {
      return entry.slice(separatorIndex + 1).trim()
    }
  }
  return ''
}

function isMovingPistonBlock(blockString) {
  return String(blockString || '').startsWith('minecraft:moving_piston')
}

function createPistonHeadBlockString(facing, type) {
  return `minecraft:piston_head[facing=${facing},short=false,type=${type === 'sticky' ? 'sticky' : 'normal'}]`
}

function isRetractionBlockMovement(sourceClearMicroSteps, change, direction) {
  const sourceX = Number(change.x) + direction.x
  const sourceY = Number(change.y) + direction.y
  const sourceZ = Number(change.z) + direction.z
  const movingMicroStep = Number(change.microStep || 0)
  const latestSourceClear = sourceClearMicroSteps.get(blockKey(sourceX, sourceY, sourceZ))
  return Number.isFinite(latestSourceClear) && latestSourceClear >= movingMicroStep
}

// Long replays are stored as `.replay.json.gz` to stay under the static hosting
// per-file limit. The server may or may not add `Content-Encoding: gzip`, so the
// payload is sniffed for the gzip magic bytes instead of trusting headers.
async function parseReplayResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B
  if (!isGzip) {
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('当前浏览器不支持解压红石回放')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

export async function fetchRedstoneReplay(replayUrl) {
  const response = await fetch(replayUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`红石回放请求失败: ${response.status}`)
  }
  return parseReplayResponse(response)
}

function validateReplay(replay) {
  if (!replay || typeof replay !== 'object') {
    throw new Error('红石回放文件不是有效对象')
  }
  if (replay.format !== REPLAY_FORMAT) {
    throw new Error(`不支持的红石回放格式: ${replay.format || 'unknown'}`)
  }
  if (!Array.isArray(replay.palette) || !replay.palette.length) {
    throw new Error('红石回放缺少方块状态表')
  }
  if (!Array.isArray(replay.baseline) || !Array.isArray(replay.frames)) {
    throw new TypeError('红石回放缺少初始状态或时间线')
  }

  const paletteSize = replay.palette.length
  const validateState = (entry, label) => {
    if (!Number.isInteger(entry?.state) || entry.state < 0 || entry.state >= paletteSize) {
      throw new Error(`${label}引用了不存在的方块状态`)
    }
  }

  for (const entry of replay.baseline) {
    validateState(entry, '初始状态')
  }
  for (const frame of replay.frames) {
    if (!Number.isInteger(frame?.tick) || frame.tick < 0) {
      throw new Error('红石回放包含无效游戏刻')
    }
    for (const change of frame.changes || []) {
      validateState(change, `第 ${frame.tick} 游戏刻`)
    }
  }

  return replay
}

/**
 * 把原始回放压成按列存放的时间线。返回值只含普通对象、字符串数组和类型化数组，
 * 可以直接 postMessage（类型化数组的 buffer 见 getPackedReplayTransferables）。
 *
 * - 坐标去重成 posIndex：先 baseline，再按 change 首次出现的顺序。
 * - frame f 的变化是 change 下标 [frameChangeStart[f], frameChangeStart[f + 1])。
 * - changeMotion[c] 是该变化触发的活塞运动下标，-1 表示没有。
 * - 运动用到的方块字符串放在 strings 表里，*Str 数组存下标，-1 表示空串。
 */
export function packRedstoneReplay(rawReplay) {
  const replay = validateReplay(rawReplay)
  const palette = replay.palette
  const isAirState = new Uint8Array(palette.length)
  const isMovingState = new Uint8Array(palette.length)
  for (let state = 0; state < palette.length; state++) {
    isAirState[state] = palette[state] === AIR_BLOCK_STRING ? 1 : 0
    isMovingState[state] = isMovingPistonBlock(palette[state]) ? 1 : 0
  }

  // ---- 坐标去重 ----
  const posIndexByKey = new Map()
  const posXs = []
  const posYs = []
  const posZs = []
  const internPosition = (entry) => {
    const x = Number(entry.x)
    const y = Number(entry.y)
    const z = Number(entry.z)
    const key = blockKey(x, y, z)
    let index = posIndexByKey.get(key)
    if (index === undefined) {
      index = posXs.length
      posIndexByKey.set(key, index)
      posXs.push(x)
      posYs.push(y)
      posZs.push(z)
    }
    return index
  }

  const baseline = replay.baseline
  const baselinePos = new Int32Array(baseline.length)
  const baselineState = new Int32Array(baseline.length)
  for (let i = 0; i < baseline.length; i++) {
    baselinePos[i] = internPosition(baseline[i])
    baselineState[i] = baseline[i].state
  }

  const frames = replay.frames
  let changeCount = 0
  for (const frame of frames) {
    changeCount += frame.changes?.length || 0
  }
  const frameTicks = new Int32Array(frames.length)
  const frameChangeStart = new Int32Array(frames.length + 1)
  const changePos = new Int32Array(changeCount)
  const changeState = new Int32Array(changeCount)
  const changeMotion = new Int32Array(changeCount).fill(-1)

  // ---- 活塞运动时间线（逻辑与原 buildPistonMotionTimeline 一致） ----
  const strings = []
  const stringIndex = new Map()
  const internString = (value) => {
    if (!value) {
      return -1
    }
    let index = stringIndex.get(value)
    if (index === undefined) {
      index = strings.length
      stringIndex.set(value, index)
      strings.push(value)
    }
    return index
  }

  const motionStartTick = []
  const motionPos = []
  const motionStartX = []
  const motionStartY = []
  const motionStartZ = []
  const motionCause = []
  const motionRetraction = []
  const motionSettled = []
  const motionVisual = []
  const motionShortVisual = []
  const motionBase = []
  const motionStarts = []
  const unsettledByPos = new Map()

  let changeIndex = 0
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f]
    const changes = frame.changes || []
    frameTicks[f] = frame.tick
    frameChangeStart[f] = changeIndex

    let frameMotionCount = 0
    const sourceClearMicroSteps = new Map()
    for (const change of changes) {
      if (change.cause !== 'piston_source_clear') {
        continue
      }
      const key = blockKey(change.x, change.y, change.z)
      const microStep = Number(change.microStep || 0)
      sourceClearMicroSteps.set(key, Math.max(sourceClearMicroSteps.get(key) || 0, microStep))
    }

    for (const change of changes) {
      const posIndex = internPosition(change)
      changePos[changeIndex] = posIndex
      changeState[changeIndex] = change.state

      if (!isMovingState[change.state]) {
        const unsettled = unsettledByPos.get(posIndex)
        if (unsettled !== undefined) {
          motionSettled[unsettled] = internString(palette[change.state])
          unsettledByPos.delete(posIndex)
        }
        changeIndex++
        continue
      }

      const blockString = palette[change.state]
      const facing = getBlockProperty(blockString, 'facing')
      const direction = BLOCK_DIRECTIONS[facing]
      if (!direction) {
        throw new Error(`活塞运动缺少有效朝向: ${blockString}`)
      }

      const cause = String(change.cause || '')
      const isRetraction = cause === MOTION_CAUSE_RETRACTING_BASE
        || (
          cause === MOTION_CAUSE_MOVING_BLOCK
          && isRetractionBlockMovement(sourceClearMicroSteps, change, direction)
        )
      const startDirection = isRetraction ? 1 : -1
      const pistonType = getBlockProperty(blockString, 'type')
      const fullHeadBlockString = createPistonHeadBlockString(facing, pistonType)
      const shortHeadBlockString = fullHeadBlockString.replace('short=false', 'short=true')
      const isMovingBlock = cause === MOTION_CAUSE_MOVING_BLOCK

      const motionIndex = motionStartTick.length
      motionStartTick.push(frame.tick)
      motionPos.push(posIndex)
      motionStartX.push(posXs[posIndex] + (direction.x * startDirection))
      motionStartY.push(posYs[posIndex] + (direction.y * startDirection))
      motionStartZ.push(posZs[posIndex] + (direction.z * startDirection))
      motionCause.push(internString(cause))
      motionRetraction.push(isRetraction ? 1 : 0)
      motionSettled.push(-1)
      motionVisual.push(isMovingBlock ? -1 : internString(fullHeadBlockString))
      motionShortVisual.push(isMovingBlock ? -1 : internString(shortHeadBlockString))
      // 收回的活塞底座在运动期间显示它之前的状态；previousState 无效时与原逻辑一样落到空气
      motionBase.push(internString(
        cause === MOTION_CAUSE_RETRACTING_BASE
          ? (palette[change.previousState] || AIR_BLOCK_STRING)
          : AIR_BLOCK_STRING,
      ))

      changeMotion[changeIndex] = motionIndex
      frameMotionCount += 1
      unsettledByPos.set(posIndex, motionIndex)
      changeIndex++
    }
    if (frameMotionCount > 0) {
      motionStarts.push({ tick: frame.tick, count: frameMotionCount })
    }
  }
  frameChangeStart[frames.length] = changeIndex

  const motionCount = motionStartTick.length
  const motionBlockStrings = new Set()
  for (let m = 0; m < motionCount; m++) {
    if (motionSettled[m] < 0) {
      const p = motionPos[m]
      throw new Error(`活塞运动没有稳定状态: ${blockKey(posXs[p], posYs[p], posZs[p])} @ ${motionStartTick[m]}`)
    }
    if (strings[motionCause[m]] === MOTION_CAUSE_MOVING_BLOCK) {
      motionVisual[m] = motionSettled[m]
    }
    for (const index of [motionVisual[m], motionShortVisual[m], motionBase[m]]) {
      const blockString = strings[index]
      if (blockString && blockString !== AIR_BLOCK_STRING) {
        motionBlockStrings.add(blockString)
      }
    }
  }

  let maxConcurrentMotions = 0
  let activeMotionCount = 0
  const activeMotionStarts = []
  for (const entry of motionStarts) {
    activeMotionStarts.push(entry)
    activeMotionCount += entry.count
    while ((entry.tick - activeMotionStarts[0].tick) > PISTON_MOTION_DURATION_TICKS) {
      activeMotionCount -= activeMotionStarts.shift().count
    }
    maxConcurrentMotions = Math.max(maxConcurrentMotions, activeMotionCount)
  }

  // ---- 同时存在的非空气方块数上限（逻辑与原 getMaxActiveBlockCount 一致） ----
  const positionCount = posXs.length
  const lastState = new Int32Array(positionCount).fill(-1)
  let activeBlockCount = 0
  for (let i = 0; i < baseline.length; i++) {
    lastState[baselinePos[i]] = baselineState[i]
    if (!isAirState[baselineState[i]]) {
      activeBlockCount += 1
    }
  }
  let maxActiveBlockCount = activeBlockCount
  for (let c = 0; c < changeCount; c++) {
    const previous = lastState[changePos[c]]
    const wasActive = !isAirState[previous < 0 ? 0 : previous]
    const isActive = !isAirState[changeState[c]]
    if (wasActive !== isActive) {
      activeBlockCount += isActive ? 1 : -1
    }
    lastState[changePos[c]] = changeState[c]
    maxActiveBlockCount = Math.max(maxActiveBlockCount, activeBlockCount)
  }

  // ---- 需要预建模型的方块（顺序同原逻辑：baseline、changes，再是运动用到的） ----
  const templateBlockStrings = new Set()
  const collectState = (state) => {
    if (!isAirState[state] && !isMovingState[state]) {
      templateBlockStrings.add(palette[state])
    }
  }
  for (let i = 0; i < baseline.length; i++) {
    collectState(baselineState[i])
  }
  for (let c = 0; c < changeCount; c++) {
    collectState(changeState[c])
  }
  for (const blockString of motionBlockStrings) {
    templateBlockStrings.add(blockString)
  }

  // ---- 可交互的方块（拉杆/按钮等），回放局部坐标，去重 ----
  const actionTargetByKey = new Map()
  for (const frame of frames) {
    for (const entry of frame.actions || []) {
      const pos = entry?.action?.pos
      if (!pos) {
        continue
      }
      const x = Math.floor(Number(pos.x))
      const y = Math.floor(Number(pos.y))
      const z = Math.floor(Number(pos.z))
      actionTargetByKey.set(blockKey(x, y, z), [x, y, z])
    }
  }
  const actionTargets = new Float64Array(actionTargetByKey.size * 3)
  let actionOffset = 0
  for (const [x, y, z] of actionTargetByKey.values()) {
    actionTargets[actionOffset++] = x
    actionTargets[actionOffset++] = y
    actionTargets[actionOffset++] = z
  }

  const meta = {}
  for (const [key, value] of Object.entries(replay)) {
    if (key !== 'baseline' && key !== 'frames' && key !== 'palette') {
      meta[key] = value
    }
  }

  return {
    meta,
    palette,
    positionCount,
    posX: Float64Array.from(posXs),
    posY: Float64Array.from(posYs),
    posZ: Float64Array.from(posZs),
    baselinePos,
    baselineState,
    frameCount: frames.length,
    frameTicks,
    frameChangeStart,
    changePos,
    changeState,
    changeMotion,
    strings,
    motionCount,
    motionStartTick: Int32Array.from(motionStartTick),
    motionPos: Int32Array.from(motionPos),
    motionStartX: Float64Array.from(motionStartX),
    motionStartY: Float64Array.from(motionStartY),
    motionStartZ: Float64Array.from(motionStartZ),
    motionCause: Int32Array.from(motionCause),
    motionRetraction: Uint8Array.from(motionRetraction),
    motionSettled: Int32Array.from(motionSettled),
    motionVisual: Int32Array.from(motionVisual),
    motionShortVisual: Int32Array.from(motionShortVisual),
    motionBase: Int32Array.from(motionBase),
    maxConcurrentMotions,
    maxActiveBlockCount,
    templateBlockStrings: [...templateBlockStrings],
    actionTargets,
  }
}

export function getPackedReplayTransferables(packed) {
  return Object.values(packed)
    .filter(value => ArrayBuffer.isView(value))
    .map(value => value.buffer)
}
