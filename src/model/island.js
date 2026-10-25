import * as THREE from "three";
import { COLORS, ISLAND, SHIP } from "./constants.js";
import {
  addBox,
  addCylinder,
  addLineSegments,
  addRailing,
  addRoundedBox,
  cylinderBetween,
} from "./geometry.js";

const Y0 = SHIP.deckY;

/* ── 小工具 ───────────────────────────────────────────────── */

function windowPanel(parent, M, { x, y, z, width, height, columns = 8, facing = "front", emissive = false }) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const glassMat = emissive ? M.glassLit : M.glass;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.22), glassMat);
  group.add(panel);
  const mullionMat = M.islandDark;
  const step = width / columns;
  for (let i = -columns / 2; i <= columns / 2; i++) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.16, height + 0.12, 0.3), mullionMat);
    mullion.position.set(i * step, 0, 0.06);
    group.add(mullion);
  }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.18, 0.5), mullionMat);
  sill.position.y = -height / 2 - 0.1;
  group.add(sill);
  if (facing === "right") group.rotation.y = Math.PI / 2;
  if (facing === "left") group.rotation.y = -Math.PI / 2;
  if (facing === "back") group.rotation.y = Math.PI;
  parent.add(group);
  return group;
}

function railingLoop(parent, M, x0, z0, x1, z1, y, height = 1.05) {
  const points = [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
    [x0, y, z0],
  ];
  addRailing(parent, points, M.lineRail, { height, postSpacing: 2.6 });
}

function platformDeck(parent, M, x0, z0, x1, z1, y, thickness = 0.24, material = M.islandDark) {
  const width = Math.abs(x1 - x0);
  const depth = Math.abs(z1 - z0);
  return addBox(
    parent,
    material,
    width,
    thickness,
    depth,
    (x0 + x1) / 2,
    y,
    (z0 + z1) / 2,
    { castShadow: true },
  );
}

function ladder(parent, M, x, z, y0, y1, side = 1) {
  const points = [];
  const height = y1 - y0;
  const rungs = Math.round(height / 0.32);
  for (let i = 0; i <= rungs; i++) {
    const y = y0 + (i / rungs) * height;
    points.push(new THREE.Vector3(x - 0.24, y, z), new THREE.Vector3(x + 0.24, y, z));
  }
  points.push(new THREE.Vector3(x - 0.24, y0, z), new THREE.Vector3(x - 0.24, y1, z));
  points.push(new THREE.Vector3(x + 0.24, y0, z), new THREE.Vector3(x + 0.24, y1, z));
  void side;
  addLineSegments(parent, points, M.lineRail);
}

function radarReflector(width, height, radius = 9) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 24, 1, true, -0.3, 0.6);
  geometry.rotateX(Math.PI / 2);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

/* ── 主构建 ───────────────────────────────────────────────── */

export function buildIsland(parent, ctx) {
  const M = ctx.materials;
  const IX = ISLAND.x;
  const IZ = ISLAND.z;
  const island = new THREE.Group();
  island.name = "ISLAND / superstructure";
  parent.add(island);

  /* 基座平台 */
  addRoundedBox(island, M.island, 15.2, 0.9, 40, IX, Y0 + 0.45, IZ, { radius: 0.28 });
  addBox(island, M.islandDark, 15.4, 0.35, 40.4, IX, Y0 + 0.15, IZ, { castShadow: false });

  /* 一层：舰岛主体 */
  addRoundedBox(island, M.island, 13.4, 5.8, 37, IX, Y0 + 3.8, IZ, { radius: 0.24 });
  // 内舷侧（面向甲板）的门与凹陷
  for (let i = 0; i < 5; i++) {
    const z = IZ - 13 + i * 6.5;
    addBox(island, M.black, 0.3, 2.6, 1.8, IX - 6.75, Y0 + 2.1, z, { castShadow: false });
  }
  // 舱壁横向分割线
  for (let i = 0; i < 6; i++) {
    const z = IZ - 16 + i * 6.4;
    addBox(island, M.islandDark, 13.55, 0.16, 0.14, IX, Y0 + 4.4, z, { castShadow: false });
  }
  // 一层长窗带
  windowPanel(island, M, {
    x: IX,
    y: Y0 + 5.6,
    z: IZ - 18.55,
    width: 11.4,
    height: 1.1,
    columns: 10,
    emissive: true,
  });
  windowPanel(island, M, {
    x: IX - 6.75,
    y: Y0 + 5.6,
    z: IZ - 6,
    width: 9.5,
    height: 1.05,
    columns: 8,
    facing: "left",
    emissive: true,
  });
  // 右舷侧长窗带、舷窗与板缝（面向甲板外侧）
  windowPanel(island, M, {
    x: IX + 6.75,
    y: Y0 + 5.55,
    z: IZ + 1,
    width: 22,
    height: 1.0,
    columns: 14,
    facing: "right",
    emissive: true,
  });
  for (let i = 0; i < 18; i++) {
    const z = IZ - 16 + i * 1.9;
    addCylinder(island, M.glassDark, 0.19, 0.19, 0.16, IX + 6.76, Y0 + 3.2, z, {
      rotation: [0, 0, Math.PI / 2],
      radialSegments: 8,
      castShadow: false,
    });
  }
  for (let i = 0; i < 6; i++) {
    const z = IZ - 16 + i * 6.4;
    addBox(island, M.islandDark, 0.12, 5.4, 0.16, IX + 6.76, Y0 + 3.9, z, { castShadow: false });
  }
  // 舱门与舷梯
  for (let i = 0; i < 4; i++) {
    const z = IZ - 12 + i * 8;
    addBox(island, M.islandDark, 0.2, 2.2, 1.3, IX + 6.78, Y0 + 1.4, z, { castShadow: false });
    addBox(island, M.steelDark, 0.3, 0.16, 1.5, IX + 6.82, Y0 + 2.55, z, { castShadow: false });
  }
  // 舰岛右舷救生筏
  for (let i = 0; i < 3; i++) {
    const z = IZ + 4 + i * 3.6;
    addCylinder(island, M.white, 0.5, 0.5, 2.0, IX + 6.9, Y0 + 4.2, z, {
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: 12,
      castShadow: false,
    });
  }

  /* 二层：航海舰桥层 */
  const bridgeY = Y0 + 9.4;
  addRoundedBox(island, M.island, 12.6, 3.2, 33, IX, bridgeY, IZ + 1, { radius: 0.22 });
  // 航海舰桥（前部外伸）
  const navBridgeZ = IZ - 6.5;
  addRoundedBox(island, M.island, 14.8, 3.6, 17.5, IX, bridgeY + 3.2, navBridgeZ, { radius: 0.24 });
  // 舰桥窗带（前 / 左右）
  windowPanel(island, M, {
    x: IX,
    y: bridgeY + 3.7,
    z: navBridgeZ - 8.9,
    width: 12.6,
    height: 1.35,
    columns: 12,
  });
  windowPanel(island, M, {
    x: IX - 7.5,
    y: bridgeY + 3.7,
    z: navBridgeZ,
    width: 15.6,
    height: 1.2,
    columns: 10,
    facing: "left",
  });
  windowPanel(island, M, {
    x: IX + 7.5,
    y: bridgeY + 3.7,
    z: navBridgeZ,
    width: 15.6,
    height: 1.2,
    columns: 10,
    facing: "right",
  });
  // 舰桥顶板 + 栏杆
  const bridgeTop = bridgeY + 5.15;
  platformDeck(island, M, IX - 7.6, navBridgeZ - 9.2, IX + 7.6, navBridgeZ + 9.2, bridgeTop, 0.3);
  railingLoop(island, M, IX - 7.6, navBridgeZ - 9.2, IX + 7.6, navBridgeZ + 9.2, bridgeTop + 0.15);

  /* 三层：飞行指挥塔 Pri-Fly */
  const priY = bridgeTop + 2.4;
  const priZ = IZ + 6.5;
  addRoundedBox(island, M.island, 11.2, 3.4, 12.5, IX, priY, priZ, { radius: 0.26 });
  windowPanel(island, M, {
    x: IX,
    y: priY + 0.25,
    z: priZ - 6.4,
    width: 9.6,
    height: 1.5,
    columns: 9,
    emissive: true,
  });
  windowPanel(island, M, {
    x: IX - 5.7,
    y: priY + 0.25,
    z: priZ,
    width: 11.2,
    height: 1.35,
    columns: 8,
    facing: "left",
    emissive: true,
  });
  platformDeck(island, M, IX - 6.0, priZ - 6.6, IX + 6.0, priZ + 6.6, priY + 1.85, 0.28);
  railingLoop(island, M, IX - 6.0, priZ - 6.6, IX + 6.0, priZ + 6.6, priY + 2.0);

  /* 后部烟囱组 */
  const funnelZ = IZ + 14.5;
  addRoundedBox(island, M.islandDark, 8.6, 12.0, 9.0, IX + 0.4, Y0 + 10.5, funnelZ, { radius: 0.3 });
  const funnelTop = Y0 + 16.6;
  const funnelMouth = addBox(island, M.grille, 7.2, 0.5, 7.6, IX + 0.4, funnelTop, funnelZ);
  void funnelMouth;
  // 烟囱侧面的排气格栅
  for (let i = 0; i < 3; i++) {
    addBox(island, M.grille, 0.24, 2.2, 5.6, IX + 4.75, Y0 + 12.6 + i * 2.4, funnelZ, {
      castShadow: false,
    });
  }
  for (let i = 0; i < 3; i++) {
    addBox(island, M.grille, 5.6, 0.24, 2.0, IX + 0.4, Y0 + 12.8 + i * 2.4, funnelZ + 4.55, {
      castShadow: false,
    });
  }

  /* 桅杆基座塔 */
  const mastBaseY = bridgeTop + 0.2;
  const mastZ = IZ - 2.0;
  addRoundedBox(island, M.island, 8.2, 6.4, 8.6, IX, mastBaseY + 3.2, mastZ, { radius: 0.24 });
  // 塔身前的 SPS-48 阵面
  const sps48Y = mastBaseY + 5.2;
  const sps48Frame = new THREE.Group();
  sps48Frame.position.set(IX, sps48Y, mastZ - 4.5);
  sps48Frame.rotation.x = -0.12;
  island.add(sps48Frame);
  addBox(sps48Frame, M.islandDark, 7.4, 7.4, 0.6, 0, 0, 0, { castShadow: true });
  const array = new THREE.Mesh(new THREE.BoxGeometry(6.9, 6.9, 0.22), M.radarFace);
  array.position.z = -0.36;
  sps48Frame.add(array);
  addBox(sps48Frame, M.steelDark, 7.6, 0.4, 0.9, 0, 3.7, -0.1, { castShadow: false });
  addBox(sps48Frame, M.steelDark, 7.6, 0.4, 0.9, 0, -3.7, -0.1, { castShadow: false });

  /* 格构桅杆 */
  const mastGroup = new THREE.Group();
  mastGroup.position.set(IX, mastBaseY + 6.4, mastZ);
  island.add(mastGroup);
  ctx.anim.node("island:mast", mastGroup);

  const mastHeight = 15.5;
  const legPoints = [];
  const baseW = 3.4;
  const topW = 1.1;
  const legAt = (t, sx, sz) => {
    const w = THREE.MathUtils.lerp(baseW, topW, t) / 2;
    return new THREE.Vector3((sx * w), t * mastHeight, (sz * w));
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const a = legAt(i / 6, sx, sz);
        const b = legAt((i + 1) / 6, sx, sz);
        cylinderBetween(mastGroup, M.steel, a.toArray(), b.toArray(), 0.12, { radialSegments: 5 });
        legPoints.push(a, b);
      }
    }
  }
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const a = legAt(t, -1, -1);
    const b = legAt(t, 1, -1);
    const c = legAt(t, 1, 1);
    const d = legAt(t, -1, 1);
    legPoints.push(a, b, b, c, c, d, d, a);
    if (i < 6) {
      legPoints.push(a, legAt((i + 1) / 6, 1, -1), b, legAt((i + 1) / 6, 1, 1));
      legPoints.push(c, legAt((i + 1) / 6, -1, 1), d, legAt((i + 1) / 6, -1, -1));
    }
  }
  addLineSegments(mastGroup, legPoints, M.lineRail);

  // 桅杆平台
  [0.3, 0.55, 0.78].forEach((t) => {
    const y = t * mastHeight;
    const size = THREE.MathUtils.lerp(baseW, topW, t) + 4.2;
    platformDeck(mastGroup, M, -size / 2, -size / 2, size / 2, size / 2, y, 0.22, M.steelDark);
    railingLoop(mastGroup, M, -size / 2, -size / 2, size / 2, size / 2, y + 0.12);
  });

  /* SPS-49 旋转雷达 */
  const sps49 = new THREE.Group();
  sps49.position.set(IX, mastBaseY + 17.4, mastZ);
  island.add(sps49);
  addCylinder(sps49, M.steelDark, 0.85, 1.1, 1.0, 0, 0, 0);
  const reflector = new THREE.Mesh(radarReflector(5.4, 2.1), M.radarFace);
  reflector.position.y = 1.7;
  reflector.rotation.y = Math.PI / 2;
  sps49.add(reflector);
  addBox(sps49, M.steel, 0.24, 0.9, 4.4, 0, 1.2, 0, { castShadow: false });
  ctx.anim.node("radar:sps49", sps49);

  /* SPS-10 水面搜索雷达 */
  const sps10 = new THREE.Group();
  sps10.position.set(IX, bridgeTop + 1.9, navBridgeZ + 2.5);
  island.add(sps10);
  addCylinder(sps10, M.steelDark, 0.35, 0.4, 0.9, 0, 0, 0);
  const sps10Array = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 0.2), M.radarFace);
  sps10Array.position.set(0, 0.75, 0);
  sps10Array.rotation.x = 0.18;
  sps10.add(sps10Array);
  ctx.anim.node("radar:sps10", sps10);

  /* 雷达罩 */
  const domes = [];
  [
    [IX - 5.0, bridgeTop + 2.2, navBridgeZ + 6.0, 1.9],
    [IX + 4.6, priY + 3.0, priZ + 1.0, 1.6],
  ].forEach(([x, y, z, r]) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), M.radome);
    dome.position.set(x, y, z);
    dome.castShadow = true;
    island.add(dome);
    addCylinder(island, M.steelDark, r * 0.55, r * 0.65, 0.7, x, y - r - 0.2, z);
    domes.push(dome);
  });

  /* 鞭状天线 */
  const whipAnchors = [];
  const whipMat = M.steel;
  const whips = [
    [IX - 6.2, bridgeTop + 1.2, navBridgeZ - 5.5, 11.5],
    [IX + 6.4, bridgeTop + 1.2, navBridgeZ + 4.0, 9.0],
    [IX - 4.4, mastBaseY + 8.0, mastZ - 3.0, 13.0],
    [IX + 4.2, mastBaseY + 10.0, mastZ + 2.6, 15.0],
    [IX - 1.2, mastBaseY + 17.0, mastZ - 0.6, 10.0],
    [IX + 2.0, priY + 2.2, priZ + 4.0, 7.0],
  ];
  whips.forEach(([x, y, z, h]) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    island.add(group);
    const antenna = addCylinder(group, whipMat, 0.06, 0.12, h, 0, h / 2, 0, { radialSegments: 5 });
    antenna.castShadow = false;
    whipAnchors.push(group);
  });
  ctx.anim.addUpdate((dt, time) => {
    whipAnchors.forEach((group, index) => {
      group.rotation.z = Math.sin(time * 0.9 + index * 1.7) * 0.012;
      group.rotation.x = Math.cos(time * 0.7 + index) * 0.008;
    });
  });

  /* 横桁与拉索 */
  addBox(mastGroup, M.steelDark, 13.0, 0.22, 0.22, 0, mastHeight * 0.62, 0, { castShadow: false });
  addBox(mastGroup, M.steelDark, 9.0, 0.2, 0.2, 0, mastHeight * 0.82, 0, { castShadow: false });
  const stayPoints = [];
  [
    [-6.5, mastHeight * 0.62, 0],
    [6.5, mastHeight * 0.62, 0],
  ].forEach(([x, y, z]) => {
    stayPoints.push(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(x * 1.6, 0.4, mastZ - 6.4),
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(x * 1.6, 0.4, mastZ + 8.0),
    );
  });
  addLineSegments(mastGroup, stayPoints, M.lineSoft);

  /* 桅顶航空灯 */
  const navLights = [];
  const navLightSpecs = [
    { x: -7.6, y: bridgeTop + 1.3, z: navBridgeZ, color: 0xff4a3d }, // 左舷红灯
    { x: 7.6, y: bridgeTop + 1.3, z: navBridgeZ, color: 0x4dff9a }, // 右舷绿灯
    { x: 0, y: mastBaseY + 16.0, z: mastZ, color: 0xfff4cf }, // 桅顶白灯
    { x: 0, y: Y0 + 16.8, z: funnelZ, color: 0xfff4cf },
  ];
  navLightSpecs.forEach((spec, index) => {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.9 }),
    );
    light.position.set(spec.x, spec.y, spec.z);
    island.add(light);
    navLights.push({ mesh: light, index, material: light.material });
  });
  ctx.anim.addUpdate((dt, time) => {
    navLights.forEach(({ material, index }) => {
      const phase = (time * 0.85 + index * 0.33) % 1;
      material.opacity = phase < 0.16 ? 1 : 0.12;
    });
  });

  /* 舰岛两侧的救生筏与舷梯 */
  for (let i = 0; i < 4; i++) {
    const z = IZ - 12 + i * 7.5;
    addCylinder(island, M.white, 0.55, 0.55, 2.2, IX - 6.9, Y0 + 4.4, z, {
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: 12,
      castShadow: false,
    });
  }
  ladder(island, M, IX + 6.85, IZ + 12.5, Y0 + 1.0, Y0 + 12.0, 1);

  /* 舰岛后部平台与吊臂 */
  platformDeck(island, M, IX - 6.8, IZ + 12.0, IX + 6.8, IZ + 18.0, Y0 + 9.0, 0.26);
  railingLoop(island, M, IX - 6.8, IZ + 12.0, IX + 6.8, IZ + 18.0, Y0 + 9.15);
  cylinderBetween(island, M.steel, [IX + 5.8, Y0 + 9.2, IZ + 16.5], [IX + 5.8, Y0 + 13.4, IZ + 12.0], 0.12);
  addBox(island, M.steelDark, 0.5, 0.5, 4.4, IX + 5.8, Y0 + 13.4, IZ + 10.2, {
    rotation: [-0.35, 0, 0],
  });

  /* 舰岛基座附近的甲板设备 */
  addBox(island, M.steelDark, 2.0, 1.0, 3.0, IX - 7.6, Y0 + 0.6, IZ - 14, { castShadow: false });
  addBox(island, M.steelDark, 2.0, 1.0, 3.0, IX - 7.6, Y0 + 0.6, IZ + 14, { castShadow: false });

  /* 桅杆轻微摇摆（航行时的视觉暗示） */
  const mastRest = mastGroup.rotation.clone();
  ctx.anim.addUpdate((dt, time) => {
    mastGroup.rotation.z = mastRest.z + Math.sin(time * 0.45) * 0.0015;
    mastGroup.rotation.x = mastRest.x + Math.cos(time * 0.37) * 0.0012;
  });

  /* 雷达旋转 */
  ctx.anim.addUpdate((dt) => {
    if (sps49.visible) sps49.rotation.y += dt * 1.05;
    if (sps10.visible) sps10.rotation.y += dt * 1.9;
  });

  return { island, sps48Frame, sps49, sps10, mastGroup, navLights, funnelTop, funnelZ };
}
