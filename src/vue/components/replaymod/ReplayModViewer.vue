<script setup>
import { thumbnailSkyImage } from '@three/gallery/thumbnail-skies.js'
import { loadReplayMod } from '@three/replaymod/replaymod-loader.js'
import { ReplayModPlayback } from '@three/replaymod/replaymod-playback.js'
import { ReplayModRenderer } from '@three/replaymod/replaymod-renderer.js'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

const props = defineProps({
  sourceFile: { type: Object, default: null },
  title: { type: String, default: 'ReplayMod 录像' },
  thumbnailSky: { type: String, default: '' },
})
const emit = defineEmits(['ready', 'error'])
const canvas = ref(null)
const canvasGeneration = ref(0)
const replay = shallowRef(null)
const error = ref('')
const status = ref('')
const ready = ref(false)
const playing = ref(false)
const timeMs = ref(0)
const speed = ref(1)
const loop = ref(false)
const entityCount = ref(0)
const renderedBlocks = ref(0)
const modelWarnings = ref(0)
const actionWarnings = ref([])
const busy = ref(false)
let playback = null
let renderer = null
let abort = null
let loadToken = 0
let animation = 0
let lastFrame = 0
let lastSync = 0
const duration = computed(() => replay.value?.durationMs || 0)
const warnings = computed(() => (replay.value?.warnings || []).map(warning => typeof warning === 'string' ? warning : warning.message || warning.code).filter(Boolean))
function timeLabel(ms) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000 / 100))}`
}
function cleanup() {
  abort?.abort()
  cancelAnimationFrame(animation)
  renderer?.dispose()
  renderer = null
  playback = null
  playing.value = false
  ready.value = false
}
function fail(reason) {
  error.value = reason?.message || String(reason)
  playing.value = false
  emit('error', error.value)
}
async function load() {
  const token = ++loadToken
  cleanup()
  canvasGeneration.value++
  renderedBlocks.value = 0
  entityCount.value = 0
  actionWarnings.value = []
  modelWarnings.value = 0
  busy.value = false
  replay.value = null
  timeMs.value = 0
  status.value = ''
  error.value = ''
  if (!props.sourceFile)
    return
  const controller = new AbortController()
  abort = controller
  try {
    status.value = '读取 ReplayMod 录像…'
    const size = props.sourceFile.size ?? props.sourceFile.buffer?.byteLength ?? 0
    if (size > 128 * 1024 * 1024)
      throw new Error('本地录像大小上限为 128 MiB，请先裁剪录像')
    const buffer = props.sourceFile.arrayBuffer ? await props.sourceFile.arrayBuffer() : props.sourceFile.buffer.slice(0)
    if (token !== loadToken)
      return
    const decoded = await loadReplayMod(buffer, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (token === loadToken)
          status.value = `解析录像 ${Math.round((progress.progress || 0) * 100)}%`
      },
    })
    if (token !== loadToken)
      return
    replay.value = decoded
    playback = new ReplayModPlayback(decoded)
    // Prefer the recording player's chunk so the first preview contains nearby terrain.
    const initial = decoded.initialCamera
    const firstChunk = decoded.events.find(event => event.type === 'chunk' && (!initial || (event.x === Math.floor(initial.x / 16) && event.z === Math.floor(initial.z / 16))))
      || decoded.events.find(event => event.type === 'chunk')
    timeMs.value = firstChunk?.timeMs || 0
    playback.seek(timeMs.value)
    await nextTick()
    if (token !== loadToken)
      return
    const currentRenderer = new ReplayModRenderer(canvas.value, playback, {
      onStatus: (message) => {
        if (token === loadToken)
          status.value = message
      },
    })
    renderer = currentRenderer
    await currentRenderer.initialize()
    if (token !== loadToken) {
      currentRenderer.dispose()
      return
    }
    renderedBlocks.value = currentRenderer.renderedBlocks
    entityCount.value = playback.entities.size
    ready.value = true
    emit('ready', { metadata: decoded.metadata, durationMs: decoded.durationMs, stats: decoded.stats, warnings: decoded.warnings })
    lastFrame = performance.now()
    animation = requestAnimationFrame(frame)
  }
  catch (reason) {
    if (token === loadToken && reason.name !== 'AbortError') {
      status.value = ''
      fail(reason)
    }
  }
}
function frame(now) {
  if (!renderer || !playback)
    return
  const delta = Math.min(100, now - lastFrame)
  lastFrame = now
  if (playing.value && !renderer.building) {
    timeMs.value = Math.min(duration.value, timeMs.value + delta * speed.value)
    if (timeMs.value >= duration.value) {
      if (loop.value)
        timeMs.value = 0
      else
        playing.value = false
    }
    playback.seek(timeMs.value)
  }
  if (now - lastSync > 80) {
    lastSync = now
    syncRenderer()
    entityCount.value = playback.entities.size
    renderedBlocks.value = renderer.renderedBlocks
    modelWarnings.value = renderer.missingModels.size
    actionWarnings.value = [...playback.warnings]
  }
  busy.value = renderer.building
  renderer.draw(delta / 1000)
  animation = requestAnimationFrame(frame)
}
function syncRenderer() {
  const currentRenderer = renderer
  const token = loadToken
  currentRenderer?.sync().catch((reason) => {
    if (token === loadToken && renderer === currentRenderer)
      fail(reason)
  })
}
function seek(value) {
  if (!playback)
    return
  timeMs.value = Math.max(0, Math.min(duration.value, Number(value)))
  playback.seek(timeMs.value)
  syncRenderer()
}
function toggle() {
  if (timeMs.value >= duration.value)
    seek(0)
  playing.value = !playing.value
}
function step(delta) {
  playing.value = false
  seek(timeMs.value + delta)
}
async function fullscreen() {
  if (document.fullscreenElement)
    await document.exitFullscreen()
  else
    await canvas.value?.closest('.replay-viewer')?.requestFullscreen()
}
defineExpose({
  capturePreviewThumbnail: () => {
    if (!ready.value || renderer?.building)
      throw new Error('请等待录像场景加载完成')
    return renderer.capture()
  },
})
watch(() => props.sourceFile, load, { immediate: true })
onBeforeUnmount(() => {
  ++loadToken
  cleanup()
})
</script>

<template>
  <section class="replay-viewer" aria-label="ReplayMod 录像播放器" :data-ready="ready" :data-time-ms="Math.round(timeMs)" :data-rendered-blocks="renderedBlocks" :data-entity-count="entityCount" :data-busy="busy">
    <div class="replay-stage" :style="{ backgroundImage: thumbnailSkyImage(thumbnailSky) }">
      <canvas :key="canvasGeneration" ref="canvas" aria-label="录像三维场景，拖动旋转、右键平移、滚轮缩放，WASD 移动，Q E 升降" />
      <div class="replay-heading">
        <strong>{{ title }}</strong><span v-if="replay">Minecraft {{ replay.metadata.minecraftVersion }}</span>
      </div>
      <div v-if="status" class="replay-status" role="status">
        {{ status }}
      </div>
      <div v-if="error" class="replay-error" role="alert">
        {{ error }}
      </div>
      <div v-if="actionWarnings.length" class="replay-action-warning" role="status">
        部分活塞动作暂不支持，当前场景可能不完整；详见播放提示。
      </div>
      <div v-if="ready" class="replay-help">
        拖动旋转 · 右键平移 · 滚轮缩放 · WASD 移动 · Q / E 升降
      </div>
    </div>
    <div class="replay-controls">
      <input :value="timeMs" :max="duration || 1" :disabled="!ready" min="0" step="1" type="range" aria-label="录像时间线" @input="seek($event.target.value)">
      <div class="replay-buttons">
        <button :disabled="!ready || !!error" @click="toggle">
          {{ playing ? '暂停' : '播放' }}
        </button>
        <button :disabled="!ready" aria-label="后退一刻" @click="step(-50)">
          −50 ms
        </button>
        <button :disabled="!ready" aria-label="前进一刻" @click="step(50)">
          +50 ms
        </button>
        <span class="replay-time">{{ timeLabel(timeMs) }} / {{ timeLabel(duration) }}</span>
        <label>速度 <select v-model.number="speed" aria-label="录像播放速度"><option v-for="rate in [0.25, 0.5, 1, 2, 4]" :key="rate" :value="rate">{{ rate }}×</option></select></label>
        <label><input v-model="loop" type="checkbox"> 循环</label>
        <button :disabled="!ready" @click="renderer?.home()">
          回到录制位置
        </button>
        <button @click="fullscreen">
          全屏
        </button>
      </div>
      <p v-if="ready" class="replay-detail">
        当前画面 {{ renderedBlocks.toLocaleString() }} 方块 · {{ entityCount }} 个实体 · 视野附近 48 格
      </p>
      <details v-if="ready" class="replay-notes">
        <summary>播放范围与提示<span v-if="warnings.length || actionWarnings.length || modelWarnings">（{{ warnings.length + actionWarnings.length + (modelWarnings ? 1 : 0) }}）</span></summary>
        <p>重现录像里记录的方块和实体位置。声音、粒子、玩家自定义皮肤、装备和实体骨骼动作暂不还原；不会重新运行农场逻辑。</p>
        <p v-for="(warning, index) in warnings" :key="index">
          {{ warning }}
        </p>
        <p v-for="warning in actionWarnings" :key="warning">
          {{ warning }}
        </p>
        <p v-if="modelWarnings">
          {{ modelWarnings }} 类模型暂缺资源，以线框标记显示。
        </p>
      </details>
    </div>
  </section>
</template>

<style scoped>
.replay-viewer { width: 100%; background: #17232b; color: #f2f7f7; border: 1px solid #3c515b; border-radius: 12px; overflow: hidden; }
.replay-stage { position: relative; height: clamp(320px, 55vh, 800px); background: #9bc3dc center / cover no-repeat; }
.replay-stage canvas { display: block; width: 100%; height: 100%; outline: none; }
.replay-stage canvas:focus-visible { outline: 2px solid #c8eb82; outline-offset: -2px; }
.replay-heading { position: absolute; top: 14px; left: 16px; display: flex; flex-direction: column; gap: 5px; pointer-events: none; text-shadow: 0 1px 4px #000; }
.replay-heading span { font-size: 12px; }
.replay-status, .replay-error { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 16px 22px; border-radius: 8px; background: #14232ce8; max-width: 90%; }
.replay-error { background: #542520f2; }
.replay-action-warning { position: absolute; top: 68px; left: 12px; right: 12px; padding: 8px 12px; border-radius: 5px; background: #5b4319ed; font-size: 12px; }
.replay-help { position: absolute; bottom: 12px; left: 12px; right: 12px; width: fit-content; padding: 6px 10px; border-radius: 6px; background: #14232ccc; font-size: 12px; pointer-events: none; }
.replay-controls { padding: 12px 16px; }
.replay-controls > input { width: 100%; accent-color: #b4da73; }
.replay-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 10px; font-size: 13px; }
.replay-buttons button, .replay-buttons select { padding: 7px 10px; background: #31464c; color: #f2f7f7; border: 1px solid #587276; border-radius: 6px; cursor: pointer; }
.replay-buttons button:disabled { opacity: .45; cursor: default; }
.replay-buttons button:first-child { background: #b4da73; color: #182816; }
.replay-time { font-variant-numeric: tabular-nums; margin-right: auto; }
.replay-detail, .replay-notes { font-size: 12px; color: #b8cacc; margin-top: 10px; line-height: 1.6; }
.replay-notes summary { cursor: pointer; }
.replay-notes p { margin-top: 7px; }
.replay-viewer:fullscreen { border: 0; border-radius: 0; display: flex; flex-direction: column; }
.replay-viewer:fullscreen .replay-stage { height: auto; flex: 1; min-height: 0; }
</style>
