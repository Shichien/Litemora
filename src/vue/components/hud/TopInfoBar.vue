<script setup>
import { useHudStore } from '@pinia/hudStore.js'
import { computed } from 'vue'
import CompassWheel from './CompassWheel.vue'

const hud = useHudStore()

const displayPosition = computed(() => ({
  x: Math.floor(hud.position.x),
  y: Math.floor(hud.position.y),
  z: Math.floor(hud.position.z),
}))
</script>

<template>
  <div class="top-info-bar">
    <CompassWheel />
    <div class="coordinate-display" aria-label="坐标">
      <span class="coord"><span class="coord-axis">X</span><span class="coord-value">{{ displayPosition.x }}</span></span>
      <span class="coord"><span class="coord-axis">Y</span><span class="coord-value">{{ displayPosition.y }}</span></span>
      <span class="coord"><span class="coord-axis">Z</span><span class="coord-value">{{ displayPosition.z }}</span></span>
    </div>
  </div>
</template>
