<script setup>
// Pixel redstone torch from the default pack, with a flickering glow when lit.
import { computed } from 'vue'
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'

const props = defineProps({
  lit: { type: Boolean, default: true },
  // Rendered height in px; multiples of 16 keep the pixels square.
  size: { type: Number, default: 32 },
})

const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const src = computed(() => resolvePublicAssetUrl(`${BLOCK_DIR}${props.lit ? 'redstone_torch' : 'redstone_torch_off'}.png`))
</script>

<template>
  <span class="rs-torch" :class="{ 'is-lit': lit }" :style="{ '--rs-torch-size': `${size}px` }" aria-hidden="true">
    <span v-if="lit" class="rs-torch__glow" />
    <img class="rs-torch__img" :src="src" alt="" draggable="false">
  </span>
</template>

<style scoped>
.rs-torch {
  position: relative;
  display: inline-block;
  width: var(--rs-torch-size);
  height: var(--rs-torch-size);
  flex: none;
}

.rs-torch__img {
  position: relative;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  pointer-events: none;
  user-select: none;
}

.rs-torch__glow {
  position: absolute;
  left: 50%;
  top: 22%;
  width: 160%;
  height: 160%;
  translate: -50% -50%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 70, 40, 0.55) 0%, rgba(255, 40, 20, 0.18) 38%, transparent 70%);
  animation: rs-flicker 2.6s ease-in-out infinite;
  pointer-events: none;
}
</style>
