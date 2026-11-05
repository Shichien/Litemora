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
  <section v-if="replay.available" class="redstone-replay" aria-label="红石运行时间线">
    <div class="signal-line" :style="{ '--progress': `${progress}%` }" />

    <div class="replay-heading">
      <div class="replay-title-block">
        <span class="replay-kicker">REDSTONE ARCHIVE</span>
        <strong>{{ replay.title }}</strong>
      </div>
      <div class="replay-status" :class="{ active: replay.playing, error: replay.error }">
        <span class="status-light" />
        {{ statusLabel }}
      </div>
    </div>

    <div class="timeline-row">
      <span class="tick-readout">{{ replay.currentTick }} / {{ replay.totalTicks }} gt</span>
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
      <span class="change-readout">Δ {{ replay.lastChangedBlocks }}</span>
    </div>

    <div class="control-row">
      <button
        type="button"
        class="icon-control"
        :disabled="!replay.ready"
        title="回到开始"
        aria-label="回到开始"
        @click="emitCommand('restart')"
      >
        ↶
      </button>
      <button
        type="button"
        class="icon-control"
        :disabled="!replay.ready || replay.currentTick <= 0"
        title="后退一游戏刻"
        aria-label="后退一游戏刻"
        @click="emitCommand('step', { delta: -1 })"
      >
        ‹
      </button>
      <button
        type="button"
        class="play-control"
        :class="{ active: replay.playing }"
        :disabled="!replay.ready"
        :title="replay.playing ? '暂停' : '播放'"
        :aria-label="replay.playing ? '暂停' : '播放'"
        @click="emitCommand('toggle')"
      >
        {{ replay.playing ? 'Ⅱ' : '▶' }}
      </button>
      <button
        type="button"
        class="icon-control"
        :disabled="!replay.ready || replay.currentTick >= replay.totalTicks"
        title="前进一游戏刻"
        aria-label="前进一游戏刻"
        @click="emitCommand('step', { delta: 1 })"
      >
        ›
      </button>
      <button
        type="button"
        class="speed-control"
        :disabled="!replay.ready"
        title="切换播放速度"
        aria-label="切换播放速度"
        @click="cycleSpeed"
      >
        {{ replay.speed }}x
      </button>

      <div class="replay-meta">
        <span>Java {{ replay.minecraftVersion }}</span>
        <span>{{ replay.changeCount }} 次状态变化</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.redstone-replay {
  --signal-red: #ff5b36;
  --signal-cyan: #69d6ff;
  position: absolute;
  left: 50%;
  bottom: 22px;
  width: min(720px, calc(100vw - 28px));
  min-height: 116px;
  transform: translateX(-50%);
  padding: 14px 16px 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(10, 12, 13, 0.9);
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(16px);
  color: #f4f1eb;
  pointer-events: auto;
  image-rendering: auto;
}

.signal-line {
  position: absolute;
  top: -1px;
  left: -1px;
  width: calc(var(--progress) + 2px);
  height: 2px;
  max-width: calc(100% + 2px);
  background: var(--signal-red);
  box-shadow: 0 0 16px rgba(255, 91, 54, 0.78);
  transition: width 80ms linear;
}

.replay-heading,
.timeline-row,
.control-row {
  display: flex;
  align-items: center;
}

.replay-heading {
  justify-content: space-between;
  gap: 16px;
}

.replay-title-block {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.replay-title-block strong {
  overflow: hidden;
  color: #fff;
  font-family: system-ui, sans-serif;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.replay-kicker {
  color: #a69d91;
  font-size: 9px;
  line-height: 1;
}

.replay-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  color: #b8b1a8;
  font-size: 10px;
}

.status-light {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #77716a;
}

.replay-status.active {
  color: #ffd5c7;
}

.replay-status.active .status-light {
  background: var(--signal-red);
  box-shadow: 0 0 12px rgba(255, 91, 54, 0.9);
}

.replay-status.error {
  color: #ffb3a0;
}

.timeline-row {
  gap: 10px;
  margin-top: 12px;
}

.tick-readout,
.change-readout {
  flex: 0 0 auto;
  color: #d5cdc2;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.change-readout {
  color: var(--signal-cyan);
}

.timeline-slider {
  width: 100%;
  min-width: 80px;
  height: 14px;
  margin: 0;
  accent-color: var(--signal-red);
  cursor: pointer;
}

.control-row {
  gap: 7px;
  margin-top: 9px;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: #f7f3ed;
  font: inherit;
  cursor: pointer;
}

button:hover:not(:disabled),
button:focus-visible {
  border-color: rgba(105, 214, 255, 0.52);
  background: rgba(105, 214, 255, 0.1);
  outline: none;
}

button:disabled {
  cursor: default;
  opacity: 0.34;
}

.icon-control,
.play-control {
  width: 30px;
  font-family: system-ui, sans-serif;
  font-size: 17px;
}

.play-control {
  width: 38px;
  color: #fff;
}

.play-control.active {
  border-color: rgba(255, 91, 54, 0.58);
  background: rgba(255, 91, 54, 0.16);
  color: #ffd7cb;
}

.speed-control {
  min-width: 46px;
  padding: 0 8px;
  color: #f0d68a;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.replay-meta {
  min-width: 0;
  display: flex;
  gap: 12px;
  margin-left: auto;
  overflow: hidden;
  color: #8f8981;
  font-size: 9px;
  white-space: nowrap;
}

@media (max-width: 620px) {
  .redstone-replay {
    bottom: 12px;
    padding: 12px;
  }

  .replay-meta span:last-child {
    display: none;
  }

  .tick-readout {
    max-width: 96px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .signal-line {
    transition: none;
  }
}
</style>
