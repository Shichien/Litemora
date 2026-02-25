<script setup>
import { getGeometryForBlockType } from '@three/world/terrain/blocks-config.js'
import * as THREE from 'three'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelData: {
    type: Object,
    default: null,
  },
})

const containerRef = ref(null)

let renderer = null
let scene = null
let camera = null
let previewGroup = null
let animationFrameId = null
let resizeObserver = null
let originMarker = null
const orbitTarget = new THREE.Vector3(0, 0, 0)
const VOXEL_CENTER_OFFSET = 0.5

const orbitState = {
  yaw: 0.9,
  pitch: 0.5,
  distance: 40,
  dragging: false,
  dragMode: 'rotate',
  lastX: 0,
  lastY: 0,
}

const colorByBlockId = {
  1: '#7fbf3f',
  2: '#8b5a2b',
  3: '#7a7a7a',
  4: '#555555',
  5: '#b87747',
  6: '#6f4e37',
  7: '#4f9f55',
  8: '#e6d18a',
  9: '#d8d4c8',
  10: '#8bcf90',
  11: '#5f4632',
  12: '#f59fc8',
  13: '#3d8b3d',
  15: '#af7f63',
  16: '#d68a4f',
  17: '#7fc9ff',
  18: '#5ab0ea',
  19: '#f5f8ff',
  21: '#8f8f8f',
  22: '#d8d8d8',
  23: '#ececec',
  24: '#8f8f94',
  25: '#a3a3a8',
  26: '#3b3b44',
  27: '#464650',
  28: '#373740',
  29: '#d7b465',
  30: '#cfbf92',
}

const hasModel = computed(() => {
  return Boolean(props.modelData?.blocks?.length)
})

function getBlockColor(id) {
  return colorByBlockId[id] || '#9ca3af'
}

function hashStringToColorHex(input) {
  const text = String(input || '')
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  const hue = Math.abs(hash) % 360
  const saturation = 32 + (Math.abs(hash >> 3) % 28)
  const lightness = 44 + (Math.abs(hash >> 5) % 20)
  const color = new THREE.Color()
  color.setHSL(hue / 360, saturation / 100, lightness / 100)
  return `#${color.getHexString()}`
}

function disposeObject3D(object) {
  if (!object) {
    return
  }

  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose?.()
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(material => material.dispose?.())
      }
      else {
        child.material.dispose?.()
      }
    }
  })
}

function updateCameraPosition() {
  if (!camera) {
    return
  }

  const cosPitch = Math.cos(orbitState.pitch)
  camera.position.set(
    orbitTarget.x + Math.sin(orbitState.yaw) * cosPitch * orbitState.distance,
    orbitTarget.y + Math.sin(orbitState.pitch) * orbitState.distance,
    orbitTarget.z + Math.cos(orbitState.yaw) * cosPitch * orbitState.distance,
  )
  camera.lookAt(orbitTarget)
  camera.updateMatrixWorld()
}

function buildPreviewMesh() {
  if (!scene || !props.modelData) {
    return
  }

  if (previewGroup) {
    scene.remove(previewGroup)
    disposeObject3D(previewGroup)
    previewGroup = null
  }

  previewGroup = new THREE.Group()

  const blocks = props.modelData.blocks || []
  const bounds = props.modelData.bounds || {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  }
  if (blocks.length === 0) {
    scene.add(previewGroup)
    return
  }

  const centerX = (bounds.min.x + bounds.max.x) * 0.5
  const centerY = (bounds.min.y + bounds.max.y) * 0.5
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5

  const correctedCenterX = centerX + VOXEL_CENTER_OFFSET
  const correctedCenterY = centerY + VOXEL_CENTER_OFFSET
  const correctedCenterZ = centerZ + VOXEL_CENTER_OFFSET

  const sizeX = Math.max(1, bounds.max.x - bounds.min.x + 1)
  const sizeY = Math.max(1, bounds.max.y - bounds.min.y + 1)
  const sizeZ = Math.max(1, bounds.max.z - bounds.min.z + 1)
  const maxSize = Math.max(sizeX, sizeY, sizeZ)

  const groups = new Map()
  for (const block of blocks) {
    const colorKey = block.textureName || block.name || String(block.id)
    const geometryType = block.geometryType || 'cube'
    const key = `${geometryType}::${colorKey}`
    if (!groups.has(key)) {
      groups.set(key, {
        entries: [],
        color: colorByBlockId[block.id] || hashStringToColorHex(colorKey),
        geometryType,
      })
    }
    groups.get(key).entries.push(block)
  }

  const matrix = new THREE.Matrix4()
  groups.forEach((groupInfo) => {
    const color = groupInfo.color || getBlockColor(0)
    const baseGeometry = getGeometryForBlockType({ geometryType: groupInfo.geometryType }) || new THREE.BoxGeometry(1, 1, 1)
    const geometry = baseGeometry.clone()
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      metalness: 0.0,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, groupInfo.entries.length)

    groupInfo.entries.forEach((entry, index) => {
      matrix.makeTranslation(
        entry.x + VOXEL_CENTER_OFFSET - correctedCenterX,
        entry.y + VOXEL_CENTER_OFFSET - correctedCenterY,
        entry.z + VOXEL_CENTER_OFFSET - correctedCenterZ,
      )
      mesh.setMatrixAt(index, matrix)
    })

    mesh.instanceMatrix.needsUpdate = true
    previewGroup.add(mesh)
  })

  const previewBounds = new THREE.Box3().setFromObject(previewGroup)
  const previewCenter = new THREE.Vector3()
  const previewSize = new THREE.Vector3()
  previewBounds.getCenter(previewCenter)
  previewBounds.getSize(previewSize)

  const maxPreviewSize = Math.max(previewSize.x, previewSize.y, previewSize.z, maxSize)
  orbitState.distance = Math.max(24, Math.min(360, maxPreviewSize * 1.35))
  orbitState.yaw = 0.9
  orbitState.pitch = 0.5
  orbitTarget.copy(previewCenter)
  updateCameraPosition()

  scene.add(previewGroup)
}

function handlePointerDown(event) {
  if (event.button !== 0 && event.button !== 1) {
    return
  }

  event.preventDefault()

  orbitState.dragging = true
  orbitState.dragMode = event.button === 1 ? 'pan' : 'rotate'
  orbitState.lastX = event.clientX
  orbitState.lastY = event.clientY

  const canvas = renderer?.domElement
  canvas?.setPointerCapture?.(event.pointerId)
  canvas.style.cursor = orbitState.dragMode === 'pan' ? 'move' : 'grabbing'
}

function handlePointerMove(event) {
  if (!orbitState.dragging) {
    return
  }

  event.preventDefault()

  const dx = event.clientX - orbitState.lastX
  const dy = event.clientY - orbitState.lastY
  orbitState.lastX = event.clientX
  orbitState.lastY = event.clientY

  if (orbitState.dragMode === 'pan') {
    const panScale = Math.max(0.01, orbitState.distance * 0.0014)
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
    orbitTarget.addScaledVector(right, -dx * panScale)
    orbitTarget.addScaledVector(up, dy * panScale)
  }
  else {
    orbitState.yaw -= dx * 0.01
    orbitState.pitch -= dy * 0.01
    orbitState.pitch = Math.max(-1.2, Math.min(1.2, orbitState.pitch))
  }

  updateCameraPosition()
}

function handlePointerUp(event) {
  if (!orbitState.dragging) {
    return
  }

  event.preventDefault()
  orbitState.dragging = false

  const canvas = renderer?.domElement
  canvas?.releasePointerCapture?.(event.pointerId)
  canvas.style.cursor = 'grab'
}

function handleWheel(event) {
  event.preventDefault()

  orbitState.distance *= event.deltaY > 0 ? 1.1 : 0.92
  orbitState.distance = Math.max(8, Math.min(320, orbitState.distance))

  updateCameraPosition()
}

function handleContextMenu(event) {
  event.preventDefault()
}

function resize() {
  if (!containerRef.value || !renderer || !camera) {
    return
  }

  const width = Math.max(10, containerRef.value.clientWidth)
  const height = Math.max(10, containerRef.value.clientHeight)

  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}

function animate() {
  animationFrameId = requestAnimationFrame(animate)

  renderer?.render(scene, camera)
}

function initScene() {
  if (!containerRef.value || renderer) {
    return
  }

  scene = new THREE.Scene()
  scene.background = new THREE.Color('#111827')

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
  updateCameraPosition()

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  containerRef.value.appendChild(renderer.domElement)

  const ambient = new THREE.AmbientLight(0xFFFFFF, 0.72)
  scene.add(ambient)

  const keyLight = new THREE.DirectionalLight(0xFFFFFF, 0.8)
  keyLight.position.set(24, 40, 18)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0x8AB4FF, 0.32)
  fillLight.position.set(-18, 18, -16)
  scene.add(fillLight)

  const grid = new THREE.GridHelper(260, 26, 0x334155, 0x1F2937)
  grid.position.y = -0.55
  scene.add(grid)

  originMarker = new THREE.AxesHelper(6)
  originMarker.position.set(0, 0, 0)
  scene.add(originMarker)

  resize()
  animate()

  const canvas = renderer.domElement
  canvas.style.cursor = 'grab'
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerUp)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  canvas.addEventListener('contextmenu', handleContextMenu)

  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(containerRef.value)
}

function destroyScene() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  if (renderer?.domElement) {
    renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
    renderer.domElement.removeEventListener('pointermove', handlePointerMove)
    renderer.domElement.removeEventListener('pointerup', handlePointerUp)
    renderer.domElement.removeEventListener('pointercancel', handlePointerUp)
    renderer.domElement.removeEventListener('wheel', handleWheel)
    renderer.domElement.removeEventListener('contextmenu', handleContextMenu)
  }

  resizeObserver?.disconnect()
  resizeObserver = null

  if (previewGroup && scene) {
    scene.remove(previewGroup)
    disposeObject3D(previewGroup)
    previewGroup = null
  }

  if (originMarker && scene) {
    scene.remove(originMarker)
    originMarker = null
  }

  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
    renderer = null
  }

  scene = null
  camera = null
}

watch(() => props.modelData, () => {
  if (renderer) {
    buildPreviewMesh()
  }
}, { deep: true })

onMounted(() => {
  initScene()
  buildPreviewMesh()
})

onBeforeUnmount(() => {
  destroyScene()
})
</script>

<template>
  <div class="schematic-canvas-panel">
    <div class="schematic-canvas-toolbar">
      <span>模型预览</span>
      <span v-if="hasModel" class="hint">左键拖拽旋转 · 中键拖拽平移 · 滚轮缩放</span>
      <span v-else class="hint">暂无可预览方块</span>
    </div>
    <div ref="containerRef" class="schematic-canvas" />
  </div>
</template>

<style scoped>
.schematic-canvas-panel {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.75);
  width: 50%;
  min-width: 320px;
  margin: 0 auto;
}

.schematic-canvas-toolbar {
  height: 34px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
  color: #cbd5e1;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(30, 41, 59, 0.55);
}

.hint {
  color: #94a3b8;
}

.schematic-canvas {
  width: 100%;
  height: 320px;
}

@media (max-width: 980px) {
  .schematic-canvas-panel {
    width: 100%;
    min-width: 0;
  }
}
</style>
