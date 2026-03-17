<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import Experience from '@three/experience.js'
import { isLocalDevAuthEnabled, loadAdminAuthSession } from '@three/auth/admin-auth.js'
import { fetchGallery } from '@three/gallery/gallery-api.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import {
  buildSpaceWorldsUrl,
  getActiveProjectionId,
  getActiveSpaceName,
  isGalleryRoute,
  isSpaceWorldsRoute,
  shouldUseRootPortalView,
} from '@three/utils/space-context.js'
import AdminConfigPage from '@ui-components/admin/AdminConfigPage.vue'
import Crosshair from '@ui-components/Crosshair.vue'
import EventMonitorPanel from '@ui-components/debug/EventMonitorPanel.vue'
import GameHud from '@ui-components/hud/GameHud.vue'
import PortalHome from '@ui-components/landing/PortalHome.vue'
import UiRoot from '@ui-components/menu/UiRoot.vue'
import SpaceBreadcrumbs from '@ui-components/space/SpaceBreadcrumbs.vue'
import SpaceWorldsPage from '@ui-components/space/SpaceWorldsPage.vue'

const threeCanvas = ref(null)
const authSession = ref(loadAdminAuthSession())
const routeKind = ref('portal')
const activeSpaceName = ref('')
const activeProjectionId = ref('')
const isAdminMode = ref(window.location.hash === '#admin')
const isAdminConfigMode = ref(window.location.hash === '#admin-config')
const isDebugMode = ref(window.location.hash === '#debug')
const canManageActiveSpace = ref(false)
const canShowAdminConfig = computed(() => {
  // 管理员配置页面：需要用户已登录且有管理权限
  return isAdminConfigMode.value && !!authSession.value && canManageActiveSpace.value
})
const currentWorldRouteKey = ref('')
let experience = null
const handleHashChange = () => { void syncRouteState() }
const handlePopState = () => { void syncRouteState() }
const handleAdminAuthChanged = () => { void syncRouteState() }

function hideStaticBootLoadingScreen() {
  const loadingScreen = document.getElementById('loading-screen')
  if (!loadingScreen) {
    return
  }

  loadingScreen.style.opacity = '0'
  loadingScreen.style.display = 'none'
}

function syncScrollableRouteClass() {
  const shouldAllowPageScroll = routeKind.value !== 'projection'
  document.documentElement.classList.toggle('app-scrollable', shouldAllowPageScroll)
  document.body.classList.toggle('app-scrollable', shouldAllowPageScroll)
}

function createExperienceIfNeeded() {
  if (routeKind.value !== 'projection') {
    return
  }

  if (!experience && threeCanvas.value) {
    experience = new Experience(threeCanvas.value)
  }
}

function destroyExperienceIfNeeded() {
  if (experience) {
    experience.destroy()
    experience = null
  }
}

function syncManageAccessBroadcast() {
  window.__LITEMORA_SPACE_ACCESS__ = {
    canManage: canManageActiveSpace.value,
    spaceName: activeSpaceName.value,
    projectionId: activeProjectionId.value,
  }

  window.dispatchEvent(new CustomEvent('space-access-changed', {
    detail: window.__LITEMORA_SPACE_ACCESS__,
  }))
}

async function resolveActiveSpaceManageAccess(spaceName) {
  if (!spaceName) {
    canManageActiveSpace.value = false
    syncManageAccessBroadcast()
    return
  }

  if (isLocalDevAuthEnabled()) {
    canManageActiveSpace.value = true
    syncManageAccessBroadcast()
    return
  }

  try {
    const payload = await fetchGallery(spaceName, authSession.value)
    canManageActiveSpace.value = !!payload?.viewer?.canManage
  }
  catch {
    canManageActiveSpace.value = false
  }

  syncManageAccessBroadcast()
}

async function syncRouteState() {
  authSession.value = loadAdminAuthSession()

  const nextSpaceName = getActiveSpaceName()
  const nextProjectionId = getActiveProjectionId()
  const nextIsGalleryView = isGalleryRoute()
  const nextIsWorldsView = isSpaceWorldsRoute()
  const nextIsRootPortal = !nextIsGalleryView && shouldUseRootPortalView()
  const shouldRedirectSpaceRoot = !nextIsGalleryView && !!nextSpaceName && !nextIsWorldsView && !nextProjectionId

  if (shouldRedirectSpaceRoot) {
    navigateToUrl(buildSpaceWorldsUrl(nextSpaceName), { replace: true })
    return
  }

  activeSpaceName.value = nextSpaceName
  activeProjectionId.value = nextProjectionId
  await resolveActiveSpaceManageAccess(nextSpaceName)

  if (nextIsRootPortal) {
    routeKind.value = 'portal'
  }
  else if (nextIsGalleryView) {
    routeKind.value = 'gallery'
  }
  else if (nextIsWorldsView) {
    routeKind.value = 'worlds'
  }
  else if (nextProjectionId) {
    routeKind.value = 'projection'
  }
  else {
    routeKind.value = nextSpaceName ? 'worlds' : 'portal'
  }

  isAdminMode.value = window.location.hash === '#admin'
  isAdminConfigMode.value = window.location.hash === '#admin-config'
  isDebugMode.value = window.location.hash === '#debug'
  syncScrollableRouteClass()

  const nextWorldRouteKey = routeKind.value === 'projection'
    ? `${activeSpaceName.value}:${activeProjectionId.value}`
    : ''

  if (currentWorldRouteKey.value && currentWorldRouteKey.value !== nextWorldRouteKey) {
    destroyExperienceIfNeeded()
  }
  currentWorldRouteKey.value = nextWorldRouteKey

  if (routeKind.value !== 'projection') {
    destroyExperienceIfNeeded()
    hideStaticBootLoadingScreen()
    return
  }

  await nextTick()
  createExperienceIfNeeded()
}

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)
  window.addEventListener('popstate', handlePopState)
  window.addEventListener('admin-auth-changed', handleAdminAuthChanged)
  void syncRouteState()
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', handleHashChange)
  window.removeEventListener('popstate', handlePopState)
  window.removeEventListener('admin-auth-changed', handleAdminAuthChanged)
  document.documentElement.classList.remove('app-scrollable')
  document.body.classList.remove('app-scrollable')
  destroyExperienceIfNeeded()
})
</script>

<template>
  <!-- 主容器：相对定位 -->
  <PortalHome v-if="routeKind === 'portal'" />
  <SpaceWorldsPage v-else-if="routeKind === 'worlds'" :space-name="activeSpaceName" />

  <!-- Admin 配置弹窗：作为覆盖层显示在所有页面之上 -->
  <AdminConfigPage v-if="(isAdminMode && canManageActiveSpace) || canShowAdminConfig" class="admin-overlay" />

  <div v-if="routeKind !== 'portal' && routeKind !== 'worlds'" class="relative w-screen h-screen overflow-hidden">
    <!-- Three.js Canvas -->
    <canvas ref="threeCanvas" class="three-canvas absolute inset-0 z-0" />

    <div class="world-breadcrumbs">
      <SpaceBreadcrumbs :space-name="activeSpaceName" :projection-id="activeProjectionId" />
    </div>

    <!-- Overlay System (Loading/Pause/Settings) -->
    <UiRoot />

    <!-- Minecraft Style HUD (只在 playing 时显示) -->
    <GameHud />

    <!-- 准星（仅在 Pointer Lock 激活时显示） -->
    <Crosshair />

    <!-- Debug 模式：浮动 Event Monitor 面板 -->
    <EventMonitorPanel v-if="isDebugMode" class="event-monitor-overlay overflow-visible" />
  </div>
</template>

<style scoped>
:global(html.app-scrollable),
:global(body.app-scrollable) {
  height: auto;
  min-height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.three-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

/* Event Monitor 浮动面板样式 */
.event-monitor-overlay {
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  z-index: 100;
}

.admin-overlay {
  position: absolute;
  inset: 0;
  z-index: 300;
}

.world-breadcrumbs {
  position: absolute;
  top: 1rem;
  left: 1rem;
  z-index: 120;
  padding: 0.75rem 1rem;
  border-radius: 999px;
  background: rgba(6, 13, 18, 0.58);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
