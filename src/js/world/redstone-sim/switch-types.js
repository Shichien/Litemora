// Each interaction is a physical input to the simulation. Other components
// operate as part of the circuit without needing an upload marker.
export const SWITCH_INPUTS = {
  note_block: ['音符盒', 'use', 'use_block'],
  lever: ['拉杆', 'lever', 'pull_lever'],
  button: ['按钮', 'button', 'press_button'],
  pressure_plate: ['压力板', 'plate_on', 'step_on_pressure_plate'],
  tripwire: ['绊线', 'plate_on', 'step_on_tripwire'],
  detector_rail: ['探测铁轨', 'cart_on', 'place_minecart'],
  target: ['标靶', 'target', 'hit_target'],
  sculk_sensor: ['幽匿感测体', 'step', 'step_on_block'],
  calibrated_sculk_sensor: ['校频幽匿感测体', 'step', 'step_on_block'],
  sculk_shrieker: ['幽匿尖啸体', 'step', 'step_on_block'],
  big_dripleaf: ['大型垂滴叶', 'step', 'step_on_block'],
  redstone_ore: ['红石矿石', 'step', 'step_on_block'],
  deepslate_redstone_ore: ['深层红石矿石', 'step', 'step_on_block'],
  lightning_rod: ['避雷针', 'lightning', 'strike_lightning_rod'],
  lectern: ['讲台', 'use', 'use_block'],
}

export function resolveSwitchType(blockString = '') {
  const name = String(blockString).split('[')[0]
  if (!/^minecraft:[a-z0-9_]+$/.test(name)) {
    return ''
  }
  const path = name.slice('minecraft:'.length)
  for (const family of ['button', 'pressure_plate', 'lightning_rod']) {
    if (path.endsWith(`_${family}`)) {
      return family
    }
  }
  return Object.hasOwn(SWITCH_INPUTS, path) ? path : ''
}
