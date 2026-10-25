import * as THREE from "three";
import { SHIP } from "./constants.js";

/* ══════════════════════════════════════════════════════════════
   海面 / 尾迹
   ------------------------------------------------------------------
   · 4000 × 4000 m 水面，y = 0，中心随舰体原点；单 draw call。
   · 顶点网格向中心加密（近船处 ~2–4 m，边缘 ~38 m），因此
     “只有船体附近是可见清晰的”，远处交给雾与地平线渐隐。
   · 泡沫是一块 620 × 1000 m 的透明面片，几何顶点使用与水面
     完全相同的波形函数，因此贴合波面，不与水面穿插/闪烁。
   · 全部为 ShaderMaterial，无画布贴图，Node 内可安全 import。
   ══════════════════════════════════════════════════════════════ */

const SEA_SIZE = 4000;
const SEA_SEGMENTS = 160;
const SEA_WARP = 1.55;

const FOAM_WIDTH = 620;
const FOAM_DEPTH = 1000;
const FOAM_CENTER_Z = SHIP.sternZ - 12; // 面片中心：覆盖舰艏破浪 → 舰艉远尾迹
const FOAM_SEGMENTS_X = 60;
const FOAM_SEGMENTS_Z = 96;
const FOAM_LIFT = 0.12;

const PALETTE = {
  deep: 0x061a24,
  shallow: 0x0d3341,
  horizon: 0x050b10, // 与 scene.fog 同色，保证远处无接缝
  sky: 0x0c2330,
  spec: 0x9fe6f4,
  glint: 0x3f9aad,
  foam: 0x93b7c4,
  foamCore: 0xd4e8ee,
};

/* ── 共享 GLSL ────────────────────────────────────────────── */

/**
 * 多组方向波：水面与泡沫共用同一段代码，
 * 保证两者高度场逐点一致（不会出现泡沫悬空/穿水）。
 */
const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWaveStrength;

float waveTerm(vec2 p, vec2 dir, float wavelength, float amplitude, float speed, inout vec2 slope) {
  float k = 6.28318530718 / wavelength;
  float phase = dot(p, dir) * k + uTime * speed;
  slope += dir * (amplitude * k * cos(phase));
  return amplitude * sin(phase);
}

// 6 个八度的涌浪叠加：高度 + 解析梯度
float seaWave(vec2 p, out vec2 slope) {
  vec2 s = vec2(0.0);
  float h = 0.0;
  h += waveTerm(p, vec2(0.920, 0.392), 900.0, 0.200, 0.13, s); // 长涌
  h += waveTerm(p, vec2(0.860, 0.510), 340.0, 0.300, 0.30, s);
  h += waveTerm(p, vec2(0.700, -0.714), 210.0, 0.170, 0.44, s);
  h += waveTerm(p, vec2(0.514, 0.858), 132.0, 0.100, 0.62, s);
  h += waveTerm(p, vec2(-0.316, 0.949), 86.0, 0.055, 0.80, s);
  h += waveTerm(p, vec2(0.970, -0.243), 58.0, 0.028, 0.98, s);
  slope = s * uWaveStrength;
  return h * uWaveStrength;
}
`;

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y * 143.71);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm3(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += valueNoise(p) * amp;
    p = p * 2.07 + vec2(11.3, 7.1);
    amp *= 0.5;
  }
  return v;
}
`;

/** 雾只衰减 alpha，避免透明体被雾色“抬亮” */
const FOG_ALPHA_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  alpha *= 1.0 - fogFactor;
#endif
`;

/* ── 水面着色器 ───────────────────────────────────────────── */

const WATER_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;

${WAVE_GLSL}

#include <fog_pars_vertex>

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 slope;
  float height = seaWave(worldPosition.xz, slope);
  worldPosition.y += height;

  vWorldPos = worldPosition.xyz;
  vWaveHeight = height;
  vWaveNormal = normalize(vec3(-slope.x, 1.0, -slope.y));

  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uHorizonColor;
uniform vec3 uSkyTint;
uniform vec3 uSpecColor;
uniform vec3 uGlintColor;
uniform vec3 uSunDirection;
uniform float uTime;
uniform float uRippleStrength;
uniform float uHorizonStart;
uniform float uHorizonEnd;
uniform float uGridStrength;
uniform float uOpacity;

varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;

#include <fog_pars_fragment>

${NOISE_GLSL}

void main() {
  vec3 toCamera = cameraPosition - vWorldPos;
  float dist = length(toCamera);
  vec3 V = toCamera / max(dist, 0.001);

  // 远处收掉细碎涟漪，避免高频闪烁
  float nearFade = 1.0 - smoothstep(200.0, 1050.0, dist);

  // 片元法线扰动：高度场 fbm 的有限差分（远处直接跳过，省一半以上像素开销）
  vec2 ripple = vec2(0.0);
  if (nearFade > 0.012) {
    vec2 q = vWorldPos.xz * 0.032 + vec2(0.0, -uTime * 0.06);
    float e = 1.2;
    float base = fbm3(q);
    float dx = fbm3(q + vec2(e, 0.0)) - base;
    float dz = fbm3(q + vec2(0.0, e)) - base;
    ripple = vec2(dx, dz) / e;
  }

  vec3 N = normalize(vWaveNormal + vec3(-ripple.x, 0.0, -ripple.y) * (uRippleStrength * nearFade));

  vec3 L = normalize(uSunDirection);
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float spec = pow(ndh, 110.0) * 0.55 + pow(ndh, 24.0) * 0.075;

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 4.0);

  // 垂向波浪高度 → 深浅水色
  float depthMix = clamp(vWaveHeight * 1.1 + 0.5, 0.0, 1.0);
  vec3 color = mix(uDeepColor, uShallowColor, depthMix * 0.55);
  // 掠射角反射天光
  color = mix(color, uSkyTint, fres * 0.4);
  color += uSpecColor * spec;
  // 极少量青色碎光（稀疏，避免整面“数码雪花”）
  float sparkle = pow(valueNoise(vWorldPos.xz * 0.085 + vec2(uTime * 0.03, -uTime * 0.07)), 11.0);
  color += uGlintColor * sparkle * 0.12 * nearFade;

  // 50 m 参考网格（可选工作台刻度；uGridStrength 默认 0，需要时再打开）
  vec2 gridQ = abs(fract(vWorldPos.xz / 50.0) - 0.5);
  float gridLine = smoothstep(0.474, 0.5, max(gridQ.x, gridQ.y));
  color += uGlintColor * gridLine * uGridStrength * (1.0 - smoothstep(300.0, 780.0, dist));

  // 地平线渐隐（即使关闭 scene.fog 也不会看到面片边缘）
  float horizon = smoothstep(uHorizonStart, uHorizonEnd, dist);
  color = mix(color, uHorizonColor, horizon);

  gl_FragColor = vec4(color, uOpacity);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/* ── 泡沫 / 尾迹着色器 ────────────────────────────────────── */

const FOAM_VERT = /* glsl */ `
varying vec3 vWorldPos;

${WAVE_GLSL}

#include <fog_pars_vertex>

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 slope;
  worldPosition.y += seaWave(worldPosition.xz, slope);

  vWorldPos = worldPosition.xyz;

  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const FOAM_FRAG = /* glsl */ `
uniform vec3 uFoamColor;
uniform vec3 uFoamCoreColor;
uniform float uFoamOpacity;
uniform float uFoamScale;
uniform float uBowZ;
uniform float uSternZ;
uniform float uHalfBeam;
uniform vec2 uFoamCenter;
uniform vec2 uFoamHalf;
uniform float uTime;

varying vec3 vWorldPos;

#include <fog_pars_fragment>

${NOISE_GLSL}

float gauss(float x, float s) {
  float t = x / s;
  return exp(-t * t);
}

// 船体水线半宽包络：舰艏尖端 0 → 舯部 uHalfBeam → 舰艉 ~0.62
float hullHalfAt(float z) {
  float u = clamp((z - uBowZ) / (uSternZ - uBowZ), 0.0, 1.0);
  float bow = smoothstep(0.0, 0.34, u);
  float stern = mix(1.0, 0.62, smoothstep(0.70, 1.0, u));
  return uHalfBeam * pow(bow, 0.62) * stern;
}

void main() {
  // p.x = 世界 X，p.y = 世界 Z（舰艏 -Z / 舰艉 +Z）
  vec2 p = vWorldPos.xz;
  float hb = hullHalfAt(p.y);
  float side = abs(p.x) - hb;

  // 双层噪声：大尺度翻涌斑块 + 中尺度蕾丝
  vec2 q1 = p * (0.020 * uFoamScale) + vec2(0.0, -uTime * 0.045);
  vec2 q2 = p * (0.075 * uFoamScale) + vec2(uTime * 0.02, -uTime * 0.16);
  float grain = fbm3(q1);
  float fine = fbm3(q2);
  float noise = mix(grain, fine, 0.35);

  // 1) 舷侧贴体泡沫 + 外洗白沫
  float inHullZ = smoothstep(uBowZ - 4.0, uBowZ + 18.0, p.y) * (1.0 - smoothstep(uSternZ - 12.0, uSternZ + 8.0, p.y));
  float collar = gauss(side, 2.2);
  float wash = gauss(max(side, 0.0), 7.0) * step(0.0, side) * 0.55;
  float sideFoam = (collar + wash * 0.5) * inHullZ;

  // 2) 舰艏破浪：艏柱处的小白团 + 沿两舷向后扩散的白沫堆
  float aftBow = p.y - uBowZ;
  float aftClamped = max(aftBow, 0.0);
  float bowSpread = hb + 3.0 + aftClamped * 0.20;
  float bowBand = gauss(abs(p.x) - bowSpread, 5.0 + aftClamped * 0.10);
  float bowFade = smoothstep(-10.0, 22.0, aftBow) * exp(-aftClamped / 140.0);
  float stem = gauss(p.x, 13.0) * gauss(aftBow + 5.0, 8.0);
  float bowFoam = bowBand * bowFade + stem;

  // 3) 开尔文尾迹两臂：约 19° 自舰艏向舰艉张开
  float arms = 0.0;
  if (aftBow > 26.0) {
    float centre = 3.0 + aftBow * 0.335;
    float band = 4.0 + aftBow * 0.05;
    arms = gauss(abs(p.x) - centre, band) * smoothstep(26.0, 80.0, aftBow) * exp(-aftBow / 820.0);
  }

  // 4) 舰艉翻涌区 + 推进器尾流
  vec2 sternUv = vec2(p.x / (uHalfBeam * 1.25), (p.y - (uSternZ + 55.0)) / 170.0);
  float ellipse = 1.0 - length(sternUv);
  float churn = smoothstep(0.0, 0.55, ellipse) * 0.58;
  float prop = gauss(p.x, 15.0) * smoothstep(uSternZ - 20.0, uSternZ + 40.0, p.y) * exp(-max(0.0, p.y - uSternZ - 40.0) / 220.0);

  // 沿 Z 拉长的细碎泡沫条纹：打散尾迹的“喷枪感”，让边缘呈泡沫质感
  float streak = fbm3(vec2(p.x * 0.085, p.y * 0.028) + vec2(uTime * 0.01, -uTime * 0.14));
  float breakup = 0.32 + 1.15 * streak;
  float density = (sideFoam + bowFoam + arms) * breakup + churn * (0.55 + 0.75 * streak) + prop * 0.4;

  // 噪声软溶解：不做硬阈值，避免远看像“抖动噪点”
  float shaped = density * (0.35 + noise * 1.25);
  float mask = smoothstep(0.04, 0.52, shaped);

  // 面片边缘淡出，避免看到矩形边界
  vec2 rel = (p - uFoamCenter) / uFoamHalf;
  float border = (1.0 - smoothstep(0.84, 1.0, abs(rel.x))) * (1.0 - smoothstep(0.84, 1.0, abs(rel.y)));

  float pulse = 0.92 + 0.08 * sin(uTime * 1.3 + p.y * 0.035);
  float alpha = mask * border * uFoamOpacity * pulse * (0.45 + 0.55 * noise);

  ${FOG_ALPHA_GLSL}

  if (alpha < 0.004) discard;

  vec3 color = mix(uFoamColor, uFoamCoreColor, clamp(sideFoam * 0.7 + stem * 0.6 + churn * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(color, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ── 几何工具 ─────────────────────────────────────────────── */

function warpAxis(value, half, power) {
  if (value === 0) return 0;
  return Math.sign(value) * Math.pow(Math.abs(value) / half, power) * half;
}

/** 4000 × 4000 水面，顶点向中心（船体附近）加密 */
function createWaterGeometry() {
  const geometry = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, SEA_SEGMENTS, SEA_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const half = SEA_SIZE / 2;
  for (let i = 0; i < position.count; i++) {
    position.setX(i, warpAxis(position.getX(i), half, SEA_WARP));
    position.setZ(i, warpAxis(position.getZ(i), half, SEA_WARP));
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/** 尾迹面片：XZ 平面，中心在舰艉略后 */
function createFoamGeometry() {
  const geometry = new THREE.PlaneGeometry(FOAM_WIDTH, FOAM_DEPTH, FOAM_SEGMENTS_X, FOAM_SEGMENTS_Z);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, FOAM_CENTER_Z);
  geometry.computeBoundingSphere();
  return geometry;
}

function withFog(uniforms) {
  return Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uniforms);
}

/* ── 主入口 ───────────────────────────────────────────────── */

/**
 * @param {THREE.Scene} scene
 * @param {{ materials?: object, anim?: { addUpdate: Function }, scene?: THREE.Scene }} ctx
 * @returns {{ water: THREE.Mesh, foam: THREE.Mesh, uniforms: object, root: THREE.Group }}
 */
export function buildSea(scene, ctx = {}) {
  const parent = scene ?? ctx?.scene ?? null;

  const root = new THREE.Group();
  root.name = "sea";

  // 两个材质共享的时间/波幅 uniform（同一对象引用，改一次两边都动）
  const shared = {
    uTime: { value: 0 },
    uWaveStrength: { value: 1.0 },
  };

  /* ── 水面 ── */
  const waterUniforms = withFog({
    uTime: shared.uTime,
    uWaveStrength: shared.uWaveStrength,
    uDeepColor: { value: new THREE.Color(PALETTE.deep) },
    uShallowColor: { value: new THREE.Color(PALETTE.shallow) },
    uHorizonColor: { value: new THREE.Color(PALETTE.horizon) },
    uSkyTint: { value: new THREE.Color(PALETTE.sky) },
    uSpecColor: { value: new THREE.Color(PALETTE.spec) },
    uGlintColor: { value: new THREE.Color(PALETTE.glint) },
    uSunDirection: { value: new THREE.Vector3(0.42, 0.62, 0.66).normalize() },
    uRippleStrength: { value: 0.9 },
    uHorizonStart: { value: 1200 },
    uHorizonEnd: { value: 2600 },
    uGridStrength: { value: 0.0 },
    uOpacity: { value: 1.0 },
  });

  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    fog: true,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
  });

  const waterGeometry = createWaterGeometry();
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.name = "sea:water";
  water.position.set(0, SHIP.waterline, 0);
  water.renderOrder = -10;
  water.frustumCulled = false;
  water.castShadow = false;
  water.receiveShadow = false;
  root.add(water);

  /* ── 泡沫 / 尾迹 ── */
  const foamUniforms = withFog({
    uTime: shared.uTime,
    uWaveStrength: shared.uWaveStrength,
    uFoamColor: { value: new THREE.Color(PALETTE.foam) },
    uFoamCoreColor: { value: new THREE.Color(PALETTE.foamCore) },
    uFoamOpacity: { value: 0.3 },
    uFoamScale: { value: 1.0 },
    uBowZ: { value: SHIP.bowZ },
    uSternZ: { value: SHIP.sternZ },
    uHalfBeam: { value: SHIP.beam / 2 },
    uFoamCenter: { value: new THREE.Vector2(0, FOAM_CENTER_Z) },
    uFoamHalf: { value: new THREE.Vector2(FOAM_WIDTH / 2, FOAM_DEPTH / 2) },
  });

  const foamMaterial = new THREE.ShaderMaterial({
    uniforms: foamUniforms,
    vertexShader: FOAM_VERT,
    fragmentShader: FOAM_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });

  const foamGeometry = createFoamGeometry();
  const foam = new THREE.Mesh(foamGeometry, foamMaterial);
  foam.name = "sea:foam";
  foam.position.set(0, SHIP.waterline + FOAM_LIFT, 0);
  foam.renderOrder = 20; // 透明体排在船体之后
  foam.frustumCulled = false;
  foam.castShadow = false;
  foam.receiveShadow = false;
  root.add(foam);

  if (parent && parent !== root) parent.add(root);

  /* ── 动画 ── */
  let clock = 0;
  function update(dt = 0, elapsed) {
    const step = Number.isFinite(dt) ? dt : 0;
    clock = Number.isFinite(elapsed) ? elapsed : clock + step;
    shared.uTime.value = clock;
  }

  let unregister = null;
  if (typeof ctx?.anim?.addUpdate === "function") {
    unregister = ctx.anim.addUpdate(update);
  }

  function setWaterOpacity(value) {
    const v = THREE.MathUtils.clamp(value, 0, 1);
    waterUniforms.uOpacity.value = v;
    waterMaterial.transparent = v < 0.999;
    waterMaterial.depthWrite = v >= 0.999;
    waterMaterial.needsUpdate = true;
  }

  function dispose() {
    if (typeof unregister === "function") unregister();
    waterGeometry.dispose();
    foamGeometry.dispose();
    waterMaterial.dispose();
    foamMaterial.dispose();
    root.remove(water, foam);
    if (parent) parent.remove(root);
    if (scene?.userData?.sea === api) delete scene.userData.sea;
  }

  const api = {
    root,
    water,
    foam,
    uniforms: {
      shared,
      uTime: shared.uTime,
      uWaveStrength: shared.uWaveStrength,
      water: waterUniforms,
      foam: foamUniforms,
    },
    update,
    setWaterOpacity,
    dispose,
  };

  if (scene) scene.userData.sea = api;
  else if (ctx?.scene) ctx.scene.userData.sea = api;

  return api;
}
