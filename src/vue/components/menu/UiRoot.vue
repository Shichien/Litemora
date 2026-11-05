<script setup>
import { useSettingsStore } from '@pinia/settingsStore.js'
import { useUiStore } from '@pinia/uiStore.js'
import emitter from '@three/utils/event/event-bus.js'
/**
 * UiRoot - Menu System Root Component
 * Manages screen transitions and overlay rendering
 */
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingScreen from './LoadingScreen.vue'
import PauseMenu from './PauseMenu.vue'
import SettingsMenu from './SettingsMenu.vue'
import SkinSelector from './SkinSelector.vue'

const ui = useUiStore()
const settings = useSettingsStore()
const { locale } = useI18n()

function syncReadyStateFromRuntime() {
  if (ui.screen !== 'loading') {
    return
  }

  // UiRoot loads asynchronously; an error may have fired before it mounted.
  const earlyError = window.Experience?.bootstrapError
  if (earlyError) {
    ui.setLoadError(earlyError)
  }

  if (window.Experience?.world?.isSceneReady) {
    handleSceneReady()
  }
}

// Transition from loading only after the scene is actually playable.
onMounted(() => {
  emitter.on('world:scene-ready', handleSceneReady)
  emitter.on('projection:bootstrap-error', handleBootstrapError)
  emitter.on('ui:escape', handleEscape)
  window.addEventListener('blur', handleWindowBlur)
  syncReadyStateFromRuntime()
})

onUnmounted(() => {
  emitter.off('world:scene-ready', handleSceneReady)
  emitter.off('projection:bootstrap-error', handleBootstrapError)
  emitter.off('ui:escape', handleEscape)
  window.removeEventListener('blur', handleWindowBlur)
})

function handleBootstrapError(payload) {
  if (ui.screen === 'loading') {
    ui.setLoadError(payload)
  }
}

function handleSceneReady() {
  // A new Experience has fresh listeners; give it the user's current settings.
  settings.emitAllSettings()
  if (ui.loadError) {
    // Keep the error visible; the loading screen offers "continue anyway".
    ui.markLoadErrorSceneReady()
    return
  }
  ui.bootstrapBackendWorld()
}

function handleEscape() {
  ui.handleEscape()
}

function handleWindowBlur() {
  // 在 debugMode 下禁用 blur 处理
  const isDebugMode = window.location.hash === '#debug'
  if (isDebugMode) {
    return
  }

  if (ui.screen === 'playing') {
    ui.toPauseMenu()
  }
}
</script>

<template>
  <!-- Menu Overlay Container -->
  <Transition name="fade">
    <div
      v-if="ui.isMenuVisible"
      class="menu-overlay"
      :class="{
        loading: ui.screen === 'loading',
        dark: ui.screen !== 'loading',
        [`lang-${locale}`]: true,
      }"
    >
      <!-- Loading Screen -->
      <LoadingScreen v-if="ui.screen === 'loading'" />

      <!-- Pause Menu -->
      <template v-else-if="ui.screen === 'pauseMenu'">
        <SkinSelector v-if="ui.overlayView === 'skinSelector'" />
        <PauseMenu v-else />
      </template>

      <!-- Settings Menu -->
      <SettingsMenu v-else-if="ui.screen === 'settings'" />
    </div>
  </Transition>
</template>

<style scoped>
/* Fade transition for menu overlay */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
