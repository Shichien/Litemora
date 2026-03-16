uniform vec3 zenithDayColor;
uniform vec3 horizonDayColor;
uniform vec3 zenithNightColor;
uniform vec3 horizonNightColor;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform vec3 sunColor;
uniform vec3 moonColor;
uniform float dayFactor;
uniform float twilightFactor;
uniform float starsStrength;
uniform float sunDiscSize;
uniform float sunGlowSize;
uniform float moonDiscSize;
uniform float moonGlowSize;

varying vec3 vSkyDirection;

const float PI = 3.14159265359;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float starField(vec3 dir) {
  vec2 uv = vec2(
    atan(dir.z, dir.x) / (2.0 * PI) + 0.5,
    asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5
  );

  vec2 grid = uv * vec2(420.0, 210.0);
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  float seed = hash21(cell);
  float mask = step(0.9972, seed);
  vec2 starOffset = vec2(hash21(cell + 13.2), hash21(cell + 41.7)) - 0.5;
  float dist = length(local - starOffset * 0.55);
  float star = smoothstep(0.08, 0.0, dist) * mask;
  return star * (0.45 + fract(seed * 91.37));
}

void main() {
  vec3 dir = normalize(vSkyDirection);
  float altitude = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  float skyMix = smoothstep(0.0, 0.85, altitude);

  vec3 daySky = mix(horizonDayColor, zenithDayColor, skyMix);
  vec3 nightSky = mix(horizonNightColor, zenithNightColor, pow(skyMix, 0.9));
  vec3 sky = mix(nightSky, daySky, clamp(dayFactor, 0.0, 1.0));

  float horizonGlow = (1.0 - smoothstep(-0.18, 0.18, dir.y)) * twilightFactor;
  sky += sunColor * horizonGlow * 0.14;

  float sunDot = max(dot(dir, normalize(sunDirection)), 0.0);
  float sunCore = smoothstep(1.0 - sunDiscSize, 1.0 - sunDiscSize * 0.2, sunDot);
  float sunGlow = smoothstep(1.0 - sunGlowSize, 1.0 - sunDiscSize, sunDot);
  sky += sunColor * (sunCore * 1.55 + sunGlow * 0.32) * mix(0.2, 1.0, dayFactor);

  float moonDot = max(dot(dir, normalize(moonDirection)), 0.0);
  float moonCore = smoothstep(1.0 - moonDiscSize, 1.0 - moonDiscSize * 0.25, moonDot);
  float moonGlow = smoothstep(1.0 - moonGlowSize, 1.0 - moonDiscSize, moonDot);
  sky += moonColor * (moonCore * 0.9 + moonGlow * 0.18) * (1.0 - dayFactor);

  float stars = starField(dir) * starsStrength;
  sky += vec3(stars);

  gl_FragColor = vec4(sky, 1.0);
}
