/**
 * 防空反导与损害管制。
 *
 * 武器协同规则：
 *   - 海麻雀需要 EMCON 主动（火控照射）→ 保持雷达静默时只能靠密集阵/护航舰；
 *   - 每个发射架一次只能制导一发，按装填周期排队；
 *   - 射界按舷别划分，超出扇区不能发射；
 *   - 航迹必须是非方位线、质量 ≥ 0.5、且已判定敌对。
 */

import { DEFENSE } from "./constants.js";
import { bearingBetween, rangeBetween, inArc, clamp, formatBearing, formatRange } from "./geo.js";
import {
  pushFx,
  pushMessage,
  mountById,
  trackById,
} from "./state.js";
import { destroyContact } from "./contacts.js";
import { isFireControlTrack } from "./sensors.js";
import { destroyAircraft } from "./airops.js";

function mountSystemOnline(state, mount) {
  if (!mount.online) return false;
  if (mount.kind === "escort") return mount.ammo > 0;
  return state.systems[mount.id]?.online !== false;
}

export function canEngage(state, mount, track, options = {}) {
  if (!mount || !track) return { ok: false, reason: "无效目标" };
  if (!mountSystemOnline(state, mount)) return { ok: false, reason: "武器离线" };
  if (mount.ammo <= 0) return { ok: false, reason: "弹药耗尽" };
  if (mount.cooldown > 0) return { ok: false, reason: `装填中 ${mount.cooldown.toFixed(0)}s` };
  if (track.status !== "active") return { ok: false, reason: "航迹已失效" };
  if (track.bearingOnly) return { ok: false, reason: "仅有方位线，无法火控" };
  if (track.quality < 0.5) return { ok: false, reason: "航迹质量不足" };
  if (!isFireControlTrack(track)) return { ok: false, reason: "目标未判定为敌对" };
  if (mount.guided && mount.kind !== "escort") {
    if (!state.systems.radar.online) return { ok: false, reason: "对空雷达战损，无法制导" };
    if (state.emcon !== "active") return { ok: false, reason: "EMCON 静默：火控雷达未开机" };
  }
  const contact = state.contacts.find((item) => item.id === track.contactId);
  if (!contact || !contact.alive) return { ok: false, reason: "目标已消失" };
  const range = rangeBetween(state.own.pos, contact.pos);
  if (range < mount.minRange) return { ok: false, reason: "目标进入近界" };
  if (range > mount.maxRange) return { ok: false, reason: "超出射程" };
  const bearing = bearingBetween(state.own.pos, contact.pos);
  if (!inArc(bearing, mount.arcCenter, mount.arcWidth)) return { ok: false, reason: "目标超出射界" };
  if (mount.kind === "ciws" && contact.kind !== "asm" && range > mount.maxRange) {
    return { ok: false, reason: "不在近防射程" };
  }
  if (!options.manual && mount.kind === "escort" && !mount.called) {
    return { ok: false, reason: "未呼叫护航舰" };
  }
  return { ok: true, range, bearing, contact };
}

export function assignMount(state, mountId, trackId) {
  const mount = mountById(state, mountId);
  const track = trackById(state, trackId);
  if (!mount) return { ok: false, message: "未找到武器站" };
  if (!track) return { ok: false, message: "未找到航迹" };
  if (mount.kind === "ciws") return { ok: false, message: "密集阵由自动近防系统接管" };
  if (mount.kind === "escort" && !mount.called) {
    return { ok: false, message: "请先呼叫护航舰" };
  }
  const check = canEngage(state, mount, track);
  if (!check.ok) return { ok: false, message: check.reason };
  if (mount.assigned.includes(trackId)) return { ok: true, message: "已经指派" };
  if (mount.assigned.length >= 3) return { ok: false, message: "火控通道已满（最多 3 个目标）" };
  mount.assigned.push(trackId);
  mount.cooldown = Math.max(mount.cooldown, mount.delay ?? 0);
  pushMessage(state, {
    channel: "WEAPONS",
    tone: "info",
    text: `${mount.short} 指派 ${trackId}（${formatBearing(check.bearing)} / ${formatRange(check.range)} km）。`,
    trackId,
  });
  return { ok: true, message: `${mount.short} 已指派` };
}

export function unassignMount(state, mountId, trackId = null) {
  const mount = mountById(state, mountId);
  if (!mount) return { ok: false, message: "未找到武器站" };
  if (trackId) mount.assigned = mount.assigned.filter((id) => id !== trackId);
  else mount.assigned = [];
  return { ok: true, message: `${mount.short} 已解除指派` };
}

export function callEscort(state, trackId) {
  const mount = mountById(state, "escort");
  if (!mount) return { ok: false, message: "无护航舰" };
  if (mount.ammo <= 0) return { ok: false, message: "护航舰弹药耗尽" };
  const track = trackById(state, trackId);
  if (!track) return { ok: false, message: "未找到航迹" };
  mount.called = true;
  mount.cooldown = mount.delay ?? 8;
  const result = assignMount(state, "escort", trackId);
  if (!result.ok) {
    mount.called = mount.assigned.length > 0;
  } else {
    pushMessage(state, {
      channel: "WEAPONS",
      tone: "good",
      text: `护航舰 CG-18 收到火力支援请求，SM-1 准备中（8 秒）。`,
      trackId,
    });
  }
  return result;
}

export function updateDefense(state, dt) {
  updateMounts(state, dt);
  updateMissiles(state, dt);
  updateIncidents(state, dt);
  updateChaff(state, dt);
  state.mounts.forEach((mount) => {
    mount.targetBearing = bearingOfNearestThreat(state, mount) ?? mount.bearing3d;
  });
}

function bearingOfNearestThreat(state, mount) {
  const candidates = state.tracks.filter(
    (track) => track.status === "active" && track.threat > 30 && !track.bearingOnly,
  );
  if (!candidates.length) return null;
  const own = state.own.pos;
  const sorted = candidates
    .map((track) => {
      const contact = state.contacts.find((item) => item.id === track.contactId);
      return contact && contact.alive
        ? { track, range: rangeBetween(own, contact.pos), bearing: bearingBetween(own, contact.pos) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.range - b.range);
  const target = sorted.find((item) => inArc(item.bearing, mount.arcCenter, mount.arcWidth));
  return target?.bearing ?? null;
}

function updateMounts(state, dt) {
  if (state.autoSam) autoSamAssignments(state);
  for (const mount of state.mounts) {
    if (mount.cooldown > 0) mount.cooldown = Math.max(0, mount.cooldown - dt);
    if (mount.kind === "escort" && !mount.called) continue;
    if (mount.kind === "ciws") {
      if (state.autoDefense) autoCiws(state, mount);
      continue;
    }
    // 制导武器：按指派顺序尝试开火
    for (const trackId of [...mount.assigned]) {
      const track = trackById(state, trackId);
      if (!track || track.status !== "active") {
        mount.assigned = mount.assigned.filter((id) => id !== trackId);
        continue;
      }
      const check = canEngage(state, mount, track);
      if (!check.ok) {
        if (["武器离线", "弹药耗尽"].includes(check.reason)) {
          mount.assigned = mount.assigned.filter((id) => id !== trackId);
        }
        continue;
      }
      fireMount(state, mount, track, check);
      break;
    }
  }
}

function autoSamAssignments(state) {
  const missiles = state.tracks
    .filter(
      (track) =>
        track.status === "active" &&
        track.kind === "asm" &&
        !track.bearingOnly &&
        track.quality >= 0.5,
    )
    .sort((a, b) => a.range - b.range);
  if (!missiles.length) return;
  const mounts = state.mounts.filter(
    (mount) => mount.kind !== "ciws" && mountSystemOnline(state, mount) && mount.ammo > 0,
  );
  for (const track of missiles) {
    if (mounts.some((mount) => mount.assigned.includes(track.id))) continue;
    const free = mounts
      .filter((mount) => mount.assigned.length < 2)
      .sort((a, b) => a.assigned.length - b.assigned.length || b.ammo - a.ammo)[0];
    if (!free) continue;
    const check = canEngage(state, free, track);
    if (!check.ok) continue;
    if (free.kind === "escort" && !free.called) {
      free.called = true;
      free.cooldown = free.delay ?? 6;
    }
    free.assigned.push(track.id);
    pushMessage(state, {
      channel: "WEAPONS",
      tone: "info",
      text: `自动火控：${free.short} → ${track.id}。`,
      trackId: track.id,
    });
  }
}

function autoCiws(state, mount) {
  if (mount.cooldown > 0 || mount.ammo <= 0 || !mountSystemOnline(state, mount)) return;
  const candidate = state.tracks
    .filter((track) => track.status === "active" && track.kind === "asm" && !track.bearingOnly)
    .map((track) => {
      const contact = state.contacts.find((item) => item.id === track.contactId);
      return contact && contact.alive
        ? { track, contact, range: rangeBetween(state.own.pos, contact.pos), bearing: bearingBetween(state.own.pos, contact.pos) }
        : null;
    })
    .filter((item) => item && item.range <= mount.maxRange && inArc(item.bearing, mount.arcCenter, mount.arcWidth))
    .sort((a, b) => a.range - b.range)[0];
  if (!candidate) return;
  const check = canEngage(state, mount, candidate.track);
  if (!check.ok) return;
  fireMount(state, mount, candidate.track, check);
}

function fireMount(state, mount, track, check) {
  const contact = check.contact;
  const targetKind = contact.kind;
  const isMissile = targetKind === "asm";
  let pk = isMissile ? mount.pkMissile : mount.pkAir;
  pk += track.quality >= 0.8 ? 0.08 : 0;
  pk += state.capabilities.aew ? 0.04 : 0;
  if (state.capabilities.jam) pk += 0.03;
  if (contact.ecm > 0) pk -= 0.12;
  pk = clamp(pk, 0.08, 0.94);

  const burst = mount.kind === "ciws" ? mount.burst : 1;
  mount.ammo = Math.max(0, mount.ammo - burst);
  mount.fired += 1;
  mount.lastFireAt = state.time;
  mount.cooldown = mount.cycle;
  mount.targetBearing = check.bearing;

  const flightTime = mount.kind === "ciws" ? 1.2 : Math.max(2, check.range / 0.9);
  state.engagements.push({
    id: `ENG-${mount.id}-${Math.round(state.time * 10)}`,
    mountId: mount.id,
    trackId: track.id,
    contactId: contact.id,
    resolveAt: state.time + flightTime,
    firedAt: state.time,
    pk,
    targetKind,
    bearing: check.bearing,
    range: check.range,
  });

  pushFx(state, {
    type: "weaponFire",
    mountId: mount.id,
    bearing: check.bearing,
    kind: mount.kind,
    targetKind,
  });
  if (mount.kind !== "ciws") {
    pushMessage(state, {
      channel: "WEAPONS",
      tone: isMissile ? "warn" : "info",
      text: `${mount.short} 发射：目标 ${track.id}，方位 ${formatBearing(check.bearing)}，距离 ${formatRange(check.range)} km，Pk ${(pk * 100).toFixed(0)}%。`,
      trackId: track.id,
    });
  }
}

function updateMissiles(state, dt) {
  // 拦截结算
  for (let i = state.engagements.length - 1; i >= 0; i -= 1) {
    const engagement = state.engagements[i];
    if (state.time < engagement.resolveAt) continue;
    state.engagements.splice(i, 1);
    const contact = state.contacts.find((item) => item.id === engagement.contactId);
    const mount = mountById(state, engagement.mountId);
    const track = trackById(state, engagement.trackId);
    if (!contact || !contact.alive) continue;
    if (state.rng.chance(engagement.pk)) {
      destroyContact(state, contact, "intercept", mount?.short ?? "舰载武器");
      if (mount) {
        mount.hits += 1;
        if (mount.kind !== "ciws") {
          mount.assigned = mount.assigned.filter((id) => id !== engagement.trackId);
        }
      }
      pushMessage(state, {
        channel: "WEAPONS",
        tone: "good",
        text: `${mount?.short ?? "武器"} 拦截成功：${track?.id ?? "目标"}（${engagement.targetKind === "asm" ? "反舰导弹" : "空中目标"}）。`,
        trackId: engagement.trackId,
      });
    } else {
      pushMessage(state, {
        channel: "WEAPONS",
        tone: "warn",
        text: `${mount?.short ?? "武器"} 未命中：${track?.id ?? "目标"}，继续交战。`,
        trackId: engagement.trackId,
      });
    }
  }

  // 导弹飞行 / 干扰 / 命中
  for (const contact of state.contacts) {
    if (!contact.alive || contact.kind !== "asm") continue;
    const range = rangeBetween(state.own.pos, contact.pos);
    const bearing = bearingBetween(contact.pos, state.own.pos);
    contact.course = bearing;
    const rad = (bearing * Math.PI) / 180;
    contact.vel = {
      x: Math.sin(rad) * contact.speed,
      y: Math.cos(rad) * contact.speed,
    };
    contact.pos.x += contact.vel.x * dt;
    contact.pos.y += contact.vel.y * dt;

    if (!contact.jamChecked && range < 25) {
      contact.jamChecked = true;
      const jamChance =
        (state.capabilities.ew ? 0.16 : 0) +
        (state.capabilities.jam ? 0.12 : 0) +
        (state.emcon === "silent" ? 0.14 : 0);
      if (jamChance > 0 && state.rng.chance(jamChance)) {
        destroyContact(state, contact, "intercept", "电子干扰");
        pushMessage(state, {
          channel: "WEAPONS",
          tone: "good",
          text: `电子干扰/静默奏效：一枚反舰导弹丢失目标。`,
        });
        continue;
      }
    }

    if (range <= 0.18) {
      impactMissile(state, contact);
    }
  }
}

function updateChaff(state, dt) {
  if (state.chaffCooldown > 0) state.chaffCooldown = Math.max(0, state.chaffCooldown - dt);
}

export function deployChaff(state) {
  if (state.chaff <= 0) return { ok: false, message: "箔条弹耗尽" };
  if (state.chaffCooldown > 0) return { ok: false, message: `发射器冷却 ${state.chaffCooldown.toFixed(0)}s` };
  const threat = state.contacts
    .filter((contact) => contact.alive && contact.kind === "asm")
    .map((contact) => ({ contact, range: rangeBetween(state.own.pos, contact.pos) }))
    .filter((item) => item.range <= DEFENSE.chaffRange)
    .sort((a, b) => a.range - b.range)[0];
  if (!threat) return { ok: false, message: "11 km 内没有来袭导弹" };
  state.chaff -= 1;
  state.chaffCooldown = DEFENSE.chaffCooldown;
  state.stats.chaffUsed += 1;
  pushFx(state, { type: "chaff" });
  if (state.rng.chance(DEFENSE.chaffPk)) {
    destroyContact(state, threat.contact, "intercept", "箔条诱骗");
    pushMessage(state, {
      channel: "WEAPONS",
      tone: "good",
      text: `箔条诱骗成功：一枚反舰导弹偏离目标（剩余 ${state.chaff} 发）。`,
    });
  } else {
    pushMessage(state, {
      channel: "WEAPONS",
      tone: "warn",
      text: `箔条未能诱骗来袭导弹（剩余 ${state.chaff} 发）。`,
    });
  }
  return { ok: true, message: "箔条发射" };
}

function impactMissile(state, contact) {
  contact.alive = false;
  contact.destroyedAt = state.time;
  const track = state.tracks.find((item) => item.contactId === contact.id);
  if (track) {
    track.status = "expired";
  }
  const bearing = bearingBetween(state.own.pos, contact.pos);
  const damage = Math.round(
    state.rng.range(DEFENSE.missileDamage[0], DEFENSE.missileDamage[1]) *
      (state.difficulty === "standard" ? 1 : 1.2),
  );
  state.own.hull = Math.max(0, state.own.hull - damage);
  state.stats.missilesHit += 1;
  state.stats.damageTaken += damage;
  state.score -= 40;
  const hitPoint = {
    x: Math.sin((bearing * Math.PI) / 180) * 34,
    z: -Math.cos((bearing * Math.PI) / 180) * 96,
  };
  pushFx(state, {
    type: "impact",
    x: hitPoint.x,
    z: hitPoint.z,
    bearing,
    damage,
  });
  pushMessage(state, {
    channel: "DAMAGE",
    tone: "alert",
    text: `导弹命中！方位 ${formatBearing(bearing)}，舰体损失 ${damage}，剩余 ${Math.round(state.own.hull)}。`,
  });

  if (state.rng.chance(DEFENSE.fireChance)) {
    addIncident(state, {
      type: "fire",
      label: `火灾 · ${formatBearing(bearing)} 舷`,
      duration: DEFENSE.fireDuration,
      pos: hitPoint,
    });
    state.stats.fires += 1;
  }

  if (state.rng.chance(DEFENSE.systemDamageChance)) {
    const candidates = state.systems
      ? Object.values(state.systems).filter((system) => system.online)
      : [];
    const system = candidates[state.rng.int(0, Math.max(0, candidates.length - 1))];
    if (system) {
      system.online = false;
      if (state.cats[system.id]) state.cats[system.id].online = false;
      addIncident(state, {
        type: "system",
        label: `${system.label} 受损`,
        systemId: system.id,
        duration: DEFENSE.repairDuration,
      });
      pushMessage(state, {
        channel: "DAMAGE",
        tone: "alert",
        text: `${system.label} 战损离线，损管队正在抢修。`,
      });
    }
  }

  // 甲板停放的飞机有概率被命中损毁
  if (state.rng.chance(DEFENSE.deckAircraftLossChance)) {
    const candidates = state.aircraft.filter(
      (aircraft) => !["airborne", "inbound", "holding", "lost", "destroyed", "hangar"].includes(aircraft.state),
    );
    const victim = candidates[state.rng.int(0, Math.max(0, candidates.length - 1))];
    if (victim) {
      destroyAircraft(state, victim, "甲板被导弹波及", { rescue: false });
    }
  }
}

function addIncident(state, incident) {
  state.incidentSerial = (state.incidentSerial ?? 0) + 1;
  const item = {
    id: `INC-${state.incidentSerial}`,
    t: state.time,
    progress: 0,
    teamId: null,
    ...incident,
  };
  state.incidents.push(item);
  return item;
}

function updateIncidents(state, dt) {
  for (const team of state.dcTeams) {
    if (team.incidentId) {
      const incident = state.incidents.find((item) => item.id === team.incidentId);
      if (!incident || incident.done) {
        team.incidentId = null;
        team.progress = 0;
      }
      continue;
    }
    const next = state.incidents
      .filter((incident) => !incident.done && !incident.teamId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "fire" ? -1 : 1;
        return a.t - b.t;
      })[0];
    if (next) {
      next.teamId = team.id;
      team.incidentId = next.id;
    }
  }

  for (const incident of state.incidents) {
    if (incident.done) continue;
    const team = state.dcTeams.find((item) => item.id === incident.teamId);
    if (!team) continue;
    incident.progress += dt / incident.duration;
    if (incident.progress >= 1) {
      incident.done = true;
      team.incidentId = null;
      if (incident.type === "system" && state.systems[incident.systemId]) {
        state.systems[incident.systemId].online = true;
        if (state.cats[incident.systemId]) state.cats[incident.systemId].online = true;
        pushMessage(state, {
          channel: "DAMAGE",
          tone: "good",
          text: `${incident.label} 已修复，系统恢复在线。`,
        });
      } else {
        pushMessage(state, {
          channel: "DAMAGE",
          tone: "good",
          text: `${incident.label} 已扑灭。`,
        });
      }
    }
  }

  for (const incident of state.incidents) {
    if (incident.done || incident.type !== "fire") continue;
    state.own.hull = Math.max(0, state.own.hull - DEFENSE.fireDps * dt);
    if (state.rng.chance(dt * 0.18)) {
      pushFx(state, {
        type: "fire",
        x: incident.pos?.x ?? 0,
        z: incident.pos?.z ?? 0,
      });
    }
  }
  state.incidents = state.incidents.filter((incident) => !incident.done || state.time - incident.t < 30);
}

export function damageSummary(state) {
  return {
    hull: state.own.hull,
    fires: state.incidents.filter((incident) => !incident.done && incident.type === "fire").length,
    repairs: state.incidents.filter((incident) => !incident.done && incident.type === "system").length,
    teams: state.dcTeams,
  };
}

export function mountStatus(state, mount) {
  if (!mountSystemOnline(state, mount)) return { key: "offline", label: "离线" };
  if (mount.ammo <= 0) return { key: "empty", label: "弹药耗尽" };
  if (mount.cooldown > 0) return { key: "reloading", label: `装填 ${mount.cooldown.toFixed(0)}s` };
  if (mount.kind === "escort" && !mount.called) return { key: "standby", label: "待呼叫" };
  return { key: "ready", label: "就绪" };
}
