import * as THREE from "three";
import { COLORS, DECK_OUTLINE, ELEVATORS, HULL_DETAILS, SHIP } from "./constants.js";
import {
  CV63_PARAMS,
  HULL_SECTION_SEQ,
  LENGTH_SCALE,
  VERTICAL,
  verticalMapY,
} from "./params.js";
import { addBox, addCylinder, addLineSegments, clamp01, smoothstep } from "./geometry.js";
import { makeTextTexture } from "./materials.js";

/**
 * 舰体（外板 + 舷侧折角线以上结构带 + 艏艉端面）
 *
 * 重构要点：
 *  1. 纵向型线来自参考参数表的 12 个控制站位（plan p, 半宽），用样条加密，
 *     不再使用手写的 33 行站位表；
 *  2. 横剖面来自参考模型的 17 点剖面序列（左舷折角线 → 龙骨 → 右舷折角线），
 *     经纵向基准映射后成为真实放样曲面，而不是垂直挤出的二维轮廓；
 *  3. 水线以上保留外飘（折角线半宽 0.83），折角线到甲板下缘之间补齐垂直结构带，
 *     因此飞行甲板外伸段有连续的外板支撑，之前的"壳体顶 18.4 m / 甲板底 18.7 m"
 *     悬空缺口被消除；
 *  4. 水线 / 底漆 / 折角线与板缝线全部由参数推导。
 */

const SECTION_COUNT = Math.max(24, Math.round(CV63_PARAMS.hull.longitudinalSegments));
const PROFILE_SAMPLES = Math.max(24, CV63_PARAMS.hull.sectionSamples ?? 33);
const HULL_TOP = SHIP.hullTopY; // 折角线 +16.9
const HULL_DECK_Y = SHIP.deckUndersideY; // 甲板下缘 +19.4
const KEEL_Y = SHIP.keelY;
const WATERLINE = SHIP.waterline;
const BOOT_TOP = 1.75;

/* ── 纵向型线：参考站位 → 样条 → 按 z 查询 ────────────────── */

const STATION_POINTS = CV63_PARAMS.hull.stations.map(
  ([p, halfBeam]) => new THREE.Vector2(p * LENGTH_SCALE, halfBeam),
);

const BEAM_CURVE = new THREE.SplineCurve(STATION_POINTS);
const BEAM_SAMPLES = (() => {
  const dense = BEAM_CURVE.getPoints(720);
  const list = dense
    .map((point) => ({ z: -point.x, w: Math.max(0, point.y) }))
    .sort((a, b) => a.z - b.z);
  // 去除重复 z，供二分查找
  const out = [];
  for (const item of list) {
    if (!out.length || item.z - out[out.length - 1].z > 1e-4) out.push(item);
  }
  const stationMax = Math.max(...CV63_PARAMS.hull.stations.map((s) => s[1]));
  out.forEach((item) => {
    item.w = Math.min(item.w, stationMax * 1.01);
  });
  return out;
})();

const BOW_Z = BEAM_SAMPLES[0].z;
const STERN_Z = BEAM_SAMPLES[BEAM_SAMPLES.length - 1].z;

/**
 * 龙骨纵向抬升系数（0-1）：参考剖面只给出横向序列，龙骨深度需要按纵向变化，
 * 否则艏艉会是"平底方尾"。控制点按常规船型的艏艉收进给出，
 * 使尾部螺旋桨与舵位于船底以下、艏部形成前踵。
 */
const DRAFT_CONTROL = [
  [BOW_Z, 0.3],
  [BOW_Z + 12, 0.52],
  [BOW_Z + 34, 0.78],
  [BOW_Z + 62, 0.94],
  [-60, 1.0],
  [70, 1.0],
  [112, 0.96],
  [136, 0.86],
  [146, 0.68],
  [151, 0.5],
  [156, 0.34],
  [STERN_Z, 0.28],
];

const DRAFT_CURVE = new THREE.SplineCurve(
  DRAFT_CONTROL.map(([z, f]) => new THREE.Vector2(z, f)),
);

const DRAFT_SAMPLES = DRAFT_CURVE.getPoints(260)
  .map((point) => ({ z: point.x, f: Math.min(1, Math.max(0.25, point.y)) }))
  .sort((a, b) => a.z - b.z);

function draftFactorAt(z) {
  const list = DRAFT_SAMPLES;
  if (z <= list[0].z) return list[0].f;
  if (z >= list[list.length - 1].z) return list[list.length - 1].f;
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].z <= z) lo = mid;
    else hi = mid;
  }
  const a = list[lo];
  const b = list[hi];
  return THREE.MathUtils.lerp(a.f, b.f, (z - a.z) / (b.z - a.z || 1));
}

/** 指定 z 处的龙骨高度（用于轴系、舵、螺旋桨落位） */
export function hullKeelYAt(z) {
  return KEEL_Y * draftFactorAt(z);
}

/** 站位的最大半宽，用作样条过冲的上限（保证型宽不超过契约值） */
const MAX_STATION_HALF_BEAM = Math.max(...CV63_PARAMS.hull.stations.map((s) => s[1]));

/** 指定 z 处的型半宽（样条插值，艉部做收进以形成巡洋舰尾） */
export function hullHalfBeamAt(z) {
  const list = BEAM_SAMPLES;
  let raw;
  if (z <= list[0].z) raw = list[0].w;
  else if (z >= list[list.length - 1].z) raw = list[list.length - 1].w;
  else {
    let lo = 0;
    let hi = list.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (list[mid].z <= z) lo = mid;
      else hi = mid;
    }
    const a = list[lo];
    const b = list[hi];
    raw = THREE.MathUtils.lerp(a.w, b.w, (z - a.z) / (b.z - a.z || 1));
  }
  raw = Math.min(raw, MAX_STATION_HALF_BEAM);
  // 艉部收进：最后 14 m 由 1 → 0.88，让方尾变成有收进的巡洋舰尾
  const taperStart = STERN_Z - 14;
  if (z > taperStart) {
    const t = smoothstep((z - taperStart) / 14);
    raw *= 1 - 0.12 * t;
  }
  return raw;
}

/* ── 横剖面：参考剖面序列 → 平滑曲线 ──────────────────────── */

const PROFILE = (() => {
  const curve = new THREE.CatmullRomCurve3(
    HULL_SECTION_SEQ.map(([frac, y]) => new THREE.Vector3(frac, y, 0)),
    false,
    "centripetal",
  );
  // 控制点必须逐个保留（尤其是龙骨点 yRef=-10.9 与折角线点）：
  // 只在控制点之间补插值，避免 getPoints(n) 漏掉控制点造成 5 cm 级的离散误差。
  const spans = HULL_SECTION_SEQ.length - 1;
  const perSpan = Math.max(1, Math.round(PROFILE_SAMPLES / spans));
  const samples = [];
  for (let i = 0; i < spans; i++) {
    for (let s = 0; s < perSpan; s++) {
      samples.push(curve.getPoint((i + s / perSpan) / spans));
    }
  }
  samples.push(curve.getPoint(1));
  // 顺序必须保持"左舷折角线 → 龙骨 → 右舷折角线"，因此只夹紧半宽系数，不排序
  return samples.map((point) => ({
    frac: Math.min(1, Math.max(-1, point.x)),
    yRef: point.y,
  }));
})();

/** 参考 y → 本模型 y（水线以下按龙骨抬升系数缩放），并限制在龙骨与折角线之间 */
function mapProfileY(yRef, draft = 1) {
  const y = yRef <= 0 ? yRef * draft : verticalMapY(yRef);
  return Math.min(Math.max(y, KEEL_Y * draft), HULL_TOP);
}

/** 给定高度（本模型 y），返回舷侧半宽系数（沿右舷半剖面插值） */
function profileFractionAtHeight(y, draft = 1) {
  const yRef = y <= 0 ? y / draft : (y * VERTICAL.referenceChineY) / VERTICAL.chineY;
  if (y >= HULL_TOP) return VERTICAL.topsideFraction;
  let best = { lo: null, hi: null };
  for (let i = 0; i < PROFILE.length; i++) {
    const point = PROFILE[i];
    if (point.frac < -1e-6) continue;
    if (point.yRef <= yRef) best.lo = point;
    if (point.yRef >= yRef && best.hi === null) best.hi = point;
  }
  if (!best.lo) return PROFILE.find((p) => p.frac >= 0)?.frac ?? 0;
  if (!best.hi) return best.lo.frac;
  const span = best.hi.yRef - best.lo.yRef;
  const t = span < 1e-6 ? 0 : (yRef - best.lo.yRef) / span;
  return THREE.MathUtils.lerp(best.lo.frac, best.hi.frac, t);
}

/** 某个 z 处的完整横剖线（左舷甲板下缘 → 龙骨 → 右舷甲板下缘） */
function sectionRing(z, inset = 1) {
  const halfBeam = hullHalfBeamAt(z) * inset;
  const draft = draftFactorAt(z);
  const ring = [];
  // 左舷结构带顶端
  ring.push([-VERTICAL.topsideFraction * halfBeam, HULL_DECK_Y, z]);
  // 左舷折角线 → 龙骨 → 右舷折角线
  for (let i = 0; i < PROFILE.length; i++) {
    const { frac, yRef } = PROFILE[i];
    ring.push([frac * halfBeam, mapProfileY(yRef, draft), z]);
  }
  // 右舷结构带顶端
  ring.push([VERTICAL.topsideFraction * halfBeam, HULL_DECK_Y, z]);
  return ring;
}

const SECTION_Z = (() => {
  const list = [];
  const step = (STERN_Z - BOW_Z) / SECTION_COUNT;
  for (let i = 0; i <= SECTION_COUNT; i++) list.push(BOW_Z + step * i);
  return list;
})();

const SECTIONS = SECTION_Z.map((z) => ({ z, ring: sectionRing(z) }));

/* ── 顶点着色：水线以下防污漆 / 底漆带 / 舷侧灰 ───────────── */

const COLOR_UNDER_DEEP = new THREE.Color(0x452722);
const COLOR_UNDER = new THREE.Color(0x74392f);
const COLOR_BOOT = new THREE.Color(0x1c2023);
const COLOR_BELOW_DECK = new THREE.Color(0x67727a);
const COLOR_HULL = new THREE.Color(COLORS.hull);

function hullVertexColor(y, z, target) {
  if (y < WATERLINE - 0.05) {
    const t = clamp01((y - KEEL_Y) / (WATERLINE - KEEL_Y));
    target.copy(COLOR_UNDER_DEEP).lerp(COLOR_UNDER, Math.pow(t, 0.72));
  } else if (y < BOOT_TOP) {
    target.copy(COLOR_BOOT);
  } else {
    const t = clamp01((y - BOOT_TOP) / (HULL_DECK_Y - BOOT_TOP));
    target.copy(COLOR_BELOW_DECK).lerp(COLOR_HULL, Math.pow(t, 0.62));
  }
  const shade = Math.sin(z * 0.071) * 0.012 + Math.cos(z * 0.031 + y * 0.21) * 0.01;
  target.offsetHSL(0, 0, shade);
  return target;
}

/* ── 外板几何 ─────────────────────────────────────────────── */

function buildHullGeometry() {
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const rings = SECTIONS.map((section) => section.ring);
  const ringN = rings[0].length;
  const sectionN = rings.length;
  const color = new THREE.Color();

  rings.forEach((ring, si) => {
    ring.forEach(([x, y, z], ri) => {
      positions.push(x, y, z);
      const c = hullVertexColor(y, z, color);
      colors.push(c.r, c.g, c.b);
      uvs.push(ri / (ringN - 1), si / (sectionN - 1));
    });
  });

  for (let si = 0; si < sectionN - 1; si++) {
    for (let ri = 0; ri < ringN - 1; ri++) {
      const a = si * ringN + ri;
      const b = (si + 1) * ringN + ri;
      const c = (si + 1) * ringN + ri + 1;
      const d = si * ringN + ri + 1;
      // 环为逆时针、站位按 +Z 递增，故外向法线取 (a,d,b) 顶点序
      indices.push(a, d, b, b, d, c);
    }
  }

  // 艏艉端面：以剖面中心做扇形封口。端面顶点单独复制一份，
  // 避免与舷侧共用顶点导致法线被平滑掉（否则端面会出现放射状假阴影）。
  const capCenters = [
    { index: 0, facing: -1 },
    { index: sectionN - 1, facing: 1 },
  ];
  for (const cap of capCenters) {
    const ring = rings[cap.index];
    const z = SECTIONS[cap.index].z;
    let minY = Infinity;
    let maxY = -Infinity;
    ring.forEach(([, y]) => {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
    const centerY = (minY + maxY) / 2;
    const capStart = positions.length / 3;
    ring.forEach(([x, y], ri) => {
      positions.push(x, y, z);
      const capColor = hullVertexColor(y, z, color);
      colors.push(capColor.r, capColor.g, capColor.b);
      uvs.push(ri / (ringN - 1), cap.facing > 0 ? 1 : 0);
    });
    const centerIndex = positions.length / 3;
    positions.push(0, centerY, z);
    const centerColor = hullVertexColor(centerY, z, color);
    colors.push(centerColor.r, centerColor.g, centerColor.b);
    uvs.push(0.5, 0.5);
    for (let ri = 0; ri < ringN - 1; ri++) {
      const a = capStart + ri;
      const b = capStart + ri + 1;
      if (cap.facing > 0) indices.push(centerIndex, a, b);
      else indices.push(centerIndex, b, a);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ── 查询接口 ─────────────────────────────────────────────── */

/** 甲板以下的最大半宽（用于外挂细节定位） */
export function hullHalfWidthAt(z) {
  return hullHalfBeamAt(z);
}

export function hullSectionAt(z) {
  return { w: hullHalfBeamAt(z), halfBeam: hullHalfBeamAt(z) };
}

/** 舷侧表面在给定高度处的半宽 */
export function hullSurfaceX(z, y) {
  const halfBeam = hullHalfBeamAt(z);
  return halfBeam * profileFractionAtHeight(y, draftFactorAt(z));
}

/** 任意 z 处的横剖线（inset 用于结构骨架内缩） */
export function hullRingAt(z, inset = 1) {
  return sectionRing(z, inset);
}

/** 所有横剖线所在的 z 范围 */
export const HULL_Z_RANGE = [BOW_Z, STERN_Z];

/** 供校验脚本使用：型线与剖面原始数据 */
export const HULL_DEBUG = {
  sectionCount: SECTION_COUNT,
  ringPointCount: SECTIONS[0].ring.length,
  sections: SECTIONS,
  stationZ: STATION_POINTS.map((point) => ({ z: -point.x, halfBeam: point.y })),
};

/* ── 甲板外伸段的支撑与走道 ───────────────────────────────── */

/** 甲板边缘在 z 处的 x（局部复制，避免与 constants 形成循环依赖） */
function deckEdgeLocal(z, side) {
  let best = null;
  for (let i = 0; i < DECK_OUTLINE.length; i++) {
    const a = DECK_OUTLINE[i];
    const b = DECK_OUTLINE[(i + 1) % DECK_OUTLINE.length];
    if ((a[1] - z) * (b[1] - z) > 0) continue;
    if (Math.abs(b[1] - a[1]) < 1e-9) continue;
    const t = (z - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    if (side > 0 ? best === null || x > best : best === null || x < best) best = x;
  }
  return best ?? 0;
}

/**
 * 甲板外伸支撑：横向三角腹板（sponson web frame）+ 甲板外缘纵桁 +
 * 舷侧下弦杆。凹口（升降机井）范围内不布置腹板。
 * 这样外伸 18 m 的飞行甲板有连续的横向传力结构，而不是几根孤立的斜杆。
 */
function buildDeckEdgeSupports(parent, M) {
  const notches = ELEVATORS.map((elevator) => ({
    side: elevator.side,
    z0: elevator.z - elevator.length / 2 - 1.4,
    z1: elevator.z + elevator.length / 2 + 1.4,
  }));
  const inNotch = (side, z) => notches.some((n) => n.side === side && z > n.z0 && z < n.z1);

  const group = new THREE.Group();
  group.name = "HULL / deck-edge supports";
  parent.add(group);

  const bracketMaterial = M.steelDark.clone();
  bracketMaterial.side = THREE.DoubleSide;
  bracketMaterial.roughness = 0.78;

  const stationZ = [];
  for (let z = SHIP.bowZ + 8; z <= SHIP.sternZ - 4; z += 5.5) stationZ.push(z);

  stationZ.forEach((z) => {
    for (const side of [-1, 1]) {
      if (inNotch(side, z)) continue;
      const deckX = deckEdgeLocal(z, side);
      const hullX = side * hullSurfaceX(z, SHIP.deckUndersideY - 0.6);
      const overhang = Math.abs(deckX - hullX);
      if (overhang < 1.4) continue;

      const innerX = deckX - side * 1.0;
      const webDepth = Math.min(6.5, 1.6 + overhang * 0.42);
      const thickness = 0.26;

      // 三角腹板：甲板下缘 → 外缘 → 舷侧下弦
      const positions = [];
      const z0 = z - thickness / 2;
      const z1 = z + thickness / 2;
      for (const zz of [z0, z1]) {
        positions.push(hullX, SHIP.deckUndersideY - 0.05, zz);
        positions.push(innerX, SHIP.deckUndersideY - 0.05, zz);
        positions.push(hullX, SHIP.deckUndersideY - webDepth, zz);
      }
      const indices = [0, 1, 2, 3, 5, 4, 0, 2, 5, 0, 5, 3, 0, 3, 4, 0, 4, 1];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const bracket = new THREE.Mesh(geometry, bracketMaterial);
      bracket.castShadow = false;
      bracket.receiveShadow = true;
      group.add(bracket);

      // 腹板外缘的竖向加强肋
      addBox(group, M.steelDark, 0.4, 1.0, 0.5, innerX - side * 0.2, SHIP.deckUndersideY - 0.55, z, {
        castShadow: false,
      });
    }
  });

  // 甲板外缘纵桁 + 舷侧下弦杆
  const tips = { "-1": [], 1: [] };
  for (const side of [-1, 1]) {
    let previous = null;
    for (let z = SHIP.bowZ + 4; z <= SHIP.sternZ - 2; z += 4) {
      const x = deckEdgeLocal(z, side);
      const current = [x - side * 0.5, SHIP.deckUndersideY - 0.5, z];
      if (previous) {
        const [x0, y0, z0] = previous;
        const [x1, y1, z1] = current;
        const dx = x1 - x0;
        const dz = z1 - z0;
        const length = Math.hypot(dx, dz);
        if (length < 6 && length > 0.5) {
          const mesh = addBox(
            group,
            M.steelDark,
            1.0,
            1.1,
            length + 0.2,
            (x0 + x1) / 2,
            (y0 + y1) / 2,
            (z0 + z1) / 2,
            { castShadow: false },
          );
          mesh.rotation.y = Math.atan2(dx, dz);
        }
      }
      previous = current;
    }
  }

  // 腹板下弦：把相邻腹板的下缘连起来，形成连续的下弦杆
  for (const z of stationZ) {
    for (const side of [-1, 1]) {
      if (inNotch(side, z)) continue;
      const deckX = deckEdgeLocal(z, side);
      const hullX = side * hullSurfaceX(z, SHIP.deckUndersideY - 0.6);
      const overhang = Math.abs(deckX - hullX);
      if (overhang < 1.4) continue;
      const webDepth = Math.min(6.5, 1.6 + overhang * 0.42);
      tips[side].push({ z, hullX, y: SHIP.deckUndersideY - webDepth });
    }
  }
  for (const side of [-1, 1]) {
    const list = tips[side];
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (Math.abs(b.z - a.z) > 7) continue;
      addBox(group, M.steelDark, 0.5, 0.6, Math.abs(b.z - a.z) + 0.2, a.hullX, (a.y + b.y) / 2, (a.z + b.z) / 2, {
        castShadow: false,
      });
    }
  }

  return group;
}

/* ── 板缝与折角线 ─────────────────────────────────────────── */

function buildPlatingLines(parent, material) {
  const points = [];
  const rings = SECTIONS.map((section) => section.ring);
  const ringN = rings[0].length;

  // 纵向板缝（沿剖面序列抽取）
  const seamIndices = [];
  for (let i = 2; i < ringN - 2; i += 3) seamIndices.push(i);
  seamIndices.forEach((ri) => {
    for (let si = 0; si < rings.length - 1; si += 2) {
      const a = rings[si][ri];
      const b = rings[Math.min(si + 2, rings.length - 1)][ri];
      points.push(new THREE.Vector3(...a), new THREE.Vector3(...b));
    }
  });

  // 横向板缝（抽稀）
  for (let si = 0; si < rings.length; si += 5) {
    const ring = rings[si];
    for (let ri = 0; ri < ring.length - 1; ri += 2) {
      points.push(new THREE.Vector3(...ring[ri]), new THREE.Vector3(...ring[ri + 1]));
    }
  }

  // 水线 / 底漆上缘 / 折角线
  const waterline = [];
  const bootTop = [];
  const chine = [];
  for (const z of SECTION_Z) {
    const halfBeam = hullHalfBeamAt(z);
    const draft = draftFactorAt(z);
    for (const side of [-1, 1]) {
      waterline.push(
        new THREE.Vector3(
          side * halfBeam * profileFractionAtHeight(WATERLINE - 0.01, draft),
          WATERLINE + 0.02,
          z,
        ),
      );
      bootTop.push(
        new THREE.Vector3(side * halfBeam * profileFractionAtHeight(BOOT_TOP, draft), BOOT_TOP, z),
      );
      chine.push(new THREE.Vector3(side * halfBeam * VERTICAL.chineFraction, HULL_TOP - 0.05, z));
    }
  }
  for (const line of [waterline, bootTop, chine]) {
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i].z === line[i + 1].z) continue;
      points.push(line[i], line[i + 1]);
    }
  }

  addLineSegments(parent, points, material);
}

/* ── 舷侧细节 ─────────────────────────────────────────────── */

function buildHullOpenings(parent, M) {
  // 舷侧大开口（机库侧门 / 通风口）：全部落在折角线以下的直舷段
  const openings = [
    { side: 1, z: -96, width: 13, height: 5.4 },
    { side: -1, z: -96, width: 13, height: 5.4 },
    { side: 1, z: -24, width: 9, height: 4.4 },
    { side: -1, z: -24, width: 9, height: 4.4 },
    { side: 1, z: 56, width: 11, height: 4.8 },
    { side: -1, z: 56, width: 11, height: 4.8 },
    { side: 1, z: 122, width: 8.6, height: 4.2 },
    { side: -1, z: 122, width: 8.6, height: 4.2 },
  ];
  openings.forEach(({ side, z, width, height }) => {
    const y = HULL_TOP - 4.6;
    const x = side * (hullSurfaceX(z, y) + 0.12);
    // 薄板贴在舷侧外板上：x 向 0.35 m 厚、z 向为开口宽度（不得再绕 Y 旋转，
    // 否则会把板子转到垂直于舷侧、悬在船体外面）。
    addBox(parent, M.black, 0.35, height, width, x, y, z, {
      castShadow: false,
      receiveShadow: false,
    });
    // 开口边框
    for (const yy of [y + height / 2, y - height / 2]) {
      addBox(parent, M.steelDark, 0.5, 0.28, width + 0.8, x, yy, z, { castShadow: false });
    }
    for (const zz of [z - width / 2, z + width / 2]) {
      addBox(parent, M.steelDark, 0.5, height, 0.28, x, y, zz, { castShadow: false });
    }
  });
}

function buildElevatorRails(parent, M) {
  ELEVATORS.forEach((elevator) => {
    const z0 = elevator.z - elevator.length / 2;
    const z1 = elevator.z + elevator.length / 2;
    const x = elevator.side * (Math.abs(elevator.inner) - 0.18);
    for (const z of [z0, z1]) {
      addBox(parent, M.steelDark, 0.4, HULL_DECK_Y - SHIP.hangarY, 0.6, x, (HULL_DECK_Y + SHIP.hangarY) / 2, z, {
        castShadow: false,
      });
    }
    const points = [
      new THREE.Vector3(x, SHIP.hangarY + 0.4, z0),
      new THREE.Vector3(x, SHIP.hangarY + 0.4, z1),
      new THREE.Vector3(x, HULL_DECK_Y - 0.2, z0),
      new THREE.Vector3(x, HULL_DECK_Y - 0.2, z1),
    ];
    addLineSegments(parent, points, M.lineSoft);
  });
}

function buildBoatBays(parent, M) {
  const bays = HULL_DETAILS.boatBays.map(([side, z]) => ({ side, z }));
  bays.forEach(({ z, side }) => {
    const y = HULL_TOP - 5.0;
    const x = side * (hullSurfaceX(z, y) + 0.1);
    addBox(parent, M.black, 0.35, 4.4, 8.4, x, y, z, { castShadow: false });
    addBox(parent, M.steelDark, 0.45, 0.3, 8.8, x + side * 0.05, y + 2.2, z, {
      castShadow: false,
    });
    // 救生艇
    const boat = new THREE.Group();
    boat.position.set(x + side * 0.9, y, z);
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 4.6, 5, 10), M.white);
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = Math.PI / 2;
    hull.scale.set(1, 0.62, 0.8);
    hull.castShadow = true;
    boat.add(hull);
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 4.2, 3, 8), M.warning);
    stripe.rotation.z = Math.PI / 2;
    stripe.rotation.y = Math.PI / 2;
    stripe.position.y = 0.45;
    stripe.scale.set(1, 0.18, 0.7);
    boat.add(stripe);
    parent.add(boat);
  });
}

function buildAnchor(parent, M) {
  [-1, 1].forEach((side) => {
    const z = -128;
    const y = HULL_TOP - 9.0;
    const x = side * (hullSurfaceX(z, y) + 0.18);
    addBox(parent, M.black, 0.3, 3.6, 3.0, x, y, z, { castShadow: false }).rotation.y = Math.PI / 2;
    const group = new THREE.Group();
    group.position.set(x + side * 0.35, y, z);
    group.rotation.y = Math.PI / 2;
    addBox(group, M.steelDark, 0.35, 2.5, 0.5, 0, 0, 0, { castShadow: false });
    addBox(group, M.steelDark, 1.55, 0.3, 0.5, 0, -1.05, 0, { castShadow: false });
    addBox(group, M.steelDark, 0.5, 0.9, 0.4, -0.75, -1.35, 0, { rotation: [0, 0, 0.5], castShadow: false });
    addBox(group, M.steelDark, 0.5, 0.9, 0.4, 0.75, -1.35, 0, { rotation: [0, 0, -0.5], castShadow: false });
    addCylinder(group, M.steel, 0.26, 0.26, 0.5, 0, 1.35, 0, { rotation: [Math.PI / 2, 0, 0] });
    parent.add(group);
  });
}

function buildSternDetails(parent, M) {
  const transomHalf = hullHalfBeamAt(STERN_Z) * VERTICAL.topsideFraction;

  // 舰名：嵌在艉板凹槽里的黑色衬板 + 字牌
  const panelWidth = Math.min(12.0, transomHalf * 2 - 1.5);
  addBox(parent, M.black, panelWidth + 0.6, 2.2, 0.3, 0, 13.0, STERN_Z + 0.08, { castShadow: false });
  const nameTexture = makeTextTexture("KITTY HAWK", {
    width: 1024,
    height: 160,
    font: 'bold 96px "Arial Black", Arial',
    color: "#dfe7ea",
    letterSpacing: 6,
  });
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(panelWidth, panelWidth / 6.4),
    new THREE.MeshBasicMaterial({ map: nameTexture, transparent: true, depthWrite: false, opacity: 0.94 }),
  );
  plate.position.set(0, 13.0, STERN_Z + 0.26);
  parent.add(plate);

  // 艉部舷窗带与艉板加强材
  addBox(parent, M.steelDark, panelWidth + 1.2, 0.26, 0.4, 0, 14.3, STERN_Z + 0.16, { castShadow: false });
  addBox(parent, M.steelDark, panelWidth + 1.2, 0.26, 0.4, 0, 11.7, STERN_Z + 0.16, { castShadow: false });
  for (const x of [-6.0, -2.0, 2.0, 6.0]) {
    addBox(parent, M.steelDark, 0.28, 2.6, 0.3, x, 13.0, STERN_Z + 0.1, { castShadow: false });
  }
  // 艉部平台
  addBox(parent, M.steelDark, Math.min(12.5, transomHalf * 2 - 2), 0.5, 3.0, 0, HULL_DECK_Y - 1.2, STERN_Z - 2.4, {
    castShadow: false,
  });
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function buildHull(parent, ctx) {
  const M = ctx.materials;
  const material = M.hull.clone();
  material.vertexColors = true;
  material.roughness = 0.62;
  material.metalness = 0.32;

  const geometry = buildHullGeometry();
  const hull = new THREE.Mesh(geometry, material);
  hull.name = "HULL / shell";
  hull.castShadow = true;
  hull.receiveShadow = true;
  parent.add(hull);

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x9fc4d4,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 32), edgeMaterial);
  parent.add(edges);

  buildPlatingLines(
    parent,
    new THREE.LineBasicMaterial({ color: 0x8fb6c6, transparent: true, opacity: 0.1, depthWrite: false }),
  );
  buildHullOpenings(parent, M);
  buildElevatorRails(parent, M);
  buildBoatBays(parent, M);
  buildAnchor(parent, M);
  buildSternDetails(parent, M);
  buildDeckEdgeSupports(parent, M);

  // 龙骨线
  const keelPoints = [];
  for (let z = BOW_Z + 8; z <= STERN_Z - 6; z += 6) {
    const keel = hullKeelYAt(z) + 0.06;
    keelPoints.push(new THREE.Vector3(-0.4, keel, z), new THREE.Vector3(0.4, keel, z));
  }
  addLineSegments(parent, keelPoints, M.lineSoft);

  return {
    hull,
    material,
    geometry,
    halfWidthAt: hullHalfWidthAt,
    halfBeamAt: hullHalfBeamAt,
    sectionCount: SECTION_COUNT,
    length: STERN_Z - BOW_Z,
  };
}

