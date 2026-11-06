<script setup>
/**
 * RedstoneCredits - the azazo1/redstone-rs attribution line.
 *
 * Every page footer shows the same note: the Redstone Archive replays are not
 * hand-authored, they are computed by redstone-rs' deterministic simulator.
 * `variant="footer"` is the boxed footer treatment, `variant="inline"` is a
 * plain one-line note for tighter bottoms (cards, console footers).
 */
import { useI18n } from 'vue-i18n'

defineProps({
  variant: {
    type: String,
    default: 'footer',
    validator: value => ['footer', 'inline'].includes(value),
  },
})

const { t } = useI18n()

const REDSTONE_RS_URL = 'https://github.com/azazo1/redstone-rs'
</script>

<template>
  <p class="redstone-credits" :class="`redstone-credits--${variant}`">
    <span class="redstone-credits__dot" aria-hidden="true" />
    <span>{{ t('credits.redstoneLead') }}</span>
    <a
      class="redstone-credits__link"
      :href="REDSTONE_RS_URL"
      target="_blank"
      rel="noopener noreferrer"
    >azazo1/redstone-rs</a>
    <span>{{ t('credits.redstoneBody') }}</span>
  </p>
</template>

<style scoped>
.redstone-credits {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 4px;
  margin: 0;
  color: var(--rs-text-2);
  font: 400 13px/1.6 var(--rs-font-body);
}

.redstone-credits--footer {
  max-width: 46em;
  padding: 10px 14px;
  border: 1px solid var(--rs-line);
  border-left: 2px solid var(--rs-red);
  border-radius: var(--rs-radius);
  background: rgba(15, 17, 20, 0.6);
}

.redstone-credits--inline {
  font-size: 12px;
}

.redstone-credits__dot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-right: 4px;
  background: var(--rs-red-hot);
  box-shadow: 0 0 6px var(--rs-glow);
  translate: 0 -1px;
}

.redstone-credits__link {
  color: var(--rs-text);
  font-family: var(--rs-font-mono);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: var(--rs-red);
  text-underline-offset: 3px;
  transition: color 0.15s ease, text-shadow 0.15s ease;
}

.redstone-credits__link:hover,
.redstone-credits__link:focus-visible {
  color: var(--rs-red-hot);
  text-shadow: 0 0 8px var(--rs-glow-soft);
}

.redstone-credits__link:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 2px;
}
</style>
