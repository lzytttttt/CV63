/**
 * v1.1 作战模式的可调参数与静态定义。
 *
 * 设计原则：所有平衡数值集中在本文件，推演逻辑只读；改数值不碰流程代码。
 * 时间单位 s，距离 km，速度 km/s（显示时换算为 kn），方位角 0° = 北、顺时针。
 */

import { ANGLED_DECK, CATAPULTS, ELEVATORS, ISLAND, SHIP } from "../model/constants.js";

export const GAME_VERSION = "1.1.0";
export const SCENARIO_NAME = "铁巢 / OPERATION IRON NEST";
export const SCENARIO_DURATION = 600;
export const TICK = 0.1;
export const SENSOR_INTERVAL = 1;

export const DIFFICULTY = {
  standard: {
    id: "standard",
    label: "标准 / STANDARD",
    enemyMissilePk: 1,
    enemySalvoBonus: 0,
    damageScale: 1,
    description: "逐波防御 + 主动打击，适合首次指挥。",
  },
};

/** 舰载机机型 */
export const AIRCRAFT_TYPES = {
  fa18: {
    id: "fa18",
    label: "F/A-18C 大黄蜂",
    short: "F/A-18",
    role: "fighter",
    crew: 1,
    speed: 0.36,
    endurance: 480,
    serviceTime: 52,
    launch: "cat",
    catPreference: ["cat1", "cat2", "cat3", "cat4"],
    capPk: 0.5,
    capRange: 95,
    harpoons: 2,
    strikeCapable: true,
  },
  f14: {
    id: "f14",
    label: "F-14D 雄猫",
    short: "F-14",
    role: "fighter",
    crew: 2,
    speed: 0.38,
    endurance: 460,
    serviceTime: 56,
    launch: "cat",
    catPreference: ["cat1", "cat2", "cat3", "cat4"],
    capPk: 0.6,
    capRange: 150,
    harpoons: 0,
    strikeCapable: false,
  },
  e2c: {
    id: "e2c",
    label: "E-2C 鹰眼",
    short: "E-2C",
    role: "aew",
    crew: 5,
    speed: 0.3,
    endurance: 900,
    serviceTime: 74,
    launch: "cat",
    catPreference: ["cat3", "cat4"],
    capPk: 0,
    harpoons: 0,
    strikeCapable: false,
  },
  ea6b: {
    id: "ea6b",
    label: "EA-6B 徘徊者",
    short: "EA-6B",
    role: "ew",
    crew: 4,
    speed: 0.3,
    endurance: 720,
    serviceTime: 68,
    launch: "cat",
    catPreference: ["cat3", "cat4"],
    capPk: 0,
    harpoons: 0,
    strikeCapable: false,
  },
  sh3: {
    id: "sh3",
    label: "SH-3D 海王",
    short: "SH-3",
    role: "sar",
    crew: 4,
    speed: 0.24,
    endurance: 600,
    serviceTime: 38,
    launch: "vertical",
    catPreference: [],
    capPk: 0,
    harpoons: 0,
    strikeCapable: false,
  },
};

export const ROSTER = [
  { id: "hawkeye-1", type: "e2c", callsign: "鹰眼 01", spot: "S1" },
  { id: "prowler-1", type: "ea6b", callsign: "徘徊者 01", spot: "S2" },
  { id: "hornet-1", type: "fa18", callsign: "大黄蜂 01", spot: "S3" },
  { id: "hornet-2", type: "fa18", callsign: "大黄蜂 02", spot: "S4" },
  { id: "tomcat-1", type: "f14", callsign: "雄猫 01", spot: "S5" },
  { id: "tomcat-2", type: "f14", callsign: "雄猫 02", spot: "S6" },
  { id: "hornet-3", type: "fa18", callsign: "大黄蜂 03", spot: "S7" },
  { id: "tomcat-3", type: "f14", callsign: "雄猫 03", spot: "S8" },
  { id: "seaking-1", type: "sh3", callsign: "海王 01", spot: "S9" },
  { id: "hornet-4", type: "fa18", callsign: "大黄蜂 04", spot: "S10" },
  { id: "hornet-5", type: "fa18", callsign: "大黄蜂 05", spot: "S11" },
  { id: "hangar-fa18", type: "fa18", callsign: "大黄蜂 06", hangar: "H1" },
  { id: "hangar-f14", type: "f14", callsign: "雄猫 04", hangar: "H2" },
  { id: "hangar-ea6b", type: "ea6b", callsign: "徘徊者 02", hangar: "H3" },
];

/** 甲板停机位（前 9 个在飞行甲板，S10/S11 在 E3/E4 升降机平台上） */
export const DECK_SPOTS = [
  { id: "S1", x: -6.0, z: -136, yaw: 0 },
  { id: "S2", x: 14.0, z: -104, yaw: 176 },
  { id: "S3", x: CATAPULTS[0].start[0], z: CATAPULTS[0].start[1], yaw: 0 },
  { id: "S4", x: CATAPULTS[1].start[0], z: CATAPULTS[1].start[1], yaw: 0 },
  { id: "S5", x: 26.5, z: -40, yaw: 168 },
  { id: "S6", x: 26.0, z: -30, yaw: 168 },
  { id: "S7", x: -22.5, z: 54, yaw: 8 },
  { id: "S8", x: -7.0, z: 128, yaw: 6 },
  { id: "S9", x: 8.0, z: 136, yaw: 90 },
  { id: "S10", x: ELEVATORS[2].x, z: ELEVATORS[2].z, yaw: 180, elevator: "E3" },
  { id: "S11", x: ELEVATORS[3].x, z: ELEVATORS[3].z, yaw: 2, elevator: "E4" },
  { id: "S12", x: 24.0, z: 100, yaw: 12 },
];

export const HANGAR_BAYS = [
  { id: "H1", x: -5.0, z: 26, yaw: 180 },
  { id: "H2", x: 6.0, z: -18, yaw: 0 },
  { id: "H3", x: -6.0, z: -58, yaw: 0 },
];

export const HANGAR_ELEVATORS = ["E1", "E2"];
export const WAIST_CATS = ["cat3", "cat4"];
export const BOW_CATS = ["cat1", "cat2"];

export const CAT = {
  cat1: { id: "cat1", label: "CAT 1", group: "bow" },
  cat2: { id: "cat2", label: "CAT 2", group: "bow" },
  cat3: { id: "cat3", label: "CAT 3", group: "waist" },
  cat4: { id: "cat4", label: "CAT 4", group: "waist" },
};

export const ELEVATOR = Object.fromEntries(
  ELEVATORS.map((item) => [item.id, { id: item.id, label: item.label, x: item.x, z: item.z }]),
);

/** 甲板作业时间（秒） */
export const DECK_TIMING = {
  taxiSpeed: 7.5, // m/s，牵引车速度（可视化压缩）
  taxiMin: 9,
  taxiMax: 34,
  hook: 8,
  stroke: 4,
  catCooldown: 11,
  elevatorCycle: 34,
  spotTaxi: 14,
  approach: 17,
  trap: 3,
  clear: 13,
  taxiIn: 12,
  hangarTaxi: 56,
  launchCrews: 2,
  serviceCrews: 3,
};

/** 舰载武器站（世界坐标只用于 3D 对准；战术侧只用射界） */
export const MOUNTS = [
  {
    id: "sparrow-1",
    kind: "sam",
    label: "Mk 29 · 海麻雀 #1",
    short: "SPARROW 1",
    side: "starboard",
    arcCenter: 90,
    arcWidth: 90,
    minRange: 2,
    maxRange: 28,
    ammo: 8,
    magazine: 8,
    cycle: 5.5,
    pkMissile: 0.58,
    pkAir: 0.7,
    guided: true,
    x: 37.5,
    z: -96,
    bearing3d: 90,
  },
  {
    id: "sparrow-2",
    kind: "sam",
    label: "Mk 29 · 海麻雀 #2",
    short: "SPARROW 2",
    side: "port",
    arcCenter: 270,
    arcWidth: 90,
    minRange: 2,
    maxRange: 28,
    ammo: 8,
    magazine: 8,
    cycle: 5.5,
    pkMissile: 0.58,
    pkAir: 0.7,
    guided: true,
    x: -40.6,
    z: 64,
    bearing3d: 270,
  },
  {
    id: "ciws-1",
    kind: "ciws",
    label: "Mk 15 · 密集阵 #1",
    short: "CIWS 1",
    side: "starboard",
    arcCenter: 90,
    arcWidth: 100,
    minRange: 0.1,
    maxRange: 1.9,
    ammo: 1500,
    magazine: 1500,
    burst: 180,
    cycle: 4.4,
    pkMissile: 0.42,
    pkAir: 0.28,
    guided: false,
    x: 39.5,
    z: 132,
    bearing3d: 90,
  },
  {
    id: "ciws-2",
    kind: "ciws",
    label: "Mk 15 · 密集阵 #2",
    short: "CIWS 2",
    side: "port",
    arcCenter: 270,
    arcWidth: 100,
    minRange: 0.1,
    maxRange: 1.9,
    ammo: 1500,
    magazine: 1500,
    burst: 180,
    cycle: 4.4,
    pkMissile: 0.42,
    pkAir: 0.28,
    guided: false,
    x: -35,
    z: -128,
    bearing3d: 270,
  },
  {
    id: "escort",
    kind: "escort",
    label: "CG-18 · 护航舰 SM-1",
    short: "ESCORT",
    side: "screen",
    arcCenter: 0,
    arcWidth: 180,
    minRange: 1,
    maxRange: 50,
    ammo: 8,
    magazine: 8,
    cycle: 10,
    pkMissile: 0.62,
    pkAir: 0.64,
    guided: true,
    x: 900,
    z: 900,
    bearing3d: 0,
    delay: 6,
  },
];

/** 舰载系统 ID → 显示名；命中后有概率损坏 */
export const SYSTEMS = [
  { id: "radar", label: "SPS-48 对空雷达", short: "RADAR" },
  { id: "cat1", label: "CAT 1 弹射器", short: "CAT 1" },
  { id: "cat2", label: "CAT 2 弹射器", short: "CAT 2" },
  { id: "cat3", label: "CAT 3 弹射器", short: "CAT 3" },
  { id: "cat4", label: "CAT 4 弹射器", short: "CAT 4" },
  { id: "sparrow-1", label: "海麻雀 #1", short: "SPW 1" },
  { id: "sparrow-2", label: "海麻雀 #2", short: "SPW 2" },
  { id: "ciws-1", label: "密集阵 #1", short: "CIWS 1" },
  { id: "ciws-2", label: "密集阵 #2", short: "CIWS 2" },
];

/** 传感器包线（km） */
export const SENSOR = {
  radar: { airHigh: 230, airLow: 72, surface: 58, missileLow: 30, missileHigh: 52 },
  aew: { airHigh: 400, airLow: 165, surface: 260, missileLow: 88, missileHigh: 150 },
  esm: { range: 430, bearingError: 9 },
  visual: { range: 28 },
  jammingFactor: 0.78,
};

export const DEFENSE = {
  incomingWarning: 30, // s，进入该时间窗时红色警报
  chaffRange: 11,
  chaffPk: 0.7,
  chaffLoads: 6,
  chaffCooldown: 5,
  ciwsAuto: true,
  missileSpeed: 0.7,
  missileAltitude: 0.03,
  missileDamage: [18, 24],
  fireChance: 0.55,
  fireDps: 0.4,
  fireDuration: 42,
  repairDuration: 52,
  dcTeams: 3,
  systemDamageChance: 0.38,
  deckAircraftLossChance: 0.18,
  hullMax: 100,
};

export const CONTACT_TYPES = {
  fighter: { label: "战斗机", symbol: "air", speed: 0.42, rcs: 0.7 },
  strike: { label: "打击机", symbol: "air", speed: 0.36, rcs: 0.85 },
  airliner: { label: "民航客机", symbol: "air", speed: 0.24, rcs: 1.4 },
  destroyer: { label: "驱逐舰", symbol: "surface", speed: 0.0093, rcs: 1.6 },
  fishing: { label: "渔船编队", symbol: "surface", speed: 0.006, rcs: 0.8 },
  asm: { label: "反舰导弹", symbol: "missile", speed: DEFENSE.missileSpeed, rcs: 0.12 },
};

/** 场景事件表：由 scenario.js 消费 */
export const SCENARIO = {
  duration: SCENARIO_DURATION,
  surfaceGroup: [
    {
      id: "IRON-1",
      name: "IRON NEST 1",
      pos: { x: 52, y: 126 },
      course: 205,
      salvo: [
        { t: 128, count: 2 },
        { t: 306, count: 2 },
        { t: 486, count: 2 },
      ],
    },
    {
      id: "IRON-2",
      name: "IRON NEST 2",
      pos: { x: 66, y: 138 },
      course: 210,
      salvo: [
        { t: 148, count: 1 },
        { t: 326, count: 2 },
        { t: 506, count: 2 },
      ],    },
  ],
  timelines: [
    { t: 6, type: "spawnSurface" },
    { t: 2, type: "message", channel: "HQ", tone: "info", text: "第 7 舰队司令舰：鹰巢编队进入责任区，CV-63 转入战斗航向。情报显示“铁巢”水面编队正在东北方活动。", sticky: true },
    { t: 14, type: "message", channel: "ESM", tone: "warn", text: "被动截获 X 波段搜索雷达，方位 022，信号强度中等——水面编队特征。" },
    { t: 32, type: "spawnNeutralAir" },
    { t: 46, type: "message", channel: "CIC", tone: "info", text: "航管通报：一架民航客机正穿越责任区，禁止无识别开火。" },
    { t: 70, type: "message", channel: "HQ", tone: "warn", text: "“铁巢”编队携反舰导弹，预计 2 分钟内进入发射阵位。建议立即放飞 E-2C 建立远程警戒。" },
    { t: 118, type: "message", channel: "ESM", tone: "alert", text: "ESM 告警：火控雷达持续照射，方位 024——导弹发射征兆。" },
    { t: 150, type: "message", channel: "ESM", tone: "warn", text: "ESM 告警：火控雷达短促照射，方位 026。对方正在建立航迹。" },
    { t: 205, type: "spawnStrike", count: 2, bearing: 64, range: 128 },
    { t: 236, type: "message", channel: "AEW", tone: "warn", text: "远程雷达发现 2 批空中目标，方位 064，距离 120，速度 640，正在接近。" },
    { t: 344, type: "message", channel: "HQ", tone: "info", text: "情报更新：水面编队为两艘导弹驱逐舰，可携带超音速反舰导弹。授权在确认识别后实施打击。" },
    { t: 372, type: "spawnNeutralSurface" },
    { t: 404, type: "message", channel: "CIC", tone: "info", text: "水面接触：方位 214，距离 36，低速小目标，疑似渔船编队。注意识别。" },
    { t: 438, type: "spawnEscort", count: 2, bearing: 42, range: 140 },
    { t: 470, type: "message", channel: "AEW", tone: "alert", text: "警报：2 批战斗机高速接近，方位 042，距离 130，可能为“铁巢”护航机。" },
    { t: 486, type: "message", channel: "AEW", tone: "alert", text: "末批空射平台进入发射距离，方位 300，距离 60 km。左舷武器站准备。" },
    { t: 490, type: "spawnStrike", count: 2, bearing: 300, range: 60 },
    { t: 540, type: "message", channel: "HQ", tone: "warn", text: "鹰巢：再坚持 1 分钟，航空兵支援即将到达。" },
    { t: 590, type: "message", channel: "SYS", tone: "good", text: "责任区外敌情消散，开始战果统计。" },
  ],
};

export const MISSION = {
  cap: { id: "cap", label: "战斗巡逻", short: "CAP", stationRange: 68 },
  aew: { id: "aew", label: "空中预警", short: "AEW", stationRange: 82 },
  ew: { id: "ew", label: "电子战", short: "EW", stationRange: 66 },
  strike: { id: "strike", label: "对海打击", short: "STRIKE", stationRange: 0 },
  sar: { id: "sar", label: "搜救", short: "SAR", stationRange: 0 },
};

export const AIRCRAFT_STATE_LABEL = {
  ready: "待命",
  queued: "待发",
  hangar: "机库",
  elevating: "升降机",
  spotting: "牵引",
  taxi: "滑行",
  hook: "对位",
  stroke: "弹射",
  airborne: "空中",
  inbound: "返航",
  holding: "等待降落",
  approach: "进场",
  trap: "拦阻",
  clear: "脱离",
  taxiIn: "滑回",
  service: "补给",
  awaitingService: "待补给",
  lost: "损失",
  destroyed: "损毁",
};

export const AIRPORT = {
  deckY: SHIP.deckY,
  hangarY: SHIP.hangarY,
  island: { x: ISLAND.x, z: ISLAND.z, width: ISLAND.width, length: ISLAND.length },
  deck: { minX: SHIP.beam / -2 - 20, maxX: SHIP.beam / 2 + 20, bowZ: SHIP.bowZ, sternZ: SHIP.sternZ },
  landing: {
    centerStern: ANGLED_DECK.centerStern,
    centerBow: ANGLED_DECK.centerBow,
    angle: ANGLED_DECK.angle,
    width: ANGLED_DECK.width,
  },
};
