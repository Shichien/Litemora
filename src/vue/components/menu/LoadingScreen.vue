<script setup>
import { useUiStore } from '@pinia/uiStore.js'
import { loadAdminAuthSession } from '@three/auth/admin-auth.js'
import { fetchGalleryItem } from '@three/gallery/gallery-api.js'
import emitter from '@three/utils/event/event-bus.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceWorldsUrl, getActiveProjectionId, getActiveSpaceName } from '@three/utils/space-context.js'
/**
 * LoadingScreen - Initial loading screen
 * Shows loading progress, or the load error with retry/back actions.
 * Layout and look come from the shared .ls-* classes in public/loading-screen.css, the same ones the
 * static boot screen in index.html uses, so the hand-off between the two is seamless.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const ui = useUiStore()
const { t, te } = useI18n()

// UiRoot mounts asynchronously, after the resources may already have started loading.
const progress = ref(Math.round((window.Experience?.resources?.loadProgress ?? 0) * 100))
const worldTitle = ref('')

const isDone = computed(() => progress.value >= 100)
const loadingText = computed(() => (isDone.value ? t('loading.building') : t('loading.resources')))

// The lamp at the end of the dust is a button: poking it powers the circuit early.
const lampPowered = ref(false)
const lampNudges = ref(0)
const lampLit = computed(() => isDone.value || lampPowered.value)

function pokeLamp() {
  lampPowered.value = !lampPowered.value
  lampNudges.value += 1
}

const lampLabel = computed(() => (lampLit.value ? '红石灯已点亮，再点一下熄灭' : '点一下红石灯'))
// A few pokes in a row earn a remark; it is purely cosmetic.
const lampRemark = computed(() => {
  if (lampNudges.value >= 12) {
    return '这盏灯比世界加载还慢。'
  }
  if (lampNudges.value >= 6) {
    return '别急，方块还在路上。'
  }
  return ''
})

const errorMessage = computed(() => {
  const code = ui.loadError?.code
  if (!code)
    return ''
  return te(`loadError.${code}`) ? t(`loadError.${code}`) : t('loadError.generic')
})

// Listen for loading progress events
onMounted(() => {
  emitter.on('core:loading-progress', handleProgress)
  void loadWorldTitle()
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

function handleProgress({ loaded, failed = 0, total }) {
  progress.value = total ? Math.round(((loaded + failed) / total) * 100) : 100
}

async function loadWorldTitle() {
  const spaceName = getActiveSpaceName()
  const projectionId = getActiveProjectionId()
  if (!spaceName || !projectionId)
    return
  try {
    const payload = await fetchGalleryItem(spaceName, projectionId, loadAdminAuthSession())
    const item = payload?.item
    worldTitle.value = item?.title || item?.schematic?.name || projectionId
  }
  catch {
    worldTitle.value = projectionId
  }
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
  <div class="loading-screen ls-root" :class="{ 'is-error': ui.loadError }">
    <div class="ls-stage">
      <h2 class="ls-brand">
        LITEMORA
      </h2>
      <p class="ls-sub" :class="{ 'is-world': worldTitle }">
        {{ worldTitle || 'Playable Schematic Worlds' }}
      </p>

      <div class="ls-circuit" aria-hidden="true">
        <span class="ls-torch" />
        <div class="ls-track">
          <div class="ls-fill" :style="{ width: ui.loadError ? '40%' : `${progress}%` }">
            <div class="ls-dust" />
          </div>
          <span v-if="ui.loadError" class="ls-break" />
          <span v-else-if="isDone" class="ls-signal" />
          <button
            v-if="!ui.loadError"
            type="button"
            class="ls-lamp ls-lamp--button"
            :class="{ 'is-lit': lampLit }"
            :aria-label="lampLabel"
            :title="lampLabel"
            @click="pokeLamp"
          />
        </div>
      </div>

      <p v-if="lampRemark" class="ls-lamp-remark" aria-live="polite">
        {{ lampRemark }}
      </p>

      <div v-if="ui.loadError" class="load-error" role="alert">
        <span class="load-error-tag" aria-hidden="true">SIGNAL LOST</span>
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
          <button class="rs-btn rs-btn--primary" @click="retry">
            {{ t('loadError.retry') }}
          </button>
          <button class="rs-btn rs-btn--dot" @click="backToWorlds">
            {{ t('loadError.back') }}
          </button>
          <button v-if="ui.loadError.sceneReady" class="rs-btn rs-btn--ghost" @click="ui.continueDespiteLoadError()">
            {{ t('loadError.continue') }}
          </button>
        </div>
      </div>

      <div v-else class="ls-status">
        <p class="ls-label loading-text">
          <span class="ls-tag">{{ isDone ? 'BUILDING' : 'LOADING' }}</span>
          <span class="ls-label-text">{{ loadingText }}</span>
        </p>
        <p class="ls-pct">
          {{ progress }}%
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading-screen {
  position: absolute;
  inset: 0;
}

.ls-sub.is-world {
  color: var(--rs-text);
  font-weight: 600;
  font-size: 17px;
}

.ls-label-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The lamp doubles as a button: same tile art, no button chrome. */
.ls-lamp--button {
  padding: 0;
  border: 0;
  background-color: transparent;
  cursor: pointer;
  transition: box-shadow 0.4s, transform 0.12s;
}

.ls-lamp--button:hover {
  transform: translateY(-1px);
}

.ls-lamp--button:active {
  transform: translateY(1px);
}

.ls-lamp--button:focus-visible {
  outline: 2px solid #ff5a3c;
  outline-offset: 2px;
}

.ls-lamp-remark {
  margin: 12px 0 0;
  color: #b5aea6;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

/* Load error: the torch is lit but the dust is broken, so the lamp stays dark. */
.load-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: min(480px, calc(100vw - 32px));
  margin-top: 28px;
  padding: 22px 24px 24px;
  box-sizing: border-box;
  border: 1px solid var(--rs-line-strong);
  border-top: 2px solid var(--rs-red-dim);
  border-radius: var(--rs-radius-lg);
  background: rgba(14, 16, 19, 0.86);
  box-shadow: var(--rs-shadow);
  text-align: center;
  pointer-events: auto;
}

.load-error-tag {
  color: #ff8a73;
  font: 400 8px/16px var(--rs-font-pixel);
  letter-spacing: 0.14em;
}

.load-error-title {
  margin: 0;
  color: var(--rs-text);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
}

.load-error-message {
  margin: 0;
  color: var(--rs-text-2);
  font-size: 15px;
  line-height: 1.55;
}

.load-error-code {
  margin: 4px 0 0;
  padding: 3px 8px;
  border: 1px solid var(--rs-line);
  border-radius: var(--rs-radius);
  background: var(--rs-bg-0);
  color: var(--rs-text-3);
  font: 400 12px/1.4 var(--rs-font-mono);
}

.load-error-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 14px;
}
</style>
