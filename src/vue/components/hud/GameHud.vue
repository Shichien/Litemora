<script setup>
import { useHudStore } from '@pinia/hudStore.js'
import { useUiStore } from '@pinia/uiStore.js'
/**
 * GameHud - Main Minecraft Style HUD Container
 * Only visible when screen === 'playing'
 */
import RedstoneCredits from '@ui-components/redstone/RedstoneCredits.vue'
import { onMounted, onUnmounted, ref } from 'vue'
import Hotbar from './Hotbar.vue'
import KeyFeedbackPanel from './KeyFeedbackPanel.vue'
import MinecraftLightStatus from './MinecraftLightStatus.vue'
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

    <MinecraftLightStatus />
    <RedstoneReplayPanel />

    <!-- Hotbar: only while placing blocks (Q) -->
    <Hotbar v-if="hud.blockEditMode === 'add'" :style="{ '--hotbar-bottom': hotbarBottom }" />

    <!-- Bottom-left attribution: the in-world view has no scrollable footer. -->
    <div class="hud-credits">
      <RedstoneCredits variant="inline" />
    </div>
  </div>
</template>

<style scoped>
/* Corner slot beside the centred replay panel; the HUD root ignores pointer events,
   so the link opts back in. */
.hud-credits {
  position: absolute;
  left: var(--hud-side);
  bottom: 16px;
  max-width: calc((100vw - 720px) / 2 - 24px);
  padding: 4px 8px;
  border: 1px solid var(--hud-edge);
  border-radius: var(--rs-radius);
  background: var(--hud-surface);
  pointer-events: auto;
}

.hud-credits :deep(.redstone-credits) {
  color: var(--rs-text-2);
  font-size: 11px;
  line-height: 1.5;
  text-shadow: var(--hud-text-shadow);
}

.hud-credits :deep(.redstone-credits__dot) {
  width: 4px;
  height: 4px;
  margin-right: 3px;
}

/* Below ~820px the replay panel / hotbar reach the edges; the corner has no room left. */
@media (max-width: 820px) {
  .hud-credits {
    display: none;
  }
}
</style>
