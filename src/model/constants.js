/**
 * CV-63 尺度与布置常量（全部由 params.js 的参考参数派生）
 * 单位：米。坐标约定：+X 右舷（starboard），+Y 向上，-Z 舰艏（bow），+Z 舰艉（stern）。
 *
 * 本文件不再保存任何"手调"主尺度：
 *   全长 / 型宽 / 吃水 / 甲板最大横截面宽 / 甲板厚度 / 斜角着舰角 / 着舰带半宽
 *   全部来自 docs/ref/kitty_hawk_cv63_v21_revised 的参数表（见 params.js）。
 * 飞行甲板轮廓由参考 DECK_BASE 轮廓按"同一横截面最大宽度 = 76.8 m"归一化后投影，
 * 四部舷侧升降机的凹口已经内建在轮廓里，因此轮廓本身就是甲板边缘（含升降机井）。
 */

import {
  CATAPULT_PLAN,
  CV63_PARAMS,
  DECK_PLAN,
  LANDING_FORE_P,
  LANDING_TAIL_PLAN,
  ARRESTOR_FRACTIONS,
  LENGTH_SCALE,
  VERTICAL,
  maxDeckSectionWidth,
  planToWorld,
} from "./params.js";

/* ── 主尺度 ───────────────────────────────────────────────── */

export const DECK_X_SCALE = CV63_PARAMS.dimensions.deckMaxSectionWidth / maxDeckSectionWidth(DECK_PLAN).width;

/** 飞行甲板平面轮廓（世界坐标，凹口已内建） */
export const DECK_OUTLINE = DECK_PLAN.map(([x, p]) => {
  const [wx, wz] = planToWorld(x * DECK_X_SCALE, p);
  return [wx, wz];
});

export const DECK_BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of DECK_OUTLINE) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ, width: maxX - minX, length: maxZ - minZ };
})();

export const SHIP = {
  loa: CV63_PARAMS.dimensions.hullLength,
  hullLength: CV63_PARAMS.dimensions.hullLength,
  bowZ: DECK_BOUNDS.minZ, // -163.94
  sternZ: DECK_BOUNDS.maxZ, // +159.86
  deckY: VERTICAL.deckTopY, // +20.6
  deckThickness: VERTICAL.deckThickness, // 1.2
  deckUndersideY: VERTICAL.deckUndersideY, // +19.4
  hullTopY: VERTICAL.chineY, // +16.9 舷侧折角线
  hangarY: VERTICAL.hangarY, // +9.9
  hangarTopY: VERTICAL.hangarTopY, // +17.9
  keelY: VERTICAL.keelY, // -10.9
  waterline: VERTICAL.waterlineY, // 0
  beam: CV63_PARAMS.dimensions.hullBeam, // 39.5
  maxDeckWidth: CV63_PARAMS.dimensions.deckMaxSectionWidth, // 76.8
  draft: CV63_PARAMS.dimensions.draft, // 10.9
  landingAngleDeg: CV63_PARAMS.deck.landingAngleDeg, // 11.2
  stripHalfWidth: CV63_PARAMS.deck.stripHalfWidth, // 11.5
};

export const HANGAR = {
  y: SHIP.hangarY,
  top: SHIP.hangarTopY,
  minZ: -104,
  maxZ: 112,
  halfWidth: 15.4,
};

/* ── 舷侧升降机 ───────────────────────────────────────────── */

/**
 * 平台面与飞行甲板齐平，可下沉到机库甲板。
 * x / z 为平台中心；inner / outer 为平台内外缘的 x（带舷别符号）。
 * 平台整体位于甲板轮廓之外（凹口里），所以与甲板面的平面重叠应为 0。
 */
export const ELEVATORS = CV63_PARAMS.elevators.map((item, index) => {
  const side = item.side === "stbd" ? 1 : -1;
  const [refX, z] = planToWorld(item.x * DECK_X_SCALE, item.p);
  const width = item.w * DECK_X_SCALE;
  const length = item.len * LENGTH_SCALE;
  // 平台内缘必须落在甲板轮廓的凹口之外（留 0.18 m 缝隙），
  // 否则平台会压住甲板边缘（参考参数在 3 号升降机处有 0.1 个平面单位的冲突）。
  const clearance = 0.18;
  const deckEdgeHere = deckEdgeAt(z, side);
  const refInner = refX - (side * width) / 2;
  const inner = side > 0
    ? Math.max(refInner, deckEdgeHere + clearance)
    : Math.min(refInner, deckEdgeHere - clearance);
  const x = inner + (side * width) / 2;
  return {
    id: `E${index + 1}`,
    name: item.id,
    label: `ELEV ${index + 1}`,
    side,
    x,
    z,
    width,
    length,
    inner,
    outer: inner + side * width,
    edge: inner + side * width,
    referenceX: refX,
    maxDrop: SHIP.deckY - SHIP.hangarY,
  };
});

/** 升降机井（甲板轮廓的凹口范围），用于贴图与井壁 */
export const ELEVATOR_NOTCHES = ELEVATORS.map((elevator) => ({
  id: elevator.id,
  side: elevator.side,
  z0: elevator.z - elevator.length / 2,
  z1: elevator.z + elevator.length / 2,
  inner: elevator.inner,
  outer: elevator.outer,
}));

/* ── 舰岛 ─────────────────────────────────────────────────── */

const [ISLAND_X, ISLAND_Z] = planToWorld(
  CV63_PARAMS.island.x * DECK_X_SCALE,
  CV63_PARAMS.island.p,
);

export const ISLAND = {
  x: ISLAND_X, // ≈ +26.96（参考 x=29.5 归一化）
  z: ISLAND_Z, // ≈ +26.47（参考 p=-26，舰中偏后）
  plan: { x: CV63_PARAMS.island.x, p: CV63_PARAMS.island.p },
  length: 40,
  width: 15.2,
  deckY: SHIP.deckY,
};

/* ── 斜角甲板（着舰中轴线由 landingAngleDeg 唯一推导）───────── */

export const ANGLED_DECK = (() => {
  const [tailX, tailZ] = planToWorld(LANDING_TAIL_PLAN.x * DECK_X_SCALE, LANDING_TAIL_PLAN.p);
  const foreZ = -LANDING_FORE_P * LENGTH_SCALE;
  const run = tailZ - foreZ;
  const bowX = tailX - run * Math.tan((SHIP.landingAngleDeg * Math.PI) / 180);
  const wires = ARRESTOR_FRACTIONS.map((f) => tailZ + (foreZ - tailZ) * f);
  return {
    angle: SHIP.landingAngleDeg,
    width: SHIP.stripHalfWidth * 2,
    stripHalfWidth: SHIP.stripHalfWidth,
    centerStern: [tailX, tailZ],
    centerBow: [bowX, foreZ],
    thresholdZ: foreZ,
    /** 四道拦阻索的 z（舰艉 → 舰艏） */
    wiresZ: wires,
    /** 拦阻索沿中轴线的相对位置，便于贴图/几何共用 */
    wireFractions: [...ARRESTOR_FRACTIONS],
  };
})();

/* ── 弹射器 ───────────────────────────────────────────────── */

export const CATAPULTS = CATAPULT_PLAN.map((item) => {
  const [sx, sz] = planToWorld(item.start[0] * DECK_X_SCALE, item.start[1]);
  const [ex, ez] = planToWorld(item.end[0] * DECK_X_SCALE, item.end[1]);
  const dx = ex - sx;
  const dz = ez - sz;
  const len = Math.hypot(dx, dz) || 1;
  const aftX = -dx / len;
  const aftZ = -dz / len;
  return {
    id: item.id,
    label: item.label,
    start: [sx, sz],
    end: [ex, ez],
    length: len,
    /** 喷流挡板：起点后方 6 m */
    jbd: [sx + aftX * 6, sz + aftZ * 6],
    angleDeg: (Math.atan2(Math.abs(dx), Math.abs(dz)) * 180) / Math.PI,
  };
});

/* ── 平面查询工具 ─────────────────────────────────────────── */

/** 甲板轮廓在某 z 处的左右边界交点（含升降机凹口） */
export function deckEdgesAt(z) {
  let left = null;
  let right = null;
  for (let i = 0; i < DECK_OUTLINE.length; i++) {
    const a = DECK_OUTLINE[i];
    const b = DECK_OUTLINE[(i + 1) % DECK_OUTLINE.length];
    if ((a[1] - z) * (b[1] - z) > 0) continue;
    if (Math.abs(b[1] - a[1]) < 1e-9) continue;
    const t = (z - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    if (left === null || x < left) left = x;
    if (right === null || x > right) right = x;
  }
  return { left, right };
}

/** 指定舷别的甲板外缘 x（带符号）；舷别为 +1 右舷 / -1 左舷 */
export function deckEdgeAt(z, side = 1) {
  const { left, right } = deckEdgesAt(z);
  const value = side > 0 ? right : left;
  return value === null ? 0 : value;
}

/** 甲板在 z 处的最大半宽（用于贴图安全通道、灯带等对称元素） */
export function deckHalfWidthAt(z) {
  const { left, right } = deckEdgesAt(z);
  return Math.max(Math.abs(left ?? 0), Math.abs(right ?? 0));
}

/** 甲板在 z 处的可用宽度 */
export function deckWidthAt(z) {
  const { left, right } = deckEdgesAt(z);
  return left === null || right === null ? 0 : right - left;
}

/** 点是否落在飞行甲板轮廓内（可带内缩 margin） */
export function deckContains(x, z, margin = 0) {
  let inside = false;
  for (let i = 0, j = DECK_OUTLINE.length - 1; i < DECK_OUTLINE.length; j = i++) {
    const [xi, zi] = DECK_OUTLINE[i];
    const [xj, zj] = DECK_OUTLINE[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (!inside || margin <= 0) return inside;
  const { left, right } = deckEdgesAt(z);
  if (left === null) return false;
  return x > left + margin && x < right - margin;
}

/* ── 动力系统 ─────────────────────────────────────────────── */

export const MACHINERY = {
  boilers: [
    [-8.5, -46],
    [8.5, -46],
    [-8.5, -26],
    [8.5, -26],
    [-8.5, -6],
    [8.5, -6],
    [-8.5, 14],
    [8.5, 14],
  ],
  turbines: [
    [-6.5, 34],
    [6.5, 34],
    [-6.5, 54],
    [6.5, 54],
  ],
  shafts: [
    { x: -6.2, y: -6.9, from: 66, to: 156 },
    { x: 6.2, y: -6.9, from: 66, to: 156 },
    { x: -12.6, y: -6.4, from: 52, to: 152 },
    { x: 12.6, y: -6.4, from: 52, to: 152 },
  ],
  rudders: [
    [-8.0, 157],
    [8.0, 157],
  ],
};

/** 舷侧细节（救生艇舱口避开四部升降机的运行范围） */
export const HULL_DETAILS = {
  anchorZ: -128,
  boatBays: [
    [-1, -16],
    [1, -40],
    [-1, 64],
    [1, 100],
  ],
};

/* ── 舰载机停放（相对新甲板轮廓重新排布）─────────────────── */

export const AIRWING_SPOTS = [
  { id: "hawkeye-1", type: "e2c", x: -6.0, z: -136, yaw: 0, folded: true },
  { id: "prowler-1", type: "ea6b", x: 14.0, z: -104, yaw: 176, folded: true },
  { id: "hornet-1", type: "fa18", x: CATAPULTS[0].start[0], z: CATAPULTS[0].start[1], yaw: 0, folded: false, cat: "cat1" },
  { id: "hornet-2", type: "fa18", x: CATAPULTS[1].start[0], z: CATAPULTS[1].start[1], yaw: 0, folded: false, cat: "cat2" },
  { id: "tomcat-1", type: "f14", x: 26.5, z: -40, yaw: 168, folded: true },
  { id: "tomcat-2", type: "f14", x: 26.0, z: -30, yaw: 168, folded: true },
  { id: "hornet-3", type: "fa18", x: -22.5, z: 54, yaw: 8, folded: false },
  { id: "tomcat-3", type: "f14", x: -7.0, z: 128, yaw: 6, folded: true },
  { id: "seaking-1", type: "sh3", x: 8.0, z: 136, yaw: 90, folded: true },
  { id: "hornet-4", type: "fa18", x: ELEVATORS[2].x, z: ELEVATORS[2].z, yaw: 180, folded: true, elevator: "E3" },
  { id: "hornet-5", type: "fa18", x: ELEVATORS[3].x, z: ELEVATORS[3].z, yaw: 2, folded: true, elevator: "E4" },
];

export const HANGAR_AIRCRAFT = [
  { id: "hangar-fa18", type: "fa18", x: -5.0, z: 26, yaw: 180, folded: true },
  { id: "hangar-f14", type: "f14", x: 6.0, z: -18, yaw: 0, folded: true },
  { id: "hangar-ea6b", type: "ea6b", x: -6.0, z: -58, yaw: 0, folded: true },
];

/* ── 配色 ─────────────────────────────────────────────────── */

export const COLORS = {
  hull: 0x7a868f,
  hullDark: 0x4b545a,
  hullLight: 0x8b969d,
  underwater: 0x6a3d35,
  boot: 0x23272b,
  deck: 0x3b4147,
  deckEdge: 0x2b3035,
  island: 0x7d8891,
  islandDark: 0x4f5a62,
  steel: 0x8d979e,
  steelDark: 0x50595f,
  glass: 0x0d1b24,
  glassLit: 0x7fb6cf,
  warning: 0xd8a64a,
  white: 0xcbd5da,
  black: 0x14181b,
  rubber: 0x1b1e21,
  bronze: 0xb08d57,
  jet: 0x8a949c,
  jetDark: 0x444b51,
  radar: 0xa6b1b8,
  completion: 0x5de3ff,
};

export const BLOCK_IDS = [
  "hull",
  "flightdeck",
  "elevators",
  "island",
  "hangar",
  "propulsion",
  "airwing",
  "weapons",
  "structure",
];
