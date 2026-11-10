<script setup>
import { useHudStore } from '@pinia/hudStore.js'
/**
 * PauseMenu - ESC menu when game is paused
 */
import { useUiStore } from '@pinia/uiStore.js'
import emitter from '@three/utils/event/event-bus.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildPositionShareUrl } from '@three/utils/share-position.js'
import { buildSpaceWorldsUrl, getActiveSpaceName } from '@three/utils/space-context.js'
import RedstoneTorch from '@ui-components/redstone/RedstoneTorch.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'

const ui = useUiStore()
const hud = useHudStore()

const menuEl = ref(null)
const copied = ref(false)
let copiedTimer = 0

const positionLabel = computed(() => {
  const round = value => Math.round(Number(value) || 0)
  return `${round(hud.position.x)} ${round(hud.position.y)} ${round(hud.position.z)}`
})

function toast(text) {
  emitter.emit('hud:toast', { text })
}

async function copyPositionLink() {
  const position = { x: hud.position.x, y: hud.position.y, z: hud.position.z }
  const url = buildPositionShareUrl(position)

  try {
    await navigator.clipboard.writeText(url)
  }
  catch {
    // Clipboard needs a secure context and permission; fall back to a prompt-free select.
    const field = document.createElement('textarea')
    field.value = url
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand?.('copy')
    field.remove()
    if (!ok) {
      toast('复制失败，请手动复制地址栏')
      return
    }
  }

  copied.value = true
  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copied.value = false
  }, 1600)
  toast('已复制当前位置链接')
}

function menuButtons() {
  const root = menuEl.value
  if (!root) {
    return []
  }
  return [...root.querySelectorAll('button:not([disabled])')]
}

// Tab cycles the menu buttons and Enter/Space activates the focused one,
// so the whole pause menu is usable without the mouse.
function handleKeydown(event) {
  const forwardKeys = ['Tab', 'ArrowDown', 'ArrowRight']
  const backKeys = ['ArrowUp', 'ArrowLeft']
  const isForward = forwardKeys.includes(event.key)
  const isBack = backKeys.includes(event.key)
  if (!isForward && !isBack) {
    return
  }

  const buttons = menuButtons()
  if (!buttons.length) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const currentIndex = buttons.indexOf(document.activeElement)
  const step = isBack || event.shiftKey ? -1 : 1
  const nextIndex = currentIndex === -1
    ? (step > 0 ? 0 : buttons.length - 1)
    : (currentIndex + step + buttons.length) % buttons.length
  buttons[nextIndex].focus()
}

function handleFocusIn(event) {
  // Keep focus inside the menu: ignore stray focuses from the game canvas.
  const root = menuEl.value
  if (root && !root.contains(event.target)) {
    menuButtons()[0]?.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true)
  document.addEventListener('focusin', handleFocusIn)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('focusin', handleFocusIn)
})

function exitWorld() {
  const activeSpaceName = getActiveSpaceName()
  if (!activeSpaceName) {
    return
  }

  ui.toPlaying({ requestPointerLock: false })
  navigateToUrl(buildSpaceWorldsUrl(activeSpaceName))
}
</script>

<template>
  <div ref="menuEl" class="pause-menu rs-panel rs-panel--glass rs-panel--wired is-powered" role="dialog" aria-labelledby="pause-menu-title">
    <header class="rs-panel__head">
      <div class="rs-panel__heading">
        <span class="rs-eyebrow" aria-hidden="true">Paused</span>
        <h2 id="pause-menu-title" class="rs-panel__title">
          {{ $t('menu.paused') }}
        </h2>
      </div>
      <RedstoneTorch :size="32" class="pause-torch" />
    </header>

    <div class="rs-panel__body rs-panel__stack">
      <button class="rs-btn rs-btn--primary rs-btn--dot rs-btn--block" @click="ui.toPlaying()">
        <span class="title">{{ $t('menu.resume') }}</span>
        <kbd class="rs-kbd">Esc</kbd>
      </button>
      <button v-if="ui.pauseMenuConfig.showSettings" class="rs-btn rs-btn--dot rs-btn--block" @click="ui.toSettings()">
        <span class="title">{{ $t('menu.settings') }}</span>
      </button>
      <button v-if="ui.pauseMenuConfig.showSkins" class="rs-btn rs-btn--dot rs-btn--block" @click="ui.toSkinSelector()">
        <span class="title">{{ $t('menu.skins') }}</span>
      </button>
      <button class="rs-btn rs-btn--dot rs-btn--block" @click="copyPositionLink">
        <span class="title">{{ copied ? '已复制链接' : '复制当前位置链接' }}</span>
        <kbd class="rs-kbd">{{ positionLabel }}</kbd>
      </button>
      <div class="pause-divider" aria-hidden="true" />
      <button class="rs-btn rs-btn--ghost rs-btn--dot rs-btn--block rs-muted" @click="exitWorld">
        <span class="title">{{ $t('menu.exitWorld') }}</span>
      </button>
    </div>

    <p class="pause-hint rs-faint" aria-hidden="true">
      <kbd class="rs-kbd">Tab</kbd>
      <span>切换选项</span>
    </p>
  </div>
</template>

<style scoped>
/* rs-panel + rs-panel--glass give the surface + blur, rs-panel--wired.is-powered the lit strip.
   Scoped rules compile to `.pause-menu[data-v-…]`, so they outrank the global .rs-panel rules. */
.pause-menu {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 72px - 16px);
  /* rs-panel--glass drops the deepslate tiles the in-game panels sit on; keep them under the glass. */
  background:
    linear-gradient(rgba(14, 16, 19, 0.84), rgba(14, 16, 19, 0.9)),
    var(--rs-tex-deepslate-tiles) 0 0 / 64px 64px;
  image-rendering: pixelated;
  /* rs-panel's edge is --rs-line; over a bright world the panel needs the stronger edge. */
  border-color: var(--rs-line-strong);
  /* rs-panel's --rs-shadow is a small elevation; a menu floating over the 3D scene needs a deeper one. */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}

/* Panel chrome (head/heading/title/body/stack) comes from the .rs-panel__* primitives. */

/* rs-btn is 40px/14px/gap 10px; the in-game menu rows keep their 44px slab, 15px and 12px gap. */
.pause-menu .rs-btn {
  --rs-btn-h: 44px;
  gap: 12px;
  font-size: 15px;
}

/* rs-btn centres its label; the menu rows keep the left-aligned title + trailing kbd. */
.pause-menu .rs-btn .title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.pause-menu .rs-btn .rs-kbd {
  flex: none;
}

/* rs-btn--dot's dot is redstone-off, which disappears on the redstone-block fill;
   the primary row needs the lit dot the old primary button gave it.
   `.rs-btn.rs-btn--primary` outranks the global `.rs-btn--dot:hover::before` rule. */
.pause-menu .rs-btn.rs-btn--primary::before {
  background: #ffd0c0;
  box-shadow: 0 0 6px rgba(255, 200, 180, 0.9);
}

.pause-menu .rs-btn.rs-btn--primary:hover::before,
.pause-menu .rs-btn.rs-btn--primary:focus-visible::before {
  background: #fff;
}

.pause-torch {
  margin-bottom: -2px;
}

.pause-divider {
  height: 1px;
  margin: 6px 0;
  background: var(--rs-line);
}

/* Colour comes from .rs-faint. */
.pause-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 0;
  font: 400 11px/1 var(--rs-font-body);
}

/* Focus is the menu's "selected" state: a lit redstone edge. */
.pause-menu .rs-btn:focus-visible {
  outline: none;
  border-color: var(--rs-red-hot);
  box-shadow: inset 0 0 0 1px rgba(255, 90, 60, 0.5), 0 0 12px rgba(255, 70, 40, 0.25);
}

@media (max-height: 720px) {
  .rs-panel__head {
    padding: 16px 24px 12px;
  }

  .rs-panel__body {
    padding: 14px 24px;
  }
}

/* rs-btn always animates; the menu buttons used to go still under reduced motion. */
@media (prefers-reduced-motion: reduce) {
  .pause-menu .rs-btn {
    transition: none;
  }
}
</style>
