<script setup>
import { computed } from 'vue'

const props = defineProps({
  spaceName: {
    type: String,
    default: '',
  },
})

const homeHref = computed(() => {
  if (typeof window === 'undefined') {
    return '/'
  }

  return `${window.location.origin}/`
})
</script>

<template>
  <main class="missing-shell">
    <section class="missing-card">
      <p class="missing-kicker">Space Not Found</p>
      <h1>找不到这个创作者页面</h1>
      <p class="missing-copy">
        <span v-if="spaceName">`{{ spaceName }}`</span>
        <span v-if="spaceName"> 还没有对应的公开空间，或者这个地址并不存在。</span>
        <span v-else>这个地址还没有对应的公开空间。</span>
      </p>
      <div class="missing-actions">
        <a class="primary-link" :href="homeHref">返回 Litemora 首页</a>
      </div>
    </section>
  </main>
</template>

<style scoped>
.missing-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  background:
    radial-gradient(circle at top left, rgba(126, 188, 211, 0.16), transparent 30%),
    radial-gradient(circle at 80% 20%, rgba(111, 255, 206, 0.12), transparent 22%),
    linear-gradient(180deg, #081018 0%, #0d1419 46%, #0f171d 100%);
  color: #edf4f7;
}

.missing-card {
  width: min(680px, 100%);
  padding: 2.5rem 2.4rem;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(12, 20, 27, 0.94) 0%, rgba(14, 22, 28, 0.88) 100%);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
}

.missing-kicker {
  margin: 0;
  color: #7ebcd3;
  font-size: 0.82rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.missing-card h1 {
  margin: 1rem 0 0;
  font-size: clamp(2rem, 6vw, 3.6rem);
  line-height: 0.98;
  letter-spacing: -0.04em;
}

.missing-copy {
  margin: 1.15rem 0 0;
  color: #a9c0ce;
  font-size: 1rem;
  line-height: 1.8;
}

.missing-actions {
  margin-top: 1.75rem;
  display: flex;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 1.2rem;
  border-radius: 999px;
  background: #edf4f7;
  color: #081018;
  font-size: 0.95rem;
  font-weight: 600;
  text-decoration: none;
}

.primary-link:hover {
  background: #dce8ee;
}

@media (max-width: 720px) {
  .missing-card {
    padding: 2rem 1.4rem;
    border-radius: 22px;
  }
}
</style>
