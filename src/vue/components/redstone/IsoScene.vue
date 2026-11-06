<script setup>
// Isometric voxel scene drawn with CSS 3D (orthographic) and real pack textures.
//
// blocks: [{ x, y, z, ...spec }] in block units, y up. Spec fields:
//   tex            texture basename for every face (e.g. 'deepslate_bricks')
//   top / side     per-face overrides
//   kind           'cube' (default) | 'plate' (flat quad on the floor of the cell: dust, repeater)
//                  | 'sprite' (two crossed quads: torch, flower)
//   tint           multiply colour for grayscale textures (dust, grass top, leaves)
//   rot            plate rotation in degrees (0/90/180/270)
//   glow           always emits (redstone block, lit torch)
//   power          reacts to the scene's `powered` prop; then texOn/topOn/sideOn/tintOn are used
//   glass          translucent cube, does not hide neighbour faces
import { computed } from 'vue'
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'

const props = defineProps({
  blocks: { type: Array, required: true },
  // Edge length of one block in px.
  unit: { type: Number, default: 32 },
  // Camera pitch (negative looks down) and yaw, in degrees.
  pitch: { type: Number, default: -30 },
  yaw: { type: Number, default: 45 },
  powered: { type: Boolean, default: false },
  // Slow turntable rotation.
  spin: { type: Boolean, default: false },
  spinSeconds: { type: Number, default: 40 },
})

const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const SHADE = { top: 0, south: 0.22, north: 0.22, east: 0.38, west: 0.38 }
const FACES = [
  { name: 'top', normal: [0, 1, 0], transform: 'rotateX(90deg)' },
  { name: 'south', normal: [0, 0, 1], transform: '' },
  { name: 'north', normal: [0, 0, -1], transform: 'rotateY(180deg)' },
  { name: 'east', normal: [1, 0, 0], transform: 'rotateY(90deg)' },
  { name: 'west', normal: [-1, 0, 0], transform: 'rotateY(-90deg)' },
]

const texUrlCache = new Map()
function texUrl(name) {
  if (!name) {
    return ''
  }
  if (!texUrlCache.has(name)) {
    texUrlCache.set(name, `url("${resolvePublicAssetUrl(`${BLOCK_DIR}${name}.png`)}")`)
  }
  return texUrlCache.get(name)
}

const toRad = deg => (deg * Math.PI) / 180

// Screen projection of a CSS-space point (y down) under rotateX(pitch) rotateY(yaw).
function project(px, py, pz, pitch, yaw) {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const x1 = px * cy + pz * sy
  const z1 = -px * sy + pz * cy
  return { x: x1, y: py * cp - z1 * sp }
}

const occupancy = computed(() => {
  const set = new Set()
  for (const b of props.blocks) {
    if ((b.kind || 'cube') === 'cube' && !b.glass) {
      set.add(`${b.x},${b.y},${b.z}`)
    }
  }
  return set
})

// Faces that can face the camera at the current yaw (all of them while spinning).
const cameraFaces = computed(() => {
  if (props.spin) {
    return new Set(FACES.map(f => f.name))
  }
  const yaw = toRad(props.yaw)
  const pitch = toRad(props.pitch)
  const visible = new Set()
  for (const face of FACES) {
    const [nx, ny, nz] = face.normal
    // CSS space has y down.
    const z1 = -nx * Math.sin(yaw) + nz * Math.cos(yaw)
    const z2 = -ny * Math.sin(pitch) + z1 * Math.cos(pitch)
    if (z2 > 1e-3) {
      visible.add(face.name)
    }
  }
  return visible
})

const layout = computed(() => {
  const u = props.unit
  const blocks = props.blocks
  if (!blocks.length) {
    return { width: 0, height: 0, cx: 0, cy: 0, cz: 0, offsetX: 0, offsetY: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const b of blocks) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    minZ = Math.min(minZ, b.z)
    maxX = Math.max(maxX, b.x + 1)
    maxY = Math.max(maxY, b.y + 1)
    maxZ = Math.max(maxZ, b.z + 1)
  }
  // Rotation centre in CSS space (y down).
  const cx = ((minX + maxX) / 2) * u
  const cy = (-(minY + maxY) / 2) * u
  const cz = ((minZ + maxZ) / 2) * u

  const pitch = toRad(props.pitch)
  const yaws = props.spin
    ? Array.from({ length: 24 }, (_, i) => toRad(props.yaw + i * 15))
    : [toRad(props.yaw)]
  let sMinX = Infinity
  let sMinY = Infinity
  let sMaxX = -Infinity
  let sMaxY = -Infinity
  for (const yaw of yaws) {
    for (const x of [minX, maxX]) {
      for (const y of [minY, maxY]) {
        for (const z of [minZ, maxZ]) {
          const p = project(x * u - cx, -y * u - cy, z * u - cz, pitch, yaw)
          sMinX = Math.min(sMinX, p.x)
          sMaxX = Math.max(sMaxX, p.x)
          sMinY = Math.min(sMinY, p.y)
          sMaxY = Math.max(sMaxY, p.y)
        }
      }
    }
  }

  return {
    width: Math.ceil(sMaxX - sMinX),
    height: Math.ceil(sMaxY - sMinY),
    cx,
    cy,
    cz,
    // Shift so the projected bounding box is centred in the element.
    offsetX: -(sMinX + sMaxX) / 2,
    offsetY: -(sMinY + sMaxY) / 2,
  }
})

function faceBackground(b, faceName, lit) {
  const pick = (onKey, key) => (lit && b[onKey]) || b[key]
  const tex = faceName === 'top'
    ? (pick('topOn', 'top') || pick('texOn', 'tex'))
    : (pick('sideOn', 'side') || pick('texOn', 'tex'))
  const shade = (b.glow || lit) ? SHADE[faceName] * 0.35 : SHADE[faceName]
  const tint = (lit && b.tintOn) || b.tint
  const style = {
    backgroundImage: `linear-gradient(rgba(0,0,0,${shade}), rgba(0,0,0,${shade})), ${texUrl(tex)}`,
    backgroundColor: tint || 'transparent',
    backgroundBlendMode: tint ? 'normal, multiply' : 'normal, normal',
  }
  if (tint || b.kind === 'plate' || b.kind === 'sprite') {
    // Clip the tint colour and shade layer to the texture's own alpha.
    style.maskImage = texUrl(tex)
    style.WebkitMaskImage = texUrl(tex)
  }
  return style
}

const items = computed(() => {
  const u = props.unit
  const { cx, cy, cz } = layout.value
  const occ = occupancy.value
  const camFaces = cameraFaces.value
  const out = []

  props.blocks.forEach((b, index) => {
    const kind = b.kind || 'cube'
    const lit = !!(b.power && props.powered)
    const glowing = !!b.glow || lit
    const tx = (b.x + 0.5) * u - cx
    const ty = -(b.y + 0.5) * u - cy
    const tz = (b.z + 0.5) * u - cz
    const item = {
      key: `${index}:${b.x},${b.y},${b.z}`,
      kind,
      glowing,
      glass: !!b.glass,
      style: { transform: `translate3d(${tx}px, ${ty}px, ${tz}px)` },
      faces: [],
    }

    if (kind === 'cube') {
      for (const face of FACES) {
        if (!camFaces.has(face.name)) {
          continue
        }
        const [nx, ny, nz] = face.normal
        if (occ.has(`${b.x + nx},${b.y + ny},${b.z + nz}`)) {
          continue
        }
        item.faces.push({
          name: face.name,
          style: {
            transform: `${face.transform} translateZ(${u / 2}px)`,
            ...faceBackground(b, face.name, lit),
          },
        })
      }
    }
    else if (kind === 'plate') {
      item.faces.push({
        name: 'plate',
        style: {
          transform: `rotateX(90deg) rotateZ(${Number(b.rot) || 0}deg) translateZ(${-u / 2 + 1}px)`,
          ...faceBackground(b, 'top', lit),
        },
      })
    }
    else if (kind === 'sprite') {
      for (const angle of [45, -45]) {
        item.faces.push({
          name: 'sprite',
          style: {
            transform: `rotateY(${angle}deg)`,
            ...faceBackground(b, 'top', lit),
            backgroundImage: texUrl((lit && b.texOn) || b.tex),
          },
        })
      }
    }

    if (item.faces.length) {
      out.push(item)
    }
  })

  return out
})

const rootStyle = computed(() => ({
  'width': `${layout.value.width}px`,
  'height': `${layout.value.height}px`,
  '--iso-unit': `${props.unit}px`,
  '--iso-pitch': `${props.pitch}deg`,
  '--iso-yaw': `${props.yaw}deg`,
  '--iso-spin': `${props.spinSeconds}s`,
}))

const worldStyle = computed(() => ({
  left: `calc(50% + ${layout.value.offsetX}px)`,
  top: `calc(50% + ${layout.value.offsetY}px)`,
}))
</script>

<template>
  <div class="iso-scene" :class="{ 'is-spinning': spin, 'is-powered': powered }" :style="rootStyle" aria-hidden="true">
    <div class="iso-world" :style="worldStyle">
      <div
        v-for="item in items"
        :key="item.key"
        class="iso-cell"
        :class="[`is-${item.kind}`, { 'is-glowing': item.glowing, 'is-glass': item.glass }]"
        :style="item.style"
      >
        <div
          v-for="face in item.faces"
          :key="face.name + face.style.transform"
          class="iso-face"
          :class="`iso-face--${face.name}`"
          :style="face.style"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.iso-scene {
  position: relative;
  flex: none;
  pointer-events: none;
  user-select: none;
}

.iso-world {
  position: absolute;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  transform: rotateX(var(--iso-pitch)) rotateY(var(--iso-yaw));
}

.iso-scene.is-spinning .iso-world {
  animation: iso-spin var(--iso-spin) linear infinite;
}

@keyframes iso-spin {
  from {
    transform: rotateX(var(--iso-pitch)) rotateY(var(--iso-yaw));
  }
  to {
    transform: rotateX(var(--iso-pitch)) rotateY(calc(var(--iso-yaw) + 360deg));
  }
}

.iso-cell {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}

.iso-face {
  position: absolute;
  left: calc(var(--iso-unit) / -2);
  top: calc(var(--iso-unit) / -2);
  width: var(--iso-unit);
  height: var(--iso-unit);
  background-size: 100% 100%;
  background-repeat: no-repeat;
  mask-size: 100% 100%;
  -webkit-mask-size: 100% 100%;
  mask-repeat: no-repeat;
  -webkit-mask-repeat: no-repeat;
  image-rendering: pixelated;
  backface-visibility: hidden;
  transition: background-color 0.25s;
}

/* Cover 1px seams between neighbouring faces. */
.is-cube .iso-face {
  outline: 0.5px solid rgba(0, 0, 0, 0.18);
  outline-offset: -0.5px;
}

.is-sprite .iso-face,
.is-plate .iso-face {
  backface-visibility: visible;
}

.is-glass .iso-face {
  opacity: 0.55;
}

.is-glowing .iso-face {
  box-shadow: 0 0 calc(var(--iso-unit) * 0.45) rgba(255, 60, 30, 0.38);
}

@media (prefers-reduced-motion: reduce) {
  .iso-scene.is-spinning .iso-world {
    animation: none;
  }
}
</style>
