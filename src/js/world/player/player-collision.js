import * as THREE from 'three'
import Experience from '../../experience.js'

// Same separation tolerance as Minecraft's VoxelShape.collide.
const EPSILON = 1e-7
const FULL_BLOCK = [[0, 0, 0, 1, 1, 1]]

function overlaps(a, b, axis) {
  return a.max[axis] > b.min[axis] + EPSILON && a.min[axis] < b.max[axis] - EPSILON
}

function clipAxis(body, shapes, axis, sideA, sideB, distance) {
  if (distance === 0) {
    return 0
  }
  for (const { box } of shapes) {
    if (!overlaps(body, box, sideA) || !overlaps(body, box, sideB)) {
      continue
    }
    if (distance > 0 && body.max[axis] <= box.min[axis] + EPSILON) {
      distance = Math.min(distance, Math.max(0, box.min[axis] - body.max[axis]))
    }
    else if (distance < 0 && body.min[axis] >= box.max[axis] - EPSILON) {
      distance = Math.max(distance, Math.min(0, box.max[axis] - body.min[axis]))
    }
  }
  body.min[axis] += distance
  body.max[axis] += distance
  return distance
}

// Entity.collideWithShapes: land first, then move along the larger horizontal component.
function clipMovement(bounds, movement, shapes, floorY) {
  const body = bounds.clone()
  const downLimit = Math.min(0, floorY - body.min.y)
  const y = clipAxis(body, shapes, 'y', 'x', 'z', Math.max(movement.y, downLimit))
  let x, z
  if (Math.abs(movement.x) < Math.abs(movement.z)) {
    z = clipAxis(body, shapes, 'z', 'x', 'y', movement.z)
    x = clipAxis(body, shapes, 'x', 'y', 'z', movement.x)
  }
  else {
    x = clipAxis(body, shapes, 'x', 'y', 'z', movement.x)
    z = clipAxis(body, shapes, 'z', 'x', 'y', movement.z)
  }
  return new THREE.Vector3(x, y, z)
}

function worldBox(x, y, z, shape) {
  if (!Array.isArray(shape)) {
    return new THREE.Box3(
      new THREE.Vector3(shape.minX, shape.minY, shape.minZ),
      new THREE.Vector3(shape.maxX, shape.maxY, shape.maxZ),
    )
  }
  const [x0, y0, z0, x1, y1, z1] = shape
  return new THREE.Box3(
    new THREE.Vector3(x - 0.5 + x0, y - 0.5 + y0, z - 0.5 + z0),
    new THREE.Vector3(x - 0.5 + x1, y - 0.5 + y1, z - 0.5 + z1),
  )
}

export default class PlayerCollisionSystem {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.debug = this.experience.debug

    // 调试开关与统计
    this.params = {
      showCandidates: true,
      showContacts: true,
    }
    this.stats = {
      candidateCount: 0,
      collisionCount: 0,
    }

    // 调试辅助对象池
    this._candidateHelpers = []
    this._contactHelpers = []
    this._candidateIndex = 0
    this._contactIndex = 0

    this._boxGeometry = new THREE.BoxGeometry(1, 1, 1)
    this._boxEdges = new THREE.EdgesGeometry(this._boxGeometry)
    this._candidateMaterial = new THREE.LineBasicMaterial({ color: 0xFF0000 })
    this._contactMaterial = new THREE.MeshBasicMaterial({
      color: 0x00FFFF,
      wireframe: true,
    })
    this._contactGeometry = new THREE.SphereGeometry(0.05, 8, 8)
  }

  /**
   * 每帧开始重置索引与统计
   * - 调试辅助对象重新从池首开始使用
   * - 碰撞计数清零
   */
  prepareFrame() {
    this._candidateIndex = 0
    this._contactIndex = 0
    this.stats.candidateCount = 0
    this.stats.collisionCount = 0
  }

  // Blocks are centred on integer coordinates. Include neighbouring cells for
  // shapes extending outside their own block, e.g. fences and piston heads.
  collectShapes(area, provider) {
    if (!provider?.getBlockWorld) {
      return []
    }
    const positions = []
    const min = area.min.clone().addScalar(0.5 - EPSILON).floor().addScalar(-1)
    const max = area.max.clone().addScalar(0.5 + EPSILON).floor().addScalar(1)
    for (let x = min.x; x <= max.x; x++) {
      for (let y = min.y; y <= max.y; y++) {
        for (let z = min.z; z <= max.z; z++) {
          positions.push({ x, y, z })
        }
      }
    }
    const records = provider.getBlocksWorld
      ? provider.getBlocksWorld(positions)
      : positions.map(({ x, y, z }) => provider.getBlockWorld(x, y, z))
    const shapes = []
    for (const [i, block] of records.entries()) {
      if (!(block?.hasCollision ?? block?.id)) {
        continue
      }
      const { x, y, z } = positions[i]
      for (const shape of block.collisionBoxes ?? FULL_BLOCK) {
        const box = worldBox(x, y, z, shape)
        if (area.intersectsBox(box)) {
          shapes.push({ box, block, x, y, z })
        }
      }
    }
    return shapes
  }

  playerBounds(feet, { radius, height }) {
    return new THREE.Box3(
      new THREE.Vector3(feet.x - radius, feet.y, feet.z - radius),
      new THREE.Vector3(feet.x + radius, feet.y + height, feet.z + radius),
    )
  }

  canOccupy(bounds, provider) {
    return this.collectShapes(bounds.clone().expandByScalar(-EPSILON), provider).length === 0
  }

  // Find the top face supporting the feet. Prefer the nearest block centre if
  // multiple blocks share that face, as in CollisionGetter.findSupportingBlock.
  supportingBlock(bounds, shapes, maxDrop = EPSILON) {
    let support = null
    let highest = -Infinity
    let nearest = Infinity
    const x = (bounds.min.x + bounds.max.x) / 2
    const z = (bounds.min.z + bounds.max.z) / 2
    for (const shape of shapes) {
      const { box } = shape
      const drop = bounds.min.y - box.max.y
      if (drop < -EPSILON || drop > maxDrop + EPSILON || !overlaps(bounds, box, 'x') || !overlaps(bounds, box, 'z')) {
        continue
      }
      const distance = (shape.x - x) ** 2 + (shape.y - bounds.min.y) ** 2 + (shape.z - z) ** 2
      if (box.max.y > highest || (box.max.y === highest && distance < nearest)) {
        support = shape.block
        highest = box.max.y
        nearest = distance
      }
    }
    return support
  }

  // Player.maybeBackOffFromEdge reduces each unsupported component in 0.05-block increments.
  backOffEdge(bounds, movement, shapes, maxDrop, floorY) {
    if (bounds.min.y - floorY <= maxDrop) {
      return
    }
    const probe = bounds.clone()
    const supported = (x, z) => {
      probe.copy(bounds)
      probe.min.x += x
      probe.max.x += x
      probe.min.z += z
      probe.max.z += z
      return this.supportingBlock(probe, shapes, maxDrop)
    }
    const reduce = value => Math.sign(value) * Math.max(0, Math.abs(value) - 0.05)
    while (movement.x && !supported(movement.x, 0)) movement.x = reduce(movement.x)
    while (movement.z && !supported(0, movement.z)) movement.z = reduce(movement.z)
    while (movement.x && movement.z && !supported(movement.x, movement.z)) {
      movement.x = reduce(movement.x)
      movement.z = reduce(movement.z)
    }
  }

  resolveMovement(bounds, movement, shapes, grounded, stepHeight, floorY) {
    const clipped = clipMovement(bounds, movement, shapes, floorY)
    const landed = movement.y < 0 && clipped.y !== movement.y
    if ((!grounded && !landed) || (clipped.x === movement.x && clipped.z === movement.z) || stepHeight <= 0) {
      return clipped
    }

    // Entity.collide: try actual shape heights from lowest to highest, starting
    // at the landing surface. A step must give more horizontal travel.
    const start = bounds.clone()
    const baseOffset = landed ? clipped.y : 0
    start.min.y += baseOffset
    start.max.y += baseOffset
    const heights = new Set()
    for (const { box } of shapes) {
      for (const y of [box.min.y, box.max.y]) {
        const height = y - start.min.y
        if (height >= 0 && height <= stepHeight && height !== clipped.y)
          heights.add(height)
      }
    }
    const flatDistance = clipped.x ** 2 + clipped.z ** 2
    for (const height of [...heights].sort((a, b) => a - b)) {
      const step = clipMovement(start, new THREE.Vector3(movement.x, height, movement.z), shapes, floorY)
      if (step.x ** 2 + step.z ** 2 > flatDistance) {
        step.y += baseOffset
        return step
      }
    }
    return clipped
  }

  finishFrame(bounds, shapes, movement, clipped) {
    this.stats.candidateCount = shapes.length
    this.stats.collisionCount = Number(movement.x !== clipped.x) + Number(movement.y !== clipped.y) + Number(movement.z !== clipped.z)
    if (!this.debug.active) {
      return
    }
    const center = bounds.getCenter(new THREE.Vector3())
    for (const { box } of shapes) {
      if (this.params.showCandidates) {
        const helper = this._candidateHelpers[this._candidateIndex++] || this._createCandidateHelper()
        box.getCenter(helper.position)
        box.getSize(helper.scale)
        helper.visible = true
      }
      if (this.params.showContacts && box.intersectsBox(bounds)) {
        this._addContactHelper(box.clampPoint(center, new THREE.Vector3()))
      }
    }
    this._finalizeHelpers()
  }

  /**
   * 创建或复用候选方块线框
   * @returns {THREE.LineSegments} 候选方块辅助对象
   */
  _createCandidateHelper() {
    const mesh = new THREE.LineSegments(this._boxEdges, this._candidateMaterial)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    this._candidateHelpers.push(mesh)
    return mesh
  }

  /**
   * 调试：接触点
   * @param {THREE.Vector3} position 接触点世界坐标
   */
  _addContactHelper(position) {
    const helper = this._contactHelpers[this._contactIndex] || this._createContactHelper()
    helper.position.copy(position)
    helper.visible = true
    this._contactIndex++
  }

  /**
   * 创建或复用接触点球体
   * @returns {THREE.Mesh} 接触点辅助对象
   */
  _createContactHelper() {
    const mesh = new THREE.Mesh(this._contactGeometry, this._contactMaterial)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    this._contactHelpers.push(mesh)
    return mesh
  }

  /**
   * 收尾：隐藏未使用的 helper
   */
  _finalizeHelpers() {
    for (let i = this._candidateIndex; i < this._candidateHelpers.length; i++) {
      this._candidateHelpers[i].visible = false
    }
    for (let i = this._contactIndex; i < this._contactHelpers.length; i++) {
      this._contactHelpers[i].visible = false
    }
  }
}
