<script setup>
// Redstone dust drawn as an SVG polyline in block units.
// Off: dark red. Powered: bright red with glow, plus an optional travelling signal pulse.
import { computed } from 'vue'

const props = defineProps({
  // SVG path data in viewBox units, e.g. "M0 4 H24 V12".
  d: { type: String, required: true },
  viewBox: { type: String, default: '0 0 32 8' },
  powered: { type: Boolean, default: false },
  // Animate a signal travelling along the line while powered.
  pulse: { type: Boolean, default: true },
  // Stroke width in viewBox units.
  width: { type: Number, default: 2 },
  // 'none' stretches the wire to the element box (for full-width dividers).
  preserveAspectRatio: { type: String, default: 'xMidYMid meet' },
  // Draw dust dots at these points ("x,y x,y ...").
  dots: { type: String, default: '' },
})

const dotList = computed(() => props.dots
  .split(/\s+/)
  .filter(Boolean)
  .map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    return { x, y }
  })
  .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
</script>

<template>
  <svg
    class="rs-wire"
    :class="{ 'is-powered': powered }"
    :viewBox="viewBox"
    :preserveAspectRatio="preserveAspectRatio"
    aria-hidden="true"
    focusable="false"
  >
    <path class="rs-wire__base" :d="d" :stroke-width="width" pathLength="100" />
    <path v-if="powered && pulse" class="rs-wire__pulse" :d="d" :stroke-width="width" pathLength="100" />
    <rect
      v-for="(p, i) in dotList"
      :key="i"
      class="rs-wire__dot"
      :x="p.x - width"
      :y="p.y - width"
      :width="width * 2"
      :height="width * 2"
    />
  </svg>
</template>

<style scoped>
.rs-wire {
  display: block;
  overflow: visible;
  shape-rendering: crispEdges;
}

.rs-wire__base {
  fill: none;
  stroke: var(--rs-red-off);
  stroke-linecap: square;
  stroke-linejoin: miter;
  transition: stroke 0.2s;
}

.rs-wire__dot {
  fill: var(--rs-red-off);
  transition: fill 0.2s;
}

.rs-wire.is-powered .rs-wire__base,
:global(.rs-powerable:hover) .rs-wire__base {
  stroke: var(--rs-red);
  filter: drop-shadow(0 0 2px rgba(255, 60, 30, 0.85));
}

.rs-wire.is-powered .rs-wire__dot,
:global(.rs-powerable:hover) .rs-wire__dot {
  fill: var(--rs-red-hot);
}

.rs-wire__pulse {
  fill: none;
  stroke: #ffd0c0;
  stroke-linecap: square;
  stroke-dasharray: 6 94;
  filter: drop-shadow(0 0 3px rgba(255, 120, 80, 0.9));
  animation: rs-signal 2.4s linear infinite;
}
</style>
