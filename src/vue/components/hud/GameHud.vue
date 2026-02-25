<script setup>
import { useHudStore } from '@pinia/hudStore.js'
import { useUiStore } from '@pinia/uiStore.js'
/**
 * GameHud - Main Minecraft Style HUD Container
 * Only visible when screen === 'playing'
 */
import { onMounted, onUnmounted } from 'vue'
import KeyFeedbackPanel from './KeyFeedbackPanel.vue'
import TopInfoBar from './TopInfoBar.vue'

const hud = useHudStore()
const ui = useUiStore()

onMounted(() => {
  hud.setupListeners()
})

onUnmounted(() => {
  hud.cleanupListeners()
})
</script>

<template>
  <!-- HUD always mounted, only hidden when not playing -->
  <div v-show="ui.screen === 'playing'" class="hud-root">
    <!-- Top Info Bar: Compass -->
    <TopInfoBar />

    <!-- Top Right Key Feedback -->
    <div class="hud-top-right-stack">
      <KeyFeedbackPanel />
    </div>
  </div>
</template>
