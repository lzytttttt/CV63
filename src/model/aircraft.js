/**
 * CV-63 舰载机程序化工厂
 *
 * 坐标约定（与整舰一致）：机头指向 -Z，翼展沿 X，机轮/龙骨落在 y = 0。
 * 只使用 three.js 基础几何 + geometry.js 工具；无贴图、无 DOM、无外部资源，
 * 可以在纯模块环境里 import 并逐机型构建。
 *
 * createAircraft(type, M, { folded, gear, scale }) -> THREE.Group
 *   group.userData = { type, spec, setFold(t), setGear(t), setBurner(t), rotors }
 *   - setFold(t):  t=0 展开/停放，t=1 折叠。各机型含义见各 builder 顶部注释。
 *   - setGear(t):  t=0 收起（隐藏于机身内），t=1 放下且轮子着地。
 *   - setBurner(t): 0..1 加力焰（仅 fa18 / f14；其余为 no-op）。
 *   - rotors: [{ object, speed, axis: "z", label }]
 *      调用方直接 object.rotation.z += dt * speed。
 *      每个 rotor 的外层 wrapper 已把局部 Z 轴对齐到真实转轴，
 *      所以「绕局部 Z 加角度」永远等于绕真实转轴旋转：
 *        E-2C 螺旋桨 → 真实轴 = 机体 Z；SH-3 主旋翼 → 机体 Y；SH-3 尾桨 → 机体 X。
 */

import * as THREE from "three";
import { addBox, addCylinder, cylinderBetween, clamp01, lerp, smoothstep } from "./geometry.js";

/* ══════════════════════════════════════════════════════════
   规格表（米）
   ══════════════════════════════════════════════════════════ */

export const AIRCRAFT_SPECS = {
  fa18: { label: "F/A-18C Hornet", length: 17.1, span: 11.4, height: 4.7 },
  // span = 展开状态；spanSwept 为 t=1 后掠状态的翼展
  f14: { label: "F-14D Tomcat", length: 19.1, span: 19.5, spanSwept: 11.6, height: 4.9 },
  e2c: { label: "E-2C Hawkeye", length: 17.6, span: 24.6, height: 5.6 },
  ea6b: { label: "EA-6B Prowler", length: 18.2, span: 16.2, height: 4.9 },
  sh3: { label: "SH-3 Sea King", length: 16.7, span: 19.0, height: 5.2, rotorDiameter: 19.0 },
};

const HALF_PI = Math.PI / 2;

/* ══════════════════════════════════════════════════════════
   基础几何工具
   ══════════════════════════════════════════════════════════ */

/** 多边形板的三角化 + 侧壁（points 为 [u,v]，u/v 指定世界方向，厚度沿 u×v） */
function plateGeometry(points, { u = [1, 0, 0], v = [0, 0, 1], thickness = 0.14 } = {}) {
  const U = new THREE.Vector3(...u).normalize();
  const V = new THREE.Vector3(...v).normalize();
  const N = new THREE.Vector3().crossVectors(U, V).normalize().multiplyScalar(thickness * 0.5);

  let pts = points;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) pts = pts.slice().reverse();

  const at = (p, s) => [
    U.x * p[0] + V.x * p[1] + N.x * s,
    U.y * p[0] + V.y * p[1] + N.y * s,
    U.z * p[0] + V.z * p[1] + N.z * s,
  ];

  const positions = [];
  const push = (a, b, c) => positions.push(...a, ...b, ...c);
  for (let i = 1; i < pts.length - 1; i++) {
    push(at(pts[0], 1), at(pts[i + 1], 1), at(pts[i], 1));
    push(at(pts[0], -1), at(pts[i], -1), at(pts[i + 1], -1));
  }
  for (let i = 0; i < pts.length; i++) {
    const a = at(pts[i], 1);
    const b = at(pts[(i + 1) % pts.length], 1);
    const c = at(pts[(i + 1) % pts.length], -1);
    const d = at(pts[i], -1);
    push(a, b, c);
    push(a, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** 蒙皮/翼面：薄板 */
function addPlate(parent, material, points, options = {}) {
  const mesh = new THREE.Mesh(
    plateGeometry(points, {
      u: options.u,
      v: options.v,
      thickness: options.thickness ?? 0.14,
    }),
    material,
  );
  if (options.position) mesh.position.set(...options.position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  if (options.name) mesh.name = options.name;
  parent.add(mesh);
  return mesh;
}

/**
 * 放样体：沿 Z 逐站放样，截面是超椭圆（exponent 2 = 椭圆，3 ≈ 圆角矩形）。
 * stations: [{ z, w, h, y }] —— w/h 为半宽/半高，y 为截面中心高度。
 */
function loftGeometry(stations, { segments = 12, exponent = 2.4 } = {}) {
  const power = 2 / exponent;
  const ring = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    ring.push([
      Math.sign(c) * Math.pow(Math.abs(c), power),
      Math.sign(s) * Math.pow(Math.abs(s), power),
    ]);
  }

  const vert = (st, p) => [p[0] * st.w, st.y + p[1] * st.h, st.z];
  const positions = [];

  for (let k = 0; k < stations.length - 1; k++) {
    const s0 = stations[k];
    const s1 = stations[k + 1];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const A = vert(s0, ring[i]);
      const B = vert(s0, ring[j]);
      const C = vert(s1, ring[j]);
      const D = vert(s1, ring[i]);
      positions.push(...A, ...C, ...D, ...A, ...B, ...C);
    }
  }

  const cap = (st, front) => {
    if (st.w < 0.05 && st.h < 0.05) return;
    const center = [0, st.y, st.z];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const A = vert(st, ring[i]);
      const B = vert(st, ring[j]);
      if (front) positions.push(...center, ...B, ...A);
      else positions.push(...center, ...A, ...B);
    }
  };
  cap(stations[0], true);
  cap(stations[stations.length - 1], false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addLoft(parent, material, stations, options = {}) {
  const mesh = new THREE.Mesh(loftGeometry(stations, options), material);
  if (options.position) mesh.position.set(...options.position);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  if (options.name) mesh.name = options.name;
  parent.add(mesh);
  return mesh;
}

/** 轮子：轮胎 + 轮毂，轴向沿 X */
function addWheel(parent, M, radius, width, x, y, z) {
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 12), M.rubber);
  tire.rotation.z = HALF_PI;
  tire.position.set(x, y, z);
  tire.castShadow = true;
  tire.receiveShadow = true;
  parent.add(tire);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.46, radius * 0.46, width * 1.08, 8),
    M.steel,
  );
  hub.rotation.z = HALF_PI;
  hub.position.copy(tire.position);
  hub.castShadow = false;
  hub.receiveShadow = false;
  parent.add(hub);
  return tire;
}

/**
 * 起落架单元：支柱 + 轮。pivot 位于机身内的收放转轴。
 * t=1 轮子着地；t=0 绕横轴内折，整体隐藏（收在机体内）。
 */
function makeGearUnit(parent, M, { attach, drop, wheelRadius, wheelWidth = 0.24, strutRadius, name }) {
  const pivot = new THREE.Group();
  pivot.position.set(...attach);
  if (name) pivot.name = name;
  parent.add(pivot);

  const leg = new THREE.Group();
  pivot.add(leg);

  const radius = strutRadius ?? Math.max(0.05, wheelRadius * 0.17);
  const strut = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.15, drop, 6),
    M.steelDark,
  );
  strut.position.y = -drop / 2;
  strut.castShadow = true;
  leg.add(strut);

  // 扭力臂 / 斜撑
  const brace = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.6, drop * 0.55, radius * 1.4), M.steelDark);
  brace.position.set(0, -drop * 0.42, radius * 2.2);
  brace.rotation.x = 0.42;
  brace.castShadow = true;
  leg.add(brace);

  addWheel(leg, M, wheelRadius, wheelWidth, 0, -drop, 0);

  const set = (t) => {
    const k = clamp01(t);
    pivot.rotation.x = (1 - k) * -1.52;
    pivot.visible = k > 0.015;
  };

  return { pivot, set };
}

/** 导弹 / 副油箱一类细长体，沿 -Z 指向（长度居中于原点） */
function makeMissile(M, { length = 2.6, radius = 0.13, finSpan = 0.32, material = null, finMaterial = null } = {}) {
  const group = new THREE.Group();
  const bodyMaterial = material ?? M.jetWhite;
  const finMat = finMaterial ?? M.jetDark;

  const bodyLength = length * 0.74;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, bodyLength, 8), bodyMaterial);
  body.rotation.x = HALF_PI;
  body.position.z = length * 0.13;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(radius, length * 0.26, 8), bodyMaterial);
  nose.rotation.x = -HALF_PI;
  nose.position.z = -length * 0.37;
  nose.castShadow = true;
  group.add(nose);

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(finSpan, 0.03, length * 0.2), finMat);
    fin.position.set(
      Math.cos(angle) * finSpan * 0.55,
      Math.sin(angle) * finSpan * 0.55,
      length * 0.36,
    );
    fin.rotation.z = angle;
    fin.castShadow = true;
    group.add(fin);
  }
  return group;
}

/** 挂架 + 弹药（返回导弹对象，便于后续微调） */
function addStore(parent, M, { x, y, z, length = 2.6, radius = 0.13, pylonHeight = 0.24 }) {
  addBox(parent, M.jet, 0.16, pylonHeight, length * 0.44, x, y + pylonHeight * 0.5, z, {
    castShadow: true,
  });
  const missile = makeMissile(M, { length, radius });
  missile.position.set(x, y - radius * 0.35, z);
  parent.add(missile);
  return missile;
}

/**
 * 尾喷口：外筒 + 深色内壁 + 可缩放加力焰。
 * 返回 { flame, glow } 供 setBurner 使用。
 */
function addNozzle(parent, M, { x, y, z, radius = 0.44, length = 0.9, flameLength = 2.4 }) {
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius, length, 12), M.jetDark);
  tube.rotation.x = HALF_PI;
  tube.position.set(x, y, z);
  tube.castShadow = true;
  parent.add(tube);

  const inner = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.86, 12), M.black);
  inner.position.set(x, y, z + length * 0.5 + 0.01);
  inner.castShadow = false;
  parent.add(inner);

  const flameMaterial = M.afterburner.clone();
  flameMaterial.transparent = true;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.78, flameLength, 10), flameMaterial);
  flame.rotation.x = HALF_PI;
  flame.castShadow = false;
  flame.receiveShadow = false;

  const flamePivot = new THREE.Group();
  flamePivot.position.set(x, y, z + length * 0.5);
  flame.position.z = flameLength * 0.5;
  flamePivot.add(flame);
  parent.add(flamePivot);

  const glowMaterial = M.engineGlow.clone();
  glowMaterial.transparent = true;
  const glow = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.8, 12), glowMaterial);
  glow.position.set(x, y, z + length * 0.5 + 0.02);
  glow.castShadow = false;
  parent.add(glow);

  return { flamePivot, flameMaterial, glow, glowMaterial };
}

function makeBurner(nozzles) {
  if (!nozzles.length) return () => {};
  return (t) => {
    const k = clamp01(t);
    for (const nozzle of nozzles) {
      nozzle.flamePivot.visible = k > 0.015;
      nozzle.flamePivot.scale.z = lerp(0.08, 1, k);
      nozzle.flameMaterial.opacity = lerp(0.12, 0.9, k);
      nozzle.glow.visible = k > 0.015;
      nozzle.glowMaterial.opacity = lerp(0.1, 0.8, k);
    }
  };
}

function makeGearDriver(units) {
  return (t) => {
    const k = clamp01(t);
    for (const unit of units) unit.set(k);
  };
}

/* ══════════════════════════════════════════════════════════
   FA-18C Hornet
   setFold: 外翼段绕顺机身方向的铰链（局部 Z 轴）向上折起 ~110°。
   ══════════════════════════════════════════════════════════ */

function buildFA18(M) {
  const group = new THREE.Group();
  group.name = "AIRCRAFT / F/A-18C";

  const Y = 1.62; // 机身轴线高度
  const wingY = 1.52;
  const hingeX = 2.4;
  const gearUnits = [];
  const nozzles = [];

  /* 机身 */
  addLoft(
    group,
    M.jet,
    [
      { z: -6.72, w: 0.45, h: 0.37, y: Y - 0.02 },
      { z: -5.8, w: 0.56, h: 0.47, y: Y },
      { z: -4.8, w: 0.66, h: 0.55, y: Y + 0.01 },
      { z: -3.4, w: 0.75, h: 0.61, y: Y + 0.02 },
      { z: -1.6, w: 0.81, h: 0.65, y: Y + 0.02 },
      { z: 0.6, w: 0.84, h: 0.66, y: Y + 0.02 },
      { z: 2.8, w: 0.86, h: 0.64, y: Y + 0.02 },
      { z: 4.8, w: 0.84, h: 0.58, y: Y + 0.02 },
      { z: 6.4, w: 0.76, h: 0.5, y: Y + 0.02 },
      { z: 7.6, w: 0.64, h: 0.44, y: Y + 0.02 },
      { z: 8.1, w: 0.56, h: 0.42, y: Y + 0.02 },
    ],
    { segments: 12, exponent: 2.5 },
  );

  /* 雷达罩（浅色前段） */
  addLoft(
    group,
    M.jetWhite,
    [
      { z: -8.42, w: 0.035, h: 0.035, y: Y - 0.07 },
      { z: -8.12, w: 0.17, h: 0.14, y: Y - 0.07 },
      { z: -7.58, w: 0.3, h: 0.24, y: Y - 0.06 },
      { z: -6.78, w: 0.44, h: 0.36, y: Y - 0.03 },
    ],
    { segments: 12, exponent: 2.5 },
  );

  /* 座舱盖（泡形） */
  addLoft(
    group,
    M.canopy,
    [
      { z: -6.4, w: 0.16, h: 0.07, y: Y + 0.36 },
      { z: -5.95, w: 0.3, h: 0.17, y: Y + 0.42 },
      { z: -5.3, w: 0.37, h: 0.24, y: Y + 0.45 },
      { z: -4.5, w: 0.38, h: 0.24, y: Y + 0.44 },
      { z: -3.7, w: 0.32, h: 0.15, y: Y + 0.38 },
      { z: -3.25, w: 0.22, h: 0.06, y: Y + 0.32 },
    ],
    { segments: 10, exponent: 2.05, castShadow: false },
  );

  /* 座舱后脊背 */
  addBox(group, M.jet, 0.58, 0.22, 2.4, 0, Y + 0.63, -2.1, { castShadow: true });

  /* 进气道 + 进气口 */
  [-1, 1].forEach((side) => {
    addBox(group, M.jet, 0.46, 0.64, 3.0, side * 1.06, Y - 0.2, -2.3, { castShadow: true });
    addBox(group, M.black, 0.42, 0.58, 0.1, side * 1.06, Y - 0.2, -3.78, { castShadow: false });
    addBox(group, M.jetDark, 0.5, 0.1, 3.0, side * 1.06, Y + 0.13, -2.3, { castShadow: false });
  });

  /* 边条翼 LEX */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.55, -5.0],
        [side * 1.42, -1.1],
        [side * 1.36, 1.0],
        [side * 0.6, 1.0],
      ],
      { thickness: 0.12, position: [0, Y + 0.06, 0] },
    );
  });

  /* 内翼段 */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.95, -1.95],
        [side * hingeX, -0.75],
        [side * hingeX, 2.5],
        [side * 0.95, 2.62],
      ],
      { thickness: 0.17, position: [0, wingY, 0] },
    );
  });

  /* 外翼段（可折叠） */
  const foldPanels = [];
  [-1, 1].forEach((side) => {
    const hinge = new THREE.Group();
    hinge.position.set(side * hingeX, wingY, 0);
    group.add(hinge);

    addPlate(
      hinge,
      M.jet,
      [
        [0, -0.75],
        [side * 3.3, 1.15],
        [side * 3.3, 2.34],
        [0, 2.5],
      ],
      { thickness: 0.16 },
    );

    // 后缘襟翼细节
    addBox(hinge, M.jetDark, 0.12, 0.1, 3.1, side * 0.4, -0.04, 2.6, { castShadow: false });

    // 翼尖导弹挂轨 + AIM-9
    addBox(hinge, M.jetDark, 0.14, 0.12, 1.5, side * 3.28, -0.05, 0.55, { castShadow: false });
    const tipMissile = makeMissile(M, { length: 2.6, radius: 0.11, finSpan: 0.28 });
    tipMissile.position.set(side * 3.3, -0.12, 0.55);
    hinge.add(tipMissile);

    hinge.rotation.z = 0;
    foldPanels.push({ hinge, side });
  });

  /* 平尾（全动） */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.7, 4.55],
        [side * 3.0, 6.1],
        [side * 3.0, 7.05],
        [side * 0.7, 7.35],
      ],
      { thickness: 0.14, position: [0, Y + 0.06, 0] },
    );
  });

  /* 双垂尾（外倾 22°） */
  [-1, 1].forEach((side) => {
    addBox(group, M.jet, 0.52, 0.34, 2.6, side * 1.06, Y + 0.5, 5.4, { castShadow: true });
    addPlate(
      group,
      M.jet,
      [
        [2.2, 0],
        [7.3, 0],
        [7.45, 2.9],
        [4.95, 2.9],
      ],
      {
        u: [0, 0, 1],
        v: [0, 1, 0],
        thickness: 0.15,
        position: [side * 1.16, Y + 0.34, 0],
        rotation: [0, 0, -side * 0.38],
      },
    );
    // 方向舵缝
    addBox(
      group,
      M.jetDark,
      0.1,
      1.9,
      0.09,
      side * (1.16 + 0.72),
      Y + 1.36,
      6.7,
      { rotation: [0, 0, -side * 0.38], castShadow: false },
    );
  });

  /* 尾喷口 + 加力 */
  [-1, 1].forEach((side) => {
    nozzles.push(
      addNozzle(group, M, { x: side * 0.56, y: Y, z: 8.3, radius: 0.42, length: 0.85, flameLength: 2.3 }),
    );
  });

  /* 垂尾间减速板 */
  addBox(group, M.jetDark, 0.7, 0.5, 0.1, 0, Y + 0.7, 7.4, { castShadow: false });

  /* 尾钩 */
  addBox(group, M.steelDark, 0.15, 0.13, 1.8, 0, Y - 0.62, 6.5, {
    rotation: [0.34, 0, 0],
    castShadow: true,
  });

  /* 机腹副油箱 */
  addLoft(
    group,
    M.jetWhite,
    [
      { z: -2.0, w: 0.06, h: 0.06, y: 1.0 },
      { z: -1.5, w: 0.18, h: 0.18, y: 1.0 },
      { z: -0.6, w: 0.28, h: 0.28, y: 0.99 },
      { z: 0.8, w: 0.3, h: 0.3, y: 0.98 },
      { z: 2.1, w: 0.24, h: 0.24, y: 0.99 },
      { z: 3.0, w: 0.12, h: 0.12, y: 1.0 },
      { z: 3.4, w: 0.04, h: 0.04, y: 1.0 },
    ],
    { segments: 10, exponent: 2.1 },
  );

  /* 翼下挂架 + AIM-120 */
  [-1, 1].forEach((side) => {
    addStore(group, M, { x: side * 1.72, y: 1.3, z: 0.65, length: 2.5, radius: 0.12 });
  });

  /* 起落架 */
  gearUnits.push(
    makeGearUnit(group, M, {
      attach: [0, 1.12, -5.5],
      drop: 0.82,
      wheelRadius: 0.3,
      wheelWidth: 0.2,
      name: "gear / nose",
    }),
  );
  [-1, 1].forEach((side) => {
    gearUnits.push(
      makeGearUnit(group, M, {
        attach: [side * 1.18, 1.42, 0.9],
        drop: 1.04,
        wheelRadius: 0.38,
        wheelWidth: 0.26,
        name: "gear / main",
      }),
    );
  });

  /* 小细节：机头空速管 / 天线 */
  addCylinder(group, M.steel, 0.025, 0.025, 0.45, 0, Y - 0.1, -8.62, {
    rotation: [HALF_PI, 0, 0],
    radialSegments: 4,
    castShadow: false,
  });

  const setFold = (t) => {
    const k = smoothstep(clamp01(t));
    for (const panel of foldPanels) panel.hinge.rotation.z = panel.side * 1.92 * k;
  };

  return {
    group,
    spec: AIRCRAFT_SPECS.fa18,
    setFold,
    setGear: makeGearDriver(gearUnits),
    setBurner: makeBurner(nozzles),
    rotors: [],
  };
}

/* ══════════════════════════════════════════════════════════
   F-14D Tomcat
   setFold: 可变后掠翼，t=0 展开(≈20° 前缘后掠)，t=1 后掠(60° 转轴)。
   ══════════════════════════════════════════════════════════ */

function buildF14(M) {
  const group = new THREE.Group();
  group.name = "AIRCRAFT / F-14D";

  const Y = 1.78;
  const wingY = 1.98;
  const pivotX = 1.95;
  const gearUnits = [];
  const nozzles = [];

  /* 机身：宽扁的升力体 */
  addLoft(
    group,
    M.jet,
    [
      { z: -7.55, w: 0.44, h: 0.34, y: Y - 0.1 },
      { z: -6.6, w: 0.6, h: 0.44, y: Y - 0.06 },
      { z: -5.4, w: 0.76, h: 0.5, y: Y - 0.02 },
      { z: -4.2, w: 0.92, h: 0.54, y: Y },
      { z: -2.8, w: 1.08, h: 0.57, y: Y + 0.02 },
      { z: -1.2, w: 1.24, h: 0.6, y: Y + 0.02 },
      { z: 0.6, w: 1.34, h: 0.62, y: Y + 0.02 },
      { z: 2.4, w: 1.34, h: 0.6, y: Y + 0.02 },
      { z: 4.6, w: 1.26, h: 0.56, y: Y + 0.02 },
      { z: 6.6, w: 1.12, h: 0.5, y: Y + 0.02 },
      { z: 8.2, w: 0.96, h: 0.44, y: Y + 0.02 },
      { z: 8.9, w: 0.84, h: 0.38, y: Y + 0.02 },
    ],
    { segments: 12, exponent: 2.7 },
  );

  /* 雷达罩 */
  addLoft(
    group,
    M.jet,
    [
      { z: -9.55, w: 0.04, h: 0.04, y: Y - 0.14 },
      { z: -9.1, w: 0.15, h: 0.13, y: Y - 0.14 },
      { z: -8.5, w: 0.28, h: 0.21, y: Y - 0.13 },
      { z: -7.6, w: 0.43, h: 0.33, y: Y - 0.11 },
    ],
    { segments: 12, exponent: 2.5 },
  );
  // 机头 IRST / 下颌吊舱
  addLoft(
    group,
    M.jetDark,
    [
      { z: -8.6, w: 0.05, h: 0.04, y: Y - 0.34 },
      { z: -8.1, w: 0.16, h: 0.1, y: Y - 0.36 },
      { z: -7.4, w: 0.2, h: 0.13, y: Y - 0.36 },
      { z: -7.0, w: 0.12, h: 0.08, y: Y - 0.34 },
    ],
    { segments: 8, exponent: 2.1 },
  );

  /* 串列双座座舱盖 */
  addLoft(
    group,
    M.canopy,
    [
      { z: -7.4, w: 0.14, h: 0.06, y: Y + 0.42 },
      { z: -6.9, w: 0.28, h: 0.16, y: Y + 0.47 },
      { z: -6.1, w: 0.36, h: 0.22, y: Y + 0.5 },
      { z: -5.2, w: 0.38, h: 0.24, y: Y + 0.5 },
      { z: -4.2, w: 0.36, h: 0.23, y: Y + 0.48 },
      { z: -3.3, w: 0.28, h: 0.16, y: Y + 0.42 },
      { z: -2.9, w: 0.18, h: 0.05, y: Y + 0.36 },
    ],
    { segments: 10, exponent: 2.05, castShadow: false },
  );
  // 座舱盖分割框
  addBox(group, M.jetDark, 0.6, 0.06, 0.08, 0, Y + 0.66, -5.1, { castShadow: false });

  /* 固定翼套（glove） */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.9, -2.9],
        [side * 2.25, -1.5],
        [side * 2.25, 1.9],
        [side * 0.9, 2.4],
      ],
      { thickness: 0.16, position: [0, wingY, 0] },
    );
  });

  /* 进气道 */
  [-1, 1].forEach((side) => {
    addBox(group, M.jet, 0.5, 0.92, 4.4, side * 1.5, Y - 0.28, -1.4, { castShadow: true });
    addBox(group, M.black, 0.46, 0.84, 0.12, side * 1.5, Y - 0.28, -3.66, { castShadow: false });
  });

  /* 可动翼（后掠） */
  const wingPivots = [];
  [-1, 1].forEach((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * pivotX, wingY, 0.1);
    group.add(pivot);

    addPlate(
      pivot,
      M.jet,
      [
        [0, -2.45],
        [side * 7.8, 0.45],
        [side * 7.8, 1.75],
        [0, 2.7],
      ],
      { thickness: 0.17 },
    );
    // 翼尖挂轨
    addBox(pivot, M.jetDark, 0.12, 0.12, 1.4, side * 7.75, -0.02, 1.0, { castShadow: false });
    // 后缘襟翼缝
    addBox(pivot, M.jetDark, 0.1, 0.09, 5.2, side * 3.4, -0.02, 2.2, { castShadow: false });

    wingPivots.push({ pivot, side });
  });

  /* 发动机短舱（后机身两侧） */
  [-1, 1].forEach((side) => {
    addLoft(
      group,
      M.jet,
      [
        { z: 1.4, w: 0.5, h: 0.44, y: Y - 0.3 },
        { z: 3.2, w: 0.6, h: 0.52, y: Y - 0.32 },
        { z: 5.6, w: 0.64, h: 0.55, y: Y - 0.32 },
        { z: 7.8, w: 0.62, h: 0.52, y: Y - 0.3 },
        { z: 8.9, w: 0.56, h: 0.46, y: Y - 0.28 },
      ],
      { segments: 10, exponent: 2.2, position: [side * 0.92, 0, 0] },
    );
    nozzles.push(
      addNozzle(group, M, {
        x: side * 0.92,
        y: Y - 0.28,
        z: 9.32,
        radius: 0.5,
        length: 0.8,
        flameLength: 2.6,
      }),
    );
  });

  /* 双垂尾（外倾 6°） */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [3.4, 0],
        [8.2, 0],
        [8.25, 2.7],
        [6.55, 2.75],
      ],
      {
        u: [0, 0, 1],
        v: [0, 1, 0],
        thickness: 0.15,
        position: [side * 2.16, Y + 0.4, 0],
        rotation: [0, 0, -side * 0.11],
      },
    );
  });

  /* 平尾（位于双发之间） */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.6, 5.9],
        [side * 4.55, 7.3],
        [side * 4.55, 8.35],
        [side * 0.6, 8.55],
      ],
      { thickness: 0.14, position: [0, Y + 0.1, 0] },
    );
  });

  /* 腹鳍 */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [5.6, 0],
        [7.5, 0],
        [7.4, -0.95],
        [6.2, -0.85],
      ],
      {
        u: [0, 0, 1],
        v: [0, 1, 0],
        thickness: 0.1,
        position: [side * 1.0, Y - 0.55, 0],
        rotation: [0, 0, side * 0.24],
      },
    );
  });

  /* 尾钩 */
  addBox(group, M.steelDark, 0.16, 0.14, 1.9, 0, Y - 0.66, 6.9, {
    rotation: [0.36, 0, 0],
    castShadow: true,
  });

  /* 翼下挂架 + AIM-54 级别的大型导弹 */
  [-1, 1].forEach((side) => {
    addStore(group, M, { x: side * 1.5, y: 1.72, z: 0.6, length: 3.4, radius: 0.17, pylonHeight: 0.22 });
  });
  // 机腹双挂（F-14 典型）
  [-1, 1].forEach((side) => {
    addStore(group, M, { x: side * 0.55, y: Y - 0.72, z: 1.1, length: 2.8, radius: 0.15, pylonHeight: 0.16 });
  });

  /* 起落架 */
  gearUnits.push(
    makeGearUnit(group, M, {
      attach: [0, 1.25, -7.0],
      drop: 0.93,
      wheelRadius: 0.32,
      wheelWidth: 0.22,
      name: "gear / nose",
    }),
  );
  [-1, 1].forEach((side) => {
    gearUnits.push(
      makeGearUnit(group, M, {
        attach: [side * 1.32, 1.55, 0.8],
        drop: 1.15,
        wheelRadius: 0.4,
        wheelWidth: 0.28,
        name: "gear / main",
      }),
    );
  });

  const setFold = (t) => {
    const k = smoothstep(clamp01(t));
    for (const wing of wingPivots) wing.pivot.rotation.y = -wing.side * 0.98 * k;
  };

  return {
    group,
    spec: AIRCRAFT_SPECS.f14,
    setFold,
    setGear: makeGearDriver(gearUnits),
    setBurner: makeBurner(nozzles),
    rotors: [],
  };
}

/* ══════════════════════════════════════════════════════════
   E-2C Hawkeye
   setFold: 螺旋桨外侧的外翼段绕立轴向后折（约 93°），并略微上翘。
   ══════════════════════════════════════════════════════════ */

function buildE2C(M) {
  const group = new THREE.Group();
  group.name = "AIRCRAFT / E-2C";

  const Y = 1.95;
  const wingY = 3.05;
  const hingeX = 8.3;
  const gearUnits = [];
  const rotors = [];

  /* 机身：方截面 */
  addLoft(
    group,
    M.jet,
    [
      { z: -8.8, w: 0.05, h: 0.05, y: Y + 0.05 },
      { z: -8.2, w: 0.3, h: 0.26, y: Y + 0.02 },
      { z: -7.2, w: 0.6, h: 0.5, y: Y },
      { z: -5.9, w: 0.86, h: 0.7, y: Y },
      { z: -4.2, w: 1.03, h: 0.8, y: Y },
      { z: -2.0, w: 1.13, h: 0.86, y: Y },
      { z: 1.0, w: 1.16, h: 0.88, y: Y },
      { z: 4.0, w: 1.1, h: 0.84, y: Y },
      { z: 6.4, w: 0.96, h: 0.74, y: Y },
      { z: 7.8, w: 0.74, h: 0.56, y: Y },
      { z: 8.8, w: 0.34, h: 0.3, y: Y + 0.05 },
    ],
    { segments: 12, exponent: 3.0 },
  );

  /* 驾驶舱（上前方） */
  addLoft(
    group,
    M.canopy,
    [
      { z: -7.9, w: 0.2, h: 0.08, y: Y + 0.68 },
      { z: -7.3, w: 0.42, h: 0.24, y: Y + 0.74 },
      { z: -6.4, w: 0.52, h: 0.3, y: Y + 0.76 },
      { z: -5.5, w: 0.5, h: 0.26, y: Y + 0.72 },
      { z: -5.0, w: 0.36, h: 0.1, y: Y + 0.66 },
    ],
    { segments: 10, exponent: 2.2, castShadow: false },
  );

  /* 主翼：内侧固定段 */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.9, -2.1],
        [side * hingeX, -1.6],
        [side * hingeX, 1.45],
        [side * 0.9, 1.6],
      ],
      { thickness: 0.24, position: [0, wingY, 0] },
    );
  });

  /* 外翼段（后折） */
  const foldPanels = [];
  [-1, 1].forEach((side) => {
    const hinge = new THREE.Group();
    hinge.position.set(side * hingeX, wingY, 0);
    group.add(hinge);

    const panel = new THREE.Group();
    hinge.add(panel);

    addPlate(
      panel,
      M.jet,
      [
        [0, -1.6],
        [side * 4.0, -0.9],
        [side * 4.0, 1.3],
        [0, 1.45],
      ],
      { thickness: 0.22 },
    );
    // 翼尖航行灯
    addBox(panel, M.white, 0.16, 0.16, 0.3, side * 3.95, 0.02, 1.1, { castShadow: false });

    foldPanels.push({ hinge, panel, side });
  });

  /* 发动机短舱 + 螺旋桨 */
  [-1, 1].forEach((side) => {
    addLoft(
      group,
      M.jetWhite,
      [
        { z: -4.0, w: 0.42, h: 0.42, y: wingY },
        { z: -3.4, w: 0.55, h: 0.55, y: wingY },
        { z: -2.0, w: 0.58, h: 0.58, y: wingY },
        { z: -0.6, w: 0.5, h: 0.5, y: wingY },
        { z: 0.6, w: 0.3, h: 0.3, y: wingY },
      ],
      { segments: 10, exponent: 2.0, position: [side * 6.9, 0, 0] },
    );

    // 螺旋桨：局部 Z 即转轴
    const spinner = new THREE.Group();
    spinner.position.set(side * 6.9, wingY, -4.02);
    group.add(spinner);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.85, 10), M.jetWhite);
    nose.rotation.x = -HALF_PI;
    nose.position.z = -0.42;
    nose.castShadow = true;
    spinner.add(nose);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 10), M.steelDark);
    hub.rotation.x = HALF_PI;
    hub.castShadow = true;
    spinner.add(hub);

    for (let i = 0; i < 6; i++) {
      const bladePivot = new THREE.Group();
      bladePivot.rotation.z = (i / 6) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.85, 0.07), M.black);
      blade.position.y = 1.12;
      blade.castShadow = true;
      bladePivot.add(blade);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.075), M.warning);
      tip.position.y = 1.96;
      tip.castShadow = false;
      bladePivot.add(tip);
      spinner.add(bladePivot);
    }

    rotors.push({
      object: spinner,
      speed: side > 0 ? 9 : -9,
      axis: "z",
      label: side > 0 ? "prop / right" : "prop / left",
    });
  });

  /* 旋转雷达罩 + 4 根支柱 */
  const radomeProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(2.1, 0.06),
    new THREE.Vector2(3.25, 0.32),
    new THREE.Vector2(3.5, 0.6),
    new THREE.Vector2(2.9, 0.86),
    new THREE.Vector2(1.4, 1.0),
    new THREE.Vector2(0.0, 1.02),
  ];
  const radomeGroup = new THREE.Group();
  radomeGroup.position.set(0, 3.66, 0.7);
  group.add(radomeGroup);
  const radome = new THREE.Mesh(new THREE.LatheGeometry(radomeProfile, 18), M.radome);
  radome.castShadow = true;
  radome.receiveShadow = true;
  radomeGroup.add(radome);
  // 罩底支架梁
  addBox(radomeGroup, M.steelDark, 2.6, 0.08, 0.16, 0, 0.02, 0, { castShadow: false });

  [-1, 1].forEach((side) => {
    const front = [side * 1.45, 3.55, 0.28];
    const rear = [side * 1.45, 3.55, 1.12];
    cylinderBetween(group, M.steelDark, [side * 0.85, Y + 0.5, -0.35], front, 0.085, {
      radialSegments: 6,
    });
    cylinderBetween(group, M.steelDark, [side * 0.85, Y + 0.5, 1.75], rear, 0.085, {
      radialSegments: 6,
    });
  });

  /* 水平尾翼 + 4 片垂尾 */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.5, 6.2],
        [side * 3.7, 7.0],
        [side * 3.7, 8.2],
        [side * 0.5, 8.6],
      ],
      { thickness: 0.18, position: [0, Y + 0.6, 0] },
    );
  });
  [
    [1.15, 0],
    [2.75, 0.08],
    [-1.15, 0],
    [-2.75, 0.08],
  ].forEach(([x]) => {
    addPlate(
      group,
      M.jet,
      [
        [6.4, 0],
        [8.5, 0],
        [8.55, 2.9],
        [7.5, 2.9],
      ],
      {
        u: [0, 0, 1],
        v: [0, 1, 0],
        thickness: 0.16,
        position: [x, Y + 0.62, 0],
      },
    );
  });

  /* 起落架 */
  gearUnits.push(
    makeGearUnit(group, M, {
      attach: [0, 1.3, -6.6],
      drop: 0.98,
      wheelRadius: 0.32,
      wheelWidth: 0.24,
      name: "gear / nose",
    }),
  );
  [-1, 1].forEach((side) => {
    gearUnits.push(
      makeGearUnit(group, M, {
        attach: [side * 1.4, 1.5, 1.6],
        drop: 1.13,
        wheelRadius: 0.37,
        wheelWidth: 0.28,
        name: "gear / main",
      }),
    );
  });

  const setFold = (t) => {
    const k = smoothstep(clamp01(t));
    for (const { hinge, panel, side } of foldPanels) {
      hinge.rotation.y = -side * 1.62 * k;
      panel.rotation.z = side * 0.12 * k;
    }
  };

  return {
    group,
    spec: AIRCRAFT_SPECS.e2c,
    setFold,
    setGear: makeGearDriver(gearUnits),
    setBurner: () => {},
    rotors,
  };
}

/* ══════════════════════════════════════════════════════════
   EA-6B Prowler
   setFold: 外翼段（发动机短舱外侧）绕顺机身铰链向上折起。
   ══════════════════════════════════════════════════════════ */

function buildEA6B(M) {
  const group = new THREE.Group();
  group.name = "AIRCRAFT / EA-6B";

  const Y = 1.85;
  const wingY = 1.74;
  const hingeX = 4.6;
  const gearUnits = [];

  /* 机身 */
  addLoft(
    group,
    M.jet,
    [
      { z: -9.1, w: 0.04, h: 0.04, y: Y },
      { z: -8.6, w: 0.16, h: 0.14, y: Y },
      { z: -7.9, w: 0.32, h: 0.26, y: Y },
      { z: -7.0, w: 0.5, h: 0.4, y: Y },
      { z: -5.8, w: 0.68, h: 0.55, y: Y },
      { z: -4.4, w: 0.82, h: 0.68, y: Y },
      { z: -2.8, w: 0.9, h: 0.76, y: Y },
      { z: -0.8, w: 0.95, h: 0.82, y: Y },
      { z: 1.6, w: 0.95, h: 0.83, y: Y },
      { z: 4.2, w: 0.9, h: 0.78, y: Y },
      { z: 6.4, w: 0.8, h: 0.68, y: Y },
      { z: 8.0, w: 0.62, h: 0.5, y: Y },
      { z: 9.1, w: 0.3, h: 0.26, y: Y },
    ],
    { segments: 12, exponent: 2.8 },
  );

  /* 4 座长座舱盖 + 框架 */
  addLoft(
    group,
    M.canopy,
    [
      { z: -7.6, w: 0.18, h: 0.07, y: Y + 0.5 },
      { z: -7.0, w: 0.34, h: 0.2, y: Y + 0.56 },
      { z: -6.2, w: 0.44, h: 0.27, y: Y + 0.58 },
      { z: -5.0, w: 0.46, h: 0.28, y: Y + 0.58 },
      { z: -3.8, w: 0.42, h: 0.24, y: Y + 0.54 },
      { z: -3.2, w: 0.28, h: 0.08, y: Y + 0.48 },
    ],
    { segments: 10, exponent: 2.1, castShadow: false },
  );
  [-6.4, -5.4, -4.4].forEach((z) => {
    addBox(group, M.jetDark, 0.82, 0.05, 0.07, 0, Y + 0.78, z, { castShadow: false });
  });

  /* 两侧大进气道 */
  [-1, 1].forEach((side) => {
    addBox(group, M.jet, 0.44, 0.86, 2.8, side * 1.0, Y - 0.06, -3.9, { castShadow: true });
    addBox(group, M.black, 0.4, 0.78, 0.1, side * 1.0, Y - 0.06, -5.26, { castShadow: false });
  });

  /* 内翼段 */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.9, -1.85],
        [side * hingeX, -1.0],
        [side * hingeX, 2.45],
        [side * 0.9, 2.62],
      ],
      { thickness: 0.2, position: [0, wingY, 0] },
    );
  });

  /* 外翼段（上折） */
  const foldPanels = [];
  [-1, 1].forEach((side) => {
    const hinge = new THREE.Group();
    hinge.position.set(side * hingeX, wingY, 0);
    group.add(hinge);

    addPlate(
      hinge,
      M.jet,
      [
        [0, -1.0],
        [side * 3.5, -0.3],
        [side * 3.5, 1.8],
        [0, 2.45],
      ],
      { thickness: 0.18 },
    );
    addBox(hinge, M.jetDark, 0.1, 0.09, 2.6, side * 1.7, -0.02, 2.1, { castShadow: false });

    foldPanels.push({ hinge, side });
  });

  /* 发动机短舱（翼根下方） */
  [-1, 1].forEach((side) => {
    addLoft(
      group,
      M.jet,
      [
        { z: 1.2, w: 0.42, h: 0.38, y: Y - 0.42 },
        { z: 3.4, w: 0.52, h: 0.46, y: Y - 0.44 },
        { z: 6.4, w: 0.52, h: 0.46, y: Y - 0.44 },
        { z: 8.6, w: 0.48, h: 0.42, y: Y - 0.42 },
        { z: 9.2, w: 0.4, h: 0.34, y: Y - 0.4 },
      ],
      { segments: 10, exponent: 2.2, position: [side * 1.3, 0, 0] },
    );
    addCylinder(group, M.black, 0.3, 0.32, 0.35, side * 1.3, Y - 0.4, 9.18, {
      rotation: [HALF_PI, 0, 0],
      radialSegments: 10,
      castShadow: false,
    });
  });

  /* 垂尾 + 顶部 ALQ-99 吊舱 */
  addPlate(
    group,
    M.jet,
    [
      [4.2, 0],
      [8.9, 0],
      [9.0, 2.35],
      [6.8, 2.4],
    ],
    {
      u: [0, 0, 1],
      v: [0, 1, 0],
      thickness: 0.2,
      position: [0, Y + 0.62, 0],
    },
  );
  addLoft(
    group,
    M.jetWhite,
    [
      { z: -0.9, w: 0.05, h: 0.05, y: Y + 2.82 },
      { z: -0.5, w: 0.28, h: 0.2, y: Y + 2.82 },
      { z: 0.4, w: 0.4, h: 0.26, y: Y + 2.82 },
      { z: 1.3, w: 0.32, h: 0.22, y: Y + 2.82 },
      { z: 1.7, w: 0.05, h: 0.05, y: Y + 2.82 },
    ],
    { segments: 10, exponent: 2.1, position: [0, 0, 6.3] },
  );

  /* 水平尾翼（低位） */
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.55, 6.6],
        [side * 3.6, 7.4],
        [side * 3.6, 8.5],
        [side * 0.55, 8.9],
      ],
      { thickness: 0.16, position: [0, Y + 0.12, 0] },
    );
  });

  /* 翼下干扰吊舱 ×2 */
  [-1, 1].forEach((side) => {
    addBox(group, M.jet, 0.14, 0.26, 1.2, side * 3.2, 1.62, 0.6, { castShadow: false });
    addLoft(
      group,
      M.jetWhite,
      [
        { z: -1.75, w: 0.05, h: 0.05, y: 1.34 },
        { z: -1.4, w: 0.2, h: 0.18, y: 1.34 },
        { z: -0.4, w: 0.29, h: 0.26, y: 1.34 },
        { z: 0.8, w: 0.29, h: 0.26, y: 1.34 },
        { z: 1.5, w: 0.16, h: 0.14, y: 1.34 },
        { z: 1.75, w: 0.04, h: 0.04, y: 1.34 },
      ],
      { segments: 8, exponent: 2.1, position: [side * 3.2, 0, 0.6] },
    );
  });

  /* 起落架 */
  gearUnits.push(
    makeGearUnit(group, M, {
      attach: [0, 1.28, -7.1],
      drop: 0.97,
      wheelRadius: 0.31,
      wheelWidth: 0.24,
      name: "gear / nose",
    }),
  );
  [-1, 1].forEach((side) => {
    gearUnits.push(
      makeGearUnit(group, M, {
        attach: [side * 1.42, 1.52, 0.9],
        drop: 1.14,
        wheelRadius: 0.38,
        wheelWidth: 0.3,
        name: "gear / main",
      }),
    );
  });

  const setFold = (t) => {
    const k = smoothstep(clamp01(t));
    for (const panel of foldPanels) panel.hinge.rotation.z = panel.side * 1.55 * k;
  };

  return {
    group,
    spec: AIRCRAFT_SPECS.ea6b,
    setFold,
    setGear: makeGearDriver(gearUnits),
    setBurner: () => {},
    rotors: [],
  };
}

/* ══════════════════════════════════════════════════════════
   SH-3 Sea King
   setFold: 5 片主旋翼绕各自根部立轴向后收拢（对齐尾梁方向）。
   ══════════════════════════════════════════════════════════ */

function buildSH3(M) {
  const group = new THREE.Group();
  group.name = "AIRCRAFT / SH-3";

  const Y = 1.72;
  const gearUnits = [];
  const rotors = [];

  /* 船形机身 */
  addLoft(
    group,
    M.jet,
    [
      { z: -8.35, w: 0.05, h: 0.06, y: Y + 0.16 },
      { z: -7.8, w: 0.26, h: 0.24, y: Y + 0.06 },
      { z: -7.0, w: 0.55, h: 0.44, y: Y - 0.02 },
      { z: -5.8, w: 0.85, h: 0.62, y: Y - 0.06 },
      { z: -4.2, w: 1.05, h: 0.75, y: Y - 0.06 },
      { z: -1.8, w: 1.14, h: 0.82, y: Y - 0.04 },
      { z: 0.8, w: 1.14, h: 0.84, y: Y - 0.02 },
      { z: 2.9, w: 1.0, h: 0.76, y: Y + 0.02 },
      { z: 4.3, w: 0.72, h: 0.58, y: Y + 0.08 },
    ],
    { segments: 12, exponent: 2.9 },
  );

  /* 尾梁 */
  addLoft(
    group,
    M.jet,
    [
      { z: 3.9, w: 0.5, h: 0.46, y: Y + 0.14 },
      { z: 5.6, w: 0.4, h: 0.38, y: Y + 0.24 },
      { z: 7.0, w: 0.28, h: 0.28, y: Y + 0.34 },
      { z: 8.3, w: 0.16, h: 0.17, y: Y + 0.44 },
    ],
    { segments: 10, exponent: 2.4 },
  );

  /* 驾驶舱 + 舷窗 */
  addLoft(
    group,
    M.glass,
    [
      { z: -7.4, w: 0.16, h: 0.1, y: Y + 0.28 },
      { z: -6.9, w: 0.4, h: 0.26, y: Y + 0.3 },
      { z: -6.1, w: 0.55, h: 0.34, y: Y + 0.3 },
      { z: -5.4, w: 0.56, h: 0.3, y: Y + 0.28 },
      { z: -5.05, w: 0.36, h: 0.12, y: Y + 0.22 },
    ],
    { segments: 10, exponent: 2.3, castShadow: false },
  );
  [-3.6, -2.3, -1.0, 0.3].forEach((z) => {
    [-1, 1].forEach((side) => {
      addBox(group, M.glassDark, 0.06, 0.34, 0.7, side * 1.12, Y + 0.36, z, {
        castShadow: false,
      });
    });
  });

  /* 两侧浮筒（sponson） */
  [-1, 1].forEach((side) => {
    addLoft(
      group,
      M.jetWhite,
      [
        { z: -2.9, w: 0.3, h: 0.22, y: Y - 0.62 },
        { z: -2.0, w: 0.46, h: 0.32, y: Y - 0.66 },
        { z: 1.2, w: 0.5, h: 0.34, y: Y - 0.66 },
        { z: 2.8, w: 0.34, h: 0.24, y: Y - 0.62 },
        { z: 3.3, w: 0.1, h: 0.1, y: Y - 0.58 },
      ],
      { segments: 10, exponent: 2.4, position: [side * 1.3, 0, 0] },
    );
  });

  /* 发动机/减速器整流罩（doghouse） */
  addLoft(
    group,
    M.jet,
    [
      { z: -2.9, w: 0.5, h: 0.18, y: Y + 0.9 },
      { z: -1.8, w: 0.76, h: 0.34, y: Y + 0.94 },
      { z: 0.2, w: 0.8, h: 0.38, y: Y + 0.96 },
      { z: 1.8, w: 0.72, h: 0.3, y: Y + 0.92 },
      { z: 2.8, w: 0.46, h: 0.16, y: Y + 0.86 },
    ],
    { segments: 10, exponent: 2.3 },
  );
  // 排气口
  [-1, 1].forEach((side) => {
    addCylinder(group, M.black, 0.18, 0.2, 0.4, side * 0.66, Y + 1.02, 1.1, {
      rotation: [HALF_PI, 0, 0],
      radialSegments: 8,
      castShadow: false,
    });
  });

  /* 主旋翼：wrapper 把局部 Z 对准机体 Y */
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 2.0, 8), M.steelDark);
  mast.position.set(0, Y + 2.32, 0.35);
  mast.castShadow = true;
  group.add(mast);

  const rotorMount = new THREE.Group();
  rotorMount.position.set(0, Y + 3.3, 0.35);
  rotorMount.rotation.x = -HALF_PI; // 局部 +Z → 机体 +Y
  group.add(rotorMount);

  const mainRotor = new THREE.Group();
  rotorMount.add(mainRotor);

  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.3, 10), M.steel);
  hubCap.rotation.x = HALF_PI;
  hubCap.castShadow = true;
  mainRotor.add(hubCap);

  const bladePivots = [];
  for (let i = 0; i < 5; i++) {
    const azimuth = (i / 5) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.rotation.z = azimuth;
    mainRotor.add(pivot);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.16), M.steelDark);
    grip.position.y = 0.6;
    grip.castShadow = true;
    pivot.add(grip);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 8.3, 0.1), M.jetDark);
    blade.position.y = 5.05;
    blade.castShadow = true;
    blade.receiveShadow = true;
    pivot.add(blade);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.5, 0.09), M.warning);
    tip.position.y = 9.25;
    tip.castShadow = false;
    pivot.add(tip);

    bladePivots.push({ pivot, azimuth, stagger: i * 0.055 });
  }

  rotors.push({ object: mainRotor, speed: 3.4, axis: "z", label: "rotor / main" });

  /* 垂尾 + 平尾 */
  addPlate(
    group,
    M.jet,
    [
      [6.3, 0],
      [8.35, 0],
      [8.3, 1.9],
      [7.0, 2.0],
    ],
    {
      u: [0, 0, 1],
      v: [0, 1, 0],
      thickness: 0.16,
      position: [0, Y + 0.5, 0],
    },
  );
  [-1, 1].forEach((side) => {
    addPlate(
      group,
      M.jet,
      [
        [side * 0.1, 6.5],
        [side * 2.3, 6.9],
        [side * 2.3, 7.5],
        [side * 0.1, 7.6],
      ],
      { thickness: 0.12, position: [0, Y + 0.5, 0] },
    );
  });

  /* 尾桨：wrapper 把局部 Z 对准机体 X */
  const tailMount = new THREE.Group();
  tailMount.position.set(-0.34, Y + 1.62, 7.75);
  tailMount.rotation.y = HALF_PI; // 局部 +Z → 机体 +X
  group.add(tailMount);

  const tailRotor = new THREE.Group();
  tailMount.add(tailRotor);

  const tailHub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.24, 8), M.steelDark);
  tailHub.rotation.x = HALF_PI;
  tailHub.castShadow = true;
  tailRotor.add(tailHub);

  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 4) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.15, 0.07), M.jetDark);
    blade.position.y = 0.66;
    blade.castShadow = true;
    pivot.add(blade);
    tailRotor.add(pivot);
  }

  rotors.push({ object: tailRotor, speed: 14, axis: "z", label: "rotor / tail" });

  /* 起落架 */
  gearUnits.push(
    makeGearUnit(group, M, {
      attach: [0, 0.98, -6.1],
      drop: 0.68,
      wheelRadius: 0.3,
      wheelWidth: 0.2,
      name: "gear / nose",
    }),
  );
  [-1, 1].forEach((side) => {
    gearUnits.push(
      makeGearUnit(group, M, {
        attach: [side * 1.05, 0.92, 1.3],
        drop: 0.58,
        wheelRadius: 0.34,
        wheelWidth: 0.24,
        name: "gear / main",
      }),
    );
  });

  /* 救援绞盘 / 天线等小件 */
  addBox(group, M.steelDark, 0.22, 0.22, 0.4, 1.1, Y + 0.88, 3.2, { castShadow: false });

  const setFold = (t) => {
    const k = smoothstep(clamp01(t));
    for (const { pivot, azimuth, stagger } of bladePivots) {
      // 折叠目标：局部 -Y（= 机体 +Z 即尾梁方向）
      pivot.rotation.z = lerp(azimuth, -HALF_PI + stagger, k);
    }
  };

  return {
    group,
    spec: AIRCRAFT_SPECS.sh3,
    setFold,
    setGear: makeGearDriver(gearUnits),
    setBurner: () => {},
    rotors,
  };
}

/* ══════════════════════════════════════════════════════════
   入口
   ══════════════════════════════════════════════════════════ */

const BUILDERS = {
  fa18: buildFA18,
  f14: buildF14,
  e2c: buildE2C,
  ea6b: buildEA6B,
  sh3: buildSH3,
};

/** 把 true/false/0..1 统一成 0..1 的插值参数 */
function toUnit(value, fallback = 0) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Number.isFinite(value)) return clamp01(value);
  return fallback;
}

/**
 * 生成一架舰载机。
 * @param {"fa18"|"f14"|"e2c"|"ea6b"|"sh3"} type
 * @param {object} M createMaterials() 返回的共享材质集
 * @param {{ folded?: boolean|number, gear?: boolean|number, scale?: number }} options
 * @returns {THREE.Group}
 */
export function createAircraft(type, M, options = {}) {
  const builder = BUILDERS[type] ?? BUILDERS.fa18;
  const craft = builder(M);
  const group = craft.group;

  const scale = Number.isFinite(options.scale) ? options.scale : 1;
  if (scale !== 1) group.scale.setScalar(scale);

  const foldTarget = options.folded === undefined ? 0 : toUnit(options.folded, 0);
  const gearTarget = options.gear === undefined ? 1 : toUnit(options.gear, 1);

  const setFold = (t) => craft.setFold(toUnit(t, 0));
  const setGear = (t) => craft.setGear(toUnit(t, 1));
  const setBurner = (t) => craft.setBurner(toUnit(t, 0));

  setFold(foldTarget);
  setGear(gearTarget);
  setBurner(0);

  group.userData = {
    type,
    spec: { ...craft.spec },
    setFold,
    setGear,
    setBurner,
    rotors: craft.rotors,
  };

  return group;
}
