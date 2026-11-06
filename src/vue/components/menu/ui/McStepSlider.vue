<script setup>
/**
 * McStepSlider - Minecraft-style discrete step slider
 *
 * Features:
 * - Discrete steps (not continuous)
 * - Keyboard support (Arrow keys)
 * - @input: fires during drag (for UI preview)
 * - @change: fires on release (for apply to Three.js)
 */
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  label: { type: String, default: '' },
  unit: { type: String, default: '' },
  // Optional marks for display (e.g., ['Off', 'Low', 'High'])
  marks: { type: Array, default: () => [] },
  // Decimal places for value display
  decimals: { type: Number, default: 0 },
})

const emit = defineEmits(['update:modelValue', 'input', 'change'])

// Local value for immediate UI feedback
const localValue = ref(props.modelValue)

// Sync with prop changes
watch(() => props.modelValue, (newVal) => {
  localValue.value = newVal
})

// Current step index
const currentStepIndex = computed(() =>
  Math.round((localValue.value - props.min) / props.step),
)

// Progress percentage for slider fill
const progressPercent = computed(() =>
  ((localValue.value - props.min) / (props.max - props.min)) * 100,
)

// Redstone power cells: one per step (capped at 16), lit up to the current value.
const stepCount = computed(() => Math.max(1, Math.round((props.max - props.min) / props.step)))
const cellCount = computed(() => Math.min(16, stepCount.value))
const litCells = computed(() => Math.max(0, Math.min(cellCount.value, Math.round((progressPercent.value / 100) * cellCount.value))))
const trackStyle = computed(() => ({
  '--cells': cellCount.value,
  '--lit': `${(litCells.value / cellCount.value) * 100}%`,
}))

// Format display value
const displayValue = computed(() => {
  if (props.marks.length > 0 && props.marks[currentStepIndex.value]) {
    return props.marks[currentStepIndex.value]
  }
  return localValue.value.toFixed(props.decimals) + props.unit
})

// Quantize value to nearest step
function quantize(value) {
  const steps = Math.round((value - props.min) / props.step)
  return Math.max(props.min, Math.min(props.max, props.min + steps * props.step))
}

// Handle slider input (during drag)
function handleInput(event) {
  const raw = Number.parseFloat(event.target.value)
  localValue.value = quantize(raw)
  emit('update:modelValue', localValue.value)
  emit('input', localValue.value)
}

// Handle change (on release)
function handleChange() {
  emit('change', localValue.value)
}

// Keyboard step adjustment
function stepBy(delta) {
  const newValue = quantize(localValue.value + delta * props.step)
  if (newValue !== localValue.value) {
    localValue.value = newValue
    emit('update:modelValue', localValue.value)
    emit('input', localValue.value)
    emit('change', localValue.value)
  }
}

function handleKeyDown(event) {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault()
    stepBy(-1)
  }
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault()
    stepBy(1)
  }
}
</script>

<template>
  <div class="mc-step-slider">
    <span v-if="label" class="slider-label">{{ label }}</span>
    <div class="slider-track-container" :class="{ 'is-off': litCells === 0 }" :style="trackStyle">
      <div class="slider-track" aria-hidden="true">
        <div class="slider-fill" />
      </div>
      <span class="slider-knob" aria-hidden="true" />
      <input
        type="range"
        class="slider-input"
        :value="localValue"
        :min="min"
        :max="max"
        :step="step"
        :aria-label="label || undefined"
        @input="handleInput"
        @change="handleChange"
        @keydown="handleKeyDown"
      >
    </div>
    <span class="slider-value">{{ displayValue }}</span>
  </div>
</template>

<style scoped>
/* Value shown as a row of redstone power cells: unpowered cells are dark, powered ones glow. */
.mc-step-slider {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 32px;
}

.slider-label {
  flex-shrink: 0;
  min-width: 96px;
  color: var(--rs-text);
  font-size: 14px;
}

.slider-track-container {
  position: relative;
  flex: 1;
  height: 24px;
  min-width: 96px;
}

.slider-track {
  position: absolute;
  top: 6px;
  left: 0;
  right: 0;
  height: 12px;
  padding: 2px;
  border: 1px solid var(--rs-line-strong);
  border-radius: 2px;
  background: var(--rs-bg-0);
  box-sizing: border-box;
}

.slider-track::before,
.slider-fill {
  content: '';
  position: absolute;
  inset: 2px;
  background: repeating-linear-gradient(
    90deg,
    var(--cell) 0,
    var(--cell) calc(100% / var(--cells) - 2px),
    transparent calc(100% / var(--cells) - 2px),
    transparent calc(100% / var(--cells))
  );
  /* The last cell has no trailing gap: widen the pattern by one gap. */
  right: 0;
}

.slider-track::before {
  --cell: var(--rs-red-off);
}

.slider-fill {
  --cell: var(--rs-red-hot);
  clip-path: inset(0 calc(100% - var(--lit)) 0 0);
  filter: drop-shadow(0 0 3px rgba(255, 60, 30, 0.7));
  transition: clip-path 0.12s ease-out;
}

/* Lever-style knob sitting on the last powered cell boundary */
.slider-knob {
  position: absolute;
  top: 2px;
  left: clamp(0px, calc(var(--lit) - 5px), calc(100% - 10px));
  width: 10px;
  height: 20px;
  border: 1px solid #000;
  border-radius: 2px;
  background: linear-gradient(180deg, #8a8f96, #4b5057);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 1px 2px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  transition: left 0.12s ease-out;
}

.slider-track-container:hover .slider-knob {
  background: linear-gradient(180deg, #a3a8ae, #5c6168);
}

.slider-track-container:has(.slider-input:focus-visible) .slider-track {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 2px;
}

.slider-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 24px;
  cursor: pointer;
}

.slider-input::-moz-range-thumb {
  width: 16px;
  height: 24px;
  cursor: pointer;
}

.slider-value {
  flex-shrink: 0;
  min-width: 48px;
  color: var(--rs-text);
  font: 500 13px/1 var(--rs-font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.is-off + .slider-value {
  color: var(--rs-text-3);
}

@media (prefers-reduced-motion: reduce) {
  .slider-fill,
  .slider-knob {
    transition: none;
  }
}
</style>