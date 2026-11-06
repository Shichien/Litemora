<script setup>
// A page section with a redstone dust rail running down its left gutter.
// Stacked sections butt their rails together into one continuous line; each
// segment lights (top to bottom) when `powered` turns on, and its marker
// (torch or lamp) lights as the signal reaches it.
//
// Layout comes from CSS variables set by the page:
//   --signal-inset      outer horizontal padding
//   --signal-gutter     width of the rail gutter (content starts after it)
//   --signal-pad-top    space above the section content
//   --signal-marker-top marker offset from the section top
//   --signal-dust-line  mask url of the dust texture (vertical)
//   --signal-dust-dot   mask url of the dust dot texture
import RedstoneTorch from '@ui-components/redstone/RedstoneTorch.vue'
import { computed } from 'vue'
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'

const props = defineProps({
  powered: { type: Boolean, default: false },
  // 'torch' | 'lamp' | 'none'
  marker: { type: String, default: 'torch' },
  as: { type: String, default: 'section' },
  // Rail start in px from the section top (the hero feeds the rail from its CTA).
  railTop: { type: Number, default: 0 },
  // Optional horizontal stub at railTop, running right for this many px.
  stub: { type: Number, default: 0 },
  // The rail ends at the marker instead of the section bottom.
  end: { type: Boolean, default: false },
})

const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const lampOff = resolvePublicAssetUrl(`${BLOCK_DIR}redstone_lamp.png`)
const lampOn = resolvePublicAssetUrl(`${BLOCK_DIR}redstone_lamp_on.png`)

const railStyle = computed(() => (props.railTop > 0 ? { top: `${props.railTop}px` } : null))
const stubStyle = computed(() => ({ top: `${props.railTop}px`, height: `${Math.max(0, props.stub)}px` }))
</script>

<template>
  <component
    :is="as"
    class="signal-section"
    :class="{ 'is-powered': powered, 'is-end': end, [`has-${marker}`]: marker !== 'none' }"
  >
    <span class="signal-rail" :style="railStyle" aria-hidden="true">
      <span class="signal-rail__glow" />
      <span class="signal-rail__on" />
    </span>
    <span v-if="stub > 0" class="signal-stub" :style="stubStyle" aria-hidden="true">
      <span class="signal-rail__on" />
    </span>
    <span v-if="stub > 0" class="signal-joint" :style="{ top: `${railTop}px` }" aria-hidden="true" />

    <span v-if="marker === 'torch'" class="signal-marker" aria-hidden="true">
      <span class="signal-marker__layer is-off"><RedstoneTorch :lit="false" :size="48" /></span>
      <span class="signal-marker__layer is-on"><RedstoneTorch :size="48" /></span>
    </span>
    <span v-else-if="marker === 'lamp'" class="signal-marker signal-marker--lamp" aria-hidden="true">
      <img class="signal-marker__layer is-off rs-tex" :src="lampOff" alt="" draggable="false">
      <img class="signal-marker__layer is-on rs-tex" :src="lampOn" alt="" draggable="false">
    </span>

    <div class="signal-body">
      <slot />
    </div>
  </component>
</template>

<style scoped>
.signal-section {
  --_rail-w: 32px;
  --_core: 4px;
  --_rail-x: calc(var(--signal-inset, 24px) + var(--signal-gutter, 64px) / 2);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--signal-max, 1320px);
  margin-inline: auto;
  padding-top: var(--signal-pad-top, 96px);
  padding-left: calc(var(--signal-inset, 24px) + var(--signal-gutter, 64px));
  padding-right: var(--signal-inset, 24px);
}

.signal-body {
  position: relative;
  min-width: 0;
}

/* Rail: a column of tiled dust texture. Off = dark dust, on = lit dust + travelling pulse. */
.signal-rail,
.signal-stub {
  position: absolute;
  left: calc(var(--_rail-x) - var(--_rail-w) / 2);
  width: var(--_rail-w);
  pointer-events: none;
}

.signal-rail {
  top: 0;
  bottom: 0;
}

.is-end .signal-rail {
  bottom: auto;
  height: calc(var(--signal-marker-top, 96px) + 12px);
}

/* Mask = a solid wire core plus the scattered dust texture around it. */
.signal-rail::before,
.signal-stub::before,
.signal-rail__on {
  content: '';
  position: absolute;
  inset: 0;
  -webkit-mask:
    linear-gradient(90deg, transparent calc(50% - var(--_core) / 2), #000 calc(50% - var(--_core) / 2), #000 calc(50% + var(--_core) / 2), transparent calc(50% + var(--_core) / 2)),
    var(--signal-dust-line) center top / var(--_rail-w) var(--_rail-w) repeat-y;
  mask:
    linear-gradient(90deg, transparent calc(50% - var(--_core) / 2), #000 calc(50% - var(--_core) / 2), #000 calc(50% + var(--_core) / 2), transparent calc(50% + var(--_core) / 2)),
    var(--signal-dust-line) center top / var(--_rail-w) var(--_rail-w) repeat-y;
}

.signal-rail::before,
.signal-stub::before {
  background: #5a1610;
}

.signal-rail__on {
  background:
    linear-gradient(180deg, transparent 0, rgba(255, 214, 196, 0.95) 50%, transparent 100%) 0 -180px / 100% 180px no-repeat,
    var(--rs-red-hot);
  clip-path: inset(0 0 100% 0);
  transition: clip-path 0.9s steps(9, end);
}

.signal-rail__glow {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 20%, rgba(255, 50, 25, 0.16) 50%, transparent 80%);
  clip-path: inset(0 0 100% 0);
  transition: clip-path 0.9s steps(9, end);
}

.is-powered .signal-rail__on,
.is-powered .signal-rail__glow {
  clip-path: inset(0);
}

.is-powered .signal-rail__on {
  animation: signal-pulse 2.8s linear 0.9s infinite;
}

/* Horizontal stub: the same vertical strip, rotated to run right from the rail. */
.signal-stub {
  transform-origin: 50% 0;
  transform: rotate(-90deg);
}

.signal-stub .signal-rail__on {
  animation: none;
  transition-duration: 0.3s;
  transition-timing-function: steps(3, end);
}

.signal-joint {
  position: absolute;
  left: calc(var(--_rail-x) - 5px);
  width: 10px;
  height: 10px;
  margin-top: -5px;
  background: #5a1610;
  transition: background 0.2s, box-shadow 0.2s;
}

.is-powered .signal-joint {
  background: var(--rs-red-hot);
  box-shadow: 0 0 8px rgba(255, 60, 30, 0.7);
}

@keyframes signal-pulse {
  from {
    background-position: 0 -180px, 0 0;
  }
  to {
    background-position: 0 calc(100% + 180px), 0 0;
  }
}

/* Marker on the rail, level with the section heading. */
.signal-marker {
  --_mk: 48px;
  position: absolute;
  left: calc(var(--_rail-x) - var(--_mk) / 2);
  top: calc(var(--signal-marker-top, 96px) - var(--_mk) / 2 + 8px);
  width: var(--_mk);
  height: var(--_mk);
  pointer-events: none;
}

.signal-marker::before {
  /* Stone socket so the torch reads as mounted on the line. */
  content: '';
  position: absolute;
  left: 50%;
  bottom: -4px;
  width: 20px;
  height: 10px;
  translate: -50% 0;
  background: var(--rs-tex-polished-deepslate) center / 16px 16px;
  image-rendering: pixelated;
  box-shadow: 0 0 0 1px #050506, 0 3px 0 rgba(0, 0, 0, 0.5);
}

.signal-marker__layer {
  position: absolute;
  inset: 0;
  display: block;
  transition: opacity 0.25s steps(2, end);
}

.signal-marker__layer :deep(.rs-torch) {
  width: var(--_mk);
  height: var(--_mk);
}

.signal-marker__layer.is-on {
  opacity: 0;
}

.is-powered .signal-marker__layer.is-on {
  opacity: 1;
  transition-delay: 0.2s;
}

.is-powered .signal-marker__layer.is-off {
  opacity: 0;
  transition-delay: 0.2s;
}

.signal-marker--lamp {
  --_mk: 36px;
  top: var(--signal-marker-top, 96px);
}

.signal-marker--lamp::before {
  display: none;
}

.signal-marker--lamp .signal-marker__layer {
  width: var(--_mk);
  height: var(--_mk);
  box-shadow: 0 0 0 2px #050506;
}

.is-powered .signal-marker--lamp .signal-marker__layer.is-on {
  box-shadow: 0 0 0 2px #050506, 0 0 22px rgba(255, 190, 90, 0.45);
  transition-delay: 0.8s;
}

.is-powered .signal-marker--lamp .signal-marker__layer.is-off {
  transition-delay: 0.8s;
}

@media (max-width: 720px) {
  .signal-section {
    --_rail-w: 16px;
    --_core: 3px;
  }

  .signal-marker {
    --_mk: 32px;
  }

  .signal-marker::before {
    width: 14px;
    height: 7px;
    bottom: -3px;
  }

  .signal-marker--lamp {
    --_mk: 24px;
  }

  .signal-joint {
    left: calc(var(--_rail-x) - 4px);
    width: 8px;
    height: 8px;
    margin-top: -4px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .signal-rail__on,
  .signal-rail__glow,
  .signal-marker__layer {
    transition: none !important;
  }

  .is-powered .signal-rail__on {
    animation: none;
  }
}
</style>
