/**
 * CV-63 参数契约 / PARAMETER CONTRACT
 * =============================================================
 * 权威来源：docs/ref/kitty_hawk_cv63_v21_revised/
 *   - cv63_parameters.json（V2.1 revised 参数表）
 *   - kitty_hawk_cv63_v21.js（同一套参数的正式实现）
 *
 * 本文件是全模型唯一的尺度来源：constants.js 只做投影与派生，
 * 任何几何模块都不得再硬编码主尺度。
 *
 * 坐标约定：-X 左舷 / +X 右舷，+Y 向上，-Z 舰艏 / +Z 舰艉。
 * 参考参数用平面坐标 p（正值指向舰艏），换算关系 z = -p * LENGTH_SCALE。
 *
 * ── 与参考值的两处有意投影覆盖（其余全部 1:1 采用）───────────
 * 1. dimensions.hullLength：参考 318 m（水线附近的型长基准）→ 本工作台
 *    采用公开主尺度的总长 323.8 m（LOA）。参考实现本身即以
 *    `hullLength / 318` 作为纵向缩放，这里正是该参数的设计用法。
 * 2. deck.topY：参考 12.2 m 是与它自身 21.9 m 型深配套的“概念干舷”；
 *    本工作台的机库层（+9.9 m，净高 7.6 m）与舰岛、舰载机均按公开资料
 *    标定在 20.6 m 飞行甲板高度上，因此纵向基准沿用 20.6 m。
 *    船体型线（横剖面序列）按 VERTICAL 映射到本模型的型深，
 *    水线以下保持参考原值，不改变吃水。
 * 其余参数（hullBeam / draft / deckMaxSectionWidth / deck.thickness /
 * landingAngleDeg / stripHalfWidth / textureSeed / hull.stations /
 * elevators / island）全部直接采用。
 */

/* ── 参考参数原样留档 ─────────────────────────────────────── */

export const CV63_SOURCE = {
  metadata: {
    model: "USS Kitty Hawk CV-63 / Three.js study V2.1",
    units: "meter",
    coordinateSystem: "-X port, +X starboard, +Y up, -Z bow, +Z stern; plan positive P toward bow",
  },
  dimensions: { hullLength: 318, hullBeam: 39.5, draft: 10.9, deckMaxSectionWidth: 76.8 },
  deck: { topY: 12.2, thickness: 1.2, landingAngleDeg: 11.2, stripHalfWidth: 11.5, textureSeed: 63 },
  hull: {
    longitudinalSegments: 96,
    stations: [
      [-157, 11.6],
      [-148, 14.4],
      [-128, 17.9],
      [-100, 19.15],
      [-60, 19.75],
      [0, 19.75],
      [45, 19.7],
      [85, 18.4],
      [115, 15.2],
      [141, 8.3],
      [156, 2.4],
      [161, 0.4],
    ],
  },
  elevators: [
    { id: "Elevator_1_Stbd_Fwd", side: "stbd", x: 30.5, p: 63, w: 11.3, len: 19.6, maxDrop: 8 },
    { id: "Elevator_2_Stbd_Mid", side: "stbd", x: 32.0, p: 14, w: 11.8, len: 19.6, maxDrop: 8 },
    { id: "Elevator_3_Stbd_Aft", side: "stbd", x: 29.0, p: -71, w: 10.2, len: 19.6, maxDrop: 8 },
    { id: "Elevator_4_Port_Aft", side: "port", x: -20.0, p: -103, w: 9.5, len: 19.6, maxDrop: 8 },
  ],
  island: { x: 29.5, p: -26 },
  materials: { hull: 0x899aa6, deck: 0x303740, support: 0x667985, red: 0x7c373b, black: 0x262d34, window: 0x1e3e52 },
};

/* ── 有效参数（含投影覆盖） ───────────────────────────────── */

export const CV63_PARAMS = {
  metadata: {
    ...CV63_SOURCE.metadata,
    reference: "docs/ref/kitty_hawk_cv63_v21_revised/cv63_parameters.json",
    verticalDatum: "飞行甲板 +20.6 m（公开主尺度），型线按 VERTICAL 映射参考剖面",
  },
  dimensions: { ...CV63_SOURCE.dimensions, hullLength: 323.8 },
  deck: { ...CV63_SOURCE.deck, topY: 20.6 },
  hull: { ...CV63_SOURCE.hull, sectionSamples: 37 },
  elevators: CV63_SOURCE.elevators.map((item) => ({ ...item })),
  island: { ...CV63_SOURCE.island },
  materials: { ...CV63_SOURCE.materials },
};

/** 纵向缩放：参考站位表以 318 m 为基准，本模型按 hullLength 拉伸 */
export const LENGTH_SCALE = CV63_PARAMS.dimensions.hullLength / 318;

/** 参考平面坐标 (x, p) → 世界坐标 (x, z) */
export function planToWorld(x, p) {
  return [x, -p * LENGTH_SCALE];
}

/* ── 纵向基准与型线映射 ───────────────────────────────────── */

/**
 * 型深映射。参考模型的剖面 y 基准为：
 *   龙骨 -10.9 / 水线 0 / 舷侧折角线 +9.2 / 甲板下缘 +11.0
 * 本模型的纵向基准为：
 *   龙骨 -10.9 / 水线 0 / 舷侧折角线 +16.9 / 甲板下缘 +19.4
 * 水线以下 1:1 保留（不改变吃水与舵桨位置），水线以上按折角线比例拉伸，
 * 使外飘舷侧高度与机库层（+9.9 … +17.9）匹配。
 */
export const VERTICAL = {
  keelY: -CV63_PARAMS.dimensions.draft, // -10.9
  waterlineY: 0,
  deckTopY: CV63_PARAMS.deck.topY, // 20.6
  deckThickness: CV63_PARAMS.deck.thickness, // 1.2
  deckUndersideY: CV63_PARAMS.deck.topY - CV63_PARAMS.deck.thickness, // 19.4
  chineY: 16.9, // 舷侧折角线 / 外飘起点
  chineFraction: 0.83, // 参考剖面顶端的半宽系数
  topsideFraction: 0.8, // 折角线以上舷侧板的半宽系数（轻微内倾）
  hangarY: 9.9, // 机库甲板
  hangarTopY: 17.5, // 机库顶（净高 7.6 m）
  referenceChineY: 9.2,
  referenceDeckY: 11.0,
};

/** 参考剖面 y → 本模型 y（水线以下不变，水线以上按折角线比例拉伸） */
export function verticalMapY(yRef) {
  if (yRef <= 0) return yRef;
  return (yRef * VERTICAL.chineY) / VERTICAL.referenceChineY;
}

/**
 * 参考模型的横剖面控制序列（半宽系数, 参考 y）。
 * 顺序：左舷折角线 → 舭部 → 龙骨 → 右舷舭部 → 右舷折角线。顶部不封口，
 * 由飞行甲板结构带闭合（参考实现同样把它当作开口壳体）。
 */
export const HULL_SECTION_SEQ = [
  [-0.83, 9.2],
  [-0.95, 6.8],
  [-1.0, 2.4],
  [-0.99, 0.55],
  [-0.94, -1.2],
  [-0.82, -4.8],
  [-0.59, -8.1],
  [-0.27, -10.2],
  [0.0, -10.9],
  [0.27, -10.2],
  [0.59, -8.1],
  [0.82, -4.8],
  [0.94, -1.2],
  [0.99, 0.55],
  [1.0, 2.4],
  [0.95, 6.8],
  [0.83, 9.2],
];

/* ── 飞行甲板平面轮廓（参考 DECK_BASE）─────────────────────
 * 凹口为四部舷侧升降机井，已内建在轮廓里：
 *   右舷 p 52…74 / p 3…25 / p -60…-82，左舷 p -92…-114。
 * 顺序：舰艏左 → 舰艏右 → 右舷 → 舰艉 → 左舷 → 舰艏。
 */
export const DECK_PLAN = [
  [-8.5, 161],
  [8.5, 161],
  [15.5, 128],
  [24, 92],
  [31, 76],
  [24.5, 74],
  [24.5, 52],
  [35, 50],
  [37.5, 26],
  [26, 25],
  [26, 3],
  [38.5, 1],
  [39, -54],
  [34.5, -58],
  [24, -60],
  [24, -82],
  [33.5, -84],
  [31, -112],
  [22, -138],
  [15.5, -157],
  [-14.5, -157],
  [-20, -132],
  [-22.5, -116],
  [-15, -114],
  [-15, -92],
  [-24, -90],
  [-27.5, -72],
  [-41, -5],
  [-46.5, 25],
  [-47, 44],
  [-34, 49],
  [-28.5, 60],
  [-22, 66],
  [-19.5, 96],
  [-14.5, 130],
];

/* ── 弹射器布置（参考实现中的四条轨道）────────────────────
 * 每项：起点（喷流挡板一侧，靠后）/ 终点（舰艏方向）。
 */
export const CATAPULT_PLAN = [
  { id: "cat1", label: "CAT 1", start: [6, 68], end: [5.5, 157] },
  { id: "cat2", label: "CAT 2", start: [-7.5, 68], end: [-5.5, 157] },
  { id: "cat3", label: "CAT 3", start: [-19, -35], end: [-33, 45] },
  { id: "cat4", label: "CAT 4", start: [-29, -40], end: [-43.5, 40] },
];

/** 着舰中轴线在平面坐标中的尾端（参考实现：p = -135，x = 5.5） */
export const LANDING_TAIL_PLAN = { x: 5.5, p: -135 };

/** 着舰中轴线前端（参考实现：p = 44） */
export const LANDING_FORE_P = 44;

/** 四道拦阻索在着舰中轴线上的相对位置 */
export const ARRESTOR_FRACTIONS = [0.16, 0.21, 0.26, 0.31];

/* ── 平面几何工具 ─────────────────────────────────────────── */

/** 指定平面位置 p 处，轮廓与横线的交点（升序） */
export function planCrossSection(points, p) {
  const hits = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if ((a[1] <= p && p < b[1]) || (b[1] <= p && p < a[1])) {
      hits.push(a[0] + ((b[0] - a[0]) * (p - a[1])) / (b[1] - a[1]));
    }
  }
  hits.sort((a, b) => a - b);
  return hits.length >= 2 ? { left: hits[0], right: hits[hits.length - 1], width: hits[hits.length - 1] - hits[0] } : null;
}

/**
 * 最大横截面宽度：只比较同一纵向位置上的左右边界，
 * 而不是把整个外形的 maxX - minX 当成"同一横截面"。参考实现的校正点。
 */
export function maxDeckSectionWidth(points = DECK_PLAN) {
  const ps = [...new Set(points.map((pt) => pt[1]))].sort((a, b) => a - b);
  let best = { width: 0, p: 0 };
  for (let i = 0; i < ps.length - 1; i++) {
    // 截面宽度在顶点邻域内是分段线性的，极值可能恰好出现在顶点旁，
    // 只取中点会低估最大宽度。
    const delta = Math.min(0.00001, (ps[i + 1] - ps[i]) / 1000);
    for (const p of [ps[i] + delta, (ps[i] + ps[i + 1]) / 2, ps[i + 1] - delta]) {
      const row = planCrossSection(points, p);
      if (row && row.width > best.width) best = { width: row.width, p };
    }
  }
  return best;
}

/** 参考站位表的半宽插值（按平面 p） */
export function interpolateStationHalfBeam(p) {
  const stations = CV63_PARAMS.hull.stations;
  if (p <= stations[0][0]) return stations[0][1];
  if (p >= stations[stations.length - 1][0]) return stations[stations.length - 1][1];
  for (let i = 1; i < stations.length; i++) {
    if (p <= stations[i][0]) {
      const [p0, w0] = stations[i - 1];
      const [p1, w1] = stations[i];
      const t = (p - p0) / (p1 - p0);
      return w0 + (w1 - w0) * t;
    }
  }
  return stations[stations.length - 1][1];
}

/** 固定种子的伪随机数（甲板贴图噪点等可复现内容使用） */
export function seededRandom(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
