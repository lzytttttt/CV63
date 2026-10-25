import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { DECK_BOUNDS } from "./constants.js";

export const TAU = Math.PI * 2;

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInQuad = (t) => t * t;
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const lerp = THREE.MathUtils.lerp;

/** 甲板贴图 UV（画布顶部 = 舰艏） */
export function deckUV(x, z) {
  const { minX, maxX, minZ, maxZ } = DECK_BOUNDS;
  return [(x - minX) / (maxX - minX), 1 - (z - minZ) / (maxZ - minZ)];
}

export function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    area += x1 * z2 - x2 * z1;
  }
  return area / 2;
}

function triangulateXZ(points) {
  const contour = points.map(([x, z]) => new THREE.Vector2(x, z));
  // three 的三角化以 XY 平面逆时针为正面；这里保证索引法线朝 +Y
  const indices = THREE.ShapeUtils.triangulateShape(contour, []);
  const flip = polygonArea(points) > 0;
  const out = [];
  indices.forEach(([a, b, c]) => {
    if (flip) out.push(a, c, b);
    else out.push(a, b, c);
  });
  return out;
}

/** 水平多边形面片（单面，法线朝上），带甲板 UV */
export function makePlanarPolygon(points, y, { uv = deckUV, uvScale = null } = {}) {
  const positions = [];
  const uvs = [];
  points.forEach(([x, z]) => {
    positions.push(x, y, z);
    const [u, v] = uv(x, z);
    uvs.push(u * (uvScale?.[0] ?? 1), v * (uvScale?.[1] ?? 1));
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(triangulateXZ(points));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 甲板类厚板：顶面 + 底面 + 外壁，顶面使用甲板贴图 UV。
 * 外壁的绕向按轮廓的有向面积校正，保证凹形轮廓（升降机井）的法线也朝外。
 */
export function makeSlabGeometry(points, topY, thickness, { uv = deckUV } = {}) {
  const top = makePlanarPolygon(points, topY, { uv });
  const bottom = makePlanarPolygon(points, topY - thickness, { uv });

  const flipWalls = polygonArea(points) < 0;
  const wallPositions = [];
  const wallUvs = [];
  const wallIndices = [];
  let distance = 0;
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % count];
    const segLen = Math.hypot(x2 - x1, z2 - z1);
    const base = wallPositions.length / 3;
    wallPositions.push(x1, topY, z1, x2, topY, z2, x2, topY - thickness, z2, x1, topY - thickness, z1);
    wallUvs.push(distance, 1, distance + segLen, 1, distance + segLen, 0, distance, 0);
    if (flipWalls) wallIndices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    distance += segLen;
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute("position", new THREE.Float32BufferAttribute(wallPositions, 3));
  walls.setAttribute("uv", new THREE.Float32BufferAttribute(wallUvs, 2));
  walls.setIndex(wallIndices);
  walls.computeVertexNormals();

  return { top, bottom, walls };
}

/** 生成合并后的网格（几何数组，一次性 draw call） */
export function mergedMesh(geometries, material, { castShadow = true, receiveShadow = true } = {}) {
  const list = geometries.filter(Boolean);
  if (!list.length) return null;
  const merged = mergeGeometries(list, false);
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/* ── 基础图元 ─────────────────────────────────────────────── */

export function addBox(parent, material, w, h, d, x, y, z, opts = {}) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (opts.geometrySettings) {
    // 允许使用带倒角的 box
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (opts.rotation) mesh.rotation.set(...opts.rotation);
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  if (opts.name) mesh.name = opts.name;
  parent.add(mesh);
  return mesh;
}

export function addRoundedBox(parent, material, w, h, d, x, y, z, opts = {}) {
  const radius = opts.radius ?? 0.22;
  const geometry = new RoundedBoxGeometry(w, h, d, opts.segments ?? 2, Math.min(radius, Math.min(w, h, d) / 2.05));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (opts.rotation) mesh.rotation.set(...opts.rotation);
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  if (opts.name) mesh.name = opts.name;
  parent.add(mesh);
  return mesh;
}

export function addCylinder(parent, material, radiusTop, radiusBottom, height, x, y, z, opts = {}) {  const radialSegments = opts.radialSegments ?? 14;
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, opts.heightSegments ?? 1, opts.openEnded ?? false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (opts.rotation) mesh.rotation.set(...opts.rotation);
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  if (opts.name) mesh.name = opts.name;
  parent.add(mesh);
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);

export function cylinderBetween(parent, material, a, b, radius, opts = {}) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 1e-4) return null;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, opts.radialSegments ?? 8, 1, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
  mesh.castShadow = opts.castShadow !== false;
  parent.add(mesh);
  return mesh;
}

export function addLineSegments(parent, points, material, opts = {}) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = opts.frustumCulled ?? false;
  parent.add(lines);
  return lines;
}

export function addEdges(parent, geometryOrMesh, material, threshold = 24) {
  const geometry = geometryOrMesh.isMesh ? geometryOrMesh.geometry : geometryOrMesh;
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, threshold), material);
  if (geometryOrMesh.isMesh) {
    line.position.copy(geometryOrMesh.position);
    line.rotation.copy(geometryOrMesh.rotation);
    line.scale.copy(geometryOrMesh.scale);
  }
  parent.add(line);
  return line;
}

/* ── 栏杆 / 走道 / 桁架 ──────────────────────────────────── */

/**
 * 沿三维折线生成栏杆（立柱 + 两道横杆）
 * @param {THREE.Object3D} parent
 * @param {Array<[number,number,number]>} points 底部折线点
 */
export function addRailing(parent, points, material, { height = 1.15, postSpacing = 2.8, addMidRail = true } = {}) {
  const linePoints = [];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3(...points[i]);
    const b = new THREE.Vector3(...points[i + 1]);
    const segment = new THREE.Vector3().subVectors(b, a);
    const length = segment.length();
    if (length < 1e-3) continue;
    linePoints.push(a.clone().setY(a.y + height), b.clone().setY(b.y + height));
    if (addMidRail) linePoints.push(a.clone().setY(a.y + height * 0.52), b.clone().setY(b.y + height * 0.52));
    let travelled = postSpacing - acc;
    while (travelled < length) {
      const p = a.clone().addScaledVector(segment, travelled / length);
      linePoints.push(p, p.clone().setY(p.y + height));
      travelled += postSpacing;
    }
    acc = (acc + length) % postSpacing;
  }
  return addLineSegments(parent, linePoints, material);
}

/**
 * 桁架支撑（斜撑 + 水平梁），用于飞行甲板外伸结构
 */
export function addOutrigger(parent, material, pointA, pointB, radius = 0.18, opts = {}) {
  const mesh = cylinderBetween(parent, material, pointA, pointB, radius, { radialSegments: 5, ...opts });
  return mesh;
}

/**
 * 格构桅杆：四腿渐收 + 横撑 + 斜撑
 */
export function addLatticeMast(parent, material, lineMaterial, { x, y, z, height, baseWidth = 4.2, topWidth = 1.6, segments = 5 }) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);

  const legAt = (level, sx, sz) => {
    const t = level / segments;
    const w = THREE.MathUtils.lerp(baseWidth, topWidth, t) / 2;
    return new THREE.Vector3(sx * w, (height * level) / segments, sz * w);
  };

  const linePoints = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let level = 0; level < segments; level++) {
        const a = legAt(level, sx, sz);
        const b = legAt(level + 1, sx, sz);
        cylinderBetween(group, material, a.toArray(), b.toArray(), 0.13, { radialSegments: 5 });
        linePoints.push(a, b);
      }
    }
  }
  for (let level = 0; level <= segments; level++) {
    const a = legAt(level, -1, -1);
    const b = legAt(level, 1, -1);
    const c = legAt(level, 1, 1);
    const d = legAt(level, -1, 1);
    linePoints.push(a, b, b, c, c, d, d, a);
    if (level < segments) {
      // 交叉斜撑
      linePoints.push(a, legAt(level + 1, 1, -1), b, legAt(level + 1, 1, 1));
      linePoints.push(c, legAt(level + 1, -1, 1), d, legAt(level + 1, -1, -1));
    }
  }
  addLineSegments(group, linePoints, lineMaterial);
  return group;
}

/** 舷侧走道（catwalk） */
export function addCatwalk(parent, material, floorMaterial, points, { width = 2.2, inward = 1, y } = {}) {
  const positions = [];
  const indices = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    positions.push(x, y, z);
    positions.push(x - inward * width, y, z);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, floorMaterial ?? material);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/* ── 文字板 ───────────────────────────────────────────────── */

export function makeTextPlate(texture, width, height, materialOptions = {}) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    ...materialOptions,
  });
  const geometry = new THREE.PlaneGeometry(width, height);
  return new THREE.Mesh(geometry, material);
}

/* ── 环境贴图辅助 ─────────────────────────────────────────── */

export function applyShadows(root) {
  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = object.userData.noShadow ? false : true;
      object.receiveShadow = true;
    }
  });
}
