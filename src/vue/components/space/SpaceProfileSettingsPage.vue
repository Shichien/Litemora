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
// Default title when no custom one is set; mirrors SpaceWorldsPage's defaultBrandTitle.
const defaultPreviewTitle = computed(() => {
  if (!String(props.titleValue || '').trim() && props.previewTitle) {
    return props.previewTitle
  }
  const owner = String(props.displayName || props.spaceName || '').trim()
  if (!owner) {
    return 'Litemora Worlds'
  }
  return /worlds$/iu.test(owner) ? owner : `${owner}'s Worlds`
})
// Live preview while typing.
const previewLabel = computed(() => String(draftTitle.value || '').trim() || defaultPreviewTitle.value)

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
    <article class="profile-card rs-panel rs-panel--stone rs-panel--wired" :class="{ 'is-powered': canEdit }">
      <div class="profile-card-head">
        <button type="button" class="profile-back-button rs-btn rs-btn--ghost rs-btn--sm" @click="$emit('back')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span>返回 Worlds</span>
        </button>
        <span class="profile-kicker rs-eyebrow">Profile Settings</span>
        <h2>自定义 worlds 顶栏</h2>
        <p>
          顶栏左侧会显示你的头像、Title 和快捷入口。这里保存后会直接更新当前 Space 的 worlds 页面展示。
        </p>
      </div>

      <div class="profile-identity">
        <span class="profile-avatar">
          <img v-if="avatarUrl" :src="avatarUrl" :alt="displayName || spaceName">
          <span v-else class="profile-avatar-initial">{{ avatarFallback }}</span>
        </span>
        <div class="profile-identity-copy">
          <strong>{{ displayName || spaceName }}</strong>
          <span>{{ spaceName }}</span>
        </div>
      </div>

      <form class="profile-form" @submit.prevent="handleSubmit">
        <label class="profile-field">
          <span class="field-label">Title</span>
          <input
            v-model="draftTitle"
            class="rs-input"
            type="text"
            maxlength="160"
            placeholder="Litemora"
            :disabled="!canEdit"
          >
          <small>显示在 worlds 顶栏左侧。留空时会回退到默认标题。</small>
        </label>

        <div class="profile-preview" aria-live="polite">
          <span class="field-label">Preview</span>
          <div class="preview-mock">
            <span class="preview-avatar" aria-hidden="true">
              <img v-if="avatarUrl" :src="avatarUrl" alt="">
              <span v-else class="profile-avatar-initial">{{ avatarFallback }}</span>
            </span>
            <strong>{{ previewLabel }}</strong>
          </div>
        </div>

        <div class="profile-rss">
          <div class="profile-rss-copy">
            <span class="field-label">RSS Feed</span>
            <p>导出当前 Space 的投影 RSS，便于订阅或外部聚合。</p>
          </div>
          <button type="button" class="profile-rss-button rs-btn rs-btn--sm" @click="$emit('open-rss')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
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
          <button type="button" class="profile-action secondary rs-btn rs-btn--ghost" :disabled="isSaveDisabled" @click="handleReset">
            恢复默认
          </button>
          <button type="submit" class="profile-action primary rs-btn rs-btn--primary" :disabled="isSaveDisabled">
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
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: min(720px, 100%);
  padding: 28px 32px 32px;
}

.profile-card-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.profile-back-button {
  margin: 0 0 8px -6px;
  padding: 0 10px 0 6px;
  border-color: transparent;
  color: var(--rs-text-2);
}

.profile-card-head h2 {
  margin: 0;
  color: var(--rs-text);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.25;
}

.profile-card-head p {
  max-width: 60ch;
  margin: 0;
  color: var(--rs-text-2);
  font-size: 14px;
  line-height: 1.7;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--rs-line);
  border-radius: var(--rs-radius);
  background: rgba(8, 9, 11, 0.5);
}

.profile-avatar,
.preview-avatar {
  display: grid;
  place-items: center;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background:
    linear-gradient(180deg, rgba(255, 90, 60, 0.28), rgba(80, 8, 0, 0.5)),
    var(--rs-tex-redstone-block) center / 24px 24px;
  image-rendering: pixelated;
}

.profile-avatar {
  width: 48px;
  height: 48px;
}

.preview-avatar {
  width: 32px;
  height: 32px;
}

.profile-avatar img,
.preview-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: auto;
}

.profile-avatar-initial {
  color: #fff;
  font: 400 16px/1 var(--rs-font-pixel);
  -webkit-font-smoothing: none;
  translate: 0 2px;
}

.preview-avatar .profile-avatar-initial {
  font-size: 8px;
  translate: 0 1px;
}

.profile-identity-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.profile-identity-copy strong {
  overflow: hidden;
  color: var(--rs-text);
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-identity-copy span {
  color: var(--rs-text-2);
  font: 12px/1.3 var(--rs-font-mono);
}

.profile-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.field-label {
  color: var(--rs-text-2);
  font: 500 11px/1 var(--rs-font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.profile-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.profile-field .rs-input {
  height: 44px;
  font-size: 15px;
}

.profile-field .rs-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.profile-field small {
  color: var(--rs-text-2);
  font-size: 12.5px;
  line-height: 1.5;
}

.profile-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-mock {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px dashed var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background-color: var(--rs-bg-0);
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 16px 16px;
}

.preview-mock strong {
  overflow: hidden;
  color: var(--rs-text);
  font-size: 20px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-rss {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--rs-line);
  border-left: 3px solid var(--rs-copper);
  border-radius: var(--rs-radius);
  background: rgba(8, 9, 11, 0.5);
}

.profile-rss-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.profile-rss-copy p {
  margin: 0;
  color: var(--rs-text-2);
  font-size: 13.5px;
  line-height: 1.5;
}

.profile-rss-button {
  flex: none;
}

.profile-note {
  margin: 0;
  padding: 10px 14px;
  border: 1px solid rgba(255, 195, 90, 0.35);
  border-radius: var(--rs-radius);
  background: rgba(60, 40, 8, 0.35);
  color: #ffd897;
  font-size: 13.5px;
  line-height: 1.5;
}

.profile-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 20px;
  border-top: 1px solid var(--rs-line);
}

@media (max-width: 640px) {
  .profile-card {
    gap: 20px;
    padding: 22px 18px 24px;
  }

  .profile-card-head h2 {
    font-size: 22px;
  }

  .profile-rss {
    flex-direction: column;
    align-items: stretch;
  }

  .profile-actions {
    flex-direction: column-reverse;
  }

  .profile-actions .rs-btn {
    width: 100%;
  }
}
</style>
