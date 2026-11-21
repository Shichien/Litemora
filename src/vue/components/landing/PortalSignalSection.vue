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
//   --signal-dust       top-down tiles from the default resource pack
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'
import RedstoneTorch from '@ui-components/redstone/RedstoneTorch.vue'

defineProps({
  powered: { type: Boolean, default: false },
  // 'torch' | 'lamp' | 'none'
  marker: { type: String, default: 'torch' },
  as: { type: String, default: 'section' },
  // Rail start in px from the section top (the hero feeds the rail from its CTA).
  railTop: { type: Number, default: 0 },
  // Connect the rail to the content edge with a south/east bend.
  stub: { type: Boolean, default: false },
  // The rail ends at the marker instead of the section bottom.
  end: { type: Boolean, default: false },
})

const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const lampOff = resolvePublicAssetUrl(`${BLOCK_DIR}redstone_lamp.png`)
const lampOn = resolvePublicAssetUrl(`${BLOCK_DIR}redstone_lamp_on.png`)
</script>

<template>
  <component
    :is="as"
    class="signal-section"
    :class="{ 'is-powered': powered, 'is-end': end, 'has-stub': stub }"
    :style="{ '--rail-top': `${railTop}px` }"
  >
    <span class="signal-dust signal-rail" aria-hidden="true" />
    <template v-if="stub">
      <span class="signal-dust signal-stub" aria-hidden="true" />
      <span class="signal-dust signal-joint" aria-hidden="true" />
    </template>

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
  --_tile: 48px;
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

/* The atlas contains the three wire shapes at power 0, then at power 15. */
.signal-dust {
  --_column: 0;
  position: absolute;
  z-index: 1;
  left: calc(var(--_rail-x) - var(--_tile) / 2);
  width: var(--_tile);
  pointer-events: none;
}

.signal-dust,
.signal-dust::after {
  background: var(--signal-dust) repeat-y;
  background-size: auto var(--_tile);
  background-position: calc(0px - var(--_column) * var(--_tile)) var(--_phase, 0px);
  image-rendering: pixelated;
}

.signal-dust::after {
  content: '';
  position: absolute;
  inset: 0;
  background-position-x: calc((-3 - var(--_column)) * var(--_tile));
  clip-path: inset(0 0 100%);
}

.signal-section.is-powered > .signal-dust::after {
  clip-path: inset(0);
}

.signal-rail {
  --_phase: calc(var(--dust-offset, 0px) + var(--_tile) / 2);
  top: var(--rail-top);
  bottom: 0;
}

.signal-rail::after {
  transition: clip-path 0.6s steps(8, end);
}

.has-stub .signal-rail {
  --_phase: 0px;
  top: calc(var(--rail-top) + var(--_tile) / 2);
}

.is-end .signal-rail {
  bottom: auto;
  height: calc(var(--signal-marker-top, 96px) + 12px);
}

.signal-stub {
  --_column: 1;
  left: var(--_rail-x);
  top: var(--rail-top);
  height: calc((var(--signal-gutter) - var(--_tile)) / 2);
  transform-origin: 50% 0;
  transform: rotate(-90deg);
}

.signal-joint {
  --_column: 2;
  top: calc(var(--rail-top) - var(--_tile) / 2);
  height: var(--_tile);
}

/* Marker on the rail, level with the section heading. */
.signal-marker {
  --_mk: 48px;
  position: absolute;
  z-index: 1;
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

.signal-section.is-powered > .signal-marker .is-on {
  opacity: 1;
  transition-delay: 0.2s;
}

.signal-section.is-powered > .signal-marker .is-off {
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

.signal-section.is-powered > .signal-marker--lamp .is-on {
  box-shadow: 0 0 0 2px #050506, 0 0 22px rgba(255, 190, 90, 0.45);
  transition-delay: 0.8s;
}

.signal-section.is-powered > .signal-marker--lamp .is-off {
  transition-delay: 0.8s;
}

@media (max-width: 720px) {
  .signal-section {
    --_tile: 32px;
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
}
@media (prefers-reduced-motion: reduce) {
  .signal-rail::after,
  .signal-marker__layer {
    transition: none !important;
  }
}
</style>
