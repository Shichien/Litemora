<script setup>
import { loadAdminAuthSession } from '@three/auth/admin-auth.js'
import { fetchGalleryItem } from '@three/gallery/gallery-api.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceWorldsUrl } from '@three/utils/space-context.js'
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  spaceName: {
    type: String,
    default: '',
  },
  projectionId: {
    type: String,
    default: '',
  },
  // Optional trailing crumb for sub-pages of a space (e.g. profile settings).
  currentLabel: {
    type: String,
    default: '',
  },
  // 'overlay': glass pill for use over the 3D world (default, used by App.vue).
  // 'inline': no panel, for page top bars that already have a surface.
  variant: {
    type: String,
    default: 'overlay',
  },
})

const homeIconUrl = resolvePublicAssetUrl('minecraft-default-pack/assets/minecraft/textures/block/redstone_block.png')
const projectionTitle = ref('')

const crumbs = computed(() => {
  const items = [
    {
      label: 'Home',
      href: window.location.origin,
      home: true,
    },
  ]

  if (props.spaceName) {
    items.push({
      label: props.spaceName,
      href: buildSpaceWorldsUrl(props.spaceName),
    })
  }

  if (props.projectionId) {
    items.push({
      label: projectionTitle.value || props.projectionId,
      href: '',
    })
  }
  else if (props.currentLabel) {
    items.push({
      label: props.currentLabel,
      href: '',
    })
  }

  // The last crumb is the current location: render it as plain text.
  const last = items[items.length - 1]
  if (last && items.length > 1) {
    last.current = true
  }

  return items
})

async function loadProjectionTitle() {
  projectionTitle.value = ''
  if (!props.spaceName || !props.projectionId) {
    return
  }

  try {
    const session = loadAdminAuthSession()
    const payload = await fetchGalleryItem(props.spaceName, props.projectionId, session)
    const item = payload?.item || null
    projectionTitle.value = item?.title || item?.schematic?.name || props.projectionId
  }
  catch {
    projectionTitle.value = props.projectionId
  }
}

function handleAuthChanged() {
  void loadProjectionTitle()
}

function handleNavigate(event, href) {
  if (!href) {
    return
  }
  // Let the browser handle new-tab / new-window clicks.
  if (event && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
    return
  }
  event?.preventDefault()
  navigateToUrl(href)
}

onMounted(() => {
  window.addEventListener('admin-auth-changed', handleAuthChanged)
  void loadProjectionTitle()
})

onBeforeUnmount(() => {
  window.removeEventListener('admin-auth-changed', handleAuthChanged)
})

watch(
  () => [props.spaceName, props.projectionId],
  () => {
    void loadProjectionTitle()
  },
)
</script>

<template>
  <nav
    class="breadcrumbs"
    :class="variant === 'inline' ? 'is-inline' : 'rs-panel rs-panel--glass is-overlay'"
    aria-label="Breadcrumb"
  >
    <ol class="crumb-list">
      <li
        v-for="(crumb, index) in crumbs"
        :key="`${crumb.label}-${index}`"
        class="crumb-item"
        :class="{ 'is-current': crumb.current }"
      >
        <span v-if="index > 0" class="divider" aria-hidden="true" />
        <a
          v-if="crumb.href && !crumb.current"
          class="crumb"
          :class="{ 'is-home': crumb.home }"
          :href="crumb.href"
          :aria-label="crumb.home ? crumb.label : undefined"
          @click="handleNavigate($event, crumb.href)"
        >
          <img v-if="crumb.home" class="crumb-home-icon rs-tex" :src="homeIconUrl" alt="" width="16" height="16">
          <span class="crumb-label">{{ crumb.label }}</span>
        </a>
        <span
          v-else
          class="crumb inactive"
          :class="{ 'is-home': crumb.home }"
          :aria-current="crumb.current ? 'page' : undefined"
        >
          <img v-if="crumb.home" class="crumb-home-icon rs-tex" :src="homeIconUrl" alt="" width="16" height="16">
          <span class="crumb-label">{{ crumb.label }}</span>
        </span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.breadcrumbs {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  color: var(--rs-text-2);
  font: 500 13px/1 var(--rs-font-body);
}

.breadcrumbs.is-overlay {
  height: 40px;
  padding: 0 14px 0 10px;
  border-color: var(--rs-line-strong);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 8px 24px rgba(0, 0, 0, 0.35);
}

.crumb-list {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.crumb-item {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  flex: none;
}

.crumb-item.is-current {
  flex: 0 1 auto;
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--rs-radius);
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s;
}

a.crumb:hover {
  color: var(--rs-text);
  background: var(--rs-red-soft);
}

a.crumb:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 1px;
}

.crumb.inactive {
  cursor: default;
}

.is-current .crumb {
  color: var(--rs-text);
  font-weight: 600;
}

.crumb-label {
  min-width: 0;
  max-width: 28ch;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb-home-icon {
  width: 16px;
  height: 16px;
  flex: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  transition: filter 0.15s;
}

a.crumb.is-home:hover .crumb-home-icon {
  filter: drop-shadow(0 0 4px rgba(255, 70, 40, 0.8));
}

/* Redstone dust dot between crumbs. */
.divider {
  width: 4px;
  height: 4px;
  margin: 0 6px;
  flex: none;
  background: var(--rs-red-dim);
}

.is-current .divider {
  background: var(--rs-red-hot);
  box-shadow: 0 0 4px rgba(255, 70, 40, 0.75);
}

@media (max-width: 560px) {
  .crumb-label {
    max-width: 16ch;
  }

  .is-home .crumb-label {
    display: none;
  }
}
</style>
