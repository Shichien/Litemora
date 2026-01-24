<script setup>
import { useSettingsStore } from '@pinia/settingsStore.js'
import { computed } from 'vue'

/**
 * PlayerPreview - 左下角玩家正面预览装饰层
 * 仅提供 CSS 边框装饰，实际渲染由 Three.js 通过 Viewport 直接完成
 * 采用 GPU-only 方案，无需处理像素数据
 *
 * 左侧装备栏：武器、（空）、盾牌
 * 右侧装备栏：头盔、胸甲、护腿
 */

const settings = useSettingsStore()

// 计算是否显示预览
const isVisible = computed(() => settings.frontViewEnabled)

// 左侧装备插槽配置（从上到下）
const leftSlots = [
  { id: 'weapon', icon: '/img/slots/weapon.webp', alt: 'Weapon' },
  { id: 'boots', icon: '/img/slots/boots.webp', alt: 'Boots' },
  { id: 'shield', icon: '/img/slots/shield.webp', alt: 'Shield' },
]

// 右侧装备插槽配置（从上到下）
const rightSlots = [
  { id: 'helmet', icon: '/img/slots/helmet.webp', alt: 'Helmet' },
  { id: 'chestplate', icon: '/img/slots/chestplate.webp', alt: 'Chestplate' },
  { id: 'leggings', icon: '/img/slots/leggings.webp', alt: 'Leggings' },
]
</script>

<template>
  <div v-if="isVisible" class="player-preview-container">
    <!-- 左侧装备栏 -->
    <div class="equipment-slots left-slots">
      <div v-for="slot in leftSlots" :key="slot.id" class="slot">
        <img :src="slot.icon" :alt="slot.alt" class="slot-icon">
      </div>
    </div>

    <!-- 玩家预览区域（Three.js Viewport 渲染区） -->
    <div class="player-preview">
      <!-- 纯装饰层：边框由 CSS 提供，内容由 Three.js Viewport 渲染 -->
    </div>

    <!-- 右侧装备栏 -->
    <div class="equipment-slots right-slots">
      <div v-for="slot in rightSlots" :key="slot.id" class="slot">
        <img :src="slot.icon" :alt="slot.alt" class="slot-icon">
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-preview-container {
  align-items: center;
  bottom: calc(8px * var(--hud-scale));
  display: flex;
  gap: 12px;
  left: calc(40px * var(--hud-scale));
  pointer-events: none;
  position: absolute;
}

.player-preview {
  background: transparent;
  border: 3px solid hsla(0, 0%, 100%, 0.4);
  border-radius: 4px;
  height: 250px;
  overflow: hidden;
  width: 180px;
}

.equipment-slots {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slot {
  align-items: center;
  background: hsla(0, 0%, 0%, 0.5);
  border: 2px solid hsla(0, 0%, 100%, 0.3);
  border-radius: 6px;
  display: flex;
  height: 52px;
  justify-content: center;
  width: 52px;
}

.slot-icon {
  height: 36px;
  image-rendering: pixelated;
  opacity: 0.5;
  width: 36px;
}
</style>
