import * as THREE from "three";
import { HANGAR, SHIP } from "./constants.js";
import { addBox, addLineSegments } from "./geometry.js";

const FLOOR_Y = HANGAR.y;
const TOP_Y = HANGAR.top;
const HALF_W = HANGAR.halfWidth;

function bulkhead(parent, M, z, width, height, { door = false } = {}) {
  const y0 = FLOOR_Y;
  addBox(parent, M.hangarWall, width, height, 0.3, 0, y0 + height / 2, z, { castShadow: false });
  if (door) {
    addBox(parent, M.black, 7.4, height * 0.72, 0.4, 0, y0 + height * 0.4, z + 0.1, { castShadow: false });
    addBox(parent, M.steelDark, 7.9, 0.4, 0.7, 0, y0 + height * 0.78, z + 0.1, { castShadow: false });
  }
}

export function buildHangar(parent, ctx) {
  const M = ctx.materials;
  const hangar = new THREE.Group();
  hangar.name = "HANGAR DECK";
  parent.add(hangar);

  const length = HANGAR.maxZ - HANGAR.minZ;
  const centerZ = (HANGAR.minZ + HANGAR.maxZ) / 2;
  const height = TOP_Y - FLOOR_Y;

  // 机库甲板
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, length), M.hangarFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, centerZ);
  floor.receiveShadow = true;
  hangar.add(floor);

  // 顶部
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, length), M.hangarWall);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, TOP_Y, centerZ);
  hangar.add(ceiling);

  // 侧壁
  addBox(hangar, M.hangarWall, 0.25, height, length, -HALF_W, FLOOR_Y + height / 2, centerZ, {
    castShadow: false,
  });
  addBox(hangar, M.hangarWall, 0.25, height, length, HALF_W, FLOOR_Y + height / 2, centerZ, {
    castShadow: false,
  });

  // 横向强肋骨与顶部横梁
  for (let z = HANGAR.minZ + 6; z <= HANGAR.maxZ - 4; z += 9) {
    for (const side of [-1, 1]) {
      addBox(hangar, M.steelDark, 0.5, height, 0.7, side * (HALF_W - 0.3), FLOOR_Y + height / 2, z, {
        castShadow: false,
      });
    }
    addBox(hangar, M.steelDark, HALF_W * 2, 0.55, 0.6, 0, TOP_Y - 0.4, z, { castShadow: false });
  }

  // 纵向桁材
  for (const x of [-HALF_W + 0.8, HALF_W - 0.8]) {
    addBox(hangar, M.steelDark, 0.35, 0.7, length - 4, x, TOP_Y - 0.9, centerZ, { castShadow: false });
  }

  // 前后舱壁
  bulkhead(hangar, M, HANGAR.minZ + 0.4, HALF_W * 2, height, { door: true });
  bulkhead(hangar, M, HANGAR.maxZ - 0.4, HALF_W * 2, height, { door: true });

  // 顶部照明带
  const lightY = TOP_Y - 1.1;
  for (let z = HANGAR.minZ + 8; z <= HANGAR.maxZ - 8; z += 12) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(9, 0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x9fd8e8, transparent: true, opacity: 0.55 }),
    );
    strip.position.set(0, lightY, z);
    hangar.add(strip);
  }

  // 维修工位 / 工具柜 / 牵引车
  const props = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const z = HANGAR.minZ + 18 + i * 22;
    addBox(props, M.steelDark, 2.4, 1.8, 4.2, -HALF_W + 2.6, FLOOR_Y + 0.9, z, { castShadow: false });
    addBox(props, M.steelDark, 2.2, 1.6, 3.6, HALF_W - 2.4, FLOOR_Y + 0.8, z + 8, { castShadow: false });
  }
  hangar.add(props);

  // 地面标线
  const linePoints = [];
  for (const x of [-9, 9]) {
    linePoints.push(
      new THREE.Vector3(x, FLOOR_Y + 0.03, HANGAR.minZ + 4),
      new THREE.Vector3(x, FLOOR_Y + 0.03, HANGAR.maxZ - 4),
    );
  }
  addLineSegments(hangar, linePoints, M.lineWarn);

  // 机库内的支撑柱
  for (let z = HANGAR.minZ + 28; z <= HANGAR.maxZ - 20; z += 44) {
    for (const x of [-11.6, 11.6]) {
      addBox(hangar, M.steelDark, 0.6, height, 0.6, x, FLOOR_Y + height / 2, z, { castShadow: false });
    }
  }

  // 消防隔离帘（半透明）
  for (const z of [-40, 48]) {
    const curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2 - 1, height - 1),
      new THREE.MeshBasicMaterial({
        color: 0x9a6b52,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    curtain.position.set(0, FLOOR_Y + height / 2, z);
    hangar.add(curtain);
  }

  return { shape: { floorY: FLOOR_Y, topY: TOP_Y, halfWidth: HALF_W } };
}
