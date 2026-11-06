<script setup>
import { useUiStore } from '@pinia/uiStore.js'
import emitter from '@three/utils/event/event-bus.js'
import { onMounted, onUnmounted, reactive } from 'vue'

const ui = useUiStore()

const keys = reactive({
  w: false,
  a: false,
  s: false,
  d: false,
  control: false,
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
  cameraMode: 'first-person',
  flyMode: false,
})

function handleInputUpdate(inputKeys) {
  keys.w = inputKeys.forward
  keys.a = inputKeys.left
  keys.s = inputKeys.backward
  keys.d = inputKeys.right
  keys.control = inputKeys.control || false
  keys.shift = inputKeys.shift || false
  keys.space = inputKeys.space || false
  keys.z = inputKeys.z || false
  keys.x = inputKeys.x || false
  keys.c = inputKeys.c || false
  keys.v = inputKeys.v || false
  keys.r = inputKeys.r || false
  keys.y = inputKeys.y || false
}

function handleFlightModeChanged(payload) {
  const wasFlying = keys.flyMode
  keys.flyMode = !!payload?.enabled
  keys.f = keys.flyMode
  // Only announce real toggles, not the initial sync on world load.
  if (keys.flyMode !== wasFlying) {
    emitter.emit('hud:toast', {
      icon: 'F',
      text: keys.flyMode ? '飞行已开启' : '飞行已关闭',
      tone: keys.flyMode ? 'on' : 'off',
    })
  }
}

const PERSPECTIVE_LABELS = {
  'first-person': '第一人称',
  'third-person-back': '第三人称（后）',
  'third-person-front': '第三人称（前）',
}

function handleCameraPerspectiveChanged(payload) {
  const nextMode = payload?.mode || 'first-person'
  const changed = keys.cameraMode !== nextMode
  keys.cameraMode = nextMode
  keys.q = nextMode === 'bird-perspective'
  if (changed && nextMode !== 'bird-perspective') {
    emitter.emit('hud:toast', {
      icon: 'Y',
      text: PERSPECTIVE_LABELS[nextMode] || nextMode,
      tone: 'on',
    })
  }
}

function resetKeys() {
  keys.w = false
  keys.a = false
  keys.s = false
  keys.d = false
  keys.control = false
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
  window.addEventListener('blur', resetKeys)
})

onUnmounted(() => {
  emitter.off('input:update', handleInputUpdate)
  emitter.off('hud:flight-mode-changed', handleFlightModeChanged)
  emitter.off('hud:camera-perspective-changed', handleCameraPerspectiveChanged)
  window.removeEventListener('blur', resetKeys)
})
</script>


<template>
  <div class="key-feedback">
    <!-- Movement cluster -->
    <div class="kf-cell rs-kbd key-cap" style="grid-area: w" :class="{ pressed: keys.w }">
      W
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: a" :class="{ pressed: keys.a }">
      A
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: s" :class="{ pressed: keys.s }">
      S
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: d" :class="{ pressed: keys.d }">
      D
    </div>

    <!-- Modifiers -->
    <div class="kf-cell rs-kbd key-cap wide" style="grid-area: ctrl" :class="{ pressed: keys.control }">
      CTRL
    </div>
    <div class="kf-cell rs-kbd key-cap wide" style="grid-area: shift" :class="{ pressed: keys.shift }">
      SHIFT
    </div>
    <div class="kf-cell rs-kbd key-cap wide" style="grid-area: space" :class="{ pressed: keys.space }">
      SPACE
    </div>

    <div class="kf-divider" aria-hidden="true" />

    <!-- Actions -->
    <div
      class="kf-cell rs-kbd key-cap camera-mode"
      style="grid-area: y"
      :class="{
        'pressed': keys.y,
        'camera-mode-first': keys.cameraMode === 'first-person',
        'camera-mode-back': keys.cameraMode === 'third-person-back',
        'camera-mode-front': keys.cameraMode === 'third-person-front',
      }"
    >
      Y
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: q" :class="{ pressed: keys.q }">
      Q
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: r" :class="{ pressed: keys.r }">
      R
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: f" :class="{ pressed: keys.f, disabled: !ui.controlPermissions.allowFlightToggle }">
      F
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: z" :class="{ pressed: keys.z, disabled: !ui.controlPermissions.allowPerspectiveToggle }">
      Z
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: x" :class="{ pressed: keys.x }">
      X
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: c" :class="{ pressed: keys.c }">
      C
    </div>
    <div class="kf-cell rs-kbd key-cap" style="grid-area: v" :class="{ pressed: keys.v }">
      V
    </div>
  </div>
</template>

<style scoped>
.key-feedback {
  --kf-cell: 22px;
  --kf-gap: 3px;
  display: grid;
  /* A tiny keyboard: movement + modifiers on top, the 4×2 action block below */
  grid-template-columns: repeat(5, var(--kf-cell));
  grid-template-rows: repeat(3, var(--kf-cell)) 1px repeat(2, var(--kf-cell));
  grid-template-areas:
    '.     w     .     ctrl  ctrl'
    'a     s     d     shift shift'
    'space space space space space'
    'div   div   div   div   div'
    '.     y     q     r     f'
    '.     z     x     c     v';
  gap: var(--kf-gap);
  padding: 6px;
  border: 1px solid var(--hud-edge);
  border-radius: var(--rs-radius-lg);
  background: var(--hud-surface);
  pointer-events: none;
}

.kf-divider {
  grid-area: div;
  align-self: center;
  height: 1px;
  background: var(--rs-line);
}

.key-cap {
  min-width: 0;
  width: 100%;
  height: var(--kf-cell);
  padding: 0;
  border-color: rgba(255, 255, 255, 0.14);
  border-bottom-width: 2px;
  border-bottom-color: rgba(0, 0, 0, 0.55);
  border-radius: 2px;
  background: linear-gradient(180deg, var(--rs-bg-4), var(--rs-bg-3));
  color: var(--rs-text-2);
  font: 700 10px/1 var(--rs-font-mono);
  letter-spacing: 0.02em;
  transition: background 0.06s, color 0.06s, border-color 0.06s, box-shadow 0.06s, transform 0.06s;
}

.key-cap.wide {
  font-size: 9px;
  letter-spacing: 0.06em;
}

/* Pressed: the key powers on */
.key-cap.pressed {
  border-color: #ff6a4c;
  border-bottom-color: #7a140c;
  background: linear-gradient(180deg, #ff4a2e, #b81d12);
  color: #fff;
  text-shadow: 0 1px 0 rgba(60, 0, 0, 0.6);
  box-shadow: 0 0 8px rgba(255, 70, 40, 0.7);
  transform: translateY(1px);
}

.key-cap.disabled {
  opacity: 0.32;
}

/* Camera mode: a signal-coloured base strip on the Y key */
.key-cap.camera-mode-first {
  border-bottom-color: var(--rs-emerald);
  color: var(--rs-text);
}

.key-cap.camera-mode-back {
  border-bottom-color: var(--rs-lamp);
  color: var(--rs-text);
}

.key-cap.camera-mode-front {
  border-bottom-color: #6cb8ff;
  color: var(--rs-text);
}

.key-cap.camera-mode.pressed {
  border-bottom-color: #7a140c;
}

@media (prefers-reduced-motion: reduce) {
  .key-cap {
    transition: none;
  }

  .key-cap.pressed {
    transform: none;
  }
}
</style>