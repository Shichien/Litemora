export const DEFAULT_RECORDING_TICKS = 200
const MAX_COORDINATE = 30_000_000

/** 投影条目上的 `redstoneSwitch` 字段：原理图局部坐标 + 初始门状态。无效时返回 null。 */
export function normalizeRedstoneSwitch(value = null) {
  const machine = value?.recording === 'machine'
  const durationTicks = value?.durationTicks ?? DEFAULT_RECORDING_TICKS
  if (machine && (!Number.isInteger(durationTicks) || durationTicks < 40 || durationTicks > 2400)) {
    return null
  }
  const mode = machine
    ? { recording: 'machine', ...(durationTicks === DEFAULT_RECORDING_TICKS ? {} : { durationTicks }) }
    : { initialState: value?.initialState === 'open' ? 'open' : 'closed' }
  if (machine && value.position == null) {
    return { ...mode, position: null }
  }
  const position = value?.position
  if (!position || typeof position !== 'object') {
    return null
  }
  const normalized = {}
  for (const axis of ['x', 'y', 'z']) {
    const coordinate = Number(position[axis])
    if (!Number.isInteger(coordinate) || Math.abs(coordinate) > MAX_COORDINATE) {
      return null
    }
    normalized[axis] = coordinate
  }
  return {
    position: normalized,
    ...mode,
  }
}
