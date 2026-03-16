import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import Experience from '../../experience.js'
import {
  BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
  loadBundledMinecraftResourcePackBlob,
} from './minecraft-resource-pack.js'

const BUILD_BATCH_SIZE = 12
const INSTANCE_UPLOAD_BATCH_SIZE = 4096
const PREVIEW_GAMMA = 0.5
const PREVIEW_GAMMA_EXPONENT = 1 / PREVIEW_GAMMA
const VISIBILITY_UPDATE_INTERVAL_MS = 80

function createPreviewSyncedMaterial(material) {
  if (Array.isArray(material)) {
    return material.map(entry => createPreviewSyncedMaterial(entry))
  }

  if (!material?.isMaterial) {
    return material
  }

  const synced = new THREE.MeshBasicMaterial({
    name: material.name ? `${material.name}-preview-synced` : 'minecraft-preview-synced',
    color: material.color?.clone?.() || new THREE.Color(0xffffff),
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

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry?.dispose?.()
    }
    return
  }

  material?.dispose?.()
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

    this._tempTranslation = new THREE.Matrix4()
    this._tempMatrix = new THREE.Matrix4()
    this._frustum = new THREE.Frustum()
    this._frustumProjectionMatrix = new THREE.Matrix4()
    this._frustumBox = new THREE.Box3()
  }

  async ensureCubane() {
    if (this._cubane) {
      return this._cubane
    }

    if (this._cubanePromise) {
      return this._cubanePromise
    }

    this._cubanePromise = (async () => {
      const { Cubane } = await import('cubane')
      const cubane = new Cubane({ autoRestore: false })

      let loaded = false
      try {
        const blob = await loadBundledMinecraftResourcePackBlob()
        await cubane.removeAllPacks?.()
        await cubane.loadPackFromBlob(blob, BUNDLED_MINECRAFT_RESOURCE_PACK_NAME)
        try {
          await cubane.buildTextureAtlas()
        }
        catch (error) {
          console.warn('[MinecraftSchematicRenderLayer] Failed to rebuild Cubane texture atlas after pack load:', error)
        }

        loaded = true
        this._resourcePackStatus = {
          attempted: true,
          loaded: true,
          source: 'built-in',
        }
      }
      catch (error) {
        console.warn('[MinecraftSchematicRenderLayer] Failed to load bundled resource pack:', error)
        this._resourcePackStatus = {
          attempted: true,
          loaded: false,
          source: 'none',
        }
      }

      this._cubane = cubane
      return cubane
    })().catch((error) => {
      this._cubanePromise = null
      throw error
    })

    return this._cubanePromise
  }

  getStats() {
    return {
      meshCount: this._meshEntries.length,
      childCount: this.group.children.length,
      lastBuildProfile: this._lastBuildProfile ? { ...this._lastBuildProfile } : null,
      lastVisibilityStats: this._lastVisibilityStats ? { ...this._lastVisibilityStats } : null,
      resourcePackStatus: { ...this._resourcePackStatus },
    }
  }

  getOverlayGeometryForBlockString(blockString) {
    return this._overlayGeometryCache.get(blockString) || null
  }

  async rebuildFromLayer(layer, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const cubane = await this.ensureCubane()
    const rebuildToken = ++this._rebuildToken
    const buildStart = performance.now()

    const groupedBlocks = this._groupBlocksByChunkAndState(layer)
    this.clear()

    const descriptorCache = new Map()
    const blockCount = layer?.getStats?.()?.blockCount ?? 0
    const uniqueStateCount = new Set([...groupedBlocks.values()].map(entry => entry.blockString)).size
    let processedStates = 0
    let builtMeshes = 0
    let maxInstancesPerMesh = 0

    for (const groupEntry of groupedBlocks.values()) {
      if (this._disposed || rebuildToken !== this._rebuildToken) {
        return {
          cancelled: true,
          uniqueBlockStates: uniqueStateCount,
          builtMeshes,
        }
      }

      const { blockString, instances, bounds } = groupEntry
      if (!descriptorCache.has(blockString)) {
        const prototype = await cubane.getBlockMesh(blockString, 'plains', true)
        if (!prototype) {
          descriptorCache.set(blockString, null)
        }
        else {
          const descriptors = this._extractMeshDescriptors(prototype)
          descriptorCache.set(blockString, descriptors.length ? descriptors : null)
          if (!this._overlayGeometryCache.has(blockString) && descriptors.length) {
            const overlayGeometry = this._buildOverlayGeometry(descriptors)
            if (overlayGeometry) {
              this._overlayGeometryCache.set(blockString, overlayGeometry)
            }
          }
        }
      }

      const descriptors = descriptorCache.get(blockString) || []
      if (!descriptors.length) {
        processedStates++
        continue
      }
      maxInstancesPerMesh = Math.max(maxInstancesPerMesh, instances.length)

      for (let descriptorIndex = 0; descriptorIndex < descriptors.length; descriptorIndex++) {
        const descriptor = descriptors[descriptorIndex]
        const geometry = descriptor.geometry.clone()
        const material = createPreviewSyncedMaterial(descriptor.material)
        const instancedMesh = new THREE.InstancedMesh(geometry, material, instances.length)
        instancedMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
        instancedMesh.castShadow = false
        instancedMesh.receiveShadow = false
        instancedMesh.name = `minecraft-instanced:${blockString}#${descriptorIndex}`
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

          if (index > 0 && index % INSTANCE_UPLOAD_BATCH_SIZE === 0) {
            instancedMesh.instanceMatrix.needsUpdate = true
            await this._yieldToMainThread()
          }
        }

        instancedMesh.instanceMatrix.needsUpdate = true
        instancedMesh.computeBoundingSphere?.()
        instancedMesh.computeBoundingBox?.()
        this.group.add(instancedMesh)
        this._meshEntries.push(instancedMesh)
        builtMeshes++
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

    const elapsedMs = performance.now() - buildStart
    this._lastBuildProfile = {
      blockCount,
      uniqueBlockStates: uniqueStateCount,
      chunkStateGroups: groupedBlocks.size,
      builtMeshes,
      maxInstancesPerMesh,
      elapsedMs: Number(elapsedMs.toFixed(2)),
    }
    console.info('[MinecraftSchematicRenderLayer] Build profile', this._lastBuildProfile)

    return {
      uniqueBlockStates: uniqueStateCount,
      builtMeshes,
      profile: this._lastBuildProfile,
      resourcePackStatus: { ...this._resourcePackStatus },
    }
  }

  _groupBlocksByChunkAndState(layer) {
    const grouped = new Map()

    layer?.forEachBlock?.((position, entry) => {
      const blockString = buildBlockString(entry?.blockName, entry?.properties)
      const chunkKey = `${position.chunkX},${position.chunkZ}`
      const groupKey = `${chunkKey}::${blockString}`

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          blockString,
          chunkKey,
          instances: [],
          bounds: {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            minZ: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
            maxZ: Number.NEGATIVE_INFINITY,
          },
        })
      }

      const bucket = grouped.get(groupKey)
      bucket.instances.push({
        x: position.worldX,
        y: position.worldY,
        z: position.worldZ,
        blockName: entry?.blockName || '',
      })
      bucket.bounds.minX = Math.min(bucket.bounds.minX, position.worldX - 0.5)
      bucket.bounds.minY = Math.min(bucket.bounds.minY, position.worldY - 0.5)
      bucket.bounds.minZ = Math.min(bucket.bounds.minZ, position.worldZ - 0.5)
      bucket.bounds.maxX = Math.max(bucket.bounds.maxX, position.worldX + 0.5)
      bucket.bounds.maxY = Math.max(bucket.bounds.maxY, position.worldY + 0.5)
      bucket.bounds.maxZ = Math.max(bucket.bounds.maxZ, position.worldZ + 0.5)
    })

    return new Map(
      [...grouped.entries()]
        .map(([key, value]) => [key, value])
        .sort((a, b) => b[1].instances.length - a[1].instances.length),
    )
  }

  getRaycastTargets(origin = null, maxDistance = Number.POSITIVE_INFINITY) {
    if (!this.group.visible) {
      return []
    }

    if (!origin || !Number.isFinite(maxDistance)) {
      return this.group.children.filter(mesh => mesh.visible !== false)
    }

    const maxDistanceSq = maxDistance * maxDistance
    return this.group.children.filter((mesh) => {
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

  async _yieldToMainThread() {
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve())
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
    this._cubane?.updateAnimations?.()

    const now = performance.now()
    if ((now - this._lastVisibilityUpdateAt) < VISIBILITY_UPDATE_INTERVAL_MS) {
      return
    }

    this._lastVisibilityUpdateAt = now

    const resolvedPlayerPosition = playerPosition || this.experience.world?.player?.getPosition?.() || null
    const resolvedCamera = camera || this.experience.camera?.instance || null
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

  clear() {
    for (const mesh of this._meshEntries) {
      this.group.remove(mesh)
      mesh.geometry?.dispose?.()
      disposeMaterial(mesh.material)
    }

    this._meshEntries = []
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
    this._cubane?.dispose?.()
    this._cubane = null
  }
}
