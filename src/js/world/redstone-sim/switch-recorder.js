// 用红石模拟器（redstone-rs 的 WASM 构建）现场录一段「操作开关」的回放。
// 纯函数，不依赖 DOM / three.js / WASM 本身：模拟器通过一个小接口传进来，
// 所以 worker 和 node 测试都能用。输出是 litemora-redstone-replay-v1，
// 交给 packRedstoneReplay() 后由现有的 RedstoneReplayController 播放。

import { DEFAULT_RECORDING_TICKS, normalizeRedstoneSwitch } from './recording-config.js'
import { advanceUntilRest, MAX_PHASE_TICKS, PLATE_HOLD_QUIET_TICKS, requireSwitchType, runSwitchToRest, SwitchSimulationError } from './switch-animation.js'
import { resolveSwitchType, SWITCH_INPUTS } from './switch-types.js'

export { normalizeRedstoneSwitch, resolveSwitchType, SwitchSimulationError }

const REPLAY_FORMAT = 'litemora-redstone-replay-v1'
const AIR_BLOCK_STRING = 'minecraft:air'

// 活塞运动动画持续 2 刻，片段要在最后一次变化之后留出这段时间。
const SEGMENT_TAIL_TICKS = 2

export const SWITCH_TYPES = Object.freeze(Object.keys(SWITCH_INPUTS))

function blockKey(x, y, z) {
  return `${x},${y},${z}`
}

/**
 * 把模拟器包一层坐标平移：外部坐标 = 模拟器坐标 + delta。
 * 模拟器按结构文件里的偏移摆放 Sponge 结构，而渲染器从 (0, 0, 0) 起算，靠这个对齐。
 */
export function translateSimulator(sim, delta = {}) {
  const dx = Math.trunc(Number(delta.x || 0))
  const dy = Math.trunc(Number(delta.y || 0))
  const dz = Math.trunc(Number(delta.z || 0))
  if (!dx && !dy && !dz) {
    return sim
  }
  const shift = frames => (frames || []).map(frame => ({
    ...frame,
    changes: (frame.changes || []).map(change => ({ ...change, x: change.x + dx, y: change.y + dy, z: change.z + dz })),
  }))
  return {
    blockAt: (x, y, z) => sim.blockAt(x - dx, y - dy, z - dz),
    fingerprint: () => sim.fingerprint(),
    auxiliaryFingerprint: () => sim.auxiliaryFingerprint?.() ?? null,
    initialize: () => shift(sim.initialize?.() || []),
    step: ticks => shift(sim.step(ticks)),
    interact: (x, y, z, kind) => shift(sim.interact(x - dx, y - dy, z - dz, kind)),
  }
}

/**
 * @param {object} sim 模拟器接口：
 *   blockAt(x, y, z) -> 'minecraft:name[props]'
 *   fingerprint() -> string，方块、容器、实体和比较器输出的指纹
 *   auxiliaryFingerprint?() -> string，方块之外的持久状态，用于停稳和预热检查
 *   initialize?() -> frame[]，导入结构后的初始刷新，必须保留其变化帧
 *   step(ticks) -> frame[]，interact(x, y, z, kind) -> frame[]
 *   frame = { tick, changes: [{ x, y, z, state, previousState, microStep, cause }], pendingScheduledTicks }
 * @param {object} options
 * @param {{x:number,y:number,z:number}} options.position 开关坐标（原理图局部坐标）
 * @param {'open'|'closed'} [options.initialState] 原理图保存时门是开还是关
 * @param {string} [options.title] 回放标题
 * @param {'door'|'machine'} [options.recording] 往返门或定长机器演示
 * @param {number} [options.durationTicks] 机器模拟时长
 * @param {number|null} [options.dataVersion] 原理图的 DataVersion，只写进回放元数据
 */
export function recordSwitchReplay(sim, { position, initialState = 'closed', title = '', dataVersion = null, recording = 'door', durationTicks } = {}) {
  const config = normalizeRedstoneSwitch({ position, initialState, recording, durationTicks })
  if (!config) {
    throw new SwitchSimulationError('invalid_switch', '开关坐标无效')
  }
  const { x, y, z } = config.position || {}
  const switchKey = config.position && blockKey(x, y, z)
  const switchBlock = config.position && sim.blockAt(x, y, z)
  const switchType = config.position ? requireSwitchType(switchBlock, config.position) : ''

  const palette = [AIR_BLOCK_STRING]
  const paletteIndex = new Map([[AIR_BLOCK_STRING, 0]])
  const stateIndex = (blockString) => {
    const normalized = String(blockString || AIR_BLOCK_STRING)
    let index = paletteIndex.get(normalized)
    if (index === undefined) {
      index = palette.length
      palette.push(normalized)
      paletteIndex.set(normalized, index)
    }
    return index
  }

  const baseline = new Map()
  const frames = new Map()
  let changeCount = 0
  let lastTick = 0
  let lastChangeTick = 0
  let switchChanged = false
  let mechanismChanged = false
  let tickOrigin = 0
  const cycleChanges = new Map()
  const moving = new Set()
  const unsupportedEvents = new Set()

  const frameAt = (tick) => {
    let frame = frames.get(tick)
    if (!frame) {
      frame = { tick, changes: [], actions: [] }
      frames.set(tick, frame)
    }
    return frame
  }

  const record = (simFrames) => {
    for (const simFrame of simFrames || []) {
      lastTick = Number(simFrame.tick) - tickOrigin
      for (const event of simFrame.unsupported || []) {
        unsupportedEvents.add(event.behavior)
      }
      for (const change of simFrame.changes || []) {
        const key = blockKey(change.x, change.y, change.z)
        if (!baseline.has(key)) {
          baseline.set(key, { x: change.x, y: change.y, z: change.z, state: stateIndex(change.previousState) })
        }
        const before = String(change.previousState || AIR_BLOCK_STRING)
        const after = String(change.state || AIR_BLOCK_STRING)
        if (recording === 'machine') {
          if (after.startsWith('minecraft:moving_piston['))
            moving.add(key)
          else moving.delete(key)
        }
        const previous = cycleChanges.get(key)
        cycleChanges.set(key, { before: previous?.before ?? before, after })
        if (key !== switchKey && before !== after && (
          before.split('[')[0] !== after.split('[')[0]
          || String(change.cause || '').startsWith('piston_')
          || /(?:^|,)open=/.test(after.split('[')[1] || '')
        )) {
          mechanismChanged = true
        }
        frameAt(lastTick).changes.push({
          x: change.x,
          y: change.y,
          z: change.z,
          state: stateIndex(change.state),
          previousState: stateIndex(change.previousState),
          microStep: Number(change.microStep || 0),
          cause: String(change.cause || ''),
        })
        changeCount += 1
        lastChangeTick = lastTick
        if (key === switchKey) {
          switchChanged = true
        }
      }
    }
  }

  const recordInteraction = (simFrames, actionType) => {
    record(simFrames)
    if (actionType)
      frameAt(lastTick).actions.push({ microStep: 0, action: { type: actionType, pos: { x, y, z } } })
  }

  // 操作一次开关，直到机器停稳。返回这一段在时间线上的起止刻。
  const activate = () => {
    switchChanged = false
    const fromTick = lastTick
    if (!runSwitchToRest(sim, config.position, switchType, recordInteraction))
      throw new SwitchSimulationError('not_settled', `操作开关后 ${MAX_PHASE_TICKS} 刻内机器没有停下来，无法作为开关门使用`)
    if (!switchChanged) {
      throw new SwitchSimulationError('switch_inactive', '模拟器里操作这个开关没有任何反应')
    }
    return { fromTick, toTick: lastChangeTick + SEGMENT_TAIL_TICKS }
  }

  function finish(control, totalTicks, normalizedWireConnections = false) {
    const orderedFrames = [...frames.values()]
      .filter(frame => frame.tick <= totalTicks && (frame.changes.length || frame.actions.length))
      .sort((left, right) => left.tick - right.tick)
    for (const frame of orderedFrames) {
      frame.changes.sort((left, right) => left.microStep - right.microStep)
    }

    return {
      switchType,
      normalizedWireConnections,
      unsupportedEvents: [...unsupportedEvents],
      control,
      replay: {
        format: REPLAY_FORMAT,
        minecraftVersion: '26.1.2',
        dataVersion,
        engine: 'redstone-rs (wasm)',
        title: String(title || '').trim() || '红石开关',
        description: '',
        ticksPerSecond: 20,
        totalTicks,
        durationSeconds: totalTicks / 20,
        changeCount,
        palette,
        baseline: [...baseline.values()],
        frames: orderedFrames,
      },
    }
  }

  // 新加载的静态结构没有已有世界的计划刻，先刷新其电路并保留这部分变化。
  record(sim.initialize?.())
  if (recording === 'machine') {
    // Record one finite run, including machines which consume items or never go idle.
    if (switchType) {
      const [, kind, actionType] = SWITCH_INPUTS[switchType]
      if (!baseline.has(switchKey))
        baseline.set(switchKey, { x, y, z, state: stateIndex(switchBlock) })
      recordInteraction(sim.interact(x, y, z, kind), actionType)
      if (kind === 'plate_on' || kind === 'cart_on') {
        record(sim.step(PLATE_HOLD_QUIET_TICKS))
        recordInteraction(sim.interact(x, y, z, 'plate_off'), 'leave_sensor')
      }
    }
    const duration = config.durationTicks ?? DEFAULT_RECORDING_TICKS
    for (let tick = lastTick; tick < duration; tick += 20) {
      record(sim.step(Math.min(20, duration - tick)))
    }
    // Only finish motions already in progress at the cut. A continuously moving
    // machine can start another piston every tick and never be globally still.
    for (let extra = 0; moving.size && extra < 20; extra++) {
      for (const frame of sim.step(1)) {
        const changes = frame.changes.filter(change =>
          moving.has(blockKey(change.x, change.y, change.z)) && !change.state.startsWith('minecraft:moving_piston['))
        record([{ ...frame, changes }])
      }
    }
    if (moving.size)
      throw new SwitchSimulationError('unfinished_motion', '机器运行结束时仍有活塞未落位')
    return finish({ type: 'machine', switchPosition: config.position }, lastTick)
  }
  if (!advanceUntilRest(sim, record))
    throw new SwitchSimulationError('never_idle', '不操作开关时机器也在持续运行（例如时钟电路），无法作为开关门使用')
  let idleFingerprint = sim.fingerprint()
  const idleAuxiliaryFingerprint = sim.auxiliaryFingerprint?.() ?? null
  cycleChanges.clear()
  mechanismChanged = false

  // 操作一次就回到原状的是「脉冲」；操作两次才回到原状的是「开 / 关」。
  const recordCycle = () => {
    const result = [activate()]
    if (sim.fingerprint() !== idleFingerprint) {
      result.push(activate())
    }
    return result
  }
  let segments = recordCycle()
  let normalizedWireConnections = false
  if (sim.fingerprint() !== idleFingerprint) {
    // 一些旧格式转换文件把红石线连接全写成 none；首次更新才形成真实连接。
    // 仅允许四个连接方向变化，电量、门板位置和其他状态必须原样恢复。
    const withoutConnections = state => state.replace(/(?:east|north|south|west)=(?:none|side|up),?/g, '')
    const differences = [...cycleChanges.values()].filter(({ before, after }) => before !== after)
    const onlyWireConnections = differences.length > 0 && differences.every(({ before, after }) => (
      before.startsWith('minecraft:redstone_wire[')
      && after.startsWith('minecraft:redstone_wire[')
      && withoutConnections(before) === withoutConnections(after)
    ))
    if (onlyWireConnections && (sim.auxiliaryFingerprint?.() ?? null) === idleAuxiliaryFingerprint) {
      // 丢弃预热，按稳定后的完整状态重新录制；仍然要求精确往返，不忽略连接状态。
      for (const entry of baseline.values()) {
        entry.state = stateIndex(sim.blockAt(entry.x, entry.y, entry.z))
      }
      tickOrigin += lastTick
      frames.clear()
      cycleChanges.clear()
      changeCount = 0
      lastTick = 0
      lastChangeTick = 0
      mechanismChanged = false
      idleFingerprint = sim.fingerprint()
      segments = recordCycle()
      normalizedWireConnections = true
    }
    if (sim.fingerprint() !== idleFingerprint) {
      throw new SwitchSimulationError('not_reversible', '操作两次开关后机器没有回到初始状态，无法作为开关门使用')
    }
  }
  if (!mechanismChanged) {
    throw new SwitchSimulationError('no_door_motion', '开关有反应，但没有检测到门板或活塞运动；请检查接线、开关位置和模拟兼容性')
  }

  const mode = segments.length === 1 ? 'pulse' : 'toggle'
  const totalTicks = segments[segments.length - 1].toTick
  const control = {
    type: 'door',
    mode,
    initialState: config.initialState,
    switchPosition: { x, y, z },
    segments: mode === 'pulse'
      ? { pulse: segments[0] }
      : config.initialState === 'open'
        ? { close: segments[0], open: segments[1] }
        : { open: segments[0], close: segments[1] },
  }

  return finish(control, totalTicks, normalizedWireConnections)
}
