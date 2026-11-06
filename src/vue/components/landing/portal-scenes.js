// IsoScene block lists for the portal home page.
// Coordinates are block units, y up. Camera: yaw 45 / pitch -30, so the west (x = min)
// and south (z = max) faces point at the viewer; detail goes on those two walls.

const DUST_OFF = '#4a0d08'
const DUST_ON = '#ff2a10'

function dust(x, y, z, axis = 'x', tex = 'redstone_dust_line0') {
  return { x, y, z, kind: 'plate', tex, rot: axis === 'x' ? 90 : 0, tint: DUST_OFF, tintOn: DUST_ON, power: true }
}

function lamp(x, y, z) {
  return { x, y, z, tex: 'redstone_lamp', texOn: 'redstone_lamp_on', power: true }
}

// Hero: a deepslate gallery building on a plinth, wired to a lever in the yard.
// Pulling the lever (scene `powered`) lights the dust, the repeater and every lamp.
export function heroBuildScene() {
  const blocks = []
  const X0 = 0
  const X1 = 8
  const Z0 = 0
  const Z1 = 6

  // Plinth: polished rim, tiled yard.
  for (let x = X0; x <= X1; x++) {
    for (let z = Z0; z <= Z1; z++) {
      const rim = x === X0 || z === Z1
      blocks.push({ x, y: 0, z, tex: rim ? 'polished_deepslate' : 'deepslate_tiles' })
    }
  }

  // Building footprint x 4..8, z 0..3, three storeys of wall.
  const BX0 = 4
  const BX1 = 8
  const BZ0 = 0
  const BZ1 = 3
  for (let y = 1; y <= 3; y++) {
    for (let x = BX0; x <= BX1; x++) {
      for (let z = BZ0; z <= BZ1; z++) {
        const onX = x === BX0 || x === BX1
        const onZ = z === BZ0 || z === BZ1
        if (!onX && !onZ) {
          continue
        }
        const corner = onX && onZ
        const southFace = z === BZ1 && !corner
        const westFace = x === BX0 && !corner
        // Doorway in the south wall.
        if (southFace && x === 6 && y <= 2) {
          continue
        }
        if (corner) {
          blocks.push({ x, y, z, tex: 'dark_oak_log', top: 'dark_oak_log_top' })
        }
        else if (y === 3 && (southFace || westFace)) {
          // Lamp frieze under the roof line.
          blocks.push(lamp(x, y, z))
        }
        else if (y === 2 && ((southFace && x !== 6) || (westFace && z === 2) || (westFace && z === 1))) {
          blocks.push({ x, y, z, tex: 'glass', glass: true })
        }
        else {
          blocks.push({ x, y, z, tex: y === 1 ? 'polished_deepslate' : 'deepslate_bricks' })
        }
      }
    }
  }

  // Roof deck, then a stepped upper tier and a beacon lamp.
  for (let x = BX0; x <= BX1; x++) {
    for (let z = BZ0; z <= BZ1; z++) {
      blocks.push({ x, y: 4, z, tex: 'deepslate_tiles' })
    }
  }
  for (let x = BX0 + 1; x <= BX1 - 1; x++) {
    for (let z = BZ0 + 1; z <= BZ1 - 1; z++) {
      blocks.push({ x, y: 5, z, tex: 'chiseled_deepslate' })
    }
  }
  blocks.push(lamp(6, 6, 1))

  // Interior lamp seen through the doorway.
  blocks.push(lamp(6, 1, 1))

  // Yard circuit: lever → dust → repeater → dust → into the doorway.
  blocks.push({ x: 0, y: 1, z: 4, tex: 'polished_deepslate' })
  blocks.push({ x: 0, y: 2, z: 4, kind: 'sprite', tex: 'lever' })
  blocks.push(dust(1, 1, 4, 'x'))
  blocks.push(dust(2, 1, 4, 'x'))
  blocks.push({ x: 3, y: 1, z: 4, kind: 'plate', tex: 'repeater', texOn: 'repeater_on', rot: 270, power: true })
  blocks.push(dust(4, 1, 4, 'x'))
  blocks.push(dust(5, 1, 4, 'x'))
  blocks.push(dust(6, 1, 4, 'x', 'redstone_dust_dot'))
  blocks.push(dust(6, 1, 3, 'z'))

  // Lamp post at the back-left corner of the yard, clear of the circuit.
  blocks.push({ x: 1, y: 1, z: 1, tex: 'deepslate_bricks' })
  blocks.push({ x: 1, y: 2, z: 1, kind: 'sprite', tex: 'redstone_torch_off', texOn: 'redstone_torch', power: true })
  // A redstone block on the plinth corner: the always-on source.
  blocks.push({ x: 8, y: 1, z: 6, tex: 'redstone_block', glow: true })
  blocks.push({ x: 7, y: 1, z: 6, tex: 'tuff_bricks' })

  return blocks
}

function plinth(size = 3, tex = 'polished_deepslate') {
  const out = []
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      out.push({ x, y: 0, z, tex })
    }
  }
  return out
}

// Small builds for discover cards without a thumbnail. Each has a powered part
// that lights while the card is hovered or focused.
const PLACEHOLDER_BUILDS = [
  // Lamp tower
  () => [
    ...plinth(3, 'deepslate_tiles'),
    { x: 1, y: 1, z: 1, tex: 'deepslate_bricks' },
    lamp(1, 2, 1),
    { x: 1, y: 3, z: 1, tex: 'chiseled_deepslate' },
    dust(0, 1, 1, 'x'),
    { x: 1, y: 1, z: 2, kind: 'plate', tex: 'repeater', texOn: 'repeater_on', rot: 0, power: true },
  ],
  // Piston + observer pair
  () => [
    ...plinth(3),
    { x: 1, y: 1, z: 1, tex: 'piston_side', top: 'piston_top' },
    { x: 1, y: 2, z: 1, tex: 'observer_side', top: 'observer_top' },
    { x: 2, y: 1, z: 1, tex: 'redstone_block', glow: true },
    dust(0, 1, 1, 'x'),
    dust(1, 1, 2, 'z'),
  ],
  // Small hut
  () => [
    ...plinth(3, 'deepslate_tiles'),
    { x: 0, y: 1, z: 0, tex: 'dark_oak_log', top: 'dark_oak_log_top' },
    { x: 1, y: 1, z: 0, tex: 'deepslate_bricks' },
    { x: 0, y: 1, z: 1, tex: 'glass', glass: true },
    { x: 1, y: 1, z: 1, tex: 'deepslate_bricks' },
    { x: 0, y: 2, z: 0, tex: 'deepslate_tiles' },
    { x: 1, y: 2, z: 0, tex: 'deepslate_tiles' },
    { x: 0, y: 2, z: 1, tex: 'deepslate_tiles' },
    lamp(1, 2, 1),
    { x: 2, y: 1, z: 2, kind: 'sprite', tex: 'redstone_torch_off', texOn: 'redstone_torch', power: true },
  ],
  // Target + comparator
  () => [
    ...plinth(3),
    { x: 1, y: 1, z: 0, tex: 'target_side', top: 'target_top' },
    { x: 1, y: 1, z: 1, kind: 'plate', tex: 'comparator', texOn: 'comparator_on', rot: 0, power: true },
    dust(1, 1, 2, 'z'),
    lamp(0, 1, 2),
    { x: 2, y: 1, z: 0, tex: 'copper_block' },
  ],
]

export const PLACEHOLDER_BUILD_COUNT = PLACEHOLDER_BUILDS.length

export function placeholderBuildScene(variant = 0) {
  const index = ((Math.round(Number(variant) || 0) % PLACEHOLDER_BUILDS.length) + PLACEHOLDER_BUILDS.length) % PLACEHOLDER_BUILDS.length
  return PLACEHOLDER_BUILDS[index]()
}

// Single-block icons used for step cards and stats.
export function iconBlock(tex, options = {}) {
  return [{ x: 0, y: 0, z: 0, tex, ...options }]
}
