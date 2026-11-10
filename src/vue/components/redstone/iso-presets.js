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
