import * as THREE from 'three'
import { minecraftLightFieldUniforms, minecraftLightVertexCalculation, minecraftLightVertexDeclarations } from './minecraft-light-field-render.js'

// A shared daylight multiplier, not a Minecraft skylight/blocklight propagation map.
// Updated once per world frame; all static, instanced and replay block shaders use it.
export const minecraftBlockDaylight = { value: 1 }

export function setMinecraftBlockDaylight(daylight = 1) {
  const value = Number(daylight)
  minecraftBlockDaylight.value = 0.22 + 0.78 * THREE.MathUtils.clamp(Number.isFinite(value) ? value : 1, 0, 1)
}

export function minecraftFaceBrightness(x, y, z) {
  const lengthSquared = x * x + y * y + z * z
  if (!lengthSquared)
    return 1
  return (x * x * 0.6 + y * y * (y >= 0 ? 1 : 0.5) + z * z * 0.8) / lengthSquared
}

export function createMinecraftBlockMaterial(source, daylightUniform = minecraftBlockDaylight) {
  if (Array.isArray(source))
    return source.map(entry => createMinecraftBlockMaterial(entry, daylightUniform))
  if (!source?.isMaterial || source.isShaderMaterial || source.userData?.minecraftDirectionalMaterial)
    return source

  const material = new THREE.MeshBasicMaterial({
    name: source.name,
    color: source.color?.clone?.() || new THREE.Color(1, 1, 1),
    map: source.map || null,
    alphaMap: source.alphaMap || null,
    aoMap: source.aoMap || null,
    aoMapIntensity: source.aoMapIntensity ?? 1,
    lightMap: source.lightMap || null,
    lightMapIntensity: source.lightMapIntensity ?? 1,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    alphaTest: source.alphaTest,
    blending: source.blending,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    vertexColors: source.vertexColors,
    fog: true,
    toneMapped: false,
  })
  // Texture RGB is decoded by Three once. Alpha is linear data; never gamma-convert it.
  if (material.map && material.map.colorSpace !== THREE.SRGBColorSpace) {
    material.map.colorSpace = THREE.SRGBColorSpace
    material.map.needsUpdate = true
  }
  for (const key of ['premultipliedAlpha', 'dithering', 'visible', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'alphaHash', 'alphaToCoverage', 'blendSrc', 'blendDst', 'blendEquation', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'colorWrite']) {
    if (source[key] !== undefined)
      material[key] = source[key]
  }
  const emission = THREE.MathUtils.clamp(Math.max(source.emissive?.r || 0, source.emissive?.g || 0, source.emissive?.b || 0) * (source.emissiveIntensity ?? 1), 0, 1)
  material.userData = { ...source.userData, minecraftDirectionalMaterial: true, minecraftEmission: emission }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.minecraftDaylight = daylightUniform
    shader.uniforms.minecraftEmission = { value: emission }
    shader.uniforms.minecraftLightTexture = minecraftLightFieldUniforms.texture
    shader.uniforms.minecraftLightMin = minecraftLightFieldUniforms.min
    shader.uniforms.minecraftLightSize = minecraftLightFieldUniforms.size
    shader.uniforms.minecraftLightEnabled = daylightUniform === minecraftBlockDaylight ? minecraftLightFieldUniforms.enabled : { value: false }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
${minecraftLightVertexDeclarations}
varying vec3 vMinecraftWorldNormal;`)
    // Geometry carries model rotation; batching/instancing carries placement. Use
    // world axes, not view-space normals, so rotating the camera cannot relight a face.
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 minecraftNormal = normal;
#ifdef USE_BATCHING
minecraftNormal = mat3(batchingMatrix) * minecraftNormal;
#endif
#ifdef USE_INSTANCING
minecraftNormal = mat3(instanceMatrix) * minecraftNormal;
#endif
vMinecraftWorldNormal = normalize(mat3(modelMatrix) * minecraftNormal);
${minecraftLightVertexCalculation}`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vMinecraftWorldNormal;
uniform float minecraftDaylight;
uniform float minecraftEmission;
uniform bool minecraftLightEnabled;
varying vec3 vMinecraftFieldLight;
varying float vMinecraftAO;`)
    // Work on linear outgoing light before fog and the single output conversion.
    // Existing vertex tint/AO and alpha are left intact, no extra pow/gamma pass.
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `vec3 minecraftNormal = normalize(vMinecraftWorldNormal);
vec3 minecraftAxisWeights = minecraftNormal * minecraftNormal;
float minecraftShade = dot(minecraftAxisWeights, vec3(0.6, minecraftNormal.y >= 0.0 ? 1.0 : 0.5, 0.8));
if (minecraftLightEnabled) {
  outgoingLight *= vMinecraftFieldLight * minecraftShade * vMinecraftAO;
} else {
  outgoingLight *= max(minecraftEmission, minecraftShade * minecraftDaylight);
}
#include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => `minecraft-light-field-v2-emission-${emission}`
  return material
}
