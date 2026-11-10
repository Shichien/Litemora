<script setup>
/**
 * Hotbar - 9 slots, only shown in block placement mode (Q).
 * Keys 1-9 select a slot; mouse wheel cycles while placing (handled in input.js).
 */
import { useHudStore } from '@pinia/hudStore.js'
import { resolveBlockTextureUrl } from '@three/world/terrain/block-texture-files.js'
import { getBlockTypeById } from '@three/world/terrain/blocks-config.js'
import { computed, reactive } from 'vue'

const hud = useHudStore()

const brokenIcons = reactive(new Set())

function blockIcon(blockId) {
  const keys = getBlockTypeById(blockId)?.textureKeys
  const key = keys?.side || keys?.all || keys?.top
  if (!key)
    return null

  const url = resolveBlockTextureUrl(key)
  if (!url)
    return null

  return brokenIcons.has(url) ? null : url
}

function blockLabel(blockId) {
  const name = getBlockTypeById(blockId)?.name || `#${blockId}`
  return String(name).replace(/^minecraft:/u, '').replace(/_/gu, ' ')
}

const slots = computed(() => hud.hotbarItems.map(item => item
  ? { ...item, icon: blockIcon(item.blockId), label: blockLabel(item.blockId) }
  : null))

const selectedLabel = computed(() => slots.value[hud.selectedSlot]?.label || '')
</script>

<template>
  <div class="hotbar" aria-label="快捷栏">
    <div class="hotbar-label" :class="{ 'is-empty': !selectedLabel }">
      {{ selectedLabel }}
    </div>
    <div class="hotbar-slots">
      <div
        v-for="(slot, index) in slots"
        :key="index"
        class="hotbar-slot"
        :class="{ selected: index === hud.selectedSlot }"
        :title="slot?.label"
      >
        <span class="slot-key">{{ index + 1 }}</span>
        <img v-if="slot?.icon" class="slot-icon" :src="slot.icon" :alt="slot.label" @error="brokenIcons.add(slot.icon)">
        <span v-else-if="slot" class="slot-text">{{ slot.label.slice(0, 2) }}</span>
        <span v-if="slot?.count > 1" class="slot-count">{{ slot.count }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hotbar {
  --slot: 44px;
  position: absolute;
  left: 50%;
  bottom: var(--hotbar-bottom, 22px);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}

/* Selected block name: a small stone tag */
.hotbar-label {
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--hud-edge, rgba(255, 255, 255, 0.12));
  border-radius: 2px;
  background: var(--hud-surface-strong, rgba(12, 14, 17, 0.88));
  color: var(--rs-text);
  font: 600 12px/20px var(--rs-font-body);
  letter-spacing: 0.01em;
  text-transform: capitalize;
  white-space: nowrap;
}

.hotbar-label.is-empty {
  visibility: hidden;
}

.hotbar-slots {
  display: flex;
  gap: 3px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--rs-radius-lg);
  background: rgba(10, 11, 14, 0.78);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

/* Deepslate slot */
.hotbar-slot {
  position: relative;
  width: var(--slot);
  height: var(--slot);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(0, 0, 0, 0.6);
  border-radius: 2px;
  background-color: var(--rs-bg-2);
  background-image:
    linear-gradient(rgba(14, 16, 19, 0.72), rgba(14, 16, 19, 0.82)),
    var(--rs-tex-deepslate-tiles);
  background-size: auto, 32px 32px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -2px 0 rgba(0, 0, 0, 0.35);
  image-rendering: pixelated;
}

/* Selected slot is powered: redstone frame + glow */
.hotbar-slot.selected {
  z-index: 1;
  border: 2px solid var(--rs-red-hot);
  background-image:
    linear-gradient(rgba(255, 74, 46, 0.16), rgba(60, 10, 6, 0.45)),
    var(--rs-tex-deepslate-tiles);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 10px rgba(255, 70, 40, 0.7), inset 0 0 8px rgba(255, 60, 30, 0.35);
}

.slot-icon {
  width: 28px;
  height: 28px;
  image-rendering: pixelated;
  filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.45));
}

.hotbar-slot.selected .slot-icon {
  width: 30px;
  height: 30px;
}

.slot-text {
  color: var(--rs-text);
  font: 700 12px/1 var(--rs-font-mono);
  text-transform: uppercase;
}

/* Key number on its own small tab so it stays readable over any icon */
.slot-key {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  min-width: 11px;
  height: 11px;
  padding: 0 2px;
  border-radius: 0 0 2px 0;
  background: rgba(8, 9, 11, 0.78);
  color: var(--rs-text-2);
  font: 600 9px/11px var(--rs-font-mono);
  text-align: center;
}

.hotbar-slot.selected .slot-key {
  background: var(--rs-red-hot);
  color: #fff;
}

.slot-count {
  position: absolute;
  right: 3px;
  bottom: 2px;
  color: #fff;
  font: 700 11px/1 var(--rs-font-mono);
  text-shadow: 0 1px 0 #000, 1px 0 0 #000;
}

@media (max-width: 620px) {
  .hotbar {
    --slot: 36px;
  }

  .slot-icon {
    width: 24px;
    height: 24px;
  }

  .hotbar-slot.selected .slot-icon {
    width: 26px;
    height: 26px;
  }
}
</style>
