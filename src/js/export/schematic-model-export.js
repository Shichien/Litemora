import * as THREE from 'three'

// Budget the expanded snapshot AND exporter working buffers before allocating them.
const MAX_TRIANGLES = 500_000
const MAX_MESHES = 20_000
const MAX_BYTES = 256 * 1024 * 1024
const MAX_TEXTURE_PIXELS = 16 * 1024 * 1024
const ATTRIBUTE_SIZES = { position: [3], normal: [3], uv: [2], uv1: [2], uv2: [2], uv3: [2], color: [3, 4], tangent: [4] }

function fail(message) {
  throw new Error(message)
}

function localMatrix(object) {
  return object.matrixAutoUpdate
    ? new THREE.Matrix4().compose(object.position, object.quaternion, object.scale)
    : object.matrix.clone()
}

function isHelper(object) {
  return object.isHelper || object.type?.endsWith('Helper')
    || object.userData?.isHelper || object.userData?.isHighlight
    || object.userData?.excludeFromExport
}

function finiteMatrix(matrix) {
  if (!matrix.elements.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-20)
    fail('模型包含无效或退化的变换，无法导出。')
}

function geometryAttributes(geometry) {
  if (!geometry?.isBufferGeometry || !geometry.attributes.position)
    fail('模型缺少有效的顶点几何数据。')
  const attributes = Object.entries(ATTRIBUTE_SIZES)
    .filter(([name]) => geometry.attributes[name])
    .map(([name, sizes]) => {
      const attribute = geometry.attributes[name]
      if (!sizes.includes(attribute.itemSize) || !Number.isSafeInteger(attribute.count)
        || attribute.count < 0 || !(attribute.array || attribute.data?.array)) {
        fail(`模型的 ${name} 顶点属性无效。`)
      }
      return [name, attribute]
    })
  if (geometry.index && (geometry.index.itemSize !== 1 || !geometry.index.array))
    fail('模型的三角形索引无效。')
  return attributes
}

/**
 * Pure with respect to the source: never updates its matrices, bounds or resources.
 * Includes root's local transform and descendants, but never its parent/background.
 * Returns {scene, meshCount, triangleCount, dispose}; caller owns the snapshot.
 * Texture objects are cloned; immutable image pixels are shared (never disposed).
 */
export function prepareExportScene(root, { scale = 1 } = {}) {
  if (!root?.isObject3D)
    fail('没有可导出的投影模型，请先加载投影。')
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1e6)
    fail('导出比例必须是大于 0 且不超过 1000000 的有限数字。')

  const descriptors = []
  let triangleCount = 0
  let estimatedBytes = 0
  let texturePixels = 0
  const seenTextures = new Set()
  function inspectMaterial(material) {
    const candidates = [...Object.values(material), ...Object.values(material.uniforms || {}).map(u => u?.value)]
    for (const texture of candidates) {
      if (!texture?.isTexture || seenTextures.has(texture))
        continue
      seenTextures.add(texture)
      const image = texture.image
      const pixels = (image?.width || 0) * (image?.height || 0)
      if (!Number.isFinite(pixels) || pixels > MAX_TEXTURE_PIXELS)
        fail('模型纹理过大，请降低资源包纹理分辨率后再导出。')
      texturePixels += pixels
      if (texturePixels * 16 + estimatedBytes > MAX_BYTES)
        fail('模型纹理占用过大，请降低纹理分辨率后再导出。')
    }
  }
  function add(mesh, matrix, instanceColor, range) {
    finiteMatrix(matrix)
    if (mesh.isSkinnedMesh || Object.keys(mesh.geometry?.morphAttributes || {}).length)
      fail('暂不支持带骨骼或形变动画的模型导出。')
    const geometry = mesh.geometry
    const attributes = geometryAttributes(geometry)
    const total = geometry.index?.count ?? geometry.attributes.position.count
    if (!Number.isSafeInteger(total) || total < 0)
      fail('模型顶点数量无效。')
    const start = range?.start ?? geometry.drawRange.start
    const count = range?.count ?? geometry.drawRange.count
    if (!Number.isSafeInteger(start) || start < 0 || !(count === Infinity || (Number.isSafeInteger(count) && count >= 0)))
      fail('模型的几何绘制范围无效。')
    const end = Math.min(total, start + count)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups = Array.isArray(mesh.material)
      ? geometry.groups
      : [{ start, count: end - start, materialIndex: 0 }]
    const spans = []
    let vertices = 0
    for (const group of groups) {
      const material = materials[group.materialIndex]
      if (!material || material.visible === false)
        continue
      if (!Number.isSafeInteger(group.start) || group.start < 0 || !Number.isSafeInteger(group.count) || group.count < 0)
        fail('模型的材质分组范围无效。')
      const from = Math.max(start, group.start)
      const to = Math.min(end, group.start + group.count)
      if (to <= from)
        continue
      if ((to - from) % 3 !== 0)
        fail('模型包含不完整的三角形。')
      spans.push({ start: from, count: to - from, material })
      vertices += to - from
      inspectMaterial(material)
    }
    if (!vertices)
      return
    triangleCount += vertices / 3
    // Conservative allowance includes OBJ strings, GLB buffers and geometry copies.
    estimatedBytes += vertices * (attributes.reduce((sum, [, a]) => sum + a.itemSize * 4, 0) + 128)
    if (triangleCount > MAX_TRIANGLES || estimatedBytes + texturePixels * 16 > MAX_BYTES || descriptors.length >= MAX_MESHES)
      fail('模型过大，导出会占用过多内存；请缩小投影范围后重试。')
    descriptors.push({ mesh, matrix, instanceColor, attributes, spans, vertices })
  }
  function visit(object, parentMatrix) {
    if (object.visible === false || isHelper(object))
      return
    const matrix = parentMatrix.clone().multiply(localMatrix(object))
    if (object.isBatchedMesh) {
      // Three r176 exposes ranges/matrices but no public iterator for active IDs.
      // instanceCount is NOT the largest ID when instances have been deleted.
      if (!Array.isArray(object._instanceInfo) || !object.getGeometryRangeAt)
        fail('当前批次网格版本不支持安全导出。')
      if (object._instanceInfo.length > 1_000_000)
        fail('批次实例过多，请缩小投影范围。')
      for (let id = 0; id < object._instanceInfo.length; id++) {
        if (!object._instanceInfo[id].active || !object.getVisibleAt(id))
          continue
        const transform = object.getMatrixAt(id, new THREE.Matrix4())
        const color = object._colorsTexture ? object.getColorAt(id, new THREE.Color()) : null
        add(object, matrix.clone().multiply(transform), color, object.getGeometryRangeAt(object.getGeometryIdAt(id)))
      }
    }
    else if (object.isInstancedMesh) {
      if (!Number.isSafeInteger(object.count) || object.count < 0 || object.count > MAX_MESHES
        || object.count > object.instanceMatrix.count) {
        fail('实例数量无效或过多，请缩小投影范围。')
      }
      for (let id = 0; id < object.count; id++) {
        const transform = new THREE.Matrix4()
        object.getMatrixAt(id, transform)
        const color = object.instanceColor ? new THREE.Color().fromBufferAttribute(object.instanceColor, id) : null
        add(object, matrix.clone().multiply(transform), color)
      }
    }
    else if (object.isMesh) {
      add(object, matrix, null)
    }
    for (const child of object.children)
      visit(child, matrix)
  }
  visit(root, new THREE.Matrix4())
  if (!descriptors.length)
    fail('投影中没有可导出的可见网格。')

  const scene = new THREE.Scene()
  const geometries = new Set()
  const materials = new Set()
  const textures = new Map()
  const materialCache = new Map()
  let disposed = false
  function dispose() {
    if (disposed)
      return
    disposed = true
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    for (const texture of textures.values()) texture.dispose()
    scene.clear()
  }
  function copyTexture(texture) {
    if (!texture?.isTexture)
      return null
    if (!textures.has(texture)) {
      // Texture.clone() shares Source and increments its version in copy().
      // Give the copy its own Source so even source upload state stays untouched.
      const copy = new texture.constructor()
      textures.set(texture, copy)
      copy.copy({ ...texture, source: new THREE.Source(texture.image) })
    }
    return textures.get(texture)
  }
  function copyMaterial(source, hasColors, instanceColor) {
    const key = `${source.uuid}:${hasColors}:${instanceColor?.toArray().join(',') || ''}`
    if (materialCache.has(key))
      return materialCache.get(key)
    const uniform = name => source.uniforms?.[name]?.value
    // Minecraft's onBeforeCompile material keeps these standard fields intact.
    // Lighting uniforms are deliberately not baked into the portable PBR material.
    const material = new THREE.MeshStandardMaterial()
    materials.add(material)
    material.name = source.name
    const color = source.color || uniform('diffuse') || uniform('color')
    if (color?.isColor)
      material.color.copy(color)
    if (instanceColor)
      material.color.multiply(instanceColor)
    for (const property of ['opacity', 'transparent', 'alphaTest', 'side', 'depthWrite', 'roughness', 'metalness', 'emissiveIntensity', 'aoMapIntensity', 'lightMapIntensity']) {
      if (source[property] !== undefined)
        material[property] = source[property]
    }
    if (source.roughness === undefined)
      material.roughness = 1
    if (source.metalness === undefined)
      material.metalness = 0
    if (source.emissive?.isColor)
      material.emissive.copy(source.emissive)
    else if (source.userData?.minecraftEmission)
      material.emissive.copy(material.color).multiplyScalar(source.userData.minecraftEmission)
    material.vertexColors = hasColors && source.vertexColors !== false
    for (const property of ['map', 'alphaMap', 'aoMap', 'lightMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'])
      material[property] = copyTexture(source[property] || uniform(property))
    material.map ||= copyTexture(uniform('tDiffuse'))
    if (source.normalScale)
      material.normalScale.copy(source.normalScale)
    materialCache.set(key, material)
    return material
  }
  try {
    const bounds = new THREE.Box3()
    for (const descriptor of descriptors) {
      const { mesh, matrix, instanceColor, attributes, spans, vertices } = descriptor
      const geometry = new THREE.BufferGeometry()
      geometries.add(geometry)
      const mirrored = matrix.determinant() < 0
      for (const [name, source] of attributes) {
        const values = new Float32Array(vertices * source.itemSize)
        let offset = 0
        for (const span of spans) {
          for (let j = 0; j < span.count; j++) {
            // Baking a reflection requires reversing triangle winding as well.
            const triangleOffset = mirrored && j % 3 !== 0 ? (j % 3 === 1 ? 1 : -1) : 0
            const element = span.start + j + triangleOffset
            const index = mesh.geometry.index ? mesh.geometry.index.getX(element) : element
            if (!Number.isSafeInteger(index) || index < 0 || index >= source.count)
              fail('模型包含越界的顶点索引。')
            for (let component = 0; component < source.itemSize; component++) {
              const value = source.getComponent(index, component)
              if (!Number.isFinite(value))
                fail('模型包含非有限的顶点数据。')
              values[offset++] = value
            }
          }
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, source.itemSize))
      }
      geometry.applyMatrix4(matrix)
      if (mirrored && geometry.attributes.tangent) {
        const tangent = geometry.attributes.tangent
        for (let i = 0; i < tangent.count; i++) tangent.setW(i, -tangent.getW(i))
      }
      if (!geometry.attributes.normal)
        geometry.computeVertexNormals()
      geometry.computeBoundingBox()
      if (![...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray()].every(Number.isFinite))
        fail('模型变换后的坐标超出有效范围。')
      bounds.union(geometry.boundingBox)
      let offset = 0
      const copiedMaterials = spans.map((span, index) => {
        geometry.addGroup(offset, span.count, index)
        offset += span.count
        return copyMaterial(span.material, Boolean(geometry.attributes.color), instanceColor)
      })
      const copy = new THREE.Mesh(geometry, copiedMaterials.length === 1 ? copiedMaterials[0] : copiedMaterials)
      copy.name = (mesh.name || `mesh_${scene.children.length + 1}`).replace(/[\r\n]/g, '_')
      scene.add(copy)
    }
    const center = bounds.getCenter(new THREE.Vector3())
    const normalization = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z))
    for (const mesh of scene.children) {
      mesh.geometry.applyMatrix4(normalization)
      mesh.geometry.computeBoundingBox()
      if (![...mesh.geometry.boundingBox.min.toArray(), ...mesh.geometry.boundingBox.max.toArray()].every(Number.isFinite))
        fail('导出比例导致模型坐标超出有效范围。')
    }
    scene.updateMatrixWorld(true)
    return { scene, meshCount: scene.children.length, triangleCount, dispose }
  }
  catch (error) {
    dispose()
    throw error
  }
}

const CONVERT_PY = `"""Run: blender --background --python convert.py -- model.glb output.blend"""
import sys
from pathlib import Path
import bpy

base = Path(__file__).resolve().parent
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) > 2:
    raise SystemExit("Usage: blender --background --python convert.py -- model.glb output.blend")
source = Path(args[0]).expanduser().resolve() if args else base / "model.glb"
target = Path(args[1]).expanduser().resolve() if len(args) > 1 else source.with_suffix(".blend")
if not source.is_file():
    raise FileNotFoundError(source)
if target.suffix.lower() != ".blend":
    raise ValueError("Output must have a .blend extension")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(target))
print("Saved Blender project:", target)
`

const BLENDER_README = `这是 Blender 转换包，浏览器没有生成 .blend 文件。

包内 model.glb 包含几何、UV、材质及纹理（Y 轴向上）。
请安装 Blender 3.6 或更新版本，解压 ZIP 后运行：

blender --background --python convert.py -- model.glb output.blend

不带 -- 参数时，脚本默认读取脚本同目录的 model.glb，保存为同目录 model.blend：
blender --background --python convert.py

convert.py 会清空 Blender 场景，通过 bpy.ops.import_scene.gltf 导入真实 GLB，
再调用 bpy.ops.wm.save_as_mainfile 写入真正的 Blender 工程。已有输出文件会被覆盖。
Minecraft 实时光照着色器已转换为标准 PBR 材质；动态光照与动画不包含在快照中。
模型已在 X/Z 方向居中、底部 Y=0；一个方块的边长为所选导出比例。
`

function safeName(name) {
  // Control characters must not escape into downloaded filenames.
  // eslint-disable-next-line no-control-regex
  const result = String(name || 'schematic').replace(/\.(?:litematic|schem|schematic|stl|obj|glb|blend|zip)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/[. ]+$/g, '').slice(0, 120)
  return result || 'schematic'
}

/** Export only loadedSchematic.group. STL uses Z-up, OBJ/GLB use Y-up. */
export async function exportSchematicModel(root, { format, name = 'schematic', scale = 1 } = {}) {
  if (!['stl', 'obj', 'glb', 'blender'].includes(format))
    fail('不支持的模型格式，请选择 STL、OBJ、GLB 或 Blender 转换包。')
  // Snapshot BEFORE the first await, so editing/unloading during imports is safe.
  const snapshot = prepareExportScene(root, { scale })
  try {
    const filename = safeName(name)
    if (format === 'stl') {
      const { STLExporter } = await import('three/addons/exporters/STLExporter.js')
      snapshot.scene.rotation.x = Math.PI / 2
      snapshot.scene.updateMatrixWorld(true)
      return { blob: new Blob([new STLExporter().parse(snapshot.scene, { binary: true })], { type: 'model/stl' }), filename: `${filename}.stl` }
    }
    if (format === 'obj') {
      const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js')
      return { blob: new Blob([new OBJExporter().parse(snapshot.scene)], { type: 'text/plain;charset=utf-8' }), filename: `${filename}.obj` }
    }
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
    const glb = await new GLTFExporter().parseAsync(snapshot.scene, { binary: true, onlyVisible: true, maxTextureSize: 4096 })
    if (format === 'glb')
      return { blob: new Blob([glb], { type: 'model/gltf-binary' }), filename: `${filename}.glb` }
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('model.glb', glb)
    zip.file('convert.py', CONVERT_PY)
    zip.file('README.txt', BLENDER_README)
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    return { blob: new Blob([bytes], { type: 'application/zip' }), filename: `${filename}-blender.zip` }
  }
  catch (error) {
    throw new Error(`模型导出失败：${error?.message || '未知错误，请缩小模型或检查纹理后重试。'}`, { cause: error })
  }
  finally {
    snapshot.dispose()
  }
}
