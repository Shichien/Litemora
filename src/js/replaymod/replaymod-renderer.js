import { Cubane } from 'cubane'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { installCauldronModelFix } from '../world/terrain/cubane-cauldron-model-fix.js'
import { loadPreferredMinecraftResourcePack } from '../world/terrain/minecraft-resource-pack.js'
import { blockStateString } from './replaymod-playback.js'

const DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const AIR = /(?:^|:)(?:air|cave_air|void_air)$/
const PARTIAL = /stairs|slab|fence|wall|door|trapdoor|chest|hopper|cauldron|piston_head|moving_piston|leaves|glass|water|lava|ice|lantern|chain|bars|bed|carpet|snow|scaffolding|farmland|path|cactus|soul_sand|honey_block/
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))

// Draw only a bounded neighbourhood; the complete decoded state remains available
// when moving the camera or seeking. Models share geometry/materials across sections.
export class ReplayModRenderer {
  constructor(canvas, playback, { onStatus = () => {} } = {}) {
    this.playback = playback
    this.onStatus = onStatus
    this.destroyed = false
    this.radius = 48
    this.blockAliases = {}
    this.models = new Map()
    this.sectionMeshes = new Map()
    this.entityMeshes = new Map()
    this.entityModels = new Map()
    this.resources = new Set()
    this.missingModels = new Set()
    this.building = false
    this.rebuildRequested = false
    this.renderedBlocks = 0
    this.cameraCell = ''
    this.keys = new Set()
    this.scene = new THREE.Scene()
    this.scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x68704E, 2.5))
    const sun = new THREE.DirectionalLight(0xFFFFFF, 2.2)
    sun.position.set(40, 100, 70)
    this.scene.add(sun)
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.05, 1600)
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.maxDistance = 256
    this.controls.minDistance = 0.5
    this.controls.screenSpacePanning = true
    this.cubane = new Cubane()
    installCauldronModelFix(this.cubane)
    this.air = playback.replay.blockStates.map(state => AIR.test(state?.name || state || ''))
    this.opaque = playback.replay.blockStates.map(state => !AIR.test(state?.name || '') && state?.boundingBox === 'block' && !state.transparent && !PARTIAL.test(state.name))
    this.resizeObserver = new ResizeObserver(() => this.resize(canvas))
    this.resizeObserver.observe(canvas)
    canvas.tabIndex = 0
    this.onKeyDown = (event) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        this.keys.add(event.code)
        event.preventDefault()
      }
    }
    this.onKeyUp = event => this.keys.delete(event.code)
    this.onBlur = () => this.keys.clear()
    this.onPointer = () => canvas.focus({ preventScroll: true })
    canvas.addEventListener('keydown', this.onKeyDown)
    canvas.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('blur', this.onBlur)
    canvas.addEventListener('pointerdown', this.onPointer)
    this.canvas = canvas
  }

  async initialize() {
    this.onStatus('加载 Minecraft 资源包…')
    const pack = await loadPreferredMinecraftResourcePack()
    if (this.destroyed)
      return
    await this.cubane.loadResourcePack(pack.blob)
    if (this.destroyed) {
      this.cubane.dispose()
      return
    }
    const assets = this.cubane.getAssetLoader()
    if (!await assets.getResourceString('blockstates/grass.json') && await assets.getResourceString('blockstates/short_grass.json'))
      this.blockAliases['minecraft:grass'] = 'minecraft:short_grass'
    if (this.destroyed) {
      this.cubane.dispose()
      return
    }
    this.home()
    await this.sync()
    this.resize(this.canvas)
    this.draw(0)
    this.onStatus('')
  }

  resize(canvas) {
    if (this.destroyed)
      return
    const { width, height } = canvas.getBoundingClientRect()
    if (!width || !height)
      return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  home() {
    const initial = this.playback.camera || this.playback.replay.initialCamera
    if (initial) {
      const yaw = (initial.yaw || 0) * Math.PI / 180
      const pitch = (initial.pitch || 0) * Math.PI / 180
      this.camera.position.set(initial.x, initial.y + 1.62, initial.z)
      this.controls.target.copy(this.camera.position).add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(12))
    }
    else {
      const section = this.playback.sections.values().next().value
      const center = new THREE.Vector3((section?.x || 0) * 16 + 8, (section?.y || 0) * 16 + 8, (section?.z || 0) * 16 + 8)
      this.controls.target.copy(center)
      this.camera.position.copy(center).add(new THREE.Vector3(24, 24, 32))
    }
    this.controls.update()
    this.cameraCell = ''
  }

  track(object) {
    const collect = (resource) => {
      if (this.destroyed)
        resource.dispose?.()
      else
        this.resources.add(resource)
    }
    object.traverse((child) => {
      if (child.geometry)
        collect(child.geometry)
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        if (!material)
          continue
        collect(material)
        if (material.map)
          collect(material.map)
      }
    })
    return object
  }

  async blockModel(id) {
    if (!this.models.has(id)) {
      this.models.set(id, (async () => {
        const recordedState = this.playback.replay.blockStates[id]
        const state = blockStateString(this.blockAliases[recordedState.name] ? { ...recordedState, name: this.blockAliases[recordedState.name] } : recordedState)
        const model = this.track(await this.cubane.getBlockMesh(state))
        if (/fallback/.test(model.name))
          this.missingModels.add(state)
        const parts = []
        model.updateMatrixWorld(true)
        model.traverse((child) => {
          if (child.isMesh)
            parts.push({ geometry: child.geometry, material: child.material, matrix: child.matrixWorld.clone() })
        })
        return parts
      })().finally(() => {
        if (this.destroyed)
          this.cubane.dispose()
      }))
    }
    return this.models.get(id)
  }

  isVisible(section) {
    const focus = this.controls.target
    return Math.abs(section.x * 16 + 8 - focus.x) <= this.radius + 8
      && Math.abs(section.z * 16 + 8 - focus.z) <= this.radius + 8
      && Math.abs(section.y * 16 + 8 - focus.y) <= this.radius + 24
  }

  removeSection(key) {
    const group = this.sectionMeshes.get(key)
    if (!group)
      return
    this.renderedBlocks -= group.userData.blockCount
    this.scene.remove(group)
    group.traverse(child => child.isInstancedMesh && child.dispose())
    this.sectionMeshes.delete(key)
  }

  async buildSection(key, section) {
    const groups = new Map()
    const { states } = section
    const world = this.playback
    for (let index = 0; index < 4096; index++) {
      const id = states[index]
      if (this.air[id])
        continue
      const x = section.x * 16 + (index & 15)
      const y = section.y * 16 + (index >> 8)
      const z = section.z * 16 + ((index >> 4) & 15)
      if (DIRECTIONS.every(([dx, dy, dz]) => this.opaque[world.blockAt(x + dx, y + dy, z + dz)]))
        continue
      if (!groups.has(id))
        groups.set(id, [])
      groups.get(id).push([x + 0.5, y + 0.5, z + 0.5])
    }
    const entries = [...groups]
    const templates = await Promise.all(entries.map(([id]) => this.blockModel(id)))
    if (this.destroyed || world.sections.get(key) !== section) {
      world.dirtySections.add(key)
      return
    }
    this.removeSection(key)
    const group = new THREE.Group()
    const positionMatrix = new THREE.Matrix4()
    let count = 0
    for (let index = 0; index < entries.length; index++) {
      const positions = entries[index][1]
      count += positions.length
      for (const part of templates[index]) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, positions.length)
        for (let i = 0; i < positions.length; i++) {
          positionMatrix.makeTranslation(...positions[i]).multiply(part.matrix)
          mesh.setMatrixAt(i, positionMatrix)
        }
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
        group.add(mesh)
      }
    }
    group.userData.blockCount = count
    this.renderedBlocks += count
    this.scene.add(group)
    this.sectionMeshes.set(key, group)
  }

  async sync() {
    if (this.destroyed)
      return
    if (this.building) {
      this.rebuildRequested = true
      return
    }
    this.building = true
    try {
      do {
        this.rebuildRequested = false
        const cell = `${Math.floor(this.controls.target.x / 16)},${Math.floor(this.controls.target.y / 16)},${Math.floor(this.controls.target.z / 16)}`
        const changedView = cell !== this.cameraCell
        this.cameraCell = cell
        for (const key of this.sectionMeshes.keys()) {
          const section = this.playback.sections.get(key)
          if (!section || !this.isVisible(section))
            this.removeSection(key)
        }
        const dirty = new Set(this.playback.dirtySections)
        this.playback.dirtySections.clear()
        if (changedView) {
          for (const key of this.playback.sections.keys())
            dirty.add(key)
        }
        let built = 0
        const pending = [...dirty].map(key => [key, this.playback.sections.get(key)]).filter(([, section]) => section && this.isVisible(section)).sort(([, a], [, b]) => this.distance(a) - this.distance(b))
        for (const [key, section] of pending) {
          if (this.destroyed)
            return
          await this.buildSection(key, section)
          if (++built % 4 === 0) {
            this.onStatus(`构建录像场景 ${built} / ${pending.length}`)
            await nextFrame()
          }
        }
      } while (this.rebuildRequested && !this.destroyed)
    }
    finally {
      this.building = false
      if (!this.destroyed)
        this.onStatus('')
    }
  }

  distance(section) {
    return (section.x * 16 + 8 - this.controls.target.x) ** 2 + (section.y * 16 + 8 - this.controls.target.y) ** 2 + (section.z * 16 + 8 - this.controls.target.z) ** 2
  }

  async entityModel(entity) {
    const type = String(entity.type || 'unknown').replace(/^minecraft:/, '')
    const itemName = entity.item?.name?.replace(/^minecraft:/, '')
    const key = type === 'item' ? `item:${itemName || 'unknown'}` : type === 'falling_block' ? `${type}:${entity.data}` : type
    if (!this.entityModels.has(key)) {
      this.entityModels.set(key, (async () => {
        let model
        if (type === 'item' && itemName) {
          const blob = await this.cubane.getAssetLoader().getResourceBlob(`textures/item/${itemName}.png`)
          if (blob) {
            const url = URL.createObjectURL(blob)
            try {
              const texture = await new THREE.TextureLoader().loadAsync(url)
              texture.magFilter = texture.minFilter = THREE.NearestFilter
              texture.colorSpace = THREE.SRGBColorSpace
              model = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }))
            }
            finally { URL.revokeObjectURL(url) }
          }
          else {
            model = await this.cubane.getBlockMesh(`minecraft:${itemName}`)
            model.scale.setScalar(0.25)
          }
        }
        else if (type === 'falling_block' || type === 'tnt') {
          model = await this.cubane.getBlockMesh(type === 'tnt' ? 'minecraft:tnt' : blockStateString(this.playback.replay.blockStates[entity.data]))
        }
        else if (type !== 'item') {
          model = await this.cubane.getEntityRenderer().createEntityMesh(type === 'player' ? 'player' : type)
        }
        if (!model) {
          this.missingModels.add(type)
          model = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0xFFB74D, wireframe: true }))
        }
        this.track(model)
        const bounds = new THREE.Box3().setFromObject(model)
        const group = new THREE.Group()
        model.position.y -= bounds.min.y
        group.add(model)
        return group
      })().finally(() => {
        if (this.destroyed)
          this.cubane.dispose()
      }))
    }
    return { key, model: await this.entityModels.get(key) }
  }

  entityVisible(entity) {
    const focus = this.controls.target
    return Math.abs(entity.x - focus.x) <= this.radius && Math.abs(entity.z - focus.z) <= this.radius && Math.abs(entity.y - focus.y) <= this.radius + 16
  }

  syncEntities() {
    for (const [id, record] of this.entityMeshes) {
      const entity = this.playback.entities.get(id)
      if (!entity || !this.entityVisible(entity)) {
        this.scene.remove(record.group)
        this.entityMeshes.delete(id)
      }
    }
    for (const [id, entity] of this.playback.entities) {
      if (!this.entityVisible(entity))
        continue
      const signature = `${entity.spawnedAt}:${entity.type}:${entity.item?.name || ''}:${entity.data || 0}`
      let record = this.entityMeshes.get(id)
      if (!record || record.signature !== signature) {
        if (record)
          this.scene.remove(record.group)
        record = { signature, group: new THREE.Group() }
        this.entityMeshes.set(id, record)
        this.scene.add(record.group)
        const current = record
        this.entityModel(entity).then(({ model }) => {
          if (!this.destroyed && this.entityMeshes.get(id) === current)
            current.group.add(model.clone(true))
        }).catch((error) => {
          if (!this.destroyed)
            this.onStatus(`实体模型载入失败：${error.message}`)
        })
      }
      record.group.position.set(entity.x, entity.y, entity.z)
      record.group.rotation.y = -(entity.yaw || 0) * Math.PI / 180
      record.group.visible = id !== this.playback.replay.metadata.playerEntityId || this.camera.position.distanceTo(record.group.position) > 2
      if (entity.type === 'minecraft:item')
        record.group.lookAt(this.camera.position)
    }
  }

  draw(deltaSeconds) {
    if (this.destroyed)
      return
    if (this.keys.size) {
      const forward = this.camera.getWorldDirection(new THREE.Vector3())
      const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize()
      const movement = new THREE.Vector3()
      if (this.keys.has('KeyW'))
        movement.add(forward)
      if (this.keys.has('KeyS'))
        movement.sub(forward)
      if (this.keys.has('KeyD'))
        movement.add(right)
      if (this.keys.has('KeyA'))
        movement.sub(right)
      if (this.keys.has('KeyE'))
        movement.y++
      if (this.keys.has('KeyQ'))
        movement.y--
      movement.normalize().multiplyScalar(deltaSeconds * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 45 : 12))
      this.camera.position.add(movement)
      this.controls.target.add(movement)
    }
    this.controls.update()
    this.syncEntities()
    this.cubane.updateAnimations()
    this.renderer.render(this.scene, this.camera)
  }

  capture() {
    this.draw(0)
    const thumbnail = document.createElement('canvas')
    thumbnail.width = 640
    thumbnail.height = 360
    thumbnail.getContext('2d').drawImage(this.canvas, 0, 0, 640, 360)
    return thumbnail.toDataURL('image/webp', 0.82)
  }

  dispose() {
    if (this.destroyed)
      return
    this.destroyed = true
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('keydown', this.onKeyDown)
    this.canvas.removeEventListener('keyup', this.onKeyUp)
    this.canvas.removeEventListener('blur', this.onBlur)
    this.canvas.removeEventListener('pointerdown', this.onPointer)
    this.controls.dispose()
    for (const key of this.sectionMeshes.keys())
      this.removeSection(key)
    this.scene.clear()
    for (const resource of this.resources)
      resource.dispose?.()
    this.resources.clear()
    this.cubane.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
