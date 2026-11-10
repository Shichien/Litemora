<script setup>
import emitter from '@three/utils/event/event-bus.js'
import { onMounted, onUnmounted, ref } from 'vue'

const status = ref(null)
function updateStatus(value) {
  status.value = value
}
onMounted(() => {
  emitter.on('minecraft-light:status', updateStatus)
  const current = window.Experience?.world?.minecraftSchematicRenderLayer?._runtimeBridge?.lightRuntime?.status
  if (current)
    updateStatus(current)
})
onUnmounted(() => emitter.off('minecraft-light:status', updateStatus))
</script>

<template>
  <div v-if="status?.state === 'limited' || status?.state === 'error'" class="light-status" role="status">
    {{ status.message || '完整光照暂不可用，当前显示基础光照。' }}
  </div>
</template>

<style scoped>
.light-status {
  position: absolute;
  left: var(--hud-side, 16px);
  top: 76px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 12px;
  color: #f5ddb5;
  background: rgba(25, 22, 18, 0.88);
  border: 1px solid #866845;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.5;
}
</style>
