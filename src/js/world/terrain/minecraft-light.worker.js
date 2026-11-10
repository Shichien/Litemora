import { createVoxelLightField } from './minecraft-voxel-light-field.js'
import schematicService from './schematic-service.js'

const PADDING = 15
let field = null
let bounds = null
const isAir = state => /^(?:minecraft:)?(?:air|cave_air|void_air)$/.test(state)

export function sourceLightBounds(regions, offset = {}, padding = PADDING) {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const region of Object.values(regions)) {
    for (const axis of ['x', 'y', 'z']) {
      const count = Number(region.size[axis])
      const base = Number(region.position[axis] || 0) + (count < 0 ? count + 1 : 0) + Math.round(offset[axis] || 0)
      min[axis] = Math.min(min[axis], base)
      max[axis] = Math.max(max[axis], base + Math.abs(count))
    }
  }
  const size = {}
  for (const axis of ['x', 'y', 'z']) {
    if (!Number.isFinite(min[axis]) || max[axis] <= min[axis])
      throw new Error('empty_schematic_bounds')
    min[axis] -= padding
    size[axis] = max[axis] - min[axis] + padding
  }
  return { min, size }
}

function* sourceBlocks(schematic, offset) {
  const seen = Object.keys(schematic.regions).length > 1 ? new Map() : null
  for (const region of Object.values(schematic.regions)) {
    const base = schematicService._getRegionWorldBase(region)
    const sx = Math.abs(region.size.x)
    const sz = Math.abs(region.size.z)
    const indices = schematicService._getDecodedIndices(region)
    const palette = Object.fromEntries(Object.entries(region.palette).map(([index, state]) => {
      const properties = Object.entries(state.properties || {}).sort(([a], [b]) => a.localeCompare(b))
      return [index, state.name + (properties.length ? `[${properties.map(([k, v]) => `${k}=${v}`).join(',')}]` : '')]
    }))
    for (let i = 0; i < indices.length; i++) {
      const state = palette[indices[i]] || 'minecraft:air'
      if (isAir(state))
        continue
      const block = { x: base.x + i % sx + Math.round(offset.x || 0), y: base.y + Math.floor(i / (sx * sz)) + Math.round(offset.y || 0), z: base.z + Math.floor(i / sx) % sz + Math.round(offset.z || 0), state }
      if (seen) {
        const key = `${block.x},${block.y},${block.z}`
        if (seen.has(key) && seen.get(key) !== state)
          throw new Error(`conflicting_region_overlap:${key}`)
        seen.set(key, state)
      }
      yield block
    }
    region._decodedIndices = null
  }
}

export async function processLightMessage(message) {
  const started = performance.now()
  if (message.type === 'initialize') {
    field = null
    const schematic = await schematicService.parseArrayBuffer(message.buffer, { sourceName: message.name, remember: false })
    bounds = sourceLightBounds(schematic.regions, message.offset)
    const cells = bounds.size.x * bounds.size.y * bounds.size.z
    if (cells > message.maxVoxels || Object.values(bounds.size).some(value => value > message.maxAxis)) {
      return { type: 'limited', reason: 'field_budget_exceeded', cells, bounds, message: '该投影超出完整光场预算，暂用基础方向光照；天空光、方块光及邻居遮蔽未启用' }
    }
    field = createVoxelLightField({ ...bounds, blocks: sourceBlocks(schematic, message.offset || {}), maxVoxels: message.maxVoxels })
  }
  else if (message.type === 'update') {
    if (!field)
      return { type: 'error', message: '光场未初始化，当前使用基础方向光照', reason: 'field_unavailable' }
    for (const change of message.changes) {
      try {
        field.setBlock(change.x, change.y, change.z, change.state)
      }
      catch {
        field = null
        return { type: 'limited', reason: 'motion_outside_light_field', bounds, message: '运动超出已计算光场，暂用基础方向光照' }
      }
    }
    field.rebuild()
  }
  else {
    throw new Error('invalid_light_worker_message')
  }
  return { type: 'field', version: message.version, min: field.min, size: field.size, data: field.data.slice(), cells: field.size.x * field.size.y * field.size.z, bounds, solveMs: performance.now() - started, unknownStates: field.unknownStates }
}

// Module also exports the worker operation for deterministic source parsing tests.
if (typeof globalThis.WorkerGlobalScope !== 'undefined' && globalThis instanceof globalThis.WorkerGlobalScope) {
  let queue = Promise.resolve()
  globalThis.onmessage = ({ data }) => {
    queue = queue.then(async () => {
      try {
        const result = await processLightMessage(data)
        globalThis.postMessage(result, result.data ? [result.data.buffer] : [])
      }
      catch (error) {
        globalThis.postMessage({ type: 'error', reason: error.message, message: '该原理图的光场计算失败，当前使用基础方向光照' })
      }
    })
  }
}
