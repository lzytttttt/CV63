import * as THREE from "three";

/* ══════════════════════════════════════════════════════════════
   粒子特效 —— 锅炉烟 / 弹射蒸汽 / 舰艏水雾
   ------------------------------------------------------------------
   · 全部为预分配 THREE.Points，热循环内不新建对象。
   · 连续发射器（烟、水雾）各一个 Points；蒸汽爆发使用 4 个
     复用池 Points，一次 burst 占用一个，结束即隐藏（0 draw call）。
   · 贴图来自 ctx.materials.softSprite / steamSprite，模块内不建 canvas。
   ══════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

const MAX_SMOKE = 220;
const MAX_SPRAY = 160;
const BURST_SYSTEMS = 4;
const MAX_BURST = 72;
const MAX_SMOKE_SOURCES = 4;

const SMOKE_RATE = 9; // 每秒粒子数（每个烟囱）
const SPRAY_RATE = 26;

const SMOKE_CFG = { gravityY: 0.55, windX: 0.35, windZ: 2.9, drag: 0.55, fadeIn: 0.1, fadeOutStart: 0.34 };
const STEAM_CFG = { gravityY: -0.7, windX: 0.2, windZ: 1.5, drag: 1.5, fadeIn: 0.05, fadeOutStart: 0.3 };
const SPRAY_CFG = { gravityY: -8.2, windX: 0.45, windZ: 2.2, drag: 1.0, fadeIn: 0.04, fadeOutStart: 0.25 };

/* ── 着色器 ───────────────────────────────────────────────── */

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute float aOpacity;
attribute float aShade;

uniform float uPointScale;

varying float vOpacity;
varying float vShade;

#include <fog_pars_vertex>

void main() {
  vOpacity = aOpacity;
  vShade = aShade;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(aSize * uPointScale / max(0.5, -mvPosition.z), 1.0, 384.0);

  #include <fog_vertex>
}
`;

const POINT_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;

varying float vOpacity;
varying float vShade;

#include <fog_pars_fragment>

void main() {
  vec4 texel = texture2D(uMap, gl_PointCoord);
  float alpha = texel.a * vOpacity * uOpacity;

  // 只衰减 alpha：加法混合的粒子不会被雾色抬亮
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    alpha *= 1.0 - fogFactor;
  #endif

  if (alpha < 0.003) discard;

  vec3 color = mix(uColorA, uColorB, vShade);
  gl_FragColor = vec4(color, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ── 小工具 ───────────────────────────────────────────────── */

function smooth01(t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

const scratchVec = new THREE.Vector3();
const scratchSize = new THREE.Vector2();

function readVec(position, target) {
  if (!position) return target.set(0, 0, 0);
  if (Array.isArray(position) || ArrayBuffer.isView(position)) {
    return target.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
  }
  return target.copy(position);
}

/** 仅在 ctx.materials 缺少 sprite 贴图时使用（避免模块内建 canvas） */
function makeFallbackSprite(size = 32) {
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center) / center;
      const a = smooth01(1 - d);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/* ── 粒子系统 ─────────────────────────────────────────────── */

/**
 * 预分配粒子池 + 自定义 Points 材质（逐粒子尺寸 / alpha / 色调）
 */
function createParticleSystem({ max, map, blending, colorA, colorB, renderOrder = 40, opacity = 1 }) {
  const positions = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const alphas = new Float32Array(max);
  const shades = new Float32Array(max);

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  const alphaAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  const shadeAttr = new THREE.BufferAttribute(shades, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("aSize", sizeAttr);
  geometry.setAttribute("aOpacity", alphaAttr);
  geometry.setAttribute("aShade", shadeAttr);
  geometry.setDrawRange(0, 0);

  const uniforms = Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), {
    uMap: { value: map },
    uColorA: { value: new THREE.Color(colorA) },
    uColorB: { value: new THREE.Color(colorB) },
    uOpacity: { value: opacity },
    uPointScale: { value: 900 },
  });

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending,
    fog: true,
  });

  const points = new THREE.Points(geometry, material);
  points.name = "effects:points";
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  points.visible = false;

  const state = {
    x: new Float32Array(max),
    y: new Float32Array(max),
    z: new Float32Array(max),
    vx: new Float32Array(max),
    vy: new Float32Array(max),
    vz: new Float32Array(max),
    age: new Float32Array(max),
    life: new Float32Array(max),
    s0: new Float32Array(max),
    s1: new Float32Array(max),
    a0: new Float32Array(max),
    shade: new Float32Array(max),
  };
  const fields = [
    state.x,
    state.y,
    state.z,
    state.vx,
    state.vy,
    state.vz,
    state.age,
    state.life,
    state.s0,
    state.s1,
    state.a0,
    state.shade,
  ];

  let count = 0;

  function kill(index) {
    const last = count - 1;
    if (index !== last) {
      for (let f = 0; f < fields.length; f++) {
        const arr = fields[f];
        arr[index] = arr[last];
      }
    }
    count--;
  }

  function spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, shade) {
    if (count >= max) return false;
    const i = count++;
    state.x[i] = x;
    state.y[i] = y;
    state.z[i] = z;
    state.vx[i] = vx;
    state.vy[i] = vy;
    state.vz[i] = vz;
    state.age[i] = 0;
    state.life[i] = life;
    state.s0[i] = s0;
    state.s1[i] = s1;
    state.a0[i] = a0;
    state.shade[i] = shade;
    return true;
  }

  function update(dt, cfg) {
    const damping = Math.max(0, 1 - cfg.drag * dt);
    const windX = cfg.windX * dt;
    const windZ = cfg.windZ * dt;
    const gravity = cfg.gravityY * dt;
    const fadeIn = Math.max(cfg.fadeIn, 0.001);
    const fadeRange = Math.max(1 - cfg.fadeOutStart, 0.001);

    for (let i = 0; i < count; i++) {
      const age = state.age[i] + dt;
      if (age >= state.life[i]) {
        kill(i);
        i--;
        continue;
      }
      state.age[i] = age;

      const vx = state.vx[i] * damping + windX;
      const vy = state.vy[i] * damping + gravity;
      const vz = state.vz[i] * damping + windZ;
      state.vx[i] = vx;
      state.vy[i] = vy;
      state.vz[i] = vz;
      state.x[i] += vx * dt;
      state.y[i] += vy * dt;
      state.z[i] += vz * dt;

      const k = age / state.life[i];
      const grow = 1 - (1 - k) * (1 - k);
      const size = state.s0[i] + (state.s1[i] - state.s0[i]) * grow;
      let fade = smooth01(k / fadeIn);
      if (k > cfg.fadeOutStart) fade *= 1 - smooth01((k - cfg.fadeOutStart) / fadeRange);

      const i3 = i * 3;
      positions[i3] = state.x[i];
      positions[i3 + 1] = state.y[i];
      positions[i3 + 2] = state.z[i];
      sizes[i] = size;
      alphas[i] = state.a0[i] * fade;
      shades[i] = state.shade[i];
    }

    geometry.setDrawRange(0, count);
    if (count > 0) {
      positionAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;
      shadeAttr.needsUpdate = true;
    }
    points.visible = count > 0;
  }

  function reset() {
    count = 0;
    geometry.setDrawRange(0, 0);
    points.visible = false;
  }

  return {
    points,
    material,
    uniforms,
    spawn,
    update,
    reset,
    size: () => count,
    capacity: max,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ── 主入口 ───────────────────────────────────────────────── */

/**
 * @param {{ materials?: object, anim?: { addUpdate: Function }, scene?: THREE.Scene, renderer?: THREE.WebGLRenderer, camera?: THREE.Camera }} ctx
 */
export function createEffects(ctx = {}) {
  const M = ctx.materials ?? {};
  const generatedSprite = !M.softSprite && !M.steamSprite ? makeFallbackSprite() : null;
  const softMap = M.softSprite ?? generatedSprite;
  const steamMap = M.steamSprite ?? softMap;

  const root = new THREE.Group();
  root.name = "effects";

  const smoke = createParticleSystem({
    max: MAX_SMOKE,
    map: softMap,
    blending: THREE.NormalBlending,
    colorA: 0x2f3d46,
    colorB: 0x9db2bd,
    renderOrder: 41,
    opacity: 1,
  });
  root.add(smoke.points);

  const spray = createParticleSystem({
    max: MAX_SPRAY,
    map: steamMap,
    blending: THREE.AdditiveBlending,
    colorA: 0xcfe9f2,
    colorB: 0xffffff,
    renderOrder: 43,
    opacity: 1,
  });
  root.add(spray.points);

  const bursts = [];
  for (let i = 0; i < BURST_SYSTEMS; i++) {
    const system = createParticleSystem({
      max: MAX_BURST,
      map: steamMap,
      blending: THREE.NormalBlending,
      colorA: 0xd8e9f0,
      colorB: 0xffffff,
      renderOrder: 42,
      opacity: 0.85,
    });
    system.pending = null;
    bursts.push(system);
    root.add(system.points);
  }

  const systems = [smoke, spray];
  for (let i = 0; i < bursts.length; i++) systems.push(bursts[i]);

  /* 连续发射器状态 */
  const smokeSources = [];
  let spraySource = null;
  let burstCursor = 0;

  /* 点尺寸换算（世界直径 → 像素），随窗口/像素比变化刷新 */
  let pointScale = 900;
  let scaleTimer = 0;

  function refreshPointScale(dt) {
    scaleTimer -= dt;
    if (scaleTimer > 0) return;
    scaleTimer = 0.5;
    const renderer = ctx.renderer;
    if (!renderer || typeof renderer.getSize !== "function") return;
    const size = renderer.getSize(scratchSize);
    const pixelRatio = typeof renderer.getPixelRatio === "function" ? renderer.getPixelRatio() : 1;
    const height = (size?.y ?? 0) * pixelRatio;
    if (!(height > 0)) return;
    const fov = ((ctx.camera?.fov ?? 33) * Math.PI) / 180;
    const next = (height * 0.5) / Math.tan(fov * 0.5);
    if (!Number.isFinite(next) || next <= 0 || Math.abs(next - pointScale) < 1) return;
    pointScale = next;
    for (let i = 0; i < systems.length; i++) systems[i].uniforms.uPointScale.value = pointScale;
  }

  /* ── 排放 ── */

  function emitSmoke(dt) {
    for (let s = 0; s < smokeSources.length; s++) {
      const source = smokeSources[s];
      source.acc += SMOKE_RATE * dt;
      let guard = 0;
      while (source.acc >= 1 && guard < 8) {
        guard++;
        const ok = smoke.spawn(
          source.x + rand(-2.6, 2.6),
          source.y + rand(-0.4, 0.8),
          source.z + rand(-2.6, 2.6),
          rand(-0.45, 0.45),
          rand(1.5, 3.0),
          rand(0.3, 1.3),
          rand(5.0, 7.0),
          rand(2.4, 3.6),
          rand(8.0, 13.0),
          rand(0.07, 0.13),
          Math.random(),
        );
        if (!ok) {
          source.acc = Math.min(source.acc, 1);
          break;
        }
        source.acc -= 1;
      }
    }
  }

  function emitSpray(dt) {
    if (!spraySource) return;
    spraySource.acc += SPRAY_RATE * dt;
    let guard = 0;
    while (spraySource.acc >= 1 && guard < 10) {
      guard++;
      const side = Math.random() < 0.5 ? -1 : 1;
      const ok = spray.spawn(
        spraySource.x + side * rand(0.4, 9.0),
        spraySource.y + rand(0.0, 1.3),
        spraySource.z + rand(-11.0, 9.0),
        side * rand(0.5, 2.6),
        rand(2.4, 6.4),
        rand(0.3, 2.4),
        rand(1.0, 2.1),
        rand(0.35, 0.75),
        rand(1.3, 2.8),
        rand(0.22, 0.44),
        rand(0.55, 1.0),
      );
      if (!ok) {
        spraySource.acc = Math.min(spraySource.acc, 1);
        break;
      }
      spraySource.acc -= 1;
    }
  }

  function emitBurst(system, dt) {
    const pending = system.pending;
    if (!pending) return;
    pending.elapsed += dt;
    pending.acc += pending.rate * dt;
    let guard = 0;
    while (pending.acc >= 1 && pending.remaining > 0 && guard < 24) {
      guard++;
      const angle = Math.random() * TAU;
      const radius = rand(0.0, 1.0) * pending.spread * 0.35;
      const ok = system.spawn(
        pending.x + Math.cos(angle) * radius,
        pending.y + rand(0.0, 0.35),
        pending.z + Math.sin(angle) * radius,
        Math.cos(angle) * rand(4.0, 9.0),
        rand(4.5, 11.0),
        Math.sin(angle) * rand(4.0, 9.0) + 0.8,
        rand(0.9, 1.8) * (pending.lifeK ?? 1),
        rand(0.9, 1.6) * (pending.sizeK ?? 1),
        rand(4.5, 8.5) * (pending.sizeK ?? 1),
        rand(0.28, 0.46),
        rand(0.35, 1.0),
      );
      if (!ok) break;
      pending.acc -= 1;
      pending.remaining -= 1;
    }
    if (pending.remaining <= 0 || pending.elapsed > pending.duration + 1.0) system.pending = null;
  }

  /* ── 对外的发射接口 ── */

  /** 开启/移动一个持续锅炉烟源 */
  function funnelSmoke(position) {
    readVec(position, scratchVec);
    for (let i = 0; i < smokeSources.length; i++) {
      const source = smokeSources[i];
      if (Math.abs(source.x - scratchVec.x) < 0.001 && Math.abs(source.z - scratchVec.z) < 0.001) {
        source.y = scratchVec.y;
        return;
      }
    }
    if (smokeSources.length >= MAX_SMOKE_SOURCES) {
      const oldest = smokeSources[0];
      oldest.x = scratchVec.x;
      oldest.y = scratchVec.y;
      oldest.z = scratchVec.z;
      return;
    }
    smokeSources.push({ x: scratchVec.x, y: scratchVec.y, z: scratchVec.z, acc: 0 });
  }

  /** 关闭全部锅炉烟源（已存在的粒子上飘后自然消散） */
  function stopFunnel() {
    smokeSources.length = 0;
  }

  /** 弹射蒸汽（白、快、短命） */
  function steamBurst(position, options = {}) {
    const count = Math.max(1, Math.min(Math.round(options.count ?? 28), MAX_BURST));
    const spread = options.spread ?? 6;
    const duration = Math.max(0.06, options.duration ?? 0.45);
    readVec(position, scratchVec);

    const system = bursts[burstCursor % bursts.length];
    burstCursor = (burstCursor + 1) % bursts.length;
    system.reset();
    system.pending = {
      x: scratchVec.x,
      y: scratchVec.y,
      z: scratchVec.z,
      spread,
      duration,
      remaining: count,
      elapsed: 0,
      acc: 0,
      rate: count / duration,
    };
  }

  /** 开启/移动舰艏水雾 */
  function bowSpray(position) {
    readVec(position, scratchVec);
    if (!spraySource) spraySource = { x: 0, y: 0, z: 0, acc: 0 };
    spraySource.x = scratchVec.x;
    spraySource.y = scratchVec.y;
    spraySource.z = scratchVec.z;
  }

  function stopSpray() {
    spraySource = null;
  }

  function stopAll() {
    smokeSources.length = 0;
    spraySource = null;
    for (let i = 0; i < bursts.length; i++) bursts[i].pending = null;
  }

  /* ── 主循环 ── */

  let clock = 0;
  let enabled = true;

  /** 整体显隐（不打断粒子寿命，关闭时不发射新粒子） */
  function setVisible(visible) {
    enabled = Boolean(visible);
    root.visible = enabled;
  }

  function update(dt = 0, elapsed) {
    const step = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.05);
    clock = Number.isFinite(elapsed) ? elapsed : clock + step;

    refreshPointScale(step);
    if (enabled) {
      emitSmoke(step);
      emitSpray(step);
      for (let i = 0; i < bursts.length; i++) emitBurst(bursts[i], step);
    }

    smoke.update(step, SMOKE_CFG);
    spray.update(step, SPRAY_CFG);
    for (let i = 0; i < bursts.length; i++) bursts[i].update(step, STEAM_CFG);
  }

  let unregister = null;
  if (typeof ctx?.anim?.addUpdate === "function") {
    unregister = ctx.anim.addUpdate(update);
  }

  const host = ctx.scene ?? null;
  if (host) host.add(root);

  function dispose() {
    if (typeof unregister === "function") unregister();
    stopAll();
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      system.dispose();
      root.remove(system.points);
    }
    if (generatedSprite) generatedSprite.dispose();
    if (root.parent) root.parent.remove(root);
  }

  return {
    root,
    funnelSmoke,
    steamBurst,
    bowSpray,
    stopFunnel,
    stopSpray,
    stopAll,
    update,
    setVisible,
    dispose,
    // 便于调试 / 计数
    systems: { smoke, spray, bursts },
    counts: () => ({
      smoke: smoke.size(),
      spray: spray.size(),
      bursts: bursts.reduce((sum, system) => sum + system.size(), 0),
    }),
  };
}
