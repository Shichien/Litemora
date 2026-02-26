<script setup>
/**
 * TopInfoBar - Container for compass
 */
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
    <div class="coordinate-display">
      <span>X: {{ displayPosition.x }}</span>
      <span>Y: {{ displayPosition.y }}</span>
      <span>Z: {{ displayPosition.z }}</span>
    </div>
    <CompassWheel />
  </div>
</template>
