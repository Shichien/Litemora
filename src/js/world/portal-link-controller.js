function normalizePortalLinkConfig(config = {}) {
  return {
    netherPortalUrl: String(config?.netherPortalUrl || '').trim(),
    endPortalUrl: String(config?.endPortalUrl || '').trim(),
  }
}

function normalizeBlockName(blockName = '') {
  return String(blockName || '').trim().toLowerCase().replace(/^minecraft:/u, '')
}

function buildPortalBoxes(worldX, worldY, worldZ, portalType, axis = 'z') {
  const minX = worldX - 0.5
  const minY = worldY - 0.5
  const minZ = worldZ - 0.5
  const maxX = worldX + 0.5
  const maxY = worldY + 0.5
  const maxZ = worldZ + 0.5

  if (portalType === 'end') {
    return [[minX, minY, minZ, maxX, maxY, maxZ]]
  }

  if (axis === 'x') {
    return [[minX, minY, worldZ - 0.125, maxX, maxY, worldZ + 0.125]]
  }

  return [[worldX - 0.125, minY, minZ, worldX + 0.125, maxY, maxZ]]
}

function boxesOverlap(a, b) {
  return a.maxX >= b.minX
    && a.minX <= b.maxX
    && a.maxY >= b.minY
    && a.minY <= b.maxY
    && a.maxZ >= b.minZ
    && a.minZ <= b.maxZ
}

export default class PortalLinkController {
  constructor(options = {}) {
    this.player = options.player || null
    this.getTerrainProvider = typeof options.getTerrainProvider === 'function'
      ? options.getTerrainProvider
      : () => null
    this.onPortalTrigger = typeof options.onPortalTrigger === 'function'
      ? options.onPortalTrigger
      : null
    this.cooldownMs = Math.max(250, Number(options.cooldownMs) || 1200)
    this.config = normalizePortalLinkConfig()
    this.activeTouchKey = ''
    this.lastTriggerAt = 0
  }

  setConfig(config = {}) {
    this.config = normalizePortalLinkConfig(config)
  }

  update() {
    const provider = this.getTerrainProvider()
    const probe = this.player?.getPortalProbeState?.()

    if (!provider?.getBlockWorld || !probe) {
      this.activeTouchKey = ''
      return
    }

    const hit = this._findTouchedPortal(probe, provider)
    if (!hit) {
      this.activeTouchKey = ''
      return
    }

    const url = hit.portalType === 'nether'
      ? this.config.netherPortalUrl
      : this.config.endPortalUrl

    if (!url) {
      return
    }

    const touchKey = `${hit.portalType}:${url}`
    if (touchKey === this.activeTouchKey) {
      return
    }

    const now = Date.now()
    if ((now - this.lastTriggerAt) < this.cooldownMs) {
      return
    }

    this.activeTouchKey = touchKey
    this.lastTriggerAt = now
    this.onPortalTrigger?.({
      type: hit.portalType,
      url,
      blockName: hit.blockName,
      position: {
        x: hit.worldX,
        y: hit.worldY,
        z: hit.worldZ,
      },
    })
  }

  _findTouchedPortal(probe, provider) {
    const playerBounds = this._buildPlayerBounds(probe)
    const minBlockX = Math.floor(playerBounds.minX + 0.5) - 1
    const maxBlockX = Math.floor(playerBounds.maxX + 0.5) + 1
    const minBlockY = Math.floor(playerBounds.minY + 0.5) - 1
    const maxBlockY = Math.floor(playerBounds.maxY + 0.5) + 1
    const minBlockZ = Math.floor(playerBounds.minZ + 0.5) - 1
    const maxBlockZ = Math.floor(playerBounds.maxZ + 0.5) + 1

    for (let worldX = minBlockX; worldX <= maxBlockX; worldX += 1) {
      for (let worldY = minBlockY; worldY <= maxBlockY; worldY += 1) {
        for (let worldZ = minBlockZ; worldZ <= maxBlockZ; worldZ += 1) {
          const block = provider.getBlockWorld(worldX, worldY, worldZ)
          const blockName = normalizeBlockName(block?.minecraftBlock?.name)
          const portalType = this._getPortalType(blockName)
          if (!portalType) {
            continue
          }

          const axis = String(block?.minecraftBlock?.properties?.axis || 'z').trim().toLowerCase()
          const portalBoxes = buildPortalBoxes(worldX, worldY, worldZ, portalType, axis)
          const touched = portalBoxes.some(([
            minX,
            minY,
            minZ,
            maxX,
            maxY,
            maxZ,
          ]) => boxesOverlap(playerBounds, {
            minX,
            minY,
            minZ,
            maxX,
            maxY,
            maxZ,
          }))

          if (touched) {
            return {
              portalType,
              blockName,
              worldX,
              worldY,
              worldZ,
            }
          }
        }
      }
    }

    return null
  }

  _getPortalType(blockName = '') {
    if (blockName === 'nether_portal') {
      return 'nether'
    }

    if (blockName === 'end_portal') {
      return 'end'
    }

    return ''
  }

  _buildPlayerBounds(probe) {
    const basePosition = probe.basePosition || { x: 0, y: 0, z: 0 }
    const radius = Math.max(0.05, Number(probe.radius) || 0.3)
    const bodyHeight = Math.max(0.2, Number(probe.bodyHeight) || 1.8)

    return {
      minX: Number(basePosition.x) - radius,
      maxX: Number(basePosition.x) + radius,
      minY: Number(basePosition.y),
      maxY: Number(basePosition.y) + bodyHeight,
      minZ: Number(basePosition.z) - radius,
      maxZ: Number(basePosition.z) + radius,
    }
  }
}
