import * as THREE from "three";
import {
  ANGLED_DECK,
  CATAPULTS,
  DECK_OUTLINE,
  ELEVATOR_NOTCHES,
  ELEVATORS,
  SHIP,
} from "./constants.js";
import {
  addBox,
  addCylinder,
  addLineSegments,
  addRailing,
  cylinderBetween,
  deckUV,
  makePlanarPolygon,
  makeSlabGeometry,
  mergedMesh,
  polygonArea,
} from "./geometry.js";
import { hullSurfaceX } from "./hull.js";

const DECK_Y = SHIP.deckY;

/* ── 轮廓工具 ─────────────────────────────────────────────── */

function centroid(points) {
  const c = [0, 0];
  points.forEach(([x, z]) => {
    c[0] += x;
    c[1] += z;
  });
  c[0] /= points.length;
  c[1] /= points.length;
  return c;
}

export function offsetOutline(points, distance) {
  const center = centroid(points);
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const point = points[i];
    const dirA = new THREE.Vector2(point[0] - prev[0], point[1] - prev[1]).normalize();
    const dirB = new THREE.Vector2(next[0] - point[0], next[1] - point[1]).normalize();
    let normalA = new THREE.Vector2(dirA.y, -dirA.x);
    if (normalA.x * (point[0] - center[0]) + normalA.y * (point[1] - center[1]) < 0) normalA.negate();
    const normalB = new THREE.Vector2(dirB.y, -dirB.x);
    if (normalB.x * (point[0] - center[0]) + normalB.y * (point[1] - center[1]) < 0) normalB.negate();
    const normal = normalA.add(normalB).normalize();
    out.push([point[0] + normal.x * distance, point[1] + normal.y * distance]);
  }
  return out;
}

/* ── 甲板主体 ─────────────────────────────────────────────── */

function buildDeckSlab(parent, M) {
  const { top, bottom, walls } = makeSlabGeometry(DECK_OUTLINE, DECK_Y, SHIP.deckThickness);
  const topMesh = new THREE.Mesh(top, M.deck);
  topMesh.name = "FLIGHT DECK / surface";
  topMesh.receiveShadow = true;
  topMesh.castShadow = true;
  parent.add(topMesh);

  const bottomMesh = new THREE.Mesh(bottom, M.deckUnder);
  bottomMesh.receiveShadow = true;
  parent.add(bottomMesh);

  const wallMesh = new THREE.Mesh(walls, M.deckEdge);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  parent.add(wallMesh);

  return { topMesh, bottomMesh, wallMesh };
}

/* ── 舷侧走道 / 支撑 / 栏杆 ──────────────────────────────── */

function buildCatwalks(parent, M) {
  const outer = offsetOutline(DECK_OUTLINE, 1.9);
  const y = DECK_Y - 2.35;
  const positions = [];
  const indices = [];
  for (let i = 0; i < DECK_OUTLINE.length; i++) {
    positions.push(outer[i][0], y, outer[i][1]);
    positions.push(DECK_OUTLINE[i][0], y, DECK_OUTLINE[i][1]);
  }
  for (let i = 0; i < DECK_OUTLINE.length; i++) {
    const j = (i + 1) % DECK_OUTLINE.length;
    const a = i * 2;
    const b = j * 2;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // 保证走道法线朝上
  const normal = geometry.getAttribute("normal");
  let sumY = 0;
  for (let i = 0; i < normal.count; i++) sumY += normal.getY(i);
  if (sumY < 0) {
    const index = geometry.getIndex();
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 2);
      index.setX(i, b);
      index.setX(i + 2, a);
    }
    geometry.getIndex().needsUpdate = true;
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, M.deckEdge);
  mesh.receiveShadow = true;
  parent.add(mesh);

  // 走道外侧栏杆
  const railPoints = [];
  for (let i = 0; i < outer.length; i += 1) {
    railPoints.push([outer[i][0], y, outer[i][1]]);
  }
  railPoints.push(railPoints[0]);
  addRailing(parent, railPoints, M.lineRail, { height: 1.15, postSpacing: 3.2 });

  // 走道下方的斜撑（每 12 m）
  const struts = [];
  for (let z = -150; z <= 152; z += 12) {
    for (const side of [-1, 1]) {
      const half = deckHalfWidth(z, side);
      if (half === null) continue;
      const hullX = hullSurfaceX(z, 12.6) * side;
      const deckX = (half + 0.6) * side;
      const a = [hullX, 12.4, z];
      const b = [deckX, y, z];
      const geo = new THREE.CylinderGeometry(0.16, 0.16, distance3(a, b), 6);
      const quat = quaternionBetween(a, b);
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
        quat,
        new THREE.Vector3(1, 1, 1),
      );
      geo.applyMatrix4(matrix);
      struts.push(geo);
    }
  }
  const strutMesh = mergedMesh(struts, M.steelDark, { castShadow: false });
  if (strutMesh) parent.add(strutMesh);
}

function deckHalfWidth(z, side) {
  // 用轮廓与射线求交，避免循环依赖 constants 的额外工具
  let best = null;
  for (let i = 0; i < DECK_OUTLINE.length; i++) {
    const a = DECK_OUTLINE[i];
    const b = DECK_OUTLINE[(i + 1) % DECK_OUTLINE.length];
    if ((a[1] - z) * (b[1] - z) > 0) continue;
    if (Math.abs(b[1] - a[1]) < 1e-6) continue;
    const t = (z - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    if (side > 0 ? x > 0 : x < 0) {
      if (best === null || Math.abs(x) > Math.abs(best)) best = x;
    }
  }
  return best;
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function quaternionBetween(a, b) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

/* ── 甲板细节部件 ─────────────────────────────────────────── */

function catenaryWire(a, b, sag, material, radius = 0.06) {
  const points = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = THREE.MathUtils.lerp(a[0], b[0], t);
    const y = THREE.MathUtils.lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag;
    const z = THREE.MathUtils.lerp(a[2], b[2], t);
    points.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 4, false), material);
  tube.castShadow = true;
  return tube;
}

function buildArrestingGear(parent, M, ctx) {
  const stern = ANGLED_DECK.centerStern;
  const bow = ANGLED_DECK.centerBow;
  const dx = bow[0] - stern[0];
  const dz = bow[1] - stern[1];
  const halfW = ANGLED_DECK.width / 2;
  const nx = -dz / Math.hypot(dx, dz);
  const nz = dx / Math.hypot(dx, dz);

  const wires = [];
  ANGLED_DECK.wiresZ.forEach((wz, index) => {
    const t = (wz - stern[1]) / dz;
    const cx = stern[0] + dx * t;
    const a = [cx + nx * (halfW - 2.4), DECK_Y + 0.32, wz + nz * (halfW - 2.4)];
    const b = [cx - nx * (halfW - 2.4), DECK_Y + 0.32, wz - nz * (halfW - 2.4)];
    const wire = catenaryWire(a, b, 0.45, M.steel, 0.055);
    wire.name = `ARREST WIRE ${index + 1}`;
    parent.add(wire);
    wires.push(wire);

    // 甲板上的支座
    for (const p of [a, b]) {
      addBox(parent, M.steelDark, 0.9, 0.9, 0.9, p[0], DECK_Y + 0.15, p[2], { castShadow: false });
    }
  });

  // 弹射器轨道（金属条）
  CATAPULTS.forEach((cat) => {
    const start = new THREE.Vector3(cat.start[0], DECK_Y, cat.start[1]);
    const end = new THREE.Vector3(cat.end[0], DECK_Y, cat.end[1]);
    const length = start.distanceTo(end);
    for (const offset of [-0.55, 0.55]) {
      const dir = end.clone().sub(start).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(offset);
      const a = start.clone().add(perp);
      const b = end.clone().add(perp);
      const geo = new THREE.BoxGeometry(0.34, 0.16, length);
      const mesh = new THREE.Mesh(geo, M.steelDark);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.position.y = DECK_Y + 0.06;
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }

    // 喷流挡板
    const jbdGroup = new THREE.Group();
    jbdGroup.position.set(cat.jbd[0], DECK_Y + 0.05, cat.jbd[1]);
    const angle = Math.atan2(cat.end[0] - cat.start[0], cat.end[1] - cat.start[1]);
    jbdGroup.rotation.y = angle;
    const hinge = new THREE.Group();
    jbdGroup.add(hinge);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.36, 4.6), M.warningStriped);
    panel.position.set(0, 0.18, -2.3);
    panel.castShadow = true;
    hinge.add(panel);
    const ribMat = M.steelDark;
    for (let i = -2; i <= 2; i++) {
      addBox(hinge, ribMat, 0.22, 0.24, 4.4, i * 2.6, 0.42, -2.3, { castShadow: false });
    }
    parent.add(jbdGroup);
    ctx.anim.node(`jbd:${cat.id}`, hinge);
    jbdGroup.userData.hinge = hinge;
    wires.push(jbdGroup);
  });

  // 甲板边缘灯
  const lightPositions = [];
  for (let z = -150; z <= 150; z += 6) {
    const half = deckHalfWidth(z, 1);
    if (half === null) continue;
    lightPositions.push(half + 0.5, DECK_Y + 0.22, z);
    lightPositions.push(-half - 0.5, DECK_Y + 0.22, z);
  }
  const pointsGeo = new THREE.BufferGeometry();
  pointsGeo.setAttribute("position", new THREE.Float32BufferAttribute(lightPositions, 3));
  const lights = new THREE.Points(
    pointsGeo,
    new THREE.PointsMaterial({
      color: 0xbfe8f5,
      size: 0.65,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  parent.add(lights);

  return { wires, lights };
}

/* ── 升降机井 ─────────────────────────────────────────────── */

function buildElevatorWells(parent, M) {
  ELEVATOR_NOTCHES.forEach((notch) => {
    const zc = (notch.z0 + notch.z1) / 2;
    const length = notch.z1 - notch.z0;
    const width = Math.abs(notch.outer - notch.inner);
    const xc = (notch.inner + notch.outer) / 2;
    const depth = DECK_Y - SHIP.hangarY;
    // 井壁
    const wallMat = M.hangarWall;
    addBox(parent, wallMat, 0.3, depth, length, notch.inner, DECK_Y - depth / 2, zc, { castShadow: false });
    addBox(parent, wallMat, width, depth, 0.3, xc, DECK_Y - depth / 2, notch.z0, { castShadow: false });
    addBox(parent, wallMat, width, depth, 0.3, xc, DECK_Y - depth / 2, notch.z1, { castShadow: false });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ color: 0x2b3236, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(xc, SHIP.hangarY + 0.05, zc);
    parent.add(floor);
  });
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function buildFlightDeck(parent, ctx) {
  const M = ctx.materials;
  const slab = buildDeckSlab(parent, M);
  buildCatwalks(parent, M);
  const gear = buildArrestingGear(parent, M, ctx);
  buildElevatorWells(parent, M);

  // 甲板边缘防滑网（线框）
  const netPoints = [];
  const outer = offsetOutline(DECK_OUTLINE, 5.2);
  for (let i = 0; i < DECK_OUTLINE.length; i += 2) {
    const a = DECK_OUTLINE[i];
    const b = outer[i];
    netPoints.push(
      new THREE.Vector3(a[0], DECK_Y - 2.3, a[1]),
      new THREE.Vector3(b[0], DECK_Y - 1.4, b[1]),
    );
  }
  addLineSegments(parent, netPoints, M.lineSoft);

  // 舰岛周围的甲板标记（系留环/供电箱）用小体块示意
  const clutter = new THREE.Group();
  const spots = [
    [15, -70],
    [18, -32],
    [-14, -92],
    [-24, 26],
    [12, 86],
  ];
  spots.forEach(([x, z]) => {
    addBox(clutter, M.steelDark, 1.6, 0.8, 1.2, x, DECK_Y + 0.4, z, { castShadow: false });
  });
  parent.add(clutter);

  return { ...slab, ...gear };
}
