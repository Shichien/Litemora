export const DEFAULT_PROJECTION_SPAWN_LIFT = 2

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function hasFiniteBounds(bounds = null) {
  return Number.isFinite(Number(bounds?.minX))
    && Number.isFinite(Number(bounds?.maxX))
    && Number.isFinite(Number(bounds?.maxY))
    && Number.isFinite(Number(bounds?.minZ))
    && Number.isFinite(Number(bounds?.maxZ))
}

export function buildProjectionTopCenterSpawnPoint(
  bounds = null,
  offset = null,
  lift = DEFAULT_PROJECTION_SPAWN_LIFT,
) {
  if (!hasFiniteBounds(bounds)) {
    return null
  }

  const offsetX = toFiniteNumber(offset?.x, 0)
  const offsetY = toFiniteNumber(offset?.y, 0)
  const offsetZ = toFiniteNumber(offset?.z, 0)
  const spawnLift = toFiniteNumber(lift, DEFAULT_PROJECTION_SPAWN_LIFT)
  const minX = Number(bounds.minX)
  const maxX = Number(bounds.maxX)
  const maxY = Number(bounds.maxY)
  const minZ = Number(bounds.minZ)
  const maxZ = Number(bounds.maxZ)

  return {
    x: Number((((minX + maxX) * 0.5) + offsetX).toFixed(2)),
    y: Number((maxY + offsetY + 0.5 + spawnLift).toFixed(2)),
    z: Number((((minZ + maxZ) * 0.5) + offsetZ).toFixed(2)),
  }
}

export function buildProjectionBlockSpawnPoint(
  position = null,
  offset = null,
  lift = DEFAULT_PROJECTION_SPAWN_LIFT,
) {
  const blockX = Number(position?.x)
  const blockY = Number(position?.y)
  const blockZ = Number(position?.z)
  if (!Number.isFinite(blockX) || !Number.isFinite(blockY) || !Number.isFinite(blockZ)) {
    return null
  }

  const offsetX = toFiniteNumber(offset?.x, 0)
  const offsetY = toFiniteNumber(offset?.y, 0)
  const offsetZ = toFiniteNumber(offset?.z, 0)
  const spawnLift = toFiniteNumber(lift, DEFAULT_PROJECTION_SPAWN_LIFT)

  return {
    x: Number((blockX + offsetX).toFixed(2)),
    y: Number((blockY + offsetY + 0.5 + spawnLift).toFixed(2)),
    z: Number((blockZ + offsetZ).toFixed(2)),
  }
}

export function buildProjectionSpawnPointFromPreview(
  preview = null,
  offset = null,
  lift = DEFAULT_PROJECTION_SPAWN_LIFT,
) {
  return buildProjectionTopCenterSpawnPoint(preview?.bounds || null, offset, lift)
}
