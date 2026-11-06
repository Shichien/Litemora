// Captures static gallery thumbnails for public worlds.
//
// For every world it opens <base>/<space>/worlds/<routeId> in headless Edge, waits until the
// scene and chunk streaming have settled, hides all DOM UI, switches the camera to bird
// perspective, fits a 3/4 view to the build bounds, and saves a 960x600 webp to
// public/thumbnails/<space>/<routeId>.webp. Entries are merged into public/thumbnails/manifest.json
// (format read by src/js/gallery/world-thumbnails.js).
//
// Usage:
//   node scripts/capture-world-thumbnails.mjs [--base https://litemora.art] [space/routeId ...]
//   pnpm thumbnails:capture -- redstonearchive/digitalclock
//
// Options:
//   --base <url>        Site to capture from (default https://litemora.art).
//   --api <url>         Where /api/discover and /api/gallery are read (default: same as --base).
//   --views <file>      Per-world view overrides (default scripts/thumbnail-views.json).
//   --include-test      Also capture worlds in test spaces (codexperf, blanktest).
//   --view '<json>'     Extra view fields applied to every listed world, for tuning (e.g. '{"yaw":135}').
//   --out-suffix <s>    Tuning mode: only write output/thumbnails-raw/<space>__<routeId><s>.png;
//                       no webp and no manifest change.
//   --keep-png          Keep the raw 1280x800 capture next to the webp in output/thumbnails-raw/.
//   --headed            Show the browser window.
//
// With no world list, the script captures every public world listed by /api/discover and
// /api/gallery?space=<space> for the spaces it finds plus the local public/spaces/* folders.
// Requests are read-only. Requires Playwright (msedge channel) and Python with Pillow.
//
// Framing: the camera switches to the app's bird-perspective (OrbitControls) mode, then looks
// at the build from `yaw`/`pitch` with a narrow FOV. The distance is binary-searched so the
// projected corners of every chunk mesh's bounding box fit inside the frame minus `padding`,
// and the look-at point is re-centred on the projected box. Per-world overrides of any
// DEFAULT_VIEW field go in scripts/thumbnail-views.json, keyed by "space/routeId", e.g.
//   { "deralive/st5": { "yaw": 315, "pitch": 26 }, "a/b": { "zoom": 1.2, "offsetY": -4 } }

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const THUMB_DIR = path.join(ROOT, 'public', 'thumbnails')
const MANIFEST_PATH = path.join(THUMB_DIR, 'manifest.json')
const RAW_DIR = path.join(ROOT, 'output', 'thumbnails-raw')
const DEFAULT_VIEWS_PATH = path.join(ROOT, 'scripts', 'thumbnail-views.json')
const TEST_SPACES = new Set(['codexperf', 'blanktest'])

const CAPTURE_WIDTH = 1280
const CAPTURE_HEIGHT = 800
const OUTPUT_WIDTH = 960
const OUTPUT_HEIGHT = 600
const WEBP_QUALITY = 82
const MAX_BYTES = 120 * 1024

const DEFAULT_VIEW = {
  yaw: 45, // degrees around +Y; 0 looks from +Z towards -Z, 90 from +X
  pitch: 32, // degrees above the horizon
  fov: 30, // narrow FOV gives a near-isometric look
  padding: 0.08, // fraction of the frame left empty on each side
  zoom: 1, // > 1 moves closer after fitting
  offsetX: 0, // shift of the look-at point, in blocks
  offsetY: 0,
  offsetZ: 0,
  timeOfDay: 0.4, // late morning
  replayTick: null, // seek a redstone replay before capturing
  fit: 'auto', // 'auto' | 'meshes' (chunk mesh bounds) | 'schematic' (whole schematic box)
  settleMs: 1500,
}

const HIDE_UI_CSS = `
  body * { visibility: hidden !important; }
  canvas.three-canvas { visibility: visible !important; }
  *, *::before, *::after { transition: none !important; animation: none !important; cursor: none !important; }
`

function parseArgs(argv) {
  const options = {
    base: 'https://litemora.art',
    api: '',
    views: DEFAULT_VIEWS_PATH,
    includeTest: false,
    keepPng: false,
    headed: false,
    view: null,
    outSuffix: '',
    worlds: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--base') {
      options.base = argv[++i]
    }
    else if (arg === '--api') {
      options.api = argv[++i]
    }
    else if (arg === '--views') {
      options.views = path.resolve(argv[++i])
    }
    else if (arg === '--view') {
      options.view = JSON.parse(argv[++i])
    }
    else if (arg === '--out-suffix') {
      options.outSuffix = argv[++i]
    }
    else if (arg === '--include-test') {
      options.includeTest = true
    }
    else if (arg === '--keep-png') {
      options.keepPng = true
    }
    else if (arg === '--headed') {
      options.headed = true
    }
    else if (arg === '--') {
      continue
    }
    else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }
    else if (/^[a-z0-9-]+\/[\w-]+$/i.test(arg)) {
      options.worlds.push(arg)
    }
    else {
      throw new Error(`Expected space/routeId, got: ${arg}`)
    }
  }
  options.base = String(options.base || '').replace(/\/+$/, '')
  options.api = String(options.api || options.base).replace(/\/+$/, '')
  return options
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`)
  }
  return res.json()
}

function itemRouteId(item) {
  return String(item?.routeId || item?.projectionSlug || '').trim()
}

// Normalises the two bounds shapes the API returns ({minX..maxZ} or {min:{x,y,z},max:{x,y,z}}),
// falling back to schematic.size. Returns null for empty bounds.
function itemBounds(item) {
  const raw = item?.preview?.bounds || item?.schematic?.bounds || null
  let box = null
  if (raw && Number.isFinite(Number(raw.maxX))) {
    box = { minX: +raw.minX, minY: +raw.minY, minZ: +raw.minZ, maxX: +raw.maxX + 1, maxY: +raw.maxY + 1, maxZ: +raw.maxZ + 1 }
  }
  else if (raw?.max) {
    box = { minX: +raw.min.x, minY: +raw.min.y, minZ: +raw.min.z, maxX: +raw.max.x + 1, maxY: +raw.max.y + 1, maxZ: +raw.max.z + 1 }
  }
  if (box && box.maxX - box.minX > 1 && box.maxZ - box.minZ > 1) {
    return box
  }
  const size = item?.schematic?.size
  if (size && Number(size.x) > 0 && Number(size.z) > 0) {
    return { minX: 0, minY: 0, minZ: 0, maxX: +size.x, maxY: +size.y, maxZ: +size.z }
  }
  return null
}

async function localSpaces() {
  try {
    const entries = await fs.readdir(path.join(ROOT, 'public', 'spaces'), { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  }
  catch {
    return []
  }
}

async function discoverWorlds(options) {
  const worlds = new Map()
  const add = (space, item) => {
    const routeId = itemRouteId(item)
    if (!space || !routeId || (item.visibility && item.visibility !== 'public')) {
      return
    }
    const key = `${space.toLowerCase()}/${routeId}`
    const previous = worlds.get(key)
    worlds.set(key, { key, space: space.toLowerCase(), routeId, title: item.title || routeId, item: previous?.item?.schematic ? previous.item : item })
  }

  const discover = await fetchJson(`${options.api}/api/discover?limit=24`)
  const spaces = new Set(await localSpaces())
  for (const item of discover.items || []) {
    add(item.space, item)
    spaces.add(item.space)
  }
  for (const space of spaces) {
    try {
      const gallery = await fetchJson(`${options.api}/api/gallery?space=${encodeURIComponent(space)}`)
      for (const item of gallery.items || []) {
        add(space, item)
      }
    }
    catch (error) {
      console.warn(`skip gallery ${space}: ${error.message}`)
    }
  }

  const list = [...worlds.values()]
  if (options.worlds.length) {
    return options.worlds.map(key => list.find(world => world.key === key.toLowerCase())
      || { key: key.toLowerCase(), space: key.split('/')[0].toLowerCase(), routeId: key.split('/')[1], title: key, item: null })
  }
  return list.filter((world) => {
    if (!options.includeTest && TEST_SPACES.has(world.space)) {
      console.log(`skip ${world.key}: test space`)
      return false
    }
    return true
  })
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  }
  catch {
    return fallback
  }
}

// --- page-context helpers (serialised into the page) ---

function pagePrepare({ timeOfDay }) {
  const E = window.Experience
  const world = E.world
  const cycle = world.environment?.dayCycle
  if (cycle) {
    cycle.setAutoPlay(false)
    cycle.setTimeOfDay(timeOfDay)
    cycle.applyLighting(world.environment)
  }
  world.redstoneReplayController?.pause?.()

  // Player model and block outline are not part of the build.
  if (world.player?.model) {
    world.player.model.visible = false
  }
  if (world.blockSelectionHelper) {
    world.blockSelectionHelper.params.enabled = false
    world.blockSelectionHelper.clear?.()
  }

  // Runtime chunk streaming normally follows the player with a radius tuned for play.
  // Pin the stream centre to the middle of the build and widen the radius to the whole chunk
  // grid, so every chunk becomes resident for the capture.
  const layer = world.minecraftSchematicRenderLayer
  const bridge = layer?._runtimeBridge
  const bounds = bridge?.bounds || null
  if (bridge && bounds && bridge._chunkBounds && !bridge.__thumbPinned) {
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    }
    const grid = bridge._chunkBounds
    if (grid && bridge._streamConfig) {
      const horizontal = Math.ceil(Math.max(grid.maxX - grid.minX, grid.maxZ - grid.minZ) / 2) + 1
      const vertical = Math.ceil((grid.maxY - grid.minY) / 2) + 1
      bridge._streamConfig = {
        ...bridge._streamConfig,
        horizontalLoadRadius: horizontal,
        verticalLoadRadius: vertical,
        horizontalUnloadRadius: horizontal + 1,
        verticalUnloadRadius: vertical + 1,
        maxConcurrentBuilds: 4,
      }
    }
    const original = bridge._updateStreamingTarget.bind(bridge)
    bridge._updateStreamingTarget = (_playerPosition, force) => original(center, force)
    bridge.__thumbPinned = true
    bridge._updateStreamingTarget(center, true)
  }
  return { bounds, paused: !!E.isPaused, pinned: !!bridge?.__thumbPinned, stream: bridge?._streamConfig || null }
}

function pageStreamStats() {
  const text = JSON.parse(window.render_game_to_text())
  return text.schematic
}

function pageFitCamera({ box, view, aspect }) {
  const E = window.Experience
  const camera = E.camera
  camera.switchMode(camera.cameraModes.BIRD_PERSPECTIVE)
  const cam = camera.instance
  const Vec = cam.position.constructor
  cam.fov = view.fov
  cam.aspect = aspect
  cam.near = 0.5

  // Fit points: the corners of every rendered mesh's world bounding box (runtime meshes are
  // per 16^3 chunk, so this hugs the build), falling back to the schematic bounds.
  const corners = []
  const pushBox = (b) => {
    for (const x of [b.min.x, b.max.x]) {
      for (const y of [b.min.y, b.max.y]) {
        for (const z of [b.min.z, b.max.z]) {
          corners.push(new Vec(x, y, z))
        }
      }
    }
  }
  // Per-mesh world bounds come from mesh.userData.bounds (what the render layer itself uses for
  // culling). Boxes outside the schematic bounds are ignored, and if the result is implausibly
  // small (e.g. replay worlds that swap in dynamic meshes) the schematic box is used instead.
  const margin = 2
  const inside = b => b.min.x >= box.minX - margin && b.min.y >= box.minY - margin && b.min.z >= box.minZ - margin
    && b.max.x <= box.maxX + margin && b.max.y <= box.maxY + margin && b.max.z <= box.maxZ + margin
  // Small builds are already tight in their schematic box, and redstone replays draw moving
  // parts outside the static chunk meshes, so mesh fitting is only used for large builds.
  const largest = Math.max(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ)
  const useMeshes = view.fit === 'meshes' || (view.fit !== 'schematic' && largest >= 64)
  const layer = E.world.minecraftSchematicRenderLayer
  const meshes = useMeshes ? (layer?._runtimeBridge?.getMeshes?.() || layer?._meshEntries || []) : []
  for (const mesh of meshes) {
    const ub = mesh?.userData?.bounds
    if (!ub || !Number.isFinite(Number(ub.minX)) || !Number.isFinite(Number(ub.maxX))) {
      continue
    }
    const b = { min: new Vec(+ub.minX, +ub.minY, +ub.minZ), max: new Vec(+ub.maxX, +ub.maxY, +ub.maxZ) }
    if (b.max.x > b.min.x && inside(b)) {
      pushBox(b)
    }
  }
  const schematicDiagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ)
  let meshDiagonal = 0
  if (corners.length) {
    const lo = corners[0].clone()
    const hi = corners[0].clone()
    for (const corner of corners) {
      lo.min(corner)
      hi.max(corner)
    }
    meshDiagonal = lo.distanceTo(hi)
  }
  if (meshDiagonal < schematicDiagonal * 0.25) {
    corners.length = 0
    pushBox({ min: new Vec(box.minX, box.minY, box.minZ), max: new Vec(box.maxX, box.maxY, box.maxZ) })
  }
  const fitBox = { min: corners[0].clone(), max: corners[0].clone() }
  for (const corner of corners) {
    fitBox.min.min(corner)
    fitBox.max.max(corner)
  }
  const radius = fitBox.min.distanceTo(fitBox.max) / 2
  const yaw = view.yaw * Math.PI / 180
  const pitch = view.pitch * Math.PI / 180
  const dir = new Vec(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  const target = fitBox.min.clone().add(fitBox.max).multiplyScalar(0.5)
  const limit = 1 - view.padding * 2
  const point = new Vec()

  const place = (distance) => {
    cam.position.copy(target).addScaledVector(dir, distance)
    // Keep the far plane beyond the camera-following sky dome (radius 150).
    cam.far = Math.max(distance + radius * 2 + 64, 400)
    cam.updateProjectionMatrix()
    cam.lookAt(target)
    cam.updateMatrixWorld(true)
  }
  const extent = () => {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const corner of corners) {
      point.copy(corner).project(cam)
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
    return { minX, maxX, minY, maxY }
  }
  const fits = (distance) => {
    place(distance)
    const e = extent()
    return e.minX >= -limit && e.maxX <= limit && e.minY >= -limit && e.maxY <= limit
  }
  const search = () => {
    let lo = radius * 0.2
    let hi = radius * 20 + 20
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) {
        hi = mid
      }
      else {
        lo = mid
      }
    }
    return hi
  }

  // Fit, then shift the look-at point so the projected box is centred, and fit again.
  let distance = search()
  for (let pass = 0; pass < 4; pass++) {
    place(distance)
    const e = extent()
    const cx = (e.minX + e.maxX) / 2
    const cy = (e.minY + e.maxY) / 2
    const halfH = Math.tan(cam.fov * Math.PI / 360) * distance
    const right = new Vec().setFromMatrixColumn(cam.matrixWorld, 0)
    const up = new Vec().setFromMatrixColumn(cam.matrixWorld, 1)
    target.addScaledVector(right, cx * halfH * cam.aspect).addScaledVector(up, cy * halfH)
    distance = search()
  }

  target.x += view.offsetX
  target.y += view.offsetY
  target.z += view.offsetZ
  distance /= view.zoom
  place(distance)

  const controls = camera.orbitControls
  controls.enableDamping = false
  controls.minDistance = 0.1
  controls.maxDistance = distance * 10
  controls.minPolarAngle = 0
  controls.maxPolarAngle = Math.PI
  controls.target.copy(target)
  // TrackballControls also runs every bird-view frame and calls lookAt(target).
  camera.trackballControls?.target.copy(target)
  controls.update()
  camera.trackballControls?.update()
  return { distance: Math.round(distance * 10) / 10, target: { x: target.x, y: target.y, z: target.z }, far: cam.far }
}

// --- capture ---

async function waitForStreaming(page, timeoutMs) {
  const started = Date.now()
  let stableSince = 0
  let lastSignature = ''
  let stats = null
  while (Date.now() - started < timeoutMs) {
    stats = await page.evaluate(pageStreamStats)
    if (!stats) {
      return null
    }
    const settled = stats.streamReady && !stats.loadingChunks && !stats.queuedChunks && stats.residentChunks > 0
    const signature = `${stats.meshes}/${stats.residentChunks}`
    if (settled && signature === lastSignature) {
      if (!stableSince) {
        stableSince = Date.now()
      }
      if (Date.now() - stableSince > 2000) {
        return stats
      }
    }
    else {
      stableSince = 0
    }
    lastSignature = signature
    await page.waitForTimeout(500)
  }
  console.warn('  streaming did not settle before timeout', stats)
  return stats
}

function convertToWebp(pngPath, webpPath) {
  const code = `
import sys
from PIL import Image
src, dst, quality, max_bytes, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
img = Image.open(src).convert('RGB').resize((w, h), Image.LANCZOS)
q = quality
while True:
    img.save(dst, 'WEBP', quality=q, method=6)
    import os
    size = os.path.getsize(dst)
    if size <= max_bytes or q <= 50:
        break
    q -= 6
print(f'{size} {q}')
`
  const out = execFileSync('python', ['-c', code, pngPath, webpPath, String(WEBP_QUALITY), String(MAX_BYTES), String(OUTPUT_WIDTH), String(OUTPUT_HEIGHT)], { encoding: 'utf8' })
  const [bytes, quality] = out.trim().split(/\s+/).map(Number)
  return { bytes, quality }
}

async function captureWorld(browser, options, world, view) {
  const context = await browser.newContext({ viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', error => console.warn(`  page error: ${error.message}`))
  try {
    const url = `${options.base}/${world.space}/worlds/${world.routeId}`
    console.log(`> ${world.key}  ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(
      () => window.Experience?.world?.isSceneReady && document.querySelector('.hud-root'),
      null,
      { timeout: 300000, polling: 500 },
    )
    await page.addStyleTag({ content: HIDE_UI_CSS })

    let prepared = await page.evaluate(pagePrepare, { timeOfDay: view.timeOfDay })
    // The runtime bridge publishes its bounds and chunk grid shortly after scene ready.
    for (let i = 0; i < 120 && !prepared.pinned; i++) {
      await page.waitForTimeout(500)
      prepared = await page.evaluate(pagePrepare, { timeOfDay: view.timeOfDay })
    }
    if (!prepared.pinned) {
      console.warn('  could not pin chunk streaming; capture may be partial')
    }
    if (prepared.paused) {
      console.warn('  experience is paused; world updates (and streaming) may not run')
    }
    if (options.outSuffix) {
      console.log(`  prepare: pinned=${prepared.pinned} stream=${JSON.stringify(prepared.stream)}`)
    }
    if (view.replayTick !== null && view.replayTick !== undefined) {
      await page.evaluate(tick => window.Experience.world.redstoneReplayController?.seek?.(tick), view.replayTick)
    }

    const stats = await waitForStreaming(page, 300000)
    const runtimeBounds = prepared.bounds || stats?.bounds || null
    const box = runtimeBounds || itemBounds(world.item)
    if (!box) {
      throw new Error('no bounds available')
    }
    const fit = await page.evaluate(pageFitCamera, { box, view, aspect: CAPTURE_WIDTH / CAPTURE_HEIGHT })
    await page.waitForTimeout(view.settleMs)
    // Re-check streaming after the camera move, in case anything was queued late.
    await waitForStreaming(page, 120000)

    await fs.mkdir(RAW_DIR, { recursive: true })
    const pngPath = path.join(RAW_DIR, `${world.space}__${world.routeId}${options.outSuffix}.png`)
    await page.screenshot({ path: pngPath, type: 'png' })
    if (options.outSuffix) {
      console.log(`  tuning capture ${path.relative(ROOT, pngPath)}  distance ${fit.distance}  chunks ${stats?.residentChunks ?? '-'}/${stats?.totalChunks ?? '-'}  meshes ${stats?.meshes ?? '-'}  bounds ${JSON.stringify(box)}`)
      return null
    }

    const webpRel = `${world.space}/${world.routeId}.webp`
    const webpPath = path.join(THUMB_DIR, world.space, `${world.routeId}.webp`)
    await fs.mkdir(path.dirname(webpPath), { recursive: true })
    const { bytes, quality } = convertToWebp(pngPath, webpPath)
    if (!options.keepPng) {
      await fs.rm(pngPath, { force: true })
    }
    console.log(`  saved ${webpRel}  ${(bytes / 1024).toFixed(1)} KB (q${quality})  chunks ${stats?.residentChunks ?? '-'}/${stats?.totalChunks ?? '-'}  distance ${fit.distance}`)
    return { key: world.key, file: webpRel, bytes }
  }
  finally {
    await context.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const views = await readJsonFile(options.views, {})
  const worlds = await discoverWorlds(options)
  if (!worlds.length) {
    console.log('No public worlds found.')
    return
  }
  console.log(`Capturing ${worlds.length} world(s) from ${options.base}`)

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: !options.headed,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
  })
  const results = []
  const failures = []
  try {
    for (const world of worlds) {
      const view = { ...DEFAULT_VIEW, ...(views[world.key] || {}), ...(options.view || {}) }
      try {
        const result = await captureWorld(browser, options, world, view)
        if (result) {
          results.push(result)
        }
      }
      catch (error) {
        console.error(`  failed ${world.key}: ${error.message}`)
        failures.push(world.key)
      }
    }
  }
  finally {
    await browser.close()
  }

  if (results.length) {
    const manifest = await readJsonFile(MANIFEST_PATH, {})
    const now = Date.now()
    for (const result of results) {
      manifest[result.key] = { file: result.file, updatedAt: now, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT }
    }
    const sorted = Object.fromEntries(Object.keys(manifest).sort().map(key => [key, manifest[key]]))
    await fs.mkdir(THUMB_DIR, { recursive: true })
    await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
    console.log(`Manifest updated: ${results.length} entr${results.length === 1 ? 'y' : 'ies'}`)
  }
  if (failures.length) {
    console.error(`Failed: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

await main()
