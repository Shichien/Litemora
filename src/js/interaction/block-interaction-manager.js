import * as THREE from 'three'

import { INTERACTION_CONFIG } from '../config/interaction-config.js'
import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import { resolvePlaceableMinecraftBlockName } from '../world/terrain/minecraft-item-catalog.js'
import { getMinecraftBlockDefinition } from '../world/terrain/minecraft-block-data.js'

/**
 * BlockInteractionManager
 * - Manages the current interaction mode (Add vs Remove)
 * - Uses Minecraft block-state placement as the primary runtime path
 */
export default class BlockInteractionManager {
  constructor(options = {}) {
    this.experience = new Experience()

    this.chunkManager = options.chunkManager
    this.raycaster = options.blockRaycaster
    this.miningController = options.blockMiningController

    this.mode = INTERACTION_CONFIG.modes.REMOVE
    this._tmpLookDirection = new THREE.Vector3()

    this._selectedItem = {
      blockId: null,
      itemKey: '',
    }

    this._onHotbarUpdate = this._onHotbarUpdate.bind(this)
    this._onToggleMode = this._onToggleMode.bind(this)
    this._onMouseDown = this._onMouseDown.bind(this)

    emitter.on('hud:selected-block-update', this._onHotbarUpdate)
    emitter.on('input:toggle_block_edit_mode', this._onToggleMode)
    emitter.on('input:mouse_down', this._onMouseDown)

    this._updateMode()
  }

  _onHotbarUpdate({ blockId = null, itemKey = '' } = {}) {
    const numericBlockId = Number(blockId)
    this._selectedItem = {
      blockId: Number.isFinite(numericBlockId) && numericBlockId > 0
        ? Math.trunc(numericBlockId)
        : null,
      itemKey: String(itemKey || '').trim(),
    }
  }

  _onToggleMode() {
    this.mode = this.mode === INTERACTION_CONFIG.modes.REMOVE
      ? INTERACTION_CONFIG.modes.ADD
      : INTERACTION_CONFIG.modes.REMOVE
    this._updateMode()
  }

  _updateMode() {
    emitter.emit('game:block_edit_mode_changed', { mode: this.mode })

    if (this.miningController) {
      if (this.mode === INTERACTION_CONFIG.modes.REMOVE) {
        this.miningController.params.enabled = true
      }
      else {
        this.miningController.params.enabled = false
        this.miningController._resetMining()
        emitter.emit('game:mining-cancel')
      }
    }

    emitter.emit('hud:request-selected-block')
  }

  _onMouseDown(event) {
    if (event.button !== 0) {
      return
    }

    if (this.mode !== INTERACTION_CONFIG.modes.ADD) {
      return
    }

    if (!this.raycaster?.current) {
      return
    }

    this._placeBlock(this.raycaster.current)
  }

  _placeBlock(target) {
    const { worldBlock, face } = target
    if (!face?.normal || !worldBlock || !this.chunkManager) {
      return
    }

    const hasSelectedItem = !!(this._selectedItem.itemKey || this._selectedItem.blockId)
    if (!hasSelectedItem) {
      return
    }

    if (!this._shouldUseMinecraftRuntime()) {
      return
    }

    const nx = Math.round(face.normal.x)
    const ny = Math.round(face.normal.y)
    const nz = Math.round(face.normal.z)

    const targetX = worldBlock.x + nx
    const targetY = worldBlock.y + ny
    const targetZ = worldBlock.z + nz

    const minecraftPlacement = this._resolveMinecraftPlacement(
      this._selectedItem,
      target,
      { nx, ny, nz },
      { x: targetX, y: targetY, z: targetZ },
    )
    if (!minecraftPlacement) {
      return
    }

    const placed = this.chunkManager.addMinecraftBlockWorld(
      targetX,
      targetY,
      targetZ,
      minecraftPlacement.blockName,
      minecraftPlacement.properties,
    )
    if (!placed) {
      return
    }

    emitter.emit('hud:consume-selected-item')
    emitter.emit('game:block-place', {
      x: targetX,
      y: targetY,
      z: targetZ,
      minecraftBlock: {
        name: `minecraft:${minecraftPlacement.blockName}`,
        properties: minecraftPlacement.properties,
      },
    })
  }

  _shouldUseMinecraftRuntime() {
    return !!(this.chunkManager?.schematicOnlyMode || this.chunkManager?.minecraftRenderOverlayActive)
  }

  _resolveMinecraftPlacement(selectedItem, target, normal, placementPosition = null) {
    const blockName = this._resolveMinecraftBaseBlockName(selectedItem)
    if (!blockName) {
      return null
    }

    const properties = {}
    const half = this._resolvePlacementHalf(target, normal)

    if (blockName.endsWith('_slab')) {
      properties.type = half
    }
    else if (blockName.endsWith('_stairs')) {
      properties.half = half
      properties.facing = this._resolvePlacementFacing()
      properties.shape = 'straight'
    }
    else if (blockName.endsWith('_trapdoor')) {
      properties.half = half
      properties.facing = this._resolvePlacementFacingByNormalOrCamera(normal)
      properties.open = 'false'
    }
    else if (blockName === 'iron_bars' || blockName.endsWith('_glass_pane')) {
      Object.assign(properties, this._resolveMinecraftConnectionProperties(placementPosition))
    }
    else if (blockName.endsWith('_fence') && !blockName.endsWith('_fence_gate')) {
      Object.assign(properties, this._resolveMinecraftConnectionProperties(placementPosition))
    }
    else if (blockName.endsWith('_wall')) {
      Object.assign(properties, this._resolveMinecraftWallProperties(placementPosition))
    }
    else if (blockName.endsWith('_fence_gate')) {
      properties.facing = this._resolvePlacementFacingByNormalOrCamera(normal)
      properties.open = 'false'
      properties.in_wall = 'false'
    }
    else if (blockName === 'ladder') {
      properties.facing = this._resolvePlacementFacingByNormalOrCamera(normal)
    }
    else if (blockName === 'chain') {
      if (normal?.ny !== 0) {
        properties.axis = 'y'
      }
      else if (normal?.nx !== 0) {
        properties.axis = 'x'
      }
      else {
        properties.axis = 'z'
      }
    }
    else if (blockName === 'hopper') {
      properties.facing = normal?.ny > 0 ? 'down' : this._resolvePlacementFacingByNormalOrCamera(normal)
    }

    return {
      blockName,
      properties: this._filterMinecraftProperties(blockName, properties),
    }
  }

  _resolveMinecraftBaseBlockName(selectedItem = null) {
    const blockName = resolvePlaceableMinecraftBlockName(selectedItem)
    if (!blockName) {
      return null
    }

    return getMinecraftBlockDefinition(blockName) ? blockName : null
  }

  _filterMinecraftProperties(blockName, properties = {}) {
    const definition = getMinecraftBlockDefinition(blockName)
    if (!definition?.states?.length) {
      return properties
    }

    const allowedKeys = new Set(definition.states.map(state => state.name))
    const filtered = {}

    Object.entries(properties).forEach(([key, value]) => {
      if (!allowedKeys.has(key) || value === null || value === undefined || value === '') {
        return
      }

      filtered[key] = String(value)
    })

    return filtered
  }

  _resolveMinecraftConnectionProperties(position) {
    if (!position) {
      return {}
    }

    return {
      north: this._isFilledBlockAt(position.x, position.y, position.z - 1) ? 'true' : 'false',
      east: this._isFilledBlockAt(position.x + 1, position.y, position.z) ? 'true' : 'false',
      south: this._isFilledBlockAt(position.x, position.y, position.z + 1) ? 'true' : 'false',
      west: this._isFilledBlockAt(position.x - 1, position.y, position.z) ? 'true' : 'false',
    }
  }

  _resolveMinecraftWallProperties(position) {
    if (!position) {
      return {}
    }

    const north = this._isFilledBlockAt(position.x, position.y, position.z - 1) ? 'low' : 'none'
    const east = this._isFilledBlockAt(position.x + 1, position.y, position.z) ? 'low' : 'none'
    const south = this._isFilledBlockAt(position.x, position.y, position.z + 1) ? 'low' : 'none'
    const west = this._isFilledBlockAt(position.x - 1, position.y, position.z) ? 'low' : 'none'
    const connectedCount = [north, east, south, west].filter(value => value !== 'none').length

    return {
      up: connectedCount === 0 ? 'true' : 'false',
      north,
      east,
      south,
      west,
    }
  }

  _isFilledBlockAt(x, y, z) {
    const block = this.chunkManager?.getBlockWorld?.(x, y, z)
    return Boolean(
      block
      && (
        block.minecraftBlock
        || (block.id && block.id !== 0)
      )
      && block.hasCollision !== false
    )
  }

  _resolvePlacementHalf(target, normal) {
    if (normal?.ny < 0) {
      return 'top'
    }
    if (normal?.ny > 0) {
      return 'bottom'
    }

    const hitY = target?.point?.y
    const centerY = target?.worldPosition?.y
    if (typeof hitY === 'number' && typeof centerY === 'number') {
      return hitY >= centerY ? 'top' : 'bottom'
    }

    return 'bottom'
  }

  _resolvePlacementFacing() {
    const direction = this.experience.camera?.instance?.getWorldDirection?.(this._tmpLookDirection)
    const dirX = Number(direction?.x || 0)
    const dirZ = Number(direction?.z || 0)

    let playerFacing
    if (Math.abs(dirX) > Math.abs(dirZ)) {
      playerFacing = dirX > 0 ? 'east' : 'west'
    }
    else {
      playerFacing = dirZ > 0 ? 'south' : 'north'
    }

    const opposite = {
      north: 'south',
      south: 'north',
      east: 'west',
      west: 'east',
    }
    return opposite[playerFacing] || 'north'
  }

  _resolvePlacementFacingByNormalOrCamera(normal) {
    if (normal?.nx === 1) {
      return 'east'
    }
    if (normal?.nx === -1) {
      return 'west'
    }
    if (normal?.nz === 1) {
      return 'south'
    }
    if (normal?.nz === -1) {
      return 'north'
    }
    return this._resolvePlacementFacing()
  }

  destroy() {
    emitter.off('input:toggle_block_edit_mode', this._onToggleMode)
    emitter.off('input:mouse_down', this._onMouseDown)
    emitter.off('hud:selected-block-update', this._onHotbarUpdate)
  }
}
