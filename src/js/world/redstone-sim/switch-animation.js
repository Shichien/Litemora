import { resolveSwitchType, SWITCH_INPUTS } from './switch-types.js'

const QUIET_TICKS = 12
export const PLATE_HOLD_QUIET_TICKS = 20
export const MAX_PHASE_TICKS = 2400

export class SwitchSimulationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SwitchSimulationError'
    this.code = code
  }
}

export function simulatorFromWasm(native) {
  return {
    blockAt: (x, y, z) => native.block_at(x, y, z),
    fingerprint: () => native.fingerprint(),
    auxiliaryFingerprint: () => native.auxiliary_fingerprint(),
    initialize: () => JSON.parse(native.initialize()),
    step: ticks => JSON.parse(native.step(ticks)),
    interact: (x, y, z, kind) => JSON.parse(native.interact(x, y, z, kind)),
  }
}

export function requireSwitchType(block, { x, y, z }) {
  const type = resolveSwitchType(block)
  if (!type)
    throw new SwitchSimulationError('not_a_switch', `(${x}, ${y}, ${z}) 是 ${String(block).split('[')[0]}，请选择能触发机器的输入元件`)
  return type
}

// Pistons and inventory devices can still be active with no scheduled block ticks.
export function advanceUntilRest(sim, record, holding = false) {
  const quietTicks = holding ? PLATE_HOLD_QUIET_TICKS : QUIET_TICKS
  let previousAuxiliary = sim.auxiliaryFingerprint?.()
  let quiet = 0
  for (let elapsed = 0; elapsed < MAX_PHASE_TICKS; elapsed++) {
    const frames = sim.step(1)
    record(frames)
    const frame = frames[0]
    const auxiliary = sim.auxiliaryFingerprint?.()
    quiet = frame.changes?.length || auxiliary !== previousAuxiliary ? 0 : quiet + 1
    previousAuxiliary = auxiliary
    // An occupied plate keeps scheduling its own checks until the entity leaves.
    if (quiet >= quietTicks && (holding || Number(frame.pendingScheduledTicks ?? 0) === 0))
      return true
  }
  return false
}

/** Perform one physical activation, including leaving a plate or detector rail. */
export function runSwitchToRest(sim, position, switchType, record) {
  const { x, y, z } = position
  const [, kind, actionType] = SWITCH_INPUTS[switchType]
  record(sim.interact(x, y, z, kind), actionType)
  if (kind === 'plate_on' || kind === 'cart_on') {
    const held = advanceUntilRest(sim, record, true)
    record(sim.interact(x, y, z, 'plate_off'), switchType === 'pressure_plate' ? 'step_off_pressure_plate' : 'leave_sensor')
    if (!held)
      return false
  }
  return advanceUntilRest(sim, record)
}
