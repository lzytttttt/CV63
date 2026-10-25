import * as THREE from "three";
import { BLOCK_IDS, CATAPULTS, ELEVATORS, ISLAND, SHIP } from "./model/constants.js";
import { createMaterials } from "./model/materials.js";
import { buildHull } from "./model/hull.js";
import { buildFlightDeck } from "./model/flightdeck.js";
import { buildElevators } from "./model/elevators.js";
import { buildIsland } from "./model/island.js";
import { buildHangar } from "./model/hangar.js";
import { buildPropulsion } from "./model/propulsion.js";
import { buildAirwing } from "./model/airwing.js";
import { buildWeapons } from "./model/weapons.js";
import { buildStructure } from "./model/structure.js";

/**
 * 装配整舰：九个功能区块各自独立成组，便于爆炸拆解、显隐与聚焦。
 * @param {import("./anim/animator.js").Animator} anim
 */
export function createShip(anim) {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = "CV-63 Kitty Hawk";

  const groups = {};
  BLOCK_IDS.forEach((id) => {
    const group = new THREE.Group();
    group.name = `BLOCK / ${id}`;
    group.userData.partId = id;
    root.add(group);
    groups[id] = group;
  });

  const ctx = { materials, anim, nodes: {} };
  const handles = {};

  handles.hull = buildHull(groups.hull, ctx);
  handles.flightdeck = buildFlightDeck(groups.flightdeck, ctx);
  handles.elevators = buildElevators(groups.elevators, ctx);
  handles.island = buildIsland(groups.island, ctx);
  handles.hangar = buildHangar(groups.hangar, ctx);
  handles.propulsion = buildPropulsion(groups.propulsion, ctx);
  handles.airwing = buildAirwing(groups.airwing, ctx);
  handles.weapons = buildWeapons(groups.weapons, ctx);
  handles.structure = buildStructure(groups.structure, ctx);

  let meshCount = 0;
  root.traverse((object) => {
    if (object.isLine) {
      object.userData.noShadow = true;
      return;
    }
    if (!object.isMesh) return;
    meshCount++;
    if (object.material?.transparent && (object.material.opacity ?? 1) < 0.35) {
      object.castShadow = false;
    } else if (object.userData.noShadow) {
      object.castShadow = false;
    } else {
      object.castShadow = true;
    }
    object.receiveShadow = true;
  });

  // 标记 partId，供拾取与显隐使用
  Object.entries(groups).forEach(([id, group]) => {
    group.traverse((object) => {
      if (object.isMesh || object.isLine) object.userData.partId = id;
    });
  });

  return { root, groups, materials, handles, meshCount, ctx };
}

export const SHIP_LABELS = [
  {
    groupId: "flightdeck",
    title: "飞行甲板",
    en: "FLIGHT DECK",
    position: [-30, SHIP.deckY + 3.2, 74],
    side: "left",
    minExplode: 0,
  },
  {
    groupId: "island",
    title: "舰岛",
    en: "ISLAND / RADAR",
    position: [ISLAND.x + 2, SHIP.deckY + 34, ISLAND.z],
    side: "right",
    minExplode: 0,
  },
  {
    groupId: "airwing",
    title: "舰载机联队",
    en: "CARRIER AIR WING",
    position: [16, SHIP.deckY + 7, -104],
    side: "left",
    minExplode: 0,
  },
  {
    groupId: "elevators",
    title: "升降机",
    en: "DECK-EDGE ELEVATOR",
    position: [ELEVATORS[2].x + 3, SHIP.deckY + 4, ELEVATORS[2].z],
    side: "right",
    minExplode: 0.38,
    secondary: true,
  },
  {
    groupId: "flightdeck",
    title: "弹射器",
    en: "STEAM CATAPULT",
    position: [CATAPULTS[0].start[0] + 4, SHIP.deckY + 2.6, CATAPULTS[0].start[1] - 24],
    side: "left",
    minExplode: 0.48,
    secondary: true,
  },
  {
    groupId: "flightdeck",
    title: "斜角甲板",
    en: `${SHIP.landingAngleDeg}° ANGLED DECK`,
    position: [-24, SHIP.deckY + 2.6, 112],
    side: "left",
    minExplode: 0.44,
    secondary: true,
  },
  {
    groupId: "propulsion",
    title: "动力舱",
    en: "PROPULSION / 8 BOILERS",
    position: [0, 2, 40],
    side: "right",
    minExplode: 0.12,
  },
  {
    groupId: "hangar",
    title: "机库甲板",
    en: "HANGAR DECK",
    position: [-10, 14, 74],
    side: "left",
    minExplode: 0.4,
    secondary: true,
  },
  {
    groupId: "weapons",
    title: "近防武备",
    en: "CLOSE-IN DEFENSE",
    position: [ISLAND.x + 6, SHIP.deckY + 6, 132],
    side: "right",
    minExplode: 0.55,
    secondary: true,
  },
];
