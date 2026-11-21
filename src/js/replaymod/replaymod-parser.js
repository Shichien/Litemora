import { readReplayArchive, replayLimits, throwIfAborted } from './replaymod-archive.js'
import { BinaryReader, check, decodeType, ReplayModError } from './replaymod-binary.js'
import { loadProtocol, SUPPORTED_REPLAYMOD_VERSIONS, validateProtocol } from './replaymod-data.js'

export { ReplayModError, SUPPORTED_REPLAYMOD_VERSIONS }

const VANILLA_DIMENSIONS = {
  'minecraft:overworld': { min_y: -64, height: 384 },
  'minecraft:overworld_caves': { min_y: -64, height: 384 },
  'minecraft:the_nether': { min_y: 0, height: 256 },
  'minecraft:the_end': { min_y: 0, height: 256 },
}
const angle = byte => byte * 360 / 256
function absolute(value, name, bound = 30_000_000) {
  check(Number.isFinite(value) && Math.abs(value) <= bound, `Invalid ${name} coordinate ${value}`)
  return value
}
const position = p => ({ x: absolute(p.x, 'x'), y: absolute(p.y, 'y', 20_000_000), z: absolute(p.z, 'z') })
function entityId(id) {
  check(Number.isInteger(id) && Math.abs(id) <= 0x7FFFFFFF, `Invalid entity ID ${id}`)
  return id
}

/** Minecraft 1.16+ padded paletted container. Values never straddle longs. */
function palette(reader, size, blocks, protocol) {
  const bits = reader.u8()
  check(bits === 0 || (blocks ? bits >= 4 && bits <= 15 : bits >= 1 && bits <= 6), `Invalid palette bit width ${bits}`)
  let entries
  if (bits === 0) {
    entries = [reader.varint()]
  }
  else if (bits <= (blocks ? 8 : 3)) {
    const length = reader.count(reader.varint(), 1 << bits)
    check(length > 0, 'Empty indirect palette')
    entries = Array.from({ length }, () => reader.varint())
  }
  if (entries) {
    for (const id of entries) check(id >= 0 && (!blocks || protocol.blockStates[id]), `Unknown ${blocks ? 'block state' : 'biome'} ID ${id}`, 'UNSUPPORTED_REGISTRY')
  }
  const longs = reader.count(reader.varint())
  const perLong = bits ? Math.floor(64 / bits) : 0
  const expected = bits ? Math.ceil(size / perLong) : 0
  check(longs === expected, `Palette long count ${longs} does not match ${expected}`)
  reader.need(longs * 8)
  const values = blocks ? new Uint32Array(size) : null
  if (!bits) {
    values?.fill(entries[0])
    return values
  }
  const mask = (1n << BigInt(bits)) - 1n
  let index = 0
  for (let i = 0; i < longs; i++) {
    let packed = reader.u64()
    for (let j = 0; j < perLong && index < size; j++, index++) {
      const id = Number(packed & mask)
      const state = entries ? entries[id] : id
      check(state !== undefined && (!blocks || protocol.blockStates[state]), `Invalid palette state ${state ?? id}`, 'UNSUPPORTED_REGISTRY')
      if (values)
        values[index] = state
      packed >>= BigInt(bits)
    }
  }
  return values
}

function readChunk(reader, context, emit) {
  const x = reader.i32()
  const z = reader.i32()
  absolute(x * 16, 'chunk x')
  absolute(z * 16, 'chunk z')
  check(context.dimension, 'Chunk arrived before dimension initialization')
  reader.nbt(context.protocol.protocol === 763)
  const data = new BinaryReader(reader.take(reader.count(reader.varint(), context.limits.maxPacketBytes)), context.limits)
  const sections = []
  const { minY, height } = context.dimension
  for (let y = minY / 16; y < (minY + height) / 16; y++) {
    const nonAir = data.i16()
    check(nonAir >= 0, `Invalid non-air block count ${nonAir}`)
    if (nonAir > 4096)
      context.warn('SECTION_COUNT_MISMATCH', 'A recorded server section has an inflated non-air counter; blocks are reconstructed from the validated palette instead.')
    const states = palette(data, 4096, true, context.protocol)
    palette(data, 64, false, context.protocol)
    // Air, cave_air and void_air are all empty, but preserving nonzero air states is harmless.
    if (states.some(state => state !== 0))
      sections.push({ y, states })
  }
  // Vanilla allocates chunkData from palette serialized-size estimates; singleton palettes
  // can leave zero padding at the end (observed in the official ReplayMod 1.20.1 fixture).
  check(data.remaining <= height / 16 * 8 && data.take(data.remaining).every(byte => byte === 0), 'Chunk section data does not match dimension height')
  const blockEntities = []
  for (let i = 0, length = reader.count(reader.varint(), 65_536); i < length; i++) {
    const packed = reader.u8()
    const y = reader.i16()
    const type = reader.varint()
    check(y >= minY && y < minY + height && type >= 0, 'Invalid chunk block entity')
    const data = reader.nbt(context.protocol.protocol === 763)
    blockEntities.push({ x: x * 16 + (packed >> 4), y, z: z * 16 + (packed & 15), type, data })
  }
  for (let i = 0; i < 4; i++) reader.take(reader.count(reader.varint(), 64) * 8)
  for (let i = 0; i < 2; i++) {
    const length = reader.count(reader.varint(), 1024)
    for (let j = 0; j < length; j++) {
      const n = reader.varint()
      check(n === 2048, 'Invalid chunk light array size')
      reader.take(n)
    }
  }
  emit({ type: 'chunk', x, z, sections, blockEntities }, sections.length * 16_384)
}

function blockPosition(context, p) {
  const result = position(p)
  check(Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z), 'Block coordinates must be integers')
  check(context.dimension && p.y >= context.dimension.minY && p.y < context.dimension.minY + context.dimension.height, `Block Y ${p.y} outside current dimension`)
  return result
}
function blockState(protocol, state) {
  check(Number.isInteger(state) && protocol.blockStates[state], `Unknown block state ID ${state}`, 'UNSUPPORTED_REGISTRY')
  return state
}
function normalizeSlot(slot, protocol) {
  if (!slot || slot.present === false || slot.itemCount === 0)
    return null
  const id = slot.itemId ?? slot.blockId
  const count = slot.itemCount
  check(protocol.itemsById[id] && Number.isInteger(count) && count >= 0 && count <= 99, `Invalid or unknown item stack ${id}/${count}`, 'UNSUPPORTED_REGISTRY')
  return { id, name: protocol.itemsById[id], count, ...(slot.nbtData ? { nbt: slot.nbtData } : {}), ...(slot.components ? { components: slot.components, removedComponents: slot.removeComponents } : {}) }
}
function flag(flags, key, index) {
  return typeof flags === 'number' ? !!(flags & (1 << index)) : !!flags?.[key]
}

function makeContext(protocol, limits, warn) {
  const context = { protocol, limits, warn, dimensions: new Map(), entities: new Map(), dimension: null, camera: null, initialCamera: null, playerId: null }
  context.readRegistry = (packet) => {
    if (packet.codec || packet.dimensionCodec) {
      const codec = packet.codec || packet.dimensionCodec
      const entries = codec['minecraft:dimension_type']?.value
      check(Array.isArray(entries), 'Missing dimension type registry', 'UNSUPPORTED_REGISTRY')
      for (const entry of entries) {
        context.dimensions.set(entry.name, entry.element)
        context.dimensions.set(entry.id, { ...entry.element, name: entry.name })
      }
    }
    if (packet.id === 'minecraft:dimension_type') {
      packet.entries.forEach((entry, id) => {
        const data = entry.value || VANILLA_DIMENSIONS[entry.key]
        check(data, `Missing data for custom dimension ${entry.key}`, 'UNSUPPORTED_REGISTRY')
        context.dimensions.set(entry.key, data)
        context.dimensions.set(id, { ...data, name: entry.key })
      })
    }
  }
  context.setDimension = (packet, emit) => {
    if (packet.dimensionCodec)
      context.readRegistry(packet)
    const type = packet.worldState?.dimension ?? packet.worldType ?? packet.dimension
    const name = packet.worldState?.name ?? packet.worldName
    const data = context.dimensions.get(type) || VANILLA_DIMENSIONS[type]
    check(data && typeof name === 'string', `Unknown dimension ${String(type)}`, 'UNSUPPORTED_REGISTRY')
    const minY = data.min_y
    const height = data.height
    check(Number.isInteger(minY) && minY % 16 === 0 && Number.isInteger(height) && height > 0 && height % 16 === 0 && height <= limits.maxDimensionHeight && minY >= -2032 && minY + height <= 2032, 'Invalid or unsupported dimension bounds', 'UNSUPPORTED_REGISTRY')
    context.dimension = { dimension: name, dimensionType: typeof type === 'string' ? type : data.name, minY, height }
    context.entities.clear()
    context.camera = null
    if (packet.entityId !== undefined)
      context.playerId = entityId(packet.entityId)
    emit({ type: 'dimension', ...context.dimension })
  }
  context.setCamera = (p, emit) => {
    const previous = context.camera
    const keys = ['x', 'y', 'z', 'yaw', 'pitch']
    const flags = ['x', 'y', 'z', 'yaw', 'pitch']
    const next = { dimension: context.dimension?.dimension }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const isRelative = flag(p.flags, flags[i], i)
      check(!isRelative || previous, 'Relative camera update before initial position')
      next[key] = p[key] + (isRelative ? previous[key] : 0)
    }
    position(next)
    context.camera = next
    if (!context.initialCamera)
      context.initialCamera = { ...next }
    emit({ type: 'camera', ...next })
  }
  return context
}

/** Decode packet events in original order; replaying from a dimension event reconstructs a seek. */
export async function decodeRecording(recording, metadata, options = {}) {
  const limits = options.limits ? replayLimits(options.limits) : replayLimits()
  const protocol = await loadProtocol(metadata)
  const formatVersion = metadata.fileFormatVersion
  check(metadata.fileFormat === 'MCPR' && Number.isInteger(formatVersion) && formatVersion >= 10 && formatVersion <= 14, 'Unsupported ReplayMod file format', 'UNSUPPORTED_FORMAT')
  check(formatVersion >= 14 || protocol.protocol < 764, 'Modern Minecraft recordings require MCPR format 14', 'UNSUPPORTED_FORMAT')
  check(recording.byteLength <= limits.maxRecordingBytes, 'Recording exceeds memory limit', 'LIMIT_EXCEEDED')
  const declaredDuration = metadata.duration
  check(declaredDuration === undefined || (Number.isInteger(declaredDuration) && declaredDuration >= 0 && declaredDuration <= limits.maxDurationMs), 'Invalid replay duration')
  const events = []
  const warnings = []
  const warningCodes = new Set()
  const warn = (code, message) => {
    if (!warningCodes.has(code)) {
      warningCodes.add(code)
      warnings.push({ code, message })
    }
  }
  const context = makeContext(protocol, limits, warn)
  const stats = { packets: 0, packetCounts: {}, ignoredPackets: {}, chunks: 0, blockUpdates: 0, entitySpawns: 0, decodedBytes: 0 }
  const reader = new BinaryReader(recording, limits)
  let state = formatVersion >= 14 ? 'login' : 'play'
  let time = 0
  let previousTime = -1
  let packetName = ''
  const emit = (event, bytes = 0) => {
    check(events.length < limits.maxEvents, 'Replay event limit exceeded', 'LIMIT_EXCEEDED')
    stats.decodedBytes += bytes + 160
    check(stats.decodedBytes <= limits.maxDecodedBytes, 'Decoded replay exceeds memory limit', 'LIMIT_EXCEEDED')
    events.push({ timeMs: time, ...event })
    if (event.type === 'chunk')
      stats.chunks++
    if (event.type === 'block')
      stats.blockUpdates++
    if (event.type === 'blocks')
      stats.blockUpdates += event.changes.length
    if (event.type === 'entitySpawn')
      stats.entitySpawns++
  }
  const move = (p, relative, rotations = true) => {
    const id = entityId(p.entityId)
    const previous = context.entities.get(id)
    if (!previous) {
      warn('MISSING_ENTITY_SPAWN', 'Some entity updates precede their spawn or follow their removal; those updates cannot create a visible entity.')
      return
    }
    const next = { ...previous }
    if (relative) {
      for (const key of ['x', 'y', 'z']) {
        const delta = p[`d${key.toUpperCase()}`]
        if (delta !== undefined)
          next[key] += delta / 4096
      }
    }
    else {
      for (const [i, key] of ['x', 'y', 'z'].entries()) {
        if (p[key] !== undefined)
          next[key] = p[key] + (flag(p.flags, key, i) ? previous[key] : 0)
      }
    }
    for (const [i, key] of ['yaw', 'pitch'].entries()) {
      if (p[key] !== undefined)
        next[key] = (rotations ? angle(p[key]) : p[key]) + (flag(p.flags, key, i + 3) ? previous[key] : 0)
    }
    position(next)
    context.entities.set(id, next)
    emit({ type: 'entityMove', id, ...position(next), yaw: next.yaw, pitch: next.pitch, relative: false })
    if (id === context.playerId)
      context.setCamera({ ...next, flags: 0 }, emit)
  }
  while (reader.remaining) {
    throwIfAborted(options.signal)
    check(++stats.packets <= limits.maxPackets, 'Too many recording packets', 'LIMIT_EXCEEDED')
    reader.need(8)
    time = reader.i32()
    const length = reader.i32()
    check(time >= previousTime && time >= 0 && time <= limits.maxDurationMs, `Invalid or decreasing packet timestamp ${time}`)
    previousTime = time
    check(length >= 0 && length <= limits.maxPacketBytes, `Invalid recording packet length ${length}`, 'LIMIT_EXCEEDED')
    const packet = new BinaryReader(reader.take(length), limits)
    if (!length)
      continue // ReplayStudio permits empty records.
    const id = packet.varint()
    packetName = protocol.states[state]?.names[id] ?? protocol.states[state]?.names[`0x${id.toString(16).padStart(2, '0')}`]
    check(packetName, `Unknown ${state} packet ID 0x${id.toString(16)} for protocol ${protocol.protocol}`, 'UNSUPPORTED_PACKET')
    const countName = `${state}:${packetName}`
    stats.packetCounts[countName] = (stats.packetCounts[countName] || 0) + 1
    try {
      if (state === 'login') {
        if (packetName === 'success') {
          const p = decodeType(packet, protocol.states.login.types.packet_success, protocol.types)
          context.playerUuid = p.uuid
          state = protocol.protocol >= 764 ? 'configuration' : 'play'
        }
        else if (['disconnect', 'encryption_begin'].includes(packetName)) {
          throw new ReplayModError(`Unsupported login packet ${packetName}`, 'UNSUPPORTED_PACKET')
        }
        packet.offset = packet.bytes.length
      }
      else if (packetName === 'start_configuration') {
        state = 'configuration'
        packet.offset = packet.bytes.length
      }
      else if (state === 'configuration') {
        if (packetName === 'finish_configuration') {
          state = 'play'
        }
        else if (packetName === 'registry_data') {
          const p = decodeType(packet, protocol.states.configuration.types.packet_registry_data, protocol.types)
          context.readRegistry(p)
        }
        else if (packetName === 'custom_payload') {
          warn('CUSTOM_PAYLOAD', 'Custom server/mod plugin data is not simulated; vanilla chunk, block, and entity packets are decoded.')
        }
        packet.offset = packet.bytes.length
      }
      else if (packetName === 'map_chunk') {
        readChunk(packet, context, emit)
      }
      else if (packetName === 'multi_block_change') {
        const packed = packet.u64()
        const sectionX = Number(BigInt.asIntN(22, packed >> 42n))
        const sectionZ = Number(BigInt.asIntN(22, (packed >> 20n) & 0x3FFFFFn))
        const sectionY = Number(BigInt.asIntN(20, packed & 0xFFFFFn))
        const changes = []
        const n = packet.count(packet.varint(), 4096)
        for (let i = 0; i < n; i++) {
          const record = packet.varlong()
          check(record >= 0n, 'Negative multi-block record')
          const stateId = Number(record >> 12n)
          const location = Number(record & 0xFFFn)
          changes.push({ ...blockPosition(context, { x: sectionX * 16 + (location >> 8), y: sectionY * 16 + (location & 15), z: sectionZ * 16 + ((location >> 4) & 15) }), state: blockState(protocol, stateId) })
        }
        emit({ type: 'blocks', changes }, changes.length * 48)
      }
      else {
        const schema = protocol.states.play.types[`packet_${packetName}`]
        if (!schema) {
          // Every omitted packet is explicitly classified by the generated table's nonWorld list.
          check(protocol.nonWorld?.includes(packetName), `Unhandled world packet ${packetName}`, 'UNSUPPORTED_PACKET')
          stats.ignoredPackets[packetName] = (stats.ignoredPackets[packetName] || 0) + 1
          packet.offset = packet.bytes.length
          continue
        }
        const p = decodeType(packet, schema, { ...protocol.types, ...protocol.states.play.types })
        switch (packetName) {
          case 'login': case 'respawn': context.setDimension(p, emit)
            break
          case 'unload_chunk': absolute(p.chunkX * 16, 'chunk x')
            absolute(p.chunkZ * 16, 'chunk z')
            emit({ type: 'unloadChunk', x: p.chunkX, z: p.chunkZ })
            break
          case 'block_change': emit({ type: 'block', ...blockPosition(context, p.location), state: blockState(protocol, p.type) })
            break
          case 'block_action': {
            const block = protocol.blocksById[p.blockId]
            check(block, `Unknown block action type ${p.blockId}`, 'UNSUPPORTED_REGISTRY')
            emit({ type: 'blockAction', ...blockPosition(context, p.location), action: p.byte1, parameter: p.byte2, blockId: p.blockId, block })
            if (block === 'minecraft:piston' || block === 'minecraft:sticky_piston')
              warn('PISTON_SIMULATION_REQUIRED', 'Piston block actions require client-side simulation; sticky/slime/honey structures and moving-block rendering may differ from vanilla playback.')
            break
          }
          case 'tile_entity_data': emit({ type: 'blockEntity', ...blockPosition(context, p.location), blockEntityType: p.action, data: p.nbtData })
            break
          case 'explosion': {
            position(p)
            if (p.affectedBlockOffsets?.length) {
              const changes = p.affectedBlockOffsets.map(offset => ({ ...blockPosition(context, { x: Math.floor(p.x) + offset.x, y: Math.floor(p.y) + offset.y, z: Math.floor(p.z) + offset.z }), state: 0 }))
              emit({ type: 'blocks', changes, cause: 'explosion' }, changes.length * 48)
            }
            break
          }
          case 'spawn_entity': case 'named_entity_spawn': case 'spawn_entity_experience_orb': {
            const type = packetName === 'named_entity_spawn' ? 'minecraft:player' : packetName === 'spawn_entity_experience_orb' ? 'minecraft:experience_orb' : protocol.entitiesById[p.type]?.name
            check(type, `Unknown entity type ${p.type}`, 'UNSUPPORTED_REGISTRY')
            const entity = { id: entityId(p.entityId), uuid: p.objectUUID || p.playerUUID, type, ...position(p), yaw: angle(p.yaw || 0), pitch: angle(p.pitch || 0), data: p.objectData ?? p.count ?? 0 }
            check(context.entities.size < limits.maxEntities || context.entities.has(entity.id), 'Too many active entities', 'LIMIT_EXCEEDED')
            if (entity.uuid && entity.uuid === context.playerUuid)
              context.playerId = entity.id
            context.entities.set(entity.id, entity)
            emit({ ...entity, type: 'entitySpawn', entityType: type })
            if (entity.id === context.playerId)
              context.setCamera({ ...entity, flags: 0 }, emit)
            break
          }
          case 'rel_entity_move': case 'entity_move_look': move(p, true)
            break
          case 'entity_look': move(p, true)
            break
          case 'entity_teleport': move(p, false, protocol.protocol < 769)
            break
          case 'sync_entity_position': move(p, false, false)
            break
          case 'entity_destroy': for (const id of p.entityIds) context.entities.delete(entityId(id))
            emit({ type: 'entityRemove', ids: p.entityIds })
            break
          case 'entity_metadata': {
            const id = entityId(p.entityId)
            const entity = context.entities.get(id)
            const event = { type: 'entityData', id, metadata: p.metadata }
            if (entity?.type === 'minecraft:item') {
              const item = p.metadata.find(entry => entry.key === 8)
              if (item)
                event.item = normalizeSlot(item.value, protocol)
            }
            emit(event)
            break
          }
          case 'position': context.setCamera(p, emit)
            break
          case 'entity_velocity': emit({ type: 'entityVelocity', id: entityId(p.entityId), dx: p.velocityX / 8000, dy: p.velocityY / 8000, dz: p.velocityZ / 8000 })
            break
          case 'entity_head_rotation': emit({ type: 'entityHead', id: entityId(p.entityId), yaw: angle(p.headYaw) })
            break
          case 'entity_equipment': emit({ type: 'entityEquipment', id: entityId(p.entityId), equipment: p.equipments.map(entry => ({ slot: entry.slot, item: normalizeSlot(entry.item, protocol) })) })
            break
          case 'set_passengers': emit({ type: 'passengers', id: entityId(p.entityId), passengers: p.passengers.map(entityId) })
            break
          case 'attach_entity': emit({ type: 'entityAttach', id: entityId(p.entityId), vehicleId: entityId(p.vehicleId) })
            break
          case 'vehicle_move': emit({ type: 'vehicleMove', ...position(p), yaw: p.yaw, pitch: p.pitch })
            warn('VEHICLE_INTERPOLATION', 'Rider placement requires vehicle interpolation; vehicle packets are preserved.')
            break
          case 'move_minecart': {
            const steps = p.steps.map(step => ({ ...step, position: position(step.position), yaw: angle(step.yaw), pitch: angle(step.pitch) }))
            emit({ type: 'minecartMove', id: entityId(p.entityId), steps })
            if (steps.length) {
              const last = steps[steps.length - 1]
              move({ entityId: p.entityId, ...last.position, yaw: last.yaw, pitch: last.pitch }, false, false)
            }
            warn('MINECART_INTERPOLATION', 'Experimental minecart interpolation steps are preserved; playback uses the last packet position.')
            break
          }
          case 'custom_payload': if (!['minecraft:brand', 'minecraft:register', 'minecraft:unregister'].includes(p.channel))
            warn('CUSTOM_PAYLOAD', 'Custom server/mod plugin data is not simulated; vanilla chunk, block, and entity packets are decoded.')
            break
          case 'chunk_biomes': emit({ type: 'biomes', chunks: p.biomes })
            warn('BIOME_RENDERING', 'Biome changes are retained but biome tinting depends on the renderer.')
            break
          case 'collect': {
            emit({ type: 'entityCollect', id: entityId(p.collectedEntityId), collectorId: entityId(p.collectorEntityId), count: p.pickupItemCount })
            break
          }
          case 'camera': emit({ type: 'cameraTarget', id: entityId(p.cameraId) })
            break
          case 'player_rotation': if (context.camera)
            context.setCamera({ ...context.camera, yaw: p.yaw, pitch: p.pitch, flags: 0 }, emit)
            break
          case 'spawn_position': emit({ type: 'spawnPosition', ...position(p.location), yaw: p.angle })
            break
          case 'face_player': emit({ type: 'cameraLookAt', data: p })
            warn('CAMERA_LOOK_AT', 'Server-forced look-at targets are preserved but require renderer camera support.')
            break
          case 'game_state_change': case 'set_ticking_state': case 'step_tick': emit({ type: 'worldEffect', packet: packetName, data: p })
            break
          case 'entity_status': case 'animation': case 'entity_update_attributes': case 'entity_effect': case 'remove_entity_effect': case 'set_projectile_power':
            emit({ type: 'entityEffect', packet: packetName, data: p })
            break
          default: throw new ReplayModError(`Unhandled world packet ${packetName}`, 'UNSUPPORTED_PACKET')
        }
      }
      stats.decodedBytes += packet.allocatedBytes
      check(stats.decodedBytes <= limits.maxDecodedBytes, 'Decoded replay exceeds memory limit', 'LIMIT_EXCEEDED')
      check(packet.remaining === 0, `${packetName} has ${packet.remaining} trailing bytes`, 'UNSUPPORTED_PACKET')
    }
    catch (error) {
      if (error.name === 'AbortError')
        throw error
      throw new ReplayModError(`${error.message} (${state}:${packetName} at ${time}ms, record ${stats.packets})`, error.code)
    }
    if (stats.packets % 512 === 0) {
      options.onProgress?.({ phase: 'decode', progress: reader.offset / reader.bytes.length, packets: stats.packets })
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  check(context.dimension, 'Replay contains no playable dimension')
  const durationMs = Math.max(declaredDuration || 0, time)
  if (declaredDuration !== undefined && declaredDuration < time)
    warn('DURATION_EXTENDED', 'Metadata duration was shorter than the packet stream; the final packet timestamp is used.')
  if (!context.initialCamera)
    warn('NO_CAMERA', 'No recording-player position was found; the viewer must choose a camera from the world bounds.')
  options.onProgress?.({ phase: 'decode', progress: 1, packets: stats.packets })
  return {
    format: 'replaymod',
    metadata: { kind: 'replaymod', minecraftVersion: metadata.mcversion || protocol.aliases[0], protocolVersion: protocol.protocol, durationMs, date: metadata.date, serverName: metadata.serverName, generator: metadata.generator, fileFormatVersion: formatVersion, playerEntityId: context.playerId, players: metadata.players },
    durationMs,
    initialCamera: context.initialCamera,
    events,
    blockStates: protocol.blockStates,
    entityTypes: Object.fromEntries(Object.entries(protocol.entitiesById).map(([id, entry]) => [id, entry.name])),
    warnings,
    stats,
  }
}

/** Import an original MCPR ZIP. recording.tmcpr is the sole world-data source. */
export async function parseReplayMod(input, options = {}) {
  const limits = replayLimits(options.limits)
  const archive = await readReplayArchive(input, limits, options)
  validateProtocol(archive.metadata) // Reject unsupported versions before decompressing the recording.
  const recording = await archive.recording()
  return decodeRecording(recording, archive.metadata, options)
}
