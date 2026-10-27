/**
 * 作战模式的三维桥接：把推演状态映射到 CV-63 的甲板、舰载机与武器站。
 * 只负责表现，不参与规则判定。
 */

import * as THREE from "three";
import { CATAPULTS, ELEVATORS, SHIP } from "../model/constants.js";

const DEG = Math.PI / 180;
const catById = Object.fromEntries(CATAPULTS.map((cat) => [cat.id, cat]));
const elevatorById = Object.fromEntries(ELEVATORS.map((item) => [item.id, item]));

function catEnd(catId) {
  const cat = catById[catId];
  return cat ? { x: cat.end[0], z: cat.end[1] } : { x: 0, z: 0 };
}

function catDir(catId) {
  const cat = catById[catId];
  if (!cat) return { x: 0, z: -1 };
  const dx = cat.end[0] - cat.start[0];
  const dz = cat.end[1] - cat.start[1];
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

export function createGameBridge({ ship, api, effects, camera, scene, controls, hooks }) {
  const airwing = ship.handles.airwing;
  const weapons = ship.handles.weapons;
  const records = new Map();
  const takeoffs = new Map();
  const projectiles = [];
  const flashes = [];
  let active = false;

  const tracerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc46b,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const missileMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe0a0,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const missileGeometry = new THREE.CylinderGeometry(0.22, 0.32, 5.2, 6);
  missileGeometry.rotateX(Math.PI / 2);
  const tracerGeometry = new THREE.CylinderGeometry(0.08, 0.14, 9, 4);
  tracerGeometry.rotateX(Math.PI / 2);

  function captureAircraft() {
    records.clear();
    airwing.list().forEach((entry) => {
      if (entry.id === "hero-approach") return;
      const object = entry.object;
      records.set(entry.id, {
        object,
        parent: object.parent,
        position: object.position.clone(),
        rotationY: object.rotation.y,
        visible: object.visible,
        folded: entry.spec?.folded ? 1 : 0,
      });
    });
  }

  function activate() {
    if (active) return;
    active = true;
    captureAircraft();
    records.forEach((record) => {
      if (record.object.parent !== airwing.group) {
        record.object.parent.remove(record.object);
        airwing.group.add(record.object);
      }
    });
    takeoffs.clear();
    projectiles.forEach((item) => {
      scene.remove(item.object);
      item.material?.dispose?.();
    });
    projectiles.length = 0;
    flashes.length = 0;
    api.elevators?.setElevator("E1", 0, { immediate: true });
    api.elevators?.setElevator("E2", 0, { immediate: true });
    api.elevators?.setElevator("E3", 0, { immediate: true });
    api.elevators?.setElevator("E4", 0, { immediate: true });
  }

  function deactivate() {
    if (!active) return;
    active = false;
    records.forEach((record) => {
      const object = record.object;
      object.visible = record.visible;
      if (record.parent) {
        if (object.parent !== record.parent) {
          object.parent?.remove(object);
          record.parent.add(object);
        }
        object.position.copy(record.position);
        object.rotation.set(0, record.rotationY, 0);
      }
      object.userData.setGear?.(1);
      object.userData.setFold?.(record.folded ?? 0);
      object.userData.setBurner?.(0);
    });
    takeoffs.clear();
    projectiles.forEach((item) => {
      scene.remove(item.object);
      item.material?.dispose?.();
    });
    projectiles.length = 0;
    flashes.forEach((item) => {
      scene.remove(item.light);
    });
    flashes.length = 0;
    api.setJbd("cat1", 0);
    api.setJbd("cat2", 0);
    api.setJbd("cat3", 0);
    api.setJbd("cat4", 0);
    api.elevators?.setElevator("E1", 0, { immediate: true });
    api.elevators?.setElevator("E2", 0, { immediate: true });
  }

  function setAircraftVisual(aircraft, dt) {
    const record = records.get(aircraft.id);
    if (!record) return;
    const object = record.object;
    const vis = aircraft.vis;
    const takeoff = takeoffs.get(aircraft.id);

    if (takeoff) {
      takeoff.t += dt;
      const cat = takeoff.catId ? catById[takeoff.catId] : null;
      const end = takeoff.catId ? catEnd(takeoff.catId) : (takeoff.from ?? { x: 0, z: 0 });
      const dir = takeoff.catId ? catDir(takeoff.catId) : { x: 0, z: 0 };
      const t = takeoff.t;
      const distance = 12 + t * 46 + t * t * 5;
      object.visible = true;
      object.position.set(
        end.x + dir.x * distance,
        SHIP.deckY + 1.2 + t * t * 5.4 + t * 1.4,
        end.z + dir.z * distance,
      );
      object.rotation.set(-Math.min(0.28, t * 0.16), Math.atan2(-dir.x, -dir.z), 0);
      object.userData.setGear?.(t > 2.2 ? 0 : 1);
      object.userData.setBurner?.(1);
      object.userData.setFold?.(0);
      if (t > 5.5) {
        takeoffs.delete(aircraft.id);
        object.visible = false;
      }
      return;
    }

    if (!vis.visible) {
      object.visible = false;
      return;
    }

    object.visible = true;
    object.position.set(vis.x, SHIP.deckY + (vis.y ?? 0), vis.z);
    object.rotation.set(vis.pitch ?? 0, vis.yaw ?? 0, 0);
    object.userData.setGear?.(vis.gear ?? 1);
    object.userData.setFold?.(vis.folded ?? 0);
    object.userData.setBurner?.(vis.burner ?? 0);
  }

  function updateElevators(state) {
    const controller = api.elevators;
    if (!controller) return;
    for (const id of ["E1", "E2"]) {
      const lift = state.elevators[id];
      if (!lift) continue;
      if (lift.state === "up" || lift.state === "down") {
        controller.setElevator(id, id === "E1" || id === "E2" ? 1 - lift.progress : 0);
      } else {
        controller.setElevator(id, 0);
      }
    }
  }

  function aimMounts(state, dt) {
    if (!weapons) return;
    const heading = state.own.heading ?? 0;
    const pairs = [
      ["sparrow-1", weapons.launchers?.[0]],
      ["sparrow-2", weapons.launchers?.[1]],
    ];
    for (const [id, unit] of pairs) {
      if (!unit) continue;
      const mount = state.mounts.find((item) => item.id === id);
      if (!mount || !mount.online) continue;
      const target = mount.targetBearing;
      if (target == null) continue;
      const relative = (target - heading) * DEG;
      const desired = -relative;
      unit.yaw.rotation.y += (desired - unit.yaw.rotation.y) * Math.min(1, dt * 4.5);
      unit.pitch.rotation.x = unit.pitchBase + 0.12;
    }
    const ciwsPairs = [
      ["ciws-1", weapons.ciws?.[0]],
      ["ciws-2", weapons.ciws?.[1]],
    ];
    for (const [id, unit] of ciwsPairs) {
      if (!unit) continue;
      const mount = state.mounts.find((item) => item.id === id);
      if (!mount || !mount.online) continue;
      const target = mount.targetBearing;
      if (target == null) continue;
      const relative = (target - heading) * DEG;
      const desired = -relative;
      unit.yaw.rotation.y += (desired - unit.yaw.rotation.y) * Math.min(1, dt * 7);
    }
  }

  function flashAt(position, color = 0xffa45c, intensity = 60, distance = 120) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.copy(position);
    scene.add(light);
    flashes.push({ light, life: 0.35, t: 0 });
  }

  function spawnProjectile(mountId, bearing, kind) {
    const mount = stateSnapshot?.mounts.find((item) => item.id === mountId);
    if (!mount) return;
    const heading = (stateSnapshot.own.heading ?? 0) * DEG;
    const relative = (bearing ?? mount.bearing3d) * DEG - heading;
    const dir = new THREE.Vector3(Math.sin(relative), 0, -Math.cos(relative));
    const origin = new THREE.Vector3(mount.x, SHIP.deckY + 4.4, mount.z);
    const isCiws = kind === "ciws";
    const material = (isCiws ? tracerMaterial : missileMaterial).clone();
    const mesh = new THREE.Mesh(isCiws ? tracerGeometry : missileGeometry, material);
    mesh.position.copy(origin);
    mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
    scene.add(mesh);
    projectiles.push({
      object: mesh,
      material,
      velocity: dir.clone().multiplyScalar(isCiws ? 420 : 240).setY(isCiws ? 3 : 16),
      life: isCiws ? 0.5 : 2.2,
      t: 0,
      kind,
    });
    flashAt(origin, 0xffbe74, isCiws ? 40 : 90, 80);
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const item = projectiles[i];
      item.t += dt;
      item.object.position.addScaledVector(item.velocity, dt);
      item.velocity.y += (item.kind === "ciws" ? -6 : 2.5) * dt;
      item.object.material.opacity = Math.max(0, 1 - item.t / item.life);
      if (item.t >= item.life) {
        scene.remove(item.object);
        item.material?.dispose?.();
        projectiles.splice(i, 1);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      const item = flashes[i];
      item.t += dt;
      item.light.intensity *= Math.max(0, 1 - dt * 9);
      if (item.t >= item.life) {
        scene.remove(item.light);
        flashes.splice(i, 1);
      }
    }
  }

  let stateSnapshot = null;

  function drainEvents(state) {
    const queue = state.fxQueue ?? [];
    while (queue.length) {
      const fx = queue.shift();
      if (fx.type === "steam") {
        if (fx.catId) {
          const cat = catById[fx.catId];
          if (cat) {
            effects?.steamBurst?.([cat.start[0], SHIP.deckY + 1.2, cat.start[1]], {
              count: 30,
              spread: 3.2,
              duration: 1.1,
            });
          }
        } else if (Number.isFinite(fx.x)) {
          effects?.steamBurst?.([fx.x, SHIP.deckY + 0.7, fx.z], { count: 18, spread: 1.6, duration: 0.8 });
        }
      } else if (fx.type === "jbd") {
        api.setJbd(fx.catId, fx.value);
      } else if (fx.type === "catapult") {
        const cat = catById[fx.catId];
        if (cat) {
          effects?.steamBurst?.([cat.start[0], SHIP.deckY + 1, cat.start[1]], {
            count: 40,
            spread: 3.4,
            duration: 1.4,
          });
        }
      } else if (fx.type === "airborne") {
        takeoffs.set(fx.aircraftId, { t: 0, catId: fx.catId, from: fx.from });
      } else if (fx.type === "trap") {
        effects?.steamBurst?.([fx.x ?? 0, SHIP.deckY + 0.6, fx.z ?? 0], {
          count: 16,
          spread: 1.4,
          duration: 0.8,
        });
      } else if (fx.type === "weaponFire") {
        spawnProjectile(fx.mountId, fx.bearing, fx.kind);
      } else if (fx.type === "impact") {
        const point = new THREE.Vector3(fx.x ?? 0, SHIP.deckY + 3.2, fx.z ?? 0);
        effects?.impactBurst?.(point, { count: 34, spread: 6, duration: 0.8 });
        flashAt(point, 0xff7a3c, 220, 220);
        hooks?.onImpact?.(fx);
      } else if (fx.type === "fire") {
        const point = new THREE.Vector3(fx.x ?? 0, SHIP.deckY + 2.5, fx.z ?? 0);
        effects?.impactBurst?.(point, { count: 12, spread: 3.4, duration: 0.9 });
        flashAt(point, 0xff8a4c, 40, 80);
      } else if (fx.type === "chaff") {
        const point = new THREE.Vector3(0, SHIP.deckY + 16, 0);
        effects?.steamBurst?.(point, { count: 30, spread: 14, duration: 1.3 });
        hooks?.onChaff?.();
      }
    }
  }

  function update(dt, state) {
    if (!active || !state) return;
    stateSnapshot = state;
    records.forEach((record, id) => {
      const aircraft = state.aircraft.find((item) => item.id === id);
      if (aircraft) setAircraftVisual(aircraft, dt);
    });
    updateElevators(state);
    aimMounts(state, dt);
    drainEvents(state);
    updateProjectiles(dt);
  }

  function setDeckView(enabled) {
    if (!active) return;
    records.forEach((record) => {
      record.object.visible = record.object.visible;
    });
    if (!enabled) {
      api.camera.flyTo([360, 190, 420], [0, 16, 0], 1.4);
    } else {
      api.camera.flyTo([168, 98, 196], [0, 34, -4], 1.2);
    }
  }

  return {
    activate,
    deactivate,
    update,
    setDeckView,
    isActive: () => active,
  };
}
