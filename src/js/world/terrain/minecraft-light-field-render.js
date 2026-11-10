import * as THREE from 'three'

const emptyTexture = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1)
emptyTexture.format = THREE.RGBAFormat
emptyTexture.type = THREE.UnsignedByteType
emptyTexture.minFilter = emptyTexture.magFilter = THREE.NearestFilter
emptyTexture.unpackAlignment = 1
emptyTexture.needsUpdate = true
export const minecraftLightFieldUniforms = {
  texture: { value: emptyTexture },
  min: { value: new THREE.Vector3() },
  size: { value: new THREE.Vector3(1, 1, 1) },
  enabled: { value: false },
}

/** RGBA bytes: sky 0..15, block 0..15, AO opacity 0..255, emission 0..15. */
export function setMinecraftLightField(field) {
  const uniforms = minecraftLightFieldUniforms
  if (!field) {
    uniforms.enabled.value = false
    if (uniforms.texture.value !== emptyTexture)
      uniforms.texture.value.dispose()
    uniforms.texture.value = emptyTexture
    uniforms.min.value.set(0, 0, 0)
    uniforms.size.value.set(1, 1, 1)
    return
  }
  const { data, min, size } = field
  const dims = Array.isArray(size) ? size : [size?.x, size?.y, size?.z]
  const origin = Array.isArray(min) ? min : [min?.x, min?.y, min?.z]
  if (!dims.every(n => Number.isSafeInteger(n) && n > 0)
    || !origin.every(Number.isFinite) || !(data instanceof Uint8Array)
    || data.length !== dims[0] * dims[1] * dims[2] * 4) {
    uniforms.enabled.value = false
    throw new TypeError('Invalid Minecraft RGBA light field')
  }
  let texture = uniforms.texture.value
  if (texture === emptyTexture || texture.image.width !== dims[0] || texture.image.height !== dims[1] || texture.image.depth !== dims[2]) {
    if (texture !== emptyTexture)
      texture.dispose()
    texture = new THREE.Data3DTexture(data, ...dims)
    texture.format = THREE.RGBAFormat
    texture.type = THREE.UnsignedByteType
    texture.minFilter = texture.magFilter = THREE.NearestFilter
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping
    texture.unpackAlignment = 1
    texture.generateMipmaps = false
    texture.colorSpace = THREE.NoColorSpace
    uniforms.texture.value = texture
  }
  else {
    texture.image.data = data
  }
  texture.needsUpdate = true
  uniforms.min.value.set(...origin)
  uniforms.size.value.set(...dims)
  uniforms.enabled.value = true
}

export function minecraftLightCurve(level) {
  const value = THREE.MathUtils.clamp(Number(level) / 15, 0, 1)
  return value / (4 - 3 * value)
}

/** CPU reference for shader's independent sky/block channels (linear RGB). */
export function minecraftLightChannels(sky, block, daylight = 1, emission = 0) {
  const skyLight = minecraftLightCurve(sky) * THREE.MathUtils.clamp(daylight, 0, 1)
  const blockLight = minecraftLightCurve(Math.max(block, emission))
  return [Math.max(0.015, skyLight, blockLight), Math.max(0.015, skyLight, blockLight * 0.9), Math.max(0.015, skyLight, blockLight * 0.75)]
}

/** Opaque neighbors only: transparent glass must supply opacity zero. */
export function minecraftCornerAO(side1, side2, corner, center = 0) {
  const opacity = value => THREE.MathUtils.clamp(Number(value), 0, 1)
  const a = opacity(side1)
  const b = opacity(side2)
  const diagonal = a >= 0.5 && b >= 0.5 ? a : opacity(corner)
  return ((1 - 0.8 * a) + (1 - 0.8 * b) + (1 - 0.8 * diagonal) + (1 - 0.8 * opacity(center))) / 4
}

export function minecraftMeanLight(center, side1, side2, corner) {
  return (center + (side1 || center) + (side2 || center) + (corner || center)) / 4
}

export function interpolateMinecraftCorners(corners, u, v) {
  const x = THREE.MathUtils.clamp(u, 0, 1)
  const y = THREE.MathUtils.clamp(v, 0, 1)
  return corners[0] * (1 - x) * (1 - y) + corners[1] * x * (1 - y) + corners[2] * x * y + corners[3] * (1 - x) * y
}

export function minecraftFaceCornerAO(center, normal, sampleOpacity) {
  const n = new THREE.Vector3(...normal)
  const axis = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2
  const face = [0, 0, 0]
  face[axis] = normal[axis] >= 0 ? 1 : -1
  const u = (axis + 1) % 3
  const v = (axis + 2) % 3
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
    const base = center.map((x, i) => x + face[i])
    const a = [...base]
    a[u] += su
    const b = [...base]
    b[v] += sv
    const c = [...a]
    c[v] += sv
    return minecraftCornerAO(sampleOpacity(...a), sampleOpacity(...b), sampleOpacity(...c), sampleOpacity(...base))
  })
}

/**
 * Return a private geometry with a mesh-local integer-block-center attribute.
 * matrix maps mesh local units (including WASM Int16 scale) into world units.
 * Dynamic template: call AFTER local model transforms with blockCenter=(0,0,0).
 * Custom attributes are not transformed by BufferGeometry.applyMatrix4.
 */
export function prepareMinecraftLightGeometry(geometry, { blockCenter, matrix = new THREE.Matrix4() } = {}) {
  if (!geometry?.getAttribute('position'))
    throw new TypeError('Missing light geometry positions')
  const result = geometry.clone()
  const position = result.getAttribute('position')
  const centers = new Float32Array(position.count * 3)
  if (blockCenter) {
    const value = Array.isArray(blockCenter) ? blockCenter : [blockCenter.x, blockCenter.y, blockCenter.z]
    for (let i = 0; i < position.count; i++) centers.set(value, i * 3)
  }
  else {
    const inverse = matrix.clone().invert()
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)
    const normal = result.getAttribute('normal')
    const index = result.getIndex()
    const count = index?.count ?? position.count
    const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k)
      ids.forEach((id, k) => vertices[k].fromBufferAttribute(position, id).applyMatrix4(matrix))
      const n = normal
        ? new THREE.Vector3().fromBufferAttribute(normal, ids[0]).applyMatrix3(normalMatrix).normalize()
        : vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize()
      const center = vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1 / 3).addScaledVector(n, -0.001)
      center.set(Math.floor(center.x + 0.5), Math.floor(center.y + 0.5), Math.floor(center.z + 0.5)).applyMatrix4(inverse)
      for (const id of ids) center.toArray(centers, id * 3)
    }
  }
  result.setAttribute('mcBlockCenter', new THREE.Float32BufferAttribute(centers, 3))
  return result
}

export const minecraftLightVertexDeclarations = `
attribute vec3 mcBlockCenter;
uniform highp sampler3D minecraftLightTexture;
uniform vec3 minecraftLightMin;
uniform vec3 minecraftLightSize;
uniform bool minecraftLightEnabled;
uniform float minecraftDaylight;
varying vec3 vMinecraftFieldLight;
varying float vMinecraftAO;
vec4 mcField(vec3 cell) {
  vec3 p = floor(cell + 0.5) - minecraftLightMin;
  if (any(lessThan(p, vec3(0.0))) || any(greaterThanEqual(p, minecraftLightSize))) return vec4(0.0);
  return texture(minecraftLightTexture, (p + 0.5) / minecraftLightSize) * 255.0;
}
float mcCurve(float value) { float l = clamp(value / 15.0, 0.0, 1.0); return l / (4.0 - 3.0 * l); }
vec3 mcCorner(vec3 base, vec3 u, vec3 v) {
  vec4 c=mcField(base); vec4 a=mcField(base+u); vec4 b=mcField(base+v); vec4 d=mcField(base+u+v);
  if (a.b >= 127.5 && b.b >= 127.5) d=a;
  float ao=1.0-0.8*(c.b+a.b+b.b+d.b)/(4.0*255.0);
  vec2 center=c.rg;
  vec2 av=vec2(a.r>0.0?a.r:center.r,a.g>0.0?a.g:center.g);
  vec2 bv=vec2(b.r>0.0?b.r:center.r,b.g>0.0?b.g:center.g);
  vec2 dv=vec2(d.r>0.0?d.r:center.r,d.g>0.0?d.g:center.g);
  return vec3((center+av+bv+dv)*0.25,ao);
}
`

export const minecraftLightVertexCalculation = `
vMinecraftFieldLight = vec3(1.0);
vMinecraftAO = 1.0;
if (minecraftLightEnabled) {
  vec4 mcCenter = vec4(mcBlockCenter, 1.0);
  vec4 mcVertex = vec4(position, 1.0);
  #ifdef USE_BATCHING
    mcCenter = batchingMatrix * mcCenter; mcVertex = batchingMatrix * mcVertex;
  #endif
  #ifdef USE_INSTANCING
    mcCenter = instanceMatrix * mcCenter; mcVertex = instanceMatrix * mcVertex;
  #endif
  vec3 owner = floor((modelMatrix * mcCenter).xyz + 0.5);
  vec3 worldVertex = (modelMatrix * mcVertex).xyz;
  vec3 absN = abs(vMinecraftWorldNormal);
  vec3 face; vec3 tangentU; vec3 tangentV;
  if (absN.x >= absN.y && absN.x >= absN.z) {
    face = vec3(sign(vMinecraftWorldNormal.x),0.0,0.0); tangentU=vec3(0.0,1.0,0.0); tangentV=vec3(0.0,0.0,1.0);
  } else if (absN.y >= absN.z) {
    face=vec3(0.0,sign(vMinecraftWorldNormal.y),0.0); tangentU=vec3(0.0,0.0,1.0); tangentV=vec3(1.0,0.0,0.0);
  } else {
    face=vec3(0.0,0.0,sign(vMinecraftWorldNormal.z)); tangentU=vec3(1.0,0.0,0.0); tangentV=vec3(0.0,1.0,0.0);
  }
  vec3 delta = worldVertex - owner;
  vec2 uv=clamp(vec2(dot(delta,tangentU),dot(delta,tangentV))+0.5,0.0,1.0);
  vec3 base=owner+face;
  vec3 c00=mcCorner(base,-tangentU,-tangentV);
  vec3 c10=mcCorner(base,tangentU,-tangentV);
  vec3 c11=mcCorner(base,tangentU,tangentV);
  vec3 c01=mcCorner(base,-tangentU,tangentV);
  vec3 interpolated=mix(mix(c00,c10,uv.x),mix(c01,c11,uv.x),uv.y);
  vMinecraftAO=interpolated.z;
  // Block owner emission lights the emitting surface, including opaque lamps.
  vec4 own=mcField(owner);
  float sky=interpolated.x;
  float block=max(interpolated.y,own.a);
  float skyLight=mcCurve(sky)*minecraftDaylight;
  float blockLight=mcCurve(block);
  vMinecraftFieldLight=max(vec3(0.015),max(vec3(skyLight),vec3(1.0,0.9,0.75)*blockLight));
}
`
