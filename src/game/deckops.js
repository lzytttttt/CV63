/**
 * 甲板调度：升降机、牵引、弹射、回收、补给。
 *
 * 状态机（每架飞机）：
 *   hangar → elevating → spotting → ready → queued → taxi → hook → stroke → airborne
 *   airborne → inbound → holding → approach → trap → clear → taxiIn → service → ready
 *
 * 资源约束：
 *   - 2 个弹射班组（同时最多 2 架在弹射流程里）；
 *   - 3 个补给班组；
 *   - 4 部弹射器，其中 CAT 3/4（腰部）在回收作业期间不可用；
 *   - E-2C / EA-6B 只能使用腰部弹射器；
 *   - 机库飞机上甲板需要空闲停机位 + 空闲升降机。
 */

import { ANGLED_DECK, CATAPULTS, ELEVATORS } from "../model/constants.js";
import { CAT, DECK_TIMING, MISSION, WAIST_CATS, AIRCRAFT_TYPES } from "./constants.js";
import { clamp, lerp } from "./geo.js";
import {
  freeLaunchCrew,
  freeServiceCrew,
  freeSpot,
  pushFx,
  pushMessage,
  spotById,
} from "./state.js";

const DEG = Math.PI / 180;
const catById = Object.fromEntries(CATAPULTS.map((cat) => [cat.id, cat]));
const elevatorById = Object.fromEntries(ELEVATORS.map((item) => [item.id, item]));

export function setAircraftState(aircraft, next, duration = 0) {
  aircraft.state = next;
  aircraft.stateT = 0;
  aircraft.stateDur = duration;
  aircraft.stateTotal = duration;
}

export function isAirborne(aircraft) {
  return aircraft.state === "airborne" || aircraft.state === "inbound" || aircraft.state === "holding";
}

export function isDeckBound(aircraft) {
  return !["airborne", "inbound", "holding", "lost", "destroyed"].includes(aircraft.state);
}

function catAvailable(state, catId) {
  const cat = state.cats[catId];
  if (!cat.online || cat.state !== "idle" || cat.cooldown > 0) return false;
  if (!state.systems[catId]?.online) return false;
  if (WAIST_CATS.includes(catId) && state.recovery.active) return false;
  return true;
}

function pickCat(state, aircraft) {
  const type = AIRCRAFT_TYPES[aircraft.type];
  for (const catId of type.catPreference) {
    if (catAvailable(state, catId)) return catId;
  }
  return null;
}

function catStart(catId) {
  const cat = catById[catId];
  return cat ? { x: cat.start[0], z: cat.start[1] } : { x: 0, z: 0 };
}

function catEnd(catId) {
  const cat = catById[catId];
  return cat ? { x: cat.end[0], z: cat.end[1] } : { x: 0, z: 0 };
}

function headingFromVector(dx, dz) {
  return Math.atan2(-dx, -dz);
}

function taxiDuration(from, to) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  return clamp(Math.round(distance / DECK_TIMING.taxiSpeed), DECK_TIMING.taxiMin, DECK_TIMING.taxiMax);
}

function freeDeckSpotFor(state, aircraft) {
  const spot = freeSpot(state);
  if (!spot) return null;
  spot.aircraftId = aircraft.id;
  aircraft.spotId = spot.id;
  return spot;
}

/** 把飞机放回自己的机位 / 机库 */
function releaseParking(state, aircraft) {
  if (aircraft.spotId) {
    const spot = spotById(state, aircraft.spotId);
    if (spot && spot.aircraftId === aircraft.id) spot.aircraftId = null;
    aircraft.spotId = null;
  }
  if (aircraft.bayId) {
    const bay = state.hangarBays.find((item) => item.id === aircraft.bayId);
    if (bay && bay.aircraftId === aircraft.id) bay.aircraftId = null;
    aircraft.bayId = null;
  }
}

export function orderSortie(state, aircraftId, mission) {
  const aircraft = state.aircraft.find((item) => item.id === aircraftId);
  if (!aircraft) return { ok: false, message: "未找到该机" };
  if (aircraft.health <= 0 || aircraft.state === "lost" || aircraft.state === "destroyed") {
    return { ok: false, message: "该机已损失" };
  }
  const type = AIRCRAFT_TYPES[aircraft.type];
  const allowed = {
    fighter: ["cap", "strike"],
    aew: ["aew"],
    ew: ["ew"],
    sar: ["sar"],
  }[type.role] ?? [];
  if (!allowed.includes(mission)) return { ok: false, message: "该机型不支持此任务" };
  if (mission === "strike" && aircraft.harpoons <= 0) return { ok: false, message: "无剩余鱼叉导弹" };
  if (!["ready", "hangar"].includes(aircraft.state)) {
    return { ok: false, message: `当前状态不可出击（${aircraft.state}）` };
  }

  if (aircraft.state === "hangar") {
    const spot = freeSpot(state);
    if (!spot) return { ok: false, message: "甲板无空闲停机位" };
    const elevator = ["E1", "E2"].find(
      (id) => state.elevators[id].state === "idle" && state.elevators[id].online && state.systems[id]?.online !== false,
    );
    if (!elevator) return { ok: false, message: "没有空闲的升降机（E1/E2）" };
    const lift = state.elevators[elevator];
    lift.state = "up";
    lift.aircraftId = aircraft.id;
    lift.progress = 0;
    aircraft.launchElevator = elevator;
    setPendingSortie(aircraft, mission, spot.id);
    setAircraftState(aircraft, "elevating", 0);
    pushMessage(state, {
      channel: "DECK",
      tone: "info",
      text: `${aircraft.callsign} 从机库提升至 ${spot.id}，准备执行${MISSION[mission].label}。`,
      aircraftId: aircraft.id,
    });
    return { ok: true, message: `${aircraft.callsign} 正在提升` };
  }

  aircraft.queuedMission = mission;
  setAircraftState(aircraft, "queued", 0);
  pushMessage(state, {
    channel: "DECK",
    tone: "info",
    text: `${aircraft.callsign} 申请出击（${MISSION[mission].label}），已加入弹射队列。`,
    aircraftId: aircraft.id,
  });
  return { ok: true, message: `${aircraft.callsign} 已加入弹射队列` };
}

function setPendingSortie(aircraft, mission, spotId) {
  aircraft.pendingMission = mission;
  aircraft.pendingSpotId = spotId;
}

export function recallAircraft(state, aircraftId) {
  const aircraft = state.aircraft.find((item) => item.id === aircraftId);
  if (!aircraft || !isAirborne(aircraft)) return { ok: false, message: "该机不在空中" };
  if (aircraft.state === "inbound" || aircraft.state === "holding") {
    return { ok: true, message: "该机已在返航" };
  }
  aircraft.returnReason = "指挥官召回";
  setAircraftState(aircraft, "inbound");
  aircraft.combat = null;
  aircraft.visualTargetId = null;
  pushMessage(state, {
    channel: "DECK",
    tone: "info",
    text: `${aircraft.callsign} 收到召回指令，正在返航。`,
    aircraftId: aircraft.id,
  });
  return { ok: true, message: "召回指令已发送" };
}

/** 舰载机空中/甲板位置可视化（ship space：y 相对飞行甲板） */
export function updateAircraftVisual(state, aircraft, dt) {
  const vis = aircraft.vis;
  if (aircraft.state === "lost" || aircraft.state === "destroyed") {
    vis.visible = false;
    return;
  }

  if (aircraft.state === "hangar") {
    vis.visible = false;
    return;
  }

  if (aircraft.state === "elevating") {
    const lift = state.elevators[aircraft.launchElevator];
    const elevator = elevatorById[aircraft.launchElevator];
    const progress = lift ? lift.progress : 0;
    vis.visible = true;
    vis.x = elevator.x;
    vis.z = elevator.z;
    vis.y = lerp(-10.7, 0, progress);
    vis.yaw = (elevator.side ?? 1) > 0 ? Math.PI : 0;
    vis.phase = "elevator";
    return;
  }

  if (aircraft.state === "spotting") {
    const spot = spotById(state, aircraft.spotId);
    const elevator = elevatorById[aircraft.launchElevator];
    if (!spot) return;
    const t = aircraft.stateDur > 0 ? clamp(aircraft.stateT / aircraft.stateDur, 0, 1) : 1;
    vis.visible = true;
    vis.x = lerp(elevator.x, spot.x, Math.min(1, t * 1.6));
    vis.z = lerp(elevator.z, spot.z, Math.min(1, t * 1.6));
    vis.y = 0;
    vis.yaw = headingFromVector(spot.x - elevator.x, spot.z - elevator.z);
    vis.phase = "taxi";
    return;
  }

  if (["ready", "queued"].includes(aircraft.state)) {
    const spot = spotById(state, aircraft.spotId);
    if (!spot) return;
    vis.visible = true;
    vis.x = spot.x;
    vis.z = spot.z;
    vis.y = 0;
    vis.yaw = (spot.yaw ?? 0) * DEG;
    vis.phase = "ready";
    vis.folded = spot.id === "S3" || spot.id === "S4" ? 0 : 1;
    return;
  }

  if (aircraft.state === "taxi") {
    const from = aircraft.taxiFrom;
    const to = catStart(aircraft.launchCat);
    const t = aircraft.stateDur > 0 ? clamp(aircraft.stateT / aircraft.stateDur, 0, 1) : 1;
    const eased = t * t * (3 - 2 * t);
    vis.visible = true;
    vis.x = lerp(from.x, to.x, eased);
    vis.z = lerp(from.z, to.z, eased);
    vis.y = 0;
    vis.yaw = headingFromVector(to.x - from.x, to.z - from.z);
    vis.folded = 0;
    vis.phase = "taxi";
    return;
  }

  if (aircraft.state === "hook") {
    const start = catStart(aircraft.launchCat);
    vis.visible = true;
    vis.x = start.x;
    vis.z = start.z;
    vis.y = 0;
    vis.yaw = headingFromVector(catEnd(aircraft.launchCat).x - start.x, catEnd(aircraft.launchCat).z - start.z);
    vis.burner = aircraft.stateT > aircraft.stateDur * 0.55 ? 1 : 0;
    vis.phase = "hook";
    vis.folded = 0;
    return;
  }

  if (aircraft.state === "stroke" && !aircraft.launchCat) {
    const spot = spotById(state, aircraft.spotId) ?? aircraft.verticalFrom ?? { x: 0, z: 0 };
    const t = aircraft.stateDur > 0 ? clamp(aircraft.stateT / aircraft.stateDur, 0, 1) : 1;
    vis.visible = true;
    vis.x = spot.x;
    vis.z = spot.z;
    vis.y = t * 26;
    vis.yaw = (spot.yaw ?? 0) * DEG;
    vis.burner = 0;
    vis.gear = 1;
    vis.phase = "launch";
    return;
  }

  if (aircraft.state === "stroke") {
    const start = catStart(aircraft.launchCat);
    const end = catEnd(aircraft.launchCat);
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const t = aircraft.stateDur > 0 ? clamp(aircraft.stateT / aircraft.stateDur, 0, 1) : 1;
    const accel = t * t;
    vis.visible = true;
    vis.x = start.x + dx * accel;
    vis.z = start.z + dz * accel;
    vis.y = 0;
    vis.yaw = headingFromVector(dx, dz);
    vis.burner = 1;
    vis.gear = 1;
    vis.phase = "launch";
    return;
  }

  if (aircraft.state === "approach") {
    const frame = landingFrame();
    const t = aircraft.stateDur > 0 ? clamp(aircraft.stateT / aircraft.stateDur, 0, 1) : 1;
    const dist = lerp(-950, -10, t);
    const y = lerp(105, 1.2, t * t);
    vis.visible = true;
    vis.x = frame.touchdown.x + frame.dir.x * dist;
    vis.z = frame.touchdown.z + frame.dir.z * dist;
    vis.y = y;
    vis.yaw = frame.yaw;
    vis.pitch = -0.06;
    vis.gear = 1;
    vis.burner = 0.15;
    vis.folded = 0;
    vis.phase = "approach";
    return;
  }

  if (aircraft.state === "trap") {
    const frame = landingFrame();
    const t = aircraft.stateDur > 0 ? clamp(aircraft.stateT / aircraft.stateDur, 0, 1) : 1;
    vis.visible = true;
    vis.x = frame.touchdown.x + frame.dir.x * (10 + t * 65);
    vis.z = frame.touchdown.z + frame.dir.z * (10 + t * 65);
    vis.y = 0.9;
    vis.yaw = frame.yaw;
    vis.gear = 1;
    vis.burner = 0;
    vis.pitch = 0;
    vis.phase = "trap";
    return;
  }

  if (aircraft.state === "clear") {
    const frame = landingFrame();
    const t = aircraft.stateDur > 0 ? clamp(aircraft.stateT / aircraft.stateDur, 0, 1) : 1;
    vis.visible = true;
    vis.x = frame.touchdown.x + frame.dir.x * (70 + t * 180) + frame.side.x * t * 18;
    vis.z = frame.touchdown.z + frame.dir.z * (70 + t * 180) + frame.side.z * t * 18;
    vis.y = 0.9;
    vis.yaw = frame.yaw;
    vis.gear = 1;
    vis.burner = 0;
    vis.phase = "clear";
    return;
  }

  if (aircraft.state === "taxiIn" || aircraft.state === "service" || aircraft.state === "awaitingService") {
    const spot = spotById(state, aircraft.spotId);
    if (!spot) {
      vis.visible = false;
      return;
    }
    let px = spot.x;
    let pz = spot.z;
    if (aircraft.state === "taxiIn" && aircraft.stateDur > 0) {
      const t = clamp(aircraft.stateT / aircraft.stateDur, 0, 1);
      const eased = t * t * (3 - 2 * t);
      const from = aircraft.taxiFrom ?? spot;
      px = lerp(from.x, spot.x, eased);
      pz = lerp(from.z, spot.z, eased);
    }
    vis.visible = true;
    vis.x = px;
    vis.z = pz;
    vis.y = 0;
    vis.yaw = (spot.yaw ?? 0) * DEG;
    vis.gear = 1;
    vis.burner = 0;
    vis.folded = aircraft.state === "service" ? 1 : 0;
    vis.phase = "parked";
    return;
  }

  // 空中 / 返航 / 等待：由 airops 设置，甲板侧隐藏
  vis.visible = false;
}

const LANDING_FRAME = (() => {
  const stern = ANGLED_DECK.centerStern;
  const bow = ANGLED_DECK.centerBow;
  const dx = bow[0] - stern[0];
  const dz = bow[1] - stern[1];
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, z: dz / len };
  const side = { x: -dir.z, z: dir.x };
  return {
    touchdown: { x: stern[0] + dir.x * 62, z: stern[1] + dir.z * 62 },
    dir,
    side,
    yaw: Math.atan2(-dir.x, -dir.z),
    length: len,
  };
})();

function landingFrame() {
  return LANDING_FRAME;
}

export function updateDeckOps(state, dt) {
  updateElevators(state, dt);
  updateCats(state, dt);
  updateAircraftTimers(state, dt);
  updateLaunchQueue(state);
  updateRecovery(state, dt);
  updateServiceCrews(state);
  for (const aircraft of state.aircraft) updateAircraftVisual(state, aircraft, dt);
}

function updateElevators(state, dt) {
  for (const elevator of Object.values(state.elevators)) {
    if (elevator.state === "idle") continue;
    const aircraft = state.aircraft.find((item) => item.id === elevator.aircraftId);
    elevator.progress = clamp(elevator.progress + dt / DECK_TIMING.elevatorCycle, 0, 1);
    if (elevator.progress < 1) continue;
    if (elevator.state === "up") {
      const spot = aircraft ? spotById(state, aircraft.pendingSpotId) : null;
      if (aircraft && spot) {
        if (spot.aircraftId && spot.aircraftId !== aircraft.id) {
          // 机位被占：把飞机放回机库，避免卡死
          pushMessage(state, {
            channel: "DECK",
            tone: "warn",
            text: `${aircraft.callsign} 提升失败：停机位被占用，返回机库。`,
            aircraftId: aircraft.id,
          });
          aircraft.pendingMission = null;
          setAircraftState(aircraft, "hangar");
          aircraft.vis.visible = false;
          const bay =
            state.hangarBays.find((item) => item.id === aircraft.bayId) ??
            state.hangarBays.find((item) => !item.aircraftId);
          if (bay) {
            bay.aircraftId = aircraft.id;
            aircraft.bayId = bay.id;
          }
        } else {
          spot.aircraftId = aircraft.id;
          aircraft.spotId = spot.id;
          const bay = state.hangarBays.find((item) => item.id === aircraft.bayId);
          if (bay && bay.aircraftId === aircraft.id) bay.aircraftId = null;
          aircraft.bayId = null;
          aircraft.launchElevator = elevator.id;
          setAircraftState(aircraft, "spotting", DECK_TIMING.spotTaxi);
          pushFx(state, { type: "elevator", elevatorId: elevator.id, phase: "top" });
        }
      }
      elevator.aircraftId = null;
      elevator.state = "idle";
      elevator.progress = 0;
    }
  }
}

function updateAircraftTimers(state, dt) {
  for (const aircraft of state.aircraft) {
    if (aircraft.stateDur <= 0) continue;
    aircraft.stateT += dt;
    if (aircraft.stateT < aircraft.stateDur) continue;
    const finished = aircraft.state;

    if (finished === "spotting") {
      aircraft.launchElevator = null;
      if (aircraft.pendingMission) {
        aircraft.queuedMission = aircraft.pendingMission;
        aircraft.pendingMission = null;
        aircraft.pendingSpotId = null;
        setAircraftState(aircraft, "queued");
      } else {
        setAircraftState(aircraft, "ready");
      }
    } else if (finished === "taxi") {
      setAircraftState(aircraft, "hook", DECK_TIMING.hook);
      pushFx(state, { type: "jbd", catId: aircraft.launchCat, value: 1 });
      pushMessage(state, {
        channel: "DECK",
        tone: "info",
        text: `${aircraft.callsign} 对位 ${CAT[aircraft.launchCat].label}，挡焰板升起。`,
        aircraftId: aircraft.id,
      });
    } else if (finished === "hook") {
      setAircraftState(aircraft, "stroke", DECK_TIMING.stroke);
      pushFx(state, { type: "catapult", catId: aircraft.launchCat, aircraftId: aircraft.id });
      pushFx(state, { type: "steam", catId: aircraft.launchCat });
    } else if (finished === "stroke") {
      launchAirborne(state, aircraft);
    } else if (finished === "approach") {
      setAircraftState(aircraft, "trap", DECK_TIMING.trap);
      pushFx(state, { type: "trap", aircraftId: aircraft.id });
      pushFx(state, { type: "steam", x: aircraft.vis.x, z: aircraft.vis.z, kind: "trap" });
    } else if (finished === "trap") {
      state.stats.traps += 1;
      setAircraftState(aircraft, "clear", DECK_TIMING.clear);
      pushMessage(state, {
        channel: "DECK",
        tone: "good",
        text: `${aircraft.callsign} 拦阻成功，脱离着舰区。`,
        aircraftId: aircraft.id,
      });
    } else if (finished === "clear") {
      state.recovery.active = null;
      const frame = landingFrame();
      aircraft.taxiFrom = {
        x: frame.touchdown.x + frame.dir.x * 250 + frame.side.x * 18,
        z: frame.touchdown.z + frame.dir.z * 250 + frame.side.z * 18,
      };
      const spot = freeSpot(state);
      if (spot) {
        spot.aircraftId = aircraft.id;
        aircraft.spotId = spot.id;
        setAircraftState(aircraft, "taxiIn", DECK_TIMING.taxiIn);
      } else {
        const bay = state.hangarBays.find((item) => !item.aircraftId);
        if (bay) {
          bay.aircraftId = aircraft.id;
          aircraft.bayId = bay.id;
          aircraft.spotId = null;
          aircraft.fuel = aircraft.endurance;
          aircraft.harpoons = AIRCRAFT_TYPES[aircraft.type].harpoons;
          aircraft.mission = null;
          aircraft.missionT = 0;
          aircraft.combat = null;
          setAircraftState(aircraft, "hangar");
          pushMessage(state, {
            channel: "DECK",
            tone: "warn",
            text: `${aircraft.callsign} 着舰后甲板已满，直接转入机库。`,
            aircraftId: aircraft.id,
          });
        } else {
          setAircraftState(aircraft, "taxiIn", DECK_TIMING.taxiIn);
          pushFx(state, { type: "warn", aircraftId: aircraft.id });
        }
      }
    } else if (finished === "taxiIn") {
      aircraft.recoveredAt = state.time;
      aircraft.mission = null;
      aircraft.missionT = 0;
      aircraft.targetContactId = null;
      aircraft.combat = null;
      aircraft.station = null;
      aircraft.visualTargetId = null;
      aircraft.fuel = aircraft.endurance;
      aircraft.harpoons = AIRCRAFT_TYPES[aircraft.type].harpoons;
      const crew = freeServiceCrew(state);
      if (crew) {
        crew.aircraftId = aircraft.id;
        aircraft.serviceCrew = crew.id;
        setAircraftState(aircraft, "service", AIRCRAFT_TYPES[aircraft.type].serviceTime);
      } else {
        setAircraftState(aircraft, "awaitingService");
      }
    } else if (finished === "service") {
      const crew = state.serviceCrews.find((item) => item.id === aircraft.serviceCrew);
      if (crew) crew.aircraftId = null;
      aircraft.serviceCrew = null;
      setAircraftState(aircraft, "ready");
      pushMessage(state, {
        channel: "DECK",
        tone: "info",
        text: `${aircraft.callsign} 补给完成，重新处于待命状态。`,
        aircraftId: aircraft.id,
      });
    }
  }
}

function launchAirborne(state, aircraft) {
  const cat = aircraft.launchCat;
  const crew = state.launchCrews.find((item) => item.id === aircraft.launchCrew);
  if (crew) crew.aircraftId = null;
  aircraft.launchCrew = null;
  if (cat) {
    state.cats[cat].state = "cooldown";
    state.cats[cat].cooldown = DECK_TIMING.catCooldown;
    state.cats[cat].aircraftId = null;
    pushFx(state, { type: "jbd", catId: cat, value: 0 });
  }
  pushFx(state, {
    type: "airborne",
    aircraftId: aircraft.id,
    catId: cat,
    from: aircraft.verticalFrom ? { ...aircraft.verticalFrom } : null,
  });
  aircraft.launchCat = null;
  aircraft.launchedAt = state.time;
  aircraft.sorties += 1;
  aircraft.fuel = aircraft.endurance;
  aircraft.flightPos = { ...state.own.pos };
  aircraft.altitude = 0.2;
  aircraft.returnReason = null;
  aircraft.mission = aircraft.queuedMission ?? aircraft.mission;
  aircraft.queuedMission = null;
  aircraft.missionT = 0;
  aircraft.combat = null;
  aircraft.visualTargetId = null;
  aircraft.station = null;
  aircraft.orbitAngle = 0;
  aircraft.rescueT = 0;
  aircraft.targetContactId = null;
  aircraft.vis.visible = false;
  aircraft.vis.burner = 0;
  setAircraftState(aircraft, "airborne");
  state.stats.launched += 1;
  pushMessage(state, {
    channel: "DECK",
    tone: "good",
    text: `${aircraft.callsign} 弹射升空，任务：${MISSION[aircraft.mission]?.label ?? "待定"}。`,
    aircraftId: aircraft.id,
  });
}

function updateCats(state, dt) {
  for (const cat of Object.values(state.cats)) {
    if (cat.cooldown > 0) {
      cat.cooldown = Math.max(0, cat.cooldown - dt);
      if (cat.cooldown === 0) cat.state = "idle";
    }
  }
}

function updateLaunchQueue(state) {
  const queued = state.aircraft.filter((aircraft) => aircraft.state === "queued");
  for (const aircraft of queued) {
    if (!aircraft.queuedMission && aircraft.health > 0) {
      setAircraftState(aircraft, "ready");
      continue;
    }
    const isHelo = AIRCRAFT_TYPES[aircraft.type].launch === "vertical";
    const crew = freeLaunchCrew(state);
    if (!crew) break;
    if (!isHelo) {
      const cat = pickCat(state, aircraft);
      if (!cat) continue;
      startTaxi(state, aircraft, cat, crew);
    } else {
      startVerticalLaunch(state, aircraft, crew);
    }
  }
}

function startTaxi(state, aircraft, catId, crew) {
  const spot = spotById(state, aircraft.spotId);
  const from = spot ? { x: spot.x, z: spot.z } : catStart(catId);
  aircraft.taxiFrom = from;
  aircraft.launchCat = catId;
  aircraft.launchCrew = crew.id;
  crew.aircraftId = aircraft.id;
  state.cats[catId].state = "occupied";
  state.cats[catId].aircraftId = aircraft.id;
  releaseParking(state, aircraft);
  setAircraftState(aircraft, "taxi", taxiDuration(from, catStart(catId)));
  aircraft.vis.folded = 0;
}

function startVerticalLaunch(state, aircraft, crew) {
  aircraft.launchCrew = crew.id;
  crew.aircraftId = aircraft.id;
  const spot = spotById(state, aircraft.spotId);
  aircraft.verticalFrom = spot ? { x: spot.x, z: spot.z, yaw: spot.yaw ?? 0 } : { x: 0, z: 0, yaw: 0 };
  releaseParking(state, aircraft);
  aircraft.launchCat = null;
  setAircraftState(aircraft, "stroke", 7);
  aircraft.vis.burner = 0;
  pushFx(state, { type: "helicopter", aircraftId: aircraft.id });
}

function updateRecovery(state, dt) {
  const activeId = state.recovery.active;
  if (activeId) {
    const aircraft = state.aircraft.find((item) => item.id === activeId);
    if (!aircraft || aircraft.health <= 0 || aircraft.state === "lost") {
      state.recovery.active = null;
      state.recovery.queue = (state.recovery.queue ?? []).filter((id) => id !== activeId);
    }
    return;
  }
  const queue = state.recovery.queue ?? [];
  const eligible = queue.filter((id) => {
    const aircraft = state.aircraft.find((item) => item.id === id);
    return aircraft && aircraft.state === "holding";
  });
  state.recovery.queue = eligible;
  if (!eligible.length) return;
  const aircraft = state.aircraft.find((item) => item.id === eligible[0]);
  state.recovery.queue.shift();
  state.recovery.active = aircraft.id;
  setAircraftState(aircraft, "approach", DECK_TIMING.approach);
  pushMessage(state, {
    channel: "DECK",
    tone: "info",
    text: `${aircraft.callsign} 进入着舰航线，腰部弹射器暂停作业。`,
    aircraftId: aircraft.id,
  });
}

function updateServiceCrews(state) {
  for (const aircraft of state.aircraft) {
    if (aircraft.state !== "awaitingService") continue;
    const crew = freeServiceCrew(state);
    if (!crew) continue;
    crew.aircraftId = aircraft.id;
    aircraft.serviceCrew = crew.id;
    setAircraftState(aircraft, "service", AIRCRAFT_TYPES[aircraft.type].serviceTime);
  }
}

/** 返航/等待的着陆排队入口（由 airops 在进入 12 km 时调用） */
export function requestRecovery(state, aircraft) {
  if (!state.recovery.queue) state.recovery.queue = [];
  if (state.recovery.active === aircraft.id) return;
  if (state.recovery.queue.includes(aircraft.id)) return;
  state.recovery.queue.push(aircraft.id);
  setAircraftState(aircraft, "holding");
  pushMessage(state, {
    channel: "DECK",
    tone: "info",
    text: `${aircraft.callsign} 到达等待空域，加入着舰排队。`,
    aircraftId: aircraft.id,
  });
}

export function recoveryBlockingWaist(state) {
  return Boolean(state.recovery.active);
}

export function deckSituation(state) {
  const ready = state.aircraft.filter((aircraft) => aircraft.state === "ready").length;
  const queued = state.aircraft.filter((aircraft) => aircraft.state === "queued").length;
  const airborne = state.aircraft.filter((aircraft) => isAirborne(aircraft)).length;
  const servicing = state.aircraft.filter((aircraft) =>
    ["service", "awaitingService"].includes(aircraft.state),
  ).length;
  return { ready, queued, airborne, servicing };
}
