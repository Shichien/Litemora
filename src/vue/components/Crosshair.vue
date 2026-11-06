<script setup>
import emitter from '@three/utils/event/event-bus.js'
import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Crosshair - Minecraft 风格的十字准星
 *
 * 特点：
 * - 固定在视口正中心
 * - 简洁的十字线设计
 * - 仅在 Pointer Lock 激活时显示
 * - 显示挖掘进度条
 */

const isVisible = ref(false)
const isPressed = ref(false)

// Mining progress state
const isMining = ref(false)
const miningProgress = ref(0)

// 监听 Pointer Lock 状态变化
function onPointerLocked() {
  isVisible.value = true
}

function onPointerUnlocked() {
  isVisible.value = false
}

// 监听鼠标按键
function onMouseDown(data) {
  if (data.button === 0) { // 左键按下
    isPressed.value = true
  }
}

function onMouseUp(data) {
  if (data.button === 0) { // 左键松开
    isPressed.value = false
  }
}

// Mining event handlers
function onMiningStart() {
  isMining.value = true
  miningProgress.value = 0
}

function onMiningProgress(data) {
  isMining.value = true
  miningProgress.value = data.progress
}

function onMiningCancel() {
  isMining.value = false
  miningProgress.value = 0
}

function onMiningComplete() {
  isMining.value = false
  miningProgress.value = 0
}

onMounted(() => {
  emitter.on('pointer:locked', onPointerLocked)
  emitter.on('pointer:unlocked', onPointerUnlocked)
  emitter.on('input:mouse_down', onMouseDown)
  emitter.on('input:mouse_up', onMouseUp)
  // Mining events
  emitter.on('game:mining-start', onMiningStart)
  emitter.on('game:mining-progress', onMiningProgress)
  emitter.on('game:mining-cancel', onMiningCancel)
  emitter.on('game:mining-complete', onMiningComplete)

  isVisible.value = !!document.pointerLockElement
})

onUnmounted(() => {
  emitter.off('pointer:locked', onPointerLocked)
  emitter.off('pointer:unlocked', onPointerUnlocked)
  emitter.off('input:mouse_down', onMouseDown)
  emitter.off('input:mouse_up', onMouseUp)
  // Mining events
  emitter.off('game:mining-start', onMiningStart)
  emitter.off('game:mining-progress', onMiningProgress)
  emitter.off('game:mining-cancel', onMiningCancel)
  emitter.off('game:mining-complete', onMiningComplete)
})
</script>


<template>
  <Transition name="fade">
    <div v-if="isVisible" class="crosshair" :class="{ 'is-pressed': isPressed }">
      <!-- 中央十字: 四条短臂 + 中心点, 白芯黑边, 在亮/暗方块上都清晰 -->
      <div class="center-dashes">
        <div class="dash top" />
        <div class="dash bottom" />
        <div class="dash left" />
        <div class="dash right" />
        <div class="dash dot" />
      </div>

      <!-- 挖掘进度条: 一段红石线 -->
      <Transition name="progress-fade">
        <div v-if="isMining" class="mining-progress-container">
          <div class="mining-progress-bar">
            <div class="mining-progress-fill" :style="{ width: `${miningProgress * 100}%` }" />
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
/* 22px box with integer offsets so every edge lands on a whole pixel */
.crosshair {
  position: fixed;
  top: 50%;
  left: 50%;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  pointer-events: none;
  z-index: 9999;
}

.dash {
  position: absolute;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  transition: transform 0.08s ease-out, background-color 0.08s;
}

.dash.top,
.dash.bottom {
  left: 10px;
  width: 2px;
  height: 6px;
}

.dash.top { top: 1px; }
.dash.bottom { bottom: 1px; }

.dash.left,
.dash.right {
  top: 10px;
  width: 6px;
  height: 2px;
}

.dash.left { left: 1px; }
.dash.right { right: 1px; }

.dash.dot {
  top: 10px;
  left: 10px;
  width: 2px;
  height: 2px;
  background: rgba(255, 255, 255, 0.85);
}

/* Pressed: arms close in by 2px and the cross powers on */
.is-pressed .dash { background: var(--rs-red-hot, #ff4a2e); }
.is-pressed .dash.top { transform: translateY(2px); }
.is-pressed .dash.bottom { transform: translateY(-2px); }
.is-pressed .dash.left { transform: translateX(2px); }
.is-pressed .dash.right { transform: translateX(-2px); }

/* 淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 挖掘进度条 */
.mining-progress-container {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  width: 72px;
  margin-left: -36px;
  pointer-events: none;
}

.mining-progress-bar {
  width: 100%;
  height: 4px;
  overflow: hidden;
  background: var(--rs-red-off, #3b0f0c);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7);
}

.mining-progress-fill {
  height: 100%;
  background: var(--rs-red-hot, #ff4a2e);
  box-shadow: 0 0 6px rgba(255, 70, 40, 0.8);
  transition: width 0.05s linear;
}

/* 进度条淡入淡出动画 */
.progress-fade-enter-active,
.progress-fade-leave-active {
  transition: opacity 0.2s ease;
}

.progress-fade-enter-from,
.progress-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .dash {
    transition: none;
  }
}
</style>