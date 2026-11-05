import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import emitter from '../utils/event/event-bus.js'
import {
  AIR_BLOCK_STRING,
  blockKey,
  MOTION_CAUSE_MOVING_BLOCK,
  packRedstoneReplay,
  PISTON_MOTION_DURATION_TICKS,
} from './redstone-replay-data.js'
import { loadRedstoneReplayTimeline } from './redstone-replay-loader.js'

const DEFAULT_SPEED = 1
const INITIAL_INSTANCE_CAPACITY = 16

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeOffset(offset = {}) {
  return {
    x: Math.floor(Number(offset.x || 0)),
    y: Math.floor(Number(offset.y || 0)),
    z: Math.floor(Number(offset.z || 0)),
  }
}

export function resolveRedstoneReplayUrl(item = null, backendConfig = null) {
  return String(
    item?.redstoneReplayUrl
    || backendConfig?.settings?.redstoneArchive?.replayUrl
    || '',
  ).trim()
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
      // 回放方块几何很小（整层十万三角形以内），交给 GPU 全画比每帧在 CPU 上逐个实例
      // 做视锥剔除便宜得多：大场景里有上万个实例，逐个剔除每帧要几毫秒。
      // 关掉后 BatchedMesh 只在可见性变化时才重建绘制列表。
      mesh.perObjectFrustumCulled = false
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
    // 预处理后的时间线（见 redstone-replay-data.js 的 packRedstoneReplay）
    this._timeline = null
    this._motionCount = 0
    this._maxConcurrentMotions = 0
    this._maxActiveBlockCount = 0
    this._motionTemplates = new Map()
    this._activeMotions = new Map()
    this._blockModelRegistry = null
    this._motionLayer = null
    // posIndex -> 坐标键 "x,y,z"；坐标键 -> posIndex
    this._posKeys = []
    this._posIndexByKey = new Map()
    this._dynamicLayer = null
    // 当前模拟状态：每个坐标最近一次的方块状态和触发的活塞运动，-1 表示没有
    this._simState = null
    this._simMotion = null
    this._simStateCount = 0
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
      const timeline = await this._resolveReplayTimeline()
      if (!timeline) {
        return false
      }

      this._timeline = timeline
      this.replay = { ...timeline.meta, palette: timeline.palette }
      this.offset = normalizeOffset(this.world._getProjectionPlacementOffset?.())
      this._motionCount = timeline.motionCount
      this._maxConcurrentMotions = timeline.maxConcurrentMotions
      this._maxActiveBlockCount = timeline.maxActiveBlockCount

      const { posX, posY, posZ } = timeline
      this._posKeys = Array.from({ length: timeline.positionCount })
      this._posIndexByKey = new Map()
      for (let index = 0; index < timeline.positionCount; index += 1) {
        const key = blockKey(posX[index], posY[index], posZ[index])
        this._posKeys[index] = key
        this._posIndexByKey.set(key, index)
      }
      this._simState = new Int32Array(timeline.positionCount)
      this._simMotion = new Int32Array(timeline.positionCount)
      this._resetSimulationStates()

      const actionTargetPositions = new Map()
      const { actionTargets } = timeline
      for (let offset = 0; offset < actionTargets.length; offset += 3) {
        const worldBlock = {
          x: actionTargets[offset] + this.offset.x,
          y: actionTargets[offset + 1] + this.offset.y,
          z: actionTargets[offset + 2] + this.offset.z,
        }
        actionTargetPositions.set(
          blockKey(worldBlock.x, worldBlock.y, worldBlock.z),
          worldBlock,
        )
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

  async _resolveReplayTimeline() {
    const item = this.world.activeProjectionContext?.item || null
    const embeddedReplay = item?.redstoneReplay
    if (embeddedReplay && typeof embeddedReplay === 'object') {
      return packRedstoneReplay(embeddedReplay)
    }

    const replayUrl = resolveRedstoneReplayUrl(item, this.world.backendConfig)
    if (!replayUrl) {
      return null
    }

    const prefetched = this.world.takePrefetchedRedstoneReplay?.(replayUrl)
    if (prefetched) {
      return prefetched
    }

    return loadRedstoneReplayTimeline(replayUrl)
  }

  _resetSimulationStates() {
    const { baselinePos, baselineState } = this._timeline
    this._simState.fill(-1)
    this._simMotion.fill(-1)
    this._simStateCount = 0
    for (let index = 0; index < baselinePos.length; index += 1) {
      this._writeSimulationState(baselinePos[index], baselineState[index], -1)
    }
  }

  _writeSimulationState(posIndex, state, motionIndex) {
    if (this._simState[posIndex] < 0) {
      this._simStateCount += 1
    }
    this._simState[posIndex] = state
    this._simMotion[posIndex] = motionIndex
  }

  /** 坐标当前应显示的方块：活塞运动结束后的稳定状态优先，没有则用记录的状态 */
  _getSettledBlockString(posIndex) {
    const motionIndex = this._simMotion[posIndex]
    if (motionIndex >= 0) {
      const settled = this._timeline.strings[this._timeline.motionSettled[motionIndex]]
      if (settled) {
        return settled
      }
    }
    return this.replay.palette[this._simState[posIndex]]
  }

  _createMotion(motionIndex) {
    const timeline = this._timeline
    const posIndex = timeline.motionPos[motionIndex]
    const string = index => (index >= 0 ? timeline.strings[index] : '')
    return {
      key: this._posKeys[posIndex],
      posIndex,
      cause: string(timeline.motionCause[motionIndex]),
      isRetraction: timeline.motionRetraction[motionIndex] === 1,
      startTick: timeline.motionStartTick[motionIndex],
      destination: {
        x: timeline.posX[posIndex],
        y: timeline.posY[posIndex],
        z: timeline.posZ[posIndex],
      },
      start: {
        x: timeline.motionStartX[motionIndex],
        y: timeline.motionStartY[motionIndex],
        z: timeline.motionStartZ[motionIndex],
      },
      settledBlockString: string(timeline.motionSettled[motionIndex]),
      visualBlockString: string(timeline.motionVisual[motionIndex]),
      shortVisualBlockString: string(timeline.motionShortVisual[motionIndex]),
      baseBlockString: string(timeline.motionBase[motionIndex]),
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
    // worker 已经按出现顺序收集好：baseline/changes 里的方块，再加活塞运动用到的方块
    const pendingBlockStrings = this._timeline.templateBlockStrings
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

    // 动态方块层先离场填好、在后台编译着色器，再和"静态区块清空"同时生效。
    // 以前它直接挂在场景里，第一帧绘制时同步编译，主线程卡 ~175 ms。
    this.scene.remove(this._dynamicGroup)
    for (let posIndex = 0; posIndex < this._posKeys.length; posIndex += 1) {
      const state = this._simState[posIndex]
      this._setDynamicBlock(posIndex, state >= 0 ? this.replay.palette[state] : AIR_BLOCK_STRING)
    }
    // 交互碰撞体也要在预编译之前建好，否则它的着色器会在第一帧同步编译
    this._prepareActionTargetCollider()
    // 同时把场景里已加载的区块材质也编译掉：玩家传送到出生点那一帧通常就是它们第一次被画
    await Promise.all([
      this._precompileObject(this._dynamicGroup),
      this._precompileObject(this.scene),
    ])
    if (this._destroyed) {
      return
    }

    const clearPatches = this._posKeys
      .map((_key, posIndex) => this._buildWorldPatch(posIndex, AIR_BLOCK_STRING))
    const cleared = await renderLayer.setRuntimeBlocksAtWorldAsync(clearPatches)
    if (!cleared) {
      throw new Error('无法建立独立活塞渲染层')
    }
    this.scene.add(this._dynamicGroup)

    await this._prewarmMotionLayer()
  }

  async _precompileObject(object) {
    const renderer = this.experience.renderer
    if (!renderer?.compileAsync) {
      return
    }
    try {
      await renderer.compileAsync(object, this.scene)
    }
    catch (error) {
      console.warn('[RedstoneReplay] Shader precompile failed:', error)
    }
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
      if (!renderer?.compileAsync || !renderer?.renderFrame || !camera) {
        throw new Error('活塞运动合批无法预热显卡资源')
      }
      await renderer.compileAsync(this._motionGroup, this.scene)
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
      const posIndex = this._posIndexByKey.get(replayKey)
      const state = posIndex === undefined ? -1 : this._simState[posIndex]
      this._interactionBlockStrings[index] = state >= 0
        ? this.replay.palette[state]
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

    const timeline = this._timeline
    let nextFrameIndex = 0
    while (
      nextFrameIndex < timeline.frameCount
      && timeline.frameTicks[nextFrameIndex] <= nextTick
    ) {
      const end = timeline.frameChangeStart[nextFrameIndex + 1]
      for (let change = timeline.frameChangeStart[nextFrameIndex]; change < end; change += 1) {
        this._writeSimulationState(
          timeline.changePos[change],
          timeline.changeState[change],
          timeline.changeMotion[change],
        )
      }
      nextFrameIndex += 1
    }

    // 模拟状态里的坐标全部属于独立渲染层，静态区块里早已清空，不需要再打补丁
    this._clearDynamicBlocks()
    for (let posIndex = 0; posIndex < this._posKeys.length; posIndex += 1) {
      if (this._simState[posIndex] >= 0) {
        this._setDynamicBlock(posIndex, this._getSettledBlockString(posIndex))
      }
    }
    this.currentTick = nextTick
    this.currentFrameIndex = nextFrameIndex
    this.tickAccumulator = 0
    this.lastChangedBlocks = this._simStateCount
    this._emitState()
  }

  _buildWorldPatch(posIndex, blockString) {
    const timeline = this._timeline
    return {
      worldX: Math.floor(timeline.posX[posIndex]) + this.offset.x,
      worldY: Math.floor(timeline.posY[posIndex]) + this.offset.y,
      worldZ: Math.floor(timeline.posZ[posIndex]) + this.offset.z,
      blockString,
    }
  }

  _advanceToTick(targetTick) {
    const changedPositions = new Set()
    const timeline = this._timeline
    while (
      this.currentFrameIndex < timeline.frameCount
      && timeline.frameTicks[this.currentFrameIndex] <= targetTick
    ) {
      this._updatePistonMotions(timeline.frameTicks[this.currentFrameIndex])
      const end = timeline.frameChangeStart[this.currentFrameIndex + 1]
      for (let change = timeline.frameChangeStart[this.currentFrameIndex]; change < end; change += 1) {
        const posIndex = timeline.changePos[change]
        const state = timeline.changeState[change]
        const motionIndex = timeline.changeMotion[change]
        const key = this._posKeys[posIndex]
        this._writeSimulationState(posIndex, state, motionIndex)
        changedPositions.add(posIndex)

        if (motionIndex >= 0) {
          const motion = this._createMotion(motionIndex)
          this._activateMotion(motion)
          this._setDynamicBlock(posIndex, motion.baseBlockString)
        }
        else if (!this._activeMotions.has(key)) {
          this._setDynamicBlock(posIndex, this.replay.palette[state])
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

  _setDynamicBlock(posIndex, blockString) {
    const key = this._posKeys[posIndex]
    if (key === undefined) {
      throw new Error(`独立方块渲染缺少坐标: ${posIndex}`)
    }
    if (!this._dynamicLayer) {
      throw new Error('独立方块渲染层尚未准备完成')
    }
    const timeline = this._timeline
    const normalizedBlockString = String(blockString || AIR_BLOCK_STRING)
    this._dynamicLayer.set(key, normalizedBlockString, {
      x: this.offset.x + timeline.posX[posIndex],
      y: this.offset.y + timeline.posY[posIndex],
      z: this.offset.z + timeline.posZ[posIndex],
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
    if (motion.cause === MOTION_CAUSE_MOVING_BLOCK) {
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
    if (this._simState[motion.posIndex] < 0) {
      throw new Error(`活塞运动结束时缺少方块状态: ${motion.key}`)
    }

    this._setDynamicBlock(motion.posIndex, this._getSettledBlockString(motion.posIndex))
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
      dynamicPositions: this._posKeys.length,
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
