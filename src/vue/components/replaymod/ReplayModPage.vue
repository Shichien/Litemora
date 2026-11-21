<script setup>
import { loadAdminAuthSession } from '@three/auth/admin-auth.js'
import { fetchGalleryItemSource } from '@three/gallery/gallery-api.js'
import SpaceBreadcrumbs from '@ui-components/space/SpaceBreadcrumbs.vue'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import ReplayModViewer from './ReplayModViewer.vue'

const props = defineProps({
  item: { type: Object, required: true },
  spaceName: { type: String, required: true },
  projectionId: { type: String, required: true },
})
const source = shallowRef(null)
const error = ref('')
let token = 0
watch(() => [props.spaceName, props.projectionId, props.item], async () => {
  const current = ++token
  source.value = null
  error.value = ''
  try {
    const payload = await fetchGalleryItemSource(props.spaceName, props.projectionId, loadAdminAuthSession(), props.item.sourceFile)
    if (current === token)
      source.value = payload
  }
  catch (reason) {
    if (current === token)
      error.value = `录像加载失败：${reason.message}`
  }
}, { immediate: true })
onBeforeUnmount(() => {
  token++
})
</script>

<template>
  <main class="replay-page">
    <SpaceBreadcrumbs :space-name="spaceName" :projection-id="projectionId" />
    <div class="replay-page-title">
      <h1>{{ item.title }}</h1><span>ReplayMod · {{ item.replay?.minecraftVersion || '' }}</span>
    </div>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="!source" role="status">
      正在读取原始录像…
    </p>
    <ReplayModViewer v-if="source" :key="`${spaceName}:${projectionId}`" :source-file="source" :title="item.title" />
  </main>
</template>

<style scoped>
.replay-page { max-width: 1600px; min-height: 100vh; padding: clamp(16px, 3vw, 40px); margin: auto; }
.replay-page-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 18px; margin: 28px 0 18px; }
.replay-page-title h1 { font-size: 28px; font-weight: 700; }
.replay-page-title span { opacity: .7; font-size: 14px; }
</style>
