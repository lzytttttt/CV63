import * as THREE from "three";
import { AIRWING_SPOTS, HANGAR_AIRCRAFT, SHIP, deckEdgeAt } from "./constants.js";
import { createAircraft } from "./aircraft.js";
import { addBox, addCylinder, addLineSegments } from "./geometry.js";

const DECK_Y = SHIP.deckY;
const deg = THREE.MathUtils.degToRad;

/* ── 甲板牵引车 ───────────────────────────────────────────── */
function createTractor(M) {
  const group = new THREE.Group();
  const body = addBox(group, M.warning, 2.4, 1.1, 3.4, 0, 0.9, 0, { castShadow: true });
  void body;
  addBox(group, M.steelDark, 1.1, 0.7, 1.0, 0, 1.7, -1.1, { castShadow: true });
  addBox(group, M.black, 0.5, 0.5, 0.5, 0, 1.75, 0.2, { castShadow: false });
  for (const x of [-1.15, 1.15]) {
    for (const z of [-1.15, 1.15]) {
      addCylinder(group, M.rubber, 0.52, 0.52, 0.45, x, 0.5, z, {
        rotation: [0, 0, Math.PI / 2],
        radialSegments: 12,
      });
    }
  }
  addBox(group, M.steel, 0.12, 0.9, 0.12, 0, 1.9, -1.75, { castShadow: false });
  return group;
}

/**
 * 舰载机联队：甲板停放、机库停放、牵引车与两名"演出"用飞机。
 * 动画节点：aircraft:<id>；英雄机 hornet-1 用于弹射，hero-approach 用于着舰。
 */
export function buildAirwing(parent, ctx) {
  const M = ctx.materials;
  const group = new THREE.Group();
  group.name = "AIR WING";
  parent.add(group);

  const aircraft = new Map();
  const rotors = [];

  const addAircraft = (spec, { hangar = false, extraParent = null } = {}) => {
    const model = createAircraft(spec.type, M, { folded: Boolean(spec.folded), gear: true });
    if (!model) return null;
    const object = model;
    const yaw = deg(spec.yaw ?? 0);
    object.rotation.y = yaw;
    object.userData.spot = spec;
    if (extraParent) {
      const localX = spec.x - extraParent.position.x;
      const localZ = spec.z - extraParent.position.z;
      object.position.set(localX, 0.06, localZ);
      extraParent.add(object);
    } else {
      object.position.set(spec.x, hangar ? SHIP.hangarY + 0.05 : DECK_Y + 0.02, spec.z);
      group.add(object);
    }
    if (model.userData?.rotors?.length) {
      model.userData.rotors.forEach((rotor) => rotors.push(rotor));
    }
    aircraft.set(spec.id, {
      id: spec.id,
      type: spec.type,
      object: model,
      spec,
      home: {
        position: object.position.clone(),
        rotationY: yaw,
        parent: object.parent,
      },
    });
    ctx.anim.node(`aircraft:${spec.id}`, object);
    return object;
  };

  AIRWING_SPOTS.forEach((spec) => {
    let extraParent = null;
    if (spec.elevator) {
      extraParent = ctx.anim.get(`elevator:${spec.elevator}`) ?? null;
    }
    addAircraft(spec, { extraParent });
  });

  HANGAR_AIRCRAFT.forEach((spec) => addAircraft(spec, { hangar: true }));

  // 着舰演出用飞机（初始隐藏）
  const approach = createAircraft("fa18", M, { folded: false, gear: true });
  if (approach) {
    approach.visible = false;
    approach.position.set(0, 120, 420);
    group.add(approach);
    aircraft.set("hero-approach", {
      id: "hero-approach",
      type: "fa18",
      object: approach,
      spec: { id: "hero-approach", type: "fa18", x: 0, z: 420, yaw: 0 },
      home: { position: new THREE.Vector3(0, 120, 420), rotationY: 0, parent: group },
    });
    ctx.anim.node("aircraft:hero-approach", approach);
  }

  // 甲板牵引车
  const tractors = [];
  [
    { x: -16.5, z: 42, yaw: 20 },
    { x: 12.0, z: 66, yaw: -35 },
    { x: 18.0, z: -130, yaw: 90 },
  ].forEach((spec) => {
    const tractor = createTractor(M);
    tractor.position.set(spec.x, DECK_Y, spec.z);
    tractor.rotation.y = deg(spec.yaw);
    group.add(tractor);
    tractors.push(tractor);
  });

  // 甲板边缘系留点：贴着真实甲板外缘内缩 0.9 … 2.5 m
  const tiePoints = [];
  for (let z = SHIP.bowZ + 6; z <= SHIP.sternZ - 6; z += 4) {
    for (const side of [-1, 1]) {
      const x = deckEdgeAt(z, side) - side * 0.9;
      tiePoints.push(
        new THREE.Vector3(x, DECK_Y + 0.05, z),
        new THREE.Vector3(x - side * 1.6, DECK_Y + 0.05, z),
      );
    }
  }
  addLineSegments(group, tiePoints, M.lineSoft);

  // 螺旋桨 / 旋翼持续转动
  ctx.anim.addUpdate((dt) => {
    rotors.forEach((rotor) => {
      const target = rotor.object;
      if (!target) return;
      const axis = rotor.axis ?? "z";
      target.rotation[axis] += dt * (rotor.speed ?? 7.5);
    });
  });

  /* ── 对外接口 ───────────────────────────────────────────── */

  function resetHeroes() {
    const launch = aircraft.get("hornet-1");
    if (launch) {
      launch.object.visible = true;
      launch.object.position.copy(launch.home.position);
      launch.object.rotation.set(0, launch.home.rotationY, 0);
      launch.object.userData.setGear?.(1);
      launch.object.userData.setBurner?.(0);
    }
    const hero = aircraft.get("hero-approach");
    if (hero) {
      hero.object.visible = false;
      hero.object.position.set(0, 120, 420);
      hero.object.rotation.set(0, 0, 0);
      hero.object.userData.setGear?.(1);
      hero.object.userData.setBurner?.(0);
    }
  }

  function hideApproach() {
    const hero = aircraft.get("hero-approach");
    if (hero) hero.object.visible = false;
  }

  function getAircraft(id) {
    return aircraft.get(id);
  }

  function setBurner(id, value) {
    aircraft.get(id)?.object.userData.setBurner?.(value);
  }

  function setGear(id, value) {
    aircraft.get(id)?.object.userData.setGear?.(value);
  }

  return {
    group,
    aircraft,
    tractors,
    get: getAircraft,
    list: () => [...aircraft.values()],
    resetHeroes,
    hideApproach,
    setBurner,
    setGear,
    launchHeroId: "hornet-1",
    approachHeroId: "hero-approach",
  };
}
