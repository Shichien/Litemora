<script setup>
import emitter from '@three/utils/event/event-bus.js'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

const SPEEDS = [0.25, 0.5, 1, 2, 4]

const replay = reactive({
  available: false,
  ready: false,
  playing: false,
  speed: 1,
  currentTick: 0,
  totalTicks: 0,
  ticksPerSecond: 20,
  title: '红石回放',
  description: '',
  changeCount: 0,
  lastChangedBlocks: 0,
  engine: '',
  minecraftVersion: '',
  error: '',
})
const sliderTick = ref(0)

const progress = computed(() => {
  if (!replay.totalTicks) {
    return 0
  }
  return Math.round((replay.currentTick / replay.totalTicks) * 100)
})

// Pad the tick counter to the width of the total so the digits never shift while playing.
const tickDigits = computed(() => Math.max(String(replay.totalTicks || 0).length, 1))
const tickPadding = computed(() => {
  const shown = String(Math.max(0, Math.floor(replay.currentTick || 0)))
  return '0'.repeat(Math.max(0, tickDigits.value - shown.length))
})
const tickShown = computed(() => String(Math.max(0, Math.floor(replay.currentTick || 0))))

// Unrounded progress for the lit wire; the thumb is 8px wide so the lit end tracks its centre.
const progressRatio = computed(() => {
  if (!replay.totalTicks) {
    return 0
  }
  return Math.min(1, Math.max(0, sliderTick.value / replay.totalTicks))
})

const statusLabel = computed(() => {
  if (replay.error) {
    return '载入失败'
  }
  if (!replay.ready) {
    return '接入投影中'
  }
  return replay.playing ? '运行中' : '已暂停'
})

function emitCommand(type, detail = {}) {
  emitter.emit('redstone-replay:command', { type, ...detail })
}

function handleState(nextState = {}) {
  Object.assign(replay, nextState)
}

function commitSeek() {
  emitCommand('seek', { tick: sliderTick.value })
}

function cycleSpeed() {
  const currentIndex = SPEEDS.indexOf(replay.speed)
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % SPEEDS.length
  emitCommand('speed', { speed: SPEEDS[nextIndex] })
}

watch(
  () => replay.currentTick,
  (value) => {
    sliderTick.value = value
  },
)

onMounted(() => {
  emitter.on('redstone-replay:state', handleState)
})

onUnmounted(() => {
  emitter.off('redstone-replay:state', handleState)
})
</script>


<template>
  <section
    v-if="replay.available"
    class="redstone-replay rs-panel--wired"
    :class="{ 'is-powered': replay.playing, 'is-playing': replay.playing, 'is-error': !!replay.error }"
    :style="{ '--progress': `${progress}%`, '--ratio': progressRatio }"
    aria-label="红石运行时间线"
  >
    <header class="replay-heading">
      <div class="replay-title-block">
        <span class="replay-kicker rs-eyebrow">
          REDSTONE ARCHIVE
          <a
            class="replay-credit"
            href="https://github.com/azazo1/redstone-rs"
            target="_blank"
            rel="noopener noreferrer"
            title="红石模拟由 azazo1/redstone-rs 提供，感谢！"
          >· SIM BY REDSTONE-RS</a>
        </span>
        <strong class="replay-title">{{ replay.title }}</strong>
      </div>
      <div class="replay-meta">
        <span class="rs-chip meta-version">Java {{ replay.minecraftVersion }}</span>
        <span class="meta-changes">{{ replay.changeCount }} 次状态变化</span>
        <span class="change-readout" title="上一刻变化的方块数">Δ {{ replay.lastChangedBlocks }}</span>
      </div>
      <div class="replay-status" :class="{ active: replay.playing, error: replay.error }">
        <span class="status-light" />
        {{ statusLabel }}
      </div>
    </header>

    <div class="transport">
      <div class="control-row">
        <button
          type="button"
          class="rs-btn rs-btn--sm rs-btn--icon icon-control"
          :disabled="!replay.ready"
          title="回到开始"
          aria-label="回到开始"
          @click="emitCommand('restart')"
        >
          <svg class="px-icon" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">
            <rect x="1" y="1" width="1" height="6" /><rect x="3" y="3" width="1" height="2" /><rect x="4" y="2" width="1" height="4" /><rect x="5" y="1" width="2" height="6" />
          </svg>
        </button>
        <button
          type="button"
          class="rs-btn rs-btn--sm rs-btn--icon icon-control"
          :disabled="!replay.ready || replay.currentTick <= 0"
          title="后退一游戏刻"
          aria-label="后退一游戏刻"
          @click="emitCommand('step', { delta: -1 })"
        >
          <svg class="px-icon" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">
            <rect x="4" y="1" width="2" height="1" /><rect x="3" y="2" width="2" height="1" /><rect x="2" y="3" width="2" height="2" /><rect x="3" y="5" width="2" height="1" /><rect x="4" y="6" width="2" height="1" />
          </svg>
        </button>
        <button
          type="button"
          class="rs-btn rs-btn--sm rs-btn--icon play-control"
          :class="{ 'active': replay.playing, 'rs-btn--primary': replay.playing }"
          :disabled="!replay.ready"
          :title="replay.playing ? '暂停' : '播放'"
          :aria-label="replay.playing ? '暂停' : '播放'"
          :aria-pressed="replay.playing"
          @click="emitCommand('toggle')"
        >
          <svg v-if="replay.playing" class="px-icon" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">
            <rect x="1" y="1" width="2" height="6" /><rect x="5" y="1" width="2" height="6" />
          </svg>
          <svg v-else class="px-icon" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">
            <rect x="2" y="1" width="2" height="6" /><rect x="4" y="2" width="1" height="4" /><rect x="5" y="3" width="1" height="2" />
          </svg>
        </button>
        <button
          type="button"
          class="rs-btn rs-btn--sm rs-btn--icon icon-control"
          :disabled="!replay.ready || replay.currentTick >= replay.totalTicks"
          title="前进一游戏刻"
          aria-label="前进一游戏刻"
          @click="emitCommand('step', { delta: 1 })"
        >
          <svg class="px-icon" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">
            <rect x="2" y="1" width="2" height="1" /><rect x="3" y="2" width="2" height="1" /><rect x="4" y="3" width="2" height="2" /><rect x="3" y="5" width="2" height="1" /><rect x="2" y="6" width="2" height="1" />
          </svg>
        </button>
        <button
          type="button"
          class="rs-btn rs-btn--sm speed-control"
          :disabled="!replay.ready"
          title="切换播放速度"
          aria-label="切换播放速度"
          @click="cycleSpeed"
        >
          {{ replay.speed }}x
        </button>
      </div>

      <div class="timeline" :class="{ 'is-ready': replay.ready }">
        <div class="timeline-wire" aria-hidden="true" />
        <div class="timeline-lit signal-line" aria-hidden="true" />
        <input
          v-model.number="sliderTick"
          class="timeline-slider"
          :disabled="!replay.ready"
          :max="replay.totalTicks"
          min="0"
          step="1"
          type="range"
          aria-label="跳转到指定游戏刻"
          @change="commitSeek"
        >
      </div>

      <div class="tick-readout">
        <span class="tick-now"><span class="tick-pad">{{ tickPadding }}</span>{{ tickShown }}</span>
        <span class="tick-total">/ {{ replay.totalTicks }} gt</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.redstone-replay {
  --thumb-w: 8px;
  position: absolute;
  left: 50%;
  bottom: 16px;
  width: min(720px, calc(100vw - 28px));
  transform: translateX(-50%);
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--rs-radius-lg);
  /* Solid stone (no backdrop blur over the live canvas) */
  background-color: var(--rs-bg-1);
  background-image:
    linear-gradient(rgba(17, 19, 23, 0.9), rgba(12, 14, 17, 0.95)),
    var(--rs-tex-polished-deepslate);
  background-size: auto, 48px 48px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 14px 40px rgba(0, 0, 0, 0.45);
  color: var(--rs-text);
  font-family: var(--rs-font-body);
  pointer-events: auto;
  image-rendering: pixelated;
}

/* ---------- Heading ---------- */
.replay-heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.replay-title-block {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.replay-kicker {
  line-height: 1;
}

.replay-credit {
  color: var(--rs-text-3);
  font: inherit;
  text-decoration: none;
  transition: color 0.15s ease, text-shadow 0.15s ease;
}

.replay-credit:hover,
.replay-credit:focus-visible {
  color: var(--rs-red-hot);
  text-shadow: 0 0 6px var(--rs-glow-soft);
}

.replay-credit:focus-visible {
  outline: 1px solid var(--rs-red-hot);
  outline-offset: 2px;
}

.replay-title {
  overflow: hidden;
  color: #fff;
  font: 600 15px/1.25 var(--rs-font-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.replay-meta {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--rs-text-2);
  font: 500 11px/1 var(--rs-font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.meta-version {
  height: 20px;
  padding: 0 6px;
  font-size: 10px;
  text-transform: none;
}

.replay-meta .change-readout {
  min-width: 6ch;
  color: var(--rs-text);
  font: 600 11px/1 var(--rs-font-mono);
  font-variant-numeric: tabular-nums;
}

.replay-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  height: 22px;
  padding: 0 9px 0 8px;
  border: 1px solid var(--rs-line-strong);
  border-radius: 2px;
  background: rgba(8, 9, 11, 0.6);
  color: var(--rs-text-2);
  font: 500 12px/1 var(--rs-font-body);
  white-space: nowrap;
}

/* Redstone lamp: dark when paused, lit when running */
.status-light {
  width: 8px;
  height: 8px;
  background: var(--rs-red-off);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.replay-status.active {
  border-color: rgba(255, 74, 46, 0.5);
  color: #ffd2c8;
}

.replay-status.active .status-light {
  background: var(--rs-red-hot);
  box-shadow: 0 0 6px rgba(255, 70, 40, 0.9);
}

.replay-status.error {
  border-color: rgba(212, 122, 79, 0.6);
  color: #f3c3a8;
}

.replay-status.error .status-light {
  background: var(--rs-copper);
}

/* ---------- Transport ---------- */
.transport {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
}

.control-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.px-icon {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.icon-control,
.play-control {
  color: var(--rs-text);
}

.play-control {
  width: 40px;
}

.play-control:not(.active) .px-icon {
  color: #ff8a70;
}

.speed-control {
  min-width: 50px;
  padding: 0 8px;
  color: var(--rs-text);
  font: 600 12px/1 var(--rs-font-mono);
  font-variant-numeric: tabular-nums;
}

/* The timeline is a redstone line: dim dust, lit up to the current tick */
.timeline {
  position: relative;
  flex: 1 1 auto;
  min-width: 120px;
  height: 28px;
}

.timeline-wire,
.timeline-lit {
  position: absolute;
  top: 50%;
  height: 4px;
  margin-top: -2px;
  background-image: linear-gradient(90deg, rgba(0, 0, 0, 0.28) 50%, transparent 50%);
  background-size: 4px 100%;
  pointer-events: none;
}

.timeline-wire {
  left: 0;
  right: 0;
  background-color: var(--rs-red-dim);
}

/* Quarter marks under the wire */
.timeline-wire::after {
  content: '';
  position: absolute;
  left: calc(var(--thumb-w) / 2);
  right: calc(var(--thumb-w) / 2 - 1px);
  top: 8px;
  height: 4px;
  background: linear-gradient(90deg, rgba(237, 232, 226, 0.22) 1px, transparent 1px) 0 0 / 25% 100% repeat-x;
  border-right: 1px solid rgba(237, 232, 226, 0.22);
}

.timeline-lit {
  left: 0;
  width: calc(var(--thumb-w) / 2 + (100% - var(--thumb-w)) * var(--ratio, 0));
  background-color: #e3321f;
  transition: width 80ms linear, box-shadow 0.2s, background-color 0.2s;
}

.is-playing .timeline-lit {
  background-color: var(--rs-red-hot);
  box-shadow: 0 0 6px rgba(255, 70, 40, 0.8), 0 0 16px rgba(255, 40, 20, 0.35);
}

.timeline-slider {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.timeline-slider:disabled {
  cursor: default;
}

.timeline-slider:focus-visible {
  outline: none;
}

.timeline-slider::-webkit-slider-runnable-track {
  height: 100%;
  background: transparent;
}

.timeline-slider::-moz-range-track {
  height: 100%;
  background: transparent;
}

.timeline-slider::-moz-range-progress {
  background: transparent;
}

/* Thumb: an ivory signal head with a redstone rim */
.timeline-slider::-webkit-slider-thumb {
  width: var(--thumb-w);
  height: 18px;
  margin-top: 5px;
  border: 2px solid var(--rs-red-hot);
  border-radius: 1px;
  background: #fff1ec;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 6px rgba(255, 70, 40, 0.55);
  -webkit-appearance: none;
  appearance: none;
}

.timeline-slider::-moz-range-thumb {
  width: var(--thumb-w);
  height: 18px;
  border: 2px solid var(--rs-red-hot);
  border-radius: 1px;
  background: #fff1ec;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 6px rgba(255, 70, 40, 0.55);
}

.timeline-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px var(--rs-bg-0), 0 0 0 4px #fff;
}

.timeline-slider:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 2px var(--rs-bg-0), 0 0 0 4px #fff;
}

.timeline-slider:disabled::-webkit-slider-thumb {
  opacity: 0.4;
}

.timeline-slider:disabled::-moz-range-thumb {
  opacity: 0.4;
}

/* Tick counter: pixel digits padded to a fixed width */
.tick-readout {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.tick-now {
  color: #fff;
  font-family: var(--rs-font-pixel);
  font-size: 16px;
  line-height: 16px;
  -webkit-font-smoothing: none;
  /* Minecraftia ink sits 6px above its line box centre */
  transform: translateY(6px);
}

/* _tokens.scss puts a font on `*`; the padding digits must use the same pixel font */
.tick-now .tick-pad {
  font: inherit;
}

.is-playing .tick-now {
  color: #ffd9cf;
  text-shadow: 0 0 6px rgba(255, 70, 40, 0.55);
}

.tick-pad {
  color: rgba(237, 232, 226, 0.26);
  text-shadow: none;
}

.is-playing .tick-pad {
  color: rgba(255, 140, 120, 0.3);
}

.tick-total {
  color: var(--rs-text-2);
  font: 500 11px/1 var(--rs-font-mono);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 760px) {
  .meta-changes {
    display: none;
  }
}

@media (max-width: 620px) {
  .redstone-replay {
    bottom: 12px;
    padding: 10px 12px;
  }

  .replay-meta .meta-version {
    display: none;
  }

  .transport {
    flex-wrap: wrap;
    row-gap: 6px;
  }

  .timeline {
    order: -1;
    flex-basis: 100%;
  }

  .tick-readout {
    margin-left: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .timeline-lit {
    transition: none;
  }
}
</style>