<script setup>
import {
  clearAdminAuthSession,
  getAuthProviders,
  isLocalDevAuthSession,
  loadAdminAuthSession,
  signInWithProvider,
} from '@three/auth/admin-auth.js'
import {
  deleteGalleryItem,
  fetchGallery,
} from '@three/gallery/gallery-api.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceProjectionUrl } from '@three/utils/space-context.js'
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
const loadError = ref('')
const authError = ref('')
const actionMessage = ref('')
const actionTone = ref('neutral')
const pendingDeleteItemId = ref('')
const authMenuOpen = ref(false)
const authMenuRef = ref(null)

function openAdminConfigPage() {
  window.location.hash = '#admin-config'
}

const viewerDisplayName = computed(() => {
  const account = authSession.value?.account
  if (!account) {
    return ''
  }
  return account.name || account.email || account.id
})
const viewerEmail = computed(() => authSession.value?.account?.email || '')
const viewerRole = computed(() => isLocalDevSession.value ? 'Admin' : 'Member')
const viewerAvatar = computed(() => authSession.value?.account?.avatar || '')
const viewerInitial = computed(() => viewerDisplayName.value.slice(0, 1).toUpperCase() || 'L')

const isLocalDevSession = computed(() => isLocalDevAuthSession(authSession.value))

const canManageProjections = computed(() => {
  if (!authSession.value) {
    return false
  }

  if (!galleryProfile.value) {
    return true
  }

  return !!galleryViewer.value?.canManage
})

function resolveProjectionPreview(item) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const preview = item.preview && typeof item.preview === 'object' ? item.preview : null
  const previewModel = item.previewModel && typeof item.previewModel === 'object' ? item.previewModel : null
  const schematic = item.schematic && typeof item.schematic === 'object' ? item.schematic : null

  return {
    totalSolidBlocks: Number(preview?.totalSolidBlocks || previewModel?.totalSolidBlocks || schematic?.blockCount || 0),
    bounds: preview?.bounds || previewModel?.bounds || schematic?.bounds || null,
  }
}

function getProjectionRouteId(item) {
  return String(item?.projectionSlug || item?.id || '').trim()
}

function openProjectionSettings(item) {
  const routeId = getProjectionRouteId(item)
  if (!routeId || !props.spaceName) {
    return
  }

  navigateToUrl(`${buildSpaceProjectionUrl(props.spaceName, routeId)}#admin-config`)
}

function resolveProjectionThumbnailAsset(item) {
  const imageUrl = String(item?.thumbnailDataUrl || '').trim()
  if (imageUrl) {
    return {
      imageUrl,
      generated: null,
    }
  }

  return {
    imageUrl: '',
    generated: generateProjectionThumbnailSvg(item),
  }
}

// 根据 projection 的 bounds 生成预览 SVG
function generateProjectionThumbnailSvg(item) {
  const preview = resolveProjectionPreview(item)
  const bounds = preview?.bounds
  if (!bounds) {
    return null
  }

  // 计算归一化的尺寸
  const minX = bounds.minX ?? 0
  const maxX = bounds.maxX ?? 16
  const minY = bounds.minY ?? 0
  const maxY = bounds.maxY ?? 32
  const minZ = bounds.minZ ?? 0
  const maxZ = bounds.maxZ ?? 16

  const width = maxX - minX || 16
  const height = maxY - minY || 32
  const depth = maxZ - minZ || 16

  // 计算显示比例（适配 16:9）
  const maxDim = Math.max(width, height, depth)
  const scale = 20 / maxDim

  const displayWidth = width * scale
  const displayHeight = height * scale
  const displayDepth = depth * scale

  // 生成 3D 效果的 SVG
  const centerX = 12
  const centerY = 12
  const baseColor = '#7ebcd3'
  const highlightColor = '#a8d8ea'

  return {
    svg: `
      <svg width="100%" height="100%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad-${item.id}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${highlightColor};stop-opacity:0.8" />
            <stop offset="100%" style="stop-color:${baseColor};stop-opacity:0.6" />
          </linearGradient>
        </defs>
        <!-- 3D 立方体效果 -->
        <g transform="translate(${centerX - displayWidth / 2}, ${centerY - displayHeight / 2})">
          <!-- 顶面 -->
          <path d="M0,${displayHeight * 0.2} L${displayWidth * 0.3},0 L${displayWidth},${displayHeight * 0.2} L${displayWidth * 0.7},${displayHeight * 0.4} Z"
                fill="${highlightColor}" fill-opacity="0.7" />
          <!-- 正面 -->
          <rect x="0" y="${displayHeight * 0.2}" width="${displayWidth}" height="${displayHeight * 0.6}"
                fill="url(#grad-${item.id})" />
          <!-- 右侧面 -->
          <path d="M${displayWidth},${displayHeight * 0.2} L${displayWidth * 0.7},${displayHeight * 0.4} L${displayWidth * 0.7},${displayHeight} L${displayWidth},${displayHeight * 0.8} Z"
                fill="${baseColor}" fill-opacity="0.5" />
        </g>
      </svg>
    `,
    bounds: { width, height, depth },
  }
}

function setActionMessage(message, tone = 'neutral') {
  actionMessage.value = message
  actionTone.value = tone
}

function handleDocumentClick(event) {
  if (!authMenuRef.value?.contains?.(event.target)) {
    authMenuOpen.value = false
  }
}

function toggleAuthMenu() {
  authMenuOpen.value = !authMenuOpen.value
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

function getProjectionAuthor(item) {
  return item?.schematic?.author || 'Unknown'
}

function getProjectionBlockCount(item) {
  const preview = resolveProjectionPreview(item)
  return Number(preview?.totalSolidBlocks || item?.schematic?.blockCount || 0)
}

function logout() {
  if (isLocalDevSession.value) {
    setActionMessage('当前是本地开发会话，刷新页面后会自动重新启用。', 'neutral')
    authMenuOpen.value = false
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
  authMenuOpen.value = false
  setActionMessage('已退出登录', 'neutral')
}

async function handleDeleteProjection(itemOrId) {
  const item = itemOrId && typeof itemOrId === 'object' ? itemOrId : null
  const itemId = String(item?.id || itemOrId || '').trim()
  if (!itemId) {
    return
  }

  try {
    await deleteGalleryItem(props.spaceName, item || itemId, authSession.value)
    galleryItems.value = galleryItems.value.filter(item => item?.id !== itemId)
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
  authMenuOpen.value = false
  void loadWorlds()
}

function handleGalleryChanged(event) {
  const detailSpaceName = String(event?.detail?.spaceName || '').trim().toLowerCase()
  if (!detailSpaceName || detailSpaceName !== String(props.spaceName || '').trim().toLowerCase()) {
    return
  }

  void loadWorlds()
}

onMounted(() => {
  window.addEventListener('admin-auth-changed', handleAuthChanged)
  window.addEventListener('gallery:changed', handleGalleryChanged)
  document.addEventListener('click', handleDocumentClick)
  void loadWorlds()
})

onBeforeUnmount(() => {
  window.removeEventListener('admin-auth-changed', handleAuthChanged)
  window.removeEventListener('gallery:changed', handleGalleryChanged)
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <main class="worlds-shell">
    <header class="worlds-topbar">
      <SpaceBreadcrumbs :space-name="spaceName" />

        <div ref="authMenuRef" class="worlds-topbar-actions">
        <div class="auth-popover">
          <button type="button" class="auth-trigger" :class="{ active: authMenuOpen }" @click.stop="toggleAuthMenu">
            <span class="auth-rail" aria-hidden="true">
              <span class="auth-rail-block wide"></span>
              <span class="auth-rail-block"></span>
              <span class="auth-rail-block"></span>
              <span class="auth-rail-block narrow"></span>
            </span>
            <span class="auth-trigger-divider" aria-hidden="true"></span>
            <template v-if="authSession">
              <span class="auth-account">
                <span class="auth-avatar">
                  <img v-if="viewerAvatar" :src="viewerAvatar" :alt="viewerDisplayName">
                  <span v-else>{{ viewerInitial }}</span>
                </span>
                <span class="auth-copy">
                  <strong>{{ viewerDisplayName }}</strong>
                  <small>{{ viewerRole }}</small>
                </span>
              </span>
            </template>
            <template v-else>
              <span class="auth-trigger-arrow">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14"></path>
                  <path d="m12 5 7 7-7 7"></path>
                </svg>
              </span>
            </template>
          </button>

          <div v-if="authMenuOpen" class="auth-menu">
            <template v-if="authSession">
              <div class="auth-menu-header">
                <div class="menu-account-copy">
                  <strong>{{ viewerDisplayName }}</strong>
                  <span>{{ viewerEmail || 'local@litemora.dev' }}</span>
                </div>
              </div>

              <button type="button" class="auth-menu-item placeholder" @click="authMenuOpen = false">
                <span class="menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path>
                    <path d="M4 20a8 8 0 0 1 16 0"></path>
                  </svg>
                </span>
                <span>Account Settings</span>
              </button>
              <button type="button" class="auth-menu-item placeholder" @click="authMenuOpen = false">
                <span class="menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51 2 2 0 1 1-4 0 1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33 2 2 0 1 1-2.83-2.83 1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1 2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 2.6a2 2 0 1 1 4 0 1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33 2 2 0 1 1 2.83 2.83 1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 21.4 10a2 2 0 1 1 0 4 1.65 1.65 0 0 0-1.51 1Z"></path>
                  </svg>
                </span>
                <span>Preferences</span>
              </button>
              <button type="button" class="auth-menu-item danger" @click="logout">
                <span class="menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <path d="m16 17 5-5-5-5"></path>
                    <path d="M21 12H9"></path>
                  </svg>
                </span>
                <span>Log out</span>
              </button>
            </template>

            <template v-else>
              <div class="auth-menu-title">选择登录方式</div>
              <button
                v-for="provider in authProviders"
                :key="provider.id"
                type="button"
                class="auth-menu-item"
                :disabled="isAuthenticating"
                @click="handleProviderAuth(provider.id)"
              >
                <span class="menu-icon" aria-hidden="true">
                  <svg v-if="provider.id === 'github'" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.91 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.59-2.81 5.61-5.49 5.9.43.37.82 1.09.82 2.2v3.26c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"></path>
                  </svg>
                </span>
                <span>{{ isAuthenticating ? '登录中...' : `使用 ${provider.label} 登录` }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </header>

    <section class="worlds-main">
        <div v-if="actionMessage" class="banner" :class="actionTone">
          {{ actionMessage }}
        </div>
        <div v-if="loadError" class="banner warning">
          {{ loadError }}
        </div>
        <div v-if="authError" class="banner warning">
          {{ authError }}
        </div>

        <div class="worlds-gallery">
          <div class="gallery-head">
            <h2>所有投影</h2>
            <span class="count-badge">{{ galleryItems.length }} Worlds</span>
          </div>

          <div v-if="isLoading" class="empty-state">
            <strong>正在同步世界目录...</strong>
          </div>

          <div v-else-if="galleryItems.length === 0 && !canManageProjections" class="empty-state">
            <strong>还没有任何世界</strong>
            <span>当前 Space 尚未公开任何投影。</span>
          </div>

          <!-- 当没有世界但用户可以管理时，显示占位卡片 -->
          <div v-else-if="galleryItems.length === 0 && canManageProjections" class="card-grid">
            <article
              class="world-card placeholder-card"
              @click="openAdminConfigPage"
            >
              <div class="world-card-thumb placeholder-thumb">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="add-icon">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="16"></line>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
              </div>
              <div class="world-card-content">
                <h3 class="world-title">添加第一个投影</h3>
                <p class="world-desc">点击进入管理员配置页，导入 .litematic 并创建第一个世界</p>
              </div>
            </article>
          </div>

          <div v-else class="card-grid">
            <!-- 添加投影占位卡片 -->
            <article
              v-if="canManageProjections"
              class="world-card placeholder-card"
              @click="openAdminConfigPage"
            >
              <div class="world-card-thumb placeholder-thumb">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="add-icon">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="16"></line>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
              </div>
              <div class="world-card-content">
                <h3 class="world-title">管理员配置</h3>
                <p class="world-desc">点击打开完整的管理员配置页面</p>
              </div>
            </article>

            <article
              v-for="item in galleryItems"
              :key="item.id"
              class="world-card"
              @click="enterProjection(item.projectionSlug || item.id)"
            >
              <div class="world-card-thumb">
                <div
                  class="thumb-placeholder"
                  :class="{
                    'has-custom-thumb': !!resolveProjectionThumbnailAsset(item).generated,
                    'has-image-thumb': !!resolveProjectionThumbnailAsset(item).imageUrl,
                  }"
                >
                  <template v-if="resolveProjectionThumbnailAsset(item).imageUrl">
                    <img
                      class="thumb-image"
                      :src="resolveProjectionThumbnailAsset(item).imageUrl"
                      :alt="`${item.title} preview`"
                    >
                  </template>
                  <template v-else-if="resolveProjectionThumbnailAsset(item).generated">
                    <div class="custom-thumb" v-html="resolveProjectionThumbnailAsset(item).generated.svg" />
                  </template>
                  <template v-else>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" class="thumb-icon">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 21.05L2.8 15.35V8.65L12 2.95L21.2 8.65V15.35L12 21.05ZM12 18.2917L18.8 14.075V9.925L12 5.70834L5.2 9.925V14.075L12 18.2917Z" fill="white" fill-opacity="0.1" />
                      <path d="M12 11V18" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                      <path d="M5.5 8L12 11" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                      <path d="M18.5 8L12 11" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                  </template>
                </div>
                <div class="thumb-overlay">
                  <div class="thumb-badges">
                    <span class="tag-badge version-tag">.LITEMATIC</span>
                    <span
                      v-if="canManageProjections"
                      class="tag-badge visibility-tag"
                      :class="{ private: item.visibility === 'private' }"
                    >
                      {{ item.visibility === 'private' ? '私有' : '公开' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="world-card-content">
                <h3 class="world-title">{{ item.title }}</h3>
                <p class="world-desc">{{ item.description || '点击此卡片可直接进入这个 3D 投影世界，并在浏览器中进行游览。' }}</p>

                <div class="world-meta">
                  <div class="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span>{{ getProjectionAuthor(item) }}</span>
                  </div>
                  <div class="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    <span>{{ getProjectionBlockCount(item) }} Blocks</span>
                  </div>
                </div>

                <div v-if="canManageProjections" class="world-actions" @click.stop>
                  <button
                    type="button"
                    class="btn-settings"
                    title="世界设置"
                    @click="openProjectionSettings(item)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51 2 2 0 1 1-4 0 1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33 2 2 0 1 1-2.83-2.83 1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1 2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 2.6a2 2 0 1 1 4 0 1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33 2 2 0 1 1 2.83 2.83 1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 21.4 10a2 2 0 1 1 0 4 1.65 1.65 0 0 0-1.51 1Z"></path></svg>
                    <span>设置</span>
                  </button>
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
                    @click="handleDeleteProjection(item)"
                  >
                    确认删除
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
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

.worlds-topbar,
.worlds-main,
.worlds-hero,
.worlds-layout,
.login-panel {
  width: min(1280px, calc(100% - 2rem));
  margin: 0 auto;
}

.worlds-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 1.35rem 0 0.9rem;
}

.worlds-topbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-left: auto;
}

.auth-popover {
  position: relative;
}

.auth-trigger {
  min-width: 312px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.9rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0 0 0 18px;
  background: rgba(19, 24, 28, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  color: #edf4f7;
  cursor: pointer;
  min-height: 78px;
}

.auth-trigger:hover,
.auth-trigger.active {
  background: rgba(24, 29, 34, 0.98);
  border-color: rgba(126, 188, 211, 0.18);
}

.auth-rail {
  min-width: 142px;
  height: 40px;
  padding: 0.45rem 0.55rem;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background:
    linear-gradient(180deg, rgba(28, 34, 39, 0.95) 0%, rgba(21, 26, 31, 0.95) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.auth-rail-block {
  width: 28px;
  height: 28px;
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(51, 57, 62, 0.86) 0%, rgba(40, 45, 50, 0.74) 100%);
}

.auth-rail-block.wide {
  width: 42px;
}

.auth-rail-block.narrow {
  width: 18px;
}

.auth-trigger-divider {
  width: 1px;
  align-self: stretch;
  background: rgba(255, 255, 255, 0.08);
}

.auth-account {
  display: inline-flex;
  align-items: center;
  gap: 0.8rem;
  min-width: 0;
  margin-left: auto;
}

.auth-trigger-arrow {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  margin-left: auto;
  background: rgba(255, 255, 255, 0.04);
}

.auth-avatar,
.menu-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, #233445 0%, #5f8191 100%);
  color: #f4f7fb;
  font-size: 1rem;
  font-weight: 600;
}

.auth-avatar img,
.menu-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.auth-copy,
.menu-account-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.12rem;
  min-width: 0;
}

.auth-copy strong,
.menu-account-copy strong {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.98rem;
  font-weight: 500;
  color: #edf4f7;
}

.auth-copy small,
.menu-account-copy span {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8ea8b7;
  font-size: 0.82rem;
}

.auth-menu {
  position: absolute;
  top: calc(100% + 0.15rem);
  right: 0;
  width: min(372px, calc(100vw - 2rem));
  padding: 1.15rem 1.2rem 0.95rem;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(24, 28, 29, 0.98);
  backdrop-filter: blur(14px);
  box-shadow: 0 22px 50px rgba(0, 0, 0, 0.38);
  z-index: 10;
}

.auth-menu-header {
  display: grid;
  gap: 0.5rem;
  padding: 0.1rem 0.1rem 1rem;
  margin-bottom: 0.6rem;
  border-bottom: 1px solid rgba(45, 111, 132, 0.26);
}

.auth-menu-title {
  padding: 0.25rem 0.1rem 0.9rem;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.9rem;
}

.auth-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem 0.25rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #edf4f7;
  font: inherit;
  font-size: 0.95rem;
  cursor: pointer;
}

.auth-menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.03);
}

.auth-menu-item:disabled {
  opacity: 0.6;
  cursor: wait;
}

.auth-menu-item.placeholder {
  border-bottom: 1px solid rgba(45, 111, 132, 0.26);
}

.auth-menu-item.placeholder:last-of-type {
  border-bottom: none;
}

.auth-menu-item.danger {
  color: #ff695f;
  margin-top: 0.65rem;
  padding-top: 1.05rem;
  border-top: 1px solid rgba(45, 111, 132, 0.26);
}

.menu-icon {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  flex-shrink: 0;
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
  padding-bottom: 3rem;
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

.thumb-placeholder.has-custom-thumb {
  background: radial-gradient(circle at 30% 30%, #2a3f50, #0d1419);
}

.thumb-placeholder.has-image-thumb {
  background:
    radial-gradient(circle at 20% 20%, rgba(126, 189, 228, 0.24), transparent 32%),
    linear-gradient(180deg, #091018 0%, #0c1620 100%);
}

.thumb-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.5s ease;
}

.custom-thumb {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-thumb svg {
  max-width: 80%;
  max-height: 80%;
}

.world-card:hover .thumb-placeholder {
  transform: scale(1.05);
}

.world-card:hover .thumb-image {
  transform: scale(1.04);
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

.thumb-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
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

.visibility-tag {
  background: rgba(119, 175, 255, 0.16);
  color: #cfe0ff;
  border: 1px solid rgba(119, 175, 255, 0.18);
}

.visibility-tag.private {
  background: rgba(255, 159, 67, 0.16);
  color: #ffd7a8;
  border: 1px solid rgba(255, 159, 67, 0.2);
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

.btn-settings,
.btn-delete {
  background: rgba(18, 30, 40, 0.82);
  color: #d7e7ef;
  border: 1px solid rgba(126, 189, 228, 0.2);
  height: 32px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(12px);
}

.btn-settings {
  gap: 0.4rem;
  padding: 0 0.72rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.btn-settings:hover {
  background: rgba(28, 44, 57, 0.95);
  color: #f4fbff;
  border-color: rgba(126, 189, 228, 0.36);
}

.btn-delete {
  background: rgba(220, 53, 69, 0.1);
  color: #ff6b7b;
  border: 1px solid rgba(220, 53, 69, 0.2);
  width: 32px;
  padding: 0;
  backdrop-filter: blur(12px);
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

/* 占位卡片样式 */
.placeholder-card {
  border: 2px dashed rgba(126, 189, 228, 0.3);
  background: rgba(126, 189, 228, 0.05);
}

.placeholder-card:hover {
  border-color: rgba(126, 189, 228, 0.6);
  background: rgba(126, 189, 228, 0.1);
}

.placeholder-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(126, 189, 228, 0.1);
}

.add-icon {
  color: rgba(126, 189, 228, 0.6);
  transition: transform 0.2s ease;
}

.placeholder-card:hover .add-icon {
  transform: scale(1.1);
  color: rgba(126, 189, 228, 0.9);
}

/* 世界配置面板样式 */
.btn-close {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #a8c1cf;
  transition: all 0.2s;
}

.btn-close:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.config-loading {
  padding: 2rem;
  text-align: center;
  color: #8da4b4;
}

.config-form {
  display: grid;
  gap: 1rem;
}

.field-group {
  display: grid;
  gap: 0.45rem;
}

.field-label {
  color: #9fb8c7;
  font-size: 0.9rem;
}

.coord-inputs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.coord-field {
  display: grid;
  gap: 0.25rem;
}

.coord-field span {
  color: #728c9e;
  font-size: 0.75rem;
}

.coord-field input {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: #edf4f7;
  border-radius: 8px;
  padding: 0.5rem;
  font: inherit;
  text-align: center;
}

.config-actions {
  margin-top: 0.5rem;
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
  .auth-trigger {
    min-width: 220px;
    padding: 0.55rem 0.65rem;
    min-height: 64px;
  }

  .auth-rail {
    min-width: 94px;
    height: 32px;
    gap: 0.28rem;
  }

  .auth-rail-block {
    width: 18px;
    height: 18px;
  }

  .auth-rail-block.wide {
    width: 26px;
  }

  .auth-rail-block.narrow {
    width: 12px;
  }

  .auth-avatar {
    width: 36px;
    height: 36px;
  }

  .auth-copy strong {
    max-width: 92px;
    font-size: 0.86rem;
  }

  .auth-copy small {
    font-size: 0.74rem;
  }

  .auth-menu {
    width: min(332px, calc(100vw - 1rem));
    padding: 1rem 1rem 0.85rem;
  }

  .hero-meta {
    grid-template-columns: 1fr;
  }

  .world-actions {
    opacity: 1;
  }
}
</style>
