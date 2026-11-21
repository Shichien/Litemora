import init, { RedstoneSim as WasmRedstoneSim } from '../src/js/world/redstone-sim/pkg/redstone_wasm.js'
import { advanceUntilRest, requireSwitchType, runSwitchToRest, simulatorFromWasm, SwitchSimulationError } from '../src/js/world/redstone-sim/switch-animation.js'

export { simulateSwitchReplay } from '../src/js/world/redstone-sim/switch-sim-loader.js'

export class RedstoneSim extends WasmRedstoneSim {
  /** Activate one input (or continue the current motion) and retain the resulting world. */
  runAnimation(position) {
    const sim = simulatorFromWasm(this)
    let switchType
    if (position !== undefined) {
      const { x, y, z } = position ?? {}
      if (![x, y, z].every(n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647))
        throw new SwitchSimulationError('invalid_switch', '请传入三个有符号 32 位整数坐标')
      switchType = requireSwitchType(sim.blockAt(x, y, z), position)
    }
    const fromTick = this.tick()
    const frames = sim.initialize()
    const record = batch => frames.push(...batch)
    const settled = switchType
      ? runSwitchToRest(sim, position, switchType, record)
      : advanceUntilRest(sim, record)
    return { fromTick, toTick: this.tick(), settled, frames }
  }
}

// wasm-bindgen caches the instance after loading. Share in-flight loads too:
// replacing that instance would invalidate simulations created by the first caller.
let wasmReady
export function initRedstoneWasm(options) {
  wasmReady ??= init(options).catch((error) => {
    wasmReady = undefined
    throw error
  })
  return wasmReady
}

/** Read the same block counts and bounds as the upload preview, without changing the active world. */
export async function inspectSchematic(buffer, fileName = '') {
  if (!(buffer instanceof ArrayBuffer))
    throw new TypeError('inspectSchematic expects an ArrayBuffer')
  const { default: service } = await import('../src/js/world/terrain/schematic-service.js')
  const schematic = await service.parseArrayBuffer(buffer, { remember: false, sourceName: fileName })
  return { format: schematic.format, dataVersion: schematic.dataVersion, ...service.getPreview(schematic) }
}
