// SkyDome Fragment Shader
// 双贴图混合天空球着色器

uniform sampler2D textureA;   // 当前时段贴图
uniform sampler2D textureB;   // 下一时段贴图
uniform float mixFactor;      // 混合因子 (0-1)

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  // 采样两个贴图
  vec4 colorA = texture2D(textureA, vUv);
  vec4 colorB = texture2D(textureB, vUv);

  // 平滑混合
  vec4 finalColor = mix(colorA, colorB, mixFactor);

  gl_FragColor = finalColor;
}
