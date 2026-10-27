/**
 * 空中作战：舰载机任务、敌机行动、空战、对海打击、搜救。
 */

import { AIRCRAFT_TYPES, MISSION } from "./constants.js";
import {
  bearingBetween,
  rangeBetween,
  destination,
  clamp,
} from "./geo.js";
import {
  airborneAircraft,
  pushMessage,
  trackForContact,
} from "./state.js";
import {
  destroyContact,
  moveContact,
  nearestContact,
  setContactCourse,
  spawnMissile,
} from "./contacts.js";
import { requestRecovery } from "./deckops.js";
import { AIRCRAFT_STATE_LABEL } from "./constants.js";

const ORBIT_RADIUS = 3.2;
const RETURN_SPEED_MULT = 2.6;

export function updateOwnShip(state, dt) {
  if (state.own.hull <= 0) return;
  const rad = (state.own.heading * Math.PI) / 180;
  state.own.pos.x += Math.sin(rad) * state.own.speed * dt;
  state.own.pos.y += Math.cos(rad) * state.own.speed * dt;
}

export function updateCapabilities(state) {
  const aew = airborneAircraft(state, "aew");
  const ew = airborneAircraft(state, "ew");
  state.capabilities.aewCount = aew.length;
  state.capabilities.ewCount = ew.length;
  state.capabilities.aew = aew.length > 0;
  state.capabilities.ew = ew.length > 0;
  state.capabilities.jam = Boolean(state.jam && ew.length > 0);
  state.capabilities.radar = state.emcon === "active" && state.systems.radar.online;
}

function missionStation(state, aircraft) {
  if (aircraft.station) return aircraft.station;
  const threat = state.tracks
    .filter((track) => track.status === "active" && track.threat >= 40)
    .sort((a, b) => b.threat - a.threat)[0];
  let bearing = 45;
  if (aircraft.mission === "aew") bearing = 150;
  else if (aircraft.mission === "ew") bearing = 210;
  else if (threat) bearing = threat.bearing;
  const range = MISSION[aircraft.mission]?.stationRange ?? 60;
  aircraft.station = destination(state.own.pos, bearing, range);
  return aircraft.station;
}

function returnTime(aircraft, state) {
  const distance = rangeBetween(aircraft.flightPos, state.own.pos);
  return distance / Math.max(0.05, AIRCRAFT_TYPES[aircraft.type].speed * RETURN_SPEED_MULT);
}

function startInbound(state, aircraft, reason) {
  if (aircraft.state !== "airborne") return;
  aircraft.returnReason = reason;
  aircraft.state = "inbound";
  aircraft.stateT = 0;
  aircraft.combat = null;
  aircraft.visualTargetId = null;
  pushMessage(state, {
    channel: "DECK",
    tone: "info",
    text: `${aircraft.callsign} 任务结束，返航（${reason}）。`,
    aircraftId: aircraft.id,
  });
}

function moveToward(aircraft, waypoint, dt, speed) {
  const dx = waypoint.x - aircraft.flightPos.x;
  const dy = waypoint.y - aircraft.flightPos.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.2) return distance;
  const step = Math.min(distance, speed * dt);
  aircraft.flightPos.x += (dx / distance) * step;
  aircraft.flightPos.y += (dy / distance) * step;
  return distance - step;
}

function orbitAt(aircraft, station, dt, speed) {
  const radius = ORBIT_RADIUS;
  aircraft.orbitAngle = (aircraft.orbitAngle + (speed / radius) * dt) % (Math.PI * 2);
  aircraft.flightPos.x = station.x + Math.cos(aircraft.orbitAngle) * radius;
  aircraft.flightPos.y = station.y + Math.sin(aircraft.orbitAngle) * radius;
}

function findFriendlyCapTarget(state, aircraft) {
  const type = AIRCRAFT_TYPES[aircraft.type];
  const reach = type.capRange ?? 90;
  const candidates = state.contacts.filter((contact) => {
    if (!contact.alive) return false;
    if (!["fighter", "strike"].includes(contact.kind)) return false;
    if (rangeBetween(aircraft.flightPos, contact.pos) > reach) return false;
    const track = trackForContact(state, contact.id);
    if (!track) return false;
    if (track.classified === "hostile" || track.classified === "assumed-hostile") return true;
    if (state.roe === "free" && track.classified === "unknown") return true;
    return false;
  });
  if (!candidates.length) return null;
  return candidates.sort(
    (a, b) => rangeBetween(aircraft.flightPos, a.pos) - rangeBetween(aircraft.flightPos, b.pos),
  )[0];
}

function updateFriendlyAircraft(state, dt) {
  for (const aircraft of state.aircraft) {
    if (!["airborne", "inbound", "holding"].includes(aircraft.state)) continue;
    if (aircraft.health <= 0) continue;

    aircraft.fuel = Math.max(0, aircraft.fuel - dt);
    if (aircraft.fuel <= 0) {
      destroyAircraft(state, aircraft, "燃油耗尽");
      continue;
    }

    if (aircraft.state === "holding") {
      aircraft.altitude = 0.6;
      if (aircraft.fuel <= 45) {
        // 等待降落时燃油告急：优先插队
        const queue = state.recovery.queue ?? [];
        const index = queue.indexOf(aircraft.id);
        if (index > 0) {
          queue.splice(index, 1);
          queue.unshift(aircraft.id);
        }
      }
      continue;
    }

    if (aircraft.state === "inbound") {
      const range = rangeBetween(aircraft.flightPos, state.own.pos);
      if (range > 12) {
        const speed = AIRCRAFT_TYPES[aircraft.type].speed * RETURN_SPEED_MULT;
        moveToward(aircraft, state.own.pos, dt, speed);
        aircraft.altitude = 0.8;
      }
      if (rangeBetween(aircraft.flightPos, state.own.pos) <= 12) {
        requestRecovery(state, aircraft);
      }
      continue;
    }

    aircraft.missionT += dt;
    const type = AIRCRAFT_TYPES[aircraft.type];
    const bingoT = returnTime(aircraft, state) + 45;
    if (aircraft.fuel <= bingoT && aircraft.state === "airborne") {
      startInbound(state, aircraft, "燃油余量触发返航");
      continue;
    }

    if (aircraft.mission === "cap") {
      updateCap(state, aircraft, dt);
    } else if (aircraft.mission === "aew" || aircraft.mission === "ew") {
      updateSupport(state, aircraft, dt);
    } else if (aircraft.mission === "strike") {
      updateStrike(state, aircraft, dt);
    } else if (aircraft.mission === "sar") {
      updateSar(state, aircraft, dt);
    } else {
      const station = missionStation(state, aircraft);
      if (rangeBetween(aircraft.flightPos, station) > ORBIT_RADIUS + 0.5) {
        moveToward(aircraft, station, dt, type.speed);
      } else {
        orbitAt(aircraft, station, dt, type.speed * 0.35);
      }
    }
    aircraft.altitude = aircraft.role === "aew" ? 9 : aircraft.role === "ew" ? 8 : 7;
  }

  // 空战结算
  resolveAirCombat(state, dt);
  resolveEnemyAirCombat(state, dt);
}

function updateCap(state, aircraft, dt) {
  const type = AIRCRAFT_TYPES[aircraft.type];
  const targetContact = aircraft.combat
    ? state.contacts.find((contact) => contact.id === aircraft.combat.contactId && contact.alive)
    : null;

  if (targetContact) {
    const range = rangeBetween(aircraft.flightPos, targetContact.pos);
    const reach = (type.capRange ?? 95) + 15;
    if (range > reach) {
      aircraft.combat = null;
    } else {
      moveToward(aircraft, targetContact.pos, dt, type.speed);
      aircraft.combat.timer -= dt;
      if (aircraft.combat.timer <= 0) {
        resolveCapAttack(state, aircraft, targetContact);
      }
      return;
    }
  }

  // 目视识别任务：抵近未识别目标
  if (aircraft.visualTargetId) {
    const visualContact = state.contacts.find((contact) => contact.id === aircraft.visualTargetId && contact.alive);
    if (visualContact) {
      const range = rangeBetween(aircraft.flightPos, visualContact.pos);
      if (range > 40) {
        aircraft.visualTargetId = null;
      } else {
        moveToward(aircraft, visualContact.pos, dt, type.speed);
        return;
      }
    } else {
      aircraft.visualTargetId = null;
    }
  }

  const target = findFriendlyCapTarget(state, aircraft);
  if (target) {
    aircraft.combat = { contactId: target.id, timer: 8.5, rounds: 0 };
    pushMessage(state, {
      channel: "CIC",
      tone: "warn",
      text: `${aircraft.callsign} 进入拦截航向，目标 ${target.name}。`,
      aircraftId: aircraft.id,
    });
    moveToward(aircraft, target.pos, dt, type.speed);
    return;
  }

  // 无交战目标时，对 35 km 内的未识别空中目标执行目视识别
  const unknown = state.contacts.find((contact) => {
    if (!contact.alive || !["fighter", "strike", "airliner"].includes(contact.kind)) return false;
    const track = trackForContact(state, contact.id);
    return (
      track &&
      !track.identified &&
      track.status === "active" &&
      rangeBetween(aircraft.flightPos, contact.pos) <= 35
    );
  });
  if (unknown) {
    aircraft.visualTargetId = unknown.id;
    moveToward(aircraft, unknown.pos, dt, type.speed);
    return;
  }

  const station = missionStation(state, aircraft);
  if (rangeBetween(aircraft.flightPos, station) > ORBIT_RADIUS + 0.5) {
    moveToward(aircraft, station, dt, type.speed);
  } else {
    orbitAt(aircraft, station, dt, type.speed * 0.4);
  }
}

function resolveCapAttack(state, aircraft, contact) {
  const track = trackForContact(state, contact.id);
  const type = AIRCRAFT_TYPES[aircraft.type];
  let pk = type.capPk;
  if (state.capabilities.aew) pk += 0.06;
  if (contact.kind === "strike") pk += 0.08;
  if (contact.kind === "fighter") pk -= 0.04;
  if (track && track.quality > 0.75) pk += 0.04;
  pk = clamp(pk, 0.1, 0.92);
  aircraft.combat.rounds += 1;

  if (state.rng.chance(pk)) {
    destroyContact(state, contact, "intercept", aircraft.callsign);
    aircraft.kills += 1;
    aircraft.combat = null;
    return;
  }

  pushMessage(state, {
    channel: "CIC",
    tone: "info",
    text: `${aircraft.callsign} 首轮攻击未果，继续缠斗（${contact.name}）。`,
    aircraftId: aircraft.id,
  });
  aircraft.combat.timer = 10;
  // 敌机反击
  if (state.rng.chance(contact.kind === "fighter" ? 0.09 : 0.05)) {
    destroyAircraft(state, aircraft, `被 ${contact.name} 击落`);
  }
}

function updateSupport(state, aircraft, dt) {
  const type = AIRCRAFT_TYPES[aircraft.type];
  const station = missionStation(state, aircraft);
  const range = rangeBetween(aircraft.flightPos, station);
  if (range > ORBIT_RADIUS + 0.5) {
    moveToward(aircraft, station, dt, type.speed);
  } else {
    orbitAt(aircraft, station, dt, type.speed * 0.35);
  }

  // 支援机遭到逼近时向航母方向规避
  const threat = nearestContact(
    state,
    aircraft.flightPos,
    32,
    (contact) => ["fighter", "strike"].includes(contact.kind),
  );
  if (threat) {
    moveToward(aircraft, state.own.pos, dt, type.speed * 1.4);
  }
}

function updateStrike(state, aircraft, dt) {
  const type = AIRCRAFT_TYPES[aircraft.type];
  let target = aircraft.targetContactId
    ? state.contacts.find((contact) => contact.id === aircraft.targetContactId && contact.alive)
    : null;
  if (!target) {
    const candidate = state.contacts
      .filter((contact) => contact.alive && contact.kind === "destroyer")
      .sort(
        (a, b) => rangeBetween(aircraft.flightPos, a.pos) - rangeBetween(aircraft.flightPos, b.pos),
      )[0];
    target = candidate ?? null;
    aircraft.targetContactId = target?.id ?? null;
  }
  if (!target) {
    startInbound(state, aircraft, "对海目标消失");
    return;
  }

  const range = rangeBetween(aircraft.flightPos, target.pos);
  if (range > 100) {
    moveToward(aircraft, target.pos, dt, type.speed);
    aircraft.altitude = 6;
    return;
  }

  if (aircraft.harpoons > 0) {
    const track = trackForContact(state, target.id);
    const quality = track?.quality ?? 0.5;
    const count = aircraft.harpoons;
    aircraft.harpoons = 0;
    for (let i = 0; i < count; i += 1) {
      state.attackMissiles.push({
        id: `HAR-${state.attackMissiles.length + 1}-${Math.round(state.time)}`,
        pos: {
          x: aircraft.flightPos.x + state.rng.range(-0.4, 0.4),
          y: aircraft.flightPos.y + state.rng.range(-0.4, 0.4),
        },
        targetId: target.id,
        speed: 0.82,
        quality,
        firedAt: state.time,
      });
      state.stats.harpoonsFired += 1;
    }
    pushMessage(state, {
      channel: "WEAPONS",
      tone: "good",
      text: `${aircraft.callsign} 发射 ${count} 枚鱼叉反舰导弹，目标 ${target.name}。`,
      aircraftId: aircraft.id,
    });
    startInbound(state, aircraft, "对海打击完成");
    return;
  }
  startInbound(state, aircraft, "弹药耗尽");
}

function updateSar(state, aircraft, dt) {
  const type = AIRCRAFT_TYPES[aircraft.type];
  const marker = state.rescueMarkers
    ?.filter((item) => !item.rescued)
    .sort(
      (a, b) => rangeBetween(aircraft.flightPos, a.pos) - rangeBetween(aircraft.flightPos, b.pos),
    )[0];
  if (!marker) {
    const station = aircraft.station ?? destination(state.own.pos, 180, 30);
    aircraft.station = station;
    if (rangeBetween(aircraft.flightPos, station) > ORBIT_RADIUS) moveToward(aircraft, station, dt, type.speed);
    else orbitAt(aircraft, station, dt, type.speed * 0.4);
    return;
  }
  const range = rangeBetween(aircraft.flightPos, marker.pos);
  if (range > 0.8) {
    moveToward(aircraft, marker.pos, dt, type.speed * 1.8);
    aircraft.altitude = 0.4;
    return;
  }
  aircraft.rescueT = (aircraft.rescueT ?? 0) + dt;
  aircraft.altitude = 0.2;
  if (aircraft.rescueT >= 18) {
    marker.rescued = true;
    state.score += 60;
    pushMessage(state, {
      channel: "CIC",
      tone: "good",
      text: `${aircraft.callsign} 完成搜救，救起 ${marker.crew} 名机组人员。`,
      aircraftId: aircraft.id,
    });
    startInbound(state, aircraft, "搜救完成");
  }
}

function resolveAirCombat(state, dt) {
  // 敌机对未受保护的支援机 / 巡逻机发起攻击
  for (const contact of state.contacts) {
    if (!contact.alive || contact.kind !== "fighter") continue;
    if (contact.ai.engagedBy) continue;
    const target = state.aircraft
      .filter((aircraft) => aircraft.state === "airborne" && aircraft.health > 0)
      .map((aircraft) => ({ aircraft, range: rangeBetween(aircraft.flightPos, contact.pos) }))
      .filter((item) => item.range <= 55)
      .sort((a, b) => a.range - b.range)[0];
    if (!target) continue;
    contact.ai.engagedBy = target.aircraft.id;
    contact.ai.engageT = 8;
  }

  for (const contact of state.contacts) {
    if (!contact.alive || !contact.ai.engagedBy) continue;
    const aircraft = state.aircraft.find((item) => item.id === contact.ai.engagedBy);
    if (!aircraft || aircraft.state !== "airborne" || aircraft.health <= 0) {
      contact.ai.engagedBy = null;
      continue;
    }
    contact.ai.engageT -= dt;
    if (contact.ai.engageT > 0) continue;
    contact.ai.engageT = 10;
    const pk = contact.kind === "fighter" ? 0.07 : 0.04;
    if (state.rng.chance(pk)) {
      destroyAircraft(state, aircraft, `被 ${contact.name} 击落`);
      contact.ai.engagedBy = null;
    }
  }
}

function resolveEnemyAirCombat() {
  // 预留：敌方空战细节已由 resolveAirCombat 与 CAP 攻击覆盖
}

export function updateEnemyAir(state, dt) {
  for (const contact of state.contacts) {
    if (!contact.alive) continue;
    if (contact.kind === "destroyer") {
      const bearing = bearingBetween(contact.pos, state.own.pos);
      setContactCourse(contact, bearing, contact.speed);
      moveContact(contact, dt);
      updateSurfaceSalvo(state, contact);
      continue;
    }
    if (contact.kind === "fishing" || contact.kind === "airliner") {
      moveContact(contact, dt);
      continue;
    }
    if (contact.kind === "asm") continue;

    if (!["fighter", "strike"].includes(contact.kind)) continue;
    const range = rangeBetween(contact.pos, state.own.pos);

    if (contact.kind === "strike" && !contact.ai.launched) {
      const launchRange = state.emcon === "active" ? 95 : 64;
      const bearing = bearingBetween(contact.pos, state.own.pos);
      setContactCourse(contact, bearing, contact.speed);
      moveContact(contact, dt);
      if (range <= launchRange) {
        launchStrikeMissiles(state, contact);
      }
      continue;
    }

    if (contact.kind === "strike" && contact.ai.launched) {
      // 发射后转向脱离
      const away = (bearingBetween(state.own.pos, contact.pos) + 180) % 360;
      setContactCourse(contact, away, contact.speed);
      moveContact(contact, dt);
      continue;
    }

    // 护航战斗机：向最近的友军空中目标或航母接近
    const friendly = state.aircraft
      .filter((aircraft) => aircraft.state === "airborne" && aircraft.health > 0)
      .map((aircraft) => ({ aircraft, range: rangeBetween(aircraft.flightPos, contact.pos) }))
      .sort((a, b) => a.range - b.range)[0];
    const targetPos = friendly ? friendly.aircraft.flightPos : state.own.pos;
    const bearing = bearingBetween(contact.pos, targetPos);
    setContactCourse(contact, bearing, contact.speed);
    moveContact(contact, dt);
  }

  updateAttackMissiles(state, dt);
}

function updateSurfaceSalvo(state, contact) {
  if (!contact.salvo) return;
  for (const entry of contact.salvo) {
    if (entry.fired || state.time < entry.t) continue;
    const range = rangeBetween(contact.pos, state.own.pos);
    if (range > 190) continue;
    entry.fired = true;
    const count = Math.max(1, entry.count);
    for (let i = 0; i < count; i += 1) {
      const spread = (i - (count - 1) / 2) * 2.4;
      spawnMissile(state, {
        origin: { ...contact.pos },
        bearing: bearingBetween(contact.pos, state.own.pos) + spread,
        source: contact.name,
        count,
        targetId: "CV-63",
      });
    }
    pushMessage(state, {
      channel: "WEAPONS",
      tone: "alert",
      text: `反舰导弹发射：${contact.name}，${count} 枚，方位 ${Math.round(bearingBetween(state.own.pos, contact.pos))}。`,
    });
  }
}

function launchStrikeMissiles(state, contact) {
  contact.ai.launched = true;
  contact.ai.launchedAt = state.time;
  const count = 1;
  for (let i = 0; i < count; i += 1) {
    spawnMissile(state, {
      origin: { ...contact.pos },
      bearing: bearingBetween(contact.pos, state.own.pos) + (i - 0.5) * 4,
      source: contact.name,
      count,
      targetId: "CV-63",
    });
  }
  pushMessage(state, {
    channel: "WEAPONS",
    tone: "alert",
    text: `空中平台发射反舰导弹：${contact.name}，1 枚，方位 ${Math.round(bearingBetween(state.own.pos, contact.pos))}。`,
  });
}

function updateAttackMissiles(state, dt) {
  for (let i = state.attackMissiles.length - 1; i >= 0; i -= 1) {
    const missile = state.attackMissiles[i];
    const target = state.contacts.find((contact) => contact.id === missile.targetId && contact.alive);
    if (!target) {
      state.attackMissiles.splice(i, 1);
      continue;
    }
    const dx = target.pos.x - missile.pos.x;
    const dy = target.pos.y - missile.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.7) {
      const step = Math.min(distance, missile.speed * dt);
      missile.pos.x += (dx / distance) * step;
      missile.pos.y += (dy / distance) * step;
      continue;
    }
    const pk = 0.68 + (missile.quality > 0.75 ? 0.07 : 0);
    if (state.rng.chance(pk)) {
      target.hp -= 1;
      state.stats.harpoonHits += 1;
      if (target.hp <= 0) {
        destroyContact(state, target, "strike", "鱼叉");
      } else {
        pushMessage(state, {
          channel: "WEAPONS",
          tone: "warn",
          text: `鱼叉命中 ${target.name}，目标仍在活动（结构受损）。`,
        });
        target.speed *= 0.65;
      }
    } else {
      pushMessage(state, {
        channel: "WEAPONS",
        tone: "info",
        text: `鱼叉未命中 ${target.name}。`,
      });
    }
    state.attackMissiles.splice(i, 1);
  }
}

export function destroyAircraft(state, aircraft, reason, options = {}) {
  if (aircraft.health <= 0) return;
  aircraft.health = 0;
  aircraft.state = "lost";
  aircraft.stateT = 0;
  aircraft.stateDur = 0;
  aircraft.vis.visible = false;
  aircraft.lostReason = reason;
  state.stats.aircraftLost += 1;
  state.score -= 55;
  if (aircraft.spotId) {
    const spot = state.spots.find((item) => item.id === aircraft.spotId);
    if (spot && spot.aircraftId === aircraft.id) spot.aircraftId = null;
    aircraft.spotId = null;
  }
  if (aircraft.bayId) {
    const bay = state.hangarBays.find((item) => item.id === aircraft.bayId);
    if (bay && bay.aircraftId === aircraft.id) bay.aircraftId = null;
    aircraft.bayId = null;
  }
  if (aircraft.launchElevator) {
    const lift = state.elevators[aircraft.launchElevator];
    if (lift && lift.aircraftId === aircraft.id) {
      lift.state = "idle";
      lift.aircraftId = null;
      lift.progress = 0;
    }
    aircraft.launchElevator = null;
  }
  if (aircraft.launchCrew) {
    const crew = state.launchCrews.find((item) => item.id === aircraft.launchCrew);
    if (crew) crew.aircraftId = null;
    aircraft.launchCrew = null;
  }
  if (aircraft.serviceCrew) {
    const crew = state.serviceCrews.find((item) => item.id === aircraft.serviceCrew);
    if (crew) crew.aircraftId = null;
    aircraft.serviceCrew = null;
  }
  if (aircraft.launchCat) {
    const cat = state.cats[aircraft.launchCat];
    if (cat) {
      cat.state = "idle";
      cat.aircraftId = null;
    }
    aircraft.launchCat = null;
  }
  if (state.recovery.active === aircraft.id) state.recovery.active = null;

  pushMessage(state, {
    channel: "DECK",
    tone: "alert",
    text: `${aircraft.callsign} 损失：${reason}。`,
    aircraftId: aircraft.id,
  });

  if (options.rescue !== false && aircraft.role !== "sar" && rangeBetween(aircraft.flightPos, state.own.pos) < 260) {
    state.rescueMarkers = state.rescueMarkers ?? [];
    state.rescueMarkers.push({
      id: `RES-${state.rescueMarkers.length + 1}`,
      pos: { ...aircraft.flightPos },
      crew: AIRCRAFT_TYPES[aircraft.type].crew,
      aircraftId: aircraft.id,
      createdAt: state.time,
      rescued: false,
    });
    pushMessage(state, {
      channel: "CIC",
      tone: "warn",
      text: `机组落入海面：${aircraft.callsign}，坐标已标定。可派 SH-3 搜救。`,
    });
  }
}

export function updateAirOps(state, dt) {
  updateFriendlyAircraft(state, dt);
  updateEnemyAir(state, dt);
}

export function aircraftStatusLine(aircraft) {
  if (aircraft.state === "lost") return aircraft.lostReason ?? "损失";
  if (aircraft.mission && ["airborne", "inbound"].includes(aircraft.state)) {
    return `${MISSION[aircraft.mission]?.short ?? ""} · ${AIRCRAFT_STATE_LABEL[aircraft.state]}`;
  }
  return AIRCRAFT_STATE_LABEL[aircraft.state] ?? aircraft.state;
}
