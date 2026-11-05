import * as THREE from 'three'

import Experience from '../experience.js'
import { blocks } from '../world/terrain/blocks-config.js'

// 默认使用屏幕中心作为射线发射点（适配 PointerLock/FPS 交互）
const CENTER_SCREEN = new THREE.Vector2(0, 0)
const RAY_EPSILON = 1e-6

function buildMinecraftBlockString(blockName = '', properties = {}) {
  const normalizedBlockName = String(blockName || '')
    .trim()
    .replace(/^minecraft:/u, '')

  if (!normalizedBlockName) {
    return ''
  }

  const entries = Object.entries(properties || {})
    .filter(([key, value]) => key && value !== undefined && value !== null && String(value).trim())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

  if (!entries.length) {
    return `minecraft:${normalizedBlockName}`
  }

  const serialized = entries
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join(',')

  return `minecraft:${normalizedBlockName}[${serialized}]`
}

function parseMinecraftBlockString(blockString = '') {
  const normalized = String(blockString || '').trim()
  const propertyStart = normalized.indexOf('[')
  const rawName = propertyStart >= 0 ? normalized.slice(0, propertyStart) : normalized
  const name = rawName.replace(/^minecraft:/u, '')
  const properties = {}

  if (propertyStart >= 0 && normalized.endsWith(']')) {
    const propertyString = normalized.slice(propertyStart + 1, -1)
    for (const entry of propertyString.split(',')) {
      const separatorIndex = entry.indexOf('=')
      if (separatorIndex <= 0) {
        continue
      }
      const key = entry.slice(0, separatorIndex).trim()
      const value = entry.slice(separatorIndex + 1).trim()
      if (key && value) {
        properties[key] = value
      }
    }
  }

  return { name, properties }
}

function fullBlockBox(worldX, worldY, worldZ) {
  return {
    minX: worldX - 0.5,
    minY: worldY - 0.5,
    minZ: worldZ - 0.5,
    maxX: worldX + 0.5,
    maxY: worldY + 0.5,
    maxZ: worldZ + 0.5,
  }
}

function axisNormal(axis, direction) {
  const sign = direction >= 0 ? -1 : 1
  if (axis === 'x') {
    return new THREE.Vector3(sign, 0, 0)
  }
  if (axis === 'y') {
    return new THREE.Vector3(0, sign, 0)
  }
  return new THREE.Vector3(0, 0, sign)
}

/**
 * BlockRaycaster
 * - 原理图渲染层 / 红石动态方块：InstancedMesh 求交
 * - 运行时（WASM）原理图层：按 chunkManager 方块数据做体素步进
 * - 结果保存在 this.current，由 BlockSelectionHelper 等在 update 中轮询读取
 */
export default class BlockRaycaster {
  constructor(options = {}) {
    this.experience = new Experience()
    this.camera = this.experience.camera.instance
    this.iMouse = this.experience.iMouse
    this.debug = this.experience.debug

    this.chunkManager = options.chunkManager || this.experience.terrainDataManager

    this.params = {
      enabled: options.enabled ?? true,
      maxDistance: options.maxDistance ?? 8,
      // 默认使用屏幕中心；如果你后续要做“鼠标指哪打哪”，改为 useMouse=true 即可
      useMouse: options.useMouse ?? false,
    }

    this.raycaster = new THREE.Raycaster()
    this.raycaster.far = this.params.maxDistance

    // 缓存对象，避免每帧分配
    this._instanceMatrix = new THREE.Matrix4()
    this._worldMatrix = new THREE.Matrix4()
    this._worldPos = new THREE.Vector3()
    this._hitPoint = new THREE.Vector3()
    this._hitNormal = new THREE.Vector3()

    this._currentKey = null
    this.current = null

    // 用于调试面板监控
    this.debugInfo = {
      log: 'No hit',
    }

    if (this.debug.active) {
      this.debugInit()
    }
  }

  debugInit() {
    this.debugFolder = this.debug.ui.addFolder({
      title: 'Block Raycaster',
      expanded: false,
    })

    const settings = this.debugFolder.addFolder({ title: '设置', expanded: true })

    settings.addBinding(this.params, 'enabled', { label: '启用' }).on('change', () => {
      if (!this.params.enabled)
        this._clear()
    })

    settings.addBinding(this.params, 'useMouse', { label: '使用鼠标' })

    settings.addBinding(this.params, 'maxDistance', {
      label: '最大距离',
      min: 1,
      max: 30,
      step: 0.5,
    }).on('change', () => {
      this.raycaster.far = this.params.maxDistance
    })

    const monitor = this.debugFolder.addFolder({ title: '拾取监控 (Monitor)', expanded: true })

    monitor.addBinding(this.debugInfo, 'log', {
      label: '实时状态',
      readonly: true,
      multiline: true,
      rows: 6,
    })
  }

  /**
   * 每帧更新：做一次拾取并广播“hover 方块信息”
   */
  update() {
    if (!this.params.enabled || !this.chunkManager) {
      this._clear()
      return
    }

    const ndc = this.params.useMouse ? this.iMouse.normalizedMouse : CENTER_SCREEN
    this.raycaster.far = this.params.maxDistance
    this.camera?.updateMatrixWorld?.(true)
    this.raycaster.setFromCamera(ndc, this.camera)

    const { meshTargets, hasRuntimeSchematicTargets } = this._collectTargets()
    if (meshTargets.length === 0 && !hasRuntimeSchematicTargets) {
      this._clear()
      return
    }

    let meshInfo = null
    if (meshTargets.length) {
      const hits = this.raycaster.intersectObjects(meshTargets, true)
      for (const hit of hits) {
        if (!this._isSupportedHit(hit)) {
          continue
        }

        meshInfo = this._buildHitInfo(hit)
        if (meshInfo) {
          break
        }
      }
    }

    const runtimeInfo = hasRuntimeSchematicTargets
      ? this._raycastWasmSchematicLayer()
      : null
    const info = this._pickNearestHitInfo(meshInfo, runtimeInfo)

    if (!info) {
      this._clear()
      return
    }

    // 始终更新 current，确保 face/point 等信息是实时的（即使是同一个方块）
    this.current = info

    const key = `${info.chunkX},${info.chunkZ}:${info.local.x},${info.local.y},${info.local.z}`
    if (key !== this._currentKey) {
      this._currentKey = key

      // 更新调试监控
      if (this.debug.active) {
        this.debugInfo.log = `Block: ${info.blockName || 'unknown'} (ID: ${info.blockId})
Instance: ${info.instanceId}
Chunk: ${info.chunkX}, ${info.chunkZ}
World: ${info.worldBlock.x}, ${info.worldBlock.y}, ${info.worldBlock.z}
Local: ${info.local.x}, ${info.local.y}, ${info.local.z}
Dist: ${info.distance?.toFixed(2) || 'N/A'}`
      }
    }
  }

  /**
   * 收集当前可拾取的目标对象：原理图渲染层的 mesh + 红石回放的动态方块
   * - 运行时（WASM）原理图层不走 mesh 求交，改为按方块数据做体素步进
   */
  _collectTargets() {
    const meshTargets = []
    const playerPosition = this.experience.world?.player?.getPosition?.() || null
    const schematicTargets = this.experience.world?.minecraftSchematicRenderLayer?.getRaycastTargets?.(
      playerPosition,
      this.params.maxDistance,
    ) || []
    const dynamicTargets = this.experience.world?.redstoneReplayController?.getRaycastTargets?.() || []
    meshTargets.push(...dynamicTargets)
    let hasRuntimeSchematicTargets = false
    for (const target of schematicTargets) {
      if (target?.userData?.litemoraWasmSchematicLayer) {
        hasRuntimeSchematicTargets = true
        continue
      }
      meshTargets.push(target)
    }

    return {
      meshTargets,
      hasRuntimeSchematicTargets,
    }
  }

  /**
   * 从 intersect 结果构建“方块信息”
   * @param {THREE.Intersection} hit
   */
  _buildHitInfo(hit) {
    const mesh = hit.object
    if (
      mesh?.userData?.minecraftDynamicBlock
      || mesh?.userData?.minecraftDynamicBlockBatch
    ) {
      return this._buildDynamicMinecraftHitInfo(hit)
    }
    if (mesh?.userData?.litemoraWasmSchematicLayer) {
      return this._buildWasmSchematicHitInfo(hit)
    }

    if (!mesh?.isInstancedMesh) {
      return null
    }

    const instanceId = hit.instanceId
    if (instanceId === undefined || instanceId === null) {
      return null
    }

    if (mesh?.userData?.minecraftSchematicLayer && mesh?.userData?.instanceToWorldBlock) {
      return this._buildMinecraftSchematicHitInfo(hit)
    }

    return null
  }

  _raycastWasmSchematicLayer() {
    const renderLayer = this.experience.world?.minecraftSchematicRenderLayer
    if (!renderLayer?.isRuntimeRendererActive?.()) {
      return null
    }

    const maxDistance = Number(this.raycaster.far)
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
      return null
    }

    const ray = this.raycaster.ray
    const origin = ray.origin
    const direction = ray.direction

    let blockX = Math.floor(origin.x + 0.5)
    let blockY = Math.floor(origin.y + 0.5)
    let blockZ = Math.floor(origin.z + 0.5)
    if (!Number.isFinite(blockX) || !Number.isFinite(blockY) || !Number.isFinite(blockZ)) {
      return null
    }

    const stepX = direction.x > RAY_EPSILON ? 1 : direction.x < -RAY_EPSILON ? -1 : 0
    const stepY = direction.y > RAY_EPSILON ? 1 : direction.y < -RAY_EPSILON ? -1 : 0
    const stepZ = direction.z > RAY_EPSILON ? 1 : direction.z < -RAY_EPSILON ? -1 : 0

    let nextX = stepX
      ? (((stepX > 0 ? blockX + 0.5 : blockX - 0.5) - origin.x) / direction.x)
      : Number.POSITIVE_INFINITY
    let nextY = stepY
      ? (((stepY > 0 ? blockY + 0.5 : blockY - 0.5) - origin.y) / direction.y)
      : Number.POSITIVE_INFINITY
    let nextZ = stepZ
      ? (((stepZ > 0 ? blockZ + 0.5 : blockZ - 0.5) - origin.z) / direction.z)
      : Number.POSITIVE_INFINITY

    const deltaX = stepX ? Math.abs(1 / direction.x) : Number.POSITIVE_INFINITY
    const deltaY = stepY ? Math.abs(1 / direction.y) : Number.POSITIVE_INFINITY
    const deltaZ = stepZ ? Math.abs(1 / direction.z) : Number.POSITIVE_INFINITY

    let travelled = 0
    let iterations = 0
    const maxIterations = Math.ceil(maxDistance * 4) + 8

    while (travelled <= maxDistance + RAY_EPSILON && iterations < maxIterations) {
      const cellExitDistance = Math.min(nextX, nextY, nextZ, maxDistance)
      const hitInfo = this._raycastImportedBlockCell(blockX, blockY, blockZ, cellExitDistance)
      if (hitInfo) {
        return hitInfo
      }

      if (nextX <= nextY && nextX <= nextZ) {
        travelled = nextX
        nextX += deltaX
        blockX += stepX
      }
      else if (nextY <= nextZ) {
        travelled = nextY
        nextY += deltaY
        blockY += stepY
      }
      else {
        travelled = nextZ
        nextZ += deltaZ
        blockZ += stepZ
      }

      iterations++
    }

    return null
  }

  _raycastImportedBlockCell(worldBlockX, worldBlockY, worldBlockZ, cellExitDistance) {
    const block = this.chunkManager?.getBlockWorld?.(worldBlockX, worldBlockY, worldBlockZ) || null
    if (!block?.isImportedMinecraft) {
      return null
    }

    const boxes = this._getSelectionBoxesForImportedBlock(worldBlockX, worldBlockY, worldBlockZ, block)
    let closestHit = null
    for (const box of boxes) {
      const hit = this._intersectRayAabb(box)
      if (!hit || hit.distance > cellExitDistance + RAY_EPSILON) {
        continue
      }

      if (!closestHit || hit.distance < closestHit.distance) {
        closestHit = hit
      }
    }

    if (!closestHit) {
      return null
    }

    return this._buildSemanticMinecraftHitInfo({
      worldBlockX,
      worldBlockY,
      worldBlockZ,
      block,
      distance: closestHit.distance,
      point: closestHit.point,
      normal: closestHit.normal,
    })
  }

  _getSelectionBoxesForImportedBlock(worldX, worldY, worldZ, block = null) {
    if (Array.isArray(block?.collisionBoxes) && block.collisionBoxes.length) {
      return block.collisionBoxes.map(([minX, minY, minZ, maxX, maxY, maxZ]) => ({
        minX: worldX - 0.5 + Number(minX),
        minY: worldY - 0.5 + Number(minY),
        minZ: worldZ - 0.5 + Number(minZ),
        maxX: worldX - 0.5 + Number(maxX),
        maxY: worldY - 0.5 + Number(maxY),
        maxZ: worldZ - 0.5 + Number(maxZ),
      }))
    }

    return [fullBlockBox(worldX, worldY, worldZ)]
  }

  _intersectRayAabb(box) {
    const origin = this.raycaster.ray.origin
    const direction = this.raycaster.ray.direction
    let tMin = 0
    let tMax = this.raycaster.far
    let hitAxis = 'z'

    const axes = [
      ['x', box.minX, box.maxX],
      ['y', box.minY, box.maxY],
      ['z', box.minZ, box.maxZ],
    ]

    for (const [axis, minValue, maxValue] of axes) {
      const originValue = origin[axis]
      const directionValue = direction[axis]
      if (Math.abs(directionValue) < RAY_EPSILON) {
        if (originValue < minValue || originValue > maxValue) {
          return null
        }
        continue
      }

      const inverse = 1 / directionValue
      let near = (minValue - originValue) * inverse
      let far = (maxValue - originValue) * inverse
      if (near > far) {
        const swap = near
        near = far
        far = swap
      }

      if (near > tMin) {
        tMin = near
        hitAxis = axis
      }
      tMax = Math.min(tMax, far)

      if (tMin > tMax) {
        return null
      }
    }

    if (tMax < 0 || tMin > this.raycaster.far) {
      return null
    }

    const distance = Math.max(0, tMin)
    return {
      distance,
      point: this.raycaster.ray.at(distance, new THREE.Vector3()),
      normal: axisNormal(hitAxis, direction[hitAxis]),
    }
  }

  _buildSemanticMinecraftHitInfo({
    worldBlockX,
    worldBlockY,
    worldBlockZ,
    block,
    distance,
    point,
    normal,
  }) {
    const chunkWidth = this.chunkManager?.chunkWidth ?? 64
    const chunkX = Math.floor(worldBlockX / chunkWidth)
    const chunkZ = Math.floor(worldBlockZ / chunkWidth)
    const originX = chunkX * chunkWidth
    const originZ = chunkZ * chunkWidth
    const localX = Math.floor(worldBlockX - originX)
    const localZ = Math.floor(worldBlockZ - originZ)
    const blockName = block?.minecraftBlock?.name || 'minecraft:unknown'

    return {
      chunkX,
      chunkZ,
      origin: { x: originX, z: originZ },

      instanceId: null,
      blockId: block?.id ?? blocks.empty.id,
      blockName,

      local: { x: localX, y: worldBlockY, z: localZ },
      worldBlock: { x: worldBlockX, y: worldBlockY, z: worldBlockZ },
      worldPosition: new THREE.Vector3(worldBlockX, worldBlockY, worldBlockZ),

      renderScale: 1,
      heightScale: 1,

      point,
      face: { normal },
      distance,

      source: 'minecraft-schematic',
      minecraftBlock: block?.minecraftBlock || null,
      isImportedMinecraft: true,
      collisionBoxes: block?.collisionBoxes || null,
      blockString: buildMinecraftBlockString(blockName, block?.minecraftBlock?.properties || {}),
    }
  }

  _isSupportedHit(hit) {
    const mesh = hit?.object
    if (mesh?.userData?.minecraftDynamicBlock) {
      return true
    }
    if (mesh?.userData?.minecraftDynamicBlockBatch) {
      return hit.instanceId !== undefined && hit.instanceId !== null
    }
    if (mesh?.userData?.litemoraWasmSchematicLayer) {
      return true
    }

    return !!(
      mesh?.isInstancedMesh
      && hit.instanceId !== undefined
      && hit.instanceId !== null
    )
  }

  _pickNearestHitInfo(meshInfo = null, runtimeInfo = null) {
    if (!meshInfo) {
      return runtimeInfo
    }
    if (!runtimeInfo) {
      return meshInfo
    }

    const meshDistance = Number(meshInfo.distance)
    const runtimeDistance = Number(runtimeInfo.distance)
    if (!Number.isFinite(meshDistance)) {
      return runtimeInfo
    }
    if (!Number.isFinite(runtimeDistance)) {
      return meshInfo
    }

    return runtimeDistance < meshDistance
      ? runtimeInfo
      : meshInfo
  }

  _buildMinecraftSchematicHitInfo(hit) {
    const mesh = hit.object
    const instanceId = hit.instanceId
    const instanceMap = mesh?.userData?.instanceToWorldBlock
    const offset = instanceId * 3

    if (!instanceMap || offset < 0 || (offset + 2) >= instanceMap.length) {
      return null
    }

    const worldBlockX = Number(instanceMap[offset])
    const worldBlockY = Number(instanceMap[offset + 1])
    const worldBlockZ = Number(instanceMap[offset + 2])
    if (!Number.isFinite(worldBlockX) || !Number.isFinite(worldBlockY) || !Number.isFinite(worldBlockZ)) {
      return null
    }

    const chunkWidth = this.chunkManager?.chunkWidth ?? 64
    const chunkX = Math.floor(worldBlockX / chunkWidth)
    const chunkZ = Math.floor(worldBlockZ / chunkWidth)
    const originX = chunkX * chunkWidth
    const originZ = chunkZ * chunkWidth
    const localX = Math.floor(worldBlockX - originX)
    const localZ = Math.floor(worldBlockZ - originZ)

    mesh.getMatrixAt(instanceId, this._instanceMatrix)
    this._worldMatrix.multiplyMatrices(mesh.matrixWorld, this._instanceMatrix)
    this._worldPos.setFromMatrixPosition(this._worldMatrix)

    const block = this.chunkManager?.getBlockWorld?.(worldBlockX, worldBlockY, worldBlockZ) || null
    const blockId = block?.id ?? blocks.empty.id
    const blockName = block?.minecraftBlock?.name || mesh?.userData?.blockName || 'minecraft:unknown'

    return {
      chunkX,
      chunkZ,
      origin: { x: originX, z: originZ },

      instanceId,
      blockId,
      blockName,

      local: { x: localX, y: worldBlockY, z: localZ },
      worldBlock: { x: worldBlockX, y: worldBlockY, z: worldBlockZ },
      worldPosition: this._worldPos.clone(),

      renderScale: 1,
      heightScale: 1,

      point: hit.point?.clone?.() ?? null,
      face: hit.face ?? null,
      distance: hit.distance ?? null,

      source: block?.source || 'minecraft-schematic',
      minecraftBlock: block?.minecraftBlock || null,
      isImportedMinecraft: true,
      collisionBoxes: block?.collisionBoxes || null,
      blockString: String(mesh?.userData?.blockString || ''),
    }
  }

  _buildDynamicMinecraftHitInfo(hit) {
    const object = hit.object
    const metadata = object?.userData?.minecraftDynamicBlock
    const batchMetadata = object?.userData?.minecraftDynamicBlockBatch
    const instanceId = batchMetadata ? hit.instanceId : null
    const worldBlock = batchMetadata?.worldBlocks?.[instanceId] || metadata?.worldBlock
    const worldBlockX = Number(worldBlock?.x)
    const worldBlockY = Number(worldBlock?.y)
    const worldBlockZ = Number(worldBlock?.z)
    if (!Number.isFinite(worldBlockX) || !Number.isFinite(worldBlockY) || !Number.isFinite(worldBlockZ)) {
      return null
    }

    const blockString = String(
      batchMetadata?.blockStrings?.[instanceId]
      || batchMetadata?.blockString
      || metadata?.blockString
      || '',
    )
    const minecraftBlock = parseMinecraftBlockString(blockString)
    const chunkWidth = this.chunkManager?.chunkWidth ?? 64
    const chunkX = Math.floor(worldBlockX / chunkWidth)
    const chunkZ = Math.floor(worldBlockZ / chunkWidth)
    const originX = chunkX * chunkWidth
    const originZ = chunkZ * chunkWidth
    const localX = Math.floor(worldBlockX - originX)
    const localZ = Math.floor(worldBlockZ - originZ)
    let face = hit.face ?? null
    if (face?.normal) {
      this._hitNormal.copy(face.normal).transformDirection(object.matrixWorld).normalize()
      face = {
        ...face,
        normal: this._hitNormal.clone(),
      }
    }

    return {
      chunkX,
      chunkZ,
      origin: { x: originX, z: originZ },
      instanceId,
      blockId: blocks.empty.id,
      blockName: minecraftBlock.name,
      local: { x: localX, y: worldBlockY, z: localZ },
      worldBlock: { x: worldBlockX, y: worldBlockY, z: worldBlockZ },
      worldPosition: new THREE.Vector3(worldBlockX, worldBlockY, worldBlockZ),
      renderScale: 1,
      heightScale: 1,
      point: hit.point?.clone?.() ?? null,
      face,
      distance: hit.distance ?? null,
      source: 'minecraft-schematic',
      minecraftBlock,
      isImportedMinecraft: true,
      collisionBoxes: null,
      blockString,
    }
  }

  _buildWasmSchematicHitInfo(hit) {
    const mesh = hit.object
    const point = hit.point?.clone?.()
    if (!point) {
      return null
    }

    this._hitPoint.copy(point)
    let face = hit.face ?? null
    if (face?.normal) {
      this._hitNormal.copy(face.normal).transformDirection(mesh.matrixWorld).normalize()
      this._hitPoint.addScaledVector(this._hitNormal, -0.01)
      face = {
        ...face,
        normal: this._hitNormal.clone(),
      }
    }
    else {
      this._hitPoint.addScaledVector(this.raycaster.ray.direction, 0.01)
    }

    const worldBlockX = Math.round(this._hitPoint.x)
    const worldBlockY = Math.round(this._hitPoint.y)
    const worldBlockZ = Math.round(this._hitPoint.z)
    if (!Number.isFinite(worldBlockX) || !Number.isFinite(worldBlockY) || !Number.isFinite(worldBlockZ)) {
      return null
    }

    const block = this.chunkManager?.getBlockWorld?.(worldBlockX, worldBlockY, worldBlockZ) || null
    if (!block?.isImportedMinecraft) {
      return null
    }

    const chunkWidth = this.chunkManager?.chunkWidth ?? 64
    const chunkX = Math.floor(worldBlockX / chunkWidth)
    const chunkZ = Math.floor(worldBlockZ / chunkWidth)
    const originX = chunkX * chunkWidth
    const originZ = chunkZ * chunkWidth
    const localX = Math.floor(worldBlockX - originX)
    const localZ = Math.floor(worldBlockZ - originZ)
    const blockName = block?.minecraftBlock?.name || 'minecraft:unknown'

    return {
      chunkX,
      chunkZ,
      origin: { x: originX, z: originZ },

      instanceId: null,
      blockId: block?.id ?? blocks.empty.id,
      blockName,

      local: { x: localX, y: worldBlockY, z: localZ },
      worldBlock: { x: worldBlockX, y: worldBlockY, z: worldBlockZ },
      worldPosition: new THREE.Vector3(worldBlockX, worldBlockY, worldBlockZ),

      renderScale: 1,
      heightScale: 1,

      point,
      face,
      distance: hit.distance ?? null,

      source: 'minecraft-schematic',
      minecraftBlock: block?.minecraftBlock || null,
      isImportedMinecraft: true,
      collisionBoxes: block?.collisionBoxes || null,
      blockString: buildMinecraftBlockString(blockName, block?.minecraftBlock?.properties || {}),
    }
  }

  _clear() {
    if (this._currentKey !== null) {
      this._currentKey = null
      this.current = null

      if (this.debug.active) {
        this.debugInfo.log = 'No hit'
      }
    }
  }

  destroy() {
    this._clear()
    this.chunkManager = null
  }
}
