import * as THREE from "three";
import { ELEVATORS, SHIP } from "./constants.js";
import { addBox, addLineSegments } from "./geometry.js";

const DECK_Y = SHIP.deckY;

/**
 * 四部舷侧升降机（参考参数：右舷 3 部 + 左舷 1 部）。
 * 平台整体位于甲板轮廓之外——甲板轮廓的凹口就是升降机井，
 * 因此平台与甲板面在平面投影上不重叠，升降时不会与甲板发生穿插。
 * 平台默认与飞行甲板齐平，可下沉到机库甲板（行程 = 甲板面 − 机库甲板）。
 */
export function buildElevators(parent, ctx) {
  const M = ctx.materials;
  const platforms = {};

  ELEVATORS.forEach((elevator) => {
    const { width, length, side, x, z, maxDrop } = elevator;
    const group = new THREE.Group();
    group.position.set(x, DECK_Y, z);
    group.name = `ELEVATOR / ${elevator.id}`;
    parent.add(group);

    // 平台主体
    const plate = new THREE.Mesh(new THREE.BoxGeometry(width, 0.9, length), M.elevator);
    plate.position.y = -0.45;
    plate.castShadow = true;
    plate.receiveShadow = true;
    group.add(plate);

    // 甲板面覆层
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.45, 0.08, length - 0.45),
      new THREE.MeshStandardMaterial({ color: 0x41484d, roughness: 0.9, metalness: 0.15 }),
    );
    top.position.y = 0.03;
    top.receiveShadow = true;
    group.add(top);

    // 危险色带
    [-1, 1].forEach((s) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, length - 0.7), M.warning);
      stripe.position.set(s * (width / 2 - 0.3), 0.08, 0);
      group.add(stripe);
    });
    [-1, 1].forEach((s) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(width - 0.7, 0.06, 0.45), M.warning);
      stripe.position.set(0, 0.08, s * (length / 2 - 0.3));
      group.add(stripe);
    });

    // 内侧导向滑块（贴着船体一侧）
    const innerX = side * (-width / 2 + 0.4);
    [-1, 1].forEach((end) => {
      addBox(group, M.steelDark, 0.5, 1.4, 1.1, innerX, -0.8, end * (length / 2 - 1.3), {
        castShadow: false,
      });
    });

    // 平台下反梁
    const trussPoints = [];
    for (let i = -1; i <= 1; i++) {
      trussPoints.push(
        new THREE.Vector3(i * (width / 2 - 0.8), -0.9, -length / 2 + 1.1),
        new THREE.Vector3(i * (width / 2 - 0.8), -0.9, length / 2 - 1.1),
      );
    }
    addLineSegments(group, trussPoints, M.lineSoft);

    // 编号牌（贴在平台内缘）
    const plateMesh = addBox(group, M.warning, 0.06, 0.7, 2.4, innerX + side * 0.28, 0.5, 0, {
      castShadow: false,
    });
    void plateMesh;

    platforms[elevator.id] = {
      group,
      config: elevator,
      current: 0,
      target: 0,
    };

    ctx.anim.node(`elevator:${elevator.id}`, group);
    ctx.anim.addUpdate((dt) => {
      const state = platforms[elevator.id];
      if (Math.abs(state.target - state.current) < 1e-4) return;
      const speed = 2.4; // m/s
      const delta = state.target - state.current;
      const step = Math.sign(delta) * Math.min(Math.abs(delta), (speed * dt) / maxDrop);
      state.current += step;
      group.position.y = DECK_Y - state.current * maxDrop;
    });
  });

  return {
    platforms,
    /** 0 = 甲板面，1 = 机库甲板 */
    setElevator(id, value, { immediate = false } = {}) {
      const state = platforms[id];
      if (!state) return;
      state.target = THREE.MathUtils.clamp(value, 0, 1);
      if (immediate) {
        state.current = state.target;
        state.group.position.y = DECK_Y - state.current * state.config.maxDrop;
      }
    },
    getElevator(id) {
      return platforms[id];
    },
  };
}
