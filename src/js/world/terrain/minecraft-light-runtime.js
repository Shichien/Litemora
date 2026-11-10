const AIR = 'minecraft:air'

/** One worker owns the logical source, independently of render-only mesh clearing. */
export class MinecraftLightRuntime {
  constructor({ onField = () => {}, onStatus = () => {}, workerFactory = () => new Worker(new URL('./minecraft-light.worker.js', import.meta.url), { type: 'module' }), maxVoxels = 4 * 1024 * 1024, maxAxis = 256 } = {}) {
    this.onField = onField
    this.onStatus = onStatus
    this.workerFactory = workerFactory
    this.maxVoxels = maxVoxels
    this.maxAxis = maxAxis
    this.status = { state: 'idle', message: '' }
    this.field = null
    this.worker = null
    this.generation = 0
    this.version = 0
    this.appliedVersion = -1
    this.minimumVersion = 0
    this.pending = new Map()
    this.inFlight = false
    this.needsCommit = false
    this.initialized = false
    this.disposed = false
  }

  _status(state, message = '', extra = {}) {
    this.status = { state, message, version: this.version, ...extra }
    this.onStatus(this.status)
  }

  initialize(source = {}) {
    this.dispose()
    this.disposed = false
    this.generation++
    this.version = 1
    this.minimumVersion = 1
    this.appliedVersion = -1
    this.pending.clear()
    this.initialized = false
    this.inFlight = true
    this._status('loading', '正在计算天空光、方块光与环境遮蔽')
    const generation = this.generation
    try {
      const worker = this.workerFactory()
      this.worker = worker
      worker.onmessage = ({ data }) => {
        if (this.disposed || generation !== this.generation || this.worker !== worker)
          return
        this.inFlight = false
        if (data.type === 'limited' || data.type === 'error') {
          this.initialized = false
          this.field = null
          this.pending.clear()
          this.onField(null)
          this._status(data.type, data.message, { reason: data.reason, cells: data.cells, bounds: data.bounds })
          return
        }
        if (data.type !== 'field')
          return
        this.initialized = true
        // A continuously running replay must not starve the display by discarding
        // every solved frame merely because another update has already been queued.
        // Explicit seek/reset establishes a cutoff and does discard old results.
        if (data.version >= this.minimumVersion && data.version > this.appliedVersion) {
          this.appliedVersion = data.version
          this.field = { data: data.data, min: data.min, size: data.size }
          this.onField(this.field)
          this._status(data.unknownStates?.length ? 'limited' : 'ready', data.unknownStates?.length ? '部分方块缺少光学数据，已采用保守遮光规则' : '', { version: data.version, cells: data.cells, bounds: data.bounds, solveMs: data.solveMs, unknownStates: data.unknownStates, reason: data.unknownStates?.length ? 'unknown_block_states' : undefined })
        }
        this._flush()
      }
      worker.onerror = (event) => {
        if (generation !== this.generation || this.disposed)
          return
        this.inFlight = false
        this.initialized = false
        this.field = null
        this.onField(null)
        this._status('error', '光场计算失败，当前使用基础方向光照', { reason: event.message || 'worker_error' })
      }
      // Structured clone leaves the original schematic available to the renderer.
      worker.postMessage({ type: 'initialize', version: this.version, buffer: source.buffer, name: source.name || '', offset: source.offset || {}, maxVoxels: this.maxVoxels, maxAxis: this.maxAxis })
    }
    catch (error) {
      this.inFlight = false
      this.onField(null)
      this._status('error', '当前环境无法计算光场，使用基础方向光照', { reason: error.message })
    }
  }

  setBlock(x, y, z, state = AIR) {
    if (this.disposed || !this.worker)
      return
    const position = { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
    this.pending.set(`${position.x},${position.y},${position.z}`, { ...position, state: state || AIR })
  }

  setBlocks(changes = []) {
    for (const block of changes) this.setBlock(block.x, block.y, block.z, block.state ?? block.blockString)
  }

  commit({ reset = false } = {}) {
    if (this.disposed || !this.worker || (!this.pending.size && !reset))
      return
    this.version++
    this.needsCommit = true
    if (reset)
      this.minimumVersion = this.version
    this._flush()
  }

  _flush() {
    if (this.inFlight || !this.initialized || !this.needsCommit || this.disposed)
      return
    const changes = [...this.pending.values()]
    this.pending.clear()
    this.needsCommit = false
    this.inFlight = true
    this.worker.postMessage({ type: 'update', version: this.version, changes })
  }

  getLight(x, y, z) {
    const field = this.field
    if (!field || ![x, y, z].every(Number.isInteger))
      return null
    const px = x - field.min.x
    const py = y - field.min.y
    const pz = z - field.min.z
    if (px < 0 || py < 0 || pz < 0 || px >= field.size.x || py >= field.size.y || pz >= field.size.z)
      return null
    const i = 4 * (px + field.size.x * (py + field.size.y * pz))
    return { sky: field.data[i], block: field.data[i + 1], ao: field.data[i + 2], emission: field.data[i + 3] }
  }

  dispose() {
    this.field = null
    this.generation++
    this.disposed = true
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
    this.inFlight = false
    this.needsCommit = false
    this.initialized = false
    this.onField(null)
    this._status('idle')
  }
}
