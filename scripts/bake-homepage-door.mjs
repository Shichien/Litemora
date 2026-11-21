import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
/**
 * Bake the real Minecraft resource-pack meshes once; no Minecraft renderer ships
 * with the homepage. Requires installed Playwright and Microsoft Edge.
 * node scripts/bake-homepage-door.mjs
 * The default bakes the verified homepage playback from its checked-in JSON.
 * --static omits playback; --simulation file.json selects another verified trace.
 * --input file.litematic / --output file.glb override the source and destination.
 * Optional --endpoints file.json: {closed:[{id?,position:[x,y,z],blockState}],
 * open:[...],duration:700}. Endpoint meshes are baked into the same GLB.
 */
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { chromium } from 'playwright'
import { parse, simplify } from 'prismarine-nbt'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? path.resolve(args[args.indexOf(name) + 1]) : fallback
const input = option('--input', path.join(root, 'public/homepage/piston-door-56.litematic'))
const output = option('--output', path.join(root, 'public/homepage/piston-door-56.glb'))
const endpointPath = option('--endpoints', null)
const simulationPath = args.includes('--static') || endpointPath ? null : option('--simulation', path.join(root, 'public/homepage/piston-door-56-playback.json'))
const closingPath = option('--closing-simulation', null)
const pack = path.join(root, 'public/minecraft-default-pack')
const source = await fs.readFile(input)
const { parsed } = await parse(source)
const nbt = simplify(parsed)
const blocks = []
for (const region of Object.values(nbt.Regions)) {
  const size = ['x', 'y', 'z'].map(axis => Math.abs(region.Size[axis]))
  const origin = ['x', 'y', 'z'].map(axis => region.Position[axis] + Math.min(0, region.Size[axis] + 1))
  const palette = region.BlockStatePalette.map(({ Name, Properties = {} }) => Name + (Object.keys(Properties).length ? `[${Object.keys(Properties).sort().map(key => `${key}=${Properties[key]}`).join(',')}]` : ''))
  const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
  const mask = (1n << BigInt(bits)) - 1n
  const longs = region.BlockStates.map(value => Array.isArray(value) ? (BigInt(value[0] >>> 0) << 32n) | BigInt(value[1] >>> 0) : BigInt.asUintN(64, BigInt(value)))
  for (let i = 0; i < size[0] * size[1] * size[2]; i++) {
    const bit = i * bits
    const word = Math.floor(bit / 64)
    const offset = bit % 64
    let entry = longs[word] >> BigInt(offset)
    if (offset + bits > 64)
      entry |= longs[word + 1] << BigInt(64 - offset)
    const blockState = palette[Number(entry & mask)]
    if (/^minecraft:(?:air|cave_air|void_air)$/.test(blockState))
      continue
    if (!blockState)
      throw new Error(`Invalid palette index at block ${i}`)
    const position = [i % size[0], Math.floor(i / (size[0] * size[2])), Math.floor(i / size[0]) % size[2]].map((v, j) => v + origin[j])
    blocks.push({ id: `block_${position.join('_')}`, position, blockState })
  }
}
const endpoints = endpointPath ? JSON.parse(await fs.readFile(endpointPath, 'utf8')) : null
let playback = null
const variants = []
if (simulationPath) {
  const unique = new Map()
  const visibleVariant = (position, blockState) => {
    const key = `${position.join(',')}:${blockState}`
    if (!unique.has(key)) {
      unique.set(key, variants.length)
      variants.push({ id: `frameblock_${variants.length}`, position, blockState })
    }
    return unique.get(key)
  }
  function makeTrack(simulation) {
    const state = new Map(simulation.initial.map(([x, y, z, blockState]) => [`${x},${y},${z}`, blockState]))
    const snapshot = tick => ({ tick, nodes: [...state].filter(([, blockState]) => !blockState.startsWith('minecraft:air')).map(([key, blockState]) => visibleVariant(key.split(',').map(Number), blockState)) })
    const frames = [snapshot(0)]
    for (const frame of simulation.frames) {
      if (!frame.changes.length)
        continue
      for (const change of frame.changes) {
        const key = `${change.x},${change.y},${change.z}`
        state.set(key, change.state.startsWith('minecraft:moving_piston') ? 'minecraft:air' : change.state)
      }
      frames.push(snapshot(frame.tick))
    }
    // Settle to the exact exported endpoint, including absent piston heads.
    state.clear()
    for (const [x, y, z, blockState] of simulation.final) state.set(`${x},${y},${z}`, blockState)
    frames.push(snapshot(simulation.totalTicks || frames.at(-1).tick + 1))
    const motions = (simulation.motions || []).filter(motion => motion.state !== 'minecraft:air').map((motion) => {
      const index = variants.length
      variants.push({ id: `frameblock_${index}`, position: motion.position, blockState: motion.state })
      return { node: index, startTick: motion.startTick, endTick: motion.endTick, source: motion.source || motion.position, position: motion.position }
    })
    return { frames, motions, totalTicks: simulation.totalTicks || frames.at(-1).tick }
  }
  const data = JSON.parse(await fs.readFile(simulationPath, 'utf8'))
  playback = { open: makeTrack(data.sequences?.open || data), closed: data.sequences?.close ? makeTrack(data.sequences.close) : closingPath ? makeTrack(JSON.parse(await fs.readFile(closingPath, 'utf8'))) : null }
}
const payload = { blocks, endpoints, playback, variants }
// Build a minimal real pack by following model parents and texture references.
const zip = new JSZip()
const seen = new Set()
async function addAsset(relative) {
  if (seen.has(relative))
    return
  seen.add(relative)
  const bytes = await fs.readFile(path.join(pack, relative))
  zip.file(relative, bytes)
  if (!relative.endsWith('.json'))
    return
  const json = JSON.parse(bytes)
  const resolve = (value, kind, extension) => {
    const [namespace, name] = value.includes(':') ? value.split(':') : ['minecraft', value]
    return `assets/${namespace}/${kind}/${name}.${extension}`
  }
  if (json.parent)
    await addAsset(resolve(json.parent, 'models', 'json'))
  for (const texture of Object.values(json.textures || {})) {
    if (!texture.startsWith('#'))
      await addAsset(resolve(texture, 'textures', 'png'))
  }
  async function visit(value) {
    if (!value || typeof value !== 'object')
      return
    if (typeof value.model === 'string')
      await addAsset(resolve(value.model, 'models', 'json'))
    for (const child of Object.values(value)) await visit(child)
  }
  await visit(json.variants)
  await visit(json.multipart)
}
for (const block of [...blocks, ...variants, ...(endpoints?.closed || []), ...(endpoints?.open || [])]) {
  const [namespace, name] = block.blockState.split('[')[0].split(':')
  await addAsset(`assets/${namespace}/blockstates/${name}.json`)
}
zip.file('pack.mcmeta', JSON.stringify({ pack: { pack_format: 34, description: 'Homepage offline bake subset' } }))
const packBytes = await zip.generateAsync({ type: 'nodebuffer' })
const html = `<!doctype html><script src="/node_modules/jszip/dist/jszip.min.js"></script><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","jszip":"/zip-shim.js"}}</script>`
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end(html)
      return
    }
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    if (pathname === '/payload.json') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(payload))
      return
    }
    if (pathname === '/pack.zip') {
      response.end(packBytes)
      return
    }
    if (pathname === '/zip-shim.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end('export default window.JSZip')
      return
    }
    const target = path.resolve(root, `.${decodeURIComponent(pathname)}`)
    if (!target.startsWith(root + path.sep)) {
      response.writeHead(403).end()
      return
    }
    response.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
    response.end(await fs.readFile(target))
  }
  catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.error(message.text())
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const { Cubane } = await import('/node_modules/cubane/dist/cubane.es.js')
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
    const { blocks, endpoints, playback, variants } = await (await fetch('/payload.json')).json()
    const cubane = new Cubane({ autoRestore: false })
    await cubane.loadPackFromBlob(await (await fetch('/pack.zip')).blob(), 'Homepage real pack subset')
    const scene = new THREE.Scene()
    const bakedStates = new Map()
    const materialCache = new Map()
    async function addBlocks(list, parent) {
      for (const block of list) {
        let prototype = bakedStates.get(block.blockState)
        if (!prototype) {
          prototype = await cubane.getBlockMesh(block.blockState, 'plains', true)
          prototype.traverse((child) => {
            if (!child.isMesh)
              return
            const convert = (material) => {
              if (!materialCache.has(material.uuid)) {
                // This door palette contains only opaque/cutout blocks. Export
                // MASK, not BLEND: transparent sorting can hide thin redstone
                // behind its support block and drops alphaTest during export.
                materialCache.set(material.uuid, new THREE.MeshStandardMaterial({
                  map: material.map,
                  color: material.color,
                  transparent: false,
                  opacity: material.opacity,
                  alphaTest: material.alphaTest || 0.1,
                  side: material.side,
                  roughness: 1,
                  metalness: 0,
                  vertexColors: material.vertexColors,
                }))
              }
              return materialCache.get(material.uuid)
            }
            child.material = Array.isArray(child.material) ? child.material.map(convert) : convert(child.material)
          })
          bakedStates.set(block.blockState, prototype)
        }
        const group = new THREE.Group()
        group.name = block.id || `block_${block.position.join('_')}`
        group.position.fromArray(block.position)
        group.userData = { blockState: block.blockState }
        if (block.openPosition)
          group.userData.openPosition = block.openPosition
        group.add(prototype.clone(true))
        parent.add(group)
      }
    }
    if (playback) {
      await addBlocks(variants, scene)
      scene.userData.playback = playback
      scene.userData.duration = Math.max(700, playback.open.totalTicks * 50)
    }
    else if (endpoints) {
      for (const state of ['closed', 'open']) {
        const group = new THREE.Group()
        group.name = `endpoint_${state}`
        group.userData.endpoint = state
        await addBlocks(endpoints[state], group)
        scene.add(group)
      }
      scene.userData.duration = endpoints.duration || 700
      scene.userData.endpointAnimation = true
    }
    else {
      await addBlocks(blocks, scene)
    }
    scene.updateMatrixWorld(true)
    const buffer = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false })
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
    cubane.dispose()
    return { base64: btoa(binary), blocks: blocks.length, states: bakedStates.size }
  })
  await fs.mkdir(path.dirname(output), { recursive: true })
  const bytes = Buffer.from(result.base64, 'base64')
  await fs.writeFile(output, bytes)
  const report = { source: path.relative(root, input).replaceAll('\\', '/'), sourceSha256: createHash('sha256').update(source).digest('hex'), resourcePack: 'public/minecraft-default-pack', blockCount: result.blocks, uniqueBlockStates: result.states, bytes: bytes.length, endpointAnimation: Boolean(endpoints || playback), playbackSource: simulationPath ? path.relative(root, simulationPath).replaceAll('\\', '/') : null, motionCount: playback ? playback.open.motions.length + (playback.closed?.motions.length || 0) : 0 }
  await fs.writeFile(output.replace(/\.glb$/, '.bake.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ output: path.relative(root, output), ...report }, null, 2))
}
finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
