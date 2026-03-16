<script setup>
import {
  getAuthProviders,
  loadAdminAuthSession,
  signInWithProvider,
} from '@three/auth/admin-auth.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceWorldsUrl } from '@three/utils/space-context.js'
import SpaceBreadcrumbs from '@ui-components/space/SpaceBreadcrumbs.vue'
import { computed, ref } from 'vue'

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

const authProviders = getAuthProviders()
const authSession = ref(loadAdminAuthSession())
const isAuthenticating = ref(false)
const authError = ref('')

const viewerDisplayName = computed(() => {
  const account = authSession.value?.account
  if (!account) {
    return ''
  }
  return account.name || account.email || account.id
})

async function handleProviderAuth(provider) {
  if (isAuthenticating.value) {
    return
  }

  isAuthenticating.value = true
  authError.value = ''

  try {
    authSession.value = await signInWithProvider(provider)
  }
  catch (error) {
    authError.value = error?.message || '登录失败'
  }
  finally {
    isAuthenticating.value = false
  }
}

function goBackToWorlds() {
  if (!props.spaceName) {
    navigateToUrl(window.location.origin)
    return
  }

  navigateToUrl(buildSpaceWorldsUrl(props.spaceName))
}
</script>

<template>
  <main class="projection-gate">
    <section class="gate-shell">
      <header class="gate-topbar">
        <SpaceBreadcrumbs :space-name="spaceName" :projection-id="projectionId" />
      </header>

      <section class="gate-panel">
        <p class="gate-kicker">
          Projection Access
        </p>
        <h1 class="gate-title">
          登录后进入这个投影世界
        </h1>
        <p class="gate-copy">
          这个入口不会先启动 3D 世界。完成 GitHub OAuth 之后，页面会保留在当前投影路径里，并直接加载对应的世界状态。
        </p>

        <div class="gate-meta">
          <div class="meta-card">
            <span>Space</span>
            <strong>{{ spaceName || 'unknown' }}</strong>
          </div>
          <div class="meta-card">
            <span>Projection</span>
            <strong>{{ projectionId || 'unknown' }}</strong>
          </div>
          <div class="meta-card">
            <span>Account</span>
            <strong>{{ viewerDisplayName || '未登录' }}</strong>
          </div>
        </div>

        <div class="action-stack">
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

          <button type="button" class="action-btn subtle" @click="goBackToWorlds">
            返回投影列表
          </button>
        </div>

        <p v-if="authError" class="feedback warning">
          {{ authError }}
        </p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.projection-gate {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(123, 188, 255, 0.18), transparent 36%),
    radial-gradient(circle at bottom right, rgba(112, 255, 197, 0.12), transparent 30%),
    linear-gradient(180deg, #071018 0%, #0c141b 52%, #111920 100%);
  color: #edf5f9;
}

.gate-shell {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 2rem 0 4rem;
}

.gate-topbar {
  padding-bottom: 2rem;
}

.gate-panel {
  padding: 2rem;
  border: 1px solid rgba(144, 182, 205, 0.18);
  border-radius: 28px;
  background: rgba(8, 18, 25, 0.74);
  box-shadow: 0 32px 96px rgba(0, 0, 0, 0.28);
}

.gate-kicker {
  margin: 0;
  color: #79bfe1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.86rem;
}

.gate-title {
  margin: 1rem 0 0;
  font-size: clamp(2.2rem, 6vw, 4.6rem);
  line-height: 0.98;
  letter-spacing: -0.05em;
}

.gate-copy {
  max-width: 720px;
  margin: 1rem 0 0;
  color: #aac0cf;
  line-height: 1.8;
}

.gate-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 2rem;
}

.meta-card {
  padding: 1rem 1.1rem;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.meta-card span {
  display: block;
  color: #8ea9ba;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.meta-card strong {
  display: block;
  margin-top: 0.55rem;
  font-size: 1rem;
}

.action-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-top: 2rem;
}

.action-btn {
  border: none;
  border-radius: 999px;
  padding: 0.95rem 1.4rem;
  font: inherit;
  cursor: pointer;
}

.action-btn.primary {
  background: #edf5f9;
  color: #081018;
}

.action-btn.subtle {
  background: rgba(255, 255, 255, 0.08);
  color: #edf5f9;
}

.feedback.warning {
  margin-top: 1rem;
  color: #ffd79a;
}

@media (max-width: 760px) {
  .gate-panel {
    padding: 1.3rem;
    border-radius: 22px;
  }

  .gate-meta {
    grid-template-columns: 1fr;
  }
}
</style>
