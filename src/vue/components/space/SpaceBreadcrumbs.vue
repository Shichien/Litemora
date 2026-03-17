<script setup>
import { loadAdminAuthSession } from '@three/auth/admin-auth.js'
import { fetchGalleryItem } from '@three/gallery/gallery-api.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceWorldsUrl } from '@three/utils/space-context.js'
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
})

const projectionTitle = ref('')

const crumbs = computed(() => {
  const items = [
    {
      label: 'Home',
      href: window.location.origin,
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

function handleNavigate(href) {
  if (!href) {
    return
  }
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
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <button
      v-for="(crumb, index) in crumbs"
      :key="`${crumb.label}-${index}`"
      type="button"
      class="crumb"
      :class="{ inactive: !crumb.href }"
      @click="handleNavigate(crumb.href)"
    >
      <span>{{ crumb.label }}</span>
      <span v-if="index < crumbs.length - 1" class="divider">/</span>
    </button>
  </nav>
</template>

<style scoped>
.breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  color: rgba(232, 242, 248, 0.92);
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: none;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
  cursor: pointer;
}

.crumb.inactive {
  cursor: default;
}

.divider {
  color: rgba(180, 200, 214, 0.48);
}
</style>
