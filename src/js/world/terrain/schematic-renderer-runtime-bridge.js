import * as THREE from 'three'
import { createMinecraftBlockMaterial } from './minecraft-block-material.js'
import { installCauldronModelFix } from './cubane-cauldron-model-fix.js'

import {
  getMinecraftBlockCollisionProfile,
  normalizeMinecraftBlockName,
  normalizeMinecraftBlockProperties,
} from './minecraft-block-data.js'
import {
  BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
  loadBundledMinecraftResourcePackBlob,
  loadPreferredMinecraftResourcePack,
} from './minecraft-resource-pack.js'

const RUNTIME_SCHEMATIC_ID = 'litemora-runtime'
const RENDERER_READY_TIMEOUT_MS = 60000
const RUNTIME_CHUNK_SIDE_LENGTH = 16
const RUNTIME_HORIZONTAL_LOAD_RADIUS = 3
const RUNTIME_VERTICAL_LOAD_RADIUS = 2
const RUNTIME_CHUNK_UNLOAD_PADDING = 1
const RUNTIME_MAX_CONCURRENT_CHUNK_BUILDS = 2

const NOOP_FFMPEG = Object.freeze({
  on() {},
  off() {},
  exec: async () => {},
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  deleteFile: async () => {},
  terminate() {},
})

function waitForRendererReady(promise, timeoutMs = RENDERER_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('schematic_renderer_runtime_init_timeout'))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function arrayBufferSignature(buffer = null) {
  if (!(buffer instanceof ArrayBuffer)) {
    return ''
  }

  return `${buffer.byteLength}:${buffer.byteLength ? new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength)).join(',') : ''}`
}

function createRuntimePosition(offset = {}) {
  const x = Number(offset.x || 0)
  const y = Number(offset.y || 0)
  const z = Number(offset.z || 0)

  // Litemora uses integer block-center coordinates throughout the terrain and
  // interaction stack, so the runtime schematic must stay on the same grid.
  return [x, y, z]
}

function applyRuntimePosition(schematicObject = null, offset = {}) {
  const group = schematicObject?.group || null
  if (!group?.position) {
    return
  }

  const [positionX, positionY, positionZ] = createRuntimePosition(offset)
  const nextPosition = schematicObject?.position?.clone?.() || group.position.clone()
  nextPosition.x = positionX
  nextPosition.y = positionY
  nextPosition.z = positionZ

  if (typeof schematicObject?.setPosition === 'function') {
    schematicObject.setPosition(nextPosition)
  }
  else {
    group.position.copy(nextPosition)
    schematicObject?.syncTransformFromGroup?.()
  }
}

function normalizeOffset(offset = {}) {
  return {
    x: Number(offset.x || 0),
    y: Number(offset.y || 0),
    z: Number(offset.z || 0),
  }
}

function normalizeFinitePosition(position = null) {
  const x = Number(position?.x)
  const y = Number(position?.y)
  const z = Number(position?.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }

  return { x, y, z }
}

function clampInteger(value, min, max, fallback) {
  const normalized = Math.floor(Number(value))
  return Number.isFinite(normalized)
    ? Math.max(min, Math.min(max, normalized))
    : fallback
}

function normalizeStreamingConfig(config = {}) {
  const horizontalLoadRadius = clampInteger(
    config.horizontalLoadRadius,
    1,
    12,
    RUNTIME_HORIZONTAL_LOAD_RADIUS,
  )
  const verticalLoadRadius = clampInteger(
    config.verticalLoadRadius,
    1,
    8,
    RUNTIME_VERTICAL_LOAD_RADIUS,
  )
  const unloadPadding = clampInteger(
    config.unloadPadding,
    1,
    4,
    RUNTIME_CHUNK_UNLOAD_PADDING,
  )

  return {
    horizontalLoadRadius,
    verticalLoadRadius,
    unloadPadding,
    horizontalUnloadRadius: horizontalLoadRadius + unloadPadding,
    verticalUnloadRadius: verticalLoadRadius + unloadPadding,
    maxConcurrentBuilds: clampInteger(
      config.maxConcurrentBuilds,
      1,
      4,
      RUNTIME_MAX_CONCURRENT_CHUNK_BUILDS,
    ),
  }
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor
}

function forEachMaterial(material, callback) {
  if (Array.isArray(material)) {
    for (const entry of material) {
      forEachMaterial(entry, callback)
    }
    return
  }

  if (material?.isMaterial) {
    callback(material)
  }
}

function collectObjectResources(objects = []) {
  const geometries = new Set()
  const materials = new Set()

  for (const object of (Array.isArray(objects) ? objects : [])) {
    object?.traverse?.((child) => {
      if (!child?.isMesh) {
        return
      }

      if (child.geometry) {
        geometries.add(child.geometry)
      }

      forEachMaterial(child.material, (material) => {
        materials.add(material)
      })
    })
  }

  return {
    geometries,
    materials,
  }
}

const runtimeBlockMaterials = new WeakMap()

function directionalRuntimeMaterial(source) {
  if (Array.isArray(source))
    return source.map(directionalRuntimeMaterial)
  if (!source?.isMaterial)
    return source
  let converted = runtimeBlockMaterials.get(source)
  if (!converted) {
    converted = createMinecraftBlockMaterial(source)
    runtimeBlockMaterials.set(source, converted)
    if (converted !== source) {
      source.addEventListener('dispose', () => {
        converted.dispose()
        runtimeBlockMaterials.delete(source)
      })
    }
  }
  return converted
}

function normalizeRuntimeMaterial(material) {
  let changed = false

  if (material.map) {
    let mapChanged = false
    if (material.map.colorSpace !== THREE.SRGBColorSpace) {
      material.map.colorSpace = THREE.SRGBColorSpace
      mapChanged = true
    }
    if (material.map.magFilter !== THREE.NearestFilter) {
      material.map.magFilter = THREE.NearestFilter
      mapChanged = true
    }
    if (material.map.minFilter !== THREE.NearestFilter) {
      material.map.minFilter = THREE.NearestFilter
      mapChanged = true
    }
    if (material.map.generateMipmaps !== false) {
      material.map.generateMipmaps = false
      mapChanged = true
    }
    if (material.map.wrapS !== THREE.ClampToEdgeWrapping) {
      material.map.wrapS = THREE.ClampToEdgeWrapping
      mapChanged = true
    }
    if (material.map.wrapT !== THREE.ClampToEdgeWrapping) {
      material.map.wrapT = THREE.ClampToEdgeWrapping
      mapChanged = true
    }
    // 只在参数真的变了（或还没上传过）时重传。以前每个区块挂载都会把整张图集重新上传到 GPU。
    if (mapChanged || material.map.version === 0) {
      material.map.needsUpdate = true
      changed = true
    }
  }

  const opacity = Number(material.opacity ?? 1)
  const alphaTest = Number(material.alphaTest ?? 0)
  if (material.transparent === true && opacity >= 0.999 && alphaTest > 0) {
    material.transparent = false
    material.depthWrite = true
    changed = true
  }

  if (material.toneMapped !== false) {
    material.toneMapped = false
    changed = true
  }

  if (material.fog !== false) {
    material.fog = false
    changed = true
  }

  if (changed) {
    material.needsUpdate = true
  }
}

function consolidateIndexedGeometryGroups(geometry) {
  const indexAttribute = geometry?.getIndex?.()
  const sourceGroups = geometry?.groups || []
  if (!indexAttribute || sourceGroups.length <= 1) {
    return sourceGroups.length
  }

  const rangesByMaterial = new Map()
  let groupedIndexCount = 0
  for (const group of sourceGroups) {
    const start = Number(group.start)
    const count = Number(group.count)
    if (
      !Number.isInteger(start)
      || !Number.isInteger(count)
      || start < 0
      || count < 0
      || (start + count) > indexAttribute.count
    ) {
      throw new RangeError('schematic_runtime_geometry_group_out_of_bounds')
    }

    if (!rangesByMaterial.has(group.materialIndex)) {
      rangesByMaterial.set(group.materialIndex, [])
    }
    rangesByMaterial.get(group.materialIndex).push(group)
    groupedIndexCount += count
  }

  if (groupedIndexCount !== indexAttribute.count) {
    throw new RangeError('schematic_runtime_geometry_groups_do_not_cover_index')
  }
  if (rangesByMaterial.size === sourceGroups.length) {
    return sourceGroups.length
  }

  const IndexArray = indexAttribute.array.constructor
  const reorderedIndices = new IndexArray(indexAttribute.count)
  let targetOffset = 0
  geometry.clearGroups()

  for (const [materialIndex, ranges] of rangesByMaterial) {
    const materialStart = targetOffset
    for (const range of ranges) {
      const sourceEnd = range.start + range.count
      reorderedIndices.set(
        indexAttribute.array.subarray(range.start, sourceEnd),
        targetOffset,
      )
      targetOffset += range.count
    }
    geometry.addGroup(materialStart, targetOffset - materialStart, materialIndex)
  }

  const reorderedIndexAttribute = new THREE.BufferAttribute(
    reorderedIndices,
    1,
    indexAttribute.normalized,
  )
  reorderedIndexAttribute.setUsage(indexAttribute.usage)
  geometry.setIndex(reorderedIndexAttribute)
  return rangesByMaterial.size
}

// schematic-renderer 给每种着色色调（红石线 16 档亮度、草/树叶的生物群系色等）各建一个
// 材质，彼此只差 color。一个区块网格因此被拆成十几次 draw call。只差 color 的材质可以
// 换成同一个 vertexColors 材质，把颜色写进顶点，再交给 consolidateIndexedGeometryGroups()
// 合并成一段。
const tintSignatureCache = new WeakMap()

function getTintMergeSignature(material) {
  if (!material) {
    return ''
  }
  // 材质很少（~20 个），但每个区块的每个组都要查；按 material.version / map 缓存
  const cached = tintSignatureCache.get(material)
  if (cached && cached.version === material.version && cached.map === material.map) {
    return cached.signature
  }
  const signature = computeTintMergeSignature(material)
  tintSignatureCache.set(material, { version: material.version, map: material.map, signature })
  return signature
}

function computeTintMergeSignature(material) {
  if (
    !material?.isMeshStandardMaterial
    || material.vertexColors
    || Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')
    || !material.color
    || material.color.r > 1 || material.color.g > 1 || material.color.b > 1
  ) {
    return ''
  }

  return [
    material.type,
    material.map?.uuid || '',
    material.alphaMap?.uuid || '',
    material.side,
    material.alphaTest,
    material.transparent,
    material.opacity,
    material.depthTest,
    material.depthWrite,
    material.blending,
    material.emissive?.getHex?.() ?? '',
    material.emissiveIntensity,
    material.roughness,
    material.metalness,
    material.flatShading,
    material.wireframe,
    material.toneMapped,
    material.fog,
    material.polygonOffset,
    JSON.stringify(material.defines || {}),
  ].join('|')
}

function mergeTintedMaterialGroups(mesh, getMergedMaterials) {
  const geometry = mesh?.geometry
  const materials = mesh?.material
  const indexAttribute = geometry?.getIndex?.()
  const position = geometry?.getAttribute?.('position')
  const groups = geometry?.groups || []
  if (!Array.isArray(materials) || !indexAttribute || !position || groups.length <= 1 || geometry.getAttribute('color')) {
    return false
  }

  // 每个签名下实际出现了几种材质；只有一种的签名合并了也省不下 draw call
  const materialsBySignature = new Map()
  for (const group of groups) {
    const material = materials[group.materialIndex]
    const signature = getTintMergeSignature(material)
    if (!signature) {
      continue
    }
    if (!materialsBySignature.has(signature)) {
      materialsBySignature.set(signature, new Set())
    }
    materialsBySignature.get(signature).add(material)
  }
  const mergeSignatures = [...materialsBySignature]
    .filter(([, set]) => set.size > 1)
    .map(([signature]) => signature)
  if (!mergeSignatures.length) {
    return false
  }

  // 顶点颜色：没被合并的组保持白色（它们的材质不读顶点色）。同一个顶点若被两种颜色的
  // 面共用，就无法用顶点色表达，整块网格放弃合并，保持原样。
  const vertexCount = position.count
  const colors = new Uint8Array(vertexCount * 4).fill(255)
  const assigned = new Int32Array(vertexCount).fill(-1)
  const indices = indexAttribute.array
  const mergeSignatureSet = new Set(mergeSignatures)
  const nextGroups = []
  for (const group of groups) {
    const material = materials[group.materialIndex]
    const signature = getTintMergeSignature(material)
    if (!mergeSignatureSet.has(signature)) {
      nextGroups.push(group)
      continue
    }

    const r = Math.round(material.color.r * 255)
    const g = Math.round(material.color.g * 255)
    const b = Math.round(material.color.b * 255)
    const packed = (r << 16) | (g << 8) | b
    const end = group.start + group.count
    for (let i = group.start; i < end; i++) {
      const vertex = indices[i]
      const previous = assigned[vertex]
      if (previous === -1) {
        assigned[vertex] = packed
        colors[vertex * 4] = r
        colors[vertex * 4 + 1] = g
        colors[vertex * 4 + 2] = b
      }
      else if (previous !== packed) {
        return false
      }
    }
    nextGroups.push({ ...group, signature })
  }

  const { array: mergedArray, indexBySignature } = getMergedMaterials(materials, mergeSignatures)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true))
  geometry.clearGroups()
  for (const group of nextGroups) {
    geometry.addGroup(
      group.start,
      group.count,
      group.signature ? indexBySignature.get(group.signature) : group.materialIndex,
    )
  }
  mesh.material = mergedArray
  return true
}

function createBoundsFromSchematic(schematicObject = null, offset = {}) {
  const min = schematicObject?.getTightBoundsMin?.() || null
  const dimensions = schematicObject?.getTightDimensions?.() || null

  if (!min || !dimensions || dimensions[0] <= 0 || dimensions[1] <= 0 || dimensions[2] <= 0) {
    return null
  }

  const offsetX = Number(offset.x || 0)
  const offsetY = Number(offset.y || 0)
  const offsetZ = Number(offset.z || 0)

  return {
    minX: Number(min[0]) + offsetX,
    minY: Number(min[1]) + offsetY,
    minZ: Number(min[2]) + offsetZ,
    maxX: Number(min[0]) + Number(dimensions[0]) + offsetX,
    maxY: Number(min[1]) + Number(dimensions[1]) + offsetY,
    maxZ: Number(min[2]) + Number(dimensions[2]) + offsetZ,
  }
}

function syncBoundsInPlace(targetBounds = null, nextBounds = null) {
  if (!nextBounds) {
    return null
  }

  if (!targetBounds) {
    return { ...nextBounds }
  }

  targetBounds.minX = nextBounds.minX
  targetBounds.minY = nextBounds.minY
  targetBounds.minZ = nextBounds.minZ
  targetBounds.maxX = nextBounds.maxX
  targetBounds.maxY = nextBounds.maxY
  targetBounds.maxZ = nextBounds.maxZ
  return targetBounds
}

function parseMinecraftBlockString(blockString = '') {
  const raw = String(blockString || '').trim()
  if (!raw) {
    return null
  }

  const bracketIndex = raw.indexOf('[')
  const hasProperties = bracketIndex > 0 && raw.endsWith(']')
  const blockName = hasProperties ? raw.slice(0, bracketIndex) : raw
  const properties = {}

  if (hasProperties) {
    const serializedProperties = raw.slice(bracketIndex + 1, -1)
    for (const pair of serializedProperties.split(',')) {
      const separatorIndex = pair.indexOf('=')
      if (separatorIndex <= 0) {
        continue
      }

      const key = pair.slice(0, separatorIndex).trim()
      const value = pair.slice(separatorIndex + 1).trim()
      if (key && value) {
        properties[key] = value
      }
    }
  }

  const normalizedBlockName = normalizeMinecraftBlockName(blockName)
  if (!normalizedBlockName || normalizedBlockName === 'air' || normalizedBlockName === 'cave_air' || normalizedBlockName === 'void_air') {
    return null
  }

  return {
    blockName: normalizedBlockName,
    properties: normalizeMinecraftBlockProperties(properties),
  }
}

function createMinecraftBlockString(blockName = '', properties = {}) {
  const normalizedName = String(blockName || '').trim()
  const entries = Object.entries(normalizeMinecraftBlockProperties(properties))
  if (!entries.length) {
    return normalizedName
  }

  return `${normalizedName}[${entries.map(([key, value]) => `${key}=${value}`).join(',')}]`
}

export default class SchematicRendererRuntimeBridge {
  constructor(options = {}) {
    this.hostGroup = options.hostGroup || null
    this.renderer = null
    this.rendererReadyPromise = null
    this.rendererContainer = null
    this.rendererCanvas = null
    this.loadedResourcePackSignature = ''
    this.loadedSourceSignature = ''
    this.schematicObject = null
    this.runtimeGroup = null
    this.meshEntries = []
    this._meshEntrySet = new Set()
    this.bounds = null
    this.runtimeOffset = { x: 0, y: 0, z: 0 }
    this._runtimePatchQueue = Promise.resolve()
    this._collisionProfileCache = new Map()
    // 合并着色材质：签名 -> vertexColors 材质；源材质数组 -> 追加了合并材质的副本
    this._tintMergedMaterials = new Map()
    this._tintMergedArrays = new WeakMap()
    this._chunkBounds = null
    this._chunkStates = new Map()
    this._chunkQueue = []
    this._activeChunkBuilds = 0
    this._activeChunkBuildPromises = new Set()
    this._streamGeneration = 0
    this._streamReady = false
    this._streamCenterKey = ''
    this._streamConfig = normalizeStreamingConfig()
    this._streamStartedAt = 0
    this._firstChunkReadyAt = 0
    this._streamError = null
    this.loadedResourcePackStatus = {
      attempted: false,
      loaded: false,
      source: 'none',
      name: '',
    }
  }

  async ensureRenderer() {
    if (this.rendererReadyPromise) {
      return waitForRendererReady(this.rendererReadyPromise)
    }

    if (typeof document === 'undefined') {
      throw new TypeError('document_unavailable_for_schematic_renderer')
    }

    this.rendererReadyPromise = new Promise((resolve, reject) => {
      void (async () => {
        try {
          const { SchematicRenderer } = await import('schematic-renderer')
          this.rendererContainer = document.createElement('div')
          this.rendererContainer.style.cssText = [
            'position:fixed',
            'left:-10000px',
            'top:-10000px',
            'width:1px',
            'height:1px',
            'opacity:0',
            'overflow:hidden',
            'pointer-events:none',
          ].join(';')

          this.rendererCanvas = document.createElement('canvas')
          this.rendererCanvas.width = 1
          this.rendererCanvas.height = 1
          this.rendererCanvas.style.width = '1px'
          this.rendererCanvas.style.height = '1px'
          this.rendererContainer.appendChild(this.rendererCanvas)
          document.body.appendChild(this.rendererContainer)

          this.renderer = new SchematicRenderer(this.rendererCanvas, {}, {
            // Resource packs are loaded explicitly through ensurePreferredResourcePack().
            // Passing defaults here makes schematic-renderer build an atlas once with
            // the bundled pack, then immediately rebuild it with Litemora's selected pack.
          }, {
            backgroundColor: 0x000000,
            showGrid: false,
            showAxes: false,
            enableDragAndDrop: false,
            enableGizmos: false,
            enableProgressBar: false,
            enableInteraction: false,
            enableAdaptiveFPS: true,
            idleFPS: 1,
            idleThreshold: 1,
            targetFPS: 1,
            chunkSideLength: RUNTIME_CHUNK_SIDE_LENGTH,
            // Runtime edits rely on schematic-renderer's chunk-local rebuild API.
            // The global batched mode keeps a single "batched" mesh entry, so
            // rebuildChunk() only adds per-chunk meshes without removing the
            // original batched geometry, leaving deleted blocks visually behind.
            meshBuildingMode: 'incremental',
            singleSchematicMode: true,
            ffmpeg: NOOP_FFMPEG,
            wasmMeshBuilderOptions: {
              enabled: true,
              greedyMeshingEnabled: false,
            },
            postProcessingOptions: {
              enabled: false,
              enableSSAO: false,
              enableSMAA: false,
              enableGamma: false,
            },
            sidebarOptions: {
              enabled: false,
            },
            keyboardControlsOptions: {
              enabled: false,
            },
            callbacks: {
              onRendererInitialized: renderer => resolve(renderer),
            },
          })
        }
        catch (error) {
          this.rendererReadyPromise = null
          this._removeRendererDom()
          reject(error)
        }
      })()
    })

    return waitForRendererReady(this.rendererReadyPromise)
  }

  async _replaceRendererResourcePack(packRecord) {
    installCauldronModelFix(this.renderer?.cubane)
    const packs = this.renderer?.packs
    if (!packs) {
      throw new Error('schematic_renderer_resource_pack_manager_unavailable')
    }

    packs.beginPackBatchUpdate?.()
    try {
      if (packs.getPackCount?.() > 0) {
        await packs.removeAllPacks()
      }
      await packs.loadPackFromBlob(packRecord.blob, packRecord.name)
      await packs.endPackBatchUpdate?.()
    }
    catch (error) {
      await packs.endPackBatchUpdate?.()
      throw error
    }
  }

  async ensurePreferredResourcePack(resourcePackSignature = '') {
    // 串行化：预热和 loadSource 可能同时调用，后来者等前一次装完后按签名复用，避免重复装包
    const previousTask = this._resourcePackTask || Promise.resolve()
    const task = previousTask
      .catch(() => {})
      .then(() => this._ensurePreferredResourcePackNow(resourcePackSignature))
    this._resourcePackTask = task
    try {
      return await task
    }
    finally {
      if (this._resourcePackTask === task) {
        this._resourcePackTask = null
      }
    }
  }

  async _ensurePreferredResourcePackNow(resourcePackSignature = '') {
    // 资源包下载（~7 MB）和 WASM 初始化互不依赖，同时进行
    const selectedPackPromise = loadPreferredMinecraftResourcePack()
    selectedPackPromise.catch(() => {})
    const renderer = await this.ensureRenderer()
    if (!renderer?.packs) {
      throw new Error('schematic_renderer_resource_pack_manager_unavailable')
    }

    const selectedPack = await selectedPackPromise
    const nextSignature = [
      selectedPack.source,
      selectedPack.key,
      selectedPack.updatedAt,
      selectedPack.size,
      resourcePackSignature,
    ].join(':')

    if (nextSignature === this.loadedResourcePackSignature) {
      return
    }

    try {
      await this._replaceRendererResourcePack(selectedPack)
      this.loadedResourcePackSignature = nextSignature
      this.loadedResourcePackStatus = {
        attempted: true,
        loaded: true,
        source: selectedPack.source,
        name: selectedPack.name,
      }
      return
    }
    catch (error) {
      if (selectedPack.source !== 'custom') {
        throw error
      }

      console.warn('[SchematicRendererRuntimeBridge] Failed to load custom resource pack, falling back to bundled pack:', error)
    }

    const fallbackBlob = await loadBundledMinecraftResourcePackBlob()
    const fallbackPack = {
      blob: fallbackBlob,
      name: BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
    }

    await this._replaceRendererResourcePack(fallbackPack)
    this.loadedResourcePackSignature = [
      'built-in-fallback',
      BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
      0,
      fallbackBlob.size,
      resourcePackSignature,
    ].join(':')
    this.loadedResourcePackStatus = {
      attempted: true,
      loaded: true,
      source: 'built-in-fallback',
      name: BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
    }
  }

  async loadSource(source = {}, options = {}) {
    const buffer = source?.buffer
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 0) {
      throw new Error('schematic_runtime_source_buffer_required')
    }

    await this.ensurePreferredResourcePack(options.resourcePackSignature || '')

    const offset = normalizeOffset(source.offset)
    const sourceSignature = [
      source.id || '',
      source.name || '',
      arrayBufferSignature(buffer),
      offset.x,
      offset.y,
      offset.z,
      this.loadedResourcePackSignature,
    ].join(':')

    if (sourceSignature === this.loadedSourceSignature && this.runtimeGroup) {
      this._updateStreamingTarget(options.playerPosition, true)
      this._pumpChunkQueue()
      return this.getStats()
    }

    const renderer = await this.ensureRenderer()

    this.detachRuntimeGroup()
    await this._waitForActiveChunkBuilds()
    await renderer.schematicManager?.removeAllSchematics?.()

    await renderer.schematicManager?.loadSchematic(
      RUNTIME_SCHEMATIC_ID,
      buffer,
      {
        focused: false,
        visible: false,
      },
      {
        onProgress: options.onProgress,
      },
    )

    const schematicObject = renderer.schematicManager?.getSchematic?.(RUNTIME_SCHEMATIC_ID)
    if (!schematicObject?.group) {
      throw new Error('schematic_runtime_group_unavailable')
    }
    if (typeof schematicObject.schematicWrapper?.get_block_string !== 'function') {
      throw new TypeError('schematic_runtime_block_state_query_unavailable')
    }

    schematicObject.visible = true
    schematicObject.group.visible = true
    applyRuntimePosition(schematicObject, offset)
    schematicObject.group.updateMatrixWorld?.(true)
    renderer.sceneManager?.scene?.remove?.(schematicObject.group)

    this.schematicObject = schematicObject
    this.runtimeGroup = schematicObject.group
    this.runtimeGroup.name = 'litemora-wasm-schematic-runtime'
    this.runtimeGroup.userData.litemoraWasmSchematicLayer = true
    this.runtimeGroup.userData.minecraftSchematicLayer = true
    this.runtimeOffset = offset
    this.bounds = createBoundsFromSchematic(schematicObject, offset)
    this.loadedSourceSignature = sourceSignature
    this._streamConfig = normalizeStreamingConfig(options.streaming)
    this._chunkBounds = this._createRuntimeChunkGridBounds(schematicObject)
    this._streamStartedAt = performance.now()
    this._firstChunkReadyAt = 0
    this._streamError = null

    schematicObject.chunkMeshes?.clear?.()
    schematicObject.meshes = []

    if (this.hostGroup) {
      this.hostGroup.add(this.runtimeGroup)
    }

    options.onRuntimeReady?.(this.getStats())

    try {
      const palette = schematicObject.getPalettes?.(schematicObject.schematicWrapper)?.default || []
      this._primeCollisionProfiles(palette)
      await schematicObject.worldMeshBuilder?.precomputePaletteGeometries?.(palette)
    }
    catch (error) {
      this.detachRuntimeGroup()
      throw error
    }

    this._streamReady = true
    this._updateStreamingTarget(options.playerPosition, true)
    this._pumpChunkQueue()

    return this.getStats()
  }

  detachRuntimeGroup() {
    this._cancelChunkStreaming()

    if (this.runtimeGroup?.parent) {
      this.runtimeGroup.parent.remove(this.runtimeGroup)
    }

    this.runtimeGroup = null
    this.schematicObject = null
    this.meshEntries = []
    this._meshEntrySet.clear()
    this.bounds = null
    this._chunkBounds = null
    this._chunkStates.clear()
    this._chunkQueue = []
    this._collisionProfileCache.clear()
    this.runtimeOffset = { x: 0, y: 0, z: 0 }
    this.loadedSourceSignature = ''
  }

  _cancelChunkStreaming() {
    this._streamGeneration++
    this._streamReady = false
    this._streamCenterKey = ''
    this._chunkQueue = []
  }

  async _waitForActiveChunkBuilds() {
    const pendingBuilds = [...this._activeChunkBuildPromises]
    if (pendingBuilds.length) {
      await Promise.allSettled(pendingBuilds)
    }
  }

  _createRuntimeChunkGridBounds(schematic = this.schematicObject) {
    const min = schematic?.getTightBoundsMin?.() || null
    const dimensions = schematic?.getTightDimensions?.() || null
    const chunkDimensions = schematic?.chunkDimensions || null
    if (!min || !dimensions || !chunkDimensions) {
      return null
    }

    const maxExclusiveX = Number(min[0]) + Number(dimensions[0])
    const maxExclusiveY = Number(min[1]) + Number(dimensions[1])
    const maxExclusiveZ = Number(min[2]) + Number(dimensions[2])
    if (
      !Number.isFinite(maxExclusiveX)
      || !Number.isFinite(maxExclusiveY)
      || !Number.isFinite(maxExclusiveZ)
      || dimensions[0] <= 0
      || dimensions[1] <= 0
      || dimensions[2] <= 0
    ) {
      return null
    }

    return {
      minX: Math.floor(Number(min[0]) / chunkDimensions.chunkWidth),
      minY: Math.floor(Number(min[1]) / chunkDimensions.chunkHeight),
      minZ: Math.floor(Number(min[2]) / chunkDimensions.chunkLength),
      maxX: Math.floor((maxExclusiveX - 1) / chunkDimensions.chunkWidth),
      maxY: Math.floor((maxExclusiveY - 1) / chunkDimensions.chunkHeight),
      maxZ: Math.floor((maxExclusiveZ - 1) / chunkDimensions.chunkLength),
    }
  }

  _getDefaultStreamPosition() {
    if (!this.bounds) {
      return null
    }

    return {
      x: (this.bounds.minX + this.bounds.maxX) * 0.5,
      y: this.bounds.minY + 0.5,
      z: (this.bounds.minZ + this.bounds.maxZ) * 0.5,
    }
  }

  _worldPositionToChunk(position = null) {
    const resolvedPosition = normalizeFinitePosition(position) || this._getDefaultStreamPosition()
    const chunkDimensions = this.schematicObject?.chunkDimensions || null
    if (!resolvedPosition || !chunkDimensions) {
      return null
    }

    return {
      x: Math.floor((resolvedPosition.x - this.runtimeOffset.x) / chunkDimensions.chunkWidth),
      y: Math.floor((resolvedPosition.y - this.runtimeOffset.y) / chunkDimensions.chunkHeight),
      z: Math.floor((resolvedPosition.z - this.runtimeOffset.z) / chunkDimensions.chunkLength),
    }
  }

  _isChunkWithinGrid(chunkX, chunkY, chunkZ) {
    const bounds = this._chunkBounds
    return !!bounds
      && chunkX >= bounds.minX
      && chunkX <= bounds.maxX
      && chunkY >= bounds.minY
      && chunkY <= bounds.maxY
      && chunkZ >= bounds.minZ
      && chunkZ <= bounds.maxZ
  }

  _createRuntimeChunkWorldBounds(chunkX, chunkY, chunkZ) {
    const schematic = this.schematicObject
    const chunkDimensions = schematic?.chunkDimensions || null
    const tightMin = schematic?.getTightBoundsMin?.() || null
    const tightDimensions = schematic?.getTightDimensions?.() || null
    if (!chunkDimensions || !tightMin || !tightDimensions) {
      return this.bounds ? { ...this.bounds } : null
    }

    const tightMaxX = Number(tightMin[0]) + Number(tightDimensions[0])
    const tightMaxY = Number(tightMin[1]) + Number(tightDimensions[1])
    const tightMaxZ = Number(tightMin[2]) + Number(tightDimensions[2])
    return {
      minX: Math.max(chunkX * chunkDimensions.chunkWidth, Number(tightMin[0])) + this.runtimeOffset.x,
      minY: Math.max(chunkY * chunkDimensions.chunkHeight, Number(tightMin[1])) + this.runtimeOffset.y,
      minZ: Math.max(chunkZ * chunkDimensions.chunkLength, Number(tightMin[2])) + this.runtimeOffset.z,
      maxX: Math.min((chunkX + 1) * chunkDimensions.chunkWidth, tightMaxX) + this.runtimeOffset.x,
      maxY: Math.min((chunkY + 1) * chunkDimensions.chunkHeight, tightMaxY) + this.runtimeOffset.y,
      maxZ: Math.min((chunkZ + 1) * chunkDimensions.chunkLength, tightMaxZ) + this.runtimeOffset.z,
    }
  }

  _updateStreamingTarget(playerPosition = null, force = false) {
    if (!this.schematicObject || !this._chunkBounds) {
      return
    }

    const center = this._worldPositionToChunk(playerPosition)
    if (!center) {
      return
    }

    const centerKey = this._getRuntimeChunkKey(center.x, center.y, center.z)
    if (!force && centerKey === this._streamCenterKey) {
      return
    }
    this._streamCenterKey = centerKey

    for (const record of this._chunkStates.values()) {
      const dx = Math.abs(record.chunkX - center.x)
      const dy = Math.abs(record.chunkY - center.y)
      const dz = Math.abs(record.chunkZ - center.z)
      record.desired = false
      record.retain = dx <= this._streamConfig.horizontalUnloadRadius
        && dz <= this._streamConfig.horizontalUnloadRadius
        && dy <= this._streamConfig.verticalUnloadRadius
    }

    const horizontalRadius = this._streamConfig.horizontalLoadRadius
    const verticalRadius = this._streamConfig.verticalLoadRadius
    for (let chunkY = center.y - verticalRadius; chunkY <= center.y + verticalRadius; chunkY++) {
      for (let chunkZ = center.z - horizontalRadius; chunkZ <= center.z + horizontalRadius; chunkZ++) {
        for (let chunkX = center.x - horizontalRadius; chunkX <= center.x + horizontalRadius; chunkX++) {
          if (!this._isChunkWithinGrid(chunkX, chunkY, chunkZ)) {
            continue
          }

          const key = this._getRuntimeChunkKey(chunkX, chunkY, chunkZ)
          let record = this._chunkStates.get(key)
          if (!record) {
            record = {
              key,
              chunkX,
              chunkY,
              chunkZ,
              state: 'queued',
              desired: true,
              retain: true,
              objects: [],
              promise: null,
              error: '',
            }
            this._chunkStates.set(key, record)
          }
          record.desired = true
          record.retain = true
          record.priority = ((chunkX - center.x) ** 2)
            + ((chunkZ - center.z) ** 2)
            + (((chunkY - center.y) ** 2) * 2)
        }
      }
    }

    for (const [key, record] of this._chunkStates) {
      if (record.desired || record.retain) {
        continue
      }

      if (record.state === 'loaded' || record.state === 'empty') {
        this._unloadRuntimeChunk(record)
      }
      this._chunkStates.delete(key)
    }

    this._chunkQueue = [...this._chunkStates.values()]
      .filter(record => record.desired && record.state === 'queued')
      .sort((left, right) => left.priority - right.priority)
  }

  _removeRuntimeMeshEntries(objects = []) {
    const removedMeshes = new Set()
    for (const object of (Array.isArray(objects) ? objects : [])) {
      object?.traverse?.((child) => {
        if (child?.isMesh) {
          removedMeshes.add(child)
          this._meshEntrySet.delete(child)
        }
      })
    }

    if (removedMeshes.size) {
      this.meshEntries = this.meshEntries.filter(mesh => !removedMeshes.has(mesh))
    }
  }

  _tagRuntimeChunkObjects(objects, chunkX, chunkY, chunkZ) {
    const chunkBounds = this._createRuntimeChunkWorldBounds(chunkX, chunkY, chunkZ)
    for (const object of (Array.isArray(objects) ? objects : [])) {
      object?.traverse?.((child) => {
        if (!child?.isMesh) {
          return
        }

        child.userData.litemoraWasmSchematicLayer = true
        child.userData.minecraftSchematicLayer = true
        child.userData.runtimeChunkKey = this._getRuntimeChunkKey(chunkX, chunkY, chunkZ)
        child.userData.bounds = chunkBounds
        child.visible = true
        child.frustumCulled = true
        child.castShadow = false
        child.receiveShadow = false
        forEachMaterial(child.material, normalizeRuntimeMaterial)
        mergeTintedMaterialGroups(child, this._getTintMergedMaterials)
        child.material = directionalRuntimeMaterial(child.material)
        consolidateIndexedGeometryGroups(child.geometry)
        if (!this._meshEntrySet.has(child)) {
          this._meshEntrySet.add(child)
          this.meshEntries.push(child)
        }
      })
    }
  }

  _unloadRuntimeChunk(record) {
    const schematic = this.schematicObject
    const objects = record?.objects?.length
      ? record.objects
      : schematic?.getChunkObjectsAt?.(record.chunkX, record.chunkY, record.chunkZ) || []
    this._removeRuntimeMeshEntries(objects)
    schematic?.chunkMeshes?.delete?.(record.key)
    this._disposeRuntimeChunkObjects(objects, { schematic })
    record.objects = []
    record.state = 'unloaded'
  }

  _readRuntimeChunkData(schematic, chunkX, chunkY, chunkZ) {
    const chunkDimensions = schematic?.chunkDimensions || null
    if (!chunkDimensions || !schematic?.schematicWrapper) {
      return { blocks: [], entities: null }
    }

    if (typeof schematic.schematicWrapper.getChunkData === 'function') {
      const chunkData = schematic.schematicWrapper.getChunkData(
        chunkX,
        chunkY,
        chunkZ,
        chunkDimensions.chunkWidth,
        chunkDimensions.chunkHeight,
        chunkDimensions.chunkLength,
      )
      return {
        blocks: chunkData?.blocks || [],
        entities: chunkData?.entities || null,
      }
    }

    return {
      blocks: schematic.schematicWrapper.get_chunk_blocks_indices?.(
        chunkX * chunkDimensions.chunkWidth,
        chunkY * chunkDimensions.chunkHeight,
        chunkZ * chunkDimensions.chunkLength,
        chunkDimensions.chunkWidth,
        chunkDimensions.chunkHeight,
        chunkDimensions.chunkLength,
      ) || [],
      entities: null,
    }
  }

  async _buildRuntimeChunkObjects(schematic, chunkX, chunkY, chunkZ) {
    const { blocks, entities } = this._readRuntimeChunkData(schematic, chunkX, chunkY, chunkZ)
    if (!blocks.length) {
      return []
    }

    return schematic.worldMeshBuilder.getChunkMesh(
      {
        blocks,
        chunk_x: chunkX,
        chunk_y: chunkY,
        chunk_z: chunkZ,
      },
      schematic,
      schematic.renderingBounds,
      entities,
    )
  }

  _startChunkBuild(record) {
    const schematic = this.schematicObject
    const generation = this._streamGeneration
    record.state = 'loading'
    record.error = ''
    this._activeChunkBuilds++

    const buildPromise = this._buildRuntimeChunkObjects(
      schematic,
      record.chunkX,
      record.chunkY,
      record.chunkZ,
    )
      .then((objects) => {
        if (
          generation !== this._streamGeneration
          || schematic !== this.schematicObject
          || this._chunkStates.get(record.key) !== record
        ) {
          this._disposeRuntimeChunkObjects(objects, { schematic })
          return
        }

        this._swapRuntimeChunkObjects(
          schematic,
          record.chunkX,
          record.chunkY,
          record.chunkZ,
          objects,
        )
        record.objects = objects
        record.state = objects.length ? 'loaded' : 'empty'
        if (!this._firstChunkReadyAt && objects.length) {
          this._firstChunkReadyAt = performance.now()
        }
      })
      .catch((error) => {
        if (generation !== this._streamGeneration || this._chunkStates.get(record.key) !== record) {
          return
        }

        record.state = 'error'
        record.error = error?.message || 'runtime_chunk_build_failed'
        this._streamError = record.error
        console.error(`[SchematicRendererRuntimeBridge] Failed to build runtime chunk ${record.key}:`, error)
      })
      .finally(() => {
        if (record.promise === buildPromise) {
          record.promise = null
        }
        this._activeChunkBuilds = Math.max(0, this._activeChunkBuilds - 1)
        this._activeChunkBuildPromises.delete(buildPromise)
        this._pumpChunkQueue()
      })

    record.promise = buildPromise
    this._activeChunkBuildPromises.add(buildPromise)
  }

  _pumpChunkQueue() {
    if (!this._streamReady || !this.schematicObject) {
      return
    }

    while (this._activeChunkBuilds < this._streamConfig.maxConcurrentBuilds) {
      const record = this._chunkQueue.shift()
      if (!record) {
        return
      }
      if (record.state !== 'queued' || !record.desired || this._chunkStates.get(record.key) !== record) {
        continue
      }
      this._startChunkBuild(record)
    }
  }

  _primeCollisionProfiles(palette = []) {
    for (const entry of (Array.isArray(palette) ? palette : [])) {
      const blockString = createMinecraftBlockString(entry?.name, entry?.properties)
      const parsedBlock = parseMinecraftBlockString(blockString)
      if (!parsedBlock) {
        this._collisionProfileCache.set(blockString, null)
        continue
      }

      const profile = getMinecraftBlockCollisionProfile(parsedBlock.blockName, parsedBlock.properties)
      if (!profile.isKnownBlock) {
        throw new Error(`unsupported_minecraft_collision_block:${parsedBlock.blockName}`)
      }
      this._collisionProfileCache.set(blockString, profile)
    }
  }

  _getCollisionProfileForBlockString(blockString = '') {
    const cacheKey = String(blockString || '').trim()
    if (this._collisionProfileCache.has(cacheKey)) {
      return this._collisionProfileCache.get(cacheKey)
    }

    const parsedBlock = parseMinecraftBlockString(cacheKey)
    if (!parsedBlock) {
      this._collisionProfileCache.set(cacheKey, null)
      return null
    }

    const profile = getMinecraftBlockCollisionProfile(parsedBlock.blockName, parsedBlock.properties)
    if (!profile.isKnownBlock) {
      throw new Error(`unsupported_minecraft_collision_block:${parsedBlock.blockName}`)
    }
    this._collisionProfileCache.set(cacheKey, profile)
    return profile
  }

  _createRuntimeBlockRecord(blockString = '') {
    const profile = this._getCollisionProfileForBlockString(blockString)
    if (!profile) {
      return null
    }

    return {
      blockName: profile.blockName,
      properties: profile.properties,
      stateId: profile.stateId,
      collisionBoxes: profile.collisionBoxes,
      collisionSource: profile.collisionSource,
      boundingBox: profile.boundingBox,
      hasCollision: profile.hasCollision,
      isKnownBlock: profile.isKnownBlock,
      isClimbable: profile.isClimbable,
      runtime: true,
    }
  }

  _enqueueRuntimePatch(task) {
    const next = this._runtimePatchQueue.then(task, task)
    this._runtimePatchQueue = next.catch(() => {})
    return next
  }

  _getRuntimeChunkKey(chunkX, chunkY, chunkZ) {
    return `${chunkX},${chunkY},${chunkZ}`
  }

  _parseRuntimeChunkKey(chunkKey = '') {
    const [chunkX, chunkY, chunkZ] = String(chunkKey || '').split(',').map(value => Number(value))
    if (!Number.isFinite(chunkX) || !Number.isFinite(chunkY) || !Number.isFinite(chunkZ)) {
      return null
    }

    return { chunkX, chunkY, chunkZ }
  }

  _getSharedRuntimeMaterials(schematic = null) {
    const sharedMaterials = new Set(this._tintMergedMaterials.values())
    forEachMaterial(schematic?.worldMeshBuilder?.paletteCache?.globalMaterials, (material) => {
      sharedMaterials.add(material)
    })
    for (const material of [...sharedMaterials]) {
      const converted = runtimeBlockMaterials.get(material)
      if (converted)
        sharedMaterials.add(converted)
    }
    return sharedMaterials
  }

  // 箭头函数：作为回调传给 mergeTintedMaterialGroups()
  _getTintMergedMaterials = (sourceMaterials, signatures) => {
    let entry = this._tintMergedArrays.get(sourceMaterials)
    // 源数组被库追加过新材质时重建副本，保证原有下标不变、新材质也能取到
    if (!entry || entry.sourceLength !== sourceMaterials.length) {
      entry = {
        sourceLength: sourceMaterials.length,
        array: [...sourceMaterials],
        indexBySignature: new Map(),
      }
      this._tintMergedArrays.set(sourceMaterials, entry)
    }

    for (const signature of signatures) {
      if (entry.indexBySignature.has(signature)) {
        continue
      }
      let merged = this._tintMergedMaterials.get(signature)
      if (!merged) {
        const template = sourceMaterials.find(material => getTintMergeSignature(material) === signature)
        merged = template.clone()
        merged.name = 'litemora_tint_merged'
        merged.color.setRGB(1, 1, 1)
        merged.vertexColors = true
        merged.needsUpdate = true
        this._tintMergedMaterials.set(signature, merged)
      }
      entry.indexBySignature.set(signature, entry.array.length)
      entry.array.push(merged)
    }
    return entry
  }

  _disposeRuntimeChunkObjects(objects = [], {
    schematic = null,
    retainGeometries = null,
    retainMaterials = null,
  } = {}) {
    const retainedGeometries = retainGeometries instanceof Set
      ? retainGeometries
      : new Set()
    const retainedMaterials = new Set([
      ...(retainMaterials instanceof Set ? retainMaterials : []),
      ...this._getSharedRuntimeMaterials(schematic),
    ])
    const disposedGeometries = new Set()
    const disposedMaterials = new Set()

    for (const object of (Array.isArray(objects) ? objects : [])) {
      object?.parent?.remove?.(object)
      object?.traverse?.((child) => {
        if (!child?.isMesh) {
          return
        }

        if (
          child.geometry
          && !retainedGeometries.has(child.geometry)
          && !disposedGeometries.has(child.geometry)
        ) {
          disposedGeometries.add(child.geometry)
          child.geometry.dispose?.()
        }

        forEachMaterial(child.material, (material) => {
          if (
            !material
            || retainedMaterials.has(material)
            || disposedMaterials.has(material)
          ) {
            return
          }

          disposedMaterials.add(material)
          material.dispose?.()
        })
      })
    }
  }

  _swapRuntimeChunkObjects(schematic, chunkX, chunkY, chunkZ, newChunkObjects = []) {
    const oldChunkObjects = schematic?.getChunkObjectsAt?.(chunkX, chunkY, chunkZ) || []
    const replacementObjects = Array.isArray(newChunkObjects)
      ? newChunkObjects
      : []
    const chunkKey = this._getRuntimeChunkKey(chunkX, chunkY, chunkZ)

    // schematic-renderer removes old chunk meshes before awaiting the rebuilt
    // chunk, which produces a visible empty-frame flash. We keep the old chunk
    // alive until the replacement meshes are fully built, then swap in one step.
    this._removeRuntimeMeshEntries(oldChunkObjects)
    schematic?.applyPropertiesToObjects?.(replacementObjects)
    for (const object of replacementObjects) {
      schematic?.group?.add?.(object)
    }

    if (replacementObjects.length > 0) {
      schematic?.setChunkObjectsAt?.(chunkX, chunkY, chunkZ, replacementObjects)
    }
    else {
      schematic?.chunkMeshes?.delete?.(chunkKey)
    }
    this._tagRuntimeChunkObjects(replacementObjects, chunkX, chunkY, chunkZ)

    const retainedResources = collectObjectResources(replacementObjects)
    this._disposeRuntimeChunkObjects(oldChunkObjects, {
      schematic,
      retainGeometries: retainedResources.geometries,
      retainMaterials: retainedResources.materials,
    })

    const record = this._chunkStates.get(chunkKey)
    if (record) {
      record.objects = replacementObjects
      record.state = replacementObjects.length ? 'loaded' : 'empty'
    }
  }

  getRaycastTargets() {
    if (this.runtimeGroup?.visible === false) {
      return []
    }

    const visibleMeshes = this.meshEntries.filter(mesh => mesh.visible !== false)
    if (visibleMeshes.length > 0) {
      return visibleMeshes
    }

    return this.runtimeGroup ? [this.runtimeGroup] : []
  }

  getMeshes() {
    return this.runtimeGroup?.visible === false
      ? []
      : this.meshEntries
  }

  _getLocalBlockCoordinates(worldX, worldY, worldZ, offset = this.runtimeOffset) {
    const schematic = this.schematicObject
    if (!schematic) {
      return null
    }

    const localX = Math.floor(Number(worldX) - Number(offset.x || 0))
    const localY = Math.floor(Number(worldY) - Number(offset.y || 0))
    const localZ = Math.floor(Number(worldZ) - Number(offset.z || 0))
    if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(localZ)) {
      return null
    }

    const min = schematic.getTightBoundsMin?.() || null
    const dimensions = schematic.getTightDimensions?.() || null
    if (min && dimensions) {
      const maxX = Number(min[0]) + Number(dimensions[0])
      const maxY = Number(min[1]) + Number(dimensions[1])
      const maxZ = Number(min[2]) + Number(dimensions[2])
      if (
        localX < Number(min[0])
        || localY < Number(min[1])
        || localZ < Number(min[2])
        || localX >= maxX
        || localY >= maxY
        || localZ >= maxZ
      ) {
        return null
      }
    }

    return { localX, localY, localZ }
  }

  getBlockWorld(worldX, worldY, worldZ, offset = this.runtimeOffset) {
    const schematic = this.schematicObject
    const localPosition = this._getLocalBlockCoordinates(worldX, worldY, worldZ, offset)
    if (!schematic || !localPosition) {
      return null
    }

    const blockString = schematic.schematicWrapper.get_block_string(
      localPosition.localX,
      localPosition.localY,
      localPosition.localZ,
    )
    return this._createRuntimeBlockRecord(blockString)
  }

  getBlocksWorld(worldPositions = [], offset = this.runtimeOffset) {
    const schematic = this.schematicObject
    const positions = Array.isArray(worldPositions) ? worldPositions : []
    const results = Array.from({ length: positions.length }, () => null)
    if (!schematic?.schematicWrapper || !positions.length) {
      return results
    }

    const localCoordinates = []
    const resultIndexes = []
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index]
      const local = this._getLocalBlockCoordinates(position?.x, position?.y, position?.z, offset)
      if (!local) {
        continue
      }

      localCoordinates.push(local.localX, local.localY, local.localZ)
      resultIndexes.push(index)
    }
    if (!resultIndexes.length) {
      return results
    }

    const blockStrings = resultIndexes.map((_, index) => schematic.schematicWrapper.get_block_string(
      localCoordinates[index * 3],
      localCoordinates[(index * 3) + 1],
      localCoordinates[(index * 3) + 2],
    ))

    for (let index = 0; index < resultIndexes.length; index++) {
      results[resultIndexes[index]] = this._createRuntimeBlockRecord(blockStrings?.[index])
    }
    return results
  }

  _prepareRuntimePatches(worldBlocks = [], offset = this.runtimeOffset) {
    const schematic = this.schematicObject
    if (!schematic) {
      return null
    }

    if (typeof schematic.setBlockNoRebuild !== 'function' || typeof schematic.rebuildChunkAtPosition !== 'function') {
      return null
    }

    const normalizedOffset = normalizeOffset(offset)
    const patches = []
    for (const worldBlock of (Array.isArray(worldBlocks) ? worldBlocks : [])) {
      const worldX = Number(worldBlock?.worldX ?? worldBlock?.x)
      const worldY = Number(worldBlock?.worldY ?? worldBlock?.y)
      const worldZ = Number(worldBlock?.worldZ ?? worldBlock?.z)
      if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
        return null
      }

      const localX = Math.round(worldX - Number(normalizedOffset.x || 0))
      const localY = Math.round(worldY - Number(normalizedOffset.y || 0))
      const localZ = Math.round(worldZ - Number(normalizedOffset.z || 0))
      if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(localZ)) {
        return null
      }

      patches.push({
        localX,
        localY,
        localZ,
        blockString: String(worldBlock?.blockString || 'minecraft:air').trim() || 'minecraft:air',
      })
    }

    if (!patches.length) {
      return null
    }

    return {
      schematic,
      normalizedOffset,
      patches,
    }
  }

  _getRuntimeChunkCoordinates(localX, localY, localZ, schematic = this.schematicObject) {
    const chunkDimensions = schematic?.chunkDimensions || null
    if (!chunkDimensions) {
      return null
    }

    return {
      x: Math.floor(localX / chunkDimensions.chunkWidth),
      y: Math.floor(localY / chunkDimensions.chunkHeight),
      z: Math.floor(localZ / chunkDimensions.chunkLength),
    }
  }

  _collectPatchChunkKeys(patch, schematic = this.schematicObject) {
    const chunkDimensions = schematic?.chunkDimensions || null
    const chunk = this._getRuntimeChunkCoordinates(patch.localX, patch.localY, patch.localZ, schematic)
    if (!chunkDimensions || !chunk) {
      return []
    }

    const chunks = new Map()
    const addChunk = (chunkX, chunkY, chunkZ) => {
      if (!this._isChunkWithinGrid(chunkX, chunkY, chunkZ)) {
        return
      }
      const key = this._getRuntimeChunkKey(chunkX, chunkY, chunkZ)
      chunks.set(key, { key, chunkX, chunkY, chunkZ })
    }

    addChunk(chunk.x, chunk.y, chunk.z)

    const localChunkX = positiveModulo(patch.localX, chunkDimensions.chunkWidth)
    const localChunkY = positiveModulo(patch.localY, chunkDimensions.chunkHeight)
    const localChunkZ = positiveModulo(patch.localZ, chunkDimensions.chunkLength)
    if (localChunkX === 0)
      addChunk(chunk.x - 1, chunk.y, chunk.z)
    if (localChunkX === chunkDimensions.chunkWidth - 1)
      addChunk(chunk.x + 1, chunk.y, chunk.z)
    if (localChunkY === 0)
      addChunk(chunk.x, chunk.y - 1, chunk.z)
    if (localChunkY === chunkDimensions.chunkHeight - 1)
      addChunk(chunk.x, chunk.y + 1, chunk.z)
    if (localChunkZ === 0)
      addChunk(chunk.x, chunk.y, chunk.z - 1)
    if (localChunkZ === chunkDimensions.chunkLength - 1)
      addChunk(chunk.x, chunk.y, chunk.z + 1)

    return [...chunks.values()]
  }

  async _rebuildResidentRuntimeChunk(chunkRecord, schematic = this.schematicObject) {
    if (!chunkRecord || !schematic) {
      return false
    }

    if (chunkRecord.state === 'loading' && chunkRecord.promise) {
      await chunkRecord.promise
    }
    if (
      this._chunkStates.get(chunkRecord.key) !== chunkRecord
      || (chunkRecord.state !== 'loaded' && chunkRecord.state !== 'empty')
    ) {
      return false
    }

    const generation = this._streamGeneration
    chunkRecord.state = 'rebuilding'
    const replacementObjects = await this._buildRuntimeChunkObjects(
      schematic,
      chunkRecord.chunkX,
      chunkRecord.chunkY,
      chunkRecord.chunkZ,
    )
    if (
      generation !== this._streamGeneration
      || schematic !== this.schematicObject
      || this._chunkStates.get(chunkRecord.key) !== chunkRecord
    ) {
      this._disposeRuntimeChunkObjects(replacementObjects, { schematic })
      return false
    }

    this._swapRuntimeChunkObjects(
      schematic,
      chunkRecord.chunkX,
      chunkRecord.chunkY,
      chunkRecord.chunkZ,
      replacementObjects,
    )
    return true
  }

  async _applyRuntimePatches({ schematic, normalizedOffset, patches }) {
    const affectedChunks = new Map()
    for (const patch of patches) {
      const position = {
        x: patch.localX,
        y: patch.localY,
        z: patch.localZ,
      }

      await schematic.setBlockNoRebuild(position, patch.blockString)

      for (const chunk of this._collectPatchChunkKeys(patch, schematic)) {
        affectedChunks.set(chunk.key, chunk)
      }
    }

    const palette = schematic.getPalettes?.(schematic.schematicWrapper)?.default || []
    await schematic.worldMeshBuilder?.precomputePaletteGeometries?.(palette)
    this._primeCollisionProfiles(palette)

    for (const chunk of affectedChunks.values()) {
      const record = this._chunkStates.get(chunk.key)
      if (record) {
        await this._rebuildResidentRuntimeChunk(record, schematic)
      }
    }

    syncBoundsInPlace(this.bounds, createBoundsFromSchematic(schematic, normalizedOffset))
    this._chunkBounds = this._createRuntimeChunkGridBounds(schematic)
    this._streamCenterKey = ''
    this.runtimeGroup?.updateMatrixWorld?.(true)
    return true
  }

  setBlocksAtWorld(worldBlocks = [], offset = this.runtimeOffset) {
    const preparedPatches = this._prepareRuntimePatches(worldBlocks, offset)
    if (!preparedPatches) {
      return false
    }

    void this._enqueueRuntimePatch(() => this._applyRuntimePatches(preparedPatches))
      .catch((error) => {
        console.warn('[SchematicRendererRuntimeBridge] Failed to patch runtime schematic block:', error)
      })

    return true
  }

  async setBlocksAtWorldAsync(worldBlocks = [], offset = this.runtimeOffset) {
    const preparedPatches = this._prepareRuntimePatches(worldBlocks, offset)
    if (!preparedPatches) {
      return false
    }

    try {
      return await this._enqueueRuntimePatch(() => this._applyRuntimePatches(preparedPatches))
    }
    catch (error) {
      console.warn('[SchematicRendererRuntimeBridge] Failed to patch runtime schematic block:', error)
      return false
    }
  }

  isActive() {
    return !!(this.runtimeGroup && this.schematicObject)
  }

  /**
   * 运行时修改卸载滞后（单位：运行时 16³ chunk），下一帧按新的卸载半径重新筛选常驻 chunk
   * @returns {boolean} 配置是否发生变化。
   */
  setUnloadPadding(unloadPadding) {
    const nextConfig = normalizeStreamingConfig({
      ...this._streamConfig,
      unloadPadding,
    })
    if (nextConfig.unloadPadding === this._streamConfig.unloadPadding) {
      return false
    }

    this._streamConfig = nextConfig
    this._streamCenterKey = ''
    return true
  }

  update(options = {}) {
    if (this._streamReady) {
      this._updateStreamingTarget(options.playerPosition)
      this._pumpChunkQueue()
    }
    this.hostGroup?.updateMatrixWorld?.(true)
    this.runtimeGroup?.updateMatrixWorld?.(true)
    this.renderer?.cubane?.updateAnimations?.()
  }

  getStats() {
    const dimensions = this.schematicObject?.getTightDimensions?.() || null
    const chunkStates = [...this._chunkStates.values()]
    const loadedChunkCount = chunkStates.filter(record => record.state === 'loaded').length
    const emptyChunkCount = chunkStates.filter(record => record.state === 'empty').length
    const queuedChunkCount = chunkStates.filter(record => record.state === 'queued').length
    let totalChunkCount = 0
    if (this._chunkBounds) {
      totalChunkCount = (this._chunkBounds.maxX - this._chunkBounds.minX + 1)
        * (this._chunkBounds.maxY - this._chunkBounds.minY + 1)
        * (this._chunkBounds.maxZ - this._chunkBounds.minZ + 1)
    }
    return {
      mode: 'schematic-renderer-wasm',
      meshCount: this.meshEntries.length,
      loadedChunkCount,
      emptyChunkCount,
      residentChunkCount: loadedChunkCount + emptyChunkCount,
      loadingChunkCount: this._activeChunkBuilds,
      queuedChunkCount,
      totalChunkCount,
      streamReady: this._streamReady,
      streamCenter: this._parseRuntimeChunkKey(this._streamCenterKey),
      firstChunkMs: this._firstChunkReadyAt && this._streamStartedAt
        ? Number((this._firstChunkReadyAt - this._streamStartedAt).toFixed(2))
        : null,
      streamError: this._streamError,
      sharedMemory: !!this.schematicObject?.worldMeshBuilder?.isUsingSharedMemory?.(),
      bounds: this.bounds ? { ...this.bounds } : null,
      dimensions: dimensions
        ? {
            x: Number(dimensions[0] || 0),
            y: Number(dimensions[1] || 0),
            z: Number(dimensions[2] || 0),
          }
        : null,
      sourceSignature: this.loadedSourceSignature,
      resourcePackSignature: this.loadedResourcePackSignature,
      resourcePackStatus: { ...this.loadedResourcePackStatus },
    }
  }

  invalidateResourcePack() {
    this.loadedResourcePackSignature = ''
    this.loadedSourceSignature = ''
    this.loadedResourcePackStatus = {
      attempted: false,
      loaded: false,
      source: 'none',
      name: '',
    }
  }

  _removeRendererDom() {
    this.rendererContainer?.parentElement?.removeChild(this.rendererContainer)
    this.rendererContainer = null
    this.rendererCanvas = null
  }

  dispose() {
    this.detachRuntimeGroup()
    for (const material of this._tintMergedMaterials.values()) {
      material.dispose?.()
    }
    this._tintMergedMaterials.clear()
    this._tintMergedArrays = new WeakMap()
    this.renderer?.dispose?.()
    this.renderer = null
    this.rendererReadyPromise = null
    this.loadedResourcePackSignature = ''
    this.loadedResourcePackStatus = {
      attempted: false,
      loaded: false,
      source: 'none',
      name: '',
    }
    this._removeRendererDom()
  }
}
