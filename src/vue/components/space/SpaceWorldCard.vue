<script setup>
import { buildSpaceProjectionUrl } from '@three/utils/space-context.js'
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'
import SpaceWorldThumb from '@ui-components/space/SpaceWorldThumb.vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  item: {
    type: Object,
    default: null,
  },
  spaceName: {
    type: String,
    default: '',
  },
  // Resolved card image (admin upload or static capture); '' falls back to generated art.
  imageUrl: {
    type: String,
    default: '',
  },
  canManage: {
    type: Boolean,
    default: false,
  },
  isPendingDelete: {
    type: Boolean,
    default: false,
  },
  // "Create a new world" slot for owners.
  create: {
    type: Boolean,
    default: false,
  },
  createTitle: {
    type: String,
    default: '',
  },
  createDescription: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['enter', 'create', 'settings', 'requestDelete', 'confirmDelete'])

const { t, locale } = useI18n()

const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const lampOffUrl = resolvePublicAssetUrl(`${BLOCK_DIR}redstone_lamp.png`)
const lampOnUrl = resolvePublicAssetUrl(`${BLOCK_DIR}redstone_lamp_on.png`)

const imageFailed = ref(false)
const imageLoaded = ref(false)
watch(() => props.imageUrl, () => {
  imageFailed.value = false
  imageLoaded.value = false
})

const routeId = computed(() => String(props.item?.projectionSlug || props.item?.id || '').trim())
const href = computed(() => {
  if (!routeId.value || !props.spaceName) {
    return ''
  }
  try {
    return buildSpaceProjectionUrl(props.spaceName, routeId.value)
  }
  catch {
    return ''
  }
})

const showImage = computed(() => !!props.imageUrl && !imageFailed.value)
const isPrivate = computed(() => props.item?.visibility === 'private')
const title = computed(() => props.item?.title || props.item?.schematic?.name || routeId.value)
const author = computed(() => props.item?.schematic?.author || 'Unknown')

const blockCount = computed(() => {
  const item = props.item || {}
  return Number(item.preview?.totalSolidBlocks || item.previewModel?.totalSolidBlocks || item.schematic?.blockCount || 0)
})

const size = computed(() => {
  const item = props.item || {}
  const s = item.schematic?.size
  if (s && Number(s.x) && Number(s.y) && Number(s.z)) {
    return { x: Number(s.x), y: Number(s.y), z: Number(s.z) }
  }
  const b = item.preview?.bounds || item.previewModel?.bounds || item.schematic?.bounds
  if (b && Number.isFinite(b.maxX)) {
    return {
      x: (b.maxX - (b.minX || 0)) + 1,
      y: (b.maxY - (b.minY || 0)) + 1,
      z: (b.maxZ - (b.minZ || 0)) + 1,
    }
  }
  return null
})

const sizeLabel = computed(() => (size.value ? `${size.value.x}×${size.value.y}×${size.value.z}` : ''))

const formatLabel = computed(() => {
  const ext = /\.([a-z0-9]+)$/iu.exec(String(props.item?.fileName || ''))?.[1]
  return ext ? `.${ext.toUpperCase()}` : '.LITEMATIC'
})

const blockLabel = computed(() => {
  const formatted = new Intl.NumberFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US').format(blockCount.value)
  return t('space.card.blocks', { count: formatted })
})

function isPlainPrimaryClick(event) {
  return !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
}

function handleEnter(event) {
  // Keep native behaviour for new-tab clicks; otherwise route in-app.
  if (event && !isPlainPrimaryClick(event)) {
    return
  }
  event?.preventDefault()
  emit('enter', routeId.value)
}
</script>

<template>
  <article
    v-if="create"
    class="world-card placeholder-card rs-powerable"
  >
    <div class="world-card-thumb placeholder-thumb">
      <span class="lamp" aria-hidden="true">
        <img class="lamp-img rs-tex" :src="lampOffUrl" alt="" width="64" height="64">
        <img class="lamp-img lamp-on rs-tex" :src="lampOnUrl" alt="" width="64" height="64">
      </span>
      <svg class="add-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </div>
    <div class="card-wire rs-wire-line" aria-hidden="true" />
    <div class="world-card-content">
      <h3 class="world-title">
        <button type="button" class="world-link" @click="emit('create')">
          {{ createTitle }}
        </button>
      </h3>
      <p class="world-desc">
        {{ createDescription }}
      </p>
      <div class="world-card-foot">
        <span class="enter-cta" aria-hidden="true">
          <span class="enter-dot" />
          <span>.litematic / .schem</span>
        </span>
      </div>
    </div>
  </article>

  <article
    v-else
    class="world-card rs-powerable"
    :class="{ 'is-private': isPrivate }"
  >
    <div class="world-card-thumb">
      <div class="thumb-media" :class="{ 'has-image-thumb': showImage }">
        <SpaceWorldThumb :size="size" :seed="routeId" />
        <img
          v-if="showImage"
          class="thumb-image"
          :class="{ 'is-loaded': imageLoaded }"
          :src="imageUrl"
          :alt="t('space.card.previewAlt', { title })"
          loading="lazy"
          decoding="async"
          width="640"
          height="400"
          @load="imageLoaded = true"
          @error="imageFailed = true"
        >
      </div>
      <div class="thumb-badges">
        <span class="rs-chip tag-badge version-tag">{{ formatLabel }}</span>
        <span
          v-if="canManage"
          class="rs-chip tag-badge visibility-tag"
          :class="{ 'is-red': isPrivate, 'private': isPrivate }"
        >
          {{ isPrivate ? '私有' : '公开' }}
        </span>
      </div>
      <span v-if="sizeLabel" class="rs-chip thumb-size" :title="t('space.card.size')">{{ sizeLabel }}</span>
    </div>

    <div class="card-wire rs-wire-line" aria-hidden="true" />

    <div class="world-card-content">
      <h3 class="world-title">
        <a class="world-link" :href="href || undefined" @click="handleEnter">{{ title }}</a>
      </h3>
      <p class="world-desc">
        {{ item?.description || '点击此卡片可直接进入这个 3D 投影世界，并在浏览器中进行游览。' }}
      </p>

      <div class="world-meta">
        <span class="rs-chip meta-item meta-owner">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          <span class="meta-text">{{ author }}</span>
        </span>
        <span class="rs-chip meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
          <span class="meta-text">{{ blockLabel }}</span>
        </span>
      </div>

      <div class="world-card-foot">
        <span class="enter-cta" aria-hidden="true">
          <span class="enter-dot" />
          <span>{{ t('space.card.enter') }}</span>
          <svg class="enter-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></svg>
        </span>

        <div v-if="canManage" class="world-actions" @click.stop>
          <button
            type="button"
            class="rs-btn rs-btn--ghost rs-btn--sm btn-settings"
            title="世界设置"
            @click.stop.prevent="emit('settings', item)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51 2 2 0 1 1-4 0 1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33 2 2 0 1 1-2.83-2.83 1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1 2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 2.6a2 2 0 1 1 4 0 1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33 2 2 0 1 1 2.83 2.83 1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 21.4 10a2 2 0 1 1 0 4 1.65 1.65 0 0 0-1.51 1Z" /></svg>
            <span>设置</span>
          </button>
          <button
            v-if="!isPendingDelete"
            type="button"
            class="rs-btn rs-btn--ghost rs-btn--sm rs-btn--icon btn-delete"
            title="删除"
            aria-label="删除"
            @click.stop.prevent="emit('requestDelete', item?.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
          </button>
          <button
            v-else
            type="button"
            class="rs-btn rs-btn--sm btn-delete-confirm"
            @click.stop.prevent="emit('confirmDelete', item)"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.world-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--rs-line);
  border-radius: var(--rs-radius-lg);
  background: linear-gradient(180deg, var(--rs-bg-2), var(--rs-bg-1));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 10px 26px rgba(0, 0, 0, 0.32);
  color: var(--rs-text);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

.world-card:hover,
.world-card:focus-within {
  border-color: rgba(255, 74, 46, 0.55);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 14px 34px rgba(0, 0, 0, 0.45), var(--rs-glow-soft);
  transform: translateY(-2px);
}

/* Dust ring: redstone dust runs the card border while it is hovered. */
.world-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: inherit;
  padding: 1px;
  background: conic-gradient(
    from var(--dust-angle, 0deg),
    transparent 0deg,
    transparent 250deg,
    var(--rs-red-hot) 320deg,
    #ffd0c0 350deg,
    var(--rs-red-hot) 360deg
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

.world-card:hover::after,
.world-card:focus-within::after {
  opacity: 1;
  animation: world-card-dust 2.4s linear infinite;
}

@property --dust-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@keyframes world-card-dust {
  to { --dust-angle: 360deg; }
}

/* ---------------------------------------------------------------- thumb */

.world-card-thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background-color: #0b0c0f;
  background-image:
    radial-gradient(90% 75% at 50% 42%, rgba(255, 255, 255, 0.05), transparent 70%),
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: auto, 16px 16px, 16px 16px;
  background-position: center;
}

.thumb-media {
  position: absolute;
  inset: 0;
  filter: brightness(0.9) saturate(0.92);
  transition: filter 0.25s, transform 0.4s;
}

.world-card:hover .thumb-media,
.world-card:focus-within .thumb-media {
  filter: brightness(1.06) saturate(1.06);
}

.world-card:hover .thumb-media.has-image-thumb,
.world-card:focus-within .thumb-media.has-image-thumb {
  transform: scale(1.025);
}

.thumb-image {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s;
}

.thumb-image.is-loaded {
  opacity: 1;
}

/* Bottom fade so chips stay legible on bright captures. */
.world-card-thumb::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 44%;
  background: linear-gradient(180deg, transparent, rgba(8, 9, 11, 0.72));
  pointer-events: none;
}

.thumb-badges {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 1;
  display: flex;
  gap: 6px;
}

.thumb-size {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 1;
  color: var(--rs-text-2);
  text-transform: none;
}

.visibility-tag:not(.is-red) {
  border-color: rgba(63, 212, 122, 0.4);
  color: #9fe8bd;
  background: rgba(8, 30, 18, 0.7);
}

/* Redstone strip between the image and the text. */
.card-wire {
  position: relative;
  z-index: 1;
  flex: none;
}

.world-card:focus-within .card-wire {
  background: var(--rs-red-hot);
  box-shadow: var(--rs-glow);
}

/* -------------------------------------------------------------- content */

.world-card-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 16px 16px 14px;
}

.world-title {
  margin: 0;
  font: 650 17px/1.3 var(--rs-font-body);
  letter-spacing: 0;
  min-width: 0;
}

.world-link {
  display: block;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: none;
  color: var(--rs-text);
  font: inherit;
  text-align: left;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

/* Stretch the title link over the whole card. */
.world-link::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: var(--rs-radius-lg);
}

.world-link:focus-visible {
  outline: none;
}

.world-link:focus-visible::after {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: -2px;
}

.world-desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--rs-text-2);
  font-size: 13.5px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  min-height: calc(13.5px * 1.6 * 2);
}

.world-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.meta-item {
  max-width: 100%;
  min-width: 0;
}

.meta-item svg {
  flex: none;
  color: var(--rs-text-3);
}

.meta-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-owner {
  text-transform: none;
}

.world-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--rs-line);
}

.enter-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--rs-text-2);
  font-size: 13px;
  font-weight: 600;
  transition: color 0.2s;
}

.enter-dot {
  width: 6px;
  height: 6px;
  flex: none;
  background: var(--rs-red-dim);
  transition: background 0.2s, box-shadow 0.2s;
}

.enter-arrow {
  transition: transform 0.2s;
}

.world-card:hover .enter-cta,
.world-card:focus-within .enter-cta {
  color: #ffb3a4;
}

.world-card:hover .enter-dot,
.world-card:focus-within .enter-dot {
  background: var(--rs-red-hot);
  box-shadow: var(--rs-glow);
}

.world-card:hover .enter-arrow,
.world-card:focus-within .enter-arrow {
  transform: translateX(3px);
}

/* Admin actions sit above the stretched link. */
.world-actions {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
}

.world-actions .rs-btn {
  --rs-btn-h: 28px;
  gap: 6px;
  padding: 0 8px;
  color: var(--rs-text-2);
}

.world-actions .rs-btn--icon {
  width: 28px;
  padding: 0;
}

.btn-delete:hover {
  color: #ffb3a4;
}

.btn-delete-confirm {
  border-color: rgba(255, 74, 46, 0.7);
  background: rgba(92, 21, 16, 0.85);
  color: #fff !important;
}

/* ---------------------------------------------------------- create card */

.placeholder-card {
  border-style: dashed;
  border-color: var(--rs-line-strong);
  background: rgba(15, 17, 20, 0.6);
}

.placeholder-thumb {
  display: grid;
  place-items: center;
}

.lamp {
  position: relative;
  width: 64px;
  height: 64px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 8px 18px rgba(0, 0, 0, 0.5);
  transition: box-shadow 0.25s;
}

.lamp-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.lamp-on {
  opacity: 0;
  transition: opacity 0.2s;
}

.add-icon {
  position: absolute;
  left: calc(50% + 22px);
  top: calc(50% + 18px);
  padding: 4px;
  width: 28px;
  height: 28px;
  border: 1px solid var(--rs-line-strong);
  background: var(--rs-bg-3);
  color: var(--rs-text);
  z-index: 1;
  transition: background 0.2s, border-color 0.2s;
}

.placeholder-card:hover .lamp-on,
.placeholder-card:focus-within .lamp-on {
  opacity: 1;
}

.placeholder-card:hover .lamp,
.placeholder-card:focus-within .lamp {
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 28px rgba(255, 195, 90, 0.45);
}

.placeholder-card:hover .add-icon,
.placeholder-card:focus-within .add-icon {
  border-color: #ff5a3c;
  background: var(--rs-red);
}

.placeholder-card .enter-cta {
  font: 500 11px/1 var(--rs-font-mono);
  letter-spacing: 0.04em;
}

@media (prefers-reduced-motion: reduce) {
  .world-card,
  .thumb-media,
  .thumb-image,
  .enter-arrow {
    transition: none;
  }

  .world-card:hover,
  .world-card:focus-within {
    transform: none;
  }

  .world-card:hover::after,
  .world-card:focus-within::after {
    animation: none;
  }

  .world-card:hover .thumb-media.has-image-thumb,
  .world-card:focus-within .thumb-media.has-image-thumb,
  .world-card:hover .enter-arrow,
  .world-card:focus-within .enter-arrow {
    transform: none;
  }
}

@media (max-width: 640px) {
  .placeholder-thumb {
    aspect-ratio: 16 / 6;
  }
}

@media (hover: none) {
  .world-actions .rs-btn {
    --rs-btn-h: 32px;
  }
}
</style>
