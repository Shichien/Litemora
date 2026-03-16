<script setup>
import {
  clearAdminAuthSession,
  getAuthProviders,
  isLocalDevAuthSession,
  loadAdminAuthSession,
  signInWithProvider,
} from '@three/auth/admin-auth.js'
import {
  createGalleryItem,
  deleteGalleryItem,
  fetchGallery,
} from '@three/gallery/gallery-api.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildGalleryUrl, buildSpaceProjectionUrl } from '@three/utils/space-context.js'
import schematicService from '@three/world/terrain/schematic-service.js'
import SchematicRendererCanvas from '@ui-components/admin/SchematicRendererCanvas.vue'
import SpaceBreadcrumbs from '@ui-components/space/SpaceBreadcrumbs.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  spaceName: {
    type: String,
    default: '',
  },
})

const authProviders = getAuthProviders()

const authSession = ref(loadAdminAuthSession())
const galleryProfile = ref(null)
const galleryItems = ref([])
const galleryViewer = ref({
  authenticated: false,
  account: null,
  canManage: false,
})

const isAuthenticating = ref(false)
const isLoading = ref(false)
const isParsingUpload = ref(false)
const isPublishing = ref(false)
const loadError = ref('')
const authError = ref('')
const actionMessage = ref('')
const actionTone = ref('neutral')
const pendingDeleteItemId = ref('')

const uploadFile = ref(null)
const uploadSchematic = ref(null)
const uploadPreviewSummary = ref(null)
const uploadTitle = ref('')
const uploadDescription = ref('')

const viewerDisplayName = computed(() => {
  const account = authSession.value?.account
  if (!account) {
    return ''
  }
  return account.name || account.email || account.id
})

const isLocalDevSession = computed(() => isLocalDevAuthSession(authSession.value))

const hasServerSession = computed(() => {
  return !!authSession.value?.token
})

const canManageProjections = computed(() => {
  if (!authSession.value) {
    return false
  }

  if (!galleryProfile.value) {
    return true
  }

  return !!galleryViewer.value?.canManage
})

const publicGalleryUrl = computed(() => {
  if (!props.spaceName) {
    return ''
  }
  return buildGalleryUrl(props.spaceName)
})

function setActionMessage(message, tone = 'neutral') {
  actionMessage.value = message
  actionTone.value = tone
}

async function loadWorlds() {
  if (!props.spaceName) {
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    const payload = await fetchGallery(props.spaceName, authSession.value)
    const safePayload = payload && typeof payload === 'object' ? payload : {}
    galleryProfile.value = safePayload.profile || null
    galleryItems.value = Array.isArray(safePayload.items) ? safePayload.items : []
    galleryViewer.value = safePayload.viewer || {
      authenticated: false,
      account: null,
      canManage: false,
    }
  }
  catch (error) {
    loadError.value = error?.message || '读取投影列表失败'
  }
  finally {
    isLoading.value = false
  }
}

async function handleProviderAuth(provider) {
  if (isAuthenticating.value) {
    return
  }

  isAuthenticating.value = true
  authError.value = ''

  try {
    authSession.value = await signInWithProvider(provider)
    setActionMessage(`已登录为 ${viewerDisplayName.value || '当前账户'}`, 'success')
    await loadWorlds()
  }
  catch (error) {
    authError.value = error?.message || '登录失败'
  }
  finally {
    isAuthenticating.value = false
  }
}

function logout() {
  if (isLocalDevSession.value) {
    setActionMessage('当前是本地开发会话，刷新页面后会自动重新启用。', 'neutral')
    return
  }

  clearAdminAuthSession()
  authSession.value = null
  galleryProfile.value = null
  galleryItems.value = []
  galleryViewer.value = {
    authenticated: false,
    account: null,
    canManage: false,
  }
  setActionMessage('已退出登录', 'neutral')
}

async function handleUploadFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) {
    return
  }

  if (!file.name.endsWith('.litematic')) {
    setActionMessage('请选择 .litematic 文件', 'warning')
    event.target.value = ''
    return
  }

  isParsingUpload.value = true
  uploadFile.value = null
  uploadSchematic.value = null
  uploadPreviewSummary.value = null

  try {
    uploadSchematic.value = await schematicService.parseFile(file)
    uploadFile.value = file
    uploadPreviewSummary.value = schematicService.getPreview()

    if (!uploadTitle.value) {
      uploadTitle.value = uploadPreviewSummary.value?.name || file.name.replace(/\.litematic$/i, '')
    }

    setActionMessage(`已读取 ${file.name}，可以创建新的投影世界`, 'success')
  }
  catch (error) {
    setActionMessage(error?.message || '解析投影失败', 'warning')
    uploadFile.value = null
    uploadSchematic.value = null
    uploadPreviewSummary.value = null
    event.target.value = ''
  }
  finally {
    isParsingUpload.value = false
  }
}

function resetUploadDraft() {
  uploadFile.value = null
  uploadSchematic.value = null
  uploadPreviewSummary.value = null
  uploadTitle.value = ''
  uploadDescription.value = ''
}

async function handleCreateProjection() {
  if (!hasServerSession.value) {
    setActionMessage('当前部署没有安全会话，暂时无法创建云端投影', 'warning')
    return
  }

  if (!canManageProjections.value) {
    setActionMessage('只有这个 space 的拥有者可以创建或删除投影世界', 'warning')
    return
  }

  if (!uploadFile.value || !uploadPreviewSummary.value) {
    setActionMessage('请先读取一个 .litematic 文件', 'warning')
    return
  }

  isPublishing.value = true

  try {
    const payload = await createGalleryItem({
      spaceName: props.spaceName,
      title: uploadTitle.value,
      description: uploadDescription.value,
      file: uploadFile.value,
      schematic: uploadPreviewSummary.value,
      session: authSession.value,
    })

    resetUploadDraft()
    setActionMessage(`已创建投影 ${payload.item?.title || 'Untitled'}`, 'success')
    await loadWorlds()
  }
  catch (error) {
    setActionMessage(error?.message || '创建投影失败', 'warning')
  }
  finally {
    isPublishing.value = false
  }
}

async function handleDeleteProjection(itemId) {
  if (!itemId) {
    return
  }

  try {
    await deleteGalleryItem(props.spaceName, itemId, authSession.value)
    pendingDeleteItemId.value = ''
    setActionMessage('投影已删除', 'success')
    await loadWorlds()
  }
  catch (error) {
    setActionMessage(error?.message || '删除投影失败', 'warning')
  }
}

function enterProjection(itemId) {
  if (!itemId || !props.spaceName) {
    return
  }

  navigateToUrl(buildSpaceProjectionUrl(props.spaceName, itemId))
}

function handleAuthChanged(event) {
  authSession.value = event?.detail?.session || loadAdminAuthSession()
  if (authSession.value) {
    void loadWorlds()
    return
  }

  galleryProfile.value = null
  galleryItems.value = []
  galleryViewer.value = {
    authenticated: false,
    account: null,
    canManage: false,
  }
}

onMounted(() => {
  window.addEventListener('admin-auth-changed', handleAuthChanged)
  void loadWorlds()
})

onBeforeUnmount(() => {
  window.removeEventListener('admin-auth-changed', handleAuthChanged)
})
</script>

<template>
  <main class="worlds-shell">
    <section class="worlds-hero">
      <header class="hero-topbar">
        <SpaceBreadcrumbs :space-name="spaceName" />
      </header>

      <p class="hero-kicker">
        Space Worlds
      </p>
      <h1 class="hero-title">
        {{ spaceName }} 的多投影世界
      </h1>
      <p class="hero-copy">
        这里是进入 3D 世界之前的配置页。每个投影都直接复用当前 space 的 gallery item，并拥有独立的出生点、配置和世界快照。
      </p>

      <div class="hero-meta">
        <div class="meta-card">
          <span>Space</span>
          <strong>{{ spaceName || 'unknown' }}</strong>
        </div>
        <div class="meta-card">
          <span>Owner</span>
          <strong>{{ galleryProfile?.ownerName || '尚未创建投影' }}</strong>
        </div>
        <div class="meta-card">
          <span>Worlds</span>
          <strong>{{ galleryItems.length }}</strong>
        </div>
      </div>
    </section>

    <section class="worlds-layout">
      <aside class="worlds-sidebar">
        <div v-if="!authSession" class="panel">
          <div class="panel-head">
            <h2>Space 管理</h2>
          </div>
          <p class="panel-copy">
            如果你是这个 Space 的拥有者，请登录以管理或上传投影。
          </p>
          <div class="auth-list">
            <button
              v-for="provider in authProviders"
              :key="provider.id"
              type="button"
              class="action-btn primary"
              :disabled="isAuthenticating"
              @click="handleProviderAuth(provider.id)"
            >
              {{ isAuthenticating ? '登录中...' : `使用 ${provider.label} 登录` }}
            </button>
          </div>
          <p v-if="authError" class="feedback warning">
            {{ authError }}
          </p>
        </div>

        <div v-else class="panel">
          <div class="panel-head">
            <h2>已登录</h2>
            <span class="chip" :class="{ success: isLocalDevSession }">{{ viewerDisplayName }}</span>
          </div>
          <p class="panel-copy">
            {{ isLocalDevSession ? '当前正在使用本地开发模式。投影会保存到浏览器本地存储，不依赖 /api Functions 或安全会话。' : (canManageProjections ? '你可以创建、删除并进入这个 space 的投影世界。' : '你当前只能查看公开投影，并直接进入它们。') }}
          </p>
          <button type="button" class="action-btn subtle" @click="logout">
            退出登录
          </button>
        </div>

        <div v-if="canManageProjections" class="panel">
          <div class="panel-head">
            <h2>创建公开投影</h2>
          </div>

          <label class="field">
            <span>投影文件</span>
            <input
              type="file"
              accept=".litematic"
              :disabled="isParsingUpload || isPublishing"
              @change="handleUploadFileChange"
            >
          </label>

          <label class="field">
            <span>标题</span>
            <input v-model="uploadTitle" type="text" placeholder="例如：主城一期">
          </label>

          <label class="field">
            <span>说明</span>
            <textarea
              v-model="uploadDescription"
              rows="4"
              placeholder="描述这个投影世界的用途、版本或建造阶段"
            />
          </label>

          <div v-if="uploadPreviewSummary" class="upload-summary">
            <strong>{{ uploadPreviewSummary.name }}</strong>
            <span>{{ uploadPreviewSummary.author || 'Unknown' }}</span>
            <span>
              {{ uploadPreviewSummary.size.x }} × {{ uploadPreviewSummary.size.y }} × {{ uploadPreviewSummary.size.z }}
            </span>
            <span>{{ uploadPreviewSummary.blockCount }} 方块</span>
          </div>

          <div v-if="uploadFile" class="upload-preview">
            <SchematicRendererCanvas
              :schematic="uploadSchematic"
              :source-file="uploadFile"
              empty-label="这里会显示待创建投影的真实预览"
            />
          </div>

          <button
            type="button"
            class="action-btn primary"
            :disabled="!canManageProjections || isParsingUpload || isPublishing"
            @click="handleCreateProjection"
          >
            {{ isPublishing ? '创建中...' : '创建公开投影世界' }}
          </button>
        </div>
      </aside>

      <section class="worlds-main">
        <div v-if="actionMessage" class="banner" :class="actionTone">
          {{ actionMessage }}
        </div>
        <div v-if="loadError" class="banner warning">
          {{ loadError }}
        </div>

        <div class="worlds-gallery">
          <div class="gallery-head">
            <h2>所有投影</h2>
            <span class="count-badge">{{ galleryItems.length }} Worlds</span>
          </div>

          <div v-if="isLoading" class="empty-state">
            <strong>正在同步世界目录...</strong>
          </div>

          <div v-else-if="galleryItems.length === 0" class="empty-state">
            <strong>还没有任何世界</strong>
            <span>{{ canManageProjections ? '从左侧上传 .litematic 创建第一个世界。' : '当前 Space 尚未公开任何投影。' }}</span>
          </div>

          <div v-else class="card-grid">
            <article
              v-for="item in galleryItems"
              :key="item.id"
              class="world-card"
              @click="enterProjection(item.id)"
            >
              <div class="world-card-thumb">
                <!-- 抽象几何体图案代替真实缩略图 -->
                <div class="thumb-placeholder">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" class="thumb-icon">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 21.05L2.8 15.35V8.65L12 2.95L21.2 8.65V15.35L12 21.05ZM12 18.2917L18.8 14.075V9.925L12 5.70834L5.2 9.925V14.075L12 18.2917Z" fill="white" fill-opacity="0.1" />
                    <path d="M12 11V18" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M5.5 8L12 11" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M18.5 8L12 11" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                </div>
                <div class="thumb-overlay">
                  <span class="tag-badge version-tag">.LITEMATIC</span>
                </div>
              </div>

              <div class="world-card-content">
                <h3 class="world-title">{{ item.title }}</h3>
                <p class="world-desc">{{ item.description || '点击此卡片可直接进入这个 3D 投影世界，并在浏览器中进行游览。' }}</p>

                <div class="world-meta">
                  <div class="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span>{{ item.schematic.author || 'Unknown' }}</span>
                  </div>
                  <div class="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    <span>{{ item.schematic.blockCount }} Blocks</span>
                  </div>
                </div>

                <div v-if="canManageProjections" class="world-actions" @click.stop>
                  <button
                    v-if="pendingDeleteItemId !== item.id"
                    type="button"
                    class="btn-delete"
                    title="删除"
                    @click="pendingDeleteItemId = item.id"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn-delete-confirm"
                    @click="handleDeleteProjection(item.id)"
                  >
                    确认删除
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.worlds-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(136, 194, 248, 0.16), transparent 34%),
    radial-gradient(circle at 85% 15%, rgba(126, 231, 191, 0.12), transparent 26%),
    linear-gradient(180deg, #081018 0%, #0d1419 48%, #10161d 100%);
  color: #edf4f7;
}

.worlds-hero,
.worlds-layout,
.login-panel {
  width: min(1280px, calc(100% - 2rem));
  margin: 0 auto;
}

.worlds-hero {
  padding: 2rem 0 1.4rem;
}

.hero-topbar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.hero-share {
  color: #b4c9d8;
  text-decoration: none;
}

.hero-kicker {
  margin: 2rem 0 0;
  color: #77bddc;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.88rem;
}

.hero-title {
  margin: 0.8rem 0 0;
  font-size: clamp(2.5rem, 6vw, 5rem);
  line-height: 0.98;
  letter-spacing: -0.05em;
}

.hero-copy {
  margin: 1rem 0 0;
  max-width: 860px;
  color: #abc2cf;
  line-height: 1.85;
}

.hero-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1.75rem;
}

.meta-card,
.panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 18, 24, 0.76);
  border-radius: 24px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2);
}

.meta-card {
  padding: 1rem 1.1rem;
}

.meta-card span {
  display: block;
  color: #8ea8b7;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 0.8rem;
}

.meta-card strong {
  display: block;
  margin-top: 0.5rem;
  font-size: 1rem;
}

.login-panel {
  padding-bottom: 3rem;
}

.panel {
  padding: 1.35rem;
}

.worlds-layout {
  display: grid;
  grid-template-columns: minmax(320px, 390px) minmax(0, 1fr);
  gap: 1.2rem;
  padding-bottom: 3rem;
}

.worlds-sidebar {
  display: grid;
  gap: 1.1rem;
}

.panel.disabled {
  opacity: 0.68;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.panel-head h2 {
  margin: 0;
  font-size: 1.1rem;
}

.panel-copy {
  color: #a8c1cf;
  line-height: 1.7;
}

.field {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
}

.field span {
  color: #9fb8c7;
  font-size: 0.9rem;
}

.field input,
.field textarea,
.field select {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: #edf4f7;
  border-radius: 16px;
  padding: 0.8rem 0.95rem;
  font: inherit;
}

.auth-list,
.world-card-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.72rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #edf4f7;
  font-size: 0.8rem;
}

.chip.success {
  background: rgba(102, 215, 154, 0.14);
  color: #9af1bf;
}

.chip.warning {
  background: rgba(245, 184, 88, 0.14);
  color: #ffd08a;
}

.upload-summary {
  display: grid;
  gap: 0.35rem;
  margin-top: 1rem;
  color: #b6c8d4;
}

.upload-preview {
  margin-top: 1rem;
  border-radius: 22px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.22);
  min-height: 240px;
}

.worlds-main {
  display: grid;
  gap: 1rem;
}

.banner {
  padding: 0.95rem 1.1rem;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.06);
}

.banner.success {
  background: rgba(68, 180, 119, 0.16);
}

.banner.warning {
  background: rgba(227, 172, 83, 0.14);
}

.worlds-gallery {
  display: grid;
  gap: 1.5rem;
  align-content: start;
}

.gallery-head {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.gallery-head h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.count-badge {
  background: rgba(255, 255, 255, 0.08);
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  color: #a3c4d9;
}

.empty-state {
  display: grid;
  gap: 0.5rem;
  padding: 4rem 2rem;
  text-align: center;
  background: rgba(10, 18, 24, 0.4);
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  color: #8da4b4;
}

.empty-state strong {
  color: #edf4f7;
  font-size: 1.1rem;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
}

.world-card {
  display: flex;
  flex-direction: column;
  background: rgba(13, 19, 25, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.world-card:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(126, 189, 228, 0.1) inset;
}

.world-card-thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background: radial-gradient(circle at top right, #1f2a35, #0a1118);
  overflow: hidden;
}

.thumb-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.5s ease;
}

.world-card:hover .thumb-placeholder {
  transform: scale(1.05);
}

.thumb-icon {
  width: 72px;
  height: 72px;
}

.thumb-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgba(8, 16, 24, 0.8) 0%, transparent 40%);
  padding: 1rem;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
}

.tag-badge {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.version-tag {
  background: rgba(121, 203, 167, 0.2);
  color: #bbf4d9;
  border: 1px solid rgba(121, 203, 167, 0.1);
}

.world-card-content {
  position: relative;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.world-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.world-desc {
  margin: 0.65rem 0 0;
  font-size: 0.9rem;
  color: #8da4b4;
  line-height: 1.6;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.world-meta {
  margin-top: 1.25rem;
  display: flex;
  gap: 1rem;
  color: #728c9e;
  font-size: 0.85rem;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.world-actions {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  display: flex;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.world-card:hover .world-actions {
  opacity: 1;
}

.btn-delete {
  background: rgba(220, 53, 69, 0.1);
  color: #ff6b7b;
  border: 1px solid rgba(220, 53, 69, 0.2);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete:hover {
  background: rgba(220, 53, 69, 0.2);
  color: #ff8e9b;
}

.btn-delete-confirm {
  background: #dc3545;
  color: #fff;
  border: none;
  height: 32px;
  padding: 0 0.8rem;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.world-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 0.95rem;
  color: #95b1c1;
  font-size: 0.88rem;
}

.world-card-actions {
  margin-top: 1rem;
}

.action-btn {
  border: none;
  border-radius: 999px;
  padding: 0.85rem 1.2rem;
  font: inherit;
  cursor: pointer;
}

.action-btn.compact {
  padding: 0.7rem 1rem;
}

.action-btn.primary {
  background: #edf4f7;
  color: #081018;
}

.action-btn.subtle {
  background: rgba(255, 255, 255, 0.08);
  color: #edf4f7;
}

.action-btn.danger {
  background: rgba(215, 92, 92, 0.18);
  color: #ffd0d0;
}

.feedback.warning {
  color: #ffd79a;
}

@media (max-width: 960px) {
  .worlds-layout {
    grid-template-columns: 1fr;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hero-meta {
    grid-template-columns: 1fr;
  }
}
</style>
