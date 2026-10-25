import * as THREE from "three";
import { ELEVATORS, SHIP } from "./constants.js";
import { addBox, addLineSegments, smoothstep } from "./geometry.js";

const DECK_Y = SHIP.deckY;
const HANGAR_Y = SHIP.hangarY;

/**
 * 四部舷侧升降机。平台默认与飞行甲板齐平，可下沉至机库甲板。
 * 动画节点：elevator:E1 ... E4，平台位移用 position.y 驱动。
 */
export function buildElevators(parent, ctx) {
  const M = ctx.materials;
  const platforms = {};

  ELEVATORS.forEach((elevator) => {
    const length = elevator.length;
    const width = elevator.width;
    const outerEdge = elevator.edge ?? elevator.outer ?? elevator.inner + elevator.side * width;
    const centerX = (elevator.inner + outerEdge) / 2;
    const centerZ = elevator.z;

    const group = new THREE.Group();
    group.position.set(centerX, DECK_Y, centerZ);
    group.name = `ELEVATOR / ${elevator.id}`;
    parent.add(group);

    // 平台主体
    const plateGeo = new THREE.BoxGeometry(width, 0.9, length);
    const plate = new THREE.Mesh(plateGeo, M.elevator);
    plate.position.y = -0.45;
    plate.castShadow = true;
    plate.receiveShadow = true;
    group.add(plate);

    // 甲板面覆层（略深的防滑面）
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.5, 0.08, length - 0.5),
      new THREE.MeshStandardMaterial({ color: 0x41484d, roughness: 0.9, metalness: 0.15 }),
    );
    top.position.y = 0.03;
    top.receiveShadow = true;
    group.add(top);

    // 危险条纹边缘
    [-1, 1].forEach((side) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, length - 0.8), M.warning);
      stripe.position.set(side * (width / 2 - 0.35), 0.08, 0);
      group.add(stripe);
    });
    [-1, 1].forEach((side) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(width - 0.8, 0.06, 0.5), M.warning);
      stripe.position.set(0, 0.08, side * (length / 2 - 0.35));
      group.add(stripe);
    });

    // 侧面导向滑块
    const innerX = elevator.side * (-width / 2 + 0.4);
    [-1, 1].forEach((end) => {
      addBox(group, M.steelDark, 0.5, 1.4, 1.1, innerX, -0.8, end * (length / 2 - 1.4), {
        castShadow: false,
      });
    });

    // 平台底部的桁架（下反梁）
    const trussPoints = [];
    for (let i = -1; i <= 1; i++) {
      trussPoints.push(
        new THREE.Vector3(i * (width / 2 - 0.9), -0.9, -length / 2 + 1.2),
        new THREE.Vector3(i * (width / 2 - 0.9), -0.9, length / 2 - 1.2),
      );
    }
    addLineSegments(group, trussPoints, M.lineSoft);

    // 编号
    const labelTexture = ctx.materials.deckMap; // 复用画布仅作占位，不直接使用
    void labelTexture;

    platforms[elevator.id] = {
      group,
      config: elevator,
      current: 0,
      target: 0,
      velocity: 0,
    };

    ctx.anim.node(`elevator:${elevator.id}`, group);
    ctx.anim.addUpdate((dt) => {
      const state = platforms[elevator.id];
      if (Math.abs(state.target - state.current) < 1e-4) return;
      const speed = 2.4; // m/s
      const delta = state.target - state.current;
      const step = Math.sign(delta) * Math.min(Math.abs(delta), speed * dt);
      state.current += step;
      group.position.y = DECK_Y + state.current * (HANGAR_Y - DECK_Y + 0.55);
    });
  });

  return {
    platforms,
    /** 设置升降机位置，0 = 甲板面，1 = 机库层 */
    setElevator(id, value, { immediate = false } = {}) {
      const state = platforms[id];
      if (!state) return;
      state.target = THREE.MathUtils.clamp(value, 0, 1);
      if (immediate) {
        state.current = state.target;
        state.group.position.y = DECK_Y + state.current * (HANGAR_Y - DECK_Y + 0.55);
      }
    },
    getElevator(id) {
      return platforms[id];
    },
  };
}
