<script setup>
import { loadAdminAuthSession } from '@three/auth/admin-auth.js'
import { checkProjectionNameAvailability, createGalleryItem } from '@three/gallery/gallery-api.js'
import { SUPPORTED_REPLAYMOD_VERSIONS } from '@three/replaymod/replaymod-data.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { isValidProjectionName, sanitizeProjectionNameInput } from '@three/utils/projection-name.js'
import { buildSpaceProjectionUrl, getActiveSpaceName } from '@three/utils/space-context.js'
import ThumbnailSkyPicker from '@ui-components/admin/ThumbnailSkyPicker.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ReplayModViewer from './ReplayModViewer.vue'

const props = defineProps({ file: { type: Object, required: true } })
defineEmits(['clear'])
const viewer = ref(null)
const name = ref('')
const visibility = ref('public')
const thumbnailSky = ref('noon')
const info = ref(null)
const saving = ref(false)
const message = ref('')
let revision = 0
onBeforeUnmount(() => {
  revision++
})
const tooLarge = computed(() => props.file.size > 15 * 1024 * 1024)
watch(() => props.file, (file) => {
  revision++
  name.value = sanitizeProjectionNameInput(file.name.replace(/\.mcpr$/i, '')) || 'Replay'
  info.value = null
  thumbnailSky.value = 'noon'
  message.value = ''
}, { immediate: true })
async function save() {
  if (!info.value || saving.value || tooLarge.value)
    return
  const session = loadAdminAuthSession()
  if (!session?.account?.id) {
    message.value = '请先登录再保存录像。'
    return
  }
  if (!isValidProjectionName(name.value)) {
    message.value = '作品名称仅支持英文字母和数字。'
    return
  }
  const currentRevision = revision
  const file = props.file
  const replayInfo = info.value
  const title = name.value
  const selectedVisibility = visibility.value
  const selectedSky = thumbnailSky.value
  saving.value = true
  message.value = '正在保存原始录像…'
  try {
    const spaceName = getActiveSpaceName()
    const thumbnailDataUrl = viewer.value.capturePreviewThumbnail()
    const availability = await checkProjectionNameAvailability(spaceName, title, session)
    if (currentRevision !== revision)
      return
    if (!availability.available)
      throw new Error('已存在同名作品，请换一个名称')
    const payload = await createGalleryItem({
      spaceName,
      title,
      projectionName: title,
      file,
      visibility: selectedVisibility,
      thumbnailSky: selectedSky,
      thumbnailDataUrl,
      replay: {
        minecraftVersion: replayInfo.metadata.minecraftVersion,
        protocolVersion: replayInfo.metadata.protocolVersion,
        durationMs: replayInfo.durationMs,
      },
      session,
    })
    if (currentRevision !== revision)
      return
    const id = payload.item?.projectionSlug || payload.item?.id
    if (!id)
      throw new Error('服务器没有返回作品编号')
    message.value = '录像已保存，正在打开…'
    navigateToUrl(buildSpaceProjectionUrl(spaceName, id))
  }
  catch (error) {
    if (currentRevision === revision)
      message.value = `保存失败：${error.message}`
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="replay-import">
    <div class="replay-fields">
      <label>作品名称<input v-model="name" :disabled="saving" maxlength="48" aria-label="录像作品名称" @input="name = sanitizeProjectionNameInput(name)"></label>
      <label>可见性<select v-model="visibility" :disabled="saving" aria-label="录像可见性"><option value="public">公开</option><option value="private">私有</option></select></label>
      <span>{{ file.name }} · {{ (file.size / 1024 / 1024).toFixed(2) }} MiB</span>
    </div>
    <p class="replay-message">
      支持 Java {{ SUPPORTED_REPLAYMOD_VERSIONS.join('、') }} 的原始 .mcpr 录像；本地文件上限 128 MiB。
    </p>
    <ThumbnailSkyPicker v-model="thumbnailSky" :disabled="saving" />
    <ReplayModViewer ref="viewer" :source-file="file" :title="name" :thumbnail-sky="thumbnailSky" @ready="info = $event" @error="info = null" />
    <p v-if="tooLarge" class="replay-message">
      录像可以在这里本地播放；当前作品存储上限为 15 MiB，此文件无法保存到空间。可在 ReplayMod 中另存较短的录像后再导入。
    </p>
    <p v-else class="replay-message">
      保存原始 .mcpr 文件，访客可在作品页面播放。公开作品也会公开录像中录下的场景。
    </p>
    <div class="replay-actions">
      <button :disabled="!info || saving || tooLarge" @click="save">
        {{ saving ? '保存中…' : '保存录像作品' }}
      </button>
      <button :disabled="saving" @click="$emit('clear')">
        清除录像
      </button>
      <span role="status">{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.replay-import { margin-top: 16px; }
.replay-fields { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-bottom: 14px; }
.replay-fields label { display: flex; align-items: center; gap: 8px; }
.replay-fields input, .replay-fields select { padding: 8px; border: 1px solid #74847d; border-radius: 5px; background: #fff; color: #233226; }
.replay-fields > span, .replay-message { font-size: 13px; line-height: 1.7; }
.replay-message { margin: 12px 0; }
.replay-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.replay-actions button { padding: 9px 16px; border: 1px solid #667c58; border-radius: 6px; background: #d6e5b6; color: #21341d; cursor: pointer; }
.replay-actions button:disabled { opacity: .45; cursor: default; }
.replay-actions span { font-size: 13px; }
</style>
