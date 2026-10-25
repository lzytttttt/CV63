/**
 * CV-63 尺度与布置常量
 * 单位：米。坐标约定：+X 右舷（starboard），+Y 向上，-Z 舰艏（bow），+Z 舰艉（stern）。
 * 比例参照 docs/ref 中的三维结构线框图：全长 323.8 m、甲板最大宽 76.8 m、吃水 11.4 m。
 */

export const SHIP = {
  loa: 323.8,
  bowZ: -162,
  sternZ: 162,
  deckY: 20.6, // 飞行甲板面
  deckThickness: 1.9,
  hullTopY: 18.4, // 舷侧外板顶（甲板以下）
  hangarY: 9.9, // 机库甲板
  hangarTopY: 17.9, // 机库顶 / 甲板下缘
  keelY: -11.8,
  waterline: 0,
  beam: 39.6,
  maxDeckWidth: 76.8,
  draft: 11.4,
};

export const HANGAR = {
  y: SHIP.hangarY,
  top: SHIP.hangarTopY,
  minZ: -104,
  maxZ: 112,
  halfWidth: 15.4,
};

/**
 * 飞行甲板外轮廓（顺时针，舰艏 → 右舷 → 舰艉 → 左舷 → 舰艏）。
 * 四段凹口为舷侧升降机井：E2/E3 右舷，E4/E1 左舷。
 */
export const DECK_OUTLINE = [
  // ── bow tip → starboard
  [0.0, -162.0],
  [3.2, -160.4],
  [6.4, -157.8],
  [9.6, -154.8],
  [12.5, -151.4],
  [15.3, -147.4],
  [18.1, -143.0],
  [20.8, -138.2],
  [23.4, -133.0],
  [25.9, -127.4],
  [28.2, -121.4],
  [30.3, -115.0],
  [32.2, -108.2],
  [33.9, -101.0],
  [35.4, -93.4],
  [36.6, -85.4],
  [37.5, -77.2],
  [38.1, -68.8],
  [38.4, -60.2],
  [38.4, -51.6],
  [38.4, -43.0],
  [38.4, -34.4],
  [38.4, -25.8],
  [38.4, -17.2],
  [38.4, -8.6],
  [38.4, -2.0],
  // E2 notch (starboard)
  [28.9, -2.0],
  [28.9, 20.0],
  [38.4, 20.0],
  [38.4, 28.0],
  [38.4, 36.0],
  [38.4, 44.0],
  [38.4, 52.0],
  [38.4, 60.0],
  [38.4, 68.0],
  [38.4, 76.0],
  [38.4, 84.0],
  [38.35, 92.0],
  [38.3, 100.0],
  // E3 notch (starboard)
  [28.9, 100.0],
  [28.9, 122.0],
  [38.2, 122.0],
  [38.1, 128.0],
  [37.7, 134.0],
  [37.1, 140.0],
  [36.2, 146.0],
  [35.0, 151.0],
  [33.2, 155.2],
  [30.9, 158.6],
  [28.0, 161.0],
  [24.6, 162.0],
  [20.8, 162.4],
  [16.6, 162.4],
  // ── transom
  [12.0, 162.2],
  [6.0, 162.8],
  [0.0, 163.0],
  [-6.0, 162.8],
  [-12.0, 162.2],
  // ── port side, stern → bow
  [-16.6, 162.4],
  [-20.8, 162.4],
  [-24.6, 162.0],
  [-28.0, 161.0],
  [-30.9, 158.6],
  [-33.2, 155.2],
  [-35.0, 151.0],
  [-36.2, 146.0],
  [-37.1, 140.0],
  [-37.7, 134.0],
  [-38.1, 128.0],
  [-38.2, 122.0],
  [-38.3, 116.0],
  [-38.4, 110.0],
  [-38.4, 104.0],
  [-38.4, 100.0],
  // E4 notch (port)
  [-28.9, 100.0],
  [-28.9, 78.0],
  [-38.4, 78.0],
  [-38.4, 70.0],
  [-38.4, 62.0],
  [-38.4, 54.0],
  [-38.4, 46.0],
  [-38.4, 38.0],
  [-38.4, 30.0],
  [-38.4, 22.0],
  [-38.4, 14.0],
  [-38.4, 6.0],
  [-38.4, -2.0],
  [-38.4, -10.0],
  [-38.4, -18.0],
  [-38.4, -26.0],
  [-38.4, -34.0],
  [-38.4, -42.0],
  [-38.4, -50.0],
  [-38.3, -58.0],
  [-38.1, -66.0],
  [-37.7, -73.0],
  [-37.2, -78.0],
  // E1 notch (port)
  [-27.6, -78.0],
  [-27.6, -98.0],
  [-36.5, -98.0],
  [-35.6, -103.0],
  [-34.6, -108.0],
  [-33.4, -113.0],
  [-32.1, -118.0],
  [-30.6, -123.0],
  [-29.0, -128.0],
  [-27.2, -133.0],
  [-25.2, -138.0],
  [-23.0, -143.0],
  [-20.6, -148.0],
  [-17.8, -152.4],
  [-14.8, -156.4],
  [-11.6, -159.6],
  [-7.8, -161.4],
  [-3.8, -162.2],
];

/** 斜角甲板：着舰区中心线（约 9° 左偏），从舰艉指向前方 */
export const ANGLED_DECK = {
  angle: 9.0,
  width: 26.0,
  centerStern: [-1.0, 156.0],
  centerBow: [-24.0, 20.0],
  thresholdZ: 20.0,
  wiresZ: [104, 116, 128, 140],
};

/** 弹射器：起点（甲板后部）与终点（舰艏方向） */
export const CATAPULTS = [
  { id: "cat1", label: "CAT 1", start: [-7.0, -54], end: [-8.5, -154.0], jbd: [-7.0, -47] },
  { id: "cat2", label: "CAT 2", start: [6.5, -46], end: [5.5, -149.0], jbd: [6.5, -39] },
  { id: "cat3", label: "CAT 3", start: [-35.0, 46], end: [-16.0, -58.0], jbd: [-37.0, 54] },
  { id: "cat4", label: "CAT 4", start: [-42.0, 62], end: [-23.0, -42.0], jbd: [-44.0, 70] },
];

/**
 * 四部舷侧升降机，平台在甲板面与机库甲板之间往复。
 * side: +1 右舷 / -1 左舷；z 为中心；length 沿 Z；width 沿 X；edge 为甲板外缘。
 */
export const ELEVATORS = [
  { id: "E1", side: -1, z: -88, length: 20, width: 9.0, edge: -36.0, inner: -27.6, label: "ELEV 1" },
  { id: "E2", side: 1, z: 9, length: 22, width: 9.5, edge: 38.4, inner: 28.9, label: "ELEV 2" },
  { id: "E3", side: 1, z: 111, length: 22, width: 9.5, edge: 38.3, inner: 28.9, label: "ELEV 3" },
  { id: "E4", side: -1, z: 89, length: 22, width: 9.5, edge: -38.4, inner: -28.9, label: "ELEV 4" },
];

/** 舰岛：位于右舷约 1/3 舰长处（参照俯视图） */
export const ISLAND = {
  x: 31.0,
  z: -45,
  length: 38,
  width: 13.5,
  deckY: SHIP.deckY,
};

/** 动力系统：锅炉 / 轮机 / 轴系 */
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
    { x: -6.2, y: -6.4, from: 66, to: 152 },
    { x: 6.2, y: -6.4, from: 66, to: 152 },
    { x: -12.6, y: -4.6, from: 52, to: 144 },
    { x: 12.6, y: -4.6, from: 52, to: 144 },
  ],
  rudders: [
    [-8.0, 146],
    [8.0, 146],
  ],
};

/** 舷侧细节 */
export const HULL_DETAILS = {
  anchorZ: -128,
  boatBays: [
    [-1, -16],
    [1, -16],
    [-1, 64],
    [1, 64],
  ],
};

/** 舰载机停放（type / x / z / yaw 角度 / 折叠机翼） */
export const AIRWING_SPOTS = [
  { id: "hawkeye-1", type: "e2c", x: 21.0, z: -112, yaw: 0, folded: true },
  { id: "prowler-1", type: "ea6b", x: 26.0, z: -70, yaw: 176, folded: false },
  { id: "hornet-1", type: "fa18", x: -7.0, z: -56.0, yaw: 0, folded: false, cat: "cat1" },
  { id: "hornet-2", type: "fa18", x: 6.5, z: -48.0, yaw: 0, folded: false, cat: "cat2" },
  { id: "tomcat-1", type: "f14", x: 27.0, z: -14, yaw: 168, folded: true },
  { id: "tomcat-2", type: "f14", x: 26.0, z: 16, yaw: 168, folded: true },
  { id: "hornet-3", type: "fa18", x: -33.0, z: 56, yaw: 8, folded: false },
  { id: "tomcat-3", type: "f14", x: -34.0, z: 128, yaw: 6, folded: true },
  { id: "seaking-1", type: "sh3", x: 15.0, z: 138, yaw: 90, folded: true },
  { id: "hornet-4", type: "fa18", x: 33.6, z: 111, yaw: 180, folded: false, elevator: "E3" },
  { id: "hornet-5", type: "fa18", x: -33.6, z: 89, yaw: 2, folded: false, elevator: "E4" },
];

export const HANGAR_AIRCRAFT = [
  { id: "hangar-fa18", type: "fa18", x: -5.0, z: 26, yaw: 180, folded: true },
  { id: "hangar-f14", type: "f14", x: 6.0, z: -18, yaw: 0, folded: true },
  { id: "hangar-ea6b", type: "ea6b", x: -6.0, z: -58, yaw: 0, folded: true },
];

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

/* ── 派生工具 ─────────────────────────────────────────────── */

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

/** 飞行甲板轮廓上的凹口（升降机井） */
export const ELEVATOR_NOTCHES = [
  { id: "E2", side: 1, z0: -2, z1: 20, inner: 28.9, outer: 38.4 },
  { id: "E3", side: 1, z0: 100, z1: 122, inner: 28.9, outer: 38.3 },
  { id: "E4", side: -1, z0: 78, z1: 100, inner: -28.9, outer: -38.4 },
  { id: "E1", side: -1, z0: -98, z1: -78, inner: -27.6, outer: -36.5 },
];

export function deckHalfWidthAt(z) {
  const clamped = Math.max(-162, Math.min(163, z));
  let best = 0;
  for (let i = 0; i < DECK_OUTLINE.length; i++) {
    const a = DECK_OUTLINE[i];
    const b = DECK_OUTLINE[(i + 1) % DECK_OUTLINE.length];
    if ((a[1] - clamped) * (b[1] - clamped) > 0) continue;
    if (Math.abs(b[1] - a[1]) < 1e-6) continue;
    const t = (clamped - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    best = Math.max(best, Math.abs(x));
  }
  return best;
}

export function deckEdgesAt(z) {
  const half = deckHalfWidthAt(z);
  let left = -half;
  let right = half;
  for (const notch of ELEVATOR_NOTCHES) {
    if (z >= notch.z0 && z <= notch.z1) {
      if (notch.side > 0) right = notch.inner;
      else left = notch.inner;
    }
  }
  return { left, right };
}

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
