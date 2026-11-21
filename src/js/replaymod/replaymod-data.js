import { check, ReplayModError } from './replaymod-binary.js'

export const SUPPORTED_REPLAYMOD_VERSIONS = Object.freeze(['1.20', '1.20.1', '1.20.3', '1.20.4', '1.21', '1.21.1', '1.21.4'])
const versions = { '1.20': 763, '1.20.1': 763, '1.20.3': 765, '1.20.4': 765, '1.21': 767, '1.21.1': 767, '1.21.4': 769 }
const loaders = {
  763: () => import('./data/protocol-763.js'),
  765: () => import('./data/protocol-765.js'),
  767: () => import('./data/protocol-767.js'),
  769: () => import('./data/protocol-769.js'),
}

/** Correct known upstream 3.105.0 schema errors using the wire layouts (see data/README.md). */
function correctSchemas(data) {
  const types = structuredClone(data.types)
  const states = structuredClone(data.states)
  const fields = types.entityMetadataEntry ? types.entityMetadataEntry[1][2].type[1].fields : types.entityMetadataItem[1].fields
  fields.optional_global_pos = ['option', ['container', [{ name: 'dimension', type: 'string' }, { name: 'position', type: 'position' }]]]
  if (data.protocol <= 765) {
    const vibrationId = data.protocol === 763 ? 41 : 43
    types.particleData[1].fields[vibrationId] = ['container', [
      { name: 'positionType', type: 'string' },
      { name: 'position', type: ['switch', { compareTo: 'positionType', fields: {
        'minecraft:block': 'position',
        'minecraft:entity': ['container', [{ name: 'entityId', type: 'varint' }, { name: 'entityEyeHeight', type: 'f32' }]],
      } }] },
      { name: 'ticks', type: 'varint' },
    ]]
    if (data.protocol === 765) {
      types.Particle = ['container', [
        { name: 'particleId', type: 'varint' },
        { name: 'data', type: ['particleData', { compareTo: 'particleId' }] },
      ]]
    }
  }
  else if (types.Particle?.[1]?.[1]) {
    types.Particle[1][1].type[1].default = 'void'
  }
  if (data.protocol === 769) {
    const particle = types.Particle[1][1].type[1].fields
    particle.dust = ['container', [{ name: 'color', type: 'i32' }, { name: 'scale', type: 'f32' }]]
    particle.dust_color_transition = ['container', [{ name: 'fromColor', type: 'i32' }, { name: 'toColor', type: 'i32' }, { name: 'scale', type: 'f32' }]]
    particle.trail = ['container', [{ name: 'target', type: 'vec3f64' }, { name: 'color', type: 'i32' }, { name: 'duration', type: 'varint' }]]
    states.play.types.packet_move_minecart = ['container', [
      { name: 'entityId', type: 'varint' },
      { name: 'steps', type: ['array', { countType: 'varint', type: ['container', [
        { name: 'position', type: 'vec3f64' },
        { name: 'movement', type: 'vec3f64' },
        { name: 'yaw', type: 'i8' },
        { name: 'pitch', type: 'i8' },
        { name: 'weight', type: 'f32' },
      ]] }] },
    ]]
    states.play.types.packet_entity_teleport = ['container', [
      { name: 'entityId', type: 'varint' },
      ...['x', 'y', 'z', 'dx', 'dy', 'dz'].map(name => ({ name, type: 'f64' })),
      { name: 'yaw', type: 'f32' },
      { name: 'pitch', type: 'f32' },
      { name: 'flags', type: 'PositionUpdateRelatives' },
      { name: 'onGround', type: 'bool' },
    ]]
  }
  return { ...data, types, states }
}

export function validateProtocol(metadata) {
  const version = metadata.mcversion || metadata.minecraftVersion
  const declared = metadata.protocolVersion
  const protocol = declared ?? versions[version]
  if (!loaders[protocol] || (version && versions[version] !== protocol)) {
    throw new ReplayModError(`Unsupported Minecraft version ${version || '(unspecified)'} (protocol ${protocol ?? 'unknown'}). Supported Java versions: ${SUPPORTED_REPLAYMOD_VERSIONS.join(', ')}.`, 'UNSUPPORTED_VERSION')
  }
  return protocol
}

export async function loadProtocol(metadata) {
  const protocol = validateProtocol(metadata)
  const data = correctSchemas((await loaders[protocol]()).default)
  const blockStates = []
  const blocksById = Object.create(null)
  for (const [min, max, name, definitions, transparent, boundingBox, id] of data.blocks) {
    blocksById[id] = `minecraft:${name}`
    for (let state = min; state <= max; state++) {
      let value = state - min
      const properties = {}
      for (let i = definitions.length - 1; i >= 0; i--) {
        const [key, values] = definitions[i]
        properties[key] = String(values[value % values.length])
        value = Math.floor(value / values.length)
      }
      blockStates[state] = { name: `minecraft:${name}`, properties, transparent, boundingBox }
    }
  }
  check(blockStates[0]?.name === 'minecraft:air', 'Protocol air state must be zero')
  return {
    ...data,
    blockStates,
    blocksById,
    entitiesById: Object.fromEntries(data.entities.map(([id, name, metadataKeys]) => [id, { name: `minecraft:${name}`, metadataKeys }])),
    itemsById: Object.fromEntries(data.items.map(([id, name]) => [id, `minecraft:${name}`])),
  }
}
