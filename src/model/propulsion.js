/**
 * CV-63 常规蒸汽动力装置（8 台 Foster-Wheeler 锅炉 + 4 台西屋蒸汽轮机）
 * 说明：蓝图资料常把 CV-63 标成核动力，本模型按实际服役状态建为常规蒸汽动力。
 *
 * 坐标约定：+X 右舷，+Y 向上，-Z 舰艏，单位 m。
 * 机械区布置在 y≈-8…+8、z≈-70…+70 的船体内部；轴系沿 +Z 出尾至 z≈150。
 *
 * 动画节点：prop:1 … prop:4（绕 Z 轴即轴系轴线自转）
 */

import * as THREE from "three";
import { MACHINERY } from "./constants.js";
import { hullKeelYAt } from "./hull.js";
import { addBox, addCylinder, addRailing, addRoundedBox, cylinderBetween } from "./geometry.js";

const FLOOR_Y = -7.9; // 机械区花钢板
const FLOOR_TOP = FLOOR_Y + 0.13;
const MACH_TOP_Y = 7.4; // 机械区顶（机库甲板结构下缘）

/** 船底型值直接取自 hull.js 的龙骨曲面（不再复制手写站线） */
const keelYAt = hullKeelYAt;

/* ── 螺旋桨 ───────────────────────────────────────────────── */

/** 五叶螺旋桨，桨轴沿 Z，返回可直接旋转的 group */
function createPropeller(M, radius) {
  const group = new THREE.Group();

  // 桨毂
  addCylinder(group, M.bronze, 0.74, 0.9, 1.9, 0, 0, 0, { rotation: [Math.PI / 2, 0, 0], radialSegments: 18 });

  // 整流罩（朝舰艉）
  const fairwater = new THREE.Mesh(new THREE.ConeGeometry(0.74, 1.5, 18), M.bronze);
  fairwater.rotation.x = Math.PI / 2;
  fairwater.position.z = 1.6;
  fairwater.castShadow = true;
  group.add(fairwater);

  // 桨叶叶型（x = 径向，y = 弦向）
  const shape = new THREE.Shape();
  const r = radius;
  shape.moveTo(0.26 * r, -0.24 * r);
  shape.bezierCurveTo(0.58 * r, -0.27 * r, 0.84 * r, -0.16 * r, r, -0.02 * r);
  shape.bezierCurveTo(0.86 * r, 0.1 * r, 0.6 * r, 0.2 * r, 0.3 * r, 0.15 * r);
  shape.lineTo(0.17 * r, 0);
  shape.closePath();

  const bladeGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSize: 0.035,
    bevelThickness: 0.035,
    bevelSegments: 1,
    steps: 1,
  });
  bladeGeometry.translate(0, 0, -0.1);

  for (let i = 0; i < 5; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 5) * Math.PI * 2;
    const blade = new THREE.Mesh(bladeGeometry, M.bronze);
    blade.rotation.x = 0.55; // 螺距角
    blade.castShadow = true;
    pivot.add(blade);
    group.add(pivot);
  }

  return group;
}

/* ── 锅炉 ─────────────────────────────────────────────────── */

function buildBoiler(M, parent, x, z, tag) {
  const boiler = new THREE.Group();
  boiler.name = `BOILER / ${tag}`;
  boiler.position.set(x, 0, z);
  parent.add(boiler);

  // 基座
  addBox(boiler, M.steelDark, 5.6, 0.5, 6.8, 0, -7.5, 0, { castShadow: false });

  // D 型锅炉外壳
  addRoundedBox(boiler, M.steelDark, 5.2, 8.9, 6.4, 0, -2.85, 0, { radius: 0.45, segments: 3 });

  // 加强环带
  [-5.6, -3.2, -0.8].forEach((by) => {
    addBox(boiler, M.steel, 5.32, 0.22, 6.52, 0, by, 0);
  });

  // 炉前（朝 +Z）：炉门 + 观察孔
  addBox(boiler, M.steel, 4.9, 4.6, 0.22, 0, -4.9, 3.28);
  [-1.25, 1.25].forEach((sx) => {
    addBox(boiler, M.steelDark, 2.15, 2.45, 0.1, sx, -4.75, 3.34);
    addRoundedBox(boiler, M.black, 1.95, 2.25, 0.16, sx, -4.75, 3.42, { radius: 0.08, segments: 2 });
    addCylinder(boiler, M.warning, 0.17, 0.17, 0.12, sx + 0.62, -4.75, 3.56, {
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: 10,
      castShadow: false,
    });
    addBox(boiler, M.steel, 0.12, 0.9, 0.12, sx - 0.86, -4.75, 3.52, { castShadow: false });
  });

  [-1.3, 1.3].forEach((sx) => {
    addCylinder(boiler, M.steel, 0.17, 0.17, 0.3, sx, -2.2, 3.36, {
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: 8,
      castShadow: false,
    });
    addCylinder(boiler, M.black, 0.11, 0.11, 0.07, sx, -2.2, 3.52, {
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: 8,
      castShadow: false,
    });
  });

  // 汽包
  addCylinder(boiler, M.steel, 1.15, 1.15, 4.8, 0, 2.35, 0, { rotation: [Math.PI / 2, 0, 0], radialSegments: 16 });
  [-1, 1].forEach((s) => {
    addCylinder(boiler, M.steelDark, 1.05, 1.15, 0.18, 0, 2.35, s * 2.4, {
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: 16,
    });
  });
  [-1.2, 0.6].forEach((sz) => {
    addCylinder(boiler, M.steelDark, 0.16, 0.2, 0.55, 0, 3.25, sz, { radialSegments: 8 });
  });

  // 上升烟道
  addBox(boiler, M.steelDark, 3.2, 2.6, 3.0, 0, 4.6, 0.2);
  addBox(boiler, M.black, 3.0, 0.16, 2.8, 0, 5.92, 0.2, { castShadow: false });

  // 侧向检修爬梯
  [-1, 1].forEach((s) => {
    addBox(boiler, M.steel, 0.06, 6.6, 0.06, 2.72, -4.3, s * 1.8, { castShadow: false });
  });
  for (let i = 0; i < 6; i++) {
    addBox(boiler, M.steel, 0.06, 0.05, 3.6, 2.72, -6.9 + i * 1.15, 0, { castShadow: false });
  }

  return boiler;
}

/* ── 蒸汽轮机 ─────────────────────────────────────────────── */

function buildTurbine(M, parent, x, z, tag) {
  const g = new THREE.Group();
  g.name = `TURBINE / ${tag}`;
  g.position.set(x, -2.5, z);
  parent.add(g);

  // 基座
  addBox(g, M.steelDark, 3.6, 2.4, 6.0, 0, -4.2, 0, { castShadow: false });
  addBox(g, M.steelDark, 4.6, 3.0, 8.4, 0, -1.5, 0);

  // 汽缸
  addCylinder(g, M.steelDark, 2.0, 2.55, 8.6, 0, 0, 0, { rotation: [Math.PI / 2, 0, 0], radialSegments: 18 });

  [-3.2, -1.4, 0.4, 2.2, 3.8].forEach((cz) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.1, 6, 20), M.steel);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0, cz);
    g.add(band);
  });

  // 排汽口
  addRoundedBox(g, M.steelDark, 3.0, 2.2, 2.6, 0, 0.7, 5.0, { radius: 0.2, segments: 2 });
  // 进汽口
  addCylinder(g, M.steel, 0.62, 0.62, 1.6, 0, 2.0, -1.6, {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 10,
  });
  // 前轴承座
  addBox(g, M.steel, 1.6, 1.0, 1.2, 0, 0, -5.2);

  return g;
}

/* ── 减速齿轮箱 ───────────────────────────────────────────── */

function buildGearbox(M, parent, x, z, tag) {
  const g = new THREE.Group();
  g.name = `REDUCTION GEAR / ${tag}`;
  g.position.set(x, -5.6, z);
  parent.add(g);

  addRoundedBox(g, M.steelDark, 5.0, 4.4, 5.4, 0, 0, 0, { radius: 0.3, segments: 2 });
  addBox(g, M.steel, 5.24, 0.3, 5.64, 0, 1.9, 0);
  addBox(g, M.steel, 5.24, 0.24, 5.64, 0, -2.0, 0);
  // 盘车机构与输出联轴节
  addCylinder(g, M.steel, 0.72, 0.72, 0.6, 0, -0.8, 2.95, {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 12,
  });
  addCylinder(g, M.warning, 0.34, 0.34, 0.16, 1.9, 1.4, 1.5, {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 10,
    castShadow: false,
  });

  return g;
}

/* ── 轴系 / 轴支架 / 螺旋桨 ───────────────────────────────── */

function buildShafting(M, parent, ctx, props) {
  MACHINERY.shafts.forEach((shaft, index) => {
    const { x, y, from, to } = shaft;
    const radius = Math.abs(x) > 10 ? 2.8 : 2.6;

    // 主轴
    cylinderBetween(parent, M.steel, [x, y, from], [x, y, to], 0.42, { radialSegments: 12 });
    // 尾轴套
    cylinderBetween(parent, M.steelDark, [x, y, to - 7.5], [x, y, to - 0.8], 0.62, { radialSegments: 12 });

    // 轴线轴承座
    [from + 12, from + 28, from + 44].forEach((bz) => {
      if (bz > to - 9) return;
      addCylinder(parent, M.steel, 0.62, 0.62, 0.7, x, y, bz, {
        rotation: [Math.PI / 2, 0, 0],
        radialSegments: 10,
      });
      addBox(parent, M.steelDark, 1.3, y - FLOOR_Y, 1.3, x, (y + FLOOR_Y) / 2, bz);
    });

    // 艉轴支架（A 型架）：落到船底
    [to - 11, to - 25].forEach((bz) => {
      const bottom = keelYAt(bz) + 0.2;
      addBox(parent, M.steelDark, 0.9, Math.max(0.8, y - bottom), 0.5, x, (y + bottom) / 2, bz);
      [-1, 1].forEach((s) => {
        cylinderBetween(
          parent,
          M.steelDark,
          [x + s * 1.7, bottom + 0.1, bz],
          [x, y - 0.15, bz],
          0.17,
          { radialSegments: 6 },
        );
      });
      addCylinder(parent, M.steel, 0.72, 0.72, 1.5, x, y, bz, {
        rotation: [Math.PI / 2, 0, 0],
        radialSegments: 12,
      });
    });

    // 螺旋桨
    const propeller = createPropeller(M, radius);
    propeller.name = `PROP / ${index + 1}`;
    propeller.position.set(x, y, to);
    parent.add(propeller);

    const nodeName = `prop:${index + 1}`;
    ctx.anim.node(nodeName, propeller);

    const dir = x < 0 ? 1 : -1;
    props.push({
      id: nodeName,
      node: propeller,
      shaft: index,
      x,
      y,
      z: to,
      radius,
      rate: dir * (Math.abs(x) > 10 ? 1.05 : 1.15),
    });
  });
}

/* ── 舵 ───────────────────────────────────────────────────── */

function buildRudder(M, parent, x, z, tag) {
  const g = new THREE.Group();
  g.name = `RUDDER / ${tag}`;
  g.position.set(x, 0, z);
  parent.add(g);

  // 舵叶（前缘在 z 负方向）
  addBox(g, M.steelDark, 0.66, 7.4, 6.2, 0, -6.0, 0.4);
  addBox(g, M.steelDark, 0.72, 0.28, 5.6, 0, -6.5, 0.5);
  addBox(g, M.steelDark, 0.72, 0.28, 5.6, 0, -3.6, 0.5);

  // 舵杆与舵头
  addCylinder(g, M.steel, 0.42, 0.42, 4.6, 0, -2.0, -2.4, { radialSegments: 10 });
  addBox(g, M.steel, 1.25, 2.2, 1.6, 0, -1.3, -2.4);

  // 舵销座
  [-4.4, -8.4].forEach((ry) => {
    addBox(g, M.steel, 0.82, 1.0, 0.9, 0, ry, -2.3);
  });

  return g;
}

/* ── 机械区舱室结构 ───────────────────────────────────────── */

function buildMachinerySpaces(M, parent) {
  const spaces = new THREE.Group();
  spaces.name = "MACHINERY SPACES";
  parent.add(spaces);

  // 花钢板
  for (let i = 0; i < 6; i++) {
    const z0 = -68 + i * 22.4;
    addBox(spaces, M.steelDark, 29.4, 0.26, 21.6, 0, FLOOR_Y, z0 + 11.0, { castShadow: false });
  }
  [-1, 1].forEach((s) => {
    addBox(spaces, M.warning, 0.16, 0.05, 132, s * 14.5, FLOOR_TOP + 0.02, 0, { castShadow: false });
  });

  // 横舱壁 + 出入口（避开 z=34 / 54 的汽轮机与 z=66 / 52 的减速箱）
  [-70, -30, 4, 24, 44, 62].forEach((bz) => {
    addBox(spaces, M.steelDark, 31.0, MACH_TOP_Y - FLOOR_Y + 0.2, 0.28, 0, (MACH_TOP_Y + FLOOR_Y) / 2, bz);
    addBox(spaces, M.warning, 30.4, 0.22, 0.34, 0, FLOOR_TOP + 0.28, bz, { castShadow: false });
    [-4.2, 4.2].forEach((bx) => {
      addBox(spaces, M.steel, 1.6, 2.3, 0.42, bx, FLOOR_TOP + 1.15, bz);
      addBox(spaces, M.black, 1.24, 1.95, 0.06, bx, FLOOR_TOP + 1.1, bz + 0.25, { castShadow: false });
    });
  });

  // 纵舱壁
  [-1, 1].forEach((s) => {
    addBox(spaces, M.steelDark, 0.28, MACH_TOP_Y - FLOOR_Y + 0.2, 138, s * 15.6, (MACH_TOP_Y + FLOOR_Y) / 2, -1);
  });

  // 舷侧走道 + 栏杆
  [-1, 1].forEach((s) => {
    addBox(spaces, M.steelDark, 1.7, 0.16, 136, s * 12.2, -2.9, -1, { castShadow: false });
    addRailing(
      spaces,
      [
        [s * 11.35, -2.82, -68],
        [s * 11.35, -2.82, 66],
      ],
      M.lineRail,
      { height: 1.0, postSpacing: 3.2 },
    );
    // 通向花钢板的斜梯
    [22, 56].forEach((sz) => {
      addBox(spaces, M.steel, 1.3, 0.12, 5.2, s * 12.2, -5.3, sz, { rotation: [0.42, 0, 0] });
    });
  });

  // 机舱行车轨道
  [-1, 1].forEach((s) => {
    addBox(spaces, M.steel, 0.3, 0.4, 136, s * 6.6, 6.9, -1, { castShadow: false });
  });

  return spaces;
}

/* ── 蒸汽管路 ─────────────────────────────────────────────── */

function buildSteamPipes(M, parent) {
  const pipes = new THREE.Group();
  pipes.name = "STEAM PIPING";
  parent.add(pipes);

  // 主蒸汽管（每舷一条，沿锅炉上方纵向布置）
  [-8.5, 8.5].forEach((hx) => {
    cylinderBetween(pipes, M.steel, [hx, 5.4, -58], [hx, 5.4, 44], 0.34, { radialSegments: 9 });
    [0, 1].forEach((k) => {
      addCylinder(pipes, M.steelDark, 0.42, 0.42, 0.5, hx, 5.4, -40 + k * 44, {
        rotation: [Math.PI / 2, 0, 0],
        radialSegments: 10,
        castShadow: false,
      });
    });
  });

  // 锅炉 → 主蒸汽管 上升管
  MACHINERY.boilers.forEach(([bx, bz]) => {
    cylinderBetween(pipes, M.steel, [bx, 3.0, bz - 2.0], [bx, 5.4, bz - 2.0], 0.2, { radialSegments: 8 });
    addCylinder(pipes, M.warning, 0.3, 0.3, 0.16, bx, 4.9, bz - 2.0, {
      radialSegments: 10,
      castShadow: false,
    });
  });

  // 主蒸汽管 → 各汽轮机 进汽支管
  MACHINERY.turbines.forEach(([tx, tz]) => {
    const hx = tx < 0 ? -8.5 : 8.5;
    const hz = tz - 1.6;
    cylinderBetween(pipes, M.steel, [hx, 5.4, hz], [tx, 5.4, hz], 0.26, { radialSegments: 8 });
    cylinderBetween(pipes, M.steel, [tx, 5.4, hz], [tx, -0.3, hz], 0.26, { radialSegments: 8 });
    // 排汽上升管（接舰岛烟道）
    cylinderBetween(pipes, M.steelDark, [tx, -0.7, tz + 5.0], [tx, 6.8, tz + 5.0], 0.85, { radialSegments: 10 });
    addRoundedBox(pipes, M.steelDark, 2.4, 2.0, 3.0, tx, 5.9, tz + 5.0, { radius: 0.3, segments: 2 });
  });

  // 辅机：给水泵、凝汽器
  [-1, 1].forEach((s) => {
    addCylinder(pipes, M.steelDark, 0.9, 0.9, 2.2, s * 4.6, -5.6, 40, { radialSegments: 12 });
    addCylinder(pipes, M.steel, 1.4, 1.4, 4.2, s * 11.6, -6.2, 26, {
      rotation: [0, 0, Math.PI / 2],
      radialSegments: 14,
    });
  });

  return pipes;
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function buildPropulsion(parent, ctx) {
  const M = ctx.materials;

  const plant = new THREE.Group();
  plant.name = "PROPULSION / steam plant";
  parent.add(plant);

  const props = [];
  const boilers = [];
  const turbines = [];

  MACHINERY.boilers.forEach(([bx, bz], index) => {
    boilers.push(buildBoiler(M, plant, bx, bz, index + 1));
  });

  MACHINERY.turbines.forEach(([tx, tz], index) => {
    turbines.push(buildTurbine(M, plant, tx, tz, index + 1));
  });

  // 减速齿轮箱：内侧两台接内侧轴（z=66），外侧两台接外侧轴（z=52）
  MACHINERY.shafts.forEach((shaft, index) => {
    const inner = Math.abs(shaft.x) < 10;
    const gz = shaft.from;
    const gx = shaft.x;
    buildGearbox(M, plant, gx, gz, index + 1);

    // 汽轮机 → 齿轮箱 输入轴
    const driveZ = inner ? 54 : 34;
    cylinderBetween(
      plant,
      M.steel,
      [gx < 0 ? -6.5 : 6.5, -2.4, driveZ + 4.3],
      [gx, -5.2, gz - 2.6],
      0.36,
      { radialSegments: 10 },
    );
  });

  buildShafting(M, plant, ctx, props);

  MACHINERY.rudders.forEach(([rx, rz], index) => {
    buildRudder(M, plant, rx, rz, index + 1);
  });

  buildMachinerySpaces(M, plant);
  buildSteamPipes(M, plant);

  // 螺旋桨自转（绕 Z 轴 = 轴系轴线）
  ctx.anim.addUpdate((dt) => {
    props.forEach((propeller) => {
      propeller.node.rotation.z += propeller.rate * dt;
    });
  });

  return { props, boilers, turbines };
}
