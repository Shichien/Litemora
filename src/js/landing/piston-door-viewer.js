import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/**
 * A self-contained homepage viewer. modelUrl accepts a baked GLB, or JSON:
 * { modelUrl:'door.glb', duration:700,
 *   frames:{closed:{block_0_0_0:[0,0,0]},open:{block_0_0_0:[0,1,0]}} }
 * GLB nodes can instead carry extras.openPosition:[x,y,z].
 * Callbacks are asynchronous; controls are available immediately, even loading.
 */
export function createPistonDoorViewer(host, { modelUrl = '/homepage/piston-door-56.glb', onReady, onError } = {}) {
  let disposed = false
  let renderer
  let controls
  let observer
  let raf = 0
  let scene
  let camera
  let root
  let desiredOpen = false
  let progress = 0
  let duration = 700
  let lastTime = 0
  let loaded = false
  let visible = true
  const controller = new AbortController()
  const tracks = []
  const endpoints = {}
  let playback = null
  const playbackNodes = []
  let appliedFrame = null
  function applyPlayback() {
    if (!playback)
      return
    const track = !desiredOpen && playback.closed ? playback.closed : playback.open
    const phase = !desiredOpen && playback.closed ? 1 - progress : progress
    const tick = phase * track.totalTicks
    let frame = track.frames[0]
    for (const candidate of track.frames) {
      if (candidate.tick > tick)
        break
      frame = candidate
    }
    if (frame !== appliedFrame) {
      appliedFrame = frame
      const active = new Set(frame.nodes)
      for (let i = 0; i < playbackNodes.length; i++) {
        if (playbackNodes[i])
          playbackNodes[i].visible = active.has(i)
      }
    }
    for (const motion of track.motions) {
      const node = playbackNodes[motion.node]
      node.visible = tick >= motion.startTick && tick < motion.endTick
      if (node.visible) {
        const t = THREE.MathUtils.clamp((tick - motion.startTick) / (motion.endTick - motion.startTick), 0, 1)
        node.position.set(...motion.source).lerp(new THREE.Vector3(...motion.position), t)
      }
    }
  }
  const resources = new Set()
  const readyTextures = new Set()
  const loader = new GLTFLoader()

  function remember(object) {
    object.traverse((node) => {
      if (node.geometry)
        resources.add(node.geometry)
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!material)
          continue
        resources.add(material)
        for (const value of Object.values(material)) {
          if (value?.isTexture)
            readyTextures.add(value)
        }
      }
    })
  }
  function release() {
    for (const value of resources) value.dispose()
    for (const texture of readyTextures) {
      texture.dispose()
      texture.source?.data?.close?.()
    }
    resources.clear()
    readyTextures.clear()
  }
  function draw() {
    if (disposed || !loaded || !visible)
      return
    renderer.render(scene, camera)
  }
  function schedule() {
    if (!disposed && visible && !raf)
      raf = requestAnimationFrame(tick)
  }
  function tick(time) {
    raf = 0
    if (disposed || !visible)
      return
    const delta = lastTime ? Math.min(64, time - lastTime) : 16
    lastTime = time
    const goal = desiredOpen ? 1 : 0
    const moving = Math.abs(goal - progress) > 0.0001
    if (moving) {
      progress = THREE.MathUtils.clamp(progress + (desiredOpen ? 1 : -1) * delta / duration, 0, 1)
      const blend = progress * progress * (3 - 2 * progress)
      for (const track of tracks) track.node.position.lerpVectors(track.closed, track.open, blend)
      // Endpoint snapshots preserve actual block-state changes (piston heads,
      // powered textures, disappearing blocks). Match them at the halfway tick.
      if (endpoints.closed)
        endpoints.closed.visible = progress < 0.5
      if (endpoints.open)
        endpoints.open.visible = progress >= 0.5
      applyPlayback()
    }
    draw()
    if (moving)
      schedule()
    else lastTime = 0
  }
  function resize() {
    if (disposed || !renderer)
      return
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    schedule()
  }
  function handleZoomKey(event) {
    if (event.ctrlKey || event.metaKey || !['+', '=', '-'].includes(event.key))
      return
    event.preventDefault()
    const factor = event.key === '-' ? 1 / 1.2 : 1.2
    const offset = camera.position.clone().sub(controls.target)
    offset.setLength(THREE.MathUtils.clamp(offset.length() / factor, controls.minDistance, controls.maxDistance))
    camera.position.copy(controls.target).add(offset)
    controls.update()
    schedule()
  }
  function setOpen(value) {
    desiredOpen = Boolean(value)
    schedule()
  }
  function onVisibility() {
    visible = !document.hidden
    if (visible) {
      lastTime = 0
      schedule()
    }
  }
  function dispose() {
    if (disposed)
      return
    disposed = true
    controller.abort()
    cancelAnimationFrame(raf)
    observer?.disconnect()
    controls?.dispose()
    document.removeEventListener('visibilitychange', onVisibility)
    release()
    renderer?.dispose()
    renderer?.domElement.remove()
    root?.clear()
  }

  // Initialization errors reach onError instead of escaping Vue's lifecycle.
  void (async () => {
    try {
      if (!host?.appendChild)
        throw new Error('A viewer host element is required')
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setClearColor(0x081219, 1)
      renderer.domElement.tabIndex = 0
      renderer.domElement.setAttribute('aria-label', '3×3 活塞门三维模型，拖动旋转，滚轮、双指或加减键缩放')
      renderer.domElement.addEventListener('keydown', handleZoomKey, { signal: controller.signal })
      host.appendChild(renderer.domElement)
      scene = new THREE.Scene()
      camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200)
      scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x687580, 2.6))
      const sun = new THREE.DirectionalLight(0xFFFFFF, 2.3)
      sun.position.set(-5, 10, 8)
      scene.add(sun)
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enablePan = false
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
      controls.addEventListener('change', schedule)
      observer = new ResizeObserver(resize)
      observer.observe(host)
      document.addEventListener('visibilitychange', onVisibility)
      let metadata = null
      let url = new URL(modelUrl, document.baseURI)
      if (/\.json$/i.test(url.pathname)) {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok)
          throw new Error(`模型数据加载失败（HTTP ${response.status}）`)
        metadata = await response.json()
        url = new URL(metadata.modelUrl, url)
      }
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok)
        throw new Error(`模型加载失败（HTTP ${response.status}）`)
      const bytes = await response.arrayBuffer()
      if (disposed)
        return
      const gltf = await loader.parseAsync(bytes, new URL('.', url).href)
      remember(gltf.scene)
      if (disposed) {
        release()
        return
      }
      root = gltf.scene
      playback = root.userData.playback || null
      duration = Math.max(1, Number(metadata?.duration || root.userData.duration) || 700)
      root.traverse((node) => {
        if (node.name.startsWith('frameblock_'))
          playbackNodes[Number(node.name.slice(11))] = node
        const state = node.userData.endpoint
        if (state === 'open' || state === 'closed')
          endpoints[state] = node
        const open = metadata?.frames?.open?.[node.name] || node.userData.openPosition
        const closed = metadata?.frames?.closed?.[node.name] || node.position.toArray()
        if (Array.isArray(open) && open.length === 3)
          tracks.push({ node, closed: new THREE.Vector3(...closed), open: new THREE.Vector3(...open) })
        if (node.isMesh)
          node.frustumCulled = false
        const materials = Array.isArray(node.material) ? node.material : [node.material]
        for (const material of materials) {
          if (material?.map) {
            // GLTFLoader disables mip generation for NEAREST-only GLB samplers.
            // Explicitly enable it before selecting mip filtering, and preserve
            // thin wire detail on oblique faces with anisotropic sampling.
            material.map.generateMipmaps = true
            material.map.magFilter = THREE.NearestFilter
            material.map.minFilter = THREE.NearestMipmapLinearFilter
            material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
            material.map.needsUpdate = true
          }
        }
      })
      if (endpoints.open)
        endpoints.open.visible = false
      scene.add(root)
      const box = new THREE.Box3().setFromObject(root)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const radius = Math.max(size.x, size.y, size.z, 1)
      applyPlayback()
      // Original 56-volume build is a one-block-wide X slice; view its Y/Z face.
      controls.target.copy(center)
      camera.position.copy(center).add(new THREE.Vector3(1.8, 0.72, 1.1).normalize().multiplyScalar(radius * 2.25))
      controls.minDistance = radius * 0.65
      controls.maxDistance = radius * 5
      camera.far = radius * 20
      controls.update()
      loaded = true
      resize()
      draw()
      schedule()
      onReady?.()
    }
    catch (error) {
      if (disposed || error?.name === 'AbortError')
        return
      dispose()
      onError?.(error)
    }
  })()
  return { dispose, setOpen }
}
