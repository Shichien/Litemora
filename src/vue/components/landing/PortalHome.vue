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

function handleClose() {
  inputSpaceName.value = ''
  errorText.value = ''
}
</script>

<template>
  <main class="portal-home">
    <section class="portal-panel">
      <button type="button" class="portal-close" aria-label="关闭" @click="handleClose">
        ×
      </button>

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
  background: #020304;
  color: #e7e9ee;
  padding: 2rem;
}

.portal-panel {
  width: min(980px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: radial-gradient(1200px 600px at 50% -200px, rgba(255, 255, 255, 0.04), transparent), #020304;
  padding: 3.1rem 3.1rem 2.4rem;
  position: relative;
}

.portal-close {
  position: absolute;
  top: 1.8rem;
  right: 1.8rem;
  width: 3.2rem;
  height: 3.2rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: #9ca3af;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
}

.portal-kicker {
  margin: 0;
  color: #7f8793;
  font-size: 1.05rem;
  text-align: center;
  letter-spacing: 0.16em;
}

.portal-title {
  margin: 1rem 0 1.4rem;
  text-align: center;
  font-size: clamp(2.2rem, 6vw, 4rem);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.portal-subtitle {
  margin: 0 auto 2.6rem;
  max-width: 720px;
  text-align: center;
  color: #8f96a3;
  line-height: 1.65;
  font-size: 1.35rem;
}

.portal-label {
  display: block;
  margin-bottom: 1rem;
  color: #cfd6df;
  font-size: 1.4rem;
}

.portal-input-row {
  display: flex;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #03060a;
  height: 6.2rem;
}

.portal-input {
  flex: 1;
  height: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #f9fafb;
  font-size: clamp(1.5rem, 3vw, 2.2rem);
  padding: 0 1.5rem;
}

.portal-input::placeholder {
  color: #5f6673;
  font-size: clamp(1.3rem, 3vw, 2rem);
}

.portal-suffix {
  padding: 0 1.5rem;
  color: #7f8793;
  font-size: clamp(1.2rem, 2.3vw, 2rem);
}

.portal-tip-box {
  margin-top: 1.6rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 1.3rem 1.35rem;
  color: #9098a5;
  background: rgba(0, 0, 0, 0.35);
}

.portal-tip-title {
  margin: 0 0 0.6rem;
  color: #f4f6fb;
  font-size: 1.05rem;
}

.portal-tip-box ul {
  margin: 0;
  padding-left: 1.25rem;
  line-height: 2;
}

.portal-error {
  margin: 0.95rem 0 0;
  color: #f87171;
}

.portal-create-btn {
  margin-top: 2rem;
  width: 100%;
  height: 6rem;
  border: none;
  background: #7b7d82;
  color: #0f1218;
  font-size: 2rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.portal-create-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.portal-create-btn:not(:disabled):hover {
  transform: translateY(-1px);
}

@media (max-width: 768px) {
  .portal-home {
    padding: 1rem;
  }

  .portal-panel {
    padding: 2.3rem 1.2rem 1.5rem;
  }

  .portal-close {
    top: 1rem;
    right: 1rem;
  }

  .portal-subtitle {
    font-size: 1.05rem;
  }

  .portal-label {
    font-size: 1.05rem;
  }

  .portal-input-row {
    height: 4.5rem;
  }

  .portal-create-btn {
    height: 4.5rem;
    font-size: 1.35rem;
  }
}
</style>
