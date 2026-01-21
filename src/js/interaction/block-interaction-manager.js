import { INTERACTION_CONFIG } from '../config/interaction-config.js'
import Experience from '../experience.js'
import emitter from '../utils/event-bus.js'

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

    // Use selected block from Hotbar
    const blockToPlace = this._selectedBlockId

    // Check availability (optional: collision check with player?)
    // For now, just place it
    if (this.chunkManager) {
      this.chunkManager.addBlockWorld(targetX, targetY, targetZ, blockToPlace)

      // Consume one item from Hotbar
      emitter.emit('hud:consume-selected-item')

      // Emit placement sound/event
      emitter.emit('game:block-place', { x: targetX, y: targetY, z: targetZ })
    }
  }

  destroy() {
    emitter.off('input:toggle_block_edit_mode', this._onToggleMode)
    emitter.off('input:mouse_down', this._onMouseDown)
    emitter.off('hud:selected-block-update', this._onHotbarUpdate)
  }
}

