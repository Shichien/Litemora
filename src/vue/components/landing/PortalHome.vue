<script setup>
import { buildSpaceUrl, isValidSpaceName, normalizeSpaceName } from '@three/utils/space-context.js'
import { computed, ref } from 'vue'

const inputSpaceName = ref('')
const errorText = ref('')

const normalizedSpaceName = computed(() => normalizeSpaceName(inputSpaceName.value))
const canCreate = computed(() => isValidSpaceName(normalizedSpaceName.value))

function handleSubmit() {
  errorText.value = ''

  if (!canCreate.value) {
    errorText.value = '名称需为 3-63 位，仅支持小写字母、数字和连字符 (-)'
    return
  }

  try {
    const targetUrl = buildSpaceUrl(normalizedSpaceName.value)
    window.location.href = targetUrl
  }
  catch {
    errorText.value = '创建空间失败，请稍后重试'
  }
}
</script>

<template>
  <main class="portal-home">
    <section class="portal-panel">
      <p class="portal-kicker">
        创建你的空间
      </p>
      <h1 class="portal-title">
        创建你的专属空间
      </h1>
      <p class="portal-subtitle">
        为你的影像档案选择一个独一无二的名字，这将成为你的专属网址。
      </p>

      <label class="portal-label" for="space-name">你的空间名称</label>
      <div class="portal-input-row">
        <input
          id="space-name"
          v-model="inputSpaceName"
          type="text"
          autocomplete="off"
          maxlength="63"
          placeholder="例如：myspace"
          class="portal-input"
          @keydown.enter.prevent="handleSubmit"
        >
        <span class="portal-suffix">.litemora.art</span>
      </div>

      <div class="portal-tip-box">
        <h3 class="portal-tip-title">
          小提示
        </h3>
        <ul>
          <li>只能使用英文字母、数字和连字符（-）</li>
          <li>至少 3 个字符，建议简短易记</li>
          <li>一旦创建，名称将不可更改</li>
        </ul>
      </div>

      <p v-if="errorText" class="portal-error">
        {{ errorText }}
      </p>

      <button
        type="button"
        class="portal-create-btn"
        :disabled="!canCreate"
        @click="handleSubmit"
      >
        创建我的空间
      </button>
    </section>
  </main>
</template>

<style scoped>
.portal-home {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #030406;
  color: #e5e7eb;
  padding: 1.5rem;
}

.portal-panel {
  width: min(760px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.75);
  padding: 2.5rem 2.25rem;
}

.portal-kicker {
  margin: 0;
  color: #8b9098;
  font-size: 0.95rem;
  text-align: center;
}

.portal-title {
  margin: 0.75rem 0 1rem;
  text-align: center;
  font-size: clamp(2rem, 6vw, 3.3rem);
  letter-spacing: 0.02em;
}

.portal-subtitle {
  margin: 0 auto 2rem;
  max-width: 620px;
  text-align: center;
  color: #9ca3af;
  line-height: 1.65;
}

.portal-label {
  display: block;
  margin-bottom: 0.75rem;
  color: #d1d5db;
}

.portal-input-row {
  display: flex;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(3, 4, 6, 0.85);
}

.portal-input {
  flex: 1;
  height: 4rem;
  background: transparent;
  border: none;
  outline: none;
  color: #f9fafb;
  font-size: 2rem;
  padding: 0 1.25rem;
}

.portal-input::placeholder {
  color: #6b7280;
  font-size: 1.75rem;
}

.portal-suffix {
  padding: 0 1.25rem;
  color: #9ca3af;
  font-size: 1.5rem;
}

.portal-tip-box {
  margin-top: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1rem 1.2rem;
  color: #9ca3af;
}

.portal-tip-title {
  margin: 0 0 0.6rem;
  color: #f3f4f6;
  font-size: 1rem;
}

.portal-tip-box ul {
  margin: 0;
  padding-left: 1.25rem;
  line-height: 1.8;
}

.portal-error {
  margin: 0.9rem 0 0;
  color: #f87171;
}

.portal-create-btn {
  margin-top: 1.5rem;
  width: 100%;
  height: 4rem;
  border: none;
  background: #5f6165;
  color: #101217;
  font-size: 1.5rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.portal-create-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
