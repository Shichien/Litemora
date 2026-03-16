import emitter from '@three/utils/event/event-bus.js'
/**
 * HUD Store - Minecraft Style HUD State Management
 * Manages health, hunger, experience, hotbar, position, and chat messages
 */
import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import {
  buildInventoryItemDescriptor,
  resolveInventoryItemKey,
} from '@three/world/terrain/minecraft-item-catalog.js'

export const useHudStore = defineStore('hud', () => {
  function toStackCount(value, fallback = 1) {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback
  }

  function normalizeHotbarItemInput(input, amount = 1) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return buildInventoryItemDescriptor(input, input.count ?? input.amount ?? amount)
    }
    return buildInventoryItemDescriptor({ blockId: input }, amount)
  }

  function getHotbarItemStackKey(item) {
    const itemKey = resolveInventoryItemKey(item)
    if (itemKey) {
      return `minecraft:${itemKey}`
    }

    const numericBlockId = Number(item?.blockId)
    if (Number.isFinite(numericBlockId) && numericBlockId > 0) {
      return `legacy:${Math.trunc(numericBlockId)}`
    }

    return ''
  }

  function emitSelectedBlockUpdate() {
    emitter.emit('hud:selected-block-update', {
      blockId: getSelectedBlockId(),
      itemKey: getSelectedItemKey(),
    })
  }

  // ========================================
  // Player Stats (Mock Data)
  // ========================================

  /** Health: 0-20, each heart = 2 HP */
  const health = ref(20)
  const maxHealth = ref(20)

  /** Hunger: 0-20, each drumstick = 2 points */
  const hunger = ref(20)
  const maxHunger = ref(20)

  /** Experience: 0-1 progress ratio */
  const experience = ref(0.37)
  /** Player level */
  const level = ref(7)

  // ========================================
  // Hotbar
  // ========================================

  /** Maximum stack size per slot */
  const MAX_STACK = 64

  /** Selected hotbar slot: 0-8 */
  const selectedSlot = ref(0)

  /**
   * Hotbar items (9 slots)
   * Each slot: { itemKey: string, blockId: number | null, count: number } | null
   */
  const hotbarItems = ref([
    buildInventoryItemDescriptor({ blockId: 2 }, 30), // Initial: 30 dirt blocks
    buildInventoryItemDescriptor({ blockId: 31 }, 30), // Initial: 30 stone slab blocks
    buildInventoryItemDescriptor({ blockId: 32 }, 30), // Initial: 30 stone stairs blocks
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

  // ========================================
  // Chat Messages
  // ========================================

  /** Chat/system messages */
  const chatMessages = ref([
    { id: 1, type: 'system', text: '[系统] 世界已建立完成', timestamp: Date.now() - 5000 },
    { id: 2, type: 'system', text: '[系统] 玩家物理碰撞已加载', timestamp: Date.now() - 3000 },
    { id: 3, type: 'system', text: '[系统] 相机使用默认参数', timestamp: Date.now() - 1000 },
  ])

  /** Next message ID */
  let nextMessageId = 4

  // ==================== Chat State ====================
  const isChatOpen = ref(false)

  // ==================== Info Panel State ====================
  const gameTime = ref('12:00 PM')
  const gameDay = ref(1)
  const fps = ref(60)
  const playerCount = ref(1)
  const serverName = ref('Local server')

  // ==================== Day/Night Cycle State ====================
  /** 一天中的时间点 (0-1, 0=midnight, 0.5=noon) */
  const timeOfDay = ref(0.25)

  // ========================================
  // Actions
  // ========================================

  function toggleChat() {
    isChatOpen.value = !isChatOpen.value
    // Emit event for GameHud to handle pointer lock
    if (isChatOpen.value) {
      emitter.emit('ui:chat-opened')
    }
    else {
      emitter.emit('ui:chat-closed')
    }
  }

  function closeChat() {
    isChatOpen.value = false
    emitter.emit('ui:chat-closed')
  }

  function sendMessage(text) {
    if (text.trim()) {
      addMessage(text, 'chat') // Type 'chat' for user messages
    }
    closeChat()
  }

  /**
   * 时段定义（基于 timeOfDay 0-1，共 7 个时段）
   *
   * 时间段范围（timeOfDay 0-1）：
   * 1. midnight（午夜）: 0.00 - 0.22 和 0.85 - 1.00
   * 2. sunrise（日出）: 0.22 - 0.28
   * 3. morning（早晨）: 0.28 - 0.40
   * 4. noon（正午）: 0.40 - 0.55
   * 5. afternoon（下午）: 0.55 - 0.70
   * 6. sunset（日落）: 0.70 - 0.78
   * 7. dusk（黄昏）: 0.78 - 0.85
   *
   * 转换为24小时制：
   * - midnight: 00:00 - 05:15 和 20:20 - 24:00
   * - sunrise: 05:15 - 06:40
   * - morning: 06:40 - 09:40
   * - noon: 09:40 - 13:15
   * - afternoon: 13:15 - 16:45
   * - sunset: 16:45 - 18:45
   * - dusk: 18:45 - 20:20
   */
  const DAY_PHASES = [
    { name: 'midnight', start: 0.00, end: 0.22 },
    { name: 'sunrise', start: 0.22, end: 0.28 },
    { name: 'morning', start: 0.28, end: 0.40 },
    { name: 'noon', start: 0.40, end: 0.55 },
    { name: 'afternoon', start: 0.55, end: 0.70 },
    { name: 'sunset', start: 0.70, end: 0.78 },
    { name: 'dusk', start: 0.78, end: 0.85 },
    { name: 'midnight', start: 0.85, end: 1.00 },
  ]

  /**
   * 获取当前时段名称
   * @returns {string} 时段名称
   */
  function getCurrentPhase() {
    const t = timeOfDay.value
    for (const phase of DAY_PHASES) {
      if (t >= phase.start && t < phase.end) {
        return phase.name
      }
    }
    return 'midnight'
  }

  /**
   * 根据 timeOfDay 更新游戏时间显示
   * @param {number} time - 0-1 的时间值
   */
  function updateGameTime(time) {
    // 更新 timeOfDay
    timeOfDay.value = time

    // 计算小时和分钟 (timeOfDay 0 = 00:00, 0.5 = 12:00, 1 = 24:00)
    const totalMinutes = Math.floor(time * 24 * 60)
    const hours = Math.floor(totalMinutes / 60) % 24
    const minutes = totalMinutes % 60

    // 格式化为 12 小时制
    const period = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 || 12
    gameTime.value = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
  }

  /**
   * 增加游戏天数
   */
  function incrementGameDay() {
    gameDay.value += 1
  }

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
    if (typeof data.fps === 'number') {
      fps.value = data.fps
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
      emitSelectedBlockUpdate()
    }
  }

  /**
   * Cycle hotbar slot (mouse wheel)
   * @param {number} delta - +1 or -1
   */
  function cycleSlot(delta) {
    let newSlot = selectedSlot.value + delta
    if (newSlot < 0)
      newSlot = 8
    if (newSlot > 8)
      newSlot = 0
    selectedSlot.value = newSlot
    // Notify Three.js interaction manager of the new selected block
    emitSelectedBlockUpdate()
  }

  /**
   * Add item to hotbar (prioritize stacking same type)
   * @param {number|{blockId?: number, itemKey?: string, amount?: number, count?: number}} blockIdOrItem
   * @param {number} amount - Amount to add (default: 1)
   * @returns {boolean} - True if successfully added
   */
  function addItemToHotbar(blockIdOrItem, amount = 1) {
    const normalizedItem = normalizeHotbarItemInput(blockIdOrItem, amount)
    if (!normalizedItem) {
      return false
    }

    const stackKey = getHotbarItemStackKey(normalizedItem)
    let remaining = toStackCount(normalizedItem.count ?? amount, 1)

    // 1. Prioritize stacking on existing same-type slots
    for (const slot of hotbarItems.value) {
      if (getHotbarItemStackKey(slot) === stackKey && slot.count < MAX_STACK) {
        const canAdd = Math.min(remaining, MAX_STACK - slot.count)
        slot.count += canAdd
        remaining -= canAdd
        if (remaining <= 0)
          return true
      }
    }
    // 2. Find empty slots for remaining
    for (let i = 0; i < 9; i++) {
      if (!hotbarItems.value[i] && remaining > 0) {
        hotbarItems.value[i] = {
          ...normalizedItem,
          count: Math.min(remaining, MAX_STACK),
        }
        remaining -= MAX_STACK
        if (remaining <= 0)
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

  function getSelectedItemKey() {
    return resolveInventoryItemKey(hotbarItems.value[selectedSlot.value]) || null
  }

  /**
   * Add a chat message
   * @param {string} text
   * @param {'system' | 'chat'} type
   */
  function addMessage(text, type = 'system') {
    chatMessages.value.push({
      id: nextMessageId++,
      type,
      text,
      timestamp: Date.now(),
    })
    // Keep only last 50 messages
    if (chatMessages.value.length > 50) {
      chatMessages.value.shift()
    }
  }

  // ========================================
  // Event Listeners Setup
  // ========================================

  function setupListeners() {
    emitter.on('hud:update', updatePlayerInfo)
    emitter.on('hud:select-slot', selectSlot)
    emitter.on('hud:cycle-slot', cycleSlot)
    emitter.on('hud:add-item', payload => addItemToHotbar(payload, payload?.amount ?? payload?.count ?? 1))

    // Hotbar communication with Three.js interaction manager
    emitter.on('hud:request-selected-block', () => {
      emitSelectedBlockUpdate()
    })
    emitter.on('hud:consume-selected-item', () => {
      consumeSelectedItem()
      // Notify interaction manager of the updated selected block
      emitSelectedBlockUpdate()
    })
  }

  function cleanupListeners() {
    emitter.off('hud:update', updatePlayerInfo)
    emitter.off('hud:select-slot', selectSlot)
    emitter.off('hud:cycle-slot', cycleSlot)
    emitter.off('hud:add-item')
    emitter.off('hud:request-selected-block')
    emitter.off('hud:consume-selected-item')
  }

  // ========================================
  // Return Public API
  // ========================================

  return {
    // Stats
    health,
    maxHealth,
    hunger,
    maxHunger,
    experience,
    level,

    // Hotbar
    selectedSlot,
    hotbarItems,

    // Position & Facing
    position,
    facingAngle,

    // Chat
    chatMessages,
    isChatOpen,

    // Info Panel
    gameTime,
    gameDay,
    fps,
    playerCount,
    serverName,

    // Day/Night Cycle
    timeOfDay,
    getCurrentPhase,
    updateGameTime,
    incrementGameDay,

    // Actions
    updatePlayerInfo,
    selectSlot,
    cycleSlot,
    addMessage,
    toggleChat,
    closeChat,
    sendMessage,
    addItemToHotbar,
    consumeSelectedItem,
    getSelectedBlockId,
    getSelectedItemKey,

    // Lifecycle
    setupListeners,
    cleanupListeners,
  }
})
