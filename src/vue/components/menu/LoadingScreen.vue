<script setup>
import { useUiStore } from '@pinia/uiStore.js'
import emitter from '@three/utils/event/event-bus.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceWorldsUrl, getActiveSpaceName } from '@three/utils/space-context.js'
/**
 * LoadingScreen - Initial loading screen
 * Shows loading progress, or the load error with retry/back actions
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const ui = useUiStore()
const { t, te } = useI18n()

const progress = ref(0)
const loadingText = ref('Loading...')

const errorMessage = computed(() => {
  const code = ui.loadError?.code
  if (!code)
    return ''
  return te(`loadError.${code}`) ? t(`loadError.${code}`) : t('loadError.generic')
})

// Listen for loading progress events
onMounted(() => {
  emitter.on('core:loading-progress', handleProgress)
})

onUnmounted(() => {
  emitter.off('core:loading-progress', handleProgress)
})

// The static boot overlay (index.html) only fades out on core:ready; an early
// failure would leave it covering the error, so hide it as soon as one is shown.
watch(() => ui.loadError, (error) => {
  const bootScreen = error && document.getElementById('loading-screen')
  if (bootScreen) {
    bootScreen.style.display = 'none'
  }
}, { immediate: true })

function handleProgress({ loaded, total }) {
  progress.value = Math.round((loaded / total) * 100)
  loadingText.value = `Loading... ${progress.value}%`
}

function retry() {
  window.location.reload()
}

function backToWorlds() {
  const spaceName = ui.loadError?.spaceName || getActiveSpaceName()
  navigateToUrl(spaceName ? buildSpaceWorldsUrl(spaceName) : '/')
}
</script>

<template>
  <div class="loading-screen">
    <div v-if="ui.loadError" class="load-error" role="alert">
      <h2 class="load-error-title">
        {{ t('loadError.title') }}
      </h2>
      <p class="load-error-message">
        {{ errorMessage }}
      </p>
      <p class="load-error-code">
        {{ ui.loadError.code }}
      </p>
      <div class="load-error-actions">
        <button class="mc-button" @click="retry">
          <span class="title">{{ t('loadError.retry') }}</span>
        </button>
        <button class="mc-button" @click="backToWorlds">
          <span class="title">{{ t('loadError.back') }}</span>
        </button>
        <button v-if="ui.loadError.sceneReady" class="mc-button" @click="ui.continueDespiteLoadError()">
          <span class="title">{{ t('loadError.continue') }}</span>
        </button>
      </div>
    </div>

    <!-- Loading bar container -->
    <div v-else class="loading-bar-container">
      <div class="loading-bar-bg">
        <div
          class="loading-bar-fill"
          :style="{ width: `${progress}%` }"
        />
      </div>
      <p class="loading-text">
        {{ loadingText }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.loading-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.loading-bar-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.loading-bar-bg {
  width: 300px;
  height: 8px;
  background: #222;
  border: 2px solid #555;
}

.loading-bar-fill {
  height: 100%;
  background: linear-gradient(to right, #3a3, #5c5);
  transition: width 0.2s ease;
}

.loading-text {
  color: #aaa;
  font-size: 14px;
  text-shadow: 2px 2px #000;
}

.load-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: min(520px, calc(100vw - 32px));
  text-align: center;
  pointer-events: auto;
}

.load-error-title {
  color: #ff8a73;
  font-size: 22px;
  text-shadow: 2px 2px #000;
}

.load-error-message {
  color: #ddd;
  font-size: 15px;
  text-shadow: 2px 2px #000;
}

.load-error-code {
  color: #777;
  font-size: 12px;
  font-family: monospace;
}

.load-error-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 8px;
}
</style>
