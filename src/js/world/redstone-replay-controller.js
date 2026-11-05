import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import emitter from '../utils/event/event-bus.js'

const REPLAY_FORMAT = 'litemora-redstone-replay-v1'
const DEFAULT_SPEED = 1
const PISTON_MOTION_DURATION_TICKS = 2
const AIR_BLOCK_STRING = 'minecraft:air'
const INITIAL_INSTANCE_CAPACITY = 16

const BLOCK_DIRECTIONS = Object.freeze({
  down: Object.freeze({ x: 0, y: -1, z: 0 }),
  east: Object.freeze({ x: 1, y: 0, z: 0 }),
  north: Object.freeze({ x: 0, y: 0, z: -1 }),
  south: Object.freeze({ x: 0, y: 0, z: 1 }),
  up: Object.freeze({ x: 0, y: 1, z: 0 }),
  west: Object.freeze({ x: -1, y: 0, z: 0 }),
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function blockKey(x, y, z) {
  return `${x},${y},${z}`
}

function normalizeOffset(offset = {}) {
  return {
    x: Math.floor(Number(offset.x || 0)),
    y: Math.floor(Number(offset.y || 0)),
    z: Math.floor(Number(offset.z || 0)),
  }
}

function getBlockProperty(blockString, propertyName) {
  const propertiesMatch = String(blockString || '').match(/\[([^\]]*)\]$/u)
  if (!propertiesMatch) {
    return ''
  }

  for (const entry of propertiesMatch[1].split(',')) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex < 0) {
      continue
    }
    if (entry.slice(0, separatorIndex).trim() === propertyName) {
      return entry.slice(separatorIndex + 1).trim()
    }
  }
  return ''
}

function isMovingPistonBlock(blockString) {
  return String(blockString || '').startsWith('minecraft:moving_piston')
}

function createPistonHeadBlockString(facing, type) {
  return `minecraft:piston_head[facing=${facing},short=false,type=${type === 'sticky' ? 'sticky' : 'normal'}]`
}

function isRetractionBlockMovement(sourceClearMicroSteps, change, direction) {
  const sourceX = Number(change.x) + direction.x
  const sourceY = Number(change.y) + direction.y
  const sourceZ = Number(change.z) + direction.z
  const movingMicroStep = Number(change.microStep || 0)
  const latestSourceClear = sourceClearMicroSteps.get(blockKey(sourceX, sourceY, sourceZ))
  return Number.isFinite(latestSourceClear) && latestSourceClear >= movingMicroStep
}

function buildPistonMotionTimeline(replay) {
  const motions = []
  const motionByChange = new WeakMap()
  const motionBlockStrings = new Set()
  const motionStarts = []
  const unsettledByPosition = new Map()

  for (const frame of replay.frames) {
    let frameMotionCount = 0
    const sourceClearMicroSteps = new Map()
    for (const change of frame.changes || []) {
      if (change.cause !== 'piston_source_clear') {
        continue
      }
      const key = blockKey(change.x, change.y, change.z)
      const microStep = Number(change.microStep || 0)
      sourceClearMicroSteps.set(key, Math.max(sourceClearMicroSteps.get(key) || 0, microStep))
    }

    for (const change of frame.changes || []) {
      const key = blockKey(change.x, change.y, change.z)
      const blockString = replay.palette[change.state]

      if (!isMovingPistonBlock(blockString)) {
        const unsettled = unsettledByPosition.get(key)
        if (unsettled) {
          unsettled.settledBlockString = blockString
          unsettledByPosition.delete(key)
        }
        continue
      }

      const facing = getBlockProperty(blockString, 'facing')
      const direction = BLOCK_DIRECTIONS[facing]
      if (!direction) {
        throw new Error(`活塞运动缺少有效朝向: ${blockString}`)
      }

      const cause = String(change.cause || '')
      const isRetraction = cause === 'piston_retracting_base'
        || (
          cause === 'piston_moving_block'
          && isRetractionBlockMovement(sourceClearMicroSteps, change, direction)
        )
      const startDirection = isRetraction ? 1 : -1
      const pistonType = getBlockProperty(blockString, 'type')
      const fullHeadBlockString = createPistonHeadBlockString(facing, pistonType)
      const shortHeadBlockString = fullHeadBlockString.replace('short=false', 'short=true')
      const motion = {
        key,
        cause,
        isRetraction,
        startTick: frame.tick,
        destination: {
          x: Number(change.x),
          y: Number(change.y),
          z: Number(change.z),
        },
        start: {
          x: Number(change.x) + (direction.x * startDirection),
          y: Number(change.y) + (direction.y * startDirection),
          z: Number(change.z) + (direction.z * startDirection),
        },
        settledBlockString: '',
        visualBlockString: cause === 'piston_moving_block'
          ? ''
          : fullHeadBlockString,
        shortVisualBlockString: cause === 'piston_moving_block'
          ? ''
          : shortHeadBlockString,
        baseBlockString: cause === 'piston_retracting_base'
          ? replay.palette[change.previousState]
          : AIR_BLOCK_STRING,
      }

      motions.push(motion)
      frameMotionCount += 1
      motionByChange.set(change, motion)
      unsettledByPosition.set(key, motion)
    }
    if (frameMotionCount > 0) {
      motionStarts.push({ tick: frame.tick, count: frameMotionCount })
    }
  }

  for (const motion of motions) {
    if (!motion.settledBlockString) {
      throw new Error(`活塞运动没有稳定状态: ${motion.key} @ ${motion.startTick}`)
    }
    if (motion.cause === 'piston_moving_block') {
      motion.visualBlockString = motion.settledBlockString
    }
    for (const blockString of [
      motion.visualBlockString,
      motion.shortVisualBlockString,
      motion.baseBlockString,
    ]) {
      if (blockString && blockString !== AIR_BLOCK_STRING) {
        motionBlockStrings.add(blockString)
      }
    }
  }

  let maxConcurrentMotions = 0
  let activeMotionCount = 0
  const activeMotionStarts = []
  for (const entry of motionStarts) {
    activeMotionStarts.push(entry)
    activeMotionCount += entry.count
    while ((entry.tick - activeMotionStarts[0].tick) > PISTON_MOTION_DURATION_TICKS) {
      activeMotionCount -= activeMotionStarts.shift().count
    }
    maxConcurrentMotions = Math.max(maxConcurrentMotions, activeMotionCount)
  }

  return {
    maxConcurrentMotions,
    motionBlockStrings,
    motionByChange,
    motionCount: motions.length,
  }
}

function getMaxActiveBlockCount(replay) {
  const states = new Map()
  let activeBlockCount = 0
  for (const entry of replay.baseline || []) {
    const key = blockKey(entry.x, entry.y, entry.z)
    states.set(key, entry.state)
    if (replay.palette[entry.state] !== AIR_BLOCK_STRING) {
      activeBlockCount += 1
    }
  }

  let maxActiveBlockCount = activeBlockCount
  for (const frame of replay.frames || []) {
    for (const change of frame.changes || []) {
      const key = blockKey(change.x, change.y, change.z)
      const previousState = states.get(key) ?? 0
      const wasActive = replay.palette[previousState] !== AIR_BLOCK_STRING
      const isActive = replay.palette[change.state] !== AIR_BLOCK_STRING
      if (wasActive !== isActive) {
        activeBlockCount += isActive ? 1 : -1
      }
      states.set(key, change.state)
      maxActiveBlockCount = Math.max(maxActiveBlockCount, activeBlockCount)
    }
  }
  return maxActiveBlockCount
}

// Long replays are stored as `.replay.json.gz` to stay under the static hosting
// per-file limit. The server may or may not add `Content-Encoding: gzip`, so the
// payload is sniffed for the gzip magic bytes instead of trusting headers.
async function parseReplayResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B
  if (!isGzip) {
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('当前浏览器不支持解压红石回放')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

export function resolveRedstoneReplayUrl(item = null, backendConfig = null) {
  return String(
    item?.redstoneReplayUrl
    || backendConfig?.settings?.redstoneArchive?.replayUrl
    || '',
  ).trim()
}

export async function fetchRedstoneReplay(replayUrl) {
  const response = await fetch(replayUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`红石回放请求失败: ${response.status}`)
  }
  return parseReplayResponse(response)
}

function validateReplay(replay) {
  if (!replay || typeof replay !== 'object') {
    throw new Error('红石回放文件不是有效对象')
  }
  if (replay.format !== REPLAY_FORMAT) {
    throw new Error(`不支持的红石回放格式: ${replay.format || 'unknown'}`)
  }
  if (!Array.isArray(replay.palette) || !replay.palette.length) {
    throw new Error('红石回放缺少方块状态表')
  }
  if (!Array.isArray(replay.baseline) || !Array.isArray(replay.frames)) {
    throw new TypeError('红石回放缺少初始状态或时间线')
  }

  const paletteSize = replay.palette.length
  const validateState = (entry, label) => {
    if (!Number.isInteger(entry?.state) || entry.state < 0 || entry.state >= paletteSize) {
      throw new Error(`${label}引用了不存在的方块状态`)
    }
  }

  for (const entry of replay.baseline) {
    validateState(entry, '初始状态')
  }
  for (const frame of replay.frames) {
    if (!Number.isInteger(frame?.tick) || frame.tick < 0) {
      throw new Error('红石回放包含无效游戏刻')
    }
    for (const change of frame.changes || []) {
      validateState(change, `第 ${frame.tick} 游戏刻`)
    }
  }

  return replay
}

function getMaterialBatchSignature(material) {
  return JSON.stringify({
    type: material?.type || '',
    map: material?.map?.uuid || '',
    alphaMap: material?.alphaMap?.uuid || '',
    opacity: material?.opacity ?? 1,
    alphaTest: material?.alphaTest ?? 0,
    transparent: !!material?.transparent,
    side: material?.side ?? THREE.FrontSide,
    blending: material?.blending ?? THREE.NormalBlending,
    depthTest: material?.depthTest !== false,
    depthWrite: material?.depthWrite !== false,
    premultipliedAlpha: !!material?.premultipliedAlpha,
  })
}

function getGeometryLayoutSignature(geometry) {
  const attributes = Object.entries(geometry?.attributes || {})
    .map(([name, attribute]) => ({
      name,
      itemSize: attribute.itemSize,
      normalized: attribute.normalized,
      array: attribute.array?.constructor?.name || '',
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return JSON.stringify({
    attributes,
    indexed: !!geometry?.getIndex?.(),
  })
}

class BatchedBlockModelRegistry {
  constructor(templates) {
    this.models = new Map()
    this.pools = new Map()
    this.geometries = new Set()

    for (const [blockString, template] of templates) {
      const inverseRoot = new THREE.Matrix4()
      const sourceParts = []
      const partCounts = new Map()
      template.updateMatrixWorld(true)
      inverseRoot.copy(template.matrixWorld).invert()

      template.traverse((child) => {
        if (!child?.isMesh) {
          return
        }
        if (Array.isArray(child.material)) {
          throw new TypeError(`方块合批不支持多材质网格: ${blockString}`)
        }

        const material = child.material
        const geometry = child.geometry
        const poolKey = `${getMaterialBatchSignature(material)}:${getGeometryLayoutSignature(geometry)}`
        const color = material.color?.clone?.() || new THREE.Color(0xFFFFFF)
        let pool = this.pools.get(poolKey)
        if (!pool) {
          material.color?.set?.(0xFFFFFF)
          material.needsUpdate = true
          pool = {
            key: poolKey,
            material,
            geometries: new Map(),
            maxPartsPerBlock: 0,
            vertexCount: 0,
            indexCount: 0,
          }
          this.pools.set(poolKey, pool)
        }

        sourceParts.push({
          poolKey,
          geometry,
          color,
          relativeMatrix: new THREE.Matrix4().multiplyMatrices(inverseRoot, child.matrixWorld),
        })
      })

      if (!sourceParts.length) {
        throw new Error(`方块合批缺少可渲染模型: ${blockString}`)
      }

      const partsByAppearance = new Map()
      for (const part of sourceParts) {
        const appearanceKey = [
          part.poolKey,
          part.color.r,
          part.color.g,
          part.color.b,
        ].join(':')
        if (!partsByAppearance.has(appearanceKey)) {
          partsByAppearance.set(appearanceKey, [])
        }
        partsByAppearance.get(appearanceKey).push(part)
      }

      const modelParts = []
      for (const parts of partsByAppearance.values()) {
        const transformedGeometries = parts.map((part) => {
          const geometry = part.geometry.clone()
          geometry.applyMatrix4(part.relativeMatrix)
          return geometry
        })
        const mergedGeometry = transformedGeometries.length === 1
          ? transformedGeometries[0]
          : mergeGeometries(transformedGeometries, false)

        if (transformedGeometries.length > 1) {
          for (const geometry of transformedGeometries) {
            geometry.dispose()
          }
        }
        if (!mergedGeometry) {
          throw new Error(`方块合批无法合并模型片段: ${blockString}`)
        }

        const { poolKey, color } = parts[0]
        const pool = this.pools.get(poolKey)
        const geometryKey = mergedGeometry.uuid
        pool.geometries.set(geometryKey, mergedGeometry)
        pool.vertexCount += mergedGeometry.getAttribute('position')?.count || 0
        pool.indexCount += mergedGeometry.getIndex()?.count || 0
        this.geometries.add(mergedGeometry)
        modelParts.push({
          poolKey,
          geometryKey,
          color,
          relativeMatrix: new THREE.Matrix4(),
        })
        partCounts.set(poolKey, (partCounts.get(poolKey) || 0) + 1)
      }

      this.models.set(blockString, modelParts)
      for (const [poolKey, count] of partCounts) {
        const pool = this.pools.get(poolKey)
        pool.maxPartsPerBlock = Math.max(pool.maxPartsPerBlock, count)
      }
    }
  }

  getModel(blockString) {
    return this.models.get(blockString) || null
  }

  dispose() {
    for (const geometry of this.geometries) {
      geometry.dispose()
    }
    this.geometries.clear()
  }
}

class BatchedBlockLayer {
  constructor({ name, parent, registry, maxBlockCount }) {
    this.name = name
    this.parent = parent
    this.registry = registry
    this.slots = new Map()
    this.pools = new Map()
    this._translationMatrix = new THREE.Matrix4()
    this._instanceMatrix = new THREE.Matrix4()

    for (const descriptor of registry.pools.values()) {
      const maxInstanceCount = Math.max(
        INITIAL_INSTANCE_CAPACITY,
        maxBlockCount * descriptor.maxPartsPerBlock,
      )
      const mesh = new THREE.BatchedMesh(
        maxInstanceCount,
        Math.max(1, descriptor.vertexCount),
        Math.max(1, descriptor.indexCount),
        descriptor.material,
      )
      mesh.name = `${name}:${this.pools.size}`
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      mesh.perObjectFrustumCulled = true
      mesh.sortObjects = false
      mesh.renderOrder = 10
      parent.add(mesh)

      const geometryIds = new Map()
      for (const [geometryKey, geometry] of descriptor.geometries) {
        geometryIds.set(geometryKey, mesh.addGeometry(geometry))
      }
      this.pools.set(descriptor.key, {
        mesh,
        geometryIds,
        activeInstances: 0,
        freeInstanceIds: [],
      })
    }
  }

  _writePart(pool, instanceId, part, worldBlock) {
    this._translationMatrix.makeTranslation(worldBlock.x, worldBlock.y, worldBlock.z)
    this._instanceMatrix.multiplyMatrices(this._translationMatrix, part.relativeMatrix)
    pool.mesh.setMatrixAt(instanceId, this._instanceMatrix)
  }

  _acquireInstance(pool, geometryId) {
    const reusableId = pool.freeInstanceIds.pop()
    const instanceId = reusableId === undefined
      ? pool.mesh.addInstance(geometryId)
      : reusableId
    if (reusableId !== undefined) {
      pool.mesh.setGeometryIdAt(instanceId, geometryId)
      pool.mesh.setVisibleAt(instanceId, true)
    }
    pool.activeInstances += 1
    return instanceId
  }

  _releaseInstance(instance) {
    instance.pool.mesh.setVisibleAt(instance.id, false)
    instance.pool.freeInstanceIds.push(instance.id)
    instance.pool.activeInstances -= 1
  }

  set(key, blockString, worldBlock) {
    const normalizedBlockString = String(blockString || AIR_BLOCK_STRING)
    const previous = this.slots.get(key)
    if (previous?.blockString === normalizedBlockString) {
      for (let index = 0; index < previous.instances.length; index += 1) {
        const instance = previous.instances[index]
        this._writePart(instance.pool, instance.id, previous.model[index], worldBlock)
      }
      return
    }

    if (normalizedBlockString === AIR_BLOCK_STRING) {
      this.remove(key)
      return
    }

    const model = this.registry.getModel(normalizedBlockString)
    if (!model) {
      throw new Error(`方块合批缺少模型: ${normalizedBlockString}`)
    }
    const reusableByPool = new Map()
    for (const instance of previous?.instances || []) {
      if (!reusableByPool.has(instance.pool)) {
        reusableByPool.set(instance.pool, [])
      }
      reusableByPool.get(instance.pool).push(instance)
    }

    const instances = []
    for (const part of model) {
      const pool = this.pools.get(part.poolKey)
      const geometryId = pool?.geometryIds.get(part.geometryKey)
      if (!pool || geometryId === undefined) {
        throw new Error(`方块合批缺少几何资源: ${normalizedBlockString}`)
      }
      const reusable = reusableByPool.get(pool)?.pop() || null
      const instanceId = reusable?.id ?? this._acquireInstance(pool, geometryId)
      if (reusable) {
        pool.mesh.setGeometryIdAt(instanceId, geometryId)
      }
      pool.mesh.setColorAt(instanceId, part.color)
      this._writePart(pool, instanceId, part, worldBlock)
      instances.push({ pool, id: instanceId })
    }

    for (const reusable of reusableByPool.values()) {
      for (const instance of reusable) {
        this._releaseInstance(instance)
      }
    }
    this.slots.set(key, {
      blockString: normalizedBlockString,
      instances,
      model,
    })
  }

  remove(key) {
    const slot = this.slots.get(key)
    if (!slot) {
      return false
    }
    for (const instance of slot.instances) {
      this._releaseInstance(instance)
    }
    this.slots.delete(key)
    return true
  }

  clear() {
    for (const key of [...this.slots.keys()]) {
      this.remove(key)
    }
  }

  getStats() {
    const activePools = [...this.pools.values()]
      .filter(pool => pool.activeInstances > 0)
    return {
      batches: activePools.length,
      drawCalls: activePools.length,
      instances: this.slots.size,
      meshParts: activePools.reduce((total, pool) => total + pool.activeInstances, 0),
    }
  }

  destroy() {
    this.clear()
    for (const pool of this.pools.values()) {
      this.parent.remove(pool.mesh)
      pool.mesh.dispose?.()
      pool.mesh.geometry?.dispose?.()
    }
    this.pools.clear()
  }
}

export default class RedstoneReplayController {
  constructor({ world }) {
    this.world = world
    this.experience = world.experience
    this.scene = world.scene
    this.replay = null
    this.offset = { x: 0, y: 0, z: 0 }
    this.available = false
    this.ready = false
    this.playing = false
    this.speed = DEFAULT_SPEED
    this.currentTick = 0
    this.currentFrameIndex = 0
    this.tickAccumulator = 0
    this.lastChangedBlocks = 0
    this.error = ''
    this._actionTargets = new Set()
    this._actionTargetPositions = []
    this._actionTargetIndexByKey = new Map()
    this._interactionMesh = null
    this._interactionWorldBlocks = []
    this._interactionBlockStrings = []
    this._commandHandler = this._handleCommand.bind(this)
    this._useBlockInterceptor = this._handleUseBlock.bind(this)
    this._motionByChange = new WeakMap()
    this._motionBlockStrings = new Set()
    this._motionCount = 0
    this._maxConcurrentMotions = 0
    this._maxActiveBlockCount = 0
    this._motionTemplates = new Map()
    this._activeMotions = new Map()
    this._blockModelRegistry = null
    this._motionLayer = null
    this._dynamicPositionKeys = new Set()
    this._dynamicPositions = new Map()
    this._dynamicLayer = null
    this._simulationStates = new Map()
    this._motionResourcesPromise = null
    this._destroyed = false
    this._motionGroup = new THREE.Group()
    this._motionGroup.name = 'redstone-replay-piston-motion'
    this.scene.add(this._motionGroup)
    this._dynamicGroup = new THREE.Group()
    this._dynamicGroup.name = 'redstone-replay-dynamic-blocks'
    this.scene.add(this._dynamicGroup)
    this._interactionGroup = new THREE.Group()
    this._interactionGroup.name = 'redstone-replay-interaction-targets'
    this.scene.add(this._interactionGroup)

    emitter.on('redstone-replay:command', this._commandHandler)
  }

  async initialize() {
    try {
      const replaySource = await this._resolveReplaySource()
      if (!replaySource) {
        return false
      }

      this.replay = validateReplay(replaySource)
      this.offset = normalizeOffset(this.world._getProjectionPlacementOffset?.())
      const motionTimeline = buildPistonMotionTimeline(this.replay)
      this._motionByChange = motionTimeline.motionByChange
      this._motionBlockStrings = motionTimeline.motionBlockStrings
      this._motionCount = motionTimeline.motionCount
      this._maxConcurrentMotions = motionTimeline.maxConcurrentMotions
      this._maxActiveBlockCount = getMaxActiveBlockCount(this.replay)
      for (const entry of this.replay.baseline) {
        const key = blockKey(entry.x, entry.y, entry.z)
        this._dynamicPositionKeys.add(key)
        this._dynamicPositions.set(key, {
          x: Number(entry.x),
          y: Number(entry.y),
          z: Number(entry.z),
        })
      }
      for (const frame of this.replay.frames) {
        for (const change of frame.changes || []) {
          const key = blockKey(change.x, change.y, change.z)
          this._dynamicPositionKeys.add(key)
          this._dynamicPositions.set(key, {
            x: Number(change.x),
            y: Number(change.y),
            z: Number(change.z),
          })
        }
      }
      this._resetSimulationStates()
      const actionTargetPositions = new Map()
      for (const frame of this.replay.frames) {
        for (const entry of frame.actions || []) {
          const pos = entry?.action?.pos
          if (!pos) {
            continue
          }
          const worldBlock = {
            x: Math.floor(Number(pos.x)) + this.offset.x,
            y: Math.floor(Number(pos.y)) + this.offset.y,
            z: Math.floor(Number(pos.z)) + this.offset.z,
          }
          actionTargetPositions.set(
            blockKey(worldBlock.x, worldBlock.y, worldBlock.z),
            worldBlock,
          )
        }
      }
      this._actionTargetPositions = [...actionTargetPositions.values()]
      this._actionTargets = new Set(actionTargetPositions.keys())
      this.available = true
      this.world.blockInteractionManager?.setUseBlockInterceptor?.(this._useBlockInterceptor)
      this._emitState()
      return true
    }
    catch (error) {
      this.available = true
      this.error = error?.message || '红石回放载入失败'
      this._emitState()
      console.error('[RedstoneReplay] Failed to initialize:', error)
      return false
    }
  }

  async _resolveReplaySource() {
    const item = this.world.activeProjectionContext?.item || null
    const embeddedReplay = item?.redstoneReplay
    if (embeddedReplay && typeof embeddedReplay === 'object') {
      return embeddedReplay
    }

    const replayUrl = resolveRedstoneReplayUrl(item, this.world.backendConfig)
    if (!replayUrl) {
      return null
    }

    const prefetched = this.world.takePrefetchedRedstoneReplay?.(replayUrl)
    if (prefetched) {
      return prefetched
    }

    return fetchRedstoneReplay(replayUrl)
  }

  _resetSimulationStates() {
    this._simulationStates.clear()
    for (const entry of this.replay?.baseline || []) {
      this._simulationStates.set(blockKey(entry.x, entry.y, entry.z), entry)
    }
  }

  _beginPreparingMotionResources() {
    if (this._motionResourcesPromise || this._destroyed) {
      return
    }

    this._motionResourcesPromise = this._prepareMotionResources()
      .then(() => {
        if (this._destroyed) {
          return
        }
        this.ready = true
        if (this.world.player?.movement && !this.world.player.movement.isFlying) {
          this.world.player.movement.toggleFlight()
          emitter.emit('hud:flight-mode-changed', { enabled: true })
        }
        this.world._applyBackendSpawn?.(this.world.backendConfig?.player, { movePlayer: true })
        this._emitState()
      })
      .catch((error) => {
        if (this._destroyed) {
          return
        }
        this.error = error?.message || '活塞动画资源载入失败'
        this._emitState()
        console.error('[RedstoneReplay] Failed to prepare piston animation resources:', error)
      })
  }

  async _prepareMotionResources() {
    const renderLayer = this.world.minecraftSchematicRenderLayer
    const blockStrings = new Set()
    const collectState = (entry) => {
      if (!entry || !this._dynamicPositionKeys.has(blockKey(entry.x, entry.y, entry.z))) {
        return
      }
      const blockString = this.replay.palette[entry.state]
      if (blockString && blockString !== AIR_BLOCK_STRING && !isMovingPistonBlock(blockString)) {
        blockStrings.add(blockString)
      }
    }

    for (const entry of this.replay.baseline) {
      collectState(entry)
    }
    for (const frame of this.replay.frames) {
      for (const change of frame.changes || []) {
        collectState(change)
      }
    }
    for (const blockString of this._motionBlockStrings) {
      blockStrings.add(blockString)
    }

    const pendingBlockStrings = [...blockStrings]
    let nextBlockStringIndex = 0
    const workerCount = Math.min(8, pendingBlockStrings.length)
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextBlockStringIndex < pendingBlockStrings.length) {
        const blockString = pendingBlockStrings[nextBlockStringIndex]
        nextBlockStringIndex += 1
        const object = await renderLayer.createBlockPreviewObject(blockString)
        if (this._destroyed) {
          this._disposeMotionTemplate(object)
          return
        }
        this._motionTemplates.set(blockString, object)
      }
    }))

    this._blockModelRegistry = new BatchedBlockModelRegistry(this._motionTemplates)
    this._dynamicLayer = new BatchedBlockLayer({
      name: 'redstone-replay-dynamic-blocks',
      parent: this._dynamicGroup,
      registry: this._blockModelRegistry,
      maxBlockCount: this._maxActiveBlockCount,
    })
    if (this._maxConcurrentMotions > 0) {
      this._motionLayer = new BatchedBlockLayer({
        name: 'redstone-replay-piston-motion',
        parent: this._motionGroup,
        registry: this._blockModelRegistry,
        maxBlockCount: this._maxConcurrentMotions,
      })
    }

    const clearPatches = [...this._dynamicPositions.values()]
      .map(position => this._buildWorldPatch(position, AIR_BLOCK_STRING))
    const cleared = await renderLayer.setRuntimeBlocksAtWorldAsync(clearPatches)
    if (!cleared) {
      throw new Error('无法建立独立活塞渲染层')
    }

    for (const key of this._dynamicPositions.keys()) {
      const state = this._simulationStates.get(key)
      const blockString = state
        ? this.replay.palette[state.state]
        : AIR_BLOCK_STRING
      this._setDynamicBlock(key, blockString)
    }
    this._prepareActionTargetCollider()
    await this._prewarmMotionLayer()
  }

  async _prewarmMotionLayer() {
    if (!this._motionLayer || !this._blockModelRegistry) {
      return
    }

    const pools = [...this._motionLayer.pools.values()]
    const previousCulling = pools.map(pool => pool.mesh.perObjectFrustumCulled)
    const warmupColor = new THREE.Color(0xFFFFFF)
    const warmupInstances = pools.map((pool) => {
      const geometryId = pool.geometryIds.values().next().value
      if (geometryId === undefined) {
        throw new Error('活塞运动合批缺少预热几何资源')
      }

      const instanceIds = []
      const matrix = new THREE.Matrix4().makeTranslation(0, -1000000, 0)
      for (let index = 0; index < pool.mesh.maxInstanceCount; index += 1) {
        const instanceId = pool.mesh.addInstance(geometryId)
        pool.mesh.setMatrixAt(instanceId, matrix)
        pool.mesh.setColorAt(instanceId, warmupColor)
        instanceIds.push(instanceId)
      }
      pool.mesh.perObjectFrustumCulled = false
      return instanceIds
    })

    try {
      const renderer = this.experience.renderer
      const camera = this.experience.camera?.instance
      if (!renderer?.instance?.compileAsync || !renderer?.renderFrame || !camera) {
        throw new Error('活塞运动合批无法预热显卡资源')
      }
      await renderer.instance.compileAsync(this.scene, camera)
      renderer.renderFrame()
    }
    finally {
      for (let index = 0; index < pools.length; index += 1) {
        const pool = pools[index]
        for (const instanceId of warmupInstances[index]) {
          pool.mesh.setVisibleAt(instanceId, false)
          pool.freeInstanceIds.push(instanceId)
        }
        pool.mesh.perObjectFrustumCulled = previousCulling[index]
      }
      this.experience.renderer?.renderFrame?.()
    }
  }

  _prepareActionTargetCollider() {
    if (!this._actionTargetPositions.length || this._interactionMesh) {
      return
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      opacity: 0,
      transparent: true,
    })
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      this._actionTargetPositions.length,
    )
    const matrix = new THREE.Matrix4()
    this._interactionWorldBlocks = this._actionTargetPositions.map(position => ({ ...position }))
    this._interactionBlockStrings = []
    this._actionTargetIndexByKey.clear()
    for (let index = 0; index < this._interactionWorldBlocks.length; index += 1) {
      const worldBlock = this._interactionWorldBlocks[index]
      const replayKey = blockKey(
        worldBlock.x - this.offset.x,
        worldBlock.y - this.offset.y,
        worldBlock.z - this.offset.z,
      )
      const state = this._simulationStates.get(replayKey)
      this._interactionBlockStrings[index] = state
        ? this.replay.palette[state.state]
        : AIR_BLOCK_STRING
      this._actionTargetIndexByKey.set(replayKey, index)
      matrix.makeTranslation(worldBlock.x, worldBlock.y, worldBlock.z)
      mesh.setMatrixAt(index, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.name = 'redstone-replay-interaction-targets'
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    mesh.userData.minecraftDynamicBlockBatch = {
      blockStrings: this._interactionBlockStrings,
      worldBlocks: this._interactionWorldBlocks,
    }
    this._interactionMesh = mesh
    this._interactionGroup.add(mesh)
  }

  _handleUseBlock({ target } = {}) {
    const worldBlock = target?.worldBlock
    if (!this.available || !worldBlock) {
      return false
    }

    const key = blockKey(
      Math.floor(Number(worldBlock.x)),
      Math.floor(Number(worldBlock.y)),
      Math.floor(Number(worldBlock.z)),
    )
    if (!this._actionTargets.has(key)) {
      return false
    }

    void this.restart({ autoplay: true })
    return true
  }

  _handleCommand(command = {}) {
    if (!this.available) {
      return
    }

    switch (command.type) {
      case 'play':
        this.play()
        break
      case 'pause':
        this.pause()
        break
      case 'toggle':
        this.playing ? this.pause() : this.play()
        break
      case 'restart':
        void this.restart({ autoplay: !!command.autoplay })
        break
      case 'seek':
        void this.seek(command.tick)
        break
      case 'step':
        void this.seek(this.currentTick + Number(command.delta || 0))
        break
      case 'speed':
        this.setSpeed(command.speed)
        break
    }
  }

  play() {
    if (!this.ready) {
      return
    }
    if (this.currentTick >= this.replay.totalTicks) {
      void this.restart({ autoplay: true })
      return
    }
    this.playing = true
    this._emitState()
  }

  pause() {
    this.playing = false
    this._emitState()
  }

  setSpeed(speed) {
    const nextSpeed = Number(speed)
    if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) {
      return
    }
    this.speed = clamp(nextSpeed, 0.1, 8)
    this._emitState()
  }

  async restart({ autoplay = false } = {}) {
    await this.seek(0)
    if (autoplay) {
      this.play()
    }
  }

  async seek(targetTick) {
    if (!this.ready) {
      return
    }

    this.playing = false
    this._clearActiveMotions()
    const nextTick = clamp(
      Math.floor(Number(targetTick || 0)),
      0,
      Math.max(0, Number(this.replay.totalTicks || 0)),
    )
    this._resetSimulationStates()

    let nextFrameIndex = 0
    while (
      nextFrameIndex < this.replay.frames.length
      && this.replay.frames[nextFrameIndex].tick <= nextTick
    ) {
      const frame = this.replay.frames[nextFrameIndex]
      for (const change of frame.changes || []) {
        this._simulationStates.set(blockKey(change.x, change.y, change.z), change)
      }
      nextFrameIndex += 1
    }

    this._clearDynamicBlocks()
    const patches = []
    for (const entry of this._simulationStates.values()) {
      const key = blockKey(entry.x, entry.y, entry.z)
      const blockString = this._motionByChange.get(entry)?.settledBlockString
        || this.replay.palette[entry.state]
      if (this._dynamicPositionKeys.has(key)) {
        this._setDynamicBlock(key, blockString)
      }
      else {
        patches.push(this._buildWorldPatch(entry, blockString))
      }
    }
    if (patches.length) {
      await this.world.minecraftSchematicRenderLayer?.setRuntimeBlocksAtWorldAsync?.(patches)
    }
    this.currentTick = nextTick
    this.currentFrameIndex = nextFrameIndex
    this.tickAccumulator = 0
    this.lastChangedBlocks = this._simulationStates.size
    this._emitState()
  }

  _buildWorldPatch(change, blockString = this.replay.palette[change.state]) {
    return {
      worldX: Math.floor(Number(change.x)) + this.offset.x,
      worldY: Math.floor(Number(change.y)) + this.offset.y,
      worldZ: Math.floor(Number(change.z)) + this.offset.z,
      blockString,
    }
  }

  _advanceToTick(targetTick) {
    const changedPositions = new Set()
    while (
      this.currentFrameIndex < this.replay.frames.length
      && this.replay.frames[this.currentFrameIndex].tick <= targetTick
    ) {
      const frame = this.replay.frames[this.currentFrameIndex]
      this._updatePistonMotions(frame.tick)
      for (const change of frame.changes || []) {
        const key = blockKey(change.x, change.y, change.z)
        const motion = this._motionByChange.get(change) || null
        this._simulationStates.set(key, change)
        changedPositions.add(key)

        if (motion) {
          this._activateMotion(motion)
          this._setDynamicBlock(key, motion.baseBlockString)
        }
        else if (!this._activeMotions.has(key)) {
          this._setDynamicBlock(key, this.replay.palette[change.state])
        }
      }
      this.currentFrameIndex += 1
    }

    this.currentTick = targetTick
    this.lastChangedBlocks = changedPositions.size
    if (this.currentTick >= this.replay.totalTicks) {
      this.playing = false
    }
    this._emitState()
  }

  _setDynamicBlock(key, blockString) {
    const position = this._dynamicPositions.get(key)
    if (!position) {
      throw new Error(`独立方块渲染缺少坐标: ${key}`)
    }
    if (!this._dynamicLayer) {
      throw new Error('独立方块渲染层尚未准备完成')
    }
    const normalizedBlockString = String(blockString || AIR_BLOCK_STRING)
    this._dynamicLayer.set(key, normalizedBlockString, {
      x: this.offset.x + position.x,
      y: this.offset.y + position.y,
      z: this.offset.z + position.z,
    })
    const actionTargetIndex = this._actionTargetIndexByKey.get(key)
    if (actionTargetIndex !== undefined) {
      this._interactionBlockStrings[actionTargetIndex] = normalizedBlockString
    }
  }

  _clearDynamicBlocks() {
    this._dynamicLayer?.clear()
  }

  getRaycastTargets() {
    return this.ready && this._interactionMesh
      ? [this._interactionMesh]
      : []
  }

  _activateMotion(motion) {
    if (this._activeMotions.has(motion.key)) {
      this._removeMotionBlock(motion.key)
    }

    motion.completing = false
    motion.renderedBlockString = this._getMotionVisualBlockString(motion, 0)
    this._activeMotions.set(motion.key, motion)
    this._setMotionBlock(
      motion.key,
      motion.renderedBlockString,
      this.offset.x + motion.start.x,
      this.offset.y + motion.start.y,
      this.offset.z + motion.start.z,
    )
  }

  _getMotionVisualBlockString(motion, progress) {
    if (motion.cause === 'piston_moving_block') {
      return motion.visualBlockString
    }
    if (motion.isRetraction) {
      return progress >= 0.5
        ? motion.shortVisualBlockString
        : motion.visualBlockString
    }
    return progress <= 0.5
      ? motion.shortVisualBlockString
      : motion.visualBlockString
  }

  _setMotionBlock(key, blockString, x, y, z) {
    if (!this._motionLayer) {
      if (String(blockString || AIR_BLOCK_STRING) !== AIR_BLOCK_STRING) {
        throw new Error('活塞运动渲染层尚未准备完成')
      }
      return
    }
    this._motionLayer.set(key, blockString, { x, y, z })
  }

  _removeMotionBlock(key) {
    this._motionLayer?.remove(key)
  }

  _updatePistonMotions(playheadTick) {
    for (const motion of this._activeMotions.values()) {
      const progress = clamp(
        (playheadTick - motion.startTick) / PISTON_MOTION_DURATION_TICKS,
        0,
        1,
      )
      const visualBlockString = this._getMotionVisualBlockString(motion, progress)
      this._setMotionBlock(
        motion.key,
        visualBlockString,
        this.offset.x + motion.start.x + ((motion.destination.x - motion.start.x) * progress),
        this.offset.y + motion.start.y + ((motion.destination.y - motion.start.y) * progress),
        this.offset.z + motion.start.z + ((motion.destination.z - motion.start.z) * progress),
      )
      motion.renderedBlockString = visualBlockString

      if (progress >= 1 && !motion.completing) {
        this._completeMotion(motion)
      }
    }
  }

  _completeMotion(motion) {
    motion.completing = true
    const state = this._simulationStates.get(motion.key)
    if (!state) {
      throw new Error(`活塞运动结束时缺少方块状态: ${motion.key}`)
    }

    const currentMotion = this._motionByChange.get(state) || null
    const blockString = currentMotion
      ? currentMotion.settledBlockString
      : this.replay.palette[state.state]
    this._setDynamicBlock(motion.key, blockString)
    this._removeMotionBlock(motion.key)
    this._activeMotions.delete(motion.key)
  }

  _clearActiveMotions() {
    this._motionLayer?.clear()
    this._activeMotions.clear()
  }

  _disposeMotionTemplate(object) {
    const materials = new Set()
    object?.traverse?.((child) => {
      const childMaterials = Array.isArray(child?.material)
        ? child.material
        : [child?.material]
      for (const material of childMaterials) {
        if (material?.isMaterial) {
          materials.add(material)
        }
      }
    })
    for (const material of materials) {
      material.dispose()
    }
  }

  getStats() {
    const emptyStats = {
      batches: 0,
      drawCalls: 0,
      instances: 0,
      meshParts: 0,
    }

    return {
      dynamicPositions: this._dynamicPositionKeys.size,
      pistonMotions: this._motionCount,
      materialBatches: this._blockModelRegistry?.pools?.size || 0,
      dynamic: this._dynamicLayer?.getStats() || emptyStats,
      motion: this._motionLayer?.getStats() || emptyStats,
      activeMotions: this._activeMotions.size,
    }
  }

  update() {
    if (!this.available) {
      return
    }

    if (!this.ready && this.world.minecraftSchematicRenderLayer?.isRuntimeRendererActive?.()) {
      this._beginPreparingMotionResources()
    }

    const deltaMs = Math.max(0, Number(this.experience.time.delta || 0))
    if (!this.ready) {
      return
    }

    if (this.playing) {
      this.tickAccumulator += (deltaMs * this.speed * this.replay.ticksPerSecond) / 1000
      const elapsedTicks = Math.floor(this.tickAccumulator)
      if (elapsedTicks > 0) {
        this.tickAccumulator -= elapsedTicks
        this._advanceToTick(Math.min(this.replay.totalTicks, this.currentTick + elapsedTicks))
      }
    }

    this._updatePistonMotions(this.currentTick + this.tickAccumulator)
  }

  _emitState() {
    emitter.emit('redstone-replay:state', {
      available: this.available,
      ready: this.ready,
      playing: this.playing,
      speed: this.speed,
      currentTick: this.currentTick,
      totalTicks: Number(this.replay?.totalTicks || 0),
      ticksPerSecond: Number(this.replay?.ticksPerSecond || 20),
      title: String(this.replay?.title || '红石回放'),
      description: String(this.replay?.description || ''),
      changeCount: Number(this.replay?.changeCount || 0),
      lastChangedBlocks: this.lastChangedBlocks,
      engine: String(this.replay?.engine || ''),
      minecraftVersion: String(this.replay?.minecraftVersion || ''),
      error: this.error,
    })
  }

  destroy() {
    this._destroyed = true
    this.available = false
    emitter.off('redstone-replay:command', this._commandHandler)
    this.world.blockInteractionManager?.setUseBlockInterceptor?.(null)
    this._clearActiveMotions()
    this._clearDynamicBlocks()
    this._motionLayer?.destroy()
    this._motionLayer = null
    this._dynamicLayer?.destroy()
    this._dynamicLayer = null
    this._blockModelRegistry?.dispose()
    this._blockModelRegistry = null
    this.scene.remove(this._motionGroup)
    this.scene.remove(this._dynamicGroup)
    this.scene.remove(this._interactionGroup)
    if (this._interactionMesh) {
      this._interactionGroup.remove(this._interactionMesh)
      this._interactionMesh.geometry?.dispose?.()
      this._interactionMesh.material?.dispose?.()
      this._interactionMesh = null
    }
    for (const template of this._motionTemplates.values()) {
      this._disposeMotionTemplate(template)
    }
    this._motionTemplates.clear()
  }
}
