/**
 * CV-63 末端防御武器 / 舷侧武器平台（末代服役配置）
 *
 * 坐标约定：+X 右舷，+Y 向上，-Z 舰艏，单位 m（与 constants.js 一致）。
 *
 * 布置（舷侧外飘平台，平台面与飞行甲板基本齐平）：
 *   海麻雀 1  右舷前  x=+37.5  z=-108   海麻雀 2  左舷后  x=-40.6  z=+64
 *   密集阵 1  右舷后  x=+39.5  z=+140   密集阵 2  左舷前  x=-35.0  z=-128
 *   两座 Mk 91 火控指挥仪分别位于各自海麻雀平台的后端（z+4.3）。
 *
 * 动画节点：ciws:1 / ciws:2（±40° 扫描 + 炮管束自转）
 *           seasparrow:1 / seasparrow:2（±25° 慢速调舷）
 *
 * 每个安装位都建在自建的舷侧平台上，平台内缘嵌进飞行甲板边沿、
 * 外缘由两根斜撑（hullSurfaceX 定位）落到舷侧外板，不会悬空。
 */

import * as THREE from "three";
import { SHIP, deckHalfWidthAt } from "./constants.js";
import { addBox, addCylinder, addRailing, addRoundedBox, cylinderBetween } from "./geometry.js";
import { hullSurfaceX } from "./hull.js";

const TAU = Math.PI * 2;
const DEG = THREE.MathUtils.degToRad;

/** 指定 z 处的飞行甲板外缘 x（带舷别符号） */
function deckEdgeXAt(side, z) {
  return side * deckHalfWidthAt(z);
}

/**
 * 斜撑落点高度：取 y≈9.4 m 的直舷段，
 * 既避开舷侧救生艇舱口（z=±64、y≈10…14.4）与外板开口，又紧邻船壳。
 */
const STRUT_LANDING_Y = 9.4;

/** 平台面比飞行甲板面低 6 cm：既坐在甲板高度，又不与甲板贴图共面闪烁 */
const PLATFORM_TOP = SHIP.deckY - 0.06;
const PLATFORM_T = 0.86;
const PLATFORM_BOTTOM = PLATFORM_TOP - PLATFORM_T;

/**
 * 舷侧安装位。
 * deckEdgeX：该平台纵向范围内最靠内的甲板外缘（取自 DECK_OUTLINE），
 *            平台内缘再向船内嵌入 1.1 m，保证整条内缘都压在甲板结构下面。
 */
const SITES = [
  {
    id: "seasparrow:1",
    kind: "launcher",
    side: 1,
    x: 37.5,
    z: -108,
    deckEdgeX: 30.4,
    length: 11.6,
    phase: 0.0,
  },
  {
    id: "seasparrow:2",
    kind: "launcher",
    side: -1,
    x: -40.6,
    z: 64,
    deckEdgeX: -38.4,
    length: 11.6,
    phase: 2.1,
  },
  {
    id: "ciws:1",
    kind: "ciws",
    side: 1,
    x: 39.5,
    z: 140,
    deckEdgeX: 36.2,
    length: 7.6,
    phase: 0.9,
  },
  {
    id: "ciws:2",
    kind: "ciws",
    side: -1,
    x: -35.0,
    z: -128,
    deckEdgeX: -27.7,
    length: 7.6,
    phase: 3.4,
  },
];

/* ── 舷侧平台 ─────────────────────────────────────────────── */

function buildSponson(parent, M, site) {
  const { side, z } = site;
  const length = site.length;
  const xIn = site.deckEdgeX - side * 1.1; // 嵌入甲板下方
  const xOut = site.x + side * 2.6; // 外缘超出武器中心 2.6 m
  const width = Math.abs(xOut - xIn);
  const cx = (xIn + xOut) / 2;

  const group = new THREE.Group();
  group.name = `SPONSON / ${site.id}`;
  parent.add(group);

  // 平台板
  addBox(group, M.steel, width, PLATFORM_T, length, cx, PLATFORM_TOP - PLATFORM_T / 2, z);

  // 舷缘加厚唇口：把平台与甲板边沿连成整体
  addBox(group, M.steelDark, 2.4, 1.35, length * 0.94, xIn + side * 1.0, PLATFORM_BOTTOM - 0.55, z);

  // 平台下方的横向腹板
  [-0.34, 0, 0.34].forEach((t) => {
    addBox(group, M.steelDark, width * 0.94, 1.45, 0.24, cx, PLATFORM_BOTTOM - 0.72, z + t * length);
  });

  // 纵向纵桁
  [0.18, 0.84].forEach((t) => {
    const gx = xIn + side * width * t;
    addBox(group, M.steelDark, 0.34, 0.78, length * 0.96, gx, PLATFORM_BOTTOM - 0.39, z);
  });

  // 外缘危险色带（与甲板面齐平）
  addBox(group, M.warningStriped, 0.42, 0.06, length - 0.5, xOut - side * 0.32, PLATFORM_TOP + 0.03, z, {
    castShadow: false,
  });

  // 三面栏杆：内缘从甲板外缘起步（平台内缘压在甲板下方，若从内缘起栏会穿过飞行甲板）
  const yRail = PLATFORM_TOP + 0.02;
  const pOut = xOut - side * 0.3;
  const zA = z - length / 2 + 0.24;
  const zB = z + length / 2 - 0.24;
  const edgeA = deckEdgeXAt(side, zA) + side * 0.35;
  const edgeB = deckEdgeXAt(side, zB) + side * 0.35;
  addRailing(
    group,
    [
      [edgeA, yRail, zA],
      [pOut, yRail, zA],
      [pOut, yRail, zB],
      [edgeB, yRail, zB],
    ],
    M.lineRail,
    { height: 1.05, postSpacing: 2.2 },
  );

  // 斜撑：平台外缘 → 舷侧外板（hullSurfaceX 定位，确保落在船壳上而不是悬空）
  [z - length * 0.3, z + length * 0.3].forEach((zs) => {
    const hullX = side * (hullSurfaceX(zs, STRUT_LANDING_Y) + 0.16);
    cylinderBetween(
      group,
      M.steelDark,
      [xOut - side * 0.9, PLATFORM_BOTTOM - 0.9, zs],
      [hullX, STRUT_LANDING_Y, zs],
      0.21,
      { radialSegments: 7 },
    );
    // 二级拉杆：撑杆顶端 → 甲板边沿下缘
    cylinderBetween(
      group,
      M.steelDark,
      [xOut - side * 0.9, PLATFORM_BOTTOM - 0.9, zs],
      [site.deckEdgeX - side * 0.5, 18.35, zs],
      0.14,
      { radialSegments: 6 },
    );
    // 舷侧加强复板
    addBox(group, M.steel, 0.32, 2.2, 2.4, hullX + side * 0.03, 10.1, zs, { castShadow: false });
  });

  return { group, xIn, xOut, topY: PLATFORM_TOP };
}

/* ── Mk 29 海麻雀八联装发射装置 ───────────────────────────── */

function buildLauncher(M, ctx, mount, site) {
  const side = site.side;
  const node = new THREE.Group();
  node.name = `Mk 29 / ${site.id}`;
  mount.add(node);

  // 固定基座
  addCylinder(node, M.steelDark, 1.85, 2.05, 0.5, 0, 0.25, 0, { radialSegments: 20 });
  addCylinder(node, M.steel, 1.28, 1.62, 1.1, 0, 1.05, 0, { radialSegments: 16 });
  addCylinder(node, M.steelDark, 1.52, 1.52, 0.34, 0, 1.77, 0, { radialSegments: 20 });

  // 炮架加强肘板
  [-1, 1].forEach((s) => {
    addBox(node, M.steelDark, 0.3, 1.5, 1.5, s * 1.15, 1.0, 0.75, { rotation: [0.32, 0, 0] });
  });

  // 回转部分（yaw）：0° 时弹箱正面朝舷外
  const yaw = new THREE.Group();
  yaw.name = site.id;
  yaw.position.y = 1.94;
  yaw.rotation.y = -side * Math.PI / 2;
  node.add(yaw);

  addBox(yaw, M.steel, 5.0, 0.34, 1.9, 0, 0.18, 0.25);
  [-1, 1].forEach((s) => {
    addBox(yaw, M.steel, 0.3, 1.05, 1.0, s * 2.42, 1.0, 0.35);
  });

  // 俯仰部分（pitch）：正面（8 联装发射管口）抬向舷外上方
  const pitch = new THREE.Group();
  pitch.position.set(0, 1.42, 0.35);
  pitch.rotation.x = 0.36;
  yaw.add(pitch);

  // 耳轴
  [-1, 1].forEach((s) => {
    addCylinder(pitch, M.steelDark, 0.22, 0.22, 0.62, s * 2.18, 0, 0, {
      rotation: [0, 0, Math.PI / 2],
      radialSegments: 10,
    });
  });

  // 弹箱本体（4 × 2 共 8 个发射管，正面为 -Z）
  addRoundedBox(pitch, M.steel, 4.3, 2.2, 3.5, 0, 0, 0, { radius: 0.16, segments: 2 });

  const lids = [];
  const cellX = [-1.575, -0.525, 0.525, 1.575];
  const cellY = [-0.53, 0.53];
  cellY.forEach((cy) => {
    cellX.forEach((cxx) => {
      // 发射管盖
      const lid = addRoundedBox(pitch, M.steelDark, 0.92, 0.88, 0.12, cxx, cy, -1.78, {
        radius: 0.05,
        segments: 2,
      });
      lids.push(lid);
      // 管口
      addBox(pitch, M.black, 0.68, 0.64, 0.05, cxx, cy, -1.856, { castShadow: false, receiveShadow: false });
      // 铰链
      addCylinder(pitch, M.steel, 0.05, 0.05, 0.54, cxx, cy + 0.46, -1.72, {
        rotation: [0, 0, Math.PI / 2],
        radialSegments: 6,
        castShadow: false,
      });
      // 闭锁手柄
      addBox(pitch, M.warning, 0.1, 0.16, 0.1, cxx + 0.36, cy - 0.34, -1.86, { castShadow: false });
    });
  });

  // 箱体细节：侧面加强筋、后部检修门、尾部警示带、顶部导流板
  [-1, 1].forEach((s) => {
    addBox(pitch, M.steelDark, 0.12, 2.0, 3.4, s * 2.16, 0, 0);
  });
  addBox(pitch, M.steelDark, 1.5, 1.3, 0.1, 0.9, -0.15, 1.78);
  addBox(pitch, M.warning, 3.9, 0.26, 0.08, 0, 0, 1.785, { castShadow: false });
  addBox(pitch, M.steelDark, 4.0, 0.16, 1.0, 0, 1.16, 1.15, { rotation: [0.5, 0, 0] });

  ctx.anim.node(site.id, yaw);

  return {
    id: site.id,
    side,
    x: site.x,
    z: site.z,
    group: node,
    yaw,
    pitch,
    lids,
    baseYaw: -side * Math.PI / 2,
    pitchBase: 0.36,
    phase: site.phase,
  };
}

/* ── Mk 15 密集阵近防炮 ───────────────────────────────────── */

function buildCIWS(M, ctx, mount, site) {
  const side = site.side;
  const node = new THREE.Group();
  node.name = `Mk 15 Phalanx / ${site.id}`;
  mount.add(node);

  // 基座
  addCylinder(node, M.steelDark, 1.05, 1.4, 0.42, 0, 0.21, 0, { radialSegments: 18 });
  addCylinder(node, M.steel, 0.6, 0.8, 1.05, 0, 0.945, 0, { radialSegments: 14 });
  addCylinder(node, M.steelDark, 0.92, 0.92, 0.22, 0, 1.55, 0, { radialSegments: 16 });

  // 回转部分
  const yaw = new THREE.Group();
  yaw.name = site.id;
  yaw.position.y = 1.66;
  yaw.rotation.y = -side * Math.PI / 2;
  node.add(yaw);

  // 弹药箱 / 炮塔壳体
  addRoundedBox(yaw, M.white, 2.15, 1.55, 2.0, 0, 0.5, 0.05, { radius: 0.3, segments: 3 });
  addBox(yaw, M.steelDark, 0.9, 0.9, 1.3, 0, 0.15, 1.05);
  addBox(yaw, M.warningStriped, 2.05, 0.16, 1.9, 0, -0.32, 0.05, { castShadow: false });

  // 雷达罩
  addCylinder(yaw, M.white, 0.86, 0.98, 0.42, 0, 1.42, 0.08, { radialSegments: 18 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.12, 20, 14), M.white);
  dome.position.set(0, 2.35, 0.08);
  dome.scale.set(1, 0.82, 1);
  dome.castShadow = true;
  yaw.add(dome);

  // 俯仰炮架
  const cradle = new THREE.Group();
  cradle.position.set(0, 1.02, -0.62);
  cradle.rotation.x = 0.1;
  yaw.add(cradle);

  addRoundedBox(cradle, M.white, 1.0, 0.95, 1.2, 0, 0, 0.2, { radius: 0.2, segments: 2 });
  [-1, 1].forEach((s) => {
    addCylinder(cradle, M.steelDark, 0.2, 0.2, 0.36, s * 0.58, 0.02, 0, {
      rotation: [0, 0, Math.PI / 2],
      radialSegments: 10,
    });
  });

  // 六管加特林：绕自身 Z 轴旋转的炮管束
  const drum = new THREE.Group();
  drum.position.set(0, -0.02, -0.52);
  cradle.add(drum);

  addCylinder(drum, M.steelDark, 0.34, 0.34, 0.44, 0, 0, 0.1, {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 16,
  });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * TAU;
    const bx = Math.cos(angle) * 0.2;
    const by = Math.sin(angle) * 0.2;
    addCylinder(drum, M.steelDark, 0.055, 0.062, 2.1, bx, by, -1.2, {
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: 6,
    });
  }
  addCylinder(drum, M.steel, 0.3, 0.3, 0.16, 0, 0, -2.2, {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 14,
  });
  addCylinder(drum, M.steelDark, 0.26, 0.3, 0.14, 0, 0, -0.9, {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 12,
  });

  ctx.anim.node(site.id, yaw);

  return {
    id: site.id,
    side,
    x: site.x,
    z: site.z,
    group: node,
    yaw,
    cradle,
    drum,
    dome,
    baseYaw: -side * Math.PI / 2,
    cradleBase: 0.1,
    spin: 2.6,
    phase: site.phase,
  };
}

/* ── Mk 91 导弹火控指挥仪 ─────────────────────────────────── */

function dishGeometry(radius) {
  const profile = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) {
    const r = (i / steps) * radius;
    profile.push(new THREE.Vector2(r, (r * r) / (2.4 * radius)));
  }
  return new THREE.LatheGeometry(profile, 26);
}

/** 抛物面口径处的轴向深度（与 dishGeometry 的母线一致） */
function dishDepth(radius) {
  return radius / 2.4;
}

function buildDirector(M, ctx, mount, site) {
  const side = site.side;
  const node = new THREE.Group();
  node.name = `Mk 91 / ${site.id}`;
  mount.add(node);

  addCylinder(node, M.steelDark, 0.88, 1.05, 0.3, 0, 0.15, 0, { radialSegments: 16 });
  addCylinder(node, M.steel, 0.55, 0.74, 2.1, 0, 1.35, 0, { radialSegments: 14 });
  addCylinder(node, M.steelDark, 0.66, 0.66, 0.24, 0, 2.46, 0, { radialSegments: 14 });

  const head = new THREE.Group();
  head.position.y = 2.62;
  head.rotation.y = -side * Math.PI / 2;
  node.add(head);

  // 指挥仪壳体
  addRoundedBox(head, M.white, 0.95, 0.8, 1.15, 0, 0.42, 0.22, { radius: 0.16, segments: 2 });
  addBox(head, M.steelDark, 0.8, 0.6, 0.7, 0, 0.32, 1.0);
  addRoundedBox(head, M.steelDark, 0.5, 0.24, 0.5, 0, 0.86, 0.1, { radius: 0.08 });

  // 抛物面天线（母线沿 +Y 展开，旋转后开口朝 -Z = 舷外；f = 0.6 m）
  const radius = 1.0;
  const depth = dishDepth(radius);
  const dishGroup = new THREE.Group();
  dishGroup.position.set(0, 0.5, -0.3);
  dishGroup.rotation.x = -Math.PI / 2;
  head.add(dishGroup);

  const dish = new THREE.Mesh(dishGeometry(radius), M.radarFace);
  dish.castShadow = true;
  dishGroup.add(dish);

  // 口径环
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 6, 26), M.steel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = depth;
  dishGroup.add(rim);

  // 馈源 + 三脚架（焦点在母线上 y = 0.6）
  addCylinder(dishGroup, M.steelDark, 0.1, 0.13, 0.4, 0, 0.56, 0, { radialSegments: 8 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    cylinderBetween(
      dishGroup,
      M.steel,
      [Math.cos(a) * 0.94, depth + 0.01, Math.sin(a) * 0.94],
      [Math.cos(a) * 0.14, 0.56, Math.sin(a) * 0.14],
      0.03,
      { radialSegments: 5, castShadow: false },
    );
  }

  return {
    id: `mk91:${site.id.split(":")[1]}`,
    side,
    x: site.x - side * 0.7,
    z: site.z + 4.3,
    group: node,
    head,
    dish,
    baseYaw: -side * Math.PI / 2,
    phase: site.phase + 1.2,
  };
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function buildWeapons(parent, ctx) {
  const M = ctx.materials;
  const group = new THREE.Group();
  group.name = "WEAPONS / point defence";
  parent.add(group);

  const ciws = [];
  const launchers = [];
  const directors = [];

  SITES.forEach((site) => {
    const sponson = buildSponson(group, M, site);

    const mount = new THREE.Group();
    mount.name = `MOUNT / ${site.id}`;
    mount.position.set(site.x, PLATFORM_TOP, site.z);
    sponson.group.add(mount);

    if (site.kind === "ciws") {
      ciws.push(buildCIWS(M, ctx, mount, site));
      return;
    }

    launchers.push(buildLauncher(M, ctx, mount, site));

    const directorMount = new THREE.Group();
    directorMount.position.set(site.x - site.side * 0.7, PLATFORM_TOP, site.z + 4.3);
    sponson.group.add(directorMount);
    directors.push(buildDirector(M, ctx, directorMount, site));
  });

  // 密集阵：±40° 扫描 + 炮管束自转
  ctx.anim.addUpdate((dt, elapsed) => {
    ciws.forEach((unit) => {
      unit.yaw.rotation.y = unit.baseYaw + Math.sin(elapsed * 0.22 + unit.phase) * DEG(40);
      unit.cradle.rotation.x = unit.cradleBase + Math.sin(elapsed * 0.11 + unit.phase) * 0.05;
      unit.drum.rotation.z += unit.spin * dt;
    });
  });

  // 海麻雀：±25° 慢速调舷，俯仰小幅跟随
  ctx.anim.addUpdate((dt, elapsed) => {
    launchers.forEach((unit) => {
      unit.yaw.rotation.y = unit.baseYaw + Math.sin(elapsed * 0.085 + unit.phase) * DEG(25);
      unit.pitch.rotation.x = unit.pitchBase + Math.sin(elapsed * 0.06 + unit.phase) * 0.035;
    });
  });

  // 火控指挥仪：独立扇扫
  ctx.anim.addUpdate((dt, elapsed) => {
    directors.forEach((unit) => {
      unit.head.rotation.y = unit.baseYaw + Math.sin(elapsed * 0.17 + unit.phase) * 0.85;
    });
  });

  return { ciws, launchers, directors };
}
