import { getMinecraftLightProperties, LIGHT_DATA_VERSION } from './minecraft-light-properties.js'

/** Fixed padded volume. Caller must include >=15 air cells around the structure. */
export function createVoxelLightField({ min, size, blocks = [], maxVoxels = 4194304, strictUnknown = false }) {
  const origin = { ...min }
  const dimensions = { ...size }
  for (const key of ['x', 'y', 'z']) {
    if (!Number.isSafeInteger(origin[key]) || !Number.isSafeInteger(dimensions[key]) || dimensions[key] <= 0)
      throw new RangeError('Light field requires integer min and positive size')
  }
  const { x: sx, y: sy, z: sz } = dimensions
  const count = sx * sy * sz
  if (!Number.isSafeInteger(count) || count > maxVoxels)
    throw new RangeError(`Light field volume ${count} exceeds ${maxVoxels}`)
  const data = new Uint8Array(count * 4)
  const opacity = new Uint8Array(count)
  const faceOcclusion = new Uint8Array(count)
  const queued = new Uint8Array(count)
  const queue = new Uint32Array(count)
  const states = new Map()
  let unknownStates = []
  let field
  const indexOf = (x, y, z) => {
    x -= origin.x
    y -= origin.y
    z -= origin.z
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) && x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz ? x + sx * (y + sy * z) : -1
  }
  function setBlock(x, y, z, state) {
    const index = indexOf(x, y, z)
    if (index < 0)
      throw new RangeError(`Block outside fixed light field: ${x},${y},${z}`)
    if (!state || state === 'minecraft:air' || state === 'air')
      states.delete(index)
    else states.set(index, state)
    return field
  }
  function propagate(channel) {
    queued.fill(0)
    let head = 0
    let tail = 0
    let pending = 0
    const enqueue = (i) => {
      if (queued[i])
        return
      queue[tail] = i
      tail = (tail + 1) % count
      pending++
      queued[i] = 1
    }
    for (let i = 0; i < count; i++) {
      if (data[4 * i + channel] > 0)
        enqueue(i)
    }
    while (pending) {
      const i = queue[head]
      head = (head + 1) % count
      pending--
      queued[i] = 0
      const level = data[4 * i + channel]
      const x = i % sx
      const y = Math.floor(i / sx) % sy
      const z = Math.floor(i / (sx * sy))
      const spread = (neighbor, down, sourceFace, targetFace) => {
        if (opacity[neighbor] >= 15 || (faceOcclusion[neighbor] & targetFace))
          return
        const ownEmission = channel === 1 && data[4 * i + 3] > 0 && level === data[4 * i + 3]
        if ((faceOcclusion[i] & sourceFace) && !ownEmission)
          return
        const loss = channel === 0 && down && level === 15 ? opacity[neighbor] : Math.max(1, opacity[neighbor])
        const next = level - loss
        if (next > data[4 * neighbor + channel]) {
          data[4 * neighbor + channel] = next
          enqueue(neighbor)
        }
      }
      if (x > 0)
        spread(i - 1, false, 2, 1)
      if (x + 1 < sx)
        spread(i + 1, false, 1, 2)
      if (y > 0)
        spread(i - sx, true, 8, 4)
      if (y + 1 < sy)
        spread(i + sx, false, 4, 8)
      if (z > 0)
        spread(i - sx * sy, false, 32, 16)
      if (z + 1 < sz)
        spread(i + sx * sy, false, 16, 32)
    }
  }
  function rebuild() {
    data.fill(0)
    opacity.fill(0)
    faceOcclusion.fill(0)
    const unknown = new Set()
    for (const [i, state] of states) {
      const p = getMinecraftLightProperties(state)
      if (!p.known)
        unknown.add(p.name)
      opacity[i] = p.opacity
      faceOcclusion[i] = p.faceOcclusion
      data[4 * i + 1] = p.emission
      data[4 * i + 2] = p.ao
      data[4 * i + 3] = p.emission
    }
    unknownStates = [...unknown].sort()
    if (strictUnknown && unknownStates.length)
      throw new Error(`Unknown block light properties: ${unknownStates.join(', ')}`)
    // Only open sky above the fixed volume is a source. Air padding permits side light.
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        let level = 15
        for (let y = sy - 1; y >= 0; y--) {
          const i = x + sx * (y + sy * z)
          if (opacity[i] >= 15 || (faceOcclusion[i] & 4) || (y + 1 < sy && (faceOcclusion[i + sx] & 8)))
            break
          level -= level === 15 ? opacity[i] : Math.max(1, opacity[i])
          if (level <= 0)
            break
          data[4 * i] = level
        }
      }
    }
    propagate(0)
    propagate(1)
    field.revision++
    return field
  }
  field = {
    min: origin,
    size: dimensions,
    data,
    revision: 0,
    dataVersion: LIGHT_DATA_VERSION,
    memoryBytes: data.byteLength + opacity.byteLength + faceOcclusion.byteLength + queued.byteLength + queue.byteLength,
    get unknownStates() { return [...unknownStates] },
    setBlock,
    rebuild,
    getLight(x, y, z) {
      const i = indexOf(x, y, z)
      return i < 0 ? { sky: 15, block: 0, ao: 0 } : { sky: data[4 * i], block: data[4 * i + 1], ao: data[4 * i + 2] }
    },
  }
  for (const block of blocks) setBlock(block.x, block.y, block.z, block.state)
  return rebuild()
}
