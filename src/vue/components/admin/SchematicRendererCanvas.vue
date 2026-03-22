<script setup>
import {
  BUNDLED_MINECRAFT_RESOURCE_PACK_NAME,
  loadBundledMinecraftResourcePackBlob,
  loadPreferredMinecraftResourcePack,
} from '@three/world/terrain/minecraft-resource-pack.js'
import * as THREE from 'three'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

let schematicRendererModulePromise = null

const RENDERER_READY_TIMEOUT_MS = 20000
const SCHEMATIC_ID = 'litemora-preview'
const SCHEMATIC_RENDERER_CDN_URLS = [
  'https://esm.sh/schematic-renderer@1.1.23?bundle&target=es2022',
  'https://esm.sh/schematic-renderer@1.1.23?bundle',
]
const PREVIEW_NOISE_PATTERNS = [
  /^HoverHighlight (?:activated|deactivated)$/,
  /^Recording complete$/,
  /^FFmpeg not found/,
  /^Recording will not work$/,
  /^FFmpeg not found in options$/,
  /^AssetLoader disposed$/,
  /^Cubane: All caches cleared$/,
  /^\[ResourcePackManager\] Database initialized$/,
  /^\[ResourcePackManager\] State saved$/,
  /^🔧 Starting atlas building with /,
  /^📊 IndexedDB cache hit:/,
  /^✅ Loaded atlas from cache$/,
  /^🎯 Atlas loaded from cache with /,
  /^📊 Loaded \d+ textures from cache$/,
]
const PREVIEW_NOOP_FFMPEG = Object.freeze({
  on() {},
  off() {},
  exec: async () => {},
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  deleteFile: async () => {},
  terminate() {},
})

let previewConsoleFilterDepth = 0
let previewConsoleOriginalMethods = null

const props = defineProps({
  schematic: {
    type: Object,
    default: null,
  },
  previewMetadata: {
    type: Object,
    default: null,
  },
  sourceFile: {
    type: [Object, File, Blob],
    default: null,
  },
  previewOffset: {
    type: Object,
    default: () => ({ x: 0, y: 0, z: 0 }),
  },
  emptyLabel: {
    type: String,
    default: '暂无可渲染的投影文件',
  },
  displayName: {
    type: String,
    default: '',
  },
  resourcePackSignature: {
    type: String,
    default: '',
  },
})
const emit = defineEmits(['block-picked'])

const canvasRef = ref(null)
const isPreparing = ref(false)
const errorMessage = ref('')
const diagnostics = ref(null)
const preparingTitle = ref('正在准备真实渲染')
const preparingCopy = ref('Litemora 正在加载 schematic-renderer。')
const progressTrail = ref([])

let renderToken = 0
let rendererInstance = null
let rendererReadyPromise = null
let rendererReadyResolve = null
let rendererReadyReject = null
let resourcePackReadyPromise = null
let loadedResourcePackSignature = ''
let stopCanvasResize = null
let stopCanvasWheelPassthrough = null
let canvasBlockPickListener = null
let selectedBlockLocalPosition = null
let selectedBlockHighlightMesh = null

function shouldSuppressPreviewConsole(args = []) {
  const [first] = args
  if (typeof first !== 'string') {
    return false
  }

  return PREVIEW_NOISE_PATTERNS.some(pattern => pattern.test(first))
}

function installPreviewConsoleFilter() {
  if (previewConsoleFilterDepth > 0) {
    previewConsoleFilterDepth++
    return
  }

  previewConsoleFilterDepth = 1
  previewConsoleOriginalMethods = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }

  for (const methodName of Object.keys(previewConsoleOriginalMethods)) {
    const original = previewConsoleOriginalMethods[methodName]
    console[methodName] = (...args) => {
      if (shouldSuppressPreviewConsole(args)) {
        return
      }

      return original.apply(console, args)
    }
  }
}

function uninstallPreviewConsoleFilter() {
  if (previewConsoleFilterDepth <= 0) {
    return
  }

  previewConsoleFilterDepth--
  if (previewConsoleFilterDepth > 0 || !previewConsoleOriginalMethods) {
    return
  }

  Object.assign(console, previewConsoleOriginalMethods)
  previewConsoleOriginalMethods = null
}

function getRendererCamera(renderer) {
  return renderer?.cameraManager?.activeCamera?.camera || null
}

function syncRendererViewport(renderer, width, height) {
  const renderManager = renderer?.renderManager
  const camera = getRendererCamera(renderer)
  if (!renderManager || !camera || width <= 0 || height <= 0) {
    return
  }

  renderManager.resize?.(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix?.()
  renderManager.requestRender?.()
}

function patchRendererRuntime(renderer) {
  const renderManager = renderer?.renderManager
  if (renderManager && !renderManager.__litemoraSafeResizePatched) {
    const originalResize = renderManager.resize?.bind(renderManager)
    renderManager.resize = (width, height) => {
      const camera = getRendererCamera(renderer)
      if (!camera || renderManager.disposed || renderManager.contextLost) {
        return
      }

      originalResize?.(width, height)
    }

    renderManager.updateCanvasSize = () => {
      const canvas = renderer?.canvas
      const parent = canvas?.parentElement
      const camera = getRendererCamera(renderer)
      if (!canvas || !parent || !camera || renderManager.disposed || renderManager.contextLost) {
        return
      }

      const width = Number(parent.clientWidth || 0)
      const height = Number(parent.clientHeight || 0)
      if (!width || !height) {
        return
      }

      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      syncRendererViewport(renderer, width, height)
    }

    renderManager.__litemoraSafeResizePatched = true
  }

  const recordingManager = renderer?.cameraManager?.recordingManager
  if (recordingManager && !recordingManager.__litemoraSilentDisposePatched) {
    const originalDispose = recordingManager.dispose?.bind(recordingManager)
    recordingManager.dispose = () => {
      if (recordingManager.isRecording) {
        return originalDispose?.()
      }

      recordingManager.cleanup?.()
      recordingManager.ffmpeg?.terminate?.()
    }
    recordingManager.__litemoraSilentDisposePatched = true
  }
}

const hasRenderableSource = computed(() => {
  return Boolean(props.sourceFile || props.schematic)
})
const resolvedDisplayName = computed(() => {
  return String(props.displayName || '').trim()
})

function appendHandshakeStep(label, details = '') {
  progressTrail.value = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      details,
    },
    ...progressTrail.value,
  ].slice(0, 8)
}

function setPreparingState(title, copy, logLabel = '', logDetails = '') {
  preparingTitle.value = title
  preparingCopy.value = copy

  if (logLabel) {
    appendHandshakeStep(logLabel, logDetails || copy)
  }
}

function decodeBase64ToArrayBuffer(base64Text) {
  const binary = atob(String(base64Text || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function getPreviewOffsetArray() {
  return [
    Number(props.previewOffset?.x || 0),
    Number(props.previewOffset?.y || 0),
    Number(props.previewOffset?.z || 0),
  ]
}

function getPreviewOffsetObject() {
  return {
    x: Number(props.previewOffset?.x || 0),
    y: Number(props.previewOffset?.y || 0),
    z: Number(props.previewOffset?.z || 0),
  }
}

function countSolidBlocksInRegion(region) {
  if (typeof region?._solidBlockCount === 'number' && region._solidBlockCount >= 0) {
    return region._solidBlockCount
  }

  const palette = Array.isArray(region?.palette) ? region.palette : []
  const blockData = Array.isArray(region?._decodedIndices)
    ? region._decodedIndices
    : ArrayBuffer.isView(region?._decodedIndices)
      ? region._decodedIndices
      : null

  if (!blockData?.length) {
    return null
  }

  let solidCount = 0
  for (const paletteIndex of blockData) {
    const blockName = palette[paletteIndex]?.name || 'minecraft:air'
    if (blockName !== 'minecraft:air' && blockName !== 'minecraft:cave_air' && blockName !== 'minecraft:void_air') {
      solidCount++
    }
  }
  return solidCount
}

function resolveBlockCount(loadedSchematic = null) {
  const explicitBlockCount = Number(props.previewMetadata?.blockCount ?? props.schematic?.blockCount)
  if (Number.isFinite(explicitBlockCount) && explicitBlockCount >= 0) {
    return explicitBlockCount
  }

  const runtimeRegions = Object.values(props.schematic?.regions || {})
  if (runtimeRegions.length) {
    const counted = runtimeRegions
      .map(region => countSolidBlocksInRegion(region))
      .filter(count => Number.isFinite(count))
    if (counted.length) {
      return counted.reduce((sum, count) => sum + count, 0)
    }
  }

  const loadedRegions = Object.values(loadedSchematic?.regions || {})
  if (loadedRegions.length) {
    const counted = loadedRegions
      .map(region => countSolidBlocksInRegion(region))
      .filter(count => Number.isFinite(count))
    if (counted.length) {
      return counted.reduce((sum, count) => sum + count, 0)
    }
  }

  return null
}

function toLocalBlockPosition(worldPosition) {
  const offset = getPreviewOffsetObject()
  return {
    x: Math.round(Number(worldPosition?.x || 0) - offset.x),
    y: Math.round(Number(worldPosition?.y || 0) - offset.y),
    z: Math.round(Number(worldPosition?.z || 0) - offset.z),
  }
}

function toWorldBlockPosition(localPosition) {
  if (!localPosition) {
    return null
  }

  const offset = getPreviewOffsetObject()
  return {
    x: Math.round(Number(localPosition.x || 0) + offset.x),
    y: Math.round(Number(localPosition.y || 0) + offset.y),
    z: Math.round(Number(localPosition.z || 0) + offset.z),
  }
}

function pickBlockFromCanvasEvent(event) {
  if (!rendererInstance?.schematicManager || !rendererInstance?.cameraManager?.activeCamera?.camera || !canvasRef.value) {
    return null
  }

  const selectableObjects = rendererInstance.schematicManager.getSelectableObjects?.()
  if (!Array.isArray(selectableObjects) || !selectableObjects.length) {
    return null
  }

  const camera = rendererInstance.cameraManager.activeCamera.camera
  const rect = canvasRef.value.getBoundingClientRect()
  if (!rect.width || !rect.height) {
    return null
  }

  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, camera)

  const visibleObjects = selectableObjects.filter(object => rendererInstance.sceneManager?.scene?.getObjectById(object?.id))
  const intersections = raycaster.intersectObjects(visibleObjects, true)
  const hit = intersections.find(intersection => !intersection.object?.userData?.isHighlight)
  if (!hit?.point) {
    return null
  }

  const blockPoint = hit.point.clone()
  if (hit.face?.normal) {
    blockPoint.addScaledVector(
      hit.face.normal.clone().transformDirection(hit.object.matrixWorld),
      -0.01,
    )
  }
  blockPoint.floor()

  return {
    x: Number(blockPoint.x),
    y: Number(blockPoint.y),
    z: Number(blockPoint.z),
  }
}

function updateDiagnostics(loadedSchematic = null, sourceName = '') {
  const sizeFromSchematic = loadedSchematic?.getTightDimensions?.()
    || loadedSchematic?.getDimensions?.()
    || null

  const fallbackSize = props.previewMetadata?.size
    ? [
        Number(props.previewMetadata.size.x || 0),
        Number(props.previewMetadata.size.y || 0),
        Number(props.previewMetadata.size.z || 0),
      ]
    : props.schematic?.size
    ? [
        Number(props.schematic.size.x || 0),
        Number(props.schematic.size.y || 0),
        Number(props.schematic.size.z || 0),
      ]
    : null

  const resolvedSize = sizeFromSchematic || fallbackSize

  diagnostics.value = {
    name: resolvedDisplayName.value || props.schematic?.name || loadedSchematic?.name || sourceName || 'Unknown',
    author: props.previewMetadata?.author || props.schematic?.author || '',
    blockCount: resolveBlockCount(loadedSchematic),
    sourceName,
    size: resolvedSize
      ? {
          x: Number(resolvedSize[0] || 0),
          y: Number(resolvedSize[1] || 0),
          z: Number(resolvedSize[2] || 0),
        }
      : null,
    offset: {
      x: Number(props.previewOffset?.x || 0),
      y: Number(props.previewOffset?.y || 0),
      z: Number(props.previewOffset?.z || 0),
    },
  }
}

function clearCanvasResize() {
  stopCanvasResize?.()
  stopCanvasResize = null
}

function clearCanvasWheelPassthrough() {
  stopCanvasWheelPassthrough?.()
  stopCanvasWheelPassthrough = null
}

function setupCanvasWheelPassthrough() {
  clearCanvasWheelPassthrough()

  const canvas = canvasRef.value
  if (!canvas) {
    return
  }

  const handleWheel = (event) => {
    event.stopImmediatePropagation()
  }

  canvas.addEventListener('wheel', handleWheel, {
    passive: true,
    capture: true,
  })

  stopCanvasWheelPassthrough = () => {
    canvas.removeEventListener('wheel', handleWheel, true)
  }
}

function setupCanvasResize(renderer) {
  clearCanvasResize()

  const syncCanvasSize = () => {
    const canvas = canvasRef.value
    if (!canvas || !canvas.isConnected || !renderer?.renderManager || renderer !== rendererInstance) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) {
      return
    }

    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * pixelRatio))
    canvas.height = Math.max(1, Math.round(rect.height * pixelRatio))
    syncRendererViewport(renderer, rect.width, rect.height)
  }

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => syncCanvasSize())
    : null

  observer?.observe(canvasRef.value)
  window.addEventListener('resize', syncCanvasSize)
  syncCanvasSize()

  stopCanvasResize = () => {
    observer?.disconnect()
    window.removeEventListener('resize', syncCanvasSize)
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function loadRendererModule() {
  if (!schematicRendererModulePromise) {
    if (import.meta.env.DEV) {
      schematicRendererModulePromise = import('schematic-renderer')
    }
    else {
      schematicRendererModulePromise = (async () => {
        let lastError = null

        for (const url of SCHEMATIC_RENDERER_CDN_URLS) {
          try {
            return await import(/* @vite-ignore */ url)
          }
          catch (error) {
            lastError = error
          }
        }

        const reason = lastError?.message || 'unknown_cdn_import_error'
        throw new Error(`schematic-renderer CDN 加载失败: ${reason}`)
      })()
    }
  }
  return schematicRendererModulePromise
}

async function ensureRenderer() {
  if (rendererReadyPromise) {
    return withTimeout(
      rendererReadyPromise,
      RENDERER_READY_TIMEOUT_MS,
      'schematic-renderer 初始化超时',
    )
  }

  setPreparingState(
    '正在加载真实渲染内核',
    '首次打开会懒加载 schematic-renderer 与它的 WASM mesh builder。',
    '开始加载渲染内核',
  )

  rendererReadyPromise = new Promise((resolve, reject) => {
    rendererReadyResolve = resolve
    rendererReadyReject = reject
  })

  try {
    const { SchematicRenderer } = await loadRendererModule()
    await nextTick()

    if (!canvasRef.value) {
      throw new Error('render_canvas_unavailable')
    }

    setupCanvasWheelPassthrough()

    rendererInstance = new SchematicRenderer(canvasRef.value, {}, {
      [BUNDLED_MINECRAFT_RESOURCE_PACK_NAME]: async () => loadBundledMinecraftResourcePackBlob(),
    }, {
      backgroundColor: 0x081219,
      showGrid: false,
      showAxes: false,
      enableDragAndDrop: false,
      enableGizmos: false,
      enableProgressBar: false,
      enableAdaptiveFPS: true,
      enableInteraction: false,
      meshBuildingMode: 'batched',
      singleSchematicMode: true,
      ffmpeg: PREVIEW_NOOP_FFMPEG,
      wasmMeshBuilderOptions: {
        enabled: true,
        greedyMeshingEnabled: false,
      },
      postProcessingOptions: {
        enabled: true,
        enableSSAO: true,
        enableSMAA: true,
        enableGamma: true,
      },
      sidebarOptions: {
        enabled: false,
      },
      callbacks: {
        onRendererInitialized: (renderer) => {
          appendHandshakeStep('渲染内核已初始化', 'schematic-renderer 已完成启动。')
          rendererReadyResolve?.(renderer)
          rendererReadyResolve = null
          rendererReadyReject = null
        },
        onSchematicLoaded: (schematicName) => {
          appendHandshakeStep('投影已解析', schematicName)
        },
        onSchematicRendered: (schematicName) => {
          appendHandshakeStep('真实网格已生成', schematicName)
        },
        onResourcePackLoaded: (packName) => {
          appendHandshakeStep('资源包已激活', packName)
        },
      },
    })

    patchRendererRuntime(rendererInstance)
    setupPreviewBlockPicking(rendererInstance)
    updateSelectedBlockHighlight()
    setupCanvasResize(rendererInstance)
  }
  catch (error) {
    clearCanvasResize()
    rendererInstance = null
    rendererReadyReject?.(error)
    rendererReadyResolve = null
    rendererReadyReject = null
    rendererReadyPromise = null
    throw error
  }

  return withTimeout(
    rendererReadyPromise,
    RENDERER_READY_TIMEOUT_MS,
    'schematic-renderer 初始化超时',
  )
}

async function ensurePreferredResourcePack(renderer) {
  if (!renderer?.packs) {
    throw new Error('resource_pack_manager_unavailable')
  }

  if (resourcePackReadyPromise) {
    return resourcePackReadyPromise
  }

  resourcePackReadyPromise = (async () => {
    const selectedPack = await loadPreferredMinecraftResourcePack()
    const nextSignature = [
      selectedPack.source,
      selectedPack.key,
      selectedPack.updatedAt,
      selectedPack.size,
      props.resourcePackSignature,
    ].join(':')

    if (loadedResourcePackSignature === nextSignature) {
      return nextSignature
    }

    if (renderer.packs.getPackCount?.() > 0) {
      await renderer.packs.removeAllPacks()
    }

    try {
      await renderer.packs.loadPackFromBlob(selectedPack.blob, selectedPack.name)
      loadedResourcePackSignature = nextSignature
      return nextSignature
    }
    catch (error) {
      if (selectedPack.source === 'custom') {
        const fallbackBlob = await loadBundledMinecraftResourcePackBlob()
        await renderer.packs.removeAllPacks?.()
        await renderer.packs.loadPackFromBlob(fallbackBlob, BUNDLED_MINECRAFT_RESOURCE_PACK_NAME)
        loadedResourcePackSignature = ['built-in-fallback', BUNDLED_MINECRAFT_RESOURCE_PACK_NAME, props.resourcePackSignature].join(':')
        return loadedResourcePackSignature
      }
      throw error
    }
  })().catch((error) => {
    resourcePackReadyPromise = null
    throw error
  })

  return resourcePackReadyPromise
}

async function resolveSourcePayload() {
  const source = props.sourceFile

  if (source instanceof Blob) {
    return {
      buffer: await source.arrayBuffer(),
      name: source.name || props.schematic?.name || 'uploaded.schematic',
    }
  }

  if (source?.buffer instanceof ArrayBuffer) {
    return {
      buffer: source.buffer,
      name: source.fileName || source.name || props.schematic?.name || 'uploaded.schematic',
    }
  }

  if (source?.fileBase64) {
    return {
      buffer: decodeBase64ToArrayBuffer(source.fileBase64),
      name: source.fileName || source.name || props.schematic?.name || 'uploaded.schematic',
    }
  }

  if (source?.base64) {
    return {
      buffer: decodeBase64ToArrayBuffer(source.base64),
      name: source.fileName || source.name || props.schematic?.name || 'uploaded.schematic',
    }
  }

  return null
}

function applyPreviewOffset() {
  const loadedSchematic = rendererInstance?.schematicManager?.getSchematic?.(SCHEMATIC_ID)
  if (!loadedSchematic) {
    return
  }

  loadedSchematic.setPosition?.(getPreviewOffsetArray())
  updateSelectedBlockHighlight()
  rendererInstance?.renderManager?.requestRender?.()
  updateDiagnostics(loadedSchematic, diagnostics.value?.sourceName || '')
}

function removeSelectedBlockHighlight() {
  if (selectedBlockHighlightMesh && rendererInstance?.sceneManager?.scene) {
    rendererInstance.sceneManager.scene.remove(selectedBlockHighlightMesh)
  }

  selectedBlockHighlightMesh?.geometry?.dispose?.()
  selectedBlockHighlightMesh?.material?.dispose?.()
  selectedBlockHighlightMesh = null
}

function updateSelectedBlockHighlight() {
  removeSelectedBlockHighlight()

  if (!rendererInstance?.sceneManager?.scene || !selectedBlockLocalPosition) {
    return
  }

  const worldPosition = toWorldBlockPosition(selectedBlockLocalPosition)
  if (!worldPosition) {
    return
  }

  const geometry = new THREE.BoxGeometry(1.1, 1.1, 1.1)
  const material = new THREE.MeshBasicMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  })

  selectedBlockHighlightMesh = new THREE.Mesh(geometry, material)
  selectedBlockHighlightMesh.position.set(
    worldPosition.x + 0.5,
    worldPosition.y + 0.5,
    worldPosition.z + 0.5,
  )
  selectedBlockHighlightMesh.userData.isHighlight = true
  rendererInstance.sceneManager.scene.add(selectedBlockHighlightMesh)
  rendererInstance.renderManager?.requestRender?.()
}

function clearPreviewBlockPicking() {
  if (canvasRef.value && canvasBlockPickListener) {
    canvasRef.value.removeEventListener('dblclick', canvasBlockPickListener)
  }

  canvasBlockPickListener = null
  removeSelectedBlockHighlight()
}

function setupPreviewBlockPicking(renderer) {
  clearPreviewBlockPicking()

  if (!renderer || !canvasRef.value) {
    return
  }

  canvasBlockPickListener = (event) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const pickedBlock = pickBlockFromCanvasEvent(event)
    if (!pickedBlock) {
      return
    }

    selectedBlockLocalPosition = toLocalBlockPosition(pickedBlock)
    updateSelectedBlockHighlight()

    const worldPosition = toWorldBlockPosition(selectedBlockLocalPosition)
    emit('block-picked', {
      ...worldPosition,
      previewOffset: getPreviewOffsetObject(),
    })
  }

  canvasRef.value.addEventListener('dblclick', canvasBlockPickListener)
}

async function capturePreviewThumbnail(options = {}) {
  const sourceCanvas = canvasRef.value
  if (!sourceCanvas) {
    return ''
  }

  const targetWidth = Math.max(1, Math.round(Number(options.width || 640)))
  const targetHeight = Math.max(1, Math.round(Number(options.height || 360)))
  const quality = Math.min(0.95, Math.max(0.5, Number(options.quality || 0.82)))

  rendererInstance?.renderManager?.requestRender?.()
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  const sourceWidth = Number(sourceCanvas.width || sourceCanvas.clientWidth || 0)
  const sourceHeight = Number(sourceCanvas.height || sourceCanvas.clientHeight || 0)
  if (!sourceWidth || !sourceHeight) {
    return ''
  }

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = targetWidth
  exportCanvas.height = targetHeight
  const context = exportCanvas.getContext('2d')
  if (!context) {
    return ''
  }

  context.fillStyle = '#081219'
  context.fillRect(0, 0, targetWidth, targetHeight)

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  const offsetX = (targetWidth - drawWidth) * 0.5
  const offsetY = (targetHeight - drawHeight) * 0.5

  context.drawImage(sourceCanvas, 0, 0, sourceWidth, sourceHeight, offsetX, offsetY, drawWidth, drawHeight)
  return exportCanvas.toDataURL('image/jpeg', quality)
}

defineExpose({
  capturePreviewThumbnail,
})

async function renderCurrentSchematic() {
  const token = ++renderToken
  errorMessage.value = ''
  diagnostics.value = null
  progressTrail.value = []

  if (!hasRenderableSource.value) {
    isPreparing.value = false
    return
  }

  isPreparing.value = true
  setPreparingState(
    '正在准备真实渲染',
    'Litemora 正在整理 schematic-renderer 所需的原始投影文件。',
    '开始准备真实渲染',
  )

  try {
    const sourcePayload = await resolveSourcePayload()
    if (token !== renderToken) {
      return
    }

    if (!sourcePayload) {
      throw new Error('真实渲染需要原始投影文件，请重新上传或重新打开带源文件的作品。')
    }

    setPreparingState(
      '正在启动渲染器',
      `${sourcePayload.name} 已就绪，正在初始化 schematic-renderer。`,
      '原始投影已就绪',
      `${(sourcePayload.buffer.byteLength / 1024).toFixed(1)} KiB`,
    )

    const renderer = await ensureRenderer()
    if (token !== renderToken) {
      return
    }

    setPreparingState(
      '正在装载 Minecraft 资源包',
      '预览会优先使用当前空间或投影的自定义资源包。',
      '开始加载资源包',
    )
    await ensurePreferredResourcePack(renderer)

    if (token !== renderToken) {
      return
    }

    setPreparingState(
      '正在清理旧场景',
      '旧的投影实例会先被移除，避免画面叠加。',
      '渲染器已就绪',
    )
    await renderer.schematicManager?.removeAllSchematics?.()

    if (token !== renderToken) {
      return
    }

    setPreparingState(
      '正在导入投影文件',
      'schematic-renderer 正在解析投影文件并构建真实方块网格。',
      '开始导入投影',
      sourcePayload.name,
    )

    await renderer.schematicManager?.loadSchematic(
      SCHEMATIC_ID,
      sourcePayload.buffer,
      {
        position: getPreviewOffsetArray(),
        focused: true,
      },
      {
        onProgress: (progress) => {
          if (token !== renderToken) {
            return
          }

          const stageLabels = {
            file_reading: '正在读取投影文件',
            parsing: '正在解析投影结构',
            mesh_building: '正在构建真实方块网格',
            scene_setup: '正在装配渲染场景',
          }

          const stageLabel = stageLabels[progress?.stage] || '真实渲染处理中'
          const percent = Math.round((Number(progress?.progress || 0)) * 100)

          setPreparingState(
            stageLabel,
            progress?.message || 'schematic-renderer 正在处理当前投影。',
            '导入进度',
            `${progress?.stage || 'unknown'} ${percent}%`,
          )
        },
      },
    )

    if (token !== renderToken) {
      return
    }

    const loadedSchematic = renderer.schematicManager?.getSchematic?.(SCHEMATIC_ID)
    loadedSchematic?.setPosition?.(getPreviewOffsetArray())
    renderer.cameraManager?.switchCameraPreset?.('isometric')
    renderer.cameraManager?.focusOnSchematics?.()
    renderer.renderManager?.requestRender?.()

    updateDiagnostics(loadedSchematic, sourcePayload.name)
    appendHandshakeStep('真实渲染完成', '当前画面已经由 schematic-renderer 接管。')
    isPreparing.value = false
  }
  catch (error) {
    errorMessage.value = error?.message || 'schematic-renderer 渲染失败'
    appendHandshakeStep('真实渲染失败', errorMessage.value)
    isPreparing.value = false
  }
}

function disposeRenderer() {
  clearCanvasResize()
  clearCanvasWheelPassthrough()
  clearPreviewBlockPicking()

  if (rendererInstance) {
    try {
      rendererInstance.dispose()
    }
    catch {
      // ignore dispose failures during teardown
    }
  }

  rendererInstance = null
  rendererReadyPromise = null
  rendererReadyResolve = null
  rendererReadyReject = null
  resourcePackReadyPromise = null
  loadedResourcePackSignature = ''
}

watch(
  () => [props.sourceFile, props.schematic],
  () => {
    void renderCurrentSchematic()
  },
)

watch(
  () => [
    Number(props.previewOffset?.x || 0),
    Number(props.previewOffset?.y || 0),
    Number(props.previewOffset?.z || 0),
  ],
  () => {
    applyPreviewOffset()
  },
)

watch(
  () => props.resourcePackSignature,
  () => {
    resourcePackReadyPromise = null
    loadedResourcePackSignature = ''
    void renderCurrentSchematic()
  },
)

watch(
  () => resolvedDisplayName.value,
  (name) => {
    if (!diagnostics.value) {
      return
    }
    diagnostics.value = {
      ...diagnostics.value,
      name: name || diagnostics.value.name,
    }
  },
)

onMounted(() => {
  installPreviewConsoleFilter()
  void renderCurrentSchematic()
})

onBeforeUnmount(() => {
  renderToken++
  disposeRenderer()
  uninstallPreviewConsoleFilter()
})
</script>

<template>
  <div class="renderer-shell">
    <canvas ref="canvasRef" class="renderer-frame" />

    <div v-if="!hasRenderableSource" class="renderer-overlay is-empty">
      <strong>{{ emptyLabel }}</strong>
    </div>

    <div v-else-if="isPreparing" class="renderer-overlay">
      <strong>{{ preparingTitle }}</strong>
      <span>{{ preparingCopy }}</span>

      <div v-if="progressTrail.length" class="renderer-debug">
        <div
          v-for="entry in progressTrail"
          :key="entry.id"
          class="debug-row"
        >
          <strong>{{ entry.label }}</strong>
          <span>{{ entry.details }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="errorMessage" class="renderer-overlay is-error">
      <strong>真实渲染暂时失败</strong>
      <span>{{ errorMessage }}</span>

      <div v-if="progressTrail.length" class="renderer-debug">
        <div
          v-for="entry in progressTrail"
          :key="entry.id"
          class="debug-row"
        >
          <strong>{{ entry.label }}</strong>
          <span>{{ entry.details }}</span>
        </div>
      </div>
    </div>

    <div v-if="diagnostics && !isPreparing && !errorMessage" class="renderer-hud">
      <span v-if="diagnostics.name" class="hud-chip">{{ diagnostics.name }}</span>
      <span v-if="diagnostics.size" class="hud-chip">
        {{ diagnostics.size.x }}x{{ diagnostics.size.y }}x{{ diagnostics.size.z }}
      </span>
      <span v-if="diagnostics.blockCount !== null" class="hud-chip">{{ diagnostics.blockCount }} 方块</span>
    </div>
  </div>
</template>

<style scoped>
.renderer-shell {
  position: relative;
  min-height: 380px;
  width: min(100%, 960px);
  margin: 0 auto;
  border-radius: 22px;
  overflow: hidden;
  background:
    radial-gradient(circle at top, rgba(132, 195, 255, 0.18), transparent 42%),
    linear-gradient(180deg, #081219 0%, #0d1720 100%);
}

.renderer-frame {
  display: block;
  width: 100%;
  min-height: 380px;
  border: 0;
  background: transparent;
  touch-action: pan-y;
}

.renderer-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem;
  text-align: center;
  color: #eef6fb;
  background: rgba(5, 10, 14, 0.54);
  backdrop-filter: blur(10px);
}

.renderer-overlay strong {
  font-size: 1.05rem;
  font-weight: 700;
}

.renderer-overlay span {
  max-width: 36rem;
  color: rgba(230, 241, 246, 0.88);
  line-height: 1.6;
}

.renderer-overlay.is-error {
  background: rgba(46, 12, 16, 0.72);
}

.renderer-overlay.is-empty {
  background: rgba(5, 10, 14, 0.38);
}

.renderer-debug {
  width: min(44rem, 100%);
  margin-top: 0.75rem;
  padding: 0.9rem 1rem;
  border-radius: 16px;
  background: rgba(8, 18, 25, 0.68);
  border: 1px solid rgba(146, 202, 235, 0.18);
  text-align: left;
}

.debug-row + .debug-row {
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px solid rgba(146, 202, 235, 0.12);
}

.debug-row strong,
.debug-row span {
  display: block;
  max-width: none;
}

.debug-row strong {
  font-size: 0.92rem;
  color: #eef6fb;
}

.debug-row span {
  margin-top: 0.15rem;
  font-size: 0.84rem;
  color: rgba(214, 229, 237, 0.82);
}

.renderer-hud {
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  pointer-events: none;
}

.hud-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  background: rgba(8, 18, 25, 0.74);
  border: 1px solid rgba(146, 202, 235, 0.22);
  color: #e6f1f6;
  font-size: 0.83rem;
  line-height: 1.2;
}

@media (max-width: 720px) {
  .renderer-shell,
  .renderer-frame {
    min-height: 320px;
  }

  .renderer-hud {
    left: 0.75rem;
    right: 0.75rem;
    bottom: 0.75rem;
  }

  .renderer-debug {
    width: 100%;
  }
}
</style>
