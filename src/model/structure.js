import * as THREE from "three";
import { HANGAR, SHIP } from "./constants.js";
import { addBox, addLineSegments } from "./geometry.js";
import { hullRingAt } from "./hull.js";

/**
 * 内部骨架：横剖肋位、纵向桁材、多层甲板与舱壁。
 * 打开剖切或拆解时可见，用于解释船体结构连续性。
 */
export function buildStructure(parent, ctx) {
  const M = ctx.materials;
  const group = new THREE.Group();
  group.name = "INTERNAL FRAME";
  parent.add(group);

  const frameZ = [];
  const count = 25;
  for (let i = 0; i < count; i++) {
    frameZ.push(THREE.MathUtils.lerp(-146, 150, i / (count - 1)));
  }

  const ringPoints = [];
  const frames = [];
  frameZ.forEach((z) => {
    const ring = hullRingAt(z, 0.965);
    frames.push({ z, ring });
    for (let i = 0; i < ring.length - 1; i++) {
      ringPoints.push(new THREE.Vector3(...ring[i]), new THREE.Vector3(...ring[i + 1]));
    }
    // 主甲板梁（机库甲板与飞行甲板下缘）
    const left = ring[0][0];
    const right = ring[ring.length - 1][0];
    ringPoints.push(
      new THREE.Vector3(left * 0.94, HANGAR.y, z),
      new THREE.Vector3(right * 0.94, HANGAR.y, z),
      new THREE.Vector3(left * 0.9, HANGAR.top, z),
      new THREE.Vector3(right * 0.9, HANGAR.top, z),
    );
    // 中纵舱壁
    ringPoints.push(new THREE.Vector3(0, SHIP.keelY + 1.2, z), new THREE.Vector3(0, HANGAR.y - 0.4, z));
  });
  addLineSegments(group, ringPoints, M.lineSoft);

  // 纵向桁材
  const stringerIndices = [2, 5, 8, 11, 14, 18, 22, 26, 30, 34, 37];
  stringerIndices.forEach((index) => {
    const points = [];
    frames.forEach((frame) => {
      const point = frame.ring[Math.min(index, frame.ring.length - 1)];
      if (point) points.push(new THREE.Vector3(...point));
    });
    for (let i = 0; i < points.length - 1; i++) {
      addLineSegments(group, [points[i], points[i + 1]], M.lineSoft);
    }
  });

  // 多层内部甲板（示意）
  const deckLevels = [
    { y: 5.4, half: 17.0, from: -96, to: 118 },
    { y: 1.6, half: 16.4, from: -80, to: 128 },
    { y: -3.2, half: 14.2, from: -56, to: 138 },
  ];
  deckLevels.forEach((level) => {
    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(level.half * 2, level.to - level.from),
      new THREE.MeshBasicMaterial({
        color: 0x4d99ad,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, level.y, (level.from + level.to) / 2);
    group.add(deck);
    const border = [
      new THREE.Vector3(-level.half, level.y, level.from),
      new THREE.Vector3(level.half, level.y, level.from),
      new THREE.Vector3(level.half, level.y, level.to),
      new THREE.Vector3(-level.half, level.y, level.to),
      new THREE.Vector3(-level.half, level.y, level.from),
    ];
    for (let i = 0; i < border.length - 1; i++) {
      addLineSegments(group, [border[i], border[i + 1]], M.lineSoft);
    }
  });

  // 主横舱壁
  [-100, -22, 58, 122].forEach((z) => {
    const ring = hullRingAt(z, 0.955);
    const shape = new THREE.Shape();
    ring.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x3f8ba2,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.position.z = z;
    group.add(mesh);
    // 舱壁轮廓线
    const points = [];
    for (let i = 0; i < ring.length - 1; i++) {
      points.push(new THREE.Vector3(ring[i][0], ring[i][1], z), new THREE.Vector3(ring[i + 1][0], ring[i + 1][1], z));
    }
    addLineSegments(group, points, M.lineGlow);
  });

  // 甲板下加强桁材
  for (const x of [-10.8, 10.8]) {
    addBox(group, M.steelDark, 0.55, 1.1, 232, x, HANGAR.y - 0.9, 8, { castShadow: false });
  }
  for (const x of [-8.4, 8.4]) {
    addBox(group, M.steelDark, 0.4, 0.75, 206, x, 5.0, 16, { castShadow: false });
  }

  // 舷侧肋骨定位（结构可视化的小体块）
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x7fd2e8, transparent: true, opacity: 0.35 });
  frameZ.forEach((z) => {
    const ring = hullRingAt(z, 0.955);
    [1, ring.length - 2].forEach((index) => {
      const point = ring[index];
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), markerMat);
      marker.position.set(point[0], point[1], z);
      group.add(marker);
    });
  });

  return { frames, group };
}
