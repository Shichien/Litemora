import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

function normalizeCollisionBox(box = null) {
  if (!box) {
    return null
  }

  if (Array.isArray(box) && box.length >= 6) {
    return {
      minX: Number(box[0]),
      minY: Number(box[1]),
      minZ: Number(box[2]),
      maxX: Number(box[3]),
      maxY: Number(box[4]),
      maxZ: Number(box[5]),
    }
  }

  return {
    minX: Number(box.minX),
    minY: Number(box.minY),
    minZ: Number(box.minZ),
    maxX: Number(box.maxX),
    maxY: Number(box.maxY),
    maxZ: Number(box.maxZ),
  }
}

function buildCollisionBoxesCacheKey(collisionBoxes = []) {
  return collisionBoxes
    .map(normalizeCollisionBox)
    .filter(box => box && Object.values(box).every(Number.isFinite))
    .map((box) => {
      const values = [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ]
      return values.map(value => Number(value).toFixed(4)).join(',')
    })
    .join('|')
}

export function getOverlayGeometryForTarget(target, geometryCache, options = {}) {
  const cache = geometryCache instanceof Map ? geometryCache : new Map()
  const scale = Number(options.scale) > 0 ? Number(options.scale) : 1
  const world = options.world || null
  const blockString = String(target?.blockString || '').trim()
  const getMinecraftOverlayGeometry = () => {
    if (!blockString) {
      return null
    }

    const cacheKey = `minecraft:${scale}:${blockString}`
    if (!cache.has(cacheKey)) {
      const geometry = world?.minecraftSchematicRenderLayer?.getOverlayGeometryForBlockString?.(blockString)
      if (geometry) {
        const overlayGeometry = geometry.clone()
        overlayGeometry.scale(scale, scale, scale)
        cache.set(cacheKey, overlayGeometry)
      }
    }

    return cache.get(cacheKey) || null
  }

  // Prefer collision boxes for the mining overlay so imported Minecraft models
  // do not reuse their atlas UVs for destroy-stage textures.
  if (!Array.isArray(target?.collisionBoxes) || !target.collisionBoxes.length || !target?.worldBlock) {
    return getMinecraftOverlayGeometry()
  }

  const boxesKey = buildCollisionBoxesCacheKey(target.collisionBoxes)
  if (!boxesKey) {
    return getMinecraftOverlayGeometry()
  }

  const cacheKey = `boxes:${scale}:${boxesKey}`
  if (!cache.has(cacheKey)) {
    const geometries = target.collisionBoxes
      .map(normalizeCollisionBox)
      .filter(box => box && Object.values(box).every(Number.isFinite))
      .map((box) => {
        const width = Math.max(0.001, box.maxX - box.minX)
        const height = Math.max(0.001, box.maxY - box.minY)
        const depth = Math.max(0.001, box.maxZ - box.minZ)
        const geometry = new THREE.BoxGeometry(width * scale, height * scale, depth * scale)

        const localCenterX = ((box.minX + box.maxX) * 0.5) - 0.5
        const localCenterY = ((box.minY + box.maxY) * 0.5) - 0.5
        const localCenterZ = ((box.minZ + box.maxZ) * 0.5) - 0.5
        geometry.translate(localCenterX, localCenterY, localCenterZ)
        return geometry
      })

    if (geometries.length) {
      const merged = geometries.length === 1
        ? geometries[0]
        : mergeGeometries(geometries, false)

      for (const geometry of geometries) {
        if (geometry !== merged) {
          geometry.dispose?.()
        }
      }

      if (merged) {
        cache.set(cacheKey, merged)
      }
    }
  }

  return cache.get(cacheKey) || null
}
