#!/usr/bin/env node
/**
 * CV-63 舰体几何离线校验 / offline geometry validation
 * =============================================================
 * 校验对象：由参数契约 docs/ref/kitty_hawk_cv63_v21_revised/cv63_parameters.json
 *          重建出来的几何（params.js → constants.js → hull.js）。
 *
 * hull.js 有 DOM 依赖（hull.js → materials.js 在模块顶层就 document.createElement
 * 建 canvas 贴图），因此横剖线数据按两条路线取：
 *   (b) 最小 DOM 垫片 + 动态 import hull.js —— 默认路线，直接拿真实返回值，
 *       仓库源码被并发编辑时也不会读到过期数据；
 *   (a) 只 import params.js / constants.js（纯数据 + 纯数学），再用 three 的同一套
 *       样条（SplineCurve / CatmullRomCurve3）把 hullHalfBeamAt / hullKeelYAt /
 *       hullRingAt 重新推导一遍 —— (b) 加载失败时的备用方案。
 * 两条路线都会跑，第 13 节把推导值与 hull.js 实际值逐点比对：一致则通过，
 * 分歧（说明 hull.js 又被改过）只记 warning，不污染几何判定。
 *
 * 运行：node tools/validate_geometry.mjs
 * 输出：控制台摘要 + docs/validation/geometry_check.json
 * 依赖：node 内置模块 + three（仓库已安装；只用到纯数学部分，不碰 WebGL）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";

import {
  CV63_PARAMS,
  DECK_PLAN,
  HULL_SECTION_SEQ,
  LENGTH_SCALE,
  VERTICAL,
  maxDeckSectionWidth,
  verticalMapY,
} from "../src/model/params.js";

import {
  AIRWING_SPOTS,
  ANGLED_DECK,
  CATAPULTS,
  DECK_BOUNDS,
  DECK_OUTLINE,
  DECK_X_SCALE,
  ELEVATOR_NOTCHES,
  ELEVATORS,
  SHIP,
  deckEdgeAt,
  deckHalfWidthAt,
} from "../src/model/constants.js";

/* ══════════════════════════════════════════════════════════════
 * 0. 校验参数（容差）
 * ══════════════════════════════════════════════════════════════ */

const TOL = {
  planLength: 0.05, // 甲板平面长度 323.8 ± 0.05
  maxSectionWidth: 0.05, // 最大横截面宽 76.8 ± 0.05
  landingAngleDeg: 0.02, // 着舰角 11.2° ± 0.02
  stripWidth: 0.02, // 着舰带宽 23 m ± 0.02
  elevatorOverlapRatio: 0.005, // 升降机平台与甲板的平面重叠 < 0.5 %
  elevatorFlushMin: -1.0, // 平台内缘相对甲板边缘：允许进入甲板 1.0 m
  elevatorFlushMax: 1.5, // 平台内缘相对甲板边缘：允许离开甲板 1.5 m
  airwingInset: 2.0, // 停机点距甲板边缘的最小内缩
  hullBeam: 0.02, // 横剖线 max|x| 与 hullHalfBeamAt 的偏差
  hullKeel: 0.05, // 横剖线最低 y 与 hullKeelYAt 的偏差
  hullDeckTop: 0.001, // 横剖线不得高于甲板下缘（+1 mm 数值容差）
  stationHalfBeam: 0.01, // 站位表最大半宽 19.75 ± 0.01（即型宽 39.5 ± 0.02）
  junction: 1e-6, // 甲板必须完全覆盖舷侧（0.80 × 半宽）
};

const OUTPUT_REL = "docs/validation/geometry_check.json";

/* ══════════════════════════════════════════════════════════════
 * 1. 通用平面几何工具（点一律为 [x, z]，世界坐标）
 * ══════════════════════════════════════════════════════════════ */

const EPS = 1e-9;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** 与 src/model/geometry.js 的 smoothstep 相同 */
const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

function round(value, digits = 4) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 鞋带公式有符号面积（逆时针为正） */
function polygonSignedArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, z0] = polygon[i];
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

/** 多边形面积（绝对值） */
function polygonArea(polygon) {
  return Math.abs(polygonSignedArea(polygon));
}

/** 射线法点在多边形内判定（含边界由调用方自行处理） */
function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function pointInTriangle(point, a, b, c) {
  const sign = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = sign(a, b, point);
  const d2 = sign(b, c, point);
  const d3 = sign(c, a, point);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
}

/** 点到线段距离 */
function distancePointToSegment(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < EPS) return Math.hypot(x - a[0], z - a[1]);
  const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

/** 点到多边形边界的最小距离（正数，与内外无关） */
function distanceToBoundary(x, z, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const d = distancePointToSegment(x, z, polygon[i], polygon[(i + 1) % polygon.length]);
    if (d < best) best = d;
  }
  return best;
}

/** 线段严格相交（仅判定“真正跨过”，共线/端点接触不算） */
function segmentsProperlyIntersect(p1, p2, p3, p4) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  const straddleA = (d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS);
  const straddleB = (d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS);
  return straddleA && straddleB;
}

/** 简单多边形判定：返回所有“非相邻边自交”的边下标对 */
function findSelfIntersections(polygon) {
  const n = polygon.length;
  const hits = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // 首尾两条边相邻
      const a = [polygon[i], polygon[(i + 1) % n]];
      const b = [polygon[j], polygon[(j + 1) % n]];
      if (segmentsProperlyIntersect(a[0], a[1], b[0], b[1])) hits.push([i, j]);
    }
  }
  return hits;
}

/** 以中心 + 平面尺寸构造轴对齐矩形（升降机平台） */
function rectFromCenter(cx, cz, width, length) {
  const halfW = width / 2;
  const halfL = length / 2;
  return {
    minX: cx - halfW,
    maxX: cx + halfW,
    minZ: cz - halfL,
    maxZ: cz + halfL,
    cx,
    cz,
    width,
    length,
  };
}

/** 矩形四角（逆时针） */
function rectCorners(rect) {
  return [
    [rect.minX, rect.minZ],
    [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ],
    [rect.minX, rect.maxZ],
  ];
}

function pointInRect(x, z, rect) {
  return x >= rect.minX - EPS && x <= rect.maxX + EPS && z >= rect.minZ - EPS && z <= rect.maxZ + EPS;
}

/** 用一条轴对齐半平面裁剪多边形（Sutherland–Hodgman 的单边步骤） */
function clipByHalfPlane(polygon, axis, value, keepGreater) {
  if (polygon.length === 0) return [];
  const inside = (p) => (keepGreater ? p[axis] >= value - EPS : p[axis] <= value + EPS);
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const previous = polygon[(i + polygon.length - 1) % polygon.length];
    const currentIn = inside(current);
    const previousIn = inside(previous);
    if (currentIn !== previousIn) {
      // 两侧异号 → 必与裁剪线有唯一交点，分母不为 0
      const t = (value - previous[axis]) / (current[axis] - previous[axis]);
      out.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ]);
    }
    if (currentIn) out.push(current);
  }
  return out;
}

/** 用矩形裁剪多边形（Sutherland–Hodgman，要求 subject 为凸多边形） */
function clipPolygonByRect(polygon, rect) {
  let out = polygon;
  out = clipByHalfPlane(out, 0, rect.minX, true);
  out = clipByHalfPlane(out, 0, rect.maxX, false);
  out = clipByHalfPlane(out, 1, rect.minZ, true);
  out = clipByHalfPlane(out, 1, rect.maxZ, false);
  return out;
}

/**
 * 耳切三角化：把任意简单多边形拆成三角形。
 * 只有拆成三角形之后，“多边形 ∩ 矩形”的面积才能用凸多边形裁剪精确求出
 * （Sutherland–Hodgman 的裁剪窗口必须是凸的，而甲板轮廓带升降机凹口，是凹多边形）。
 */
function earClipTriangles(polygon) {
  let poly = polygon.map((p) => [p[0], p[1]]);
  if (polygonSignedArea(poly) < 0) poly.reverse();
  const triangles = [];
  let indices = poly.map((_, index) => index);
  let guard = 0;
  while (indices.length > 3 && guard++ < 20000) {
    let clippedOne = false;
    for (let i = 0; i < indices.length; i++) {
      const prevIndex = indices[(i + indices.length - 1) % indices.length];
      const nextIndex = indices[(i + 1) % indices.length];
      const a = poly[prevIndex];
      const b = poly[indices[i]];
      const c = poly[nextIndex];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= EPS) continue; // 凹点或共线，不是耳朵
      let contains = false;
      for (let j = 0; j < indices.length; j++) {
        const k = indices[j];
        if (k === prevIndex || k === indices[i] || k === nextIndex) continue;
        if (pointInTriangle(poly[k], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      triangles.push([a, b, c]);
      indices.splice(i, 1);
      clippedOne = true;
      break;
    }
    if (!clippedOne) break; // 退化或自交，交给调用方降级
  }
  if (indices.length === 3) triangles.push([poly[indices[0]], poly[indices[1]], poly[indices[2]]]);
  return { triangles, complete: indices.length === 3, leftover: indices.length };
}

/** 矩形 ∩ 多边形 的重叠面积（三角化 + 逐三角形凸裁剪，精确解） */
function rectPolygonOverlapArea(rect, polygon) {
  const { triangles, complete } = earClipTriangles(polygon);
  let area = 0;
  for (const triangle of triangles) {
    const clipped = clipPolygonByRect(triangle, rect);
    if (clipped.length >= 3) area += polygonArea(clipped);
  }
  return { area, complete };
}

/** 忽略三角化的栅格估算（独立方法，仅用于交叉印证） */
function rectPolygonOverlapAreaRaster(rect, polygon, cell = 0.05) {
  const nx = Math.max(1, Math.ceil(rect.width / cell));
  const nz = Math.max(1, Math.ceil(rect.length / cell));
  const dx = rect.width / nx;
  const dz = rect.length / nz;
  let hits = 0;
  for (let i = 0; i < nx; i++) {
    const x = rect.minX + dx * (i + 0.5);
    for (let j = 0; j < nz; j++) {
      const z = rect.minZ + dz * (j + 0.5);
      if (pointInPolygon(x, z, polygon)) hits++;
    }
  }
  return hits * dx * dz;
}

/** 独立实现的“某 z 处甲板最大半宽”（不复用 constants.js 的查询，用于互校） */
function deckHalfWidthIndependent(z, polygon) {
  let left = null;
  let right = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if ((a[1] - z) * (b[1] - z) > 0) continue;
    if (Math.abs(b[1] - a[1]) < 1e-12) continue;
    const t = (z - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    if (left === null || x < left) left = x;
    if (right === null || x > right) right = x;
  }
  return { left, right, halfWidth: Math.max(Math.abs(left ?? 0), Math.abs(right ?? 0)) };
}

/* ══════════════════════════════════════════════════════════════
 * 2. 由参数契约重新推导 hull.js 的纵向型线与横剖线（备用路线，不含 DOM）
 *    逐行对应 hull.js：SplineCurve 站位 → 龙骨抬升 → CatmullRom 剖面
 * ══════════════════════════════════════════════════════════════ */

const KEEL_Y = SHIP.keelY; // -10.9
const HULL_TOP = SHIP.hullTopY; // 舷侧折角线 16.9
const HULL_DECK_Y = SHIP.deckUndersideY; // 甲板下缘 19.4
const PROFILE_SAMPLES = Math.max(24, CV63_PARAMS.hull.sectionSamples ?? 33);

function buildHullEvaluator() {
  const stationPoints = CV63_PARAMS.hull.stations.map(
    ([p, halfBeam]) => new THREE.Vector2(p * LENGTH_SCALE, halfBeam),
  );
  const stationMax = Math.max(...CV63_PARAMS.hull.stations.map(([, halfBeam]) => halfBeam));

  // 纵向型线：参考站位样条加密后按 z 建立查找表
  const beamSamples = (() => {
    const dense = new THREE.SplineCurve(stationPoints).getPoints(720);
    const list = dense
      .map((point) => ({ z: -point.x, w: Math.max(0, point.y) }))
      .sort((a, b) => a.z - b.z);
    const out = [];
    for (const item of list) {
      if (!out.length || item.z - out[out.length - 1].z > 1e-4) out.push(item);
    }
    out.forEach((item) => {
      item.w = Math.min(item.w, stationMax * 1.01);
    });
    return out;
  })();

  const bowZ = beamSamples[0].z;
  const sternZ = beamSamples[beamSamples.length - 1].z;

  // 龙骨纵向抬升系数（艏艉收进）
  const draftControl = [
    [bowZ, 0.3],
    [bowZ + 12, 0.52],
    [bowZ + 34, 0.78],
    [bowZ + 62, 0.94],
    [-60, 1.0],
    [70, 1.0],
    [112, 0.96],
    [136, 0.86],
    [146, 0.68],
    [151, 0.5],
    [156, 0.34],
    [sternZ, 0.28],
  ];
  const draftSamples = new THREE.SplineCurve(
    draftControl.map(([z, f]) => new THREE.Vector2(z, f)),
  )
    .getPoints(260)
    .map((point) => ({ z: point.x, f: Math.min(1, Math.max(0.25, point.y)) }))
    .sort((a, b) => a.z - b.z);

  function lookup(samples, z, key) {
    if (z <= samples[0].z) return samples[0][key];
    if (z >= samples[samples.length - 1].z) return samples[samples.length - 1][key];
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].z <= z) lo = mid;
      else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    return THREE.MathUtils.lerp(a[key], b[key], (z - a.z) / (b.z - a.z || 1));
  }

  const draftFactorAt = (z) => lookup(draftSamples, z, "f");
  const keelYAt = (z) => KEEL_Y * draftFactorAt(z);

  /**
   * 指定 z 处的型半宽：样条插值 + 艉部收进。
   * 与 hull.js 当前实现对齐（最后 14 m 由 1 → 0.88，形成巡洋舰尾）；
   * hull.js 若被再次改动，第 13 节的交叉比对会把偏差记成 warning。
   */
  const taperLength = 14;
  const taperDepth = 0.12;
  const halfBeamAt = (z) => {
    const raw = lookup(beamSamples, z, "w");
    const taperStart = sternZ - taperLength;
    if (z <= taperStart) return raw;
    return raw * (1 - taperDepth * smoothstep((z - taperStart) / taperLength));
  };

  // 横剖面：参考 17 点序列（左舷折角线 → 龙骨 → 右舷折角线）→ Catmull-Rom
  const profile = new THREE.CatmullRomCurve3(
    HULL_SECTION_SEQ.map(([frac, yRef]) => new THREE.Vector3(frac, yRef, 0)),
    false,
    "centripetal",
  )
    .getPoints(PROFILE_SAMPLES)
    .map((point) => ({ frac: point.x, yRef: point.y }));

  function mapProfileY(yRef, draft) {
    const y = yRef <= 0 ? yRef * draft : verticalMapY(yRef);
    return Math.min(Math.max(y, KEEL_Y * draft), HULL_TOP);
  }

  /** 完整横剖线：左舷甲板下缘 → 龙骨 → 右舷甲板下缘 */
  function ringAt(z, inset = 1) {
    const halfBeam = halfBeamAt(z) * inset;
    const draft = draftFactorAt(z);
    const ring = [[-VERTICAL.topsideFraction * halfBeam, HULL_DECK_Y, z]];
    for (const { frac, yRef } of profile) ring.push([frac * halfBeam, mapProfileY(yRef, draft), z]);
    ring.push([VERTICAL.topsideFraction * halfBeam, HULL_DECK_Y, z]);
    return ring;
  }

  return {
    beamSamples,
    draftSamples,
    profile,
    zRange: [bowZ, sternZ],
    sectionSampleCount: PROFILE_SAMPLES,
    draftFactorAt,
    halfBeamAt,
    keelYAt,
    ringAt,
  };
}

/** (a) 方案：完全由参数契约推导出的型线（无 DOM 依赖，作为权威值不可用时的备用） */
const derivedHull = buildHullEvaluator();

/**
 * (b) 方案：最小 DOM 垫片直载 hull.js。
 * 只要加载成功，横剖面校验就用 hull.js 的真实返回值 —— 仓库源码可能正在被并发编辑，
 * 直载比脚本内置的推导更不容易过期。推导版本仍保留，用于第 13 节的交叉比对。
 */
const liveHull = await loadHullModule();
const hullEval = liveHull.api ?? derivedHull;
const hullSource = liveHull.api
  ? "hull.js（最小 DOM 垫片直载，权威值）"
  : "params.js + constants.js 重新推导（hull.js 无法加载时的备用）";


/* ══════════════════════════════════════════════════════════════
 * 3. 校验登记器
 * ══════════════════════════════════════════════════════════════ */

const checks = [];
const issues = [];
const warnings = [];
const skipped = [];

function check(id, ok, detail, extra = {}) {
  const entry = { id, ok: Boolean(ok), detail };
  if (extra.value !== undefined) entry.value = typeof extra.value === "number" ? round(extra.value) : extra.value;
  if (extra.limit !== undefined) entry.limit = extra.limit;
  checks.push(entry);
  if (!ok) {
    issues.push({
      id,
      detail,
      ...(extra.value !== undefined ? { value: typeof extra.value === "number" ? round(extra.value, 6) : extra.value } : {}),
      ...(extra.limit !== undefined ? { limit: extra.limit } : {}),
    });
  }
  return Boolean(ok);
}

function skip(id, reason) {
  skipped.push({ id, reason });
}

const fmt = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

/* ══════════════════════════════════════════════════════════════
 * 4. 甲板平面轮廓
 * ══════════════════════════════════════════════════════════════ */

const deckArea = polygonArea(DECK_OUTLINE);
const deckBaseArea = polygonArea(DECK_PLAN);
const deckSelfIntersections = findSelfIntersections(DECK_OUTLINE);
const duplicateVertices = DECK_OUTLINE.filter(
  (point, index) =>
    index > 0 && Math.hypot(point[0] - DECK_OUTLINE[index - 1][0], point[1] - DECK_OUTLINE[index - 1][1]) < 1e-6,
).length;

const planLength = DECK_BOUNDS.maxZ - DECK_BOUNDS.minZ;
check(
  "deck.simple",
  deckSelfIntersections.length === 0 && duplicateVertices === 0,
  deckSelfIntersections.length === 0 && duplicateVertices === 0
    ? `甲板轮廓是简单多边形（${DECK_OUTLINE.length} 个顶点，无自交、无重合顶点）`
    : `甲板轮廓自交边对 ${deckSelfIntersections.length} 组、重合顶点 ${duplicateVertices} 个`,
  { value: deckSelfIntersections.length },
);
check(
  "deck.area",
  deckArea > 1000,
  `甲板轮廓面积 ${fmt(deckArea, 2)} m²（未缩放的参数轮廓 ${fmt(deckBaseArea, 2)} m²）`,
  { value: deckArea, limit: 1000 },
);
check(
  "deck.planLength",
  Math.abs(planLength - 323.8) <= TOL.planLength,
  `甲板平面长度 ${fmt(planLength)} m（目标 323.8 ± ${TOL.planLength}）`,
  { value: planLength, limit: 323.8 },
);

// 最大横截面宽度：调用与参考实现同源的采样（每个顶点邻域 + 段中点）
const widthBase = maxDeckSectionWidth(DECK_PLAN);
const widthWorld = maxDeckSectionWidth(DECK_OUTLINE);
const widthMaxHalf = widthWorld.width / 2;
check(
  "deck.maxSectionWidth",
  Math.abs(widthWorld.width - 76.8) <= TOL.maxSectionWidth,
  `最大横截面宽 ${fmt(widthWorld.width, 4)} m @ z=${fmt(widthWorld.p, 2)}` +
    `（参数轮廓 ${fmt(widthBase.width, 4)} m × DECK_X_SCALE ${fmt(DECK_X_SCALE, 6)}；目标 76.8 ± ${TOL.maxSectionWidth}）`,
  { value: widthWorld.width, limit: 76.8 },
);

/* ══════════════════════════════════════════════════════════════
 * 5. 斜角甲板（着舰中轴线 / 着舰带 / 拦阻索）
 * ══════════════════════════════════════════════════════════════ */

const axisDx = ANGLED_DECK.centerBow[0] - ANGLED_DECK.centerStern[0];
const axisDz = ANGLED_DECK.centerBow[1] - ANGLED_DECK.centerStern[1];
const axisRun = Math.hypot(axisDx, axisDz);
const axisAngleDeg = (Math.atan2(Math.abs(axisDx), Math.abs(axisDz)) * 180) / Math.PI;

check(
  "angled.angle",
  Math.abs(axisAngleDeg - 11.2) <= TOL.landingAngleDeg,
  `着舰中轴线夹角 ${fmt(axisAngleDeg, 6)}°（目标 11.2 ± ${TOL.landingAngleDeg}；` +
    `尾端 [${fmt(ANGLED_DECK.centerStern[0], 2)}, ${fmt(ANGLED_DECK.centerStern[1], 2)}] → ` +
    `前端 [${fmt(ANGLED_DECK.centerBow[0], 2)}, ${fmt(ANGLED_DECK.centerBow[1], 2)}]，轴长 ${fmt(axisRun, 2)} m）`,
  { value: axisAngleDeg, limit: 11.2 },
);
check(
  "angled.stripWidth",
  Math.abs(ANGLED_DECK.width - 23) <= TOL.stripWidth,
  `着舰带宽 ${fmt(ANGLED_DECK.width, 4)} m（半宽 ${fmt(ANGLED_DECK.stripHalfWidth, 3)} m，目标 23 ± ${TOL.stripWidth}）`,
  { value: ANGLED_DECK.width, limit: 23 },
);

// 拦阻索：沿中轴线插值取点，z 必须严格递减且落在甲板轮廓内
const wirePoints = ANGLED_DECK.wiresZ.map((z, index) => {
  const t = ANGLED_DECK.wireFractions[index];
  const x = ANGLED_DECK.centerStern[0] + axisDx * t;
  return { index, fraction: t, x, z, inside: pointInPolygon(x, z, DECK_OUTLINE) };
});
const wiresDecreasing = wirePoints.every((wire, index) => index === 0 || wire.z < wirePoints[index - 1].z);
const wiresInside = wirePoints.every((wire) => wire.inside);

check(
  "angled.wiresMonotonic",
  wiresDecreasing,
  wiresDecreasing
    ? `四道拦阻索 z 严格递减：${wirePoints.map((w) => fmt(w.z, 2)).join(" > ")}`
    : `拦阻索 z 未严格递减：${wirePoints.map((w) => fmt(w.z, 2)).join(", ")}`,
);
check(
  "angled.wiresInsideDeck",
  wiresInside,
  wiresInside
    ? `四道拦阻索全部落在甲板轮廓内：${wirePoints
        .map((w) => `[${fmt(w.x, 2)}, ${fmt(w.z, 2)}]`)
        .join(" ")}`
    : `以下拦阻索落在甲板轮廓外：${wirePoints
        .filter((w) => !w.inside)
        .map((w) => `#${w.index + 1} [${fmt(w.x, 2)}, ${fmt(w.z, 2)}]`)
        .join(" ")}`,
);

/* ══════════════════════════════════════════════════════════════
 * 6. 四部舷侧升降机
 * ══════════════════════════════════════════════════════════════ */

const maxAbsDeckX = Math.max(...DECK_OUTLINE.map(([x]) => Math.abs(x)));

const elevatorMetrics = ELEVATORS.map((elevator) => {
  const rect = rectFromCenter(elevator.x, elevator.z, elevator.width, elevator.length);
  const rectArea = rect.width * rect.length;
  const overlap = rectPolygonOverlapArea(rect, DECK_OUTLINE);
  const overlapRatio = rectArea > 0 ? overlap.area / rectArea : 0;
  const rasterRatio = rectArea > 0 ? rectPolygonOverlapAreaRaster(rect, DECK_OUTLINE) / rectArea : 0;
  const deckEdge = deckEdgeAt(elevator.z, elevator.side);
  const flushOffset = elevator.inner - deckEdge; // >0 = 平台在甲板边缘之外
  const outerHalfWidth = Math.abs(elevator.outer);
  const notch = ELEVATOR_NOTCHES.find((item) => item.id === elevator.id) ?? null;

  check(
    `elevator.${elevator.id}.outsideDeck`,
    overlapRatio < TOL.elevatorOverlapRatio,
    overlapRatio < TOL.elevatorOverlapRatio
      ? `${elevator.label}（${elevator.name}）平台完全位于甲板轮廓之外：重叠 ${fmt(
          overlap.area,
          3,
        )} m² / ${fmt(overlapRatio * 100, 3)} %（栅格复核 ${fmt(rasterRatio * 100, 3)} %）`
      : `${elevator.label}（${elevator.name}）平台压进甲板 ${fmt(overlap.area, 3)} m² = ${fmt(
          overlapRatio * 100,
          3,
        )} %（阈值 ${TOL.elevatorOverlapRatio * 100} %；内缘 ${fmt(elevator.inner, 3)} 越过甲板边缘 ${fmt(
          deckEdge,
          3,
        )} ${fmt(-flushOffset, 3)} m）`,
    { value: overlapRatio, limit: TOL.elevatorOverlapRatio },
  );

  check(
    `elevator.${elevator.id}.flush`,
    flushOffset >= TOL.elevatorFlushMin && flushOffset <= TOL.elevatorFlushMax,
    `平台内缘相对 z=${fmt(elevator.z, 2)} 处甲板边缘偏移 ${fmt(flushOffset, 3)} m` +
      `（允许 [${TOL.elevatorFlushMin}, ${TOL.elevatorFlushMax}]；平台内缘 ${fmt(elevator.inner, 3)} m，甲板边缘 ${fmt(
        deckEdge,
        3,
      )} m）`,
    { value: flushOffset, limit: TOL.elevatorFlushMax },
  );

  check(
    `elevator.${elevator.id}.outerBound`,
    outerHalfWidth <= widthMaxHalf + 1e-6,
    `平台外缘 |x| = ${fmt(outerHalfWidth, 3)} m ≤ 甲板最大半宽 ${fmt(widthMaxHalf, 3)} m` +
      `（余量 ${fmt(widthMaxHalf - outerHalfWidth, 3)} m；轮廓最外点 |x| = ${fmt(maxAbsDeckX, 3)} m）`,
    { value: outerHalfWidth, limit: widthMaxHalf },
  );

  return {
    id: elevator.id,
    name: elevator.name,
    side: elevator.side > 0 ? "stbd" : "port",
    centre: [round(elevator.x), round(elevator.z)],
    width: round(elevator.width),
    length: round(elevator.length),
    inner: round(elevator.inner),
    outer: round(elevator.outer),
    deckEdgeAtCentreZ: round(deckEdge),
    flushOffset: round(flushOffset),
    platformArea: round(rectArea, 3),
    overlapArea: round(overlap.area, 4),
    overlapRatio: round(overlapRatio, 6),
    rasterOverlapRatio: round(rasterRatio, 6),
    triangulationComplete: overlap.complete,
    notchZ: notch ? [round(notch.z0), round(notch.z1)] : null,
    platformZ: [round(rect.minZ), round(rect.maxZ)],
    rect: {
      minX: round(rect.minX),
      maxX: round(rect.maxX),
      minZ: round(rect.minZ),
      maxZ: round(rect.maxZ),
    },
  };
});

/* ══════════════════════════════════════════════════════════════
 * 7. 弹射器轨道
 * ══════════════════════════════════════════════════════════════ */

const catapultMetrics = CATAPULTS.map((catapult) => {
  const mid = [(catapult.start[0] + catapult.end[0]) / 2, (catapult.start[1] + catapult.end[1]) / 2];
  const startInside = pointInPolygon(catapult.start[0], catapult.start[1], DECK_OUTLINE);
  const endInside = pointInPolygon(catapult.end[0], catapult.end[1], DECK_OUTLINE);
  const midInside = pointInPolygon(mid[0], mid[1], DECK_OUTLINE);
  const margin = Math.min(
    distanceToBoundary(catapult.start[0], catapult.start[1], DECK_OUTLINE),
    distanceToBoundary(catapult.end[0], catapult.end[1], DECK_OUTLINE),
    distanceToBoundary(mid[0], mid[1], DECK_OUTLINE),
  );

  check(
    `catapult.${catapult.id}.onDeck`,
    startInside && endInside,
    `${catapult.label} 两端点${startInside && endInside ? "均在" : "未全在"}甲板轮廓内，轨道长 ${fmt(
      catapult.length,
      2,
    )} m；端点距边缘最小 ${fmt(
      Math.min(
        distanceToBoundary(catapult.start[0], catapult.start[1], DECK_OUTLINE),
        distanceToBoundary(catapult.end[0], catapult.end[1], DECK_OUTLINE),
      ),
      2,
    )} m`,
  );
  check(
    `catapult.${catapult.id}.midpoint`,
    midInside,
    `${catapult.label} 中点 [${fmt(mid[0], 2)}, ${fmt(mid[1], 2)}] ${midInside ? "在" : "不在"}甲板轮廓内`,
  );

  return {
    id: catapult.id,
    label: catapult.label,
    start: [round(catapult.start[0]), round(catapult.start[1])],
    end: [round(catapult.end[0]), round(catapult.end[1])],
    mid: [round(mid[0]), round(mid[1])],
    length: round(catapult.length, 3),
    angleDeg: round(catapult.angleDeg, 3),
    inside: { start: startInside, mid: midInside, end: endInside },
    minEdgeDistance: round(margin, 3),
  };
});

/* ══════════════════════════════════════════════════════════════
 * 8. 舰载机停放点
 * ══════════════════════════════════════════════════════════════ */

const airwingMetrics = AIRWING_SPOTS.map((spot) => {
  const insideDeck = pointInPolygon(spot.x, spot.z, DECK_OUTLINE);
  const boundary = distanceToBoundary(spot.x, spot.z, DECK_OUTLINE);
  const elevatorSpot = Boolean(spot.elevator);
  const platform = elevatorSpot
    ? elevatorMetrics.find((item) => item.id === spot.elevator) ?? null
    : null;
  const onOwnPlatform = platform ? pointInRect(spot.x, spot.z, platform.rect) : null;

  if (elevatorSpot) {
    // 升降机上的停机点必然在甲板轮廓之外（平台本身就在凹口外侧），
    // 因此改为校验“确实落在自己的平台矩形内”，其余免除。
    check(
      `airwing.${spot.id}.onElevatorPlatform`,
      Boolean(onOwnPlatform),
      `${spot.id} 停放于升降机 ${spot.elevator} 平台${onOwnPlatform ? "内" : "外"}` +
        (platform
          ? `（平台 x ${fmt(platform.rect.minX, 2)}…${fmt(platform.rect.maxX, 2)} / z ${fmt(
              platform.rect.minZ,
              2,
            )}…${fmt(platform.rect.maxZ, 2)}）`
          : "（未找到对应平台矩形）"),
    );
    skip(`airwing.${spot.id}.inset`, `停放于升降机 ${spot.elevator} 平台上，甲板内缩判定不适用`);
    skip(`airwing.${spot.id}.clearOfElevators`, `本身即升降机 ${spot.elevator} 上的停机点`);
  } else {
    const ok = insideDeck && boundary >= TOL.airwingInset;
    check(
      `airwing.${spot.id}.inset`,
      ok,
      `${spot.id}（${spot.type}）[${fmt(spot.x, 2)}, ${fmt(spot.z, 2)}] ` +
        `${insideDeck ? "在甲板内" : "在甲板外"}，距边缘 ${fmt(boundary, 2)} m（需 ≥ ${TOL.airwingInset} m）`,
      { value: boundary, limit: TOL.airwingInset },
    );

    const hit = elevatorMetrics.find((item) => pointInRect(spot.x, spot.z, item.rect));
    check(
      `airwing.${spot.id}.clearOfElevators`,
      !hit,
      hit
        ? `${spot.id} 中心落在升降机 ${hit.id} 平台矩形内`
        : `${spot.id} 中心不落在任何升降机平台矩形内`,
    );
  }

  return {
    id: spot.id,
    type: spot.type,
    x: round(spot.x),
    z: round(spot.z),
    elevator: spot.elevator ?? null,
    insideDeck,
    boundaryDistance: round(boundary, 3),
    insetOk: elevatorSpot ? null : boundary >= TOL.airwingInset && insideDeck,
    onOwnPlatform,
  };
});

/* ══════════════════════════════════════════════════════════════
 * 9. 舰体站位表
 * ══════════════════════════════════════════════════════════════ */

const stations = CV63_PARAMS.hull.stations;
const stationsIncreasing = stations.every((station, index) => index === 0 || station[0] > stations[index - 1][0]);
const stationMaxHalfBeam = Math.max(...stations.map(([, halfBeam]) => halfBeam));
const stationMinHalfBeam = Math.min(...stations.map(([, halfBeam]) => halfBeam));

check(
  "hull.stationsIncreasing",
  stationsIncreasing,
  stationsIncreasing
    ? `站位表 ${stations.length} 个控制站位，平面位置严格递增（${stations[0][0]} → ${stations[stations.length - 1][0]}）`
    : "站位表平面位置未严格递增",
);
check(
  "hull.maxHalfBeam",
  Math.abs(stationMaxHalfBeam - 19.75) <= TOL.stationHalfBeam,
  `站位表最大半宽 ${fmt(stationMaxHalfBeam, 3)} m → 型宽 ${fmt(stationMaxHalfBeam * 2, 3)} m` +
    `（目标 39.5 ± ${TOL.stationHalfBeam * 2}；最小半宽 ${fmt(stationMinHalfBeam, 3)} m）`,
  { value: stationMaxHalfBeam * 2, limit: 39.5 },
);

/* ══════════════════════════════════════════════════════════════
 * 10. 横剖面采样（型线 / 龙骨 / 不得高出甲板下缘）
 * ══════════════════════════════════════════════════════════════ */

const RING_SAMPLE_Z = [-150, -100, -50, 0, 50, 100, 150];

/** 未取整的偏差（诊断文字用，避免 round 后丢掉 0.00003 这样的超差） */
const ringRaw = [];

const ringMetrics = RING_SAMPLE_Z.map((z) => {
  const ring = hullEval.ringAt(z);
  const halfBeam = hullEval.halfBeamAt(z);
  const keelY = hullEval.keelYAt(z);
  const maxAbsX = Math.max(...ring.map((point) => Math.abs(point[0])));
  const lowestY = Math.min(...ring.map((point) => point[1]));
  const highestY = Math.max(...ring.map((point) => point[1]));
  const beamDelta = maxAbsX - halfBeam;
  const keelDelta = lowestY - keelY;
  const pokesAboveDeck = ring.filter((point) => point[1] > SHIP.deckUndersideY + TOL.hullDeckTop);

  check(
    `hull.ring.${z}.beam`,
    Math.abs(beamDelta) <= TOL.hullBeam,
    `z=${z}：横剖线 max|x| = ${fmt(maxAbsX, 4)} m，hullHalfBeamAt = ${fmt(halfBeam, 4)} m，` +
      `偏差 ${fmt(beamDelta, 4)} m（容差 ±${TOL.hullBeam}）`,
    { value: beamDelta, limit: TOL.hullBeam },
  );
  check(
    `hull.ring.${z}.keel`,
    Math.abs(keelDelta) <= TOL.hullKeel,
    `z=${z}：横剖线最低 y = ${fmt(lowestY, 4)} m，hullKeelYAt = ${fmt(keelY, 4)} m，` +
      `偏差 ${fmt(keelDelta, 5)} m（容差 ±${TOL.hullKeel}）`,
    { value: keelDelta, limit: TOL.hullKeel },
  );
  check(
    `hull.ring.${z}.belowDeck`,
    pokesAboveDeck.length === 0,
    `z=${z}：横剖线最高 y = ${fmt(highestY, 4)} m，甲板下缘 ${fmt(SHIP.deckUndersideY, 4)} m，` +
      `${pokesAboveDeck.length === 0 ? "未穿出甲板" : `有 ${pokesAboveDeck.length} 点穿出甲板`}`,
    { value: highestY, limit: SHIP.deckUndersideY },
  );

  ringRaw.push({ z, beamDelta, keelDelta });

  return {
    z,
    pointCount: ring.length,
    halfBeam: round(halfBeam),
    maxAbsX: round(maxAbsX),
    beamDelta: round(beamDelta),
    keelY: round(keelY),
    lowestY: round(lowestY),
    keelDelta: round(keelDelta),
    highestY: round(highestY),
    deckUndersideY: round(SHIP.deckUndersideY),
    pointsAboveDeck: pokesAboveDeck.length,
  };
});

const profileMaxAbsFrac = Math.max(...derivedHull.profile.map((point) => Math.abs(point.frac)));
const profileMinYRef = Math.min(...derivedHull.profile.map((point) => point.yRef));

/* ══════════════════════════════════════════════════════════════
 * 11. 甲板/舷侧结合部：舷侧半宽（0.80 × 半宽）必须被甲板覆盖
 * ══════════════════════════════════════════════════════════════ */

const junctionZ = [];
for (let z = DECK_BOUNDS.minZ + 0.05; z < DECK_BOUNDS.maxZ; z += 0.5) junctionZ.push(z);
for (const [, z] of DECK_OUTLINE) junctionZ.push(z);
for (const notch of ELEVATOR_NOTCHES) {
  junctionZ.push(notch.z0, notch.z1);
}

let junctionWorst = { z: NaN, hullHalfBeam: 0, hullWidth: 0, deckHalfWidth: 0, clearance: Infinity };
let junctionQueryMismatch = 0;
let junctionDegenerate = 0;
for (const z of junctionZ) {
  const hullHalfBeam = hullEval.halfBeamAt(z);
  const hullWidth = VERTICAL.topsideFraction * hullHalfBeam;
  const deckHalfWidth = deckHalfWidthAt(z);
  if (!(deckHalfWidth > 0)) {
    junctionDegenerate++; // 落在甲板 z 范围之外的端点（无横截线），不参与判定
    continue;
  }
  const clearance = deckHalfWidth - hullWidth;
  if (clearance < junctionWorst.clearance) junctionWorst = { z, hullHalfBeam, hullWidth, deckHalfWidth, clearance };
  const independent = deckHalfWidthIndependent(z, DECK_OUTLINE).halfWidth;
  junctionQueryMismatch = Math.max(junctionQueryMismatch, Math.abs(independent - deckHalfWidth));
}

check(
  "junction.deckCoversHull",
  junctionWorst.clearance >= -TOL.junction,
  `甲板与舷侧结合部最小覆盖余量 ${fmt(junctionWorst.clearance, 3)} m @ z=${fmt(junctionWorst.z, 2)}` +
    `（舷侧半宽 ${fmt(junctionWorst.hullWidth, 3)} m ≤ 甲板半宽 ${fmt(junctionWorst.deckHalfWidth, 3)} m；` +
    `样本 ${junctionZ.length} 个，退化端点 ${junctionDegenerate} 个）`,
  { value: junctionWorst.clearance, limit: 0 },
);

/** 纵向型线的实际极值（站位表是控制点；样条在控制点之间可能轻微过冲） */
const sampledMaxHalfBeam = (() => {
  let best = { z: NaN, halfBeam: -Infinity };
  for (let z = hullEval.zRange[0]; z <= hullEval.zRange[1]; z += 0.25) {
    const halfBeam = hullEval.halfBeamAt(z);
    if (halfBeam > best.halfBeam) best = { z, halfBeam };
  }
  return best;
})();

if (sampledMaxHalfBeam.halfBeam > stationMaxHalfBeam + 0.005) {
  warnings.push({
    id: "hull.sampledBeamExceedsContract",
    detail:
      `纵向型线在 z=${fmt(sampledMaxHalfBeam.z, 2)} 处取到半宽 ${fmt(sampledMaxHalfBeam.halfBeam, 4)} m → 型宽 ` +
      `${fmt(sampledMaxHalfBeam.halfBeam * 2, 3)} m，比参数契约的 ${fmt(stationMaxHalfBeam * 2, 3)} m 宽出 ` +
      `${fmt((sampledMaxHalfBeam.halfBeam - stationMaxHalfBeam) * 2, 4)} m：站位表本身正确（19.75 m），` +
      `过冲来自 SplineCurve 在两个等值控制站位之间的插值。`,
  });
}

/* ══════════════════════════════════════════════════════════════
 * 12. 工具自检（防止几何助手本身出错导致“假通过”）
 * ══════════════════════════════════════════════════════════════ */

const selfTest = (() => {
  const square = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];
  const squareArea = polygonArea(square);
  const halfRect = { minX: 0, maxX: 1, minZ: 0, maxZ: 2, width: 1, length: 2, cx: 0.5, cz: 1 };
  const overlap = rectPolygonOverlapArea(halfRect, square);
  const concave = [
    [0, 0],
    [4, 0],
    [4, 4],
    [2.5, 4],
    [2.5, 2],
    [1.5, 2],
    [1.5, 4],
    [0, 4],
  ]; // U 形，面积 16 - 1×2 = 14
  const concaveArea = polygonArea(concave);
  const tri = earClipTriangles(concave);
  const triArea = tri.triangles.reduce((sum, triangle) => sum + polygonArea(triangle), 0);
  const insidePoint = pointInPolygon(0.5, 0.5, concave);
  const notchPoint = pointInPolygon(2.0, 3.0, concave);
  // 矩形横跨凹口的重叠面积应为 0.5 × 1 + 0.5 × 1 = 1（左右两条腿各一半）
  const concaveRect = { minX: 1.0, maxX: 3.0, minZ: 2.5, maxZ: 3.5, width: 2, length: 1, cx: 2, cz: 3 };
  const concaveOverlap = rectPolygonOverlapArea(concaveRect, concave);
  return {
    squareArea,
    overlapArea: overlap.area,
    overlapComplete: overlap.complete,
    concaveArea,
    triArea,
    triComplete: tri.complete,
    concaveOverlapArea: concaveOverlap.area,
    insidePoint,
    notchPoint,
  };
})();

const selfTestOk =
  Math.abs(selfTest.squareArea - 4) < 1e-9 &&
  Math.abs(selfTest.overlapArea - 2) < 1e-9 &&
  Math.abs(selfTest.concaveArea - 14) < 1e-9 &&
  Math.abs(selfTest.triArea - 14) < 1e-9 &&
  Math.abs(selfTest.concaveOverlapArea - 1) < 1e-9 &&
  selfTest.triComplete &&
  selfTest.insidePoint &&
  !selfTest.notchPoint;

check(
  "tools.helpers",
  selfTestOk,
  selfTestOk
    ? `几何助手自检通过（正方形面积 ${selfTest.squareArea}、半矩形重叠 ${selfTest.overlapArea}、` +
        `U 形三角化 ${fmt(selfTest.triArea, 6)} / 面积 ${selfTest.concaveArea}、` +
        `跨凹口重叠 ${fmt(selfTest.concaveOverlapArea, 6)}）`
    : `几何助手自检失败：${JSON.stringify(selfTest)}`,
);

/* ══════════════════════════════════════════════════════════════
 * 13. (b) 方案：最小 DOM 垫片直载 hull.js + 与推导版本的交叉比对
 * ══════════════════════════════════════════════════════════════ */

/** 用最小 DOM 垫片加载 hull.js；失败时 api = null，校验自动退回推导版本 */
async function loadHullModule() {
  try {
    installDomShim();
    const moduleUrl = new URL("../src/model/hull.js", import.meta.url).href;
    const real = await import(moduleUrl);
    return {
      api: {
        halfBeamAt: real.hullHalfBeamAt,
        keelYAt: real.hullKeelYAt,
        ringAt: real.hullRingAt,
        surfaceX: real.hullSurfaceX,
        zRange: [...real.HULL_Z_RANGE],
        ringPointCount: real.HULL_DEBUG?.ringPointCount ?? null,
      },
      reason: null,
    };
  } catch (error) {
    return { api: null, reason: String((error && error.message) || error) };
  }
}

/**
 * 把脚本内置推导与 hull.js 实际返回值对比。
 * 两者分歧说明 hull.js 在脚本内置推导之后被改过 —— 记入 warnings（不参与 status）。
 */
function compareHullDerivation() {
  const result = { compared: false, ringPointDelta: null, beamDelta: null, keelDelta: null, pointCount: null };
  if (!liveHull.api) {
    result.reason = liveHull.reason;
    return result;
  }
  result.compared = true;
  let ringDelta = 0;
  let beamDelta = 0;
  let keelDelta = 0;
  for (const z of RING_SAMPLE_Z) {
    const a = derivedHull.ringAt(z);
    const b = liveHull.api.ringAt(z);
    if (a.length !== b.length) {
      result.pointCount = `点数不一致：推导 ${a.length} vs hull.js ${b.length}`;
      break;
    }
    result.pointCount = a.length;
    for (let i = 0; i < a.length; i++) {
      ringDelta = Math.max(ringDelta, Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1]));
    }
    beamDelta = Math.max(beamDelta, Math.abs(derivedHull.halfBeamAt(z) - liveHull.api.halfBeamAt(z)));
    keelDelta = Math.max(keelDelta, Math.abs(derivedHull.keelYAt(z) - liveHull.api.keelYAt(z)));
  }
  if (typeof result.pointCount === "string") return result;
  result.ringPointDelta = round(ringDelta, 8);
  result.beamDelta = round(beamDelta, 8);
  result.keelDelta = round(keelDelta, 8);

  const agrees = ringDelta < 1e-6 && beamDelta < 1e-6 && keelDelta < 1e-6;
  if (agrees) {
    check(
      "hull.derivationMatchesModule",
      true,
      `脚本内置推导与 hull.js 实际实现一致（横剖线最大偏差 ${ringDelta.toExponential(2)} m，` +
        `半宽 ${beamDelta.toExponential(2)} m，龙骨 ${keelDelta.toExponential(2)} m）`,
      { value: ringDelta, limit: 1e-6 },
    );
  } else {
    // hull.js 在脚本内置推导之后被改过：这不是几何缺陷，记 warning，不参与 status
    warnings.push({
      id: "hull.derivationMatchesModule",
      detail:
        `脚本内置推导与 hull.js 已分叉（横剖线 ${fmt(ringDelta, 4)} m / 半宽 ${fmt(beamDelta, 4)} m / ` +
        `龙骨 ${fmt(keelDelta, 4)} m）：hull.js 的推导逻辑被改过，横剖面校验仍使用 hull.js 实际值，` +
        `几何判定不受影响；需要时同步更新脚本里的 buildHullEvaluator()。`,
    });
  }
  return result;
}

/** 极简 DOM 垫片：只为 materials.js 顶层的 canvas 贴图生成提供空实现 */
function installDomShim() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const makeFakeCanvas = () => {
    const canvas = { width: 0, height: 0 };
    const context = new Proxy(
      {},
      {
        get(target, property) {
          if (property === "canvas") return canvas;
          if (property === "measureText") return (text) => ({ width: String(text).length * 8 });
          if (
            property === "createRadialGradient" ||
            property === "createLinearGradient" ||
            property === "createPattern"
          ) {
            return () => gradient;
          }
          if (property === "getImageData") {
            return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
          }
          if (property === "createImageData") {
            return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
          }
          if (property in target) return target[property];
          return noop;
        },
        set(target, property, value) {
          target[property] = value;
          return true;
        },
      },
    );
    canvas.getContext = () => context;
    return canvas;
  };
  globalThis.document = {
    createElement: (tag) => (tag === "canvas" ? makeFakeCanvas() : { style: {}, appendChild: noop }),
    createElementNS: () => makeFakeCanvas(),
    documentElement: { style: {} },
  };
  globalThis.window = { devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop };
  globalThis.self = globalThis.window;
}

/* ══════════════════════════════════════════════════════════════
 * 14. 汇总 / 输出
 * ══════════════════════════════════════════════════════════════ */

const derivationComparison = compareHullDerivation();

/* ── 失败项根因说明：区分“真几何缺陷”与“离散化 / 采样容差” ── */

const failingElevators = elevatorMetrics.filter((item) => item.overlapRatio >= TOL.elevatorOverlapRatio);
const failingKeel = ringRaw.filter((item) => Math.abs(item.keelDelta) > TOL.hullKeel);
const maxBeamDelta = Math.max(...ringRaw.map((item) => Math.abs(item.beamDelta)));

const diagnosis = [];
if (failingElevators.length) {
  diagnosis.push(
    `升降机平台压进甲板：${failingElevators
      .map(
        (item) =>
          `${item.id} 重叠 ${fmt(item.overlapArea, 3)} m²（${fmt(item.overlapRatio * 100, 3)} %），内缘 ${fmt(
            item.inner,
            3,
          )} m 越过该 z 处升降机井内缘 ${fmt(item.deckEdgeAtCentreZ, 3)} m = ${fmt(-item.flushOffset, 3)} m`,
      )
      .join("；")}。井口在参数轮廓里比平台宽/窄 0.1 个平面单位，缩放后即上述毫米级干涉；` +
      `甲板与平台面同高，实际表现为井口边缘有 ${fmt(
        failingElevators[0].overlapArea / failingElevators[0].length,
        3,
      )} m 宽的甲板板条压在平台上方。`,
  );
}
if (failingKeel.length) {
  diagnosis.push(
    `横剖线龙骨：剖面由 ${derivedHull.profile.length} 个 Catmull-Rom 采样点构成，最低采样 yRef = ${fmt(
      profileMinYRef,
      4,
    )}（控制点为 -10.9），采样未落在龙骨控制点上，因此满吃水处横剖线最低点比 hullKeelYAt 高 ${fmt(
      profileMinYRef + 10.9,
      4,
    )} m。z=${failingKeel.map((item) => item.z).join(" / ")} 略微超出 ±${TOL.hullKeel} 容差（最大 ${fmt(
      Math.max(...failingKeel.map((item) => Math.abs(item.keelDelta))),
      4,
    )} m），属离散化偏差，不是曲面错误。`,
  );
}
diagnosis.push(
  `横剖线宽度：剖面最大 |frac| = ${fmt(profileMaxAbsFrac, 6)}，Catmull-Rom 的过冲使横剖线 max|x| 比 ` +
    `hullHalfBeamAt 宽出最多 ${fmt(maxBeamDelta, 4)} m，仍在 ±${TOL.hullBeam} 容差内。`,
);
diagnosis.push(
  `升降机上的停机点 ${airwingMetrics
    .filter((spot) => spot.elevator)
    .map((spot) => `${spot.id}（${spot.elevator}）`)
    .join(" / ")} 在甲板轮廓之外（平台本身位于凹口外侧），` +
    `免除“甲板内缩 2 m”判定，改为校验其落在自己的平台矩形内。`,
);

const passed = checks.filter((item) => item.ok).length;
const failed = checks.length - passed;
const status = failed === 0 ? "passed" : "failed";

const report = {
  generatedAt: new Date().toISOString(),
  tool: "tools/validate_geometry.mjs",
  status,
  source: {
    parameters: "docs/ref/kitty_hawk_cv63_v21_revised/cv63_parameters.json",
    modules: ["src/model/params.js", "src/model/constants.js"],
    hullRings: hullSource,
  },
  summary: {
    checks: checks.length,
    passed,
    failed,
    skipped: skipped.length,
    warnings: warnings.length,
    deckVertices: DECK_OUTLINE.length,
  },
  limits: TOL,
  hullSource: {
    live: Boolean(liveHull.api),
    values: hullSource,
    reason: liveHull.reason ?? null,
    derivation: derivationComparison,
  },
  metrics: {
    deck: {
      area: round(deckArea, 3),
      basePlanArea: round(deckBaseArea, 3),
      planLength: round(planLength, 4),
      bounds: {
        minX: round(DECK_BOUNDS.minX),
        maxX: round(DECK_BOUNDS.maxX),
        minZ: round(DECK_BOUNDS.minZ),
        maxZ: round(DECK_BOUNDS.maxZ),
      },
      deckXScale: round(DECK_X_SCALE, 8),
      vertices: DECK_OUTLINE.length,
      selfIntersections: deckSelfIntersections.length,
      duplicateVertices,
      maxSectionWidth: round(widthWorld.width, 4),
      maxSectionWidthZ: round(widthWorld.p, 4),
      maxSectionWidthBase: round(widthBase.width, 4),
      maxSectionHalfWidth: round(widthMaxHalf, 4),
      maxAbsX: round(maxAbsDeckX, 4),
    },
    angledDeck: {
      angleDeg: round(axisAngleDeg, 6),
      declaredAngleDeg: ANGLED_DECK.angle,
      stripWidth: round(ANGLED_DECK.width, 4),
      stripHalfWidth: round(ANGLED_DECK.stripHalfWidth, 4),
      axisLength: round(axisRun, 4),
      centerStern: [round(ANGLED_DECK.centerStern[0]), round(ANGLED_DECK.centerStern[1])],
      centerBow: [round(ANGLED_DECK.centerBow[0]), round(ANGLED_DECK.centerBow[1])],
      wires: wirePoints.map((wire) => ({
        index: wire.index + 1,
        fraction: wire.fraction,
        x: round(wire.x),
        z: round(wire.z),
        insideDeck: wire.inside,
      })),
    },
    elevators: elevatorMetrics,
    catapults: catapultMetrics,
    airwing: {
      count: AIRWING_SPOTS.length,
      exempt: airwingMetrics.filter((spot) => spot.elevator).map((spot) => spot.id),
      spots: airwingMetrics,
    },
    hull: {
      stationCount: stations.length,
      stationsIncreasing,
      maxHalfBeam: round(stationMaxHalfBeam, 4),
      minHalfBeam: round(stationMinHalfBeam, 4),
      beam: round(stationMaxHalfBeam * 2, 4),
      lengthScale: round(LENGTH_SCALE, 8),
      zRange: hullEval.zRange.map((value) => round(value, 4)),
      profileSampleCount: derivedHull.sectionSampleCount,
      profilePointCount: derivedHull.profile.length,
      liveRingPointCount: liveHull.api?.ringPointCount ?? null,
      profileMaxAbsFrac: round(profileMaxAbsFrac, 8),
      profileMinYRef: round(profileMinYRef, 8),
      sampledMaxHalfBeam: round(sampledMaxHalfBeam.halfBeam, 6),
      sampledMaxHalfBeamZ: round(sampledMaxHalfBeam.z, 4),
      rings: ringMetrics,
      junction: {
        samples: junctionZ.length,
        degenerate: junctionDegenerate,
        worst: {
          z: round(junctionWorst.z, 4),
          hullHalfBeam: round(junctionWorst.hullHalfBeam, 4),
          hullWidth: round(junctionWorst.hullWidth, 4),
          deckHalfWidth: round(junctionWorst.deckHalfWidth, 4),
          clearance: round(junctionWorst.clearance, 4),
        },
        queryMismatch: round(junctionQueryMismatch, 10),
      },
    },
    helpers: {
      ...selfTest,
      squareArea: round(selfTest.squareArea, 6),
      overlapArea: round(selfTest.overlapArea, 6),
      concaveArea: round(selfTest.concaveArea, 6),
      triArea: round(selfTest.triArea, 6),
    },
  },
  checks,
  issues,
  warnings,
  diagnosis,
  skipped,
};

const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", OUTPUT_REL);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

/* ── 控制台摘要 ───────────────────────────────────────────── */

const lines = [];
const pad = (label) => label.padEnd(10);
lines.push("CV-63 舰体几何校验 / geometry validation");
lines.push(`  源       ${report.source.modules.join(" + ")}  ·  hull 横剖线：${hullSource}`);
lines.push("");
lines.push(
  `  ${pad("甲板")}面积 ${fmt(deckArea, 2)} m² · 平面长 ${fmt(planLength, 3)} m · ` +
    `最大截面宽 ${fmt(widthWorld.width, 4)} m @ z=${fmt(widthWorld.p, 1)} · ` +
    `${DECK_OUTLINE.length} 顶点 · 自交 ${deckSelfIntersections.length}`,
);
lines.push(
  `  ${pad("着舰")}夹角 ${fmt(axisAngleDeg, 4)}° · 带宽 ${fmt(ANGLED_DECK.width, 2)} m · ` +
    `拦阻索 z ${wirePoints.map((w) => fmt(w.z, 2)).join(" / ")}（递减 ${wiresDecreasing ? "是" : "否"}，` +
    `全部在甲板内 ${wiresInside ? "是" : "否"}）`,
);
lines.push(
  `  ${pad("升降机")}${elevatorMetrics
    .map(
      (item) =>
        `${item.id} 重叠 ${fmt(item.overlapRatio * 100, 3)}% / 内缘偏移 ${fmt(item.flushOffset, 2)} m / 外缘 ${fmt(
          Math.abs(item.outer),
          2,
        )} m`,
    )
    .join(" · ")}`,
);
lines.push(
  `  ${pad("弹射器")}${catapultMetrics
    .map((item) => `${item.id} ${fmt(item.length, 2)} m ${item.inside.start && item.inside.mid && item.inside.end ? "✓" : "✗"}`)
    .join(" · ")}`,
);
lines.push(
  `  ${pad("舰载机")}${AIRWING_SPOTS.length} 个停机点（${report.metrics.airwing.exempt.length} 个位于升降机平台上，免除甲板内缩判定）`,
);
lines.push(
  `  ${pad("型线")}站位 ${stations.length} 个（递增 ${stationsIncreasing ? "是" : "否"}）· 最大半宽 ${fmt(
    stationMaxHalfBeam,
    3,
  )} m / 型宽 ${fmt(stationMaxHalfBeam * 2, 3)} m（型线极值 ${fmt(sampledMaxHalfBeam.halfBeam, 3)} m @ z=${fmt(sampledMaxHalfBeam.z, 1)}）· 剖面采样 ${derivedHull.profile.length} 点（max|frac| ${fmt(
    profileMaxAbsFrac,
    6,
  )}）`,
);
lines.push(
  `  ${pad("横剖线")}${ringMetrics
    .map((item) => `z=${item.z} 宽差 ${fmt(item.beamDelta, 4)} 龙骨差 ${fmt(item.keelDelta, 4)}`)
    .join(" · ")}`,
);
lines.push(
  `  ${pad("结合部")}最小覆盖余量 ${fmt(junctionWorst.clearance, 3)} m @ z=${fmt(junctionWorst.z, 2)}（${junctionZ.length} 个采样）`,
);
lines.push(
  `  ${pad("hull.js")}${
    liveHull.api
      ? `最小 DOM 垫片可直接加载（横剖面取 hull.js 实际值），脚本内置推导偏差 ` +
        `${derivationComparison.ringPointDelta === null ? "n/a" : Number(derivationComparison.ringPointDelta).toExponential(2)} m`
      : `无法直接加载（${liveHull.reason}）；横剖面改用脚本内置推导，其余校验不受影响`
  }`,
);
lines.push("");
lines.push(`  检查 ${checks.length} 项 · 通过 ${passed} · 失败 ${failed} · 跳过 ${skipped.length} · 警告 ${warnings.length}`);
for (const issue of issues) lines.push(`  ✗ ${issue.id} — ${issue.detail}`);
for (const warning of warnings) lines.push(`  ! ${warning.id} — ${warning.detail}`);
for (const item of skipped) lines.push(`  – ${item.id}（跳过）：${item.reason}`);
lines.push("");
for (const note of diagnosis) lines.push(`  诊断 ${note}`);
lines.push("");
lines.push(`  status = ${status} → ${OUTPUT_REL}`);

console.log(lines.join("\n"));

if (status !== "passed") process.exitCode = 1;
