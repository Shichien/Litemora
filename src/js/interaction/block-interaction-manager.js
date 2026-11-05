import * as THREE from 'three'
import { INTERACTION_CONFIG } from '../config/interaction-config.js'
import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import { getBlockBehavior } from '../world/terrain/block-behaviors.js'
import { getBlockTypeById, getMinecraftBlockStateForBlockType } from '../world/terrain/blocks-config.js'
import { buildMinecraftInteractableToggleUpdates } from '../world/terrain/minecraft-interactive-blocks.js'

function buildMinecraftBlockString(blockName = '', properties = {}) {
  const normalizedBlockName = String(blockName || '')
    .trim()
    .replace(/^minecraft:/u, '')

  const entries = Object.entries(properties || {})
    .filter(([key, value]) => key && value !== undefined && value !== null && String(value).trim())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

  if (!normalizedBlockName) {
    return ''
  }

  if (!entries.length) {
    return `minecraft:${normalizedBlockName}`
  }

  const serialized = entries
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join(',')

  return `minecraft:${normalizedBlockName}[${serialized}]`
}

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
    this._useBlockInterceptor = null
    this._placementPending = false

    // Hotbar state (synced via events from hudStore)
    this._selectedBlockId = null
    this._onHotbarUpdate = this._onHotbarUpdate.bind(this)
    emitter.on('hud:selected-block-update', this._onHotbarUpdate)

    // Bindings
    this._onToggleMode = this._onToggleMode.bind(this)
    this._onMouseDown = this._onMouseDown.bind(this)

    // Listeners
    emitter.on('input:toggle_block_edit_mode', this._onToggleMode)
    emitter.on('input:mouse_down', this._onMouseDown)

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
    if (event.button === 2) {
      this._useBlock(this.raycaster?.current)
      return
    }

    // Left click (0) only
    if (event.button !== 0)
      return

    // Ignore if not in ADD mode
    if (this.mode !== INTERACTION_CONFIG.modes.ADD)
      return

    // Ensure we have a valid target
    if (!this.raycaster || !this.raycaster.current)
      return

    void this._placeBlock(this.raycaster.current)
  }

  _useBlock(target) {
    if (!target?.worldBlock || !this.chunkManager) {
      return false
    }

    if (this._useBlockInterceptor?.({ target })) {
      return true
    }

    const minecraftBlock = target?.minecraftBlock
    const updates = buildMinecraftInteractableToggleUpdates({
      worldX: target.worldBlock.x,
      worldY: target.worldBlock.y,
      worldZ: target.worldBlock.z,
      blockName: minecraftBlock?.name || target.blockName,
      properties: minecraftBlock?.properties || {},
      getBlockAt: (x, y, z) => this.chunkManager?.getImportedMinecraftBlockWorld?.(x, y, z),
    })

    if (!updates.length) {
      return false
    }

    let changed = false
    const affectedBlockStates = new Set()
    const appliedUpdates = []
    for (const update of updates) {
      const previousEntry = this.chunkManager?.getImportedMinecraftBlockWorld?.(
        update.x,
        update.y,
        update.z,
        { includeTransientRemoved: true },
      )
      const previousBlockString = buildMinecraftBlockString(previousEntry?.blockName, previousEntry?.properties)
      const nextBlockString = buildMinecraftBlockString(update.blockName, update.properties)

      const nextEntry = this.chunkManager.setImportedMinecraftBlock(
        update.x,
        update.y,
        update.z,
        update.blockName,
        update.properties,
        { refreshTerrain: false },
      )
      changed = changed || !!nextEntry
      if (previousBlockString) {
        affectedBlockStates.add(previousBlockString)
      }
      if (nextBlockString) {
        affectedBlockStates.add(nextBlockString)
      }
      appliedUpdates.push({
        x: update.x,
        y: update.y,
        z: update.z,
        blockName: update.blockName,
        properties: { ...update.properties },
        previousBlockString,
        nextBlockString,
      })
    }

    if (!changed) {
      return false
    }

    this.chunkManager.syncMinecraftSchematicLayerState()
    this.chunkManager.refreshImportedMinecraftBlocks?.(appliedUpdates)
    emitter.emit('game:block-use', {
      source: 'minecraft-schematic',
      worldBlock: { ...target.worldBlock },
      minecraftBlock: {
        name: minecraftBlock?.name || target.blockName || '',
        properties: updates[0]?.properties || {},
      },
      updates: appliedUpdates,
      affectedBlockStates: [...affectedBlockStates],
    })

    return true
  }

  setUseBlockInterceptor(interceptor = null) {
    this._useBlockInterceptor = typeof interceptor === 'function' ? interceptor : null
  }

  /**
   * 放置快捷栏选中的方块：旧方块 id → Minecraft 方块状态 → 写入原理图会话层并补丁运行时渲染
   * - 只在放置成功后消耗快捷栏物品并广播 game:block-place
   * @returns {Promise<boolean>} 是否放置成功。
   */
  async _placeBlock(target) {
    const { worldBlock, face } = target || {}
    if (!worldBlock || !face?.normal || !this.chunkManager) {
      return false
    }

    if (!this._selectedBlockId || this._placementPending) {
      return false
    }

    const nx = Math.round(face.normal.x)
    const ny = Math.round(face.normal.y)
    const nz = Math.round(face.normal.z)
    const position = {
      x: worldBlock.x + nx,
      y: worldBlock.y + ny,
      z: worldBlock.z + nz,
    }

    const selectedBlockId = this._selectedBlockId
    const blockState = this._resolvePlacementBlockState(selectedBlockId, target, { nx, ny, nz })
    if (!blockState) {
      console.warn('[BlockInteractionManager] 无法把快捷栏方块映射为 Minecraft 方块，已跳过放置', { blockId: selectedBlockId })
      return false
    }

    this._placementPending = true
    let result = false
    try {
      result = await this.chunkManager.placeMinecraftBlockWorldAsync?.(
        position.x,
        position.y,
        position.z,
        blockState.name,
        blockState.properties,
      )
    }
    catch (error) {
      console.warn('[BlockInteractionManager] 放置方块失败', { position, blockState, error })
      return false
    }
    finally {
      this._placementPending = false
    }

    if (!result) {
      console.warn('[BlockInteractionManager] 放置方块失败：目标格已被占用或运行时补丁未生效', { position, blockState })
      return false
    }

    emitter.emit('hud:consume-selected-item')
    emitter.emit('game:block-place', {
      ...position,
      source: 'minecraft-schematic',
      blockId: selectedBlockId,
      minecraftBlock: {
        name: `minecraft:${blockState.name}`,
        properties: { ...blockState.properties },
      },
      affectedBlockStates: [result.blockString],
    })
    return true
  }

  /**
   * @returns {{ name: string, properties: Record<string, string> } | null} 要放置的 Minecraft 方块状态。
   */
  _resolvePlacementBlockState(selectedBlockId, target, normal) {
    const blockType = getBlockTypeById(selectedBlockId)
    const baseState = getMinecraftBlockStateForBlockType(blockType)
    if (!baseState) {
      return null
    }

    const behavior = getBlockBehavior(blockType)
    const half = this._resolvePlacementHalf(target, normal)

    if (behavior.slab) {
      return {
        name: baseState.name,
        properties: { ...baseState.properties, type: half, waterlogged: 'false' },
      }
    }

    if (behavior.stair) {
      return {
        name: baseState.name,
        properties: {
          ...baseState.properties,
          facing: this._resolvePlayerFacing(),
          half,
          shape: 'straight',
          waterlogged: 'false',
        },
      }
    }

    return baseState
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

  /** 玩家水平朝向（Minecraft 楼梯的 facing 与放置者朝向一致） */
  _resolvePlayerFacing() {
    const direction = this.experience.camera?.instance?.getWorldDirection?.(this._tmpLookDirection)
    const dirX = Number(direction?.x || 0)
    const dirZ = Number(direction?.z || 0)

    if (Math.abs(dirX) > Math.abs(dirZ)) {
      return dirX > 0 ? 'east' : 'west'
    }
    return dirZ > 0 ? 'south' : 'north'
  }

  destroy() {
    emitter.off('input:toggle_block_edit_mode', this._onToggleMode)
    emitter.off('input:mouse_down', this._onMouseDown)
    emitter.off('hud:selected-block-update', this._onHotbarUpdate)
  }
}
