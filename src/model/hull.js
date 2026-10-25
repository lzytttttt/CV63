import * as THREE from "three";
import { COLORS, SHIP, ELEVATORS, DECK_OUTLINE } from "./constants.js";
import { addBox, addCylinder, addLineSegments, clamp01, smoothstep, mergedMesh, makeTextPlate } from "./geometry.js";
import { makeTextTexture } from "./materials.js";

/* ── 型线与剖面 ───────────────────────────────────────────── */

const STATIONS = [
  { z: -162, w: 0.15, draft: -3.6, rake: 9.0, fin: 1.4 },
  { z: -160, w: 2.0, draft: -4.8, rake: 8.0, fin: 1.3 },
  { z: -158, w: 3.7, draft: -5.8, rake: 6.6, fin: 1.2 },
  { z: -156, w: 5.3, draft: -6.9, rake: 5.4, fin: 1.1 },
  { z: -153, w: 7.7, draft: -8.2, rake: 4.0, fin: 0.95 },
  { z: -150, w: 9.9, draft: -9.2, rake: 2.8, fin: 0.8 },
  { z: -146, w: 12.1, draft: -10.0, rake: 1.6, fin: 0.62 },
  { z: -142, w: 13.9, draft: -10.6, rake: 0.9, fin: 0.5 },
  { z: -136, w: 15.7, draft: -11.1, rake: 0.4, fin: 0.36 },
  { z: -130, w: 16.9, draft: -11.35, rake: 0.2, fin: 0.26 },
  { z: -124, w: 17.8, draft: -11.5, rake: 0.1, fin: 0.18 },
  { z: -116, w: 18.5, draft: -11.65, rake: 0.04, fin: 0.1 },
  { z: -108, w: 19.0, draft: -11.75, rake: 0, fin: 0.04 },
  { z: -98, w: 19.4, draft: -11.8, rake: 0, fin: 0 },
  { z: -86, w: 19.6, draft: -11.8, rake: 0, fin: 0 },
  { z: -72, w: 19.75, draft: -11.8, rake: 0, fin: 0 },
  { z: -56, w: 19.8, draft: -11.8, rake: 0, fin: 0 },
  { z: -36, w: 19.8, draft: -11.8, rake: 0, fin: 0 },
  { z: -12, w: 19.8, draft: -11.8, rake: 0, fin: 0 },
  { z: 12, w: 19.8, draft: -11.8, rake: 0, fin: 0 },
  { z: 36, w: 19.8, draft: -11.8, rake: 0, fin: 0 },
  { z: 56, w: 19.75, draft: -11.8, rake: 0, fin: 0 },
  { z: 72, w: 19.7, draft: -11.8, rake: 0, fin: 0 },
  { z: 88, w: 19.55, draft: -11.75, rake: 0, fin: 0.02 },
  { z: 104, w: 19.3, draft: -11.6, rake: -0.2, fin: 0.06 },
  { z: 118, w: 18.9, draft: -11.35, rake: -0.5, fin: 0.1 },
  { z: 130, w: 18.2, draft: -10.95, rake: -0.9, fin: 0.16 },
  { z: 140, w: 17.1, draft: -10.3, rake: -1.4, fin: 0.24 },
  { z: 148, w: 15.6, draft: -9.2, rake: -2.0, fin: 0.32 },
  { z: 154, w: 13.4, draft: -7.6, rake: -2.8, fin: 0.4 },
  { z: 158, w: 10.4, draft: -5.8, rake: -3.6, fin: 0.48 },
  { z: 161, w: 6.6, draft: -3.9, rake: -4.4, fin: 0.55 },
  { z: 162.4, w: 3.2, draft: -2.4, rake: -5.0, fin: 0.6 },
];

const PROFILE = [
  [0.0, 1.0],
  [0.07, 1.003],
  [0.15, 1.002],
  [0.25, 0.998],
  [0.35, 0.99],
  [0.46, 0.976],
  [0.56, 0.955],
  [0.64, 0.93],
  [0.72, 0.885],
  [0.8, 0.82],
  [0.87, 0.73],
  [0.92, 0.62],
  [0.955, 0.48],
  [0.98, 0.3],
  [1.0, 0.0],
];

const HULL_TOP = SHIP.hullTopY;
const PROFILE_POINTS = 41;

function sampleProfile(t) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [t0, w0] = PROFILE[i];
    const [t1, w1] = PROFILE[i + 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1);
      return THREE.MathUtils.lerp(w0, w1, smoothstep(k));
    }
  }
  return 0;
}

function interpolateStations() {
  const result = [];
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i];
    const b = STATIONS[i + 1];
    const span = b.z - a.z;
    const steps = Math.max(2, Math.round(span / 2.6));
    for (let s = 0; s < steps; s++) {
      const raw = s / steps;
      const t = smoothstep(raw);
      result.push({
        z: THREE.MathUtils.lerp(a.z, b.z, raw),
        w: THREE.MathUtils.lerp(a.w, b.w, t),
        draft: THREE.MathUtils.lerp(a.draft, b.draft, t),
        rake: THREE.MathUtils.lerp(a.rake, b.rake, t),
        fin: THREE.MathUtils.lerp(a.fin, b.fin, t),
      });
    }
  }
  result.push({ ...STATIONS[STATIONS.length - 1] });
  return result;
}

const SECTIONS = interpolateStations();

function sectionRing(section) {
  const half = [];
  for (let i = 0; i < PROFILE_POINTS; i++) {
    const t = i / (PROFILE_POINTS - 1);
    const y = THREE.MathUtils.lerp(HULL_TOP, section.draft, t);
    let factor = sampleProfile(t);
    factor = Math.pow(factor, 1 + section.fin * 1.55);
    const x = section.w * factor;
    const rake = section.rake * Math.pow(t, 1.6);
    half.push([x, y, section.z + rake]);
  }
  const ring = [];
  // 从右舷甲板边沿向下到龙骨，再回到左舷
  for (let i = 0; i < half.length; i++) ring.push([half[i][0], half[i][1], half[i][2]]);
  for (let i = half.length - 2; i >= 0; i--) ring.push([-half[i][0], half[i][1], half[i][2]]);
  return ring;
}

function hullVertexColor(y, z) {
  const color = new THREE.Color();
  if (y < 0.25) {
    const t = clamp01((y + 11.8) / 12.05);
    color.copy(new THREE.Color(0x4a2924)).lerp(new THREE.Color(0x74392f), t);
  } else if (y < 1.55) {
    color.setHex(0x1c2023);
  } else {
    const t = clamp01((y - 1.55) / (HULL_TOP - 1.55));
    color.copy(new THREE.Color(0x67727a)).lerp(new THREE.Color(COLORS.hull), Math.pow(t, 0.7));
  }
  const shade = Math.sin(z * 0.071) * 0.012 + Math.cos(z * 0.031 + y * 0.21) * 0.01;
  color.offsetHSL(0, 0, shade);
  return color;
}

function buildHullGeometry() {
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const rings = SECTIONS.map(sectionRing);
  const ringN = rings[0].length;
  const sectionN = rings.length;

  rings.forEach((ring, si) => {
    ring.forEach(([x, y, z], ri) => {
      positions.push(x, y, z);
      const c = hullVertexColor(y, z);
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
      indices.push(a, b, d, d, b, c);
    }
  }

  // 舰艉端面（transom）
  const sternIndex = (sectionN - 1) * ringN;
  const sternRing = rings[sectionN - 1];
  const centerZ = sternRing.reduce((sum, p) => sum + p[2], 0) / sternRing.length;
  const centerY = sternRing.reduce((sum, p) => sum + p[1], 0) / sternRing.length;
  const centerX = 0;
  const centerIdx = positions.length / 3;
  positions.push(centerX, centerY, centerZ);
  colors.push(0.24, 0.26, 0.27);
  uvs.push(0.5, 0.5);
  for (let ri = 0; ri < ringN - 1; ri++) {
    indices.push(centerIdx, sternIndex + ri, sternIndex + ri + 1);
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

export function hullHalfWidthAt(z) {
  if (z <= SECTIONS[0].z) return SECTIONS[0].w;
  for (let i = 0; i < SECTIONS.length - 1; i++) {
    const a = SECTIONS[i];
    const b = SECTIONS[i + 1];
    if (z >= a.z && z <= b.z) {
      const k = (z - a.z) / (b.z - a.z || 1);
      return THREE.MathUtils.lerp(a.w, b.w, k);
    }
  }
  return SECTIONS[SECTIONS.length - 1].w;
}

export function hullSectionAt(z) {
  for (let i = 0; i < SECTIONS.length - 1; i++) {
    const a = SECTIONS[i];
    const b = SECTIONS[i + 1];
    if (z >= a.z && z <= b.z) {
      const k = (z - a.z) / (b.z - a.z || 1);
      return {
        w: THREE.MathUtils.lerp(a.w, b.w, k),
        draft: THREE.MathUtils.lerp(a.draft, b.draft, k),
        fin: THREE.MathUtils.lerp(a.fin, b.fin, k),
      };
    }
  }
  return { w: SECTIONS[SECTIONS.length - 1].w, draft: SECTIONS[SECTIONS.length - 1].draft, fin: 0 };
}

/** 舷侧表面在给定高度处的半宽（用于外挂细节定位） */
export function hullSurfaceX(z, y) {
  const section = hullSectionAt(z);
  const t = clamp01((HULL_TOP - y) / (HULL_TOP - section.draft));
  let factor = sampleProfile(t);
  factor = Math.pow(factor, 1 + section.fin * 1.55);
  return section.w * factor;
}

/** 任意 z 处的横剖线（内缩 inset 用于结构骨架） */
export function hullRingAt(z, inset = 1) {
  let a = SECTIONS[0];
  let b = SECTIONS[0];
  for (let i = 0; i < SECTIONS.length - 1; i++) {
    if (z >= SECTIONS[i].z && z <= SECTIONS[i + 1].z) {
      a = SECTIONS[i];
      b = SECTIONS[i + 1];
      break;
    }
    if (z < SECTIONS[0].z) {
      a = SECTIONS[0];
      b = SECTIONS[0];
    } else if (i === SECTIONS.length - 2) {
      a = SECTIONS[SECTIONS.length - 1];
      b = a;
    }
  }
  const k = b.z === a.z ? 0 : (z - a.z) / (b.z - a.z);
  const section = {
    z,
    w: THREE.MathUtils.lerp(a.w, b.w, k) * inset,
    draft: THREE.MathUtils.lerp(a.draft, b.draft, k),
    rake: THREE.MathUtils.lerp(a.rake, b.rake, k),
    fin: THREE.MathUtils.lerp(a.fin, b.fin, k),
  };
  return sectionRing(section);
}

/** 所有横剖线所在的 z 范围 */
export const HULL_Z_RANGE = [SECTIONS[0].z, SECTIONS[SECTIONS.length - 1].z];

/* ── 细节 ─────────────────────────────────────────────────── */

function buildPlatingLines(parent, material) {
  const points = [];
  const rings = SECTIONS.map(sectionRing);

  // 纵向板缝
  [2, 5, 8, 11, 14, 17, 21, 25, 29, 33, 36].forEach((ri) => {
    for (let si = 0; si < rings.length - 1; si += 2) {
      const a = rings[si][ri];
      const b = rings[Math.min(si + 2, rings.length - 1)][ri];
      points.push(new THREE.Vector3(...a), new THREE.Vector3(...b));
    }
  });

  // 横向板缝（抽稀，避免出现网格噪点）
  for (let si = 0; si < rings.length; si += 6) {
    const ring = rings[si];
    for (let ri = 0; ri < ring.length - 1; ri += 3) {
      points.push(new THREE.Vector3(...ring[ri]), new THREE.Vector3(...ring[ri + 1]));
    }
  }

  // 水线 / 折角线
  const waterline = [];
  const bootTop = [];
  const knuckle = [];
  SECTIONS.forEach((section) => {
    const ring = sectionRing(section);
    // 找出最接近 y 的环点
    const closest = (target) =>
      ring.reduce((best, p) => (Math.abs(p[1] - target) < Math.abs(best[1] - target) ? p : best), ring[0]);
    waterline.push(closest(0.05));
    bootTop.push(closest(1.58));
    knuckle.push(closest(17.2));
  });
  for (let i = 0; i < waterline.length - 1; i++) {
    points.push(new THREE.Vector3(...waterline[i]), new THREE.Vector3(...waterline[i + 1]));
    points.push(new THREE.Vector3(...bootTop[i]), new THREE.Vector3(...bootTop[i + 1]));
    points.push(new THREE.Vector3(...knuckle[i]), new THREE.Vector3(...knuckle[i + 1]));
  }

  addLineSegments(parent, points, material);
}

function buildHullOpenings(parent, M) {
  const openingZ = [-96, -64, -24, 16, 56, 96, 128];
  openingZ.forEach((z, index) => {
    for (const side of [-1, 1]) {
      const x = side * (hullSurfaceX(z, 13.6) + 0.12);
      const width = index % 2 === 0 ? 13 : 9;
      const height = index % 2 === 0 ? 5.6 : 4.6;
      const panel = addBox(parent, M.black, 0.35, height, width, x, 13.4, z, {
        castShadow: false,
        receiveShadow: false,
      });
      panel.rotation.y = Math.PI / 2;
      // 门框
      const frameMat = M.steelDark;
      addBox(parent, frameMat, 0.5, 0.35, width + 0.7, x + side * 0.06, 13.4 + height / 2, z, {
        castShadow: false,
      }).rotation.y = Math.PI / 2;
      addBox(parent, frameMat, 0.5, 0.35, width + 0.7, x + side * 0.06, 13.4 - height / 2, z, {
        castShadow: false,
      }).rotation.y = Math.PI / 2;
    }
  });
}

function buildElevatorRails(parent, M) {
  ELEVATORS.forEach((elevator) => {
    const z0 = elevator.z - elevator.length / 2;
    const z1 = elevator.z + elevator.length / 2;
    const x = elevator.side * (Math.abs(elevator.inner) - 0.15);
    for (const z of [z0, z1]) {
      addBox(parent, M.steelDark, 0.4, 7.4, 0.6, x, 14.1, z, { castShadow: false });
    }
    const points = [
      new THREE.Vector3(x, 10.4, z0),
      new THREE.Vector3(x, 10.4, z1),
      new THREE.Vector3(x, 18.2, z0),
      new THREE.Vector3(x, 18.2, z1),
    ];
    addLineSegments(parent, points, M.lineSoft);
  });
}

function buildBoatBays(parent, M) {
  const bays = [
    { z: -16, side: 1 },
    { z: -16, side: -1 },
    { z: 64, side: 1 },
    { z: 64, side: -1 },
  ];
  bays.forEach(({ z, side }) => {
    const x = side * (hullSurfaceX(z, 12.4) + 0.1);
    addBox(parent, M.black, 0.35, 4.4, 8.4, x, 12.2, z, { castShadow: false }).rotation.y = Math.PI / 2;
    addBox(parent, M.steelDark, 0.45, 0.3, 8.8, x + side * 0.05, 14.4, z, { castShadow: false }).rotation.y =
      Math.PI / 2;
    // 救生艇
    const boat = new THREE.Group();
    boat.position.set(x + side * 0.9, 12.2, z);
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 4.6, 5, 10), M.white);
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = Math.PI / 2;
    hull.scale.set(1, 0.62, 0.8);
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
    const x = side * (hullSurfaceX(z, 8.0) + 0.18);
    addBox(parent, M.black, 0.3, 3.6, 3.0, x, 8.2, z, { castShadow: false }).rotation.y = Math.PI / 2;
    const group = new THREE.Group();
    group.position.set(x + side * 0.35, 8.2, z);
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
  // 舰艉舷窗与舰名字牌
  const nameTexture = makeTextTexture("KITTY HAWK", {
    width: 1024,
    height: 160,
    font: 'bold 96px "Arial Black", Arial',
    color: "#dfe7ea",
    letterSpacing: 6,
  });
  const plate = makeTextPlate(nameTexture, 18, 2.8, { opacity: 0.9 });
  plate.position.set(0, 12.6, 161.9);
  parent.add(plate);

  addBox(parent, M.black, 9.5, 2.4, 0.35, 0, 15.6, 161.6, { castShadow: false });
  addBox(parent, M.steelDark, 10.4, 0.28, 0.5, 0, 16.9, 161.5, { castShadow: false });

  // 舰艉平台与护栏基座
  addBox(parent, M.steelDark, 16, 0.5, 3.0, 0, 17.9, 158.6, { castShadow: false });
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

  // 龙骨与舭龙骨线条
  const keelPoints = [];
  for (let z = -150; z <= 152; z += 6) {
    const section = hullSectionAt(z);
    keelPoints.push(new THREE.Vector3(-0.4, section.draft + 0.05, z), new THREE.Vector3(0.4, section.draft + 0.05, z));
  }
  addLineSegments(parent, keelPoints, M.lineSoft);

  return { hull, material, geometry, halfWidthAt: hullHalfWidthAt };
}
