// Apply only the final block arrangement caused by a recorded client block event.
// No redstone, neighbour updates, scheduled ticks or entity motion are simulated.
const DIRECTIONS = [
  { name: 'down', x: 0, y: -1, z: 0 },
  { name: 'up', x: 0, y: 1, z: 0 },
  { name: 'north', x: 0, y: 0, z: -1 },
  { name: 'south', x: 0, y: 0, z: 1 },
  { name: 'west', x: -1, y: 0, z: 0 },
  { name: 'east', x: 1, y: 0, z: 0 },
]
const PISTONS = new Set(['minecraft:piston', 'minecraft:sticky_piston'])
const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])
const IMMOBILE = new Set(`
  obsidian crying_obsidian bedrock barrier reinforced_deepslate budding_amethyst
  end_portal_frame end_portal end_gateway nether_portal structure_void
  command_block chain_command_block repeating_command_block structure_block jigsaw
  chest trapped_chest ender_chest barrel furnace blast_furnace smoker
  dispenser dropper hopper brewing_stand enchanting_table beacon spawner trial_spawner
  vault crafter chiseled_bookshelf decorated_pot jukebox lectern bell
  bee_nest beehive conduit
`.trim().split(/\s+/))
// boundingBox === 'block' also describes slabs and other partial shapes; it is
// not push-reaction data. Only known vanilla movable cubes are accepted here.
const MOVABLE = new Set(`
  stone granite polished_granite diorite polished_diorite andesite polished_andesite
  cobblestone mossy_cobblestone smooth_stone deepslate cobbled_deepslate polished_deepslate
  deepslate_bricks cracked_deepslate_bricks deepslate_tiles cracked_deepslate_tiles chiseled_deepslate
  tuff polished_tuff tuff_bricks chiseled_tuff chiseled_tuff_bricks calcite dripstone_block
  dirt coarse_dirt rooted_dirt grass_block podzol mycelium mud packed_mud mud_bricks
  sand red_sand gravel clay sandstone chiseled_sandstone cut_sandstone smooth_sandstone
  red_sandstone chiseled_red_sandstone cut_red_sandstone smooth_red_sandstone
  bricks stone_bricks mossy_stone_bricks cracked_stone_bricks chiseled_stone_bricks
  netherrack nether_bricks red_nether_bricks cracked_nether_bricks chiseled_nether_bricks
  basalt polished_basalt smooth_basalt blackstone polished_blackstone chiseled_polished_blackstone
  polished_blackstone_bricks cracked_polished_blackstone_bricks gilded_blackstone
  end_stone end_stone_bricks purpur_block purpur_pillar quartz_block chiseled_quartz_block
  quartz_pillar smooth_quartz quartz_bricks prismarine prismarine_bricks dark_prismarine
  glass tinted_glass terracotta coal_block iron_block gold_block diamond_block emerald_block
  netherite_block lapis_block redstone_block raw_iron_block raw_copper_block raw_gold_block
  amethyst_block sea_lantern glowstone shroomlight
  hay_block dried_kelp_block bone_block bookshelf tnt sponge wet_sponge
  ice packed_ice blue_ice snow_block magma_block soul_soil nether_wart_block warped_wart_block
  nether_gold_ore nether_quartz_ore ancient_debris bamboo_block stripped_bamboo_block bamboo_mosaic
  crafting_table cartography_table
  fletching_table smithing_table loom target observer note_block
`.trim().split(/\s+/))
const WOOD = /^(?:(?:stripped_)?(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(?:log|wood)|(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_planks|(?:stripped_)?(?:crimson|warped)_(?:stem|hyphae))$/
const COLORED_CUBE = /^(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(?:wool|concrete|concrete_powder|stained_glass|terracotta)$/
const ORE = /^(?:deepslate_)?(?:coal|iron|copper|gold|redstone|emerald|lapis|diamond)_ore$/
const COPPER = /^(?:waxed_)?(?:copper_block|(?:exposed|weathered|oxidized)_copper|(?:(?:exposed|weathered|oxidized)_)?(?:cut_copper|chiseled_copper|copper_bulb))$/
const registryIndexes = new WeakMap()

class UnsupportedPiston extends Error {}

function stateKey(name, properties) {
  return `${name}:${JSON.stringify(Object.entries(properties || {}).map(([key, value]) => [key, String(value)]).sort(([a], [b]) => a.localeCompare(b)))}`
}

function registryIndex(states) {
  let index = registryIndexes.get(states)
  if (!index) {
    index = new Map()
    states.forEach((state, id) => {
      // Only these blocks need synthesized variants; moved blocks retain IDs.
      if (state && (PISTONS.has(state.name) || state.name === 'minecraft:piston_head' || state.name === 'minecraft:air')) {
        const key = stateKey(state.name, state.properties)
        if (!index.has(key))
          index.set(key, id)
      }
    })
    registryIndexes.set(states, index)
  }
  return index
}

function variant(index, name, properties = {}) {
  const id = index.get(stateKey(name, properties))
  if (id === undefined)
    throw new UnsupportedPiston(`missing registry variant ${name}[${Object.entries(properties).map(([key, value]) => `${key}=${value}`).join(',')}]`)
  return id
}

function positionKey({ x, y, z }) {
  return `${x},${y},${z}`
}

function relative(origin, direction, distance) {
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance }
}

function readCell(world, position) {
  const { x, y, z } = position
  // The parser can omit all-air sections of otherwise loaded chunks. The
  // playback's load predicate also knows the current dimension's height limits.
  const loaded = typeof world.isPositionLoaded === 'function'
    ? world.isPositionLoaded(x, y, z)
    : world.sections.has(`${Math.floor(x / 16)},${Math.floor(y / 16)},${Math.floor(z / 16)}`)
  if (!loaded)
    throw new UnsupportedPiston(`unloaded or out-of-bounds position ${positionKey(position)}`)
  const id = world.blockAt(x, y, z)
  const state = world.replay.blockStates[id]
  if (!Number.isInteger(id) || !state || typeof state.name !== 'string')
    throw new UnsupportedPiston(`unknown block state ${id} at ${positionKey(position)}`)
  if (world.blockEntities.has(positionKey(position)))
    throw new UnsupportedPiston(`block entity ${state.name} at ${positionKey(position)} is unsupported`)
  return { ...position, id, state }
}

function assertMovable(cell) {
  const { name, properties, boundingBox } = cell.state
  if (name === 'minecraft:slime_block' || name === 'minecraft:honey_block')
    throw new UnsupportedPiston(`slime/honey adhesion is unsupported (${name} at ${positionKey(cell)})`)
  if (name === 'minecraft:moving_piston' || name === 'minecraft:piston_head' || PISTONS.has(name))
    throw new UnsupportedPiston(`transient or nested piston geometry is unsupported (${name} at ${positionKey(cell)})`)
  const vanilla = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : ''
  if (IMMOBILE.has(vanilla) || /(?:^|_)shulker_box$/.test(vanilla))
    throw new UnsupportedPiston(`immovable/block-entity block ${name} at ${positionKey(cell)} is unsupported`)
  if (String(properties?.waterlogged) === 'true')
    throw new UnsupportedPiston(`waterlogged block ${name} at ${positionKey(cell)} is unsupported`)
  if (boundingBox !== 'block' || !(MOVABLE.has(vanilla) || WOOD.test(vanilla) || COLORED_CUBE.test(vanilla) || ORE.test(vanilla) || COPPER.test(vanilla)))
    throw new UnsupportedPiston(`unknown shape or piston reaction for ${name} at ${positionKey(cell)}`)
}

function matchingHead(cell, facing, type) {
  const properties = cell.state.properties
  return cell.state.name === 'minecraft:piston_head'
    && properties?.facing === facing && properties?.type === type
    && String(properties?.short) === 'false'
}

function applyPlan(world, plan) {
  for (const { cell, state } of plan) {
    if (cell.id !== state)
      world.setBlock({ x: cell.x, y: cell.y, z: cell.z, state })
  }
  return { handled: true }
}

/**
 * Apply one recorded Java piston blockAction to a playback world, synchronously.
 *
 * Supports straight pushes of <=12 known movable solids into known air, simple
 * sticky pulls of one such block, and normal/drop retractions. Uses only state
 * IDs from the supplied immutable registry, preserving moved block properties.
 * Events must be consumed in packet order; later block packets remain authoritative.
 * No interpolation, moving-piston block entities, adhesion, destruction, fluid
 * changes or neighbour shape updates are synthesized. Unsupported cases return
 * { handled: false, warning } WITHOUT changing any blocks. Unrelated events return
 * { handled: false }. A matching settled extension is an idempotent success.
 */
export function applyRecordedPiston(world, event) {
  if ((event?.kind || event?.type) !== 'blockAction' || !PISTONS.has(event.block))
    return { handled: false }
  try {
    if (!Array.isArray(world?.replay?.blockStates) || typeof world.blockAt !== 'function'
      || typeof world.setBlock !== 'function' || !world.sections?.has || !world.blockEntities?.has) {
      throw new UnsupportedPiston('incomplete playback world contract')
    }
    if (!['x', 'y', 'z'].every(axis => Number.isSafeInteger(event[axis])))
      throw new UnsupportedPiston('invalid block position')
    if (![0, 1, 2].includes(event.action))
      throw new UnsupportedPiston(`unknown piston action ${event.action}`)
    if (!Number.isInteger(event.parameter) || !DIRECTIONS[event.parameter])
      throw new UnsupportedPiston(`invalid piston direction ${event.parameter}`)
    const direction = DIRECTIONS[event.parameter]
    const base = readCell(world, event)
    if (base.state.name !== event.block)
      throw new UnsupportedPiston(`block mismatch at the piston base: found ${base.state.name}, expected ${event.block}`)
    if (base.state.properties?.facing !== direction.name)
      throw new UnsupportedPiston('event direction does not match the piston facing')
    const extended = String(base.state.properties?.extended)
    if (extended !== 'true' && extended !== 'false')
      throw new UnsupportedPiston('piston state has no valid extended property')
    const type = event.block === 'minecraft:sticky_piston' ? 'sticky' : 'normal'
    const front = readCell(world, relative(event, direction, 1))
    const head = matchingHead(front, direction.name, type)
    const index = registryIndex(world.replay.blockStates)

    if (event.action === 0) {
      // A block packet may have supplied the final head before this action. A
      // base's extended flag alone is not enough to skip a still-required push.
      if (extended === 'true' && head)
        return { handled: true }
      const extendedId = variant(index, event.block, { ...base.state.properties, extended: 'true' })
      const headId = variant(index, 'minecraft:piston_head', { facing: direction.name, short: 'false', type })
      const line = []
      let cell = front
      while (!AIR.has(cell.state.name)) {
        assertMovable(cell)
        if (line.length === 12)
          throw new UnsupportedPiston('push exceeds the 12-block limit')
        line.push(cell)
        cell = readCell(world, relative(event, direction, line.length + 1))
      }
      const plan = []
      for (let i = line.length - 1; i >= 0; i--)
        plan.push({ cell: line[i + 1] || cell, state: line[i].id })
      plan.push({ cell: front, state: headId }, { cell: base, state: extendedId })
      return applyPlan(world, plan)
    }

    // Never erase an unrelated solid at the head position. It might be an
    // already-pulled block or overlapping motion whose timing was not recorded.
    if (!head && !AIR.has(front.state.name))
      throw new UnsupportedPiston(`missing matching settled piston head; ambiguous/transient geometry (${front.state.name} at ${positionKey(front)})`)
    const retractedId = variant(index, event.block, { ...base.state.properties, extended: 'false' })
    const airId = variant(index, 'minecraft:air')
    const plan = []
    let frontId = airId
    if (type === 'sticky' && event.action === 1) {
      const target = readCell(world, relative(event, direction, 2))
      if (!AIR.has(target.state.name)) {
        assertMovable(target)
        frontId = target.id
        plan.push({ cell: target, state: airId })
      }
    }
    // Action 2 explicitly drops the block. Do not inspect or move the cell two
    // blocks ahead; it need not be loaded for this local retraction to succeed.
    plan.push({ cell: front, state: frontId }, { cell: base, state: retractedId })
    return applyPlan(world, plan)
  }
  catch (error) {
    if (!(error instanceof UnsupportedPiston))
      throw error
    return { handled: false, warning: `Recorded piston action ${event.action} at ${event.x},${event.y},${event.z} was not applied: ${error.message}.` }
  }
}
