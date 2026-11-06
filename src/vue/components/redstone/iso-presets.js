// Ready-made IsoScene block lists shared by pages (hero art, empty states, loaders).
// Coordinates are block units, y up. See IsoScene.vue for the spec fields.

const DUST_OFF = '#4a0d08'
const DUST_ON = '#ff2a10'

function dust(x, y, z, axis = 'x') {
  return {
    x,
    y,
    z,
    kind: 'plate',
    tex: 'redstone_dust_line0',
    rot: axis === 'x' ? 90 : 0,
    tint: DUST_OFF,
    tintOn: DUST_ON,
    power: true,
  }
}

function floor(x0, x1, z0, z1, tex = 'deepslate_tiles', y = 0) {
  const out = []
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      out.push({ x, y, z, tex })
    }
  }
  return out
}

// Lever → dust → repeater → dust → lamp on a deepslate slab; a small redstone build.
export function redstoneCircuitScene() {
  return [
    ...floor(0, 6, 0, 3),
    // lever on a block
    { x: 0, y: 1, z: 1, tex: 'polished_deepslate' },
    { x: 0, y: 2, z: 1, kind: 'sprite', tex: 'lever' },
    dust(1, 1, 1),
    dust(2, 1, 1),
    { x: 3, y: 1, z: 1, kind: 'plate', tex: 'repeater', texOn: 'repeater_on', rot: 270, power: true },
    dust(4, 1, 1),
    // lamp tower
    { x: 5, y: 1, z: 1, tex: 'redstone_lamp', texOn: 'redstone_lamp_on', power: true },
    { x: 5, y: 2, z: 1, tex: 'deepslate_bricks' },
    { x: 5, y: 3, z: 1, tex: 'redstone_lamp', texOn: 'redstone_lamp_on', power: true },
    // back wall
    { x: 6, y: 1, z: 0, tex: 'deepslate_bricks' },
    { x: 6, y: 2, z: 0, tex: 'deepslate_bricks' },
    { x: 6, y: 1, z: 1, tex: 'deepslate_bricks' },
    { x: 6, y: 1, z: 2, tex: 'deepslate_bricks' },
    // redstone block + torch at the front
    { x: 2, y: 1, z: 3, tex: 'redstone_block', glow: true },
    { x: 4, y: 1, z: 3, kind: 'sprite', tex: 'redstone_torch_off', texOn: 'redstone_torch', power: true },
    { x: 1, y: 1, z: 3, tex: 'tuff_bricks' },
  ]
}

// Small deepslate house with glass windows and a lit torch: "architecture" motif.
export function deepslateHouseScene() {
  const blocks = [...floor(0, 4, 0, 4, 'polished_deepslate')]
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x <= 4; x++) {
      for (let z = 0; z <= 4; z++) {
        const edge = x === 0 || x === 4 || z === 0 || z === 4
        if (!edge) {
          continue
        }
        const corner = (x === 0 || x === 4) && (z === 0 || z === 4)
        const window = !corner && y === 2 && (x === 2 || z === 2)
        const door = x === 2 && z === 4 && y <= 2
        if (door) {
          continue
        }
        blocks.push(window
          ? { x, y, z, tex: 'glass', glass: true }
          : { x, y, z, tex: corner ? 'dark_oak_log' : 'deepslate_bricks', top: corner ? 'dark_oak_log_top' : undefined })
      }
    }
  }
  for (let x = 0; x <= 4; x++) {
    for (let z = 0; z <= 4; z++) {
      blocks.push({ x, y: 4, z, tex: 'deepslate_tiles' })
    }
  }
  blocks.push({ x: 2, y: 5, z: 2, tex: 'redstone_lamp', texOn: 'redstone_lamp_on', power: true })
  blocks.push({ x: 1, y: 1, z: 5, tex: 'polished_deepslate' })
  blocks.push({ x: 1, y: 2, z: 5, kind: 'sprite', tex: 'redstone_torch', glow: true })
  return blocks
}

// A single block, for small icons and loaders.
export function singleBlockScene(tex = 'redstone_lamp', options = {}) {
  return [{ x: 0, y: 0, z: 0, tex, ...options }]
}
