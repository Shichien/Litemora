import {
  clearAdminAuthSession,
  getAuthProviders,
  loadAdminAuthSession,
  signInWithProvider,
} from '@three/auth/admin-auth.js'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const AUTH_CHANGED_EVENT = 'admin-auth-changed'

/**
 * Shared OAuth sign-in state for the three entry points that render the
 * provider buttons: the landing portal, a space's worlds page and the admin
 * config page.
 *
 * The three call sites were never byte-identical, so the differences are kept
 * as options instead of being flattened away:
 *
 * - `mode: 'admin'` skips the cross-tab `admin-auth-changed` listener. The admin
 *   console never listened to it; it re-hydrates through `watch(currentAccountId)`
 *   instead, so wiring the listener there would change its behaviour.
 * - `onAuthenticated(session)` runs after the session is stored, still inside the
 *   try block, so a throw is reported through `authError` exactly like a failed
 *   sign-in. Each page uses it for its own status message and data reload.
 * - `onSessionChange(session)` runs after an external session sync (the
 *   `admin-auth-changed` event), for pages that close a menu or reload data.
 */
export function useGalleryAuth(options = {}) {
  const {
    mode = 'default',
    onAuthenticated = null,
    onSessionChange = null,
  } = options

  const authProviders = getAuthProviders()
  const authSession = ref(loadAdminAuthSession())
  const isAuthenticating = ref(false)
  const authError = ref('')

  const currentAccount = computed(() => authSession.value?.account || null)
  const currentAccountId = computed(() => currentAccount.value?.id || '')
  const isLoggedIn = computed(() => !!authSession.value?.account?.id)

  function providerLabel(provider) {
    if (!provider?.label) {
      return '登录'
    }

    return `使用 ${provider.label} 登录`
  }

  function syncAuthSession(event = null) {
    authSession.value = event?.detail?.session || loadAdminAuthSession()
    onSessionChange?.(authSession.value)
  }

  async function loginWithProvider(providerId) {
    if (isAuthenticating.value) {
      return null
    }

    isAuthenticating.value = true
    authError.value = ''
    try {
      const session = await signInWithProvider(providerId)
      authSession.value = session
      await onAuthenticated?.(session)
      return session
    }
    catch (error) {
      authError.value = error?.message || '登录失败'
      return null
    }
    finally {
      isAuthenticating.value = false
    }
  }

  function logout() {
    clearAdminAuthSession()
    authSession.value = null
  }

  if (mode !== 'admin') {
    onMounted(() => {
      window.addEventListener(AUTH_CHANGED_EVENT, syncAuthSession)
    })
    onBeforeUnmount(() => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncAuthSession)
    })
  }

  return {
    authProviders,
    authSession,
    isAuthenticating,
    authError,
    isLoggedIn,
    currentAccount,
    currentAccountId,
    providerLabel,
    syncAuthSession,
    loginWithProvider,
    // Same function under the name the worlds page and admin console templates use.
    handleProviderAuth: loginWithProvider,
    logout,
  }
}
