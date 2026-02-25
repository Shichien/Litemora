import emitter from '@three/utils/event/event-bus.js'
/**
 * UI Store - Menu System State Machine
 * Manages screen states, menu views, and world state
 */
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

// ========================================
// UI Store Definition
// ========================================
export const useUiStore = defineStore('ui', () => {
  // ----------------------------------------
  // State
  // ----------------------------------------

  /** Current screen: 'loading' | 'playing' | 'pauseMenu' | 'settings' */
  const screen = ref('loading')

  /** Overlay sub-view for pause flow: 'root' | 'skinSelector' */
  const mainMenuView = ref('root')

  /** Where to return after settings: 'pauseMenu' | null */
  const returnTo = ref(null)

  /** Whether the game is paused */
  const isPaused = ref(false)

  /** Pause menu visibility options from backend */
  const pauseMenuConfig = reactive({
    showSettings: true,
    showSkins: true,
  })

  // ----------------------------------------
  // Computed
  // ----------------------------------------

  /** Check if current screen shows a menu overlay */
  const isMenuVisible = computed(() => {
    return ['loading', 'pauseMenu', 'settings'].includes(screen.value)
  })

  // ----------------------------------------
  // Actions: Screen Navigation
  // ----------------------------------------

  /**
   * Navigate to Playing state
   */
  function toPlaying({ requestPointerLock = true } = {}) {
    screen.value = 'playing'
    isPaused.value = false
    emitter.emit('ui:pause-changed', false)
    if (requestPointerLock) {
      emitter.emit('game:request_pointer_lock')
    }
  }

  /**
   * Navigate to Pause Menu
   */
  function toPauseMenu() {
    screen.value = 'pauseMenu'
    isPaused.value = true
    emitter.emit('ui:pause-changed', true)
  }

  /**
   * Navigate to Settings
   * @param {'pauseMenu'} from - Where to return after settings
   */
  function toSettings(from) {
    returnTo.value = from
    screen.value = 'settings'
  }

  /**
   * Return from Settings to previous screen
   */
  function exitSettings() {
    screen.value = 'pauseMenu'
    returnTo.value = null
  }

  // ----------------------------------------
  // Actions: Overlay Views
  // ----------------------------------------

  /**
   * Enter Skin Selector view
   */
  function toSkinSelector() {
    mainMenuView.value = 'skinSelector'
  }

  /**
   * Exit Skin Selector back to previous view
   */
  function exitSkinSelector() {
    mainMenuView.value = 'root'
  }

  /**
   * Bootstrap world directly from backend config flow
   */
  function bootstrapBackendWorld() {
    toPlaying({ requestPointerLock: false })
  }

  /**
   * Apply backend-controlled pause menu visibility options
   * @param {{pauseMenu?: {showSettings?: boolean, showSkins?: boolean}}} uiConfig
   */
  function applyBackendUiConfig(uiConfig = {}) {
    const pauseMenu = uiConfig.pauseMenu || {}
    if (pauseMenu.showSettings !== undefined)
      pauseMenuConfig.showSettings = pauseMenu.showSettings
    if (pauseMenu.showSkins !== undefined)
      pauseMenuConfig.showSkins = pauseMenu.showSkins
  }

  // ----------------------------------------
  // Actions: Handle ESC key
  // ----------------------------------------

  /**
   * Handle ESC key press based on current screen
   */
  function handleEscape() {
    switch (screen.value) {
      case 'settings':
        exitSettings()
        break
      case 'pauseMenu':
        toPlaying()
        break
      case 'playing':
        toPauseMenu()
        break
      // 'loading' - ignore ESC
    }
  }

  // ----------------------------------------
  // Return Public API
  // ----------------------------------------
  return {
    // State
    screen,
    mainMenuView,
    returnTo,
    isPaused,
    pauseMenuConfig,

    // Computed
    isMenuVisible,

    // Navigation
    toPlaying,
    toPauseMenu,
    toSettings,
    exitSettings,

    // Overlay
    toSkinSelector,
    exitSkinSelector,

    // World
    bootstrapBackendWorld,
    applyBackendUiConfig,

    // ESC
    handleEscape,
  }
})
