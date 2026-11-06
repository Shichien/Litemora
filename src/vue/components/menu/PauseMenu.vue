<script setup>
/**
 * PauseMenu - ESC menu when game is paused
 */
import { useUiStore } from '@pinia/uiStore.js'
import { useHudStore } from '@pinia/hudStore.js'
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
  <div ref="menuEl" class="pause-menu mc-panel" role="dialog" aria-labelledby="pause-menu-title">
    <header class="mc-panel__head">
      <div class="mc-panel__heading">
        <span class="mc-panel__eyebrow" aria-hidden="true">Paused</span>
        <h2 id="pause-menu-title" class="menu-title mc-panel__title">
          {{ $t('menu.paused') }}
        </h2>
      </div>
      <RedstoneTorch :size="32" class="pause-torch" />
    </header>

    <div class="mc-menu mc-panel__body">
      <button class="mc-button mc-button--primary" @click="ui.toPlaying()">
        <span class="title">{{ $t('menu.resume') }}</span>
        <kbd class="rs-kbd">Esc</kbd>
      </button>
      <button v-if="ui.pauseMenuConfig.showSettings" class="mc-button" @click="ui.toSettings()">
        <span class="title">{{ $t('menu.settings') }}</span>
      </button>
      <button v-if="ui.pauseMenuConfig.showSkins" class="mc-button" @click="ui.toSkinSelector()">
        <span class="title">{{ $t('menu.skins') }}</span>
      </button>
      <button class="mc-button" @click="copyPositionLink">
        <span class="title">{{ copied ? '已复制链接' : '复制当前位置链接' }}</span>
        <kbd class="rs-kbd">{{ positionLabel }}</kbd>
      </button>
      <div class="pause-divider" aria-hidden="true" />
      <button class="mc-button mc-button--ghost" @click="exitWorld">
        <span class="title">{{ $t('menu.exitWorld') }}</span>
      </button>
    </div>

    <p class="pause-hint" aria-hidden="true">
      <kbd class="rs-kbd">Tab</kbd>
      <span>切换选项</span>
    </p>
  </div>
</template>

<style scoped>
.pause-menu {
  width: min(360px, calc(100vw - 32px));
}

.pause-torch {
  margin-bottom: -2px;
}

.pause-divider {
  height: 1px;
  margin: 6px 0;
  background: var(--rs-line);
}

.pause-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 0;
  color: var(--rs-text-3);
  font: 400 11px/1 var(--rs-font-body);
}

/* Focus is the menu's "selected" state: a lit redstone edge. */
.mc-button:focus-visible {
  outline: none;
  border-color: var(--rs-red-hot);
  box-shadow: inset 0 0 0 1px rgba(255, 90, 60, 0.5), 0 0 12px rgba(255, 70, 40, 0.25);
}
</style>
