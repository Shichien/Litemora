<script setup>
import { THUMBNAIL_SKIES, thumbnailSkyImage } from '@three/gallery/thumbnail-skies.js'
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

const selected = defineModel({ type: String, required: true })
const group = useId()
const { t } = useI18n()
</script>

<template>
  <fieldset class="sky-picker">
    <legend>{{ t('thumbnailSky.label') }}</legend>
    <div class="sky-options">
      <label v-for="sky in THUMBNAIL_SKIES" :key="sky" class="sky-option">
        <input v-model="selected" type="radio" :name="group" :value="sky">
        <span class="sky-swatch" :style="{ backgroundImage: thumbnailSkyImage(sky) }" aria-hidden="true" />
        <span>{{ t(`thumbnailSky.${sky}`) }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.sky-picker { min-width: 0; margin: 16px 0; padding: 0; border: 0; }
.sky-picker legend { margin-bottom: 8px; padding: 0; font-weight: 600; }
.sky-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 90px), 1fr)); gap: 8px; }
.sky-option { position: relative; display: grid; gap: 5px; padding: 4px 4px 6px; border: 1px solid #78818b; border-radius: 5px; font-size: 12px; text-align: center; cursor: pointer; }
.sky-option input { position: absolute; top: 7px; right: 7px; margin: 0; accent-color: #ae3421; }
.sky-swatch { display: block; aspect-ratio: 16 / 9; border-radius: 2px; background-position: center; background-size: cover; }
.sky-option:has(:checked) { border-color: currentColor; box-shadow: inset 0 0 0 1px currentColor; font-weight: 700; }
.sky-option:has(:focus-visible) { outline: 2px solid currentColor; outline-offset: 2px; }
.sky-picker:disabled .sky-option { cursor: default; }
</style>
