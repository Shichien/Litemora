<script setup>
import { resolvePublicAssetUrl } from '@three/utils/public-asset-url.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelUrl: { type: String, default: '/homepage/piston-door-56.glb' },
  title: { type: String, default: '3 × 3 活塞门' },
  open: { type: Boolean, default: false },
})
const rootRef = ref(null)
const rendererHostRef = ref(null)
const status = ref('idle')
const errorMessage = ref('')
let viewer = null
let disposed = false
let activated = false
let generation = 0
let controller = null
let visibilityObserver = null

async function loadPreview() {
  if (disposed)
    return
  const token = ++generation
  controller?.abort()
  viewer?.dispose()
  viewer = null
  controller = new AbortController()
  const signal = controller.signal
  status.value = 'loading'
  errorMessage.value = ''
  const isCurrent = () => !disposed && token === generation && !signal.aborted
  try {
    // The homepage loads only a baked mesh and its textures, not the editor,
    // NBT parser, WASM engine, full resource pack, or a third-party CDN.
    const { createPistonDoorViewer } = await import('@three/landing/piston-door-viewer.js')
    if (!isCurrent())
      return
    viewer = createPistonDoorViewer(rendererHostRef.value, {
      modelUrl: resolvePublicAssetUrl(props.modelUrl),
      onReady() {
        if (!isCurrent())
          return
        status.value = 'ready'
        viewer?.setOpen(props.open)
      },
      onError(error) {
        if (!isCurrent())
          return
        errorMessage.value = error?.message || '请稍后重试。'
        status.value = 'error'
      },
    })
    viewer.setOpen(props.open)
  }
  catch (error) {
    if (!isCurrent())
      return
    errorMessage.value = error?.message || '请稍后重试。'
    status.value = 'error'
  }
}

function activate() {
  if (activated || disposed)
    return
  activated = true
  visibilityObserver?.disconnect()
  void loadPreview()
}

watch(() => props.open, value => viewer?.setOpen(value))
watch(() => props.modelUrl, () => {
  if (activated)
    void loadPreview()
})

onMounted(() => {
  if (typeof IntersectionObserver !== 'function') {
    activate()
    return
  }
  visibilityObserver = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting))
      activate()
  }, { rootMargin: '160px' })
  visibilityObserver.observe(rootRef.value)
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  controller?.abort()
  visibilityObserver?.disconnect()
  viewer?.dispose()
})
</script>

<template>
  <figure ref="rootRef" class="piston-door-preview" :aria-label="`${props.title}三维预览`">
    <div class="piston-door-preview__stage" :aria-busy="status === 'loading'">
      <img
        v-if="status !== 'ready'"
        class="piston-door-preview__poster"
        :src="resolvePublicAssetUrl('/homepage/piston-door-56-poster.png')"
        alt="56 体积 3×3 活塞门模型"
        fetchpriority="high"
        width="597"
        height="501"
      >
      <div ref="rendererHostRef" class="piston-door-preview__renderer" :class="{ 'is-ready': status === 'ready' }" />
      <div v-if="status !== 'ready'" class="piston-door-preview__status" role="status" aria-live="polite">
        <template v-if="status === 'error'">
          <span>交互模型加载失败：{{ errorMessage }}</span>
          <button type="button" @click="loadPreview">
            重试
          </button>
        </template>
        <span v-else>正在准备交互…</span>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.piston-door-preview { width: 100%; min-width: 0; margin: 0; color: var(--rs-text, #e9e5df); }
.piston-door-preview__stage { position: relative; height: var(--piston-preview-height, clamp(320px, 36vw, 500px)); overflow: hidden; background: #081219; }
.piston-door-preview__poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.piston-door-preview__renderer { height: 100%; opacity: 0; }
.piston-door-preview__renderer.is-ready { opacity: 1; }
.piston-door-preview__renderer :deep(canvas) { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.piston-door-preview__renderer :deep(canvas:focus-visible) { outline: 2px solid var(--rs-red-hot); outline-offset: -2px; }
.piston-door-preview__renderer :deep(canvas:active) { cursor: grabbing; }
.piston-door-preview__status { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px 16px; background: #081219dd; color: var(--rs-text-dim, #99958f); font-size: 12px; }
.piston-door-preview__status button { border: 1px solid currentColor; background: transparent; color: inherit; padding: 4px 10px; cursor: pointer; }
.piston-door-preview button:focus-visible { outline: 2px solid var(--rs-red-hot, #ff5638); outline-offset: 4px; }
</style>
