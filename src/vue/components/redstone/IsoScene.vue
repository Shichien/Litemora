<script setup>
// Isometric voxel scene drawn with real pack textures.
//
// The projection is a linear orthographic map, so every block face lands on screen
// as an exact parallelogram. Faces are painted as 2D `matrix()` quads in explicit
// back-to-front order instead of leaving it to CSS `preserve-3d` depth sorting,
// which mis-orders coplanar and densely packed quads (that is what used to make
// repeaters / levers / torches look wrong and buildings appear half drawn).
//
// blocks: [{ x, y, z, ...spec }] in block units, y up. Spec fields:
//   tex            texture basename for every face (e.g. 'deepslate_bricks')
//   top / side     per-face overrides
//   kind           'cube' (default) | 'plate' (flat quad on the floor of the cell: dust, repeater)
//                  | 'sprite' (camera-facing billboard: torch, lever, flower)
//   tint           multiply colour for grayscale textures (dust, grass top, leaves)
//   rot            plate rotation in degrees (0/90/180/270)
//   glow           always emits (redstone block, lit torch)
//   power          reacts to the scene's `powered` prop; then texOn/topOn/sideOn/tintOn are used
//   glass          translucent cube, does not hide neighbour faces
import { resolvePublicAssetUrl } from '@/js/utils/public-asset-url.js'
import { computed } from 'vue'

const props = defineProps({
  blocks: { type: Array, required: true },
  // Edge length of one block in px.
  unit: { type: Number, default: 32 },
  // Camera pitch (negative looks down) and yaw, in degrees.
  pitch: { type: Number, default: -30 },
  yaw: { type: Number, default: 45 },
  powered: { type: Boolean, default: false },
  // Reserved: the 2D painter has no turntable animation.
  spin: { type: Boolean, default: false },
  spinSeconds: { type: Number, default: 40 },
})

const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const SHADE = { top: 0, south: 0.22, north: 0.22, east: 0.38, west: 0.38 }

// Where a face sits in block units: (s, t) in [0,1]² walks the texture
// left-to-right / top-to-bottom, matching the texture's own pixel grid.
const FACE_CORNERS = {
  top: (b, s, t) => [b.x + s, b.y + 1, b.z + t],
  south: (b, s, t) => [b.x + s, b.y + 1 - t, b.z + 1],
  north: (b, s, t) => [b.x + 1 - s, b.y + 1 - t, b.z],
  east: (b, s, t) => [b.x + 1, b.y + 1 - t, b.z + 1 - s],
  west: (b, s, t) => [b.x, b.y + 1 - t, b.z + s],
}

const FACES = [
  { name: 'top', normal: [0, 1, 0] },
  { name: 'south', normal: [0, 0, 1] },
  { name: 'north', normal: [0, 0, -1] },
  { name: 'east', normal: [1, 0, 0] },
  { name: 'west', normal: [-1, 0, 0] },
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

// Camera-space depth of a CSS-space point: greater means closer to the viewer.
function depthOf(px, py, pz, pitch, yaw) {
  const z1 = -px * Math.sin(yaw) + pz * Math.cos(yaw)
  return py * Math.sin(pitch) + z1 * Math.cos(pitch)
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

// Faces that can face the camera at the current yaw.
const cameraFaces = computed(() => {
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
  const yaw = toRad(props.yaw)
  let sMinX = Infinity
  let sMinY = Infinity
  let sMaxX = -Infinity
  let sMaxY = -Infinity
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
  const pitch = toRad(props.pitch)
  const yaw = toRad(props.yaw)
  // Adjacent quads share an edge; growing each by a hair hides antialiasing seams.
  const grow = 1 + 0.9 / u
  const out = []

  // Project a block-space delta from the cell centre to a screen offset.
  const screen = (dx, dy, dz) => project(dx * u, -dy * u, dz * u, pitch, yaw)

  // `corner(b, s, t)` returns a block-space point; build the exact parallelogram.
  const quadMatrix = (b, corner) => {
    const ccx = b.x + 0.5
    const ccy = b.y + 0.5
    const ccz = b.z + 0.5
    const at = (s, t) => {
      const [x, y, z] = corner(b, s, t)
      return screen(x - ccx, y - ccy, z - ccz)
    }
    const p0 = at(0, 0)
    const p1 = at(1, 0)
    const p2 = at(0, 1)
    const a = ((p1.x - p0.x) * grow) / u
    const bb = ((p1.y - p0.y) * grow) / u
    const c = ((p2.x - p0.x) * grow) / u
    const d = ((p2.y - p0.y) * grow) / u
    // Grow about the quad centre (p1+p2)/2, not the top-left corner.
    const mx = (p1.x + p2.x) / 2
    const my = (p1.y + p2.y) / 2
    const e = grow * p0.x + (1 - grow) * mx
    const f = grow * p0.y + (1 - grow) * my
    return `matrix(${a}, ${bb}, ${c}, ${d}, ${e}, ${f})`
  }

  // Flat quad on the floor of the cell, spun by `rot` around the vertical axis.
  const plateCorner = (rot) => {
    const th = toRad(Number(rot) || 0)
    const cos = Math.cos(th)
    const sin = Math.sin(th)
    return (b, s, t) => {
      const a = s - 0.5
      const d = t - 0.5
      return [
        b.x + 0.5 + a * cos + d * sin,
        b.y + 0.01,
        b.z + 0.5 - a * sin + d * cos,
      ]
    }
  }

  props.blocks.forEach((b, index) => {
    const kind = b.kind || 'cube'
    const lit = !!(b.power && props.powered)
    const tx = (b.x + 0.5) * u - cx
    const ty = -(b.y + 0.5) * u - cy
    const tz = (b.z + 0.5) * u - cz
    const at = project(tx, ty, tz, pitch, yaw)
    const item = {
      key: `${index}:${b.x},${b.y},${b.z}`,
      kind,
      glowing: !!b.glow || lit,
      glass: !!b.glass,
      depth: depthOf(tx, ty, tz, pitch, yaw),
      style: { transform: `translate(${at.x}px, ${at.y}px)` },
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
            transform: quadMatrix(b, FACE_CORNERS[face.name]),
            ...faceBackground(b, face.name, lit),
          },
        })
      }
    }
    else if (kind === 'plate') {
      item.faces.push({
        name: 'plate',
        style: {
          transform: quadMatrix(b, plateCorner(b.rot)),
          ...faceBackground(b, 'top', lit),
        },
      })
    }
    else if (kind === 'sprite') {
      // Billboards always face the camera: a plain upright square in the cell. The
      // texture's own alpha has to mask the quad, otherwise the transparent padding
      // around a torch or lever stem paints as an opaque square.
      const tex = (lit && b.texOn) || b.tex
      const tint = (lit && b.tintOn) || b.tint
      item.faces.push({
        name: 'sprite',
        style: {
          transform: `matrix(${grow}, 0, 0, ${grow}, ${(-u / 2) * grow}, ${(-u / 2) * grow})`,
          backgroundImage: texUrl(tex),
          backgroundColor: tint || 'transparent',
          backgroundBlendMode: tint ? 'multiply' : 'normal',
          maskImage: texUrl(tex),
          WebkitMaskImage: texUrl(tex),
        },
      })
    }

    if (item.faces.length) {
      out.push(item)
    }
  })

  // Painter's algorithm: farthest cell first, so nearer cells paint over it.
  out.sort((p, q) => p.depth - q.depth)
  return out
})

const rootStyle = computed(() => ({
  'width': `${layout.value.width}px`,
  'height': `${layout.value.height}px`,
  '--iso-unit': `${props.unit}px`,
}))

const worldStyle = computed(() => ({
  left: `calc(50% + ${layout.value.offsetX}px)`,
  top: `calc(50% + ${layout.value.offsetY}px)`,
}))
</script>

<template>
  <div class="iso-scene" :class="{ 'is-powered': powered }" :style="rootStyle" aria-hidden="true">
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
          :key="face.name"
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
}

.iso-cell {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
}

.iso-face {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--iso-unit);
  height: var(--iso-unit);
  transform-origin: 0 0;
  background-size: 100% 100%;
  background-repeat: no-repeat;
  mask-size: 100% 100%;
  -webkit-mask-size: 100% 100%;
  mask-repeat: no-repeat;
  -webkit-mask-repeat: no-repeat;
  image-rendering: pixelated;
  transition: background-color 0.25s;
}

.is-glass .iso-face {
  opacity: 0.55;
}

.is-glowing .iso-face {
  filter: drop-shadow(0 0 calc(var(--iso-unit) * 0.3) rgba(255, 60, 30, 0.5));
}
</style>
