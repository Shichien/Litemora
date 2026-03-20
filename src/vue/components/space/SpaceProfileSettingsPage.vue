<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  spaceName: {
    type: String,
    default: '',
  },
  titleValue: {
    type: String,
    default: '',
  },
  previewTitle: {
    type: String,
    default: '',
  },
  displayName: {
    type: String,
    default: '',
  },
  avatarUrl: {
    type: String,
    default: '',
  },
  avatarFallback: {
    type: String,
    default: 'L',
  },
  isAuthenticated: {
    type: Boolean,
    default: false,
  },
  canEdit: {
    type: Boolean,
    default: false,
  },
  isSaving: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['back', 'save-title', 'reset-title', 'open-rss'])

const draftTitle = ref(props.titleValue)

const isSaveDisabled = computed(() => !props.canEdit || props.isSaving)
const previewLabel = computed(() => props.previewTitle || draftTitle.value || `${props.spaceName}'s Worlds`)

watch(
  () => props.titleValue,
  (value) => {
    draftTitle.value = value
  },
)

function handleSubmit() {
  emit('save-title', draftTitle.value)
}

function handleReset() {
  draftTitle.value = ''
  emit('reset-title')
}
</script>

<template>
  <section class="profile-settings-page">
    <article class="profile-card">
      <div class="profile-card-head">
        <button type="button" class="profile-back-button" @click="$emit('back')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"></path>
          </svg>
          <span>返回 Worlds</span>
        </button>
        <span class="profile-kicker">Profile Settings</span>
        <h2>自定义 worlds 顶栏</h2>
        <p>
          顶栏左侧会显示你的头像、Title 和快捷入口。这里保存后会直接更新当前 Space 的 worlds 页面展示。
        </p>
      </div>

      <div class="profile-identity">
        <span class="profile-avatar">
          <img v-if="avatarUrl" :src="avatarUrl" :alt="displayName || spaceName">
          <span v-else>{{ avatarFallback }}</span>
        </span>
        <div class="profile-identity-copy">
          <strong>{{ displayName || spaceName }}</strong>
          <span>{{ spaceName }}</span>
        </div>
      </div>

      <form class="profile-form" @submit.prevent="handleSubmit">
        <label class="profile-field">
          <span>Title</span>
          <input
            v-model="draftTitle"
            type="text"
            maxlength="160"
            placeholder="Deralive's Afilmory"
            :disabled="!canEdit"
          >
          <small>显示在 worlds 顶栏左侧。留空时会回退到默认标题。</small>
        </label>

        <div class="profile-preview">
          <span>Preview</span>
          <strong>{{ previewLabel }}</strong>
        </div>

        <div class="profile-rss">
          <div class="profile-rss-copy">
            <span>RSS Feed</span>
            <p>导出当前 Space 的投影 RSS，便于订阅或外部聚合。</p>
          </div>
          <button type="button" class="profile-rss-button" @click="$emit('open-rss')">
            打开 RSS
          </button>
        </div>

        <p v-if="!isAuthenticated" class="profile-note">
          登录后才能保存 Title。
        </p>
        <p v-else-if="!canEdit" class="profile-note">
          当前账号没有这个 Space 的资料编辑权限。
        </p>

        <div class="profile-actions">
          <button type="button" class="profile-action secondary" @click="handleReset" :disabled="isSaveDisabled">
            恢复默认
          </button>
          <button type="submit" class="profile-action primary" :disabled="isSaveDisabled">
            {{ isSaving ? '保存中...' : '保存 Title' }}
          </button>
        </div>
      </form>
    </article>
  </section>
</template>

<style scoped>
.profile-settings-page {
  display: flex;
  justify-content: center;
}

.profile-card {
  width: min(860px, 100%);
  display: grid;
  gap: 1.5rem;
  padding: 1.6rem;
  border-radius: 28px;
  border: 1px solid rgba(126, 189, 228, 0.14);
  background:
    radial-gradient(circle at top left, rgba(124, 189, 228, 0.15), transparent 34%),
    linear-gradient(180deg, rgba(10, 18, 24, 0.92) 0%, rgba(10, 16, 22, 0.9) 100%);
  box-shadow: 0 28px 72px rgba(0, 0, 0, 0.24);
}

.profile-card-head {
  display: grid;
  gap: 0.55rem;
}

.profile-back-button {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0;
  border: none;
  background: transparent;
  color: #9fbece;
  font: inherit;
  cursor: pointer;
}

.profile-kicker {
  color: #71bddf;
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.profile-card-head h2 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 2.9rem);
  letter-spacing: -0.04em;
}

.profile-card-head p {
  margin: 0;
  max-width: 60ch;
  color: #9db7c5;
  line-height: 1.7;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.profile-avatar {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, #253548 0%, #6f8ca0 100%);
  color: #f6fbff;
  font-size: 1.1rem;
  font-weight: 700;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-identity-copy {
  display: grid;
  gap: 0.18rem;
}

.profile-identity-copy strong {
  font-size: 1rem;
}

.profile-identity-copy span {
  color: #8ea9b8;
}

.profile-form {
  display: grid;
  gap: 1rem;
}

.profile-field {
  display: grid;
  gap: 0.55rem;
}

.profile-field > span,
.profile-preview > span,
.profile-rss-copy > span {
  color: #cfe5f0;
  font-size: 0.92rem;
  font-weight: 600;
}

.profile-field input {
  width: 100%;
  border: 1px solid rgba(126, 189, 228, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  color: #edf4f7;
  padding: 0.95rem 1rem;
  font: inherit;
}

.profile-field input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.profile-field small {
  color: #82a0af;
}

.profile-preview,
.profile-rss {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.05rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.profile-preview strong {
  font-size: 1.15rem;
  letter-spacing: -0.02em;
}

.profile-rss-copy {
  display: grid;
  gap: 0.22rem;
}

.profile-rss-copy p {
  margin: 0;
  color: #8faab8;
  line-height: 1.6;
}

.profile-rss-button,
.profile-action {
  border: none;
  border-radius: 999px;
  padding: 0.78rem 1.1rem;
  font: inherit;
  cursor: pointer;
}

.profile-rss-button,
.profile-action.secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #edf4f7;
}

.profile-action.primary {
  background: #edf4f7;
  color: #081018;
  font-weight: 700;
}

.profile-rss-button:hover,
.profile-action.secondary:hover {
  background: rgba(255, 255, 255, 0.12);
}

.profile-action:disabled,
.profile-rss-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.profile-note {
  margin: 0;
  color: #ffd08a;
}

.profile-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

@media (max-width: 760px) {
  .profile-card {
    padding: 1.2rem;
    border-radius: 22px;
  }

  .profile-preview,
  .profile-rss,
  .profile-identity,
  .profile-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
