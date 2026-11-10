import gsap from 'gsap'
import * as THREE from 'three'

import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'
import { resolveBlockTextureUrl } from '../world/terrain/block-texture-files.js'
import { blocks as blocksConfig } from '../world/terrain/blocks-config.js'

/**
 * ItemPickupAnimator
 * - Listens to 'game:block-break-complete' event
 * - Creates a temporary mini-block at the break position
 * - Animates it flying toward the player
 * - Emits 'hud:add-item' when animation completes
 */
export default class ItemPickupAnimator {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    // Animation parameters (debug-tunable)
    this.params = {
      duration: 0.2,
      startScale: 0.3,
      endScale: 0.1,
      ease: 'power2.in',
      targetOffsetY: 0.1, // Fly toward player chest height
    }

    // Active animations tracking
    this.activeItems = []

    // textureKey -> THREE.Texture, so each PNG is fetched at most once
    this._textureCache = new Map()
    // textureKey -> Promise<THREE.Texture|null>, dedupes concurrent loads
    this._texturePromises = new Map()
    this._textureLoader = new THREE.TextureLoader()

    // Bind and listen to block break event
    this._onBlockBreakComplete = this._onBlockBreakComplete.bind(this)
    emitter.on('game:block-break-complete', this._onBlockBreakComplete)

    // Debug setup
    if (this.experience.debug?.active) {
      this.debugInit()
    }
  }

  /**
   * Handle block break complete event
   * @param {{ blockId: number, worldPos: { x, y, z } }} data
   */
  _onBlockBreakComplete({ blockId, worldPos, source, suppressPickup = false }) {
    if (suppressPickup || source === 'minecraft-schematic' || blockId === null || blockId === undefined || blockId === blocksConfig.empty.id) {
      return
    }

    // Get block config
    const blockConfig = this._getBlockConfigById(blockId)
    if (!blockConfig) {
      // Still add item even if we can't show animation
      emitter.emit('hud:add-item', { blockId, amount: 1 })
      return
    }

    // Texture loading is async; don't block the event chain on it.
    this._spawnPickup(blockConfig, blockId, worldPos)
  }

  /**
   * Build and animate the mini-block, falling back to a plain add event.
   *
   * Never throws and never rejects: every failure path ends in exactly one
   * `hud:add-item` emission, so the item is granted exactly once.
   *
   * @param {object} blockConfig Entry from blocks-config.js
   * @param {number} blockId Block id being picked up
   * @param {{ x: number, y: number, z: number }} worldPos Corner-based block coords
   */
  async _spawnPickup(blockConfig, blockId, worldPos) {
    let mesh = null
    try {
      mesh = await this._createMiniBlock(blockConfig, worldPos)
    }
    catch {
      mesh = null
    }

    if (!mesh) {
      emitter.emit('hud:add-item', { blockId, amount: 1 })
      return
    }

    try {
      this._animatePickup(mesh, blockId)
    }
    catch {
      // Animation setup failed after the mesh existed; still grant the item.
      this._cleanupItem(mesh, blockId)
    }
  }

  /**
   * Attach the mesh to the scene and fly it toward the player.
   *
   * @param {THREE.Mesh} mesh Mini-block mesh
   * @param {number} blockId Block id being picked up
   */
  _animatePickup(mesh, blockId) {
    this.scene.add(mesh)
    this.activeItems.push({ mesh, blockId })

    // Get player position for target
    const player = this.experience.world?.player
    if (!player) {
      this._cleanupItem(mesh, blockId)
      return
    }

    const playerPos = player.getPosition()
    const targetPos = {
      x: playerPos.x,
      y: playerPos.y + this.params.targetOffsetY,
      z: playerPos.z,
    }

    // Animate: scale down + fly to player
    gsap.to(mesh.scale, {
      x: this.params.endScale,
      y: this.params.endScale,
      z: this.params.endScale,
      duration: this.params.duration,
      ease: this.params.ease,
    })

    gsap.to(mesh.position, {
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z,
      duration: this.params.duration,
      ease: this.params.ease,
      onComplete: () => {
        this._cleanupItem(mesh, blockId)
      },
    })
  }

  /**
   * Get block config by ID
   */
  _getBlockConfigById(blockId) {
    for (const key of Object.keys(blocksConfig)) {
      if (blocksConfig[key].id === blockId) {
        return blocksConfig[key]
      }
    }
    return null
  }

  /**
   * Load a block texture from the bundled default pack.
   *
   * Results (including failures) are cached per texture key so a given PNG is
   * fetched at most once for the whole session. Never throws: a rejected load
   * resolves to null and the caller falls back to the plain `hud:add-item`
   * event.
   *
   * @param {string} key Texture key from blocks-config.js
   * @returns {Promise<THREE.Texture | null>} The texture, or null when unknown or failed.
   */
  _loadTexture(key) {
    if (!key)
      return Promise.resolve(null)

    const cached = this._textureCache.get(key)
    if (cached)
      return Promise.resolve(cached)

    // A null in the cache means "this key already failed"; don't retry it.
    if (this._textureCache.has(key))
      return Promise.resolve(null)

    const pending = this._texturePromises.get(key)
    if (pending)
      return pending

    const url = resolveBlockTextureUrl(key)
    if (!url)
      return Promise.resolve(null)

    const promise = new Promise((resolve) => {
      this._textureLoader.load(
        url,
        (texture) => {
          // Pixel-art pipeline: nearest filtering, no mipmaps, sRGB.
          texture.magFilter = THREE.NearestFilter
          texture.minFilter = THREE.NearestFilter
          texture.generateMipmaps = false
          texture.wrapS = THREE.ClampToEdgeWrapping
          texture.wrapT = THREE.ClampToEdgeWrapping
          texture.colorSpace = THREE.SRGBColorSpace
          texture.needsUpdate = true

          this._textureCache.set(key, texture)
          this._texturePromises.delete(key)
          resolve(texture)
        },
        undefined,
        () => {
          // Remember the failure so we never hammer a missing file.
          this._textureCache.set(key, null)
          this._texturePromises.delete(key)
          resolve(null)
        },
      )
    })

    this._texturePromises.set(key, promise)
    return promise
  }

  /**
   * Create a temporary mini BoxGeometry mesh with block texture.
   *
   * Resolves to null when any required texture is unavailable, which keeps the
   * caller on the `hud:add-item` fallback path instead of throwing.
   *
   * @param {object} blockConfig Entry from blocks-config.js
   * @param {{ x: number, y: number, z: number }} worldPos Corner-based block coords
   * @returns {Promise<THREE.Mesh | null>} The mini-block mesh, or null when textures are missing.
   */
  async _createMiniBlock(blockConfig, worldPos) {
    const textureKeys = blockConfig?.textureKeys

    if (!textureKeys)
      return null

    // Six-face texture block (has side, top, bottom)
    const hasFaces = Boolean(textureKeys.side && textureKeys.top && textureKeys.bottom)
    const requiredKeys = hasFaces
      ? [textureKeys.side, textureKeys.top, textureKeys.bottom]
      : [textureKeys.all]

    if (requiredKeys.some(key => !key))
      return null

    let textures
    try {
      textures = await Promise.all(requiredKeys.map(key => this._loadTexture(key)))
    }
    catch {
      return null
    }

    if (textures.some(texture => !texture))
      return null

    const makeMaterial = texture => new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
      // Unlit, unfogged, untouched by ACES tone mapping: same as the atlas
      // materials built by the schematic renderer, so colours match the world.
      fog: false,
      toneMapped: false,
    })

    const geometry = new THREE.BoxGeometry(1, 1, 1)

    let materials
    if (hasFaces) {
      const [sideTex, topTex, bottomTex] = textures
      // BoxGeometry face order: right, left, top, bottom, front, back
      materials = [
        makeMaterial(sideTex), // right
        makeMaterial(sideTex), // left
        makeMaterial(topTex), // top
        makeMaterial(bottomTex), // bottom
        makeMaterial(sideTex), // front
        makeMaterial(sideTex), // back
      ]
    }
    else {
      materials = makeMaterial(textures[0])
    }

    const mesh = new THREE.Mesh(geometry, materials)

    // Position at block center (offset by 0.5 since block coords are corner-based)
    mesh.position.set(
      worldPos.x + 0.5,
      worldPos.y + 0.5,
      worldPos.z + 0.5,
    )

    // Start at initial scale
    mesh.scale.setScalar(this.params.startScale)

    return mesh
  }

  /**
   * Cleanup animated item and emit add event
   */
  _cleanupItem(mesh, blockId) {
    // Remove from scene
    this.scene.remove(mesh)

    // Dispose resources
    mesh.geometry.dispose()

    // Handle both single material and material array
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(mat => mat.dispose())
    }
    else {
      mesh.material.dispose()
    }

    // Remove from tracking
    const index = this.activeItems.findIndex(item => item.mesh === mesh)
    if (index !== -1) {
      this.activeItems.splice(index, 1)
    }

    // Emit add item event
    emitter.emit('hud:add-item', { blockId, amount: 1 })
  }

  /**
   * Debug panel
   */
  debugInit() {
    this.debugFolder = this.experience.debug.ui.addFolder({
      title: 'Item Pickup Animator',
      expanded: false,
    })

    this.debugFolder.addBinding(this.params, 'duration', {
      label: 'Duration (s)',
      min: 0.1,
      max: 2.0,
      step: 0.1,
    })

    this.debugFolder.addBinding(this.params, 'startScale', {
      label: 'Start Scale',
      min: 0.1,
      max: 1.0,
      step: 0.1,
    })

    this.debugFolder.addBinding(this.params, 'endScale', {
      label: 'End Scale',
      min: 0.05,
      max: 0.5,
      step: 0.05,
    })

    this.debugFolder.addBinding(this.params, 'targetOffsetY', {
      label: 'Target Offset Y',
      min: 0,
      max: 2,
      step: 0.1,
    })
  }

  /**
   * Destroy
   */
  destroy() {
    emitter.off('game:block-break-complete', this._onBlockBreakComplete)

    // Cleanup any active items
    for (const item of this.activeItems) {
      this.scene.remove(item.mesh)
      item.mesh.geometry.dispose()
      const material = item.mesh.material
      if (Array.isArray(material)) {
        material.forEach(mat => mat.dispose())
      }
      else {
        material.dispose()
      }
    }
    this.activeItems = []

    // Release cached textures
    for (const texture of this._textureCache.values()) {
      texture?.dispose()
    }
    this._textureCache.clear()
    this._texturePromises.clear()
  }
}
