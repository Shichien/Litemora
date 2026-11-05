import emitter from '@three/utils/event/event-bus.js'
/**
 * HUD Store - Minecraft Style HUD State Management
 * Manages the hotbar and the player position/facing shown in the HUD
 */
import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

export const useHudStore = defineStore('hud', () => {
  // ========================================
  // Hotbar
  // ========================================

  /** Maximum stack size per slot */
  const MAX_STACK = 64

  /** Selected hotbar slot: 0-8 */
  const selectedSlot = ref(0)

  /**
   * Hotbar items (9 slots)
   * Each slot: { blockId: number, count: number } | null
   */
  const hotbarItems = ref([
    { blockId: 2, count: 30 }, // Initial: 30 dirt blocks
    { blockId: 31, count: 30 }, // Initial: 30 stone slab blocks
    { blockId: 32, count: 30 }, // Initial: 30 stone stairs blocks
    null,
    null,
    null,
    null,
    null,
    null,
  ])

  // ========================================
  // Player Position & Facing
  // ========================================

  /** Player world position */
  const position = reactive({ x: 0, y: 0, z: 0 })

  /** Player facing angle in radians (0 = +Z, PI/2 = +X) */
  const facingAngle = ref(0)

  /** Block edit mode from BlockInteractionManager: 'remove' | 'add' */
  const blockEditMode = ref('remove')

  // ========================================
  // Actions
  // ========================================

  /**
   * Update player position and facing from Three.js
   * @param {{ position: THREE.Vector3, facingAngle: number }} data
   */
  function updatePlayerInfo(data) {
    if (data.position) {
      position.x = data.position.x
      position.y = data.position.y
      position.z = data.position.z
    }
    if (typeof data.facingAngle === 'number') {
      facingAngle.value = data.facingAngle
    }
  }

  /**
   * Select hotbar slot
   * @param {number} slot - 0-8
   */
  function selectSlot(slot) {
    if (slot >= 0 && slot <= 8) {
      selectedSlot.value = slot
      // Notify Three.js interaction manager of the new selected block
      emitter.emit('hud:selected-block-update', { blockId: getSelectedBlockId() })
    }
  }

  /**
   * Cycle hotbar slot (mouse wheel)
   * @param {number} delta - +1 or -1
   */
  function cycleSlot(delta) {
    selectSlot((selectedSlot.value + Math.sign(delta) + 9) % 9)
  }

  /**
   * Add item to hotbar (prioritize stacking same type)
   * @param {number} blockId - Block type ID
   * @param {number} amount - Amount to add (default: 1)
   * @returns {boolean} - True if successfully added
   */
  function addItemToHotbar(blockId, amount = 1) {
    // 1. Prioritize stacking on existing same-type slots
    for (const slot of hotbarItems.value) {
      if (slot?.blockId === blockId && slot.count < MAX_STACK) {
        const canAdd = Math.min(amount, MAX_STACK - slot.count)
        slot.count += canAdd
        amount -= canAdd
        if (amount <= 0)
          return true
      }
    }
    // 2. Find empty slots for remaining
    for (let i = 0; i < 9; i++) {
      if (!hotbarItems.value[i] && amount > 0) {
        hotbarItems.value[i] = { blockId, count: Math.min(amount, MAX_STACK) }
        amount -= MAX_STACK
        if (amount <= 0)
          return true
      }
    }
    // 3. Hotbar full
    return false
  }

  /**
   * Consume one item from currently selected slot
   * @returns {boolean} - True if successfully consumed
   */
  function consumeSelectedItem() {
    const item = hotbarItems.value[selectedSlot.value]
    if (!item)
      return false
    item.count--
    if (item.count <= 0) {
      hotbarItems.value[selectedSlot.value] = null
    }
    return true
  }

  /**
   * Get the block ID of currently selected slot
   * @returns {number|null} - Block ID or null if empty
   */
  function getSelectedBlockId() {
    return hotbarItems.value[selectedSlot.value]?.blockId ?? null
  }

  // ========================================
  // Event Listeners Setup
  // ========================================

  function handleAddItem({ blockId, amount }) {
    addItemToHotbar(blockId, amount)
  }

  // Hotbar communication with Three.js interaction manager
  function handleRequestSelectedBlock() {
    emitter.emit('hud:selected-block-update', { blockId: getSelectedBlockId() })
  }

  function handleConsumeSelectedItem() {
    consumeSelectedItem()
    // Notify interaction manager of the updated selected block
    emitter.emit('hud:selected-block-update', { blockId: getSelectedBlockId() })
  }

  function handleEditModeChanged({ mode } = {}) {
    blockEditMode.value = mode === 'add' ? 'add' : 'remove'
  }

  function setupListeners() {
    emitter.on('hud:update', updatePlayerInfo)
    emitter.on('hud:select-slot', selectSlot)
    emitter.on('hud:cycle-slot', cycleSlot)
    emitter.on('hud:add-item', handleAddItem)
    emitter.on('hud:request-selected-block', handleRequestSelectedBlock)
    emitter.on('hud:consume-selected-item', handleConsumeSelectedItem)
    emitter.on('game:block_edit_mode_changed', handleEditModeChanged)
  }

  function cleanupListeners() {
    emitter.off('hud:update', updatePlayerInfo)
    emitter.off('hud:select-slot', selectSlot)
    emitter.off('hud:cycle-slot', cycleSlot)
    emitter.off('hud:add-item', handleAddItem)
    emitter.off('hud:request-selected-block', handleRequestSelectedBlock)
    emitter.off('hud:consume-selected-item', handleConsumeSelectedItem)
    emitter.off('game:block_edit_mode_changed', handleEditModeChanged)
    blockEditMode.value = 'remove'
  }

  // ========================================
  // Return Public API
  // ========================================

  return {
    // Hotbar
    selectedSlot,
    hotbarItems,
    blockEditMode,

    // Position & Facing
    position,
    facingAngle,

    // Actions
    updatePlayerInfo,
    selectSlot,
    cycleSlot,
    addItemToHotbar,
    consumeSelectedItem,
    getSelectedBlockId,

    // Lifecycle
    setupListeners,
    cleanupListeners,
  }
})
