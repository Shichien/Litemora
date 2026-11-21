<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  ready: Boolean,
  name: { type: String, default: 'schematic' },
  getModel: { type: Function, required: true },
})
const format = ref('glb')
const scale = ref(1)
const busy = ref(false)
const message = ref('')
const failed = ref(false)
let generation = 0
const hints = {
  glb: '保留方块模型、贴图和透明材质，可直接导入 Blender。1 方块 = 1 米。',
  stl: '仅导出几何，不含颜色和贴图。模型会转为 Z 轴向上；切片软件按毫米读取时，下方数值即每方块的毫米数。模型可能含薄面或悬空部件，打印前需检查并修复。',
  obj: '导出几何、法线和 UV，不附带 MTL 或贴图；需要材质请使用 GLB。1 方块 = 1 单位。',
  blender: '下载 ZIP，内含带贴图的 GLB 和 Blender 转换脚本。解压后使用本机 Blender 运行脚本生成真正的 .blend，操作见包内说明。',
}
const hint = computed(() => hints[format.value])
watch(() => props.ready, () => {
  generation++
  message.value = ''
})
onBeforeUnmount(() => {
  generation++
})

async function downloadModel() {
  if (busy.value || !props.ready)
    return
  const factor = Number(scale.value)
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1000) {
    failed.value = true
    message.value = '缩放比例必须大于 0，且不超过 1000。'
    return
  }
  const currentGeneration = generation
  const selectedFormat = format.value
  const name = props.name
  busy.value = true
  failed.value = false
  message.value = '正在生成导出文件，大型模型可能需要一些时间…'
  try {
    const { exportSchematicModel } = await import('@three/export/schematic-model-export.js')
    if (generation !== currentGeneration || !props.ready)
      return
    const model = props.getModel()
    if (!model)
      throw new Error('模型尚未就绪，请等待预览加载完成。')
    const result = await exportSchematicModel(model, { format: selectedFormat, name, scale: factor })
    if (generation !== currentGeneration || !props.ready)
      return
    const url = URL.createObjectURL(result.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    message.value = `已生成 ${result.filename}，下载已开始。`
  }
  catch (error) {
    if (generation !== currentGeneration)
      return
    failed.value = true
    message.value = error?.message || '导出失败，请重试。'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="model-export" aria-label="导出三维模型" :aria-busy="busy">
    <div class="export-heading">
      <strong>导出三维模型</strong>
      <span>在浏览器本地生成文件</span>
    </div>
    <div class="export-controls">
      <label>
        文件格式
        <select v-model="format" :disabled="busy">
          <option value="glb">GLB · 带贴图模型</option>
          <option value="stl">STL · 打印几何</option>
          <option value="obj">OBJ · 通用几何</option>
          <option value="blender">Blender · .blend 转换包（ZIP）</option>
        </select>
      </label>
      <label>
        {{ format === 'stl' ? '每方块尺寸（mm）' : '缩放比例' }}
        <input v-model.number="scale" type="number" min="0.001" max="1000" step="any" :disabled="busy">
      </label>
      <button type="button" :disabled="!ready || busy" @click="downloadModel">
        {{ busy ? '正在导出…' : '下载模型' }}
      </button>
    </div>
    <p>{{ hint }}</p>
    <p v-if="!ready">
      上传原理图并等待预览完成后即可导出。
    </p>
    <p v-if="message" role="status" :class="{ 'export-error': failed }">
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.model-export { width: min(100%, 960px); margin: 1rem auto 0; padding: 1rem; border: 1px solid rgba(146, 202, 235, 0.22); border-radius: 16px; background: #101e27; color: #e6f1f6; box-sizing: border-box; }
.export-heading { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline; }
.export-heading span, p { color: #b6cbd8; font-size: 0.85rem; line-height: 1.6; }
.export-controls { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: end; margin-top: 0.8rem; }
label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; }
select, input, button { min-height: 40px; border: 1px solid #4c6879; border-radius: 8px; padding: 0.5rem 0.7rem; color: #e6f1f6; background: #152d3a; }
input { width: 110px; }
button { cursor: pointer; background: #23566c; font-weight: 600; }
button:disabled { cursor: not-allowed; opacity: 0.5; }
select:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid #9bd8ef; outline-offset: 2px; }
p { margin: 0.65rem 0 0; }
p.export-error { color: #ffb9b9; }
@media (max-width: 520px) { label:first-child, select { width: 100%; } }
</style>
