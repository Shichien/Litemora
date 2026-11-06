<script setup>
// Generated card art used when a world has no uploaded or captured thumbnail:
// an isometric block with the build's real proportions, skinned with deepslate
// pack textures, sitting on a blueprint plot with an (unpowered) redstone trace.
// The parent card lights the trace via `.world-card:hover` / `:focus-within`.
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'
import { computed } from 'vue'

const props = defineProps({
  // Bounding box size in blocks: { x, y, z }.
  size: {
    type: Object,
    default: null,
  },
  // Any stable string; picks the texture pairing.
  seed: {
    type: String,
    default: '',
  },
})

const VIEW_W = 320
const VIEW_H = 200
const COS30 = Math.cos(Math.PI / 6)
const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const SKINS = [
  { top: 'deepslate_tiles', side: 'deepslate_bricks' },
  { top: 'polished_deepslate', side: 'deepslate_tiles' },
  { top: 'chiseled_deepslate', side: 'polished_deepslate' },
  { top: 'deepslate_bricks', side: 'cracked_deepslate_bricks' },
  { top: 'polished_deepslate', side: 'tuff_bricks' },
]

let instanceCounter = 0
const uid = `wt${++instanceCounter}${Math.random().toString(36).slice(2, 7)}`

function hashString(value) {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const skin = computed(() => {
  const s = SKINS[hashString(props.seed || 'litemora') % SKINS.length]
  return {
    top: resolvePublicAssetUrl(`${BLOCK_DIR}${s.top}.png`),
    side: resolvePublicAssetUrl(`${BLOCK_DIR}${s.side}.png`),
  }
})

const geometry = computed(() => {
  const raw = props.size || {}
  const W0 = Math.max(1, Number(raw.x) || 16)
  const H0 = Math.max(1, Number(raw.y) || 16)
  const D0 = Math.max(1, Number(raw.z) || 16)
  const maxDim = Math.max(W0, H0, D0)
  // Keep very flat or thin builds readable as a solid block.
  const w = Math.max(W0, maxDim * 0.14)
  const h = Math.max(H0, maxDim * 0.1)
  const d = Math.max(D0, maxDim * 0.14)

  const boundsW = (w + d) * COS30
  const boundsH = h + (w + d) / 2
  const s = Math.min(212 / boundsW, 118 / boundsH)
  const cx = VIEW_W / 2
  const cy = 96
  const ox = cx - ((w - d) * COS30 * s) / 2
  const oy = cy - ((-h + (w + d) / 2) / 2) * s

  const P = (x, y, z) => [ox + (x - z) * COS30 * s, oy + ((x + z) / 2 - y) * s]
  const pts = list => list.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ')

  // Pattern tile = `bpt` blocks, never smaller than ~12px on screen.
  const bpt = Math.max(1, 2 ** Math.ceil(Math.log2(12 / s)))
  const k = (s * bpt) / 16
  const m = (a, b, c, dd, e, f) => `matrix(${[a, b, c, dd, e, f].map(n => n.toFixed(4)).join(' ')})`
  const topOrigin = P(0, h, 0)
  const leftOrigin = P(0, h, d)
  const rightOrigin = P(w, h, d)

  const top = [P(0, h, 0), P(w, h, 0), P(w, h, d), P(0, h, d)]
  const left = [P(0, h, d), P(w, h, d), P(w, 0, d), P(0, 0, d)]
  const right = [P(w, h, d), P(w, h, 0), P(w, 0, 0), P(w, 0, d)]

  // Blueprint plot under the block.
  const margin = Math.max(w, d) * 0.22
  const plot = [P(-margin, 0, -margin), P(w + margin, 0, -margin), P(w + margin, 0, d + margin), P(-margin, 0, d + margin)]

  // Redstone trace on the floor, leaving the front-left face toward the viewer.
  const start = P(w * 0.5, 0, d)
  const leg1 = Math.min(26, margin * s * 0.9 + 12)
  const bend = [start[0] - COS30 * leg1, start[1] + 0.5 * leg1]
  const leg2 = 30
  const tail = [bend[0] - leg2, bend[1]]

  return {
    top: pts(top),
    left: pts(left),
    right: pts(right),
    plot: pts(plot),
    frontEdge: pts([P(0, h, d), P(w, h, d), P(w, h, 0)]),
    outline: pts([P(0, h, 0), P(w, h, 0), P(w, 0, 0), P(w, 0, d), P(0, 0, d), P(0, h, d)]),
    vertical: pts([P(w, h, d), P(w, 0, d)]),
    wire: `M${start[0].toFixed(1)} ${start[1].toFixed(1)} L${bend[0].toFixed(1)} ${bend[1].toFixed(1)} L${tail[0].toFixed(1)} ${tail[1].toFixed(1)}`,
    wireEnd: tail,
    topTransform: m(COS30 * k, 0.5 * k, -COS30 * k, 0.5 * k, topOrigin[0], topOrigin[1]),
    leftTransform: m(COS30 * k, 0.5 * k, 0, k, leftOrigin[0], leftOrigin[1]),
    rightTransform: m(COS30 * k, -0.5 * k, 0, k, rightOrigin[0], rightOrigin[1]),
  }
})
</script>

<template>
  <svg
    class="world-thumb-art"
    :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <pattern :id="`${uid}-top`" patternUnits="userSpaceOnUse" width="16" height="16" :patternTransform="geometry.topTransform">
        <image :href="skin.top" width="16" height="16" class="wt-tex" />
      </pattern>
      <pattern :id="`${uid}-left`" patternUnits="userSpaceOnUse" width="16" height="16" :patternTransform="geometry.leftTransform">
        <image :href="skin.side" width="16" height="16" class="wt-tex" />
      </pattern>
      <pattern :id="`${uid}-right`" patternUnits="userSpaceOnUse" width="16" height="16" :patternTransform="geometry.rightTransform">
        <image :href="skin.side" width="16" height="16" class="wt-tex" />
      </pattern>
    </defs>

    <polygon class="wt-plot" :points="geometry.plot" />

    <path class="wt-trace" :d="geometry.wire" />
    <rect class="wt-trace-dot" :x="geometry.wireEnd[0] - 3" :y="geometry.wireEnd[1] - 3" width="6" height="6" />

    <g class="wt-block">
      <polygon :points="geometry.top" :fill="`url(#${uid}-top)`" />
      <polygon :points="geometry.left" :fill="`url(#${uid}-left)`" />
      <polygon :points="geometry.right" :fill="`url(#${uid}-right)`" />
      <polygon class="wt-shade wt-shade-top" :points="geometry.top" />
      <polygon class="wt-shade wt-shade-left" :points="geometry.left" />
      <polygon class="wt-shade wt-shade-right" :points="geometry.right" />
      <polyline class="wt-edge-light" :points="geometry.frontEdge" />
      <polyline class="wt-edge-light wt-edge-vertical" :points="geometry.vertical" />
      <polygon class="wt-edge-outline" :points="geometry.outline" />
    </g>
  </svg>
</template>

<style scoped>
.world-thumb-art {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.wt-tex {
  image-rendering: pixelated;
}

.wt-plot {
  fill: rgba(255, 255, 255, 0.025);
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.wt-shade {
  pointer-events: none;
  transition: fill-opacity 0.25s;
}

.wt-shade-top {
  fill: #0a0b0e;
  fill-opacity: 0.18;
}

.wt-shade-left {
  fill: #0a0b0e;
  fill-opacity: 0.4;
}

.wt-shade-right {
  fill: #0a0b0e;
  fill-opacity: 0.58;
}

.wt-edge-light {
  fill: none;
  stroke: rgba(255, 255, 255, 0.22);
  stroke-width: 1;
  stroke-linejoin: round;
}

.wt-edge-vertical {
  stroke: rgba(255, 255, 255, 0.1);
}

.wt-edge-outline {
  fill: none;
  stroke: rgba(0, 0, 0, 0.6);
  stroke-width: 1;
  stroke-linejoin: round;
}

.wt-trace {
  fill: none;
  stroke: var(--rs-red-off);
  stroke-width: 3;
  stroke-linecap: square;
  stroke-linejoin: miter;
  transition: stroke 0.2s;
}

.wt-trace-dot {
  fill: var(--rs-red-dim);
  transition: fill 0.2s;
}

/* Powered by the parent card. */
:global(.world-card:hover) .wt-trace,
:global(.world-card:focus-within) .wt-trace {
  stroke: var(--rs-red-hot);
  filter: drop-shadow(0 0 3px rgba(255, 60, 30, 0.9));
}

:global(.world-card:hover) .wt-trace-dot,
:global(.world-card:focus-within) .wt-trace-dot {
  fill: #ffd0c0;
}

:global(.world-card:hover) .wt-shade-top,
:global(.world-card:focus-within) .wt-shade-top {
  fill-opacity: 0.06;
}

:global(.world-card:hover) .wt-shade-left,
:global(.world-card:focus-within) .wt-shade-left {
  fill-opacity: 0.3;
}

:global(.world-card:hover) .wt-shade-right,
:global(.world-card:focus-within) .wt-shade-right {
  fill-opacity: 0.48;
}
</style>
