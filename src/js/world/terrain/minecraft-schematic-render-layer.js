import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import Experience from '../../experience.js'
import {
  BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
  loadBundledMinecraftResourcePackBlob,
  loadPreferredMinecraftResourcePack,
} from './minecraft-resource-pack.js'
import { buildSchematicLighting } from './minecraft-schematic-lighting.js'
import SchematicRendererRuntimeBridge from './schematic-renderer-runtime-bridge.js'

const BUILD_BATCH_SIZE = 12
const INSTANCE_UPLOAD_BATCH_SIZE = 4096
const STATE_PARTITION_MIN_INSTANCES = 192
const STATE_PARTITION_CHUNK_SPAN = 2
const PREVIEW_GAMMA = 0.5
const PREVIEW_GAMMA_EXPONENT = 1 / PREVIEW_GAMMA
const VISIBILITY_UPDATE_INTERVAL_MS = 80

function createEmptyBounds() {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
}

function expandBounds(bounds, x, y, z) {
  bounds.minX = Math.min(bounds.minX, x - 0.5)
  bounds.minY = Math.min(bounds.minY, y - 0.5)
  bounds.minZ = Math.min(bounds.minZ, z - 0.5)
  bounds.maxX = Math.max(bounds.maxX, x + 0.5)
  bounds.maxY = Math.max(bounds.maxY, y + 0.5)
  bounds.maxZ = Math.max(bounds.maxZ, z + 0.5)
}

function createPreviewSyncedMaterial(material) {
  if (Array.isArray(material)) {
    return material.map(entry => createPreviewSyncedMaterial(entry))
  }

  if (!material?.isMaterial) {
    return material
  }

  const synced = new THREE.MeshBasicMaterial({
    name: material.name ? `${material.name}-preview-synced` : 'minecraft-preview-synced',
    color: material.color?.clone?.() || new THREE.Color(0xFFFFFF),
    map: material.map || null,
    alphaMap: material.alphaMap || null,
    transparent: material.transparent,
    opacity: material.opacity,
    side: material.side,
    alphaTest: material.alphaTest,
    blending: material.blending,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    vertexColors: material.vertexColors,
    fog: false,
  })

  synced.toneMapped = false
  synced.premultipliedAlpha = material.premultipliedAlpha
  synced.dithering = material.dithering
  synced.visible = material.visible
  synced.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(${PREVIEW_GAMMA_EXPONENT.toFixed(1)}));\n#include <dithering_fragment>`,
    )
  }
  synced.customProgramCacheKey = () => `preview-synced-gamma-${PREVIEW_GAMMA_EXPONENT}`

  return synced
}

function buildBlockString(blockName = '', properties = {}) {
  const normalizedName = String(blockName || '').trim()
  const entries = Object.entries(properties || {})
    .filter(([key, value]) => key && value !== undefined && value !== null && String(value).trim())
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))

  if (!entries.length) {
    return `minecraft:${normalizedName}`
  }

  const serialized = entries
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join(',')

  return `minecraft:${normalizedName}[${serialized}]`
}

export default class MinecraftSchematicRenderLayer {
  constructor(options = {}) {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.chunkManager = options.chunkManager || this.experience.terrainDataManager || null
    this.group = new THREE.Group()
    this.group.name = 'minecraft-schematic-render-layer'
    this.scene.add(this.group)

    this._cubane = null
    this._cubanePromise = null
    this._meshEntries = []
    this._meshGroups = new Map()
    this._groupKeysByBlockString = new Map()
    this._overlayGeometryCache = new Map()
    this._rebuildToken = 0
    this._disposed = false
    this._lastBuildProfile = null
    this._lastVisibilityStats = null
    this._lastVisibilityUpdateAt = 0
    this._resourcePackStatus = {
      attempted: false,
      loaded: false,
      source: 'none',
    }
    this._resourcePackSignature = ''
    this._runtimeBridge = new SchematicRendererRuntimeBridge({ hostGroup: this.group })
    this._runtimeSource = null
    this._runtimeActive = false

    this._tempTranslation = new THREE.Matrix4()
    this._tempMatrix = new THREE.Matrix4()
    this._tempColor = new THREE.Color(1, 1, 1)
    this._frustum = new THREE.Frustum()
    this._frustumProjectionMatrix = new THREE.Matrix4()
    this._frustumBox = new THREE.Box3()
  }

  async ensureCubane() {
    if (this._cubanePromise) {
      const cubane = await this._cubanePromise
      await this._syncCubaneResourcePack(cubane)
      return cubane
    }

    this._cubanePromise = (async () => {
      const { Cubane } = await import('cubane')
      const cubane = new Cubane({ autoRestore: false })
      this._cubane = cubane
      await this._syncCubaneResourcePack(cubane)
      return cubane
    })().catch((error) => {
      this._cubanePromise = null
      throw error
    })

    return this._cubanePromise
  }

  async _loadPackIntoCubane(cubane, packRecord) {
    await cubane.removeAllPacks?.()
    await cubane.loadPackFromBlob(packRecord.blob, packRecord.name)
    await cubane.buildTextureAtlas()
  }

  async _syncCubaneResourcePack(cubane) {
    if (!cubane) {
      return
    }

    const preferredPack = await loadPreferredMinecraftResourcePack()
    const preferredSignature = [
      preferredPack.source,
      preferredPack.key,
      preferredPack.updatedAt,
      preferredPack.size,
    ].join(':')

    if (preferredSignature === this._resourcePackSignature && this._resourcePackStatus.loaded) {
      return
    }

    try {
      await this._loadPackIntoCubane(cubane, preferredPack)
      this._resourcePackSignature = preferredSignature
      this._resourcePackStatus = {
        attempted: true,
        loaded: true,
        source: preferredPack.source,
        name: preferredPack.name,
      }
    }
    catch (error) {
      if (preferredPack.source === 'custom') {
        console.warn('[MinecraftSchematicRenderLayer] Failed to load custom resource pack, falling back to bundled pack:', error)
        const fallbackBlob = await loadBundledMinecraftResourcePackBlob()
        await this._loadPackIntoCubane(cubane, {
          blob: fallbackBlob,
          name: BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
        })
        this._resourcePackSignature = ['built-in', BUNDLED_MINECRAFT_RESOURCE_PACK_NAME, 0, fallbackBlob.size].join(':')
        this._resourcePackStatus = {
          attempted: true,
          loaded: true,
          source: 'built-in-fallback',
          name: BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
        }
        return
      }

      console.warn('[MinecraftSchematicRenderLayer] Failed to load bundled resource pack:', error)
      this._resourcePackStatus = {
        attempted: true,
        loaded: false,
        source: 'none',
        name: '',
      }
      throw error
    }
  }

  /**
   * 提前初始化 schematic-renderer（WASM + 离屏 WebGL）并装载资源包，
   * 让它和场景数据的下载并行；之后 loadSource 会直接复用。
   */
  prewarmRuntime() {
    return this._runtimeBridge.ensurePreferredResourcePack()
  }

  invalidateResourcePack() {
    this._resourcePackSignature = ''
    this._resourcePackStatus = {
      attempted: false,
      loaded: false,
      source: 'none',
      name: '',
    }
    this._runtimeBridge?.invalidateResourcePack?.()
  }

  getStats() {
    return {
      renderMode: this.isRuntimeRendererActive() ? 'schematic-renderer-wasm' : 'cubane-instanced',
      meshCount: this._meshEntries.length,
      childCount: this.group.children.length,
      lastBuildProfile: this._lastBuildProfile ? { ...this._lastBuildProfile } : null,
      lastVisibilityStats: this._lastVisibilityStats ? { ...this._lastVisibilityStats } : null,
      resourcePackStatus: { ...this._resourcePackStatus },
      runtime: this._runtimeBridge?.getStats?.() || null,
    }
  }

  getOverlayGeometryForBlockString(blockString) {
    return this._overlayGeometryCache.get(blockString) || null
  }

  async createBlockPreviewObject(blockString) {
    const normalizedBlockString = String(blockString || '').trim()
    if (!normalizedBlockString || normalizedBlockString === 'minecraft:air') {
      return null
    }

    const cubane = await this.ensureCubane()
    const prototype = await cubane.getBlockMesh(normalizedBlockString, 'plains', true)
    if (!prototype) {
      throw new Error(`Unable to build Minecraft block preview: ${normalizedBlockString}`)
    }

    const descriptors = this._extractMeshDescriptors(prototype)
    if (!descriptors.length) {
      throw new Error(`Minecraft block preview has no renderable geometry: ${normalizedBlockString}`)
    }

    const group = new THREE.Group()
    group.name = `minecraft-block-preview:${normalizedBlockString}`
    group.userData.minecraftBlockPreview = true
    group.userData.blockString = normalizedBlockString

    for (const descriptor of descriptors) {
      const mesh = new THREE.Mesh(
        descriptor.geometry,
        createPreviewSyncedMaterial(descriptor.material),
      )
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(descriptor.relativeMatrix)
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      group.add(mesh)
    }

    return group
  }

  async rebuildFromLayer(layer, options = {}) {
    if ('runtimeSource' in options) {
      this.setRuntimeSource(options.runtimeSource)
    }

    if (this._runtimeSource?.buffer instanceof ArrayBuffer) {
      return this._syncRuntimeRendererFromSource(layer, options)
    }

    this._runtimeBridge.detachRuntimeGroup()
    this._runtimeActive = false
    return this._syncRenderGroupsFromLayer(layer, null, options)
  }

  setRuntimeSource(source = null) {
    const buffer = source?.buffer
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 0) {
      this._runtimeSource = null
      this._runtimeBridge.detachRuntimeGroup()
      this._runtimeActive = false
      this.chunkManager?.setMinecraftRuntimeBlockProvider?.(null)
      return false
    }

    const offset = source.offset || {}
    this._runtimeSource = {
      id: String(source.id || source.name || 'runtime-schematic'),
      name: String(source.name || source.id || 'runtime-schematic'),
      buffer,
      offset: {
        x: Math.floor(Number(offset.x || 0)),
        y: Math.floor(Number(offset.y || 0)),
        z: Math.floor(Number(offset.z || 0)),
      },
      blockCount: Math.max(0, Math.round(Number(source.blockCount || 0))),
    }
    return true
  }

  isRuntimeRendererActive() {
    return this._runtimeActive && !!this._runtimeBridge
  }

  setRuntimeBlockAtWorld(worldX, worldY, worldZ, blockString = 'minecraft:air') {
    return this.setRuntimeBlocksAtWorld([{
      worldX,
      worldY,
      worldZ,
      blockString,
    }])
  }

  setRuntimeBlocksAtWorld(worldBlocks = []) {
    if (!this._runtimeBridge?.schematicObject) {
      return false
    }

    const patched = this._runtimeBridge.setBlocksAtWorld(worldBlocks)
    if (patched) {
      this._lastBuildProfile = {
        ...(this._lastBuildProfile || {}),
        lastPatch: {
          mode: 'schematic-renderer-wasm',
          worldBlocks: (Array.isArray(worldBlocks) ? worldBlocks : []).map(worldBlock => ({
            x: Math.floor(Number(worldBlock?.worldX ?? worldBlock?.x ?? 0)),
            y: Math.floor(Number(worldBlock?.worldY ?? worldBlock?.y ?? 0)),
            z: Math.floor(Number(worldBlock?.worldZ ?? worldBlock?.z ?? 0)),
            blockString: String(worldBlock?.blockString || 'minecraft:air'),
          })),
        },
      }
    }
    return patched
  }

  async setRuntimeBlocksAtWorldAsync(worldBlocks = []) {
    if (!this._runtimeBridge?.schematicObject) {
      return false
    }

    const patched = await this._runtimeBridge.setBlocksAtWorldAsync(worldBlocks)
    if (patched) {
      this._lastBuildProfile = {
        ...(this._lastBuildProfile || {}),
        lastPatch: {
          mode: 'schematic-renderer-wasm',
          worldBlocks: (Array.isArray(worldBlocks) ? worldBlocks : []).map(worldBlock => ({
            x: Math.floor(Number(worldBlock?.worldX ?? worldBlock?.x ?? 0)),
            y: Math.floor(Number(worldBlock?.worldY ?? worldBlock?.y ?? 0)),
            z: Math.floor(Number(worldBlock?.worldZ ?? worldBlock?.z ?? 0)),
            blockString: String(worldBlock?.blockString || 'minecraft:air'),
          })),
        },
      }
    }
    return patched
  }

  async syncBlockStatesFromLayer(layer, blockStrings = [], options = {}) {
    const normalizedBlockStrings = [...new Set(
      (Array.isArray(blockStrings) ? blockStrings : [])
        .map(blockString => String(blockString || '').trim())
        .filter(Boolean),
    )]

    if (!normalizedBlockStrings.length) {
      return {
        uniqueBlockStates: 0,
        builtMeshes: 0,
        resourcePackStatus: { ...this._resourcePackStatus },
      }
    }

    if (this.isRuntimeRendererActive()) {
      const runtimeStats = this._runtimeBridge.getStats()
      return {
        uniqueBlockStates: normalizedBlockStrings.length,
        builtMeshes: runtimeStats.meshCount,
        profile: this._lastBuildProfile,
        resourcePackStatus: { ...this._resourcePackStatus },
        runtime: runtimeStats,
        runtimePatchRequired: true,
      }
    }

    return this._syncRenderGroupsFromLayer(layer, normalizedBlockStrings, options)
  }

  async _syncRuntimeRendererFromSource(layer, options = {}) {
    const source = this._runtimeSource
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const rebuildToken = ++this._rebuildToken
    const buildStart = performance.now()
    const blockCount = Math.max(
      Number(layer?.getStats?.()?.blockCount || 0),
      Number(source?.blockCount || 0),
    )

    this.clear()

    let runtimeStats
    try {
      runtimeStats = await this._runtimeBridge.loadSource(source, {
        playerPosition: this.experience.world?.player?.getPosition?.() || null,
        streaming: {
          horizontalLoadRadius: Math.max(
            2,
            Math.ceil(((this.chunkManager?.viewDistance ?? 1) * (this.chunkManager?.chunkWidth ?? 64)) / 16),
          ),
          verticalLoadRadius: Math.max(
            1,
            Math.ceil((this.chunkManager?.chunkHeight ?? 32) / 16),
          ),
          unloadPadding: 1,
          maxConcurrentBuilds: 2,
        },
        onRuntimeReady: (readyStats) => {
          if (this._disposed || rebuildToken !== this._rebuildToken) {
            return
          }
          this._runtimeActive = true
          this._meshEntries = this._runtimeBridge.getMeshes()
          this.chunkManager?.setMinecraftRuntimeBlockProvider?.(this._runtimeBridge)
          this._resourcePackStatus = readyStats.resourcePackStatus || this._resourcePackStatus
        },
        onProgress: (progress) => {
          onProgress?.({
            ...progress,
            mode: 'schematic-renderer-wasm',
            runtime: true,
          })
        },
        resourcePackSignature: this._resourcePackSignature,
      })
    }
    catch (error) {
      if (rebuildToken === this._rebuildToken) {
        this._runtimeActive = false
        this.chunkManager?.setMinecraftRuntimeBlockProvider?.(null)
      }
      throw error
    }

    if (this._disposed || rebuildToken !== this._rebuildToken) {
      this._runtimeBridge.detachRuntimeGroup()
      this.chunkManager?.setMinecraftRuntimeBlockProvider?.(null)
      return {
        cancelled: true,
        uniqueBlockStates: 0,
        builtMeshes: runtimeStats.meshCount,
      }
    }

    this._runtimeActive = true
    this._meshEntries = this._runtimeBridge.getMeshes()
    this.chunkManager?.setMinecraftRuntimeBlockProvider?.(this._runtimeBridge)
    this._resourcePackStatus = runtimeStats.resourcePackStatus || {
      attempted: true,
      loaded: true,
      source: 'schematic-renderer',
      name: '',
    }

    const elapsedMs = performance.now() - buildStart
    this._lastBuildProfile = {
      mode: 'schematic-renderer-wasm',
      blockCount,
      builtMeshes: runtimeStats.meshCount,
      meshCount: runtimeStats.meshCount,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      dimensions: runtimeStats.dimensions,
      bounds: runtimeStats.bounds,
      sourceSignature: runtimeStats.sourceSignature,
    }

    console.debug('[MinecraftSchematicRenderLayer] Runtime build profile', this._lastBuildProfile)

    return {
      uniqueBlockStates: 0,
      builtMeshes: runtimeStats.meshCount,
      profile: this._lastBuildProfile,
      resourcePackStatus: { ...this._resourcePackStatus },
      runtime: runtimeStats,
    }
  }

  async _syncRenderGroupsFromLayer(layer, blockStrings = null, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    if (!Array.isArray(blockStrings)) {
      this._runtimeBridge.detachRuntimeGroup()
      this._runtimeActive = false
      this.chunkManager?.setMinecraftRuntimeBlockProvider?.(null)
    }

    const cubane = await this.ensureCubane()
    const rebuildToken = ++this._rebuildToken
    const buildStart = performance.now()
    const filteredBlockStates = Array.isArray(blockStrings) && blockStrings.length
      ? new Set(blockStrings)
      : null
    const progressiveRegistration = !filteredBlockStates && options.progressive !== false

    const stateGroups = this._groupBlocksByState(layer, filteredBlockStates)
    const { groupedBlocks, groupingStats } = this._buildRenderGroups(stateGroups)
    const lighting = buildSchematicLighting(layer)

    const blockCount = layer?.getStats?.()?.blockCount ?? 0
    const uniqueStateCount = stateGroups.size
    if (!filteredBlockStates) {
      this.clear()
      this._pruneOverlayGeometryCache(new Set(stateGroups.keys()))
    }

    const buildResult = await this._buildStagedRenderGroups(groupedBlocks, {
      cubane,
      lighting,
      onProgress,
      rebuildToken,
      onGroupBuilt: progressiveRegistration
        ? (groupRecord) => {
            if (this._disposed || rebuildToken !== this._rebuildToken) {
              this._disposeMeshes(groupRecord?.meshes || [])
              return false
            }

            this._registerRenderGroup(groupRecord, { appendMeshes: true })
            return true
          }
        : null,
    })
    if (buildResult.cancelled) {
      return {
        cancelled: true,
        uniqueBlockStates: uniqueStateCount,
        builtMeshes: buildResult.builtMeshes,
      }
    }

    if (this._disposed || rebuildToken !== this._rebuildToken) {
      this._disposeStagedRenderGroups(buildResult.stagedGroups)
      return {
        cancelled: true,
        uniqueBlockStates: uniqueStateCount,
        builtMeshes: buildResult.builtMeshes,
      }
    }

    if (filteredBlockStates) {
      for (const blockString of filteredBlockStates) {
        this._removeRenderGroupsForBlockString(blockString)
      }
    }

    for (const groupRecord of buildResult.stagedGroups.values()) {
      this._registerRenderGroup(groupRecord)
    }

    if (!progressiveRegistration) {
      this._rebuildMeshEntriesList()
    }

    const elapsedMs = performance.now() - buildStart
    const nextProfile = {
      blockCount,
      uniqueBlockStates: uniqueStateCount,
      renderGroups: groupedBlocks.size,
      grouping: groupingStats,
      builtMeshes: buildResult.builtMeshes,
      maxInstancesPerMesh: buildResult.maxInstancesPerMesh,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      lighting: lighting.stats,
    }
    this._lastBuildProfile = filteredBlockStates
      ? {
          ...(this._lastBuildProfile || {}),
          lastPatch: {
            ...nextProfile,
            affectedBlockStates: [...filteredBlockStates],
          },
        }
      : nextProfile

    console.debug('[MinecraftSchematicRenderLayer] Build profile', this._lastBuildProfile)

    return {
      uniqueBlockStates: uniqueStateCount,
      builtMeshes: buildResult.builtMeshes,
      profile: this._lastBuildProfile,
      resourcePackStatus: { ...this._resourcePackStatus },
    }
  }

  _buildStagedRenderGroups(groupedBlocks, options = {}) {
    const cubane = options.cubane
    const lighting = options.lighting
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const rebuildToken = options.rebuildToken
    const onGroupBuilt = typeof options.onGroupBuilt === 'function' ? options.onGroupBuilt : null

    return (async () => {
      const descriptorCache = new Map()
      const stagedGroups = new Map()
      let processedStates = 0
      let builtMeshes = 0
      let maxInstancesPerMesh = 0
      let hasProgressiveRegistrations = false

      for (const groupEntry of groupedBlocks.values()) {
        if (this._disposed || rebuildToken !== this._rebuildToken) {
          if (!hasProgressiveRegistrations) {
            this._disposeDescriptorCache(descriptorCache)
          }
          this._disposeStagedRenderGroups(stagedGroups)
          return {
            cancelled: true,
            stagedGroups: new Map(),
            builtMeshes,
            maxInstancesPerMesh,
          }
        }

        const { blockString, instances, bounds, groupKey } = groupEntry
        if (!descriptorCache.has(blockString)) {
          const prototype = await cubane.getBlockMesh(blockString, 'plains', true)
          if (!prototype) {
            descriptorCache.set(blockString, null)
          }
          else {
            const rawDescriptors = this._extractMeshDescriptors(prototype)
            const descriptors = rawDescriptors.map((descriptor, descriptorIndex) => ({
              descriptorIndex,
              relativeMatrix: descriptor.relativeMatrix,
              sharedGeometry: descriptor.geometry,
              sharedMaterial: createPreviewSyncedMaterial(descriptor.material),
            }))
            descriptorCache.set(blockString, descriptors.length ? descriptors : null)
            this._replaceOverlayGeometry(blockString, rawDescriptors)
          }
        }

        const descriptors = descriptorCache.get(blockString) || []
        if (!descriptors.length) {
          processedStates++
          continue
        }
        maxInstancesPerMesh = Math.max(maxInstancesPerMesh, instances.length)

        const meshes = []
        for (let descriptorIndex = 0; descriptorIndex < descriptors.length; descriptorIndex++) {
          const descriptor = descriptors[descriptorIndex]
          const instancedMesh = new THREE.InstancedMesh(
            descriptor.sharedGeometry,
            descriptor.sharedMaterial,
            instances.length,
          )
          instancedMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
          instancedMesh.castShadow = false
          instancedMesh.receiveShadow = false
          instancedMesh.name = `minecraft-instanced:${blockString}#${descriptor.descriptorIndex}`
          instancedMesh.userData.minecraftSchematicLayer = true
          instancedMesh.userData.blockString = blockString
          instancedMesh.userData.previewSyncedMaterial = true
          instancedMesh.userData.instanceToWorldBlock = new Int32Array(instances.length * 3)
          instancedMesh.userData.blockName = `minecraft:${instances[0]?.blockName || 'unknown'}`
          instancedMesh.userData.bounds = bounds

          for (let index = 0; index < instances.length; index++) {
            const instance = instances[index]
            const offset = index * 3
            instancedMesh.userData.instanceToWorldBlock[offset] = instance.x
            instancedMesh.userData.instanceToWorldBlock[offset + 1] = instance.y
            instancedMesh.userData.instanceToWorldBlock[offset + 2] = instance.z
            this._tempTranslation.makeTranslation(instance.x, instance.y, instance.z)
            this._tempMatrix.copy(this._tempTranslation).multiply(descriptor.relativeMatrix)
            instancedMesh.setMatrixAt(index, this._tempMatrix)
            const brightness = lighting?.brightnessByPosition?.get(`${instance.x},${instance.y},${instance.z}`) || 1
            this._tempColor.setScalar(brightness)
            instancedMesh.setColorAt(index, this._tempColor)

            if (index > 0 && index % INSTANCE_UPLOAD_BATCH_SIZE === 0) {
              instancedMesh.instanceMatrix.needsUpdate = true
              if (instancedMesh.instanceColor) {
                instancedMesh.instanceColor.needsUpdate = true
              }
              await this._yieldToMainThread()
            }
          }

          instancedMesh.instanceMatrix.needsUpdate = true
          if (instancedMesh.instanceColor) {
            instancedMesh.instanceColor.needsUpdate = true
          }
          instancedMesh.computeBoundingSphere?.()
          instancedMesh.computeBoundingBox?.()
          meshes.push(instancedMesh)
          builtMeshes++
        }

        const groupRecord = {
          groupKey,
          blockString,
          meshes,
        }
        if (onGroupBuilt) {
          const accepted = onGroupBuilt(groupRecord)
          if (accepted !== false) {
            hasProgressiveRegistrations = true
          }
        }
        else {
          stagedGroups.set(groupKey, groupRecord)
        }
        processedStates++

        if (onProgress) {
          onProgress({
            processedStates,
            totalStates: groupedBlocks.size,
            builtMeshes,
            progress: groupedBlocks.size > 0 ? processedStates / groupedBlocks.size : 1,
            resourcePackStatus: { ...this._resourcePackStatus },
          })
        }

        if (processedStates % BUILD_BATCH_SIZE === 0) {
          await this._yieldToMainThread()
        }
      }

      return {
        cancelled: false,
        stagedGroups,
        builtMeshes,
        maxInstancesPerMesh,
      }
    })()
  }

  _groupBlocksByState(layer, blockStateFilter = null) {
    const grouped = new Map()

    layer?.forEachBlock?.((position, entry) => {
      const blockString = buildBlockString(entry?.blockName, entry?.properties)
      if (!blockString) {
        return
      }

      if (blockStateFilter && !blockStateFilter.has(blockString)) {
        return
      }

      if (this.chunkManager?.isImportedMinecraftBlockTransientlyRemoved?.(
        position.worldX,
        position.worldY,
        position.worldZ,
      )) {
        return
      }

      if (!grouped.has(blockString)) {
        grouped.set(blockString, {
          blockString,
          instances: [],
          bounds: createEmptyBounds(),
        })
      }

      const bucket = grouped.get(blockString)
      bucket.instances.push({
        x: position.worldX,
        y: position.worldY,
        z: position.worldZ,
        blockName: entry?.blockName || '',
      })
      expandBounds(bucket.bounds, position.worldX, position.worldY, position.worldZ)
    })

    return grouped
  }

  _buildRenderGroups(stateGroups) {
    const grouped = new Map()
    const chunkWidth = Math.max(16, Number(this.chunkManager?.chunkWidth || 64))
    const partitionWorldSize = chunkWidth * STATE_PARTITION_CHUNK_SPAN
    let partitionedStateCount = 0

    for (const stateEntry of stateGroups.values()) {
      const spanX = stateEntry.bounds.maxX - stateEntry.bounds.minX
      const spanZ = stateEntry.bounds.maxZ - stateEntry.bounds.minZ
      const shouldPartition = stateEntry.instances.length >= STATE_PARTITION_MIN_INSTANCES
        && (spanX > partitionWorldSize || spanZ > partitionWorldSize)

      if (!shouldPartition) {
        grouped.set(`state:${stateEntry.blockString}`, {
          ...stateEntry,
          groupKey: `state:${stateEntry.blockString}`,
        })
        continue
      }

      partitionedStateCount += 1
      for (const instance of stateEntry.instances) {
        const partitionX = Math.floor(instance.x / partitionWorldSize)
        const partitionZ = Math.floor(instance.z / partitionWorldSize)
        const groupKey = `${stateEntry.blockString}::partition:${partitionX},${partitionZ}`

        if (!grouped.has(groupKey)) {
          grouped.set(groupKey, {
            blockString: stateEntry.blockString,
            instances: [],
            bounds: createEmptyBounds(),
            groupKey,
          })
        }

        const partitionBucket = grouped.get(groupKey)
        partitionBucket.instances.push(instance)
        expandBounds(partitionBucket.bounds, instance.x, instance.y, instance.z)
      }
    }

    return {
      groupedBlocks: new Map(
        [...grouped.entries()].sort((left, right) => right[1].instances.length - left[1].instances.length),
      ),
      groupingStats: {
        sourceStates: stateGroups.size,
        renderGroups: grouped.size,
        partitionedStateCount,
        mergedStateCount: stateGroups.size - partitionedStateCount,
        partitionWorldSize,
        partitionChunkSpan: STATE_PARTITION_CHUNK_SPAN,
        partitionMinInstances: STATE_PARTITION_MIN_INSTANCES,
      },
    }
  }

  getRaycastTargets(origin = null, maxDistance = Number.POSITIVE_INFINITY) {
    if (!this.group.visible) {
      return []
    }

    const candidates = this.isRuntimeRendererActive()
      ? this._runtimeBridge.getRaycastTargets()
      : this.group.children

    if (!origin || !Number.isFinite(maxDistance)) {
      return candidates.filter(mesh => mesh.visible !== false)
    }

    const maxDistanceSq = maxDistance * maxDistance
    return candidates.filter((mesh) => {
      if (mesh.visible === false) {
        return false
      }

      const bounds = mesh?.userData?.bounds
      if (!bounds) {
        return true
      }

      const dx = origin.x < bounds.minX
        ? bounds.minX - origin.x
        : origin.x > bounds.maxX
          ? origin.x - bounds.maxX
          : 0
      const dy = origin.y < bounds.minY
        ? bounds.minY - origin.y
        : origin.y > bounds.maxY
          ? origin.y - bounds.maxY
          : 0
      const dz = origin.z < bounds.minZ
        ? bounds.minZ - origin.z
        : origin.z > bounds.maxZ
          ? origin.z - bounds.maxZ
          : 0

      return ((dx * dx) + (dy * dy) + (dz * dz)) <= maxDistanceSq
    })
  }

  _extractMeshDescriptors(root) {
    root.updateMatrixWorld(true)
    const descriptors = []

    root.traverse((child) => {
      if (!child?.isMesh || !child.geometry || !child.material) {
        return
      }

      descriptors.push({
        geometry: child.geometry,
        material: child.material,
        relativeMatrix: child.matrixWorld.clone(),
      })
    })

    return descriptors
  }

  _buildOverlayGeometry(descriptors = []) {
    if (!Array.isArray(descriptors) || !descriptors.length) {
      return null
    }

    const geometries = descriptors.map((descriptor) => {
      const geometry = descriptor.geometry.clone()
      geometry.applyMatrix4(descriptor.relativeMatrix)
      return geometry
    })

    if (geometries.length === 1) {
      return geometries[0]
    }

    const merged = mergeGeometries(geometries, false)
    for (const geometry of geometries) {
      geometry.dispose?.()
    }

    return merged || null
  }

  _replaceOverlayGeometry(blockString, descriptors = []) {
    const previousGeometry = this._overlayGeometryCache.get(blockString)
    if (previousGeometry) {
      previousGeometry.dispose?.()
      this._overlayGeometryCache.delete(blockString)
    }

    const overlayGeometry = this._buildOverlayGeometry(descriptors)
    if (overlayGeometry) {
      this._overlayGeometryCache.set(blockString, overlayGeometry)
    }
  }

  _pruneOverlayGeometryCache(validBlockStrings = new Set()) {
    for (const [blockString, geometry] of this._overlayGeometryCache.entries()) {
      if (validBlockStrings.has(blockString)) {
        continue
      }

      geometry?.dispose?.()
      this._overlayGeometryCache.delete(blockString)
    }
  }

  _registerRenderGroup(groupRecord, options = {}) {
    const appendMeshes = options.appendMeshes === true
    this._meshGroups.set(groupRecord.groupKey, groupRecord)

    if (!this._groupKeysByBlockString.has(groupRecord.blockString)) {
      this._groupKeysByBlockString.set(groupRecord.blockString, new Set())
    }

    this._groupKeysByBlockString.get(groupRecord.blockString)?.add(groupRecord.groupKey)
    for (const mesh of groupRecord.meshes) {
      this.group.add(mesh)
      if (appendMeshes) {
        this._meshEntries.push(mesh)
      }
    }
  }

  _removeRenderGroupsForBlockString(blockString) {
    const groupKeys = [...(this._groupKeysByBlockString.get(blockString) || [])]
    if (!groupKeys.length) {
      return
    }

    const meshes = []
    for (const groupKey of groupKeys) {
      const groupRecord = this._meshGroups.get(groupKey)
      if (!groupRecord) {
        continue
      }

      meshes.push(...groupRecord.meshes)
      this._meshGroups.delete(groupKey)
    }

    this._groupKeysByBlockString.delete(blockString)
    this._disposeMeshes(meshes)
  }

  _disposeMeshes(meshes = []) {
    const disposedGeometries = new Set()
    const disposedMaterials = new Set()

    for (const mesh of meshes) {
      this.group.remove(mesh)
      if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
        disposedGeometries.add(mesh.geometry)
        mesh.geometry.dispose?.()
      }

      if (Array.isArray(mesh.material)) {
        for (const entry of mesh.material) {
          if (entry && !disposedMaterials.has(entry)) {
            disposedMaterials.add(entry)
            entry.dispose?.()
          }
        }
      }
      else if (mesh.material && !disposedMaterials.has(mesh.material)) {
        disposedMaterials.add(mesh.material)
        mesh.material.dispose?.()
      }
    }
  }

  _disposeDescriptorCache(cache = null) {
    if (!cache) {
      return
    }

    const disposedGeometries = new Set()
    const disposedMaterials = new Set()

    for (const descriptors of cache.values()) {
      if (!Array.isArray(descriptors)) {
        continue
      }

      for (const descriptor of descriptors) {
        if (descriptor.sharedGeometry && !disposedGeometries.has(descriptor.sharedGeometry)) {
          disposedGeometries.add(descriptor.sharedGeometry)
          descriptor.sharedGeometry.dispose?.()
        }

        if (descriptor.sharedMaterial && !disposedMaterials.has(descriptor.sharedMaterial)) {
          disposedMaterials.add(descriptor.sharedMaterial)
          descriptor.sharedMaterial.dispose?.()
        }
      }
    }
  }

  _disposeStagedRenderGroups(stagedGroups = null) {
    if (!stagedGroups || typeof stagedGroups.values !== 'function') {
      return
    }

    const meshes = []
    for (const groupRecord of stagedGroups.values()) {
      meshes.push(...(groupRecord?.meshes || []))
    }
    this._disposeMeshes(meshes)
  }

  _rebuildMeshEntriesList() {
    this._meshEntries = []
    for (const groupRecord of this._meshGroups.values()) {
      this._meshEntries.push(...groupRecord.meshes)
    }
  }

  async _yieldToMainThread() {
    await new Promise((resolve) => {
      if (typeof MessageChannel === 'function') {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
          channel.port1.close()
          channel.port2.close()
          resolve()
        }
        channel.port2.postMessage(null)
        return
      }
      setTimeout(resolve, 0)
    })
  }

  _isBoundsWithinDistance(bounds, origin, maxDistance) {
    if (!bounds || !origin || !Number.isFinite(maxDistance)) {
      return true
    }

    const maxDistanceSq = maxDistance * maxDistance
    const dx = origin.x < bounds.minX
      ? bounds.minX - origin.x
      : origin.x > bounds.maxX
        ? origin.x - bounds.maxX
        : 0
    const dy = origin.y < bounds.minY
      ? bounds.minY - origin.y
      : origin.y > bounds.maxY
        ? origin.y - bounds.maxY
        : 0
    const dz = origin.z < bounds.minZ
      ? bounds.minZ - origin.z
      : origin.z > bounds.maxZ
        ? origin.z - bounds.maxZ
        : 0

    return ((dx * dx) + (dy * dy) + (dz * dz)) <= maxDistanceSq
  }

  update(playerPosition = null, camera = null) {
    const resolvedPlayerPosition = playerPosition || this.experience.world?.player?.getPosition?.() || null
    const resolvedCamera = camera || this.experience.camera?.instance || null
    const runtimeRendererActive = this.isRuntimeRendererActive()

    if (runtimeRendererActive) {
      this._runtimeBridge.update({
        playerPosition: resolvedPlayerPosition,
      })
      this._meshEntries = this._runtimeBridge.getMeshes()

      // Runtime chunk residency follows the player. Three.js culls resident
      // meshes every frame without changing their lifecycle or visible state.
      this._lastVisibilityStats = {
        totalMeshes: this._meshEntries.length,
        residentMeshes: this._meshEntries.length,
        visibleMeshes: null,
        activeDistance: null,
        cullingMode: 'renderer-frustum',
        updatedAt: Number(performance.now().toFixed(2)),
      }
      return
    }
    else {
      this._cubane?.updateAnimations?.()
    }

    const now = performance.now()
    if ((now - this._lastVisibilityUpdateAt) < VISIBILITY_UPDATE_INTERVAL_MS) {
      return
    }

    this._lastVisibilityUpdateAt = now

    const chunkWidth = this.chunkManager?.chunkWidth ?? 64
    const viewDistance = this.chunkManager?.viewDistance ?? 2
    const activeDistance = Math.max((viewDistance + 1) * chunkWidth, 96)

    if (resolvedCamera) {
      resolvedCamera.updateMatrixWorld?.(true)
      resolvedCamera.matrixWorldInverse.copy(resolvedCamera.matrixWorld).invert()
      this._frustumProjectionMatrix.multiplyMatrices(
        resolvedCamera.projectionMatrix,
        resolvedCamera.matrixWorldInverse,
      )
      this._frustum.setFromProjectionMatrix(this._frustumProjectionMatrix)
    }

    let visibleMeshes = 0
    for (const mesh of this._meshEntries) {
      const bounds = mesh?.userData?.bounds
      let isVisible = true

      if (bounds && resolvedPlayerPosition) {
        isVisible = this._isBoundsWithinDistance(bounds, resolvedPlayerPosition, activeDistance)
      }

      if (isVisible && bounds && resolvedCamera) {
        this._frustumBox.min.set(bounds.minX, bounds.minY, bounds.minZ)
        this._frustumBox.max.set(bounds.maxX, bounds.maxY, bounds.maxZ)
        isVisible = this._frustum.intersectsBox(this._frustumBox)
      }

      mesh.visible = isVisible
      if (isVisible) {
        visibleMeshes++
      }
    }

    this._lastVisibilityStats = {
      totalMeshes: this._meshEntries.length,
      visibleMeshes,
      activeDistance,
      updatedAt: Number(now.toFixed(2)),
    }
  }

  clear(options = {}) {
    const blockStrings = [...this._groupKeysByBlockString.keys()]
    for (const blockString of blockStrings) {
      this._removeRenderGroupsForBlockString(blockString)
    }

    this._meshGroups.clear()
    this._groupKeysByBlockString.clear()
    this._meshEntries = []

    if (options.preserveRuntime !== true) {
      this._runtimeBridge.detachRuntimeGroup()
      this._runtimeActive = false
      this.chunkManager?.setMinecraftRuntimeBlockProvider?.(null)
    }
  }

  dispose() {
    this._disposed = true
    this._rebuildToken++
    this.clear()
    for (const geometry of this._overlayGeometryCache.values()) {
      geometry?.dispose?.()
    }
    this._overlayGeometryCache.clear()
    this.scene.remove(this.group)
    this._runtimeBridge?.dispose?.()
    this._cubane?.dispose?.()
    this._cubane = null
    this._cubanePromise = null
  }
}
