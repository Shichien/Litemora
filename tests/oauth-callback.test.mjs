/* eslint-disable test/no-import-node-test -- 刻意使用 node 内置测试运行器 (node --test)，不引入 vitest 等新依赖 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Execute the actual browser sources without Vite, a DOM library or dependencies.
const authSource = await readFile(new URL('../src/js/auth/admin-auth.js', import.meta.url), 'utf8')
const callbackHtml = await readFile(new URL('../public/auth-callback.html', import.meta.url), 'utf8')
const callbackSource = callbackHtml.match(/<script>([\s\S]*?)<\/script>/)[1]
const resultKey = 'mc-admin-oauth-result'
const nonce = 'a'.repeat(32)
const state = `github.${nonce}`
const origin = 'https://app.example'
const remoteOrigin = 'https://auth.example'

function storage(disabled = false) {
  const values = new Map()
  return {
    getItem(key) {
      if (disabled)
        throw new Error('storage disabled')
      return values.get(key) ?? null
    },
    setItem(key, value) {
      if (disabled)
        throw new Error('storage disabled')
      values.set(key, value)
    },
    removeItem(key) {
      if (disabled)
        throw new Error('storage disabled')
      values.delete(key)
    },
  }
}

function authHarness({ callbackOrigin = origin, disabled = false, appOrigin = origin } = {}) {
  const listeners = new Map()
  const timers = new Map()
  const opened = []
  const exchanges = []
  const localStorage = storage(disabled)
  let nextTimer = 0
  const window = {
    location: new URL(appOrigin),
    localStorage,
    screenX: 0,
    screenY: 0,
    outerWidth: 1200,
    outerHeight: 900,
    addEventListener(type, fn) {
      if (!listeners.has(type))
        listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
    dispatchEvent() {},
    open(url, name) {
      const popup = {
        closed: false,
        close() { this.closed = true },
      }
      opened.push({ url: new URL(url), name, popup })
      return popup
    },
  }
  const context = vm.createContext({
    window,
    localStorage,
    URL,
    URLSearchParams,
    TextEncoder,
    Uint8Array,
    crypto: webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    __env: { VITE_OAUTH_CALLBACK_ORIGIN: callbackOrigin, VITE_OAUTH_GITHUB_CLIENT_ID: 'github-client', VITE_OAUTH_GOOGLE_CLIENT_ID: 'google-client', DEV: false },
    setTimeout: (fn) => {
      timers.set(++nextTimer, fn)
      return nextTimer
    },
    setInterval: (fn) => {
      timers.set(++nextTimer, fn)
      return nextTimer
    },
    clearTimeout: id => timers.delete(id),
    clearInterval: id => timers.delete(id),
    CustomEvent: class {
      constructor(type, init) {
        this.type = type
        this.detail = init.detail
      }
    },
    fetch: async (url, options) => {
      exchanges.push({ url, body: JSON.parse(options.body) })
      return { ok: true, json: async () => ({ account: { id: '123', provider: url.split('/')[3] }, token: 'test-token' }) }
    },
  })
  vm.runInContext(`${authSource.replaceAll('import.meta', '({ env: __env })').replace(/^export /gm, '')
  }\n globalThis.api = { waitForOAuthCode, signInWithProvider, getRedirectUri };`, context)
  return {
    ...context.api,
    opened,
    exchanges,
    timers,
    localStorage,
    emit(type, event) { for (const fn of [...(listeners.get(type) || [])]) fn(event) },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
  }
}

function callbackHarness(params, { disabled = false, storedProvider = 'google', postMessage } = {}) {
  const localStorage = storage(disabled)
  if (!disabled)
    localStorage.setItem('mc-admin-oauth-provider', storedProvider)
  const messages = []
  const document = { body: { textContent: '' } }
  let closed = false
  const window = {
    location: { search: `?${new URLSearchParams(params)}` },
    localStorage,
    opener: {
      postMessage(payload, target) {
        messages.push({ payload, target })
        postMessage?.(payload)
      },
    },
    close() { closed = true },
  }
  vm.runInNewContext(callbackSource, { window, document, URLSearchParams, setTimeout: fn => fn() })
  return { messages, document, closed, localStorage }
}

function payload(overrides = {}) {
  return { type: 'mc-admin-oauth-code', provider: 'github', state, code: 'valid-code', ...overrides }
}

function wait(h, { popup = {}, expectedOrigin = origin, ...options } = {}) {
  const promise = h.waitForOAuthCode({ provider: 'github', state, popup, expectedOrigin, ...options })
  return { promise, popup }
}

async function pending(promise) {
  let settled = false
  promise.then(() => {
    settled = true
  }, () => {
    settled = true
  })
  await Promise.resolve()
  assert.equal(settled, false, 'unrelated callback must leave this attempt pending')
}

async function openedPopup(h, count = 1) {
  for (let i = 0; i < 100 && h.opened.length < count; i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(h.opened.length, count)
  return h.opened[count - 1]
}

test('callback routes both providers exclusively from full-format state, ignoring stale storage/query', () => {
  for (const provider of ['github', 'google']) {
    const fullState = `${provider}.${nonce}`
    const result = callbackHarness({ state: fullState, code: 'code', provider: 'wrong' })
    assert.equal(result.messages[0].payload.provider, provider)
    assert.equal(result.messages[0].payload.state, fullState)
    assert.equal(JSON.parse(result.localStorage.getItem(resultKey)).provider, provider)
    assert.equal(result.localStorage.getItem('mc-admin-oauth-provider'), 'google')
    assert.equal(result.closed, true)
  }
})

test('callback rejects missing, malformed and unknown-provider state, including error callbacks', () => {
  for (const invalid of ['', nonce, `unknown.${nonce}`, 'github.short', `${state}.extra`, `github.${'!'.repeat(32)}`]) {
    const result = callbackHarness({ state: invalid, error: 'access_denied', provider: 'github' })
    assert.equal(result.messages.length, 0)
    assert.equal(result.localStorage.getItem(resultKey), null)
    assert.match(result.document.body.textContent, /校验失败/)
  }
})

test('cross-origin sign-in works with storage disabled and preserves PKCE and redirect URI', async () => {
  for (const provider of ['github', 'google']) {
    const h = authHarness({ callbackOrigin: remoteOrigin, disabled: true })
    const login = h.signInWithProvider(provider)
    const opened = await openedPopup(h)
    const params = opened.url.searchParams
    assert.match(params.get('state'), new RegExp(`^${provider}\\.[A-Za-z0-9_-]{32}$`))
    assert.equal(params.get('redirect_uri'), `${remoteOrigin}/auth-callback.html`)
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.match(params.get('code_challenge'), /^[\w-]{43}$/)
    callbackHarness({ state: params.get('state'), code: 'remote-code' }, {
      disabled: true,
      postMessage: data => h.emit('message', { data, origin: remoteOrigin, source: opened.popup }),
    })
    const session = await login
    assert.equal(session.token, 'test-token')
    assert.equal(h.exchanges[0].body.redirectUri, params.get('redirect_uri'))
    assert.equal(h.exchanges[0].body.code, 'remote-code')
    assert.match(h.exchanges[0].body.codeVerifier, /^[\w-]{86}$/)
    assert.equal(opened.popup.closed, true)
    assert.equal(h.listenerCount(), 0)
    assert.equal(h.timers.size, 0)
  }
})

test('local development keeps its own fixed redirect URI', () => {
  for (const appOrigin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    const h = authHarness({ callbackOrigin: remoteOrigin, appOrigin })
    assert.equal(h.getRedirectUri(), `${appOrigin}/auth-callback.html`)
  }
})

test('message requires exact callback origin, popup source, provider and complete state before errors', async () => {
  const h = authHarness({ callbackOrigin: remoteOrigin })
  const { promise, popup } = wait(h, { expectedOrigin: remoteOrigin })
  for (const event of [
    { origin, source: popup, data: payload() },
    { origin: 'https://evil.example', source: popup, data: payload() },
    { origin: remoteOrigin, source: {}, data: payload() },
    { origin: remoteOrigin, source: null, data: payload() },
    { origin: remoteOrigin, source: popup, data: payload({ provider: 'google' }) },
    { origin: remoteOrigin, source: popup, data: payload({ state: `github.${'b'.repeat(32)}` }) },
    { origin: remoteOrigin, source: popup, data: payload({ state: '', error: 'access_denied' }) },
    { origin: remoteOrigin, source: popup, data: payload({ state: `github.${'b'.repeat(32)}`, error: 'access_denied' }) },
  ]) {
    h.emit('message', event)
    await pending(promise)
  }
  h.emit('storage', { key: resultKey, newValue: JSON.stringify(payload()) })
  await pending(promise)
  h.emit('message', { origin: remoteOrigin, source: popup, data: payload() })
  assert.equal((await promise).code, 'valid-code')
})

test('matching error is rejected safely and clears listeners/timers', async () => {
  const h = authHarness()
  const { promise, popup } = wait(h)
  callbackHarness({ state, error: 'access_denied', error_description: '<img onerror=alert(1)>' }, {
    postMessage: data => h.emit('message', { origin, source: popup, data }),
  })
  await assert.rejects(promise, /<img onerror=alert\(1\)>/)
  assert.equal(h.listenerCount(), 0)
  assert.equal(h.timers.size, 0)
})

test('matching success without a nonempty string code is rejected', async () => {
  for (const code of ['', '   ', undefined, 123]) {
    const h = authHarness()
    const { promise, popup } = wait(h)
    h.emit('message', { origin, source: popup, data: payload({ code }) })
    await assert.rejects(promise, /缺少授权码/)
  }
})

test('same-origin concurrent storage results only settle their matching attempt', async () => {
  const h = authHarness({ disabled: true })
  const first = wait(h)
  const secondState = `github.${'b'.repeat(32)}`
  const second = wait(h, { state: secondState })
  const googleState = `google.${nonce}`
  const third = wait(h, { provider: 'google', state: googleState })
  h.emit('storage', { key: resultKey, newValue: 'not-json' })
  h.emit('storage', { key: 'other-key', newValue: JSON.stringify(payload()) })
  h.emit('storage', { key: resultKey, newValue: JSON.stringify(payload({ state: secondState, error: 'denied' })) })
  await assert.rejects(second.promise, /denied/)
  await pending(first.promise)
  await pending(third.promise)
  h.emit('storage', { key: resultKey, newValue: JSON.stringify(payload()) })
  assert.equal((await first.promise).code, 'valid-code')
  await pending(third.promise)
  h.emit('storage', { key: resultKey, newValue: JSON.stringify(payload({ provider: 'google', state: googleState })) })
  assert.equal((await third.promise).code, 'valid-code')
  assert.equal(h.listenerCount(), 0)
})

test('same-provider sign-ins use independent cryptographic state and popup names', async () => {
  const h = authHarness()
  const first = h.signInWithProvider('github')
  const second = h.signInWithProvider('github')
  await openedPopup(h, 2)
  assert.notEqual(h.opened[0].name, h.opened[1].name)
  assert.notEqual(h.opened[0].url.searchParams.get('state'), h.opened[1].url.searchParams.get('state'))
  for (const opened of h.opened) {
    h.emit('message', { origin, source: opened.popup, data: payload({ state: opened.url.searchParams.get('state') }) })
  }
  await Promise.all([first, second])
  assert.equal(h.exchanges.length, 2)
})

test('callback preserves storage fallback when postMessage fails and never renders error HTML', () => {
  const result = callbackHarness({ state, error: 'denied', error_description: '<script>evil()</script>' }, {
    postMessage() { throw new Error('opener gone') },
  })
  assert.equal(JSON.parse(result.localStorage.getItem(resultKey)).error, 'denied')
  assert.equal(result.closed, true)
  assert.match(result.document.body.textContent, /登录失败/)
  assert.doesNotMatch(result.document.body.textContent, /script/)
})
