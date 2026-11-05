<script setup>
/**
 * Hotbar - 9 slots, only shown in block placement mode (Q).
 * Keys 1-9 select a slot; mouse wheel cycles while placing (handled in input.js).
 */
import { useHudStore } from '@pinia/hudStore.js'
import sources from '@three/sources.js'
import { resolvePublicAssetUrl } from '@three/utils/public-asset-url.js'
import { getBlockTypeById } from '@three/world/terrain/blocks-config.js'
import { computed, reactive } from 'vue'

const hud = useHudStore()

// Loose block textures were folded into the atlas; icons come from the bundled default pack.
const PACK_BLOCK_TEXTURE_DIR = 'minecraft-default-pack/assets/minecraft/textures/block'
const textureFileByName = Object.fromEntries(
  sources.filter(source => source.type === 'texture').map(source => [source.name, source.path.split('/').pop()]),
)
const brokenIcons = reactive(new Set())

function blockIcon(blockId) {
  const keys = getBlockTypeById(blockId)?.textureKeys
  const key = keys?.side || keys?.all || keys?.top
  if (!key)
    return null
  const file = textureFileByName[key] || `${String(key).replace(/^minecraft:(block\/)?/u, '')}.png`
  const url = resolvePublicAssetUrl(`${PACK_BLOCK_TEXTURE_DIR}/${file}`)
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
    <div class="hotbar-label">
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

.hotbar-label {
  min-height: 18px;
  color: #fff;
  font-size: 14px;
  text-shadow: 1px 1px 0 #3f3f3f;
  text-transform: capitalize;
}

.hotbar-slots {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: rgba(0, 0, 0, 0.55);
  border: 2px solid rgba(255, 255, 255, 0.25);
}

.hotbar-slot {
  position: relative;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.12);
}

.hotbar-slot.selected {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6);
}

.slot-icon {
  width: 30px;
  height: 30px;
  image-rendering: pixelated;
}

.slot-text {
  color: #ddd;
  font-size: 12px;
  text-transform: uppercase;
}

.slot-key {
  position: absolute;
  top: 1px;
  left: 3px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 9px;
}

.slot-count {
  position: absolute;
  right: 3px;
  bottom: 1px;
  color: #fff;
  font-size: 12px;
  text-shadow: 1px 1px 0 #3f3f3f;
}
</style>
