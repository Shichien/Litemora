import * as THREE from 'three'
import { INTERACTION_CONFIG } from '../config/interaction-config.js'
import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import {
  getBlockBehavior,
  isIronBarsBlockType,
  isStairBlockType,
  isWallBlockType,
} from '../world/terrain/block-behaviors.js'
import { ensureDynamicBlockType, getBlockTypeById } from '../world/terrain/blocks-config.js'

/**
 * BlockInteractionManager
 * - Manages the current interaction mode (Add vs Remove)
 * - Toggles between Mining (Remove) and Placing (Add)
 * - Listens to 'Q' key for mode switching
 * - Uses event-based Hotbar integration for block placement
 */
export default class BlockInteractionManager {
  constructor(options = {}) {
    this.experience = new Experience()

    // Dependencies
    this.chunkManager = options.chunkManager
    this.raycaster = options.blockRaycaster
    this.miningController = options.blockMiningController

    // State
    this.mode = INTERACTION_CONFIG.modes.REMOVE // 'remove' | 'add'
    this._tmpLookDirection = new THREE.Vector3()

    // Hotbar state (synced via events from hudStore)
    this._selectedBlockId = null
    this._onHotbarUpdate = this._onHotbarUpdate.bind(this)
    emitter.on('hud:selected-block-update', this._onHotbarUpdate)

    // Bindings
    this._onToggleMode = this._onToggleMode.bind(this)
    this._onMouseDown = this._onMouseDown.bind(this)
    this._onMiningComplete = this._onMiningComplete.bind(this)

    // Listeners
    emitter.on('input:toggle_block_edit_mode', this._onToggleMode)
    emitter.on('input:mouse_down', this._onMouseDown)
    emitter.on('game:mining-complete', this._onMiningComplete)

    // Initialize state (Default to Remove/Mining mode)
    this._updateMode()
  }

  /**
   * Receive selected block info from hudStore
   */
  _onHotbarUpdate({ blockId }) {
    this._selectedBlockId = blockId
  }

  _onToggleMode() {
    this.mode = this.mode === INTERACTION_CONFIG.modes.REMOVE ? INTERACTION_CONFIG.modes.ADD : INTERACTION_CONFIG.modes.REMOVE
    this._updateMode()
  }

  _updateMode() {
    // 1. Notify UI / Visual Helpers
    emitter.emit('game:block_edit_mode_changed', { mode: this.mode })

    // 2. Configure Mining Controller
    if (this.miningController) {
      if (this.mode === INTERACTION_CONFIG.modes.REMOVE) {
        this.miningController.params.enabled = true
      }
      else {
        this.miningController.params.enabled = false
        // Ensure any active mining is cancelled
        this.miningController._resetMining()
        emitter.emit('game:mining-cancel')
      }
    }

    // 3. Request current selected block from hudStore
    emitter.emit('hud:request-selected-block')
  }

  _onMouseDown(event) {
    // Left click (0) only
    if (event.button !== 0)
      return

    // Ignore if not in ADD mode
    if (this.mode !== INTERACTION_CONFIG.modes.ADD)
      return

    // Ensure we have a valid target
    if (!this.raycaster || !this.raycaster.current)
      return

    this._placeBlock(this.raycaster.current)
  }

  _onMiningComplete(payload = {}) {
    const worldBlock = payload?.target?.worldBlock
    if (!worldBlock) {
      return
    }

    this._refreshConnectedStairs(worldBlock.x, worldBlock.y, worldBlock.z)
    this._refreshConnectedThinBlocks(worldBlock.x, worldBlock.y, worldBlock.z)
  }

  _placeBlock(target) {
    const { worldBlock, face } = target

    if (!face || !face.normal)
      return

    // Get selected block from Hotbar (synced via event)
    if (!this._selectedBlockId) {
      // No block selected in Hotbar, cannot place
      return
    }

    // Calculate target position based on normal
    const nx = Math.round(face.normal.x)
    const ny = Math.round(face.normal.y)
    const nz = Math.round(face.normal.z)

    const targetX = worldBlock.x + nx
    const targetY = worldBlock.y + ny
    const targetZ = worldBlock.z + nz

    // Use selected block from Hotbar and resolve smart variants for slabs/stairs/connectables
    const blockToPlace = this._resolvePlacementBlockId(
      this._selectedBlockId,
      target,
      { nx, ny, nz },
      { x: targetX, y: targetY, z: targetZ },
    )
    if (!blockToPlace) {
      return
    }

    // Check availability (optional: collision check with player?)
    // For now, just place it
    if (this.chunkManager) {
      this.chunkManager.addBlockWorld(targetX, targetY, targetZ, blockToPlace)

      const placedBlockType = getBlockTypeById(blockToPlace)
      if (this._isStairBlockType(placedBlockType)) {
        this._refreshConnectedStairs(targetX, targetY, targetZ)
      }
      this._refreshConnectedThinBlocks(targetX, targetY, targetZ)

      // Consume one item from Hotbar
      emitter.emit('hud:consume-selected-item')

      // Emit placement sound/event
      emitter.emit('game:block-place', { x: targetX, y: targetY, z: targetZ })
    }
  }

  _resolvePlacementBlockId(selectedBlockId, target, normal, placementPosition = null) {
    const blockType = getBlockTypeById(selectedBlockId)
    if (!blockType) {
      return selectedBlockId
    }

    const blockName = blockType.name || ''
    const textureName = this._getTextureName(blockType)

    const behavior = getBlockBehavior(blockType)
    const isSlab = behavior.slab
    const isStair = behavior.stair
    const isTrapdoor = behavior.trapdoor
    const isIronBars = behavior.bars
    const isWall = behavior.wall

    if (!isSlab && !isStair && !isTrapdoor && !isIronBars && !isWall) {
      return selectedBlockId
    }

    if (!textureName) {
      return selectedBlockId
    }

    const half = this._resolvePlacementHalf(target, normal)

    if (isSlab) {
      const slabBlock = ensureDynamicBlockType(textureName, {
        blockName: blockName || 'dynamic_slab',
        geometryType: half === 'top' ? 'slab_top' : 'slab_bottom',
      })
      return slabBlock?.id || selectedBlockId
    }

    if (isTrapdoor) {
      const trapHalf = this._resolvePlacementHalf(target, normal)
      const trapFacing = this._resolvePlacementFacingByNormalOrCamera(normal)
      const trapOpen = false
      const trapdoorBlock = ensureDynamicBlockType(textureName, {
        blockName: blockName || 'dynamic_trapdoor',
        geometryType: `trapdoor_${trapHalf}_${trapOpen ? 'open' : 'closed'}_${trapFacing}`,
      })
      return trapdoorBlock?.id || selectedBlockId
    }

    if (isIronBars && placementPosition) {
      const barsBlock = ensureDynamicBlockType(textureName, {
        blockName: blockName || 'iron_bars',
        geometryType: this._resolveBarsGeometryTypeForPosition(placementPosition),
      })
      return barsBlock?.id || selectedBlockId
    }

    if (isWall && placementPosition) {
      const wallBlock = ensureDynamicBlockType(textureName, {
        blockName: blockName || 'dynamic_wall',
        geometryType: this._resolveWallGeometryTypeForPosition(placementPosition),
      })
      return wallBlock?.id || selectedBlockId
    }

    const facing = this._resolvePlacementFacing()
    const shape = placementPosition
      ? this._resolveStairShapeForPosition(placementPosition, half, facing, textureName)
      : 'straight'
    const stairBlock = ensureDynamicBlockType(textureName, {
      blockName: blockName || 'dynamic_stairs',
      geometryType: `stair_${half}_${facing}_${shape}`,
    })
    return stairBlock?.id || selectedBlockId
  }

  _isStairBlockType(blockType) {
    return isStairBlockType(blockType)
  }

  _isBarsBlockType(blockType) {
    return isIronBarsBlockType(blockType)
  }

  _isWallBlockType(blockType) {
    return isWallBlockType(blockType)
  }

  _getTextureName(blockType) {
    return blockType?.textureKeys?.all
      || blockType?.textureKeys?.top
      || blockType?.textureKeys?.side
      || null
  }

  _isFilledBlockAt(x, y, z) {
    const block = this.chunkManager?.getBlockWorld?.(x, y, z)
    return Boolean(block && block.id && block.id !== 0)
  }

  _resolveBarsGeometryTypeForPosition(position) {
    const north = this._isFilledBlockAt(position.x, position.y, position.z - 1) ? 1 : 0
    const east = this._isFilledBlockAt(position.x + 1, position.y, position.z) ? 1 : 0
    const south = this._isFilledBlockAt(position.x, position.y, position.z + 1) ? 1 : 0
    const west = this._isFilledBlockAt(position.x - 1, position.y, position.z) ? 1 : 0
    return `bars_${north}${east}${south}${west}`
  }

  _resolveWallGeometryTypeForPosition(position) {
    const north = this._isFilledBlockAt(position.x, position.y, position.z - 1) ? 1 : 0
    const east = this._isFilledBlockAt(position.x + 1, position.y, position.z) ? 1 : 0
    const south = this._isFilledBlockAt(position.x, position.y, position.z + 1) ? 1 : 0
    const west = this._isFilledBlockAt(position.x - 1, position.y, position.z) ? 1 : 0
    const connectedCount = north + east + south + west
    const up = connectedCount === 0 ? 1 : 0
    return `wall_${up}_${north}${east}${south}${west}`
  }

  _parseStairGeometryType(blockType) {
    const geometryType = blockType?.geometryType || ''
    const match = geometryType.match(/^stair_(top|bottom)_(north|south|east|west)(?:_(straight|inner_left|inner_right|outer_left|outer_right))?$/u)
    if (!match) {
      return null
    }
    return {
      half: match[1],
      facing: match[2],
      shape: match[3] || 'straight',
    }
  }

  _facingOffset(facing) {
    const mapping = {
      north: { x: 0, z: -1 },
      south: { x: 0, z: 1 },
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 },
    }
    return mapping[facing] || mapping.north
  }

  _leftFacing(facing) {
    const mapping = {
      north: 'west',
      west: 'south',
      south: 'east',
      east: 'north',
    }
    return mapping[facing] || 'west'
  }

  _rightFacing(facing) {
    const mapping = {
      north: 'east',
      east: 'south',
      south: 'west',
      west: 'north',
    }
    return mapping[facing] || 'east'
  }

  _isPerpendicularFacing(a, b) {
    const pair = `${a}:${b}`
    return pair === 'north:east'
      || pair === 'north:west'
      || pair === 'south:east'
      || pair === 'south:west'
      || pair === 'east:north'
      || pair === 'east:south'
      || pair === 'west:north'
      || pair === 'west:south'
  }

  _getStairInfoAt(x, y, z, expectedHalf = null, expectedTexture = null) {
    if (!this.chunkManager) {
      return null
    }

    const block = this.chunkManager.getBlockWorld(x, y, z)
    const blockType = getBlockTypeById(block?.id)
    if (!this._isStairBlockType(blockType)) {
      return null
    }

    const parsed = this._parseStairGeometryType(blockType)
    if (!parsed) {
      return null
    }

    const textureName = blockType?.textureKeys?.all
      || blockType?.textureKeys?.top
      || blockType?.textureKeys?.side

    if (expectedHalf && parsed.half !== expectedHalf) {
      return null
    }

    if (expectedTexture && textureName && textureName !== expectedTexture) {
      return null
    }

    return {
      ...parsed,
      textureName,
      blockType,
      id: block.id,
    }
  }

  _resolveStairShapeForPosition(position, half, facing, textureName) {
    const offset = this._facingOffset(facing)
    const front = this._getStairInfoAt(position.x + offset.x, position.y, position.z + offset.z, half, textureName)
    const back = this._getStairInfoAt(position.x - offset.x, position.y, position.z - offset.z, half, textureName)
    const leftFacing = this._leftFacing(facing)
    const rightFacing = this._rightFacing(facing)

    if (front && this._isPerpendicularFacing(front.facing, facing)) {
      if (front.facing === leftFacing) {
        return 'outer_left'
      }
      if (front.facing === rightFacing) {
        return 'outer_right'
      }
    }

    if (back && this._isPerpendicularFacing(back.facing, facing)) {
      if (back.facing === leftFacing) {
        return 'inner_left'
      }
      if (back.facing === rightFacing) {
        return 'inner_right'
      }
    }

    return 'straight'
  }

  _refreshConnectedStairs(centerX, centerY, centerZ) {
    const offsets = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ]

    offsets.forEach((offset) => {
      const x = centerX + offset.x
      const y = centerY
      const z = centerZ + offset.z
      const info = this._getStairInfoAt(x, y, z)
      if (!info) {
        return
      }

      const nextShape = this._resolveStairShapeForPosition({ x, y, z }, info.half, info.facing, info.textureName)
      if (nextShape === info.shape) {
        return
      }

      const nextBlock = ensureDynamicBlockType(info.textureName, {
        blockName: info.blockType?.name || 'dynamic_stairs',
        geometryType: `stair_${info.half}_${info.facing}_${nextShape}`,
      })
      if (nextBlock?.id && nextBlock.id !== info.id) {
        this.chunkManager.addBlockWorld(x, y, z, nextBlock.id)
      }
    })
  }

  _refreshConnectedThinBlocks(centerX, centerY, centerZ) {
    const offsets = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ]

    offsets.forEach((offset) => {
      const x = centerX + offset.x
      const y = centerY
      const z = centerZ + offset.z
      const current = this.chunkManager?.getBlockWorld?.(x, y, z)
      const currentType = getBlockTypeById(current?.id)
      if (!currentType) {
        return
      }

      const textureName = this._getTextureName(currentType)
      if (!textureName) {
        return
      }

      if (this._isBarsBlockType(currentType)) {
        const geometryType = this._resolveBarsGeometryTypeForPosition({ x, y, z })
        const nextBlock = ensureDynamicBlockType(textureName, {
          blockName: currentType.name || 'iron_bars',
          geometryType,
        })
        if (nextBlock?.id && nextBlock.id !== current.id) {
          this.chunkManager.addBlockWorld(x, y, z, nextBlock.id)
        }
        return
      }

      if (this._isWallBlockType(currentType)) {
        const geometryType = this._resolveWallGeometryTypeForPosition({ x, y, z })
        const nextBlock = ensureDynamicBlockType(textureName, {
          blockName: currentType.name || 'dynamic_wall',
          geometryType,
        })
        if (nextBlock?.id && nextBlock.id !== current.id) {
          this.chunkManager.addBlockWorld(x, y, z, nextBlock.id)
        }
      }
    })
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
    emitter.off('game:mining-complete', this._onMiningComplete)
    emitter.off('hud:selected-block-update', this._onHotbarUpdate)
  }
}
