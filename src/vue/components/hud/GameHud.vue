<script setup>
import { useHudStore } from '@pinia/hudStore.js'
import { useUiStore } from '@pinia/uiStore.js'
/**
 * GameHud - Main Minecraft Style HUD Container
 * Only visible when screen === 'playing'
 */
import { onMounted, onUnmounted, ref } from 'vue'
import Hotbar from './Hotbar.vue'
import KeyFeedbackPanel from './KeyFeedbackPanel.vue'
import RedstoneReplayPanel from './RedstoneReplayPanel.vue'
import TopInfoBar from './TopInfoBar.vue'

const hud = useHudStore()
const ui = useUiStore()

// Keep the hotbar above the bottom-centered replay panel when that panel is shown.
const hudRoot = ref(null)
const hotbarBottom = ref('22px')
let panelObserver = null
let rootObserver = null
let observedPanel = null

function updateHotbarOffset() {
  const root = hudRoot.value
  const panel = root?.querySelector(':scope > .redstone-replay') || null
  if (panel !== observedPanel) {
    if (observedPanel)
      panelObserver?.unobserve(observedPanel)
    if (panel)
      panelObserver?.observe(panel)
    observedPanel = panel
  }
  if (!panel || !root) {
    hotbarBottom.value = '22px'
    return
  }
  const gap = root.getBoundingClientRect().bottom - panel.getBoundingClientRect().top
  hotbarBottom.value = `${Math.max(22, Math.round(gap + 10))}px`
}

onMounted(() => {
  hud.setupListeners()
  panelObserver = new ResizeObserver(updateHotbarOffset)
  rootObserver = new MutationObserver(updateHotbarOffset)
  rootObserver.observe(hudRoot.value, { childList: true })
  updateHotbarOffset()
})

onUnmounted(() => {
  hud.cleanupListeners()
  panelObserver?.disconnect()
  rootObserver?.disconnect()
})
</script>

<template>
  <!-- HUD always mounted, only hidden when not playing -->
  <div v-show="ui.screen === 'playing'" ref="hudRoot" class="hud-root">
    <!-- Top Info Bar: Compass -->
    <TopInfoBar />

    <!-- Top Right Key Feedback -->
    <div class="hud-top-right-stack">
      <KeyFeedbackPanel />
    </div>

    <RedstoneReplayPanel />

    <!-- Hotbar: only while placing blocks (Q) -->
    <Hotbar v-if="hud.blockEditMode === 'add'" :style="{ '--hotbar-bottom': hotbarBottom }" />
  </div>
</template>
