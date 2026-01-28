// SkyDome Vertex Shader
// 用于天空球的顶点着色器

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;

  // 计算世界坐标用于可能的渐变效果
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
