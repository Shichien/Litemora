<script setup>
import Experience from '@three/experience.js'
import AdminConfigPage from '@ui-components/admin/AdminConfigPage.vue'
import Crosshair from '@ui-components/Crosshair.vue'
import EventMonitorPanel from '@ui-components/debug/EventMonitorPanel.vue'
import GameHud from '@ui-components/hud/GameHud.vue'
import UiRoot from '@ui-components/menu/UiRoot.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'

const threeCanvas = ref(null)
const isAdminMode = ref(window.location.hash === '#admin')
let experience = null

function createExperienceIfNeeded() {
  if (!experience && threeCanvas.value) {
    experience = new Experience(threeCanvas.value)
  }
}

function destroyExperienceIfNeeded() {
  if (experience) {
    experience.destroy()
    experience = null
  }
}

function handleHashChange() {
  const nextAdminMode = window.location.hash === '#admin'
  if (nextAdminMode === isAdminMode.value) {
    return
  }

  isAdminMode.value = nextAdminMode
}

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)
  createExperienceIfNeeded()
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', handleHashChange)
  destroyExperienceIfNeeded()
})

// 检查是否为 debug 模式
const isDebugMode = window.location.hash === '#debug'
</script>

<template>
  <!-- 主容器：相对定位 -->
  <div class="relative w-screen h-screen overflow-hidden">
    <!-- Three.js Canvas -->
    <canvas ref="threeCanvas" class="three-canvas absolute inset-0 z-0" />

    <!-- Overlay System (Loading/Pause/Settings) -->
    <UiRoot />

    <!-- Minecraft Style HUD (只在 playing 时显示) -->
    <GameHud />

    <!-- 准星（仅在 Pointer Lock 激活时显示） -->
    <Crosshair />

    <!-- Debug 模式：浮动 Event Monitor 面板 -->
    <EventMonitorPanel v-if="isDebugMode" class="event-monitor-overlay overflow-visible" />

    <!-- Admin 覆盖层：不销毁游戏实例，确保进度保留 -->
    <AdminConfigPage v-if="isAdminMode" class="admin-overlay" />
  </div>
</template>

<style scoped>
.three-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

/* Event Monitor 浮动面板样式 */
.event-monitor-overlay {
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  z-index: 100;
}

.admin-overlay {
  position: absolute;
  inset: 0;
  z-index: 300;
}
</style>
