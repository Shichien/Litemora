<script setup>
import emitter from '@three/utils/event/event-bus.js'
import { onMounted, onUnmounted, reactive } from 'vue'

const keys = reactive({
  w: false,
  a: false,
  s: false,
  d: false,
  shift: false,
  space: false,
  z: false,
  x: false,
  c: false,
  v: false,
  q: false,
  r: false,
  f: false,
  y: false,
  flyMode: false,
})

function handleInputUpdate(inputKeys) {
  keys.w = inputKeys.forward
  keys.a = inputKeys.left
  keys.s = inputKeys.backward
  keys.d = inputKeys.right
  keys.shift = inputKeys.shift || false
  keys.space = inputKeys.space || false
  keys.z = inputKeys.z || false
  keys.x = inputKeys.x || false
  keys.c = inputKeys.c || false
  keys.v = inputKeys.v || false
  keys.r = inputKeys.r || false
}

function handleFlightModeChanged(payload) {
  keys.flyMode = !!payload?.enabled
  keys.f = keys.flyMode
}

function handleCameraPerspectiveChanged(payload) {
  keys.y = !!payload?.firstPerson
  keys.q = payload?.mode === 'bird-perspective'
}

function resetKeys() {
  keys.w = false
  keys.a = false
  keys.s = false
  keys.d = false
  keys.shift = false
  keys.space = false
  keys.z = false
  keys.x = false
  keys.c = false
  keys.v = false
  keys.r = false
}

onMounted(() => {
  emitter.on('input:update', handleInputUpdate)
  emitter.on('hud:flight-mode-changed', handleFlightModeChanged)
  emitter.on('hud:camera-perspective-changed', handleCameraPerspectiveChanged)
  emitter.on('ui:chat-opened', resetKeys)
  window.addEventListener('blur', resetKeys)
})

onUnmounted(() => {
  emitter.off('input:update', handleInputUpdate)
  emitter.off('hud:flight-mode-changed', handleFlightModeChanged)
  emitter.off('hud:camera-perspective-changed', handleCameraPerspectiveChanged)
  emitter.off('ui:chat-opened', resetKeys)
  window.removeEventListener('blur', resetKeys)
})
</script>

<template>
  <div class="key-feedback mc-text">
    <div class="movement-layout">
      <div class="movement-left">
        <div class="key-row key-row-center">
          <div class="key-cap" :class="{ pressed: keys.w }">
            W
          </div>
        </div>
        <div class="key-row">
          <div class="key-cap" :class="{ pressed: keys.a }">
            A
          </div>
          <div class="key-cap" :class="{ pressed: keys.s }">
            S
          </div>
          <div class="key-cap" :class="{ pressed: keys.d }">
            D
          </div>
        </div>
      </div>

      <div class="movement-right">
        <div class="key-cap wide" :class="{ pressed: keys.shift }">
          SHIFT
        </div>
        <div class="key-cap wide" :class="{ pressed: keys.space }">
          SPACE
        </div>
      </div>
    </div>

    <div class="lower-rows">
      <div class="key-row key-row-right">
        <div class="key-cap" :class="{ pressed: keys.y }">
          Y
        </div>
        <div class="key-cap" :class="{ pressed: keys.q }">
          Q
        </div>
        <div class="key-cap" :class="{ pressed: keys.r }">
          R
        </div>
        <div class="key-cap" :class="{ pressed: keys.f }">
          F
        </div>
      </div>

      <div class="key-row key-row-right">
        <div class="key-cap" :class="{ pressed: keys.z }">
          Z
        </div>
        <div class="key-cap" :class="{ pressed: keys.x }">
          X
        </div>
        <div class="key-cap" :class="{ pressed: keys.c }">
          C
        </div>
        <div class="key-cap" :class="{ pressed: keys.v }">
          V
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.key-feedback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: calc(2px * var(--hud-scale));
  padding-top: calc(4px * var(--hud-scale));
  pointer-events: none;
  transform: scale(0.6);
  transform-origin: top right;
}

.movement-layout {
  display: flex;
  align-items: flex-start;
  gap: calc(6px * var(--hud-scale));
}

.movement-left,
.movement-right {
  display: flex;
  flex-direction: column;
  gap: calc(2px * var(--hud-scale));
}

.key-row {
  display: flex;
  gap: calc(2px * var(--hud-scale));
}

.key-row-center {
  justify-content: center;
}

.key-row-right {
  justify-content: flex-end;
}

.lower-rows {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: calc(2px * var(--hud-scale));
}

.key-cap {
  width: calc(16px * var(--hud-scale));
  height: calc(16px * var(--hud-scale));
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  border: calc(1px * var(--hud-scale)) solid rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  font-size: calc(8px * var(--hud-scale));
  text-shadow: 1px 1px 0 #3f3f3f;
  transition: all 0.05s ease;
  border-radius: calc(1px * var(--hud-scale));
}

.key-cap.wide {
  width: calc(40px * var(--hud-scale));
}

.key-cap.pressed {
  background: rgba(255, 255, 255, 0.8);
  color: #000;
  text-shadow: none;
  transform: translateY(calc(1px * var(--hud-scale)));
  border-color: #fff;
}
</style>
