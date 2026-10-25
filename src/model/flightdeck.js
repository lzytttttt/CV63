import * as THREE from "three";
import {
  ANGLED_DECK,
  CATAPULTS,
  DECK_OUTLINE,
  ELEVATOR_NOTCHES,
  SHIP,
  deckEdgeAt,
  deckEdgesAt,
} from "./constants.js";
import {
  addBox,
  addLineSegments,
  addRailing,
  makeSlabGeometry,
} from "./geometry.js";
import { hullSurfaceX } from "./hull.js";

const DECK_Y = SHIP.deckY;
const DECK_BOTTOM = SHIP.deckUndersideY;

/* ── 甲板主体 ─────────────────────────────────────────────── */

function buildDeckSlab(parent, M) {
  const { top, bottom, walls } = makeSlabGeometry(DECK_OUTLINE, DECK_Y, SHIP.deckThickness);

  const topMesh = new THREE.Mesh(top, M.deck);
  topMesh.name = "FLIGHT DECK / surface";
  topMesh.receiveShadow = true;
  topMesh.castShadow = true;
  parent.add(topMesh);

  const bottomMesh = new THREE.Mesh(bottom, M.deckUnder);
  bottomMesh.name = "FLIGHT DECK / underside";
  bottomMesh.receiveShadow = true;
  parent.add(bottomMesh);

  const wallMesh = new THREE.Mesh(walls, M.deckEdge);
  wallMesh.name = "FLIGHT DECK / edge girder";
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  parent.add(wallMesh);

  return { topMesh, bottomMesh, wallMesh };
}

/* ── 边缘走道栏杆 / 安全网 ────────────────────────────────── */

function buildDeckEdgeDetails(parent, M) {
  // 栏杆沿真实轮廓布置（含升降机井），与甲板外缘一致
  const railPoints = DECK_OUTLINE.map(([x, z]) => [x, DECK_Y + 0.02, z]);
  railPoints.push(railPoints[0]);
  addRailing(parent, railPoints, M.lineRail, { height: 1.12, postSpacing: 3.4 });

  // 舷外安全网（提示性线框）
  const netPoints = [];
  for (let i = 0; i < DECK_OUTLINE.length; i += 2) {
    const [x0, z0] = DECK_OUTLINE[i];
    const [x1, z1] = DECK_OUTLINE[(i + 1) % DECK_OUTLINE.length];
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const nx = -(z1 - z0) / len;
    const nz = (x1 - x0) / len;
    const outward = Math.sign(nx * x0 + nz * z0) || 1;
    netPoints.push(
      new THREE.Vector3(x0, DECK_BOTTOM - 0.4, z0),
      new THREE.Vector3(x0 + nx * 2.6 * outward, DECK_Y - 1.1, z0 + nz * 2.6 * outward),
    );
  }
  addLineSegments(parent, netPoints, M.lineSoft);

  // 甲板边缘灯（沿轮廓每 6 m 一个）
  const lightPositions = [];
  for (let z = SHIP.bowZ + 2; z <= SHIP.sternZ - 2; z += 6) {
    const { left, right } = deckEdgesAt(z);
    if (left === null || right === null) continue;
    lightPositions.push(left + 0.45, DECK_Y + 0.22, z);
    lightPositions.push(right - 0.45, DECK_Y + 0.22, z);
  }
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lightPositions, 3));
  const lights = new THREE.Points(
    pointsGeometry,
    new THREE.PointsMaterial({
      color: 0xbfe8f5,
      size: 0.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  parent.add(lights);
  return lights;
}

/* ── 拦阻索 / 弹射器 ─────────────────────────────────────── */

function catenaryWire(a, b, sag, material, radius = 0.055) {
  const points = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(
      new THREE.Vector3(
        THREE.MathUtils.lerp(a[0], b[0], t),
        THREE.MathUtils.lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag,
        THREE.MathUtils.lerp(a[2], b[2], t),
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 4, false), material);
  tube.castShadow = true;
  return tube;
}

function buildArrestingGear(parent, M, ctx) {
  const [tailX, tailZ] = ANGLED_DECK.centerStern;
  const [noseX, noseZ] = ANGLED_DECK.centerBow;
  const dx = noseX - tailX;
  const dz = noseZ - tailZ;
  const len = Math.hypot(dx, dz);
  const nx = -dz / len;
  const nz = dx / len;
  const halfW = ANGLED_DECK.stripHalfWidth;

  const wires = [];
  ANGLED_DECK.wireFractions.forEach((fraction, index) => {
    const cx = tailX + dx * fraction;
    const cz = tailZ + dz * fraction;
    const a = [cx + nx * (halfW - 1.6), DECK_Y + 0.3, cz + nz * (halfW - 1.6)];
    const b = [cx - nx * (halfW - 1.6), DECK_Y + 0.3, cz - nz * (halfW - 1.6)];
    const wire = catenaryWire(a, b, 0.4, M.steel, 0.05);
    wire.name = `ARREST WIRE ${index + 1}`;
    parent.add(wire);
    wires.push(wire);
    for (const p of [a, b]) {
      addBox(parent, M.steelDark, 0.8, 0.8, 0.8, p[0], DECK_Y + 0.15, p[2], { castShadow: false });
    }
  });

  // 弹射器轨道 + 喷流挡板
  const catapults = [];
  CATAPULTS.forEach((cat) => {
    const start = new THREE.Vector3(cat.start[0], DECK_Y, cat.start[1]);
    const end = new THREE.Vector3(cat.end[0], DECK_Y, cat.end[1]);
    const dir = end.clone().sub(start).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);

    for (const offset of [-0.55, 0.55]) {
      const a = start.clone().addScaledVector(perp, offset);
      const b = end.clone().addScaledVector(perp, offset);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, cat.length), M.steelDark);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.position.y = DECK_Y + 0.06;
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }

    // 弹射滑块
    const shuttle = addBox(parent, M.steel, 0.9, 0.34, 2.4, 0, DECK_Y + 0.2, 0, { castShadow: false });
    shuttle.position.copy(start).addScaledVector(dir, 4);
    shuttle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    catapults.push({ cat, mesh: shuttle });

    // 喷流挡板（可升起）
    const jbdGroup = new THREE.Group();
    jbdGroup.position.set(cat.jbd[0], DECK_Y + 0.05, cat.jbd[1]);
    jbdGroup.rotation.y = Math.atan2(dir.x, dir.z);
    parent.add(jbdGroup);
    const hinge = new THREE.Group();
    jbdGroup.add(hinge);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(12.0, 0.36, 4.4), M.warningStriped);
    panel.position.set(0, 0.18, -2.2);
    panel.castShadow = true;
    hinge.add(panel);
    for (let i = -2; i <= 2; i++) {
      addBox(hinge, M.steelDark, 0.22, 0.24, 4.2, i * 2.5, 0.42, -2.2, { castShadow: false });
    }
    ctx.anim.node(`jbd:${cat.id}`, hinge);
    jbdGroup.userData.hinge = hinge;
  });

  return { wires, catapults };
}

/* ── 升降机井 / 舷外侧导轨 ─────────────────────────────────
 * 舷侧升降机是"甲板边缘"式：平台在船体舷侧之外的凹口里上下运行，
 * 因此不做封闭井筒（那会变成一个悬空的盒子），而是：
 *   1) 平台四角的竖向导轨（甲板下缘 → 机库甲板）；
 *   2) 机库层的一块承接平台；
 *   3) 船体舷侧对应位置的大开口（飞机由此进出机库）。
 */
function buildElevatorWells(parent, M) {
  const hangarY = SHIP.hangarY;
  const topY = DECK_BOTTOM;

  ELEVATOR_NOTCHES.forEach((notch) => {
    const zc = (notch.z0 + notch.z1) / 2;
    const length = notch.z1 - notch.z0;
    const side = notch.side;
    const innerX = notch.inner;
    const outerX = notch.outer;
    const height = topY - hangarY;
    const width = Math.abs(outerX - innerX);

    // 承接平台（机库层）
    addBox(parent, M.steelDark, width - 0.4, 0.35, length - 0.4, (innerX + outerX) / 2, hangarY + 0.18, zc, {
      castShadow: false,
    });

    // 四角竖向导轨
    for (const z of [notch.z0 + 0.55, notch.z1 - 0.55]) {
      for (const x of [innerX + side * 0.35, outerX - side * 0.35]) {
        addBox(parent, M.steelDark, 0.34, height, 0.34, x, hangarY + height / 2, z, { castShadow: false });
      }
    }
    // 导轨横向拉杆（每 3 m）
    for (let y = hangarY + 3; y < topY - 1; y += 3) {
      for (const z of [notch.z0 + 0.55, notch.z1 - 0.55]) {
        addBox(parent, M.steelDark, width - 0.8, 0.16, 0.2, (innerX + outerX) / 2, y, z, { castShadow: false });
      }
    }

    // 平台整体位于船体舷侧之外时，在舷侧外板上补一个机库开口
    const hullHalf = Math.abs(hullSurfaceX(zc, hangarY + 3.2));
    if (Math.abs(innerX) > hullHalf + 0.4) {
      const openingWidth = Math.min(length - 3.2, 14);
      const openingY = hangarY + 3.3;
      const openingHeight = 5.8;
      const xFace = side * (hullHalf + 0.14);
      addBox(parent, M.black, 0.3, openingHeight, openingWidth, xFace, openingY, zc, {
        castShadow: false,
        receiveShadow: false,
      });
      for (const y of [openingY + openingHeight / 2, openingY - openingHeight / 2]) {
        addBox(parent, M.steelDark, 0.42, 0.3, openingWidth + 1.2, xFace, y, zc, { castShadow: false });
      }
      for (const z of [zc - openingWidth / 2, zc + openingWidth / 2]) {
        addBox(parent, M.steelDark, 0.42, openingHeight, 0.3, xFace, openingY, z, { castShadow: false });
      }
    }
  });
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function buildFlightDeck(parent, ctx) {
  const M = ctx.materials;
  const slab = buildDeckSlab(parent, M);
  const lights = buildDeckEdgeDetails(parent, M);
  const gear = buildArrestingGear(parent, M, ctx);
  buildElevatorWells(parent, M);

  // 甲板系留环 / 供电箱等小体块
  const clutter = new THREE.Group();
  const spots = [
    [14, -66],
    [18, -34],
    [-13, -88],
    [-22, 26],
    [12, 86],
    [-8, 118],
  ];
  spots.forEach(([x, z]) => {
    const edge = deckEdgeAt(z, x >= 0 ? 1 : -1);
    if (Math.abs(x) > Math.abs(edge) - 2) return;
    addBox(clutter, M.steelDark, 1.6, 0.8, 1.2, x, DECK_Y + 0.4, z, { castShadow: false });
  });
  parent.add(clutter);

  return { ...slab, ...gear, lights };
}
