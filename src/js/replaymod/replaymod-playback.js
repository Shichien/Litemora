import { applyRecordedPiston } from './replaymod-piston.js'

// Pure playback state: no world simulation runs. Recorded block actions apply
// their bounded client-side effects; seeks rebuild from the original events.
export const sectionKey = (x, y, z) => `${x},${y},${z}`
const blockKey = (x, y, z) => `${x},${y},${z}`
const localIndex = (x, y, z) => (x & 15) | ((z & 15) << 4) | ((y & 15) << 8)

export function blockStateString(state) {
  if (typeof state === 'string')
    return state
  const name = state?.name || 'minecraft:air'
  const properties = Object.entries(state?.properties || {}).map(([key, value]) => `${key}=${value}`)
  return `${name.includes(':') ? name : `minecraft:${name}`}${properties.length ? `[${properties.join(',')}]` : ''}`
}

export class ReplayModPlayback {
  constructor(replay) {
    this.replay = replay
    this.sections = new Map()
    this.loadedChunks = new Set()
    this.entities = new Map()
    this.blockEntities = new Map()
    this.dirtySections = new Set()
    this.warnings = new Set()
    this.revision = 0
    this.reset()
  }

  reset() {
    for (const key of this.sections.keys())
      this.dirtySections.add(key)
    this.sections.clear()
    this.entities.clear()
    this.blockEntities.clear()
    this.loadedChunks.clear()
    this.dimension = null
    this.dimensionInfo = null
    this.camera = this.replay.initialCamera ? { ...this.replay.initialCamera } : null
    this.timeMs = 0
    this.eventIndex = 0
    this.revision++
  }

  seek(timeMs) {
    const target = Math.max(0, Math.min(this.replay.durationMs, Number(timeMs) || 0))
    if (target < this.timeMs)
      this.reset()
    const events = this.replay.events
    while (this.eventIndex < events.length && events[this.eventIndex].timeMs <= target)
      this.apply(events[this.eventIndex++])
    this.timeMs = target
    return this
  }

  isPositionLoaded(x, y, z) {
    const inHeight = !this.dimensionInfo || (y >= this.dimensionInfo.minY && y < this.dimensionInfo.minY + this.dimensionInfo.height)
    return inHeight && this.loadedChunks.has(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)
  }

  blockAt(x, y, z) {
    const section = this.sections.get(sectionKey(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16)))
    return section?.states[localIndex(x, y, z)] || 0
  }

  dirty(x, y, z) {
    this.dirtySections.add(sectionKey(x, y, z))
    for (const [dx, dy, dz] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]])
      this.dirtySections.add(sectionKey(x + dx, y + dy, z + dz))
  }

  setBlock({ x, y, z, state }) {
    const sx = Math.floor(x / 16)
    const sy = Math.floor(y / 16)
    const sz = Math.floor(z / 16)
    const key = sectionKey(sx, sy, sz)
    const section = this.sections.get(key)
    // Never mutate the decoded recording: reset/seek must start from the same bytes.
    const states = section?.owned ? section.states : section ? section.states.slice() : new Uint32Array(4096)
    states[localIndex(x, y, z)] = state
    this.sections.set(key, { x: sx, y: sy, z: sz, states, owned: true })
    this.blockEntities.delete(blockKey(x, y, z))
    this.dirty(sx, sy, sz)
  }

  unload(x, z) {
    this.loadedChunks.delete(`${x},${z}`)
    for (const [key, section] of this.sections) {
      if (section.x === x && section.z === z) {
        this.sections.delete(key)
        this.dirty(section.x, section.y, section.z)
      }
    }
    for (const [key, entity] of this.blockEntities) {
      if (Math.floor(entity.x / 16) === x && Math.floor(entity.z / 16) === z)
        this.blockEntities.delete(key)
    }
  }

  apply(event) {
    switch (event.kind || event.type) {
      case 'dimension':
        for (const key of this.sections.keys())
          this.dirtySections.add(key)
        this.sections.clear()
        this.entities.clear()
        this.blockEntities.clear()
        this.loadedChunks.clear()
        this.dimensionInfo = { minY: event.minY ?? -64, height: event.height ?? 384 }
        this.dimension = event.dimension
        this.camera = null
        this.revision++
        break
      case 'chunk':
        this.unload(event.x, event.z)
        this.loadedChunks.add(`${event.x},${event.z}`)
        for (const section of event.sections) {
          this.sections.set(sectionKey(event.x, section.y, event.z), { x: event.x, z: event.z, ...section })
          this.dirty(event.x, section.y, event.z)
        }
        for (const entity of event.blockEntities || [])
          this.blockEntities.set(blockKey(entity.x, entity.y, entity.z), { ...entity })
        break
      case 'unloadChunk':
        this.unload(event.x, event.z)
        break
      case 'block':
        this.setBlock(event)
        break
      case 'blocks':
        for (const block of event.changes)
          this.setBlock(block)
        break
      case 'blockAction': {
        const result = applyRecordedPiston(this, event)
        if (result.warning)
          this.warnings.add(result.warning)
        break
      }
      case 'blockEntity':
        this.blockEntities.set(blockKey(event.x, event.y, event.z), { ...event })
        break
      case 'entitySpawn':
        this.entities.set(event.id, { ...event, type: event.entityType || event.type, spawnedAt: event.timeMs })
        if (event.id === this.replay.metadata?.playerEntityId)
          this.camera = { ...event }
        break
      case 'entityMove': {
        const entity = this.entities.get(event.id)
        if (!entity)
          break
        const next = { ...entity }
        for (const axis of ['x', 'y', 'z']) {
          if (Number.isFinite(event[axis]))
            next[axis] = event[axis]
          if (Number.isFinite(event[`d${axis}`]))
            next[axis] += event[`d${axis}`]
        }
        for (const angle of ['yaw', 'pitch']) {
          if (Number.isFinite(event[angle]))
            next[angle] = event[angle]
        }
        next.timeMs = event.timeMs
        this.entities.set(event.id, next)
        if (event.id === this.replay.metadata?.playerEntityId)
          this.camera = { ...next }
        break
      }
      case 'entityData': {
        const entity = this.entities.get(event.id)
        if (entity) {
          const metadata = new Map((entity.metadata || []).map(entry => [entry.key, entry]))
          for (const entry of event.metadata || [])
            metadata.set(entry.key, entry)
          this.entities.set(event.id, { ...entity, ...event, type: entity.type, metadata: [...metadata.values()] })
        }
        break
      }
      case 'entityRemove':
        for (const id of event.ids)
          this.entities.delete(id)
        break
      case 'camera':
        this.camera = { ...event }
        break
    }
  }
}
