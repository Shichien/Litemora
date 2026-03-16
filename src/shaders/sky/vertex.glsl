// SkyDome Vertex Shader
// 用于天空球的顶点着色器

varying vec3 vSkyDirection;

void main() {
  vSkyDirection = normalize(position);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
