<script setup>
// Discover feed card: real thumbnail when one exists, otherwise a small iso build
// that powers on while the card is hovered or focused.
import IsoScene from '@ui-components/redstone/IsoScene.vue'
import { computed, ref, watch } from 'vue'
import { placeholderBuildScene } from './portal-scenes.js'

const props = defineProps({
  space: { type: Object, required: true },
  variant: { type: Number, default: 0 },
})

const active = ref(false)
const failedUrl = ref('')
watch(() => props.space.imageUrl, () => {
  failedUrl.value = ''
})

const showImage = computed(() => !!props.space.imageUrl && failedUrl.value !== props.space.imageUrl)
const blocks = computed(() => placeholderBuildScene(props.variant))

function onImageError() {
  failedUrl.value = props.space.imageUrl
}
</script>

<template>
  <a
    :href="space.url"
    class="discover-card rs-powerable"
    :class="{ 'is-active': active, 'has-image': showImage }"
    @mouseenter="active = true"
    @mouseleave="active = false"
    @focus="active = true"
    @blur="active = false"
  >
    <div class="discover-art">
      <img
        v-if="showImage"
        class="discover-art__img"
        :src="space.imageUrl"
        :alt="space.title"
        loading="lazy"
        decoding="async"
        @error="onImageError"
      >
      <div v-else class="discover-art__build">
        <IsoScene :blocks="blocks" :unit="40" :powered="active" />
      </div>
      <span class="discover-art__enter" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges">
          <path d="M3 7h7V4h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1V9H3z" fill="currentColor" />
        </svg>
      </span>
    </div>
    <div class="discover-info">
      <div class="avatar-placeholder">
        <img v-if="space.ownerAvatar" :src="space.ownerAvatar" :alt="space.author">
        <span v-else>{{ space.ownerInitial }}</span>
      </div>
      <div class="author-info">
        <h4>{{ space.title }}</h4>
        <p>{{ space.author }}</p>
      </div>
      <span class="discover-space-label">/{{ space.spaceLabel }}</span>
    </div>
  </a>
</template>

<style scoped>
.discover-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--rs-line);
  border-radius: var(--rs-radius-lg);
  background: var(--rs-bg-2);
  color: var(--rs-text);
  text-decoration: none;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 10px 24px rgba(0, 0, 0, 0.35);
  transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
}

/* Dust strip on the top edge, lit while the card is active. */
.discover-card::before {
  content: '';
  position: absolute;
  z-index: 2;
  left: 14px;
  right: 14px;
  top: 0;
  height: 2px;
  background: var(--rs-red-dim);
  transition: background 0.18s, box-shadow 0.18s;
}

.discover-card.is-active {
  border-color: rgba(255, 74, 46, 0.55);
  transform: translateY(-3px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 16px 32px rgba(0, 0, 0, 0.5), var(--rs-glow-soft);
}

.discover-card.is-active::before {
  background: var(--rs-red-hot);
  box-shadow: var(--rs-glow);
}

/* Dust ring: the card border powers up as a running redstone line. */
.discover-card::after {
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

.discover-card.is-active::after {
  opacity: 1;
  animation: discover-card-dust 2.4s linear infinite;
}

@property --dust-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@keyframes discover-card-dust {
  to { --dust-angle: 360deg; }
}

@media (prefers-reduced-motion: reduce) {
  .discover-card.is-active::after {
    animation: none;
  }
}

.discover-card:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 3px;
}

.discover-art {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background-color: var(--rs-bg-1);
  background-image:
    radial-gradient(70% 60% at 50% 62%, rgba(255, 60, 30, 0.08), transparent 70%),
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: auto, 24px 24px, 24px 24px;
  background-position: center, center, center;
  border-bottom: 1px solid var(--rs-line);
}

.discover-card.is-active .discover-art {
  background-image:
    radial-gradient(70% 60% at 50% 62%, rgba(255, 60, 30, 0.2), transparent 70%),
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
}

.discover-art__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.92) brightness(0.9);
  transition: filter 0.25s, transform 0.4s;
}

.discover-card.is-active .discover-art__img {
  filter: saturate(1.05) brightness(1);
  transform: scale(1.03);
}

.has-image .discover-art::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 55%, rgba(8, 9, 11, 0.55));
  pointer-events: none;
}

.discover-art__build {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding-top: 6px;
}

.discover-art__enter {
  position: absolute;
  z-index: 1;
  right: 10px;
  bottom: 10px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: rgba(8, 9, 11, 0.7);
  color: var(--rs-text-2);
  transition: background 0.18s, color 0.18s, border-color 0.18s;
}

.discover-card.is-active .discover-art__enter {
  border-color: #ff5a3c;
  background: var(--rs-red);
  color: #fff;
}

.discover-info {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 16px;
}

.avatar-placeholder {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border-radius: var(--rs-radius);
  background: var(--rs-bg-4);
  box-shadow: inset 0 0 0 1px var(--rs-line-strong);
  color: var(--rs-text);
  font: 700 14px/1 var(--rs-font-body);
}

.avatar-placeholder img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.author-info {
  min-width: 0;
}

.author-info h4 {
  margin: 0;
  overflow: hidden;
  font: 600 15px/1.35 var(--rs-font-body);
  color: var(--rs-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author-info p {
  margin: 2px 0 0;
  overflow: hidden;
  font: 400 13px/1.4 var(--rs-font-body);
  color: var(--rs-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discover-space-label {
  max-width: 9rem;
  overflow: hidden;
  padding: 3px 7px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: var(--rs-bg-0);
  color: var(--rs-text-2);
  font: 500 12px/1.3 var(--rs-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discover-card.is-active .discover-space-label {
  border-color: rgba(255, 74, 46, 0.5);
  color: #ffb4a6;
}

@media (prefers-reduced-motion: reduce) {
  .discover-card,
  .discover-art__img {
    transition: none;
  }

  .discover-card.is-active {
    transform: none;
  }

  .discover-card.is-active .discover-art__img {
    transform: none;
  }
}
</style>
