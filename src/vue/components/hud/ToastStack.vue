<script setup>
import emitter from '@three/utils/event/event-bus.js'
/**
 * ToastStack - short-lived action feedback above the hotbar.
 * Emit `hud:toast` with { text, icon?, tone? } to show one.
 */
import { onMounted, onUnmounted, ref } from 'vue'

const MAX_TOASTS = 3
const LIFETIME_MS = 1600

const toasts = ref([])
let nextId = 1
const timers = new Set()

function handleToast(payload = {}) {
  const text = String(payload.text || '').trim()
  if (!text) {
    return
  }

  const id = nextId++
  toasts.value = [
    ...toasts.value.slice(-(MAX_TOASTS - 1)),
    {
      id,
      text,
      icon: String(payload.icon || ''),
      tone: payload.tone === 'off' ? 'off' : 'on',
    },
  ]

  const timer = window.setTimeout(() => {
    timers.delete(timer)
    toasts.value = toasts.value.filter(toast => toast.id !== id)
  }, LIFETIME_MS)
  timers.add(timer)
}

onMounted(() => {
  emitter.on('hud:toast', handleToast)
})

onUnmounted(() => {
  emitter.off('hud:toast', handleToast)
  for (const timer of timers) {
    window.clearTimeout(timer)
  }
  timers.clear()
})
</script>

<template>
  <TransitionGroup name="toast" tag="div" class="toast-stack" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="hud-toast"
      :class="[`is-${toast.tone}`]"
    >
      <kbd v-if="toast.icon" class="rs-kbd toast-icon">{{ toast.icon }}</kbd>
      <span class="toast-text">{{ toast.text }}</span>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toast-stack {
  position: absolute;
  left: 50%;
  bottom: 96px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transform: translateX(-50%);
  pointer-events: none;
}

.hud-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--rs-radius);
  background-color: var(--rs-bg-1);
  background-image:
    linear-gradient(rgba(17, 19, 23, 0.92), rgba(12, 14, 17, 0.96)),
    var(--rs-tex-polished-deepslate);
  background-size: auto, 48px 48px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  color: var(--rs-text);
  font: 500 13px/1.3 var(--rs-font-body);
  white-space: nowrap;
}

/* Enabled reads as a powered wire; disabled as dark dust. */
.hud-toast.is-on {
  border-color: rgba(255, 90, 60, 0.5);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 70, 40, 0.18);
}

.hud-toast.is-off {
  color: var(--rs-text-2);
}

.toast-icon {
  color: var(--rs-text);
}

.hud-toast.is-off .toast-icon {
  color: var(--rs-text-3);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
