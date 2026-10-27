/**
 * 传感器、航迹与识别。
 *
 * 信息模型：
 *   - 雷达 / 预警机给出带距离的航迹，质量随刷新与距离衰减；
 *   - ESM 只给方位（bearing-only），必须交叉定位才能用于火控；
 *   - IFF 只对合作目标给出答案，敌机“无应答”不等于敌对；
 *   - 目视识别（CAP 抵近）才给出确定身份。
 * 火控规则要求：已判定敌对（或人工判定）+ 航迹质量 ≥ 0.5 + 非方位线。
 */

import {
  SENSOR,
  CONTACT_TYPES,
  MISSION,
} from "./constants.js";
import {
  bearingBetween,
  rangeBetween,
  destination,
  formatBearing,
  formatRange,
  clamp,
} from "./geo.js";
import { pushMessage, trackForContact, airborneAircraft } from "./state.js";

export const CLASSIFICATION_LABEL = {
  unknown: "未识别",
  "assumed-hostile": "判定敌对",
  hostile: "敌对",
  neutral: "中立",
  friendly: "友方",
};

export const SOURCE_LABEL = {
  radar: "舰载雷达",
  aew: "E-2C 预警",
  esm: "ESM 被动",
  visual: "目视确认",
  intel: "情报通报",
};

const AIR_KINDS = new Set(["fighter", "strike", "airliner"]);
const SURFACE_KINDS = new Set(["destroyer", "fishing"]);

function isHighAir(contact) {
  return contact.kind !== "asm" && (contact.altitude ?? 8) > 1.2;
}

function contactSensorProfile(contact) {
  if (contact.kind === "asm") {
    return {
      airHigh: SENSOR.radar.missileHigh,
      airLow: SENSOR.radar.missileLow,
      surface: 0,
      missileLow: SENSOR.radar.missileLow,
      missileHigh: SENSOR.radar.missileHigh,
    };
  }
  if (SURFACE_KINDS.has(contact.kind)) {
    const r = SENSOR.radar.surface;
    return { airHigh: r, airLow: r, surface: r, missileLow: 0, missileHigh: 0 };
  }
  return SENSOR.radar;
}

/** 雷达探测距离（km），0 表示不可探测 */
export function radarRangeFor(state, contact) {
  if (state.emcon !== "active" || !state.systems.radar.online) return 0;
  const profile = contactSensorProfile(contact);
  if (contact.kind === "asm") return contact.altitude > 0.4 ? profile.missileHigh : profile.missileLow;
  if (SURFACE_KINDS.has(contact.kind)) return profile.surface;
  return isHighAir(contact) ? profile.airHigh : profile.airLow;
}

export function aewRangeFor(contact) {
  if (contact.kind === "asm") {
    return contact.altitude > 0.4 ? SENSOR.aew.missileHigh : SENSOR.aew.missileLow;
  }
  if (SURFACE_KINDS.has(contact.kind)) return SENSOR.aew.surface;
  return isHighAir(contact) ? SENSOR.aew.airHigh : SENSOR.aew.airLow;
}

function trackSource(state, contact, range) {
  if (state.capabilities.aew && range <= aewRangeFor(contact)) return "aew";
  if (range <= radarRangeFor(state, contact)) return "radar";
  return null;
}

function makeTrack(state, contact, source, range, bearing) {
  const track = {
    id: `TRK-${String(state.scenario.nextTrack++).padStart(2, "0")}`,
    contactId: contact.id,
    kind: contact.kind,
    kindHint: contact.kind,
    symbol: CONTACT_TYPES[contact.kind]?.symbol ?? "unknown",
    typeLabel: null,
    identity: null,
    classified: "unknown",
    identified: false,
    bearingOnly: false,
    quality: source === "aew" ? 0.42 : 0.34,
    source,
    pos: { ...contact.pos },
    bearing,
    range,
    speed: contact.speed ?? 0,
    course: contact.course ?? bearing,
    altitude: contact.altitude ?? 0,
    threat: 0,
    engagedBy: [],
    status: "active",
    createdAt: state.time,
    updatedAt: state.time,
    lastLostAt: null,
    ecm: contact.ecm ?? 0,
    emitterLabel: contact.emitter?.label ?? null,
    iff: null,
    esmFix: null,
    visualRequest: null,
    visualSeenAt: null,
    destroyedAt: null,
    notes: [],
    manual: false,
  };
  if (contact.kind === "asm") {
    track.classified = "hostile";
    track.identity = "hostile";
    track.identified = true;
    track.typeLabel = CONTACT_TYPES.asm.label;
    track.symbol = "missile";
  }
  state.tracks.push(track);
  return track;
}

function refreshTrack(track, contact, source, range, bearing, state) {
  track.source = source;
  track.bearingOnly = false;
  track.pos = { ...contact.pos };
  track.bearing = bearing;
  track.range = range;
  track.speed = contact.speed ?? 0;
  track.course = contact.course ?? bearing;
  track.altitude = contact.altitude ?? 0;
  track.updatedAt = state.time;
  track.lastLostAt = null;
  track.status = "active";
  const gain = source === "aew" ? 0.24 : source === "visual" ? 0.5 : 0.2;
  track.quality = clamp(track.quality + gain, 0, source === "visual" ? 1 : 0.94);
  if (source === "visual") {
    applyIdentification(state, track, contact, "visual");
  }
  track.kind = contact.kind;
  track.symbol =
    contact.kind === "asm" ? "missile" : SURFACE_KINDS.has(contact.kind) ? "surface" : "air";
  if (!track.identified && contact.kind !== "asm") {
    track.kindHint = contact.kind;
  }
}

export function applyIdentification(state, track, contact, source) {
  track.identified = true;
  track.identity = contact.identity;
  track.classified = contact.identity;
  track.typeLabel = CONTACT_TYPES[contact.kind]?.label ?? contact.kind;
  track.source = source;
  track.quality = Math.max(track.quality, 0.98);
  if (source !== "visual") track.notes.push(`IFF 应答：${contact.identity === "hostile" ? "无应答" : "友军/中立"}`);
  if (contact.kind === "asm") track.classified = "hostile";
}

function makeBearingOnlyTrack(state, contact, bearing) {
  const estimated = destination(state.own.pos, bearing, 150);
  const track = {
    id: `TRK-${String(state.scenario.nextTrack++).padStart(2, "0")}`,
    contactId: contact.id,
    kind: contact.kind,
    kindHint: "unknown",
    symbol: "unknown",
    typeLabel: null,
    identity: null,
    classified: "unknown",
    identified: false,
    bearingOnly: true,
    quality: 0.22,
    source: "esm",
    pos: estimated,
    bearing,
    range: 150,
    speed: 0,
    course: bearing,
    altitude: 0,
    threat: 0,
    engagedBy: [],
    status: "active",
    createdAt: state.time,
    updatedAt: state.time,
    lastLostAt: null,
    ecm: 0,
    emitterLabel: contact.emitter?.label ?? "未知辐射源",
    iff: null,
    esmFix: null,
    visualRequest: null,
    visualSeenAt: null,
    destroyedAt: null,
    notes: [],
    manual: false,
  };
  state.tracks.push(track);
  return track;
}

function updateBearingOnly(track, contact, state) {
  const bearing = bearingBetween(state.own.pos, contact.pos);
  track.bearing = bearing;
  track.updatedAt = state.time;
  track.status = "active";
  track.bearingOnly = true;
  track.source = "esm";
  track.quality = Math.max(track.quality, 0.22);
  track.emitterLabel = contact.emitter?.label ?? track.emitterLabel;
  track.lastLostAt = null;
  if (track.quality < 0.5 && !track.esmFix?.resolved) {
    track.pos = destination(state.own.pos, bearing, Math.max(45, track.range || 150));
    track.range = rangeBetween(state.own.pos, track.pos);
  }
}

/** 判断一个接触当前是否被任何传感器覆盖；返回 {source, range, bearing} 或 null */
function detectContact(state, contact) {
  const range = rangeBetween(state.own.pos, contact.pos);
  const bearing = bearingBetween(state.own.pos, contact.pos);

  // 目视：CAP 在 28 km 内直接识别（独立于 EMCON）
  const visual = airborneAircraft(state, "fighter").find(
    (aircraft) => rangeBetween(aircraft.flightPos, contact.pos) <= SENSOR.visual.range,
  );
  if (visual) return { source: "visual", range, bearing, visual };

  const radarSource = trackSource(state, contact, range);
  if (radarSource) return { source: radarSource, range, bearing };

  if (contact.emitter?.on && range <= SENSOR.esm.range) {
    return { source: "esm", range, bearing };
  }
  return null;
}

export function updateSensors(state) {
  const now = state.time;
  const seen = new Set();

  for (const contact of state.contacts) {
    if (!contact.alive) continue;
    const info = detectContact(state, contact);
    const existing = trackForContact(state, contact.id);

    if (!info) {
      if (existing) {
        existing.updatedAt = existing.updatedAt;
        if (!existing.lastLostAt) existing.lastLostAt = now;
        if (now - existing.lastLostAt > 35 && existing.status === "active") {
          existing.status = "stale";
          pushMessage(state, {
            channel: "CIC",
            tone: "info",
            text: `航迹丢失：${existing.id}（${existing.bearingOnly ? "ESM 方位线" : "雷达航迹"}）`,
            trackId: existing.id,
          });
        }
      }
      continue;
    }

    seen.add(contact.id);
    if (info.source === "esm" && (!existing || existing.bearingOnly)) {
      if (!existing) makeBearingOnlyTrack(state, contact, info.bearing);
      else updateBearingOnly(existing, contact, state);
      continue;
    }

    if (!existing) {
      const track = makeTrack(state, contact, info.source, info.range, info.bearing);
      if (info.source === "visual") applyIdentification(state, track, contact, "visual");
      if (contact.kind === "asm") {
        pushMessage(state, {
          channel: "WEAPONS",
          tone: "alert",
          text: `反舰导弹航迹：${track.id}，方位 ${formatBearing(info.bearing)}，距离 ${formatRange(info.range)} km。`,
          trackId: track.id,
        });
      } else if (contact.identity === "neutral" && info.source === "visual") {
        pushMessage(state, {
          channel: "CIC",
          tone: "info",
          text: `目视识别：${track.id} 为中立目标（${CONTACT_TYPES[contact.kind]?.label ?? contact.kind}）。`,
          trackId: track.id,
        });
      }
    } else {
      refreshTrack(existing, contact, info.source, info.range, info.bearing, state);
    }
  }

  // 目标丢失后的质量衰减 / 过期清理
  for (const track of state.tracks) {
    if (track.status === "destroyed") continue;
    const age = now - track.updatedAt;
    if (age > 1) {
      const decay = track.bearingOnly ? 0.008 : 0.016;
      track.quality = clamp(track.quality - decay * Math.min(age, 5), 0, 1);
    }
    if (track.bearingOnly && track.quality > 0.42 && track.esmFix?.resolved) {
      track.bearingOnly = false;
    }
    if (track.status === "stale" && age > 90) {
      track.status = "lost";
    }
    if (track.status === "lost" && age > 130) {
      track.status = "expired";
    }
    if (track.status === "destroyed" && now - track.destroyedAt > 14) {
      track.status = "expired";
    }
  }

  // 自动目视识别（CAP 在 28 km 内持续 8 s）
  for (const track of state.tracks) {
    if (track.identified || track.status !== "active") continue;
    const contact = state.contacts.find((item) => item.id === track.contactId);
    if (!contact || !contact.alive) continue;
    const watcher = airborneAircraft(state, "fighter").find(
      (aircraft) => rangeBetween(aircraft.flightPos, contact.pos) <= SENSOR.visual.range,
    );
    if (!watcher) {
      track.visualSeenAt = null;
      continue;
    }
    if (!track.visualSeenAt) track.visualSeenAt = now;
    if (now - track.visualSeenAt >= 8) {
      applyIdentification(state, track, contact, "visual");
      pushMessage(state, {
        channel: "CIC",
        tone: contact.identity === "hostile" ? "warn" : "info",
        text: `目视识别完成：${track.id} → ${CONTACT_TYPES[contact.kind]?.label ?? contact.kind}（${contact.identity === "hostile" ? "敌对" : "非敌对"}）。`,
        trackId: track.id,
      });
    }
  }

  updateIdentificationTimers(state);
  updateThreats(state);
  pruneTracks(state);
}

function updateIdentificationTimers(state) {
  for (const track of state.tracks) {
    if (track.status !== "active") continue;
    const contact = state.contacts.find((item) => item.id === track.contactId);
    if (!contact || !contact.alive) continue;

    if (track.visualRequest?.active && track.identified) {
      track.visualRequest.active = false;
    }

    if (track.iff?.active) {
      track.iff.timeLeft -= 1;
      if (track.iff.timeLeft <= 0) {
        track.iff.active = false;
        const cooperative = contact.identity !== "hostile";
        if (cooperative) {
          applyIdentification(state, track, contact, "intel");
          track.quality = Math.max(track.quality, 0.9);
          pushMessage(state, {
            channel: "CIC",
            tone: "good",
            text: `IFF 应答：${track.id} 为${contact.identity === "friendly" ? "友军" : "中立"}。`,
            trackId: track.id,
          });
        } else {
          track.iff.result = "no-response";
          track.notes.push("IFF 无应答");
          pushMessage(state, {
            channel: "CIC",
            tone: "warn",
            text: `IFF 无应答：${track.id}。无法据此判定敌我，建议 ESM 识别或目视确认。`,
            trackId: track.id,
          });
        }
      }
    }

    if (track.esmFix?.active) {
      track.esmFix.timeLeft -= 1;
      if (track.esmFix.timeLeft <= 0) {
        track.esmFix.active = false;
        track.esmFix.resolved = true;
        track.quality = Math.max(track.quality, track.bearingOnly ? 0.56 : 0.72);
        track.bearingOnly = false;
        track.range = Math.max(track.range || 80, 20);
        track.pos = destination(state.own.pos, track.bearing, track.range);
        track.emitterLabel = contact.emitter?.label ?? "未知辐射源";
        track.notes.push(`ESM 交叉定位：${track.emitterLabel}`);
        if (contact.kind === "destroyer" || contact.kind === "fighter" || contact.kind === "strike") {
          track.notes.push("辐射特征符合敌方火控/搜索雷达");
        }
        pushMessage(state, {
          channel: "ESM",
          tone: "warn",
          text: `ESM 交叉定位完成：${track.id}，辐射源 ${track.emitterLabel}，方位 ${formatBearing(track.bearing)}，估计距离 ${formatRange(track.range)} km。`,
          trackId: track.id,
        });
      }
    }

    if (track.visualRequest?.active) {
      track.visualRequest.timeLeft -= 1;
      if (track.visualRequest.timeLeft <= 0) {
        track.visualRequest.active = false;
        const aircraft = state.aircraft.find((item) => item.id === track.visualRequest.aircraftId);
        if (aircraft && aircraft.state === "airborne" && rangeBetween(aircraft.flightPos, contact.pos) <= 36) {
          applyIdentification(state, track, contact, "visual");
          pushMessage(state, {
            channel: "CIC",
            tone: "good",
            text: `目视确认：${track.id} → ${CONTACT_TYPES[contact.kind]?.label ?? contact.kind}（${contact.identity === "hostile" ? "敌对" : "非敌对"}）。`,
            trackId: track.id,
          });
        } else {
          pushMessage(state, {
            channel: "CIC",
            tone: "warn",
            text: `目视识别失败：${track.id} 超出战机拦截距离。`,
            trackId: track.id,
          });
        }
      }
    }
  }
}

function updateThreats(state) {
  const own = state.own.pos;
  const ownVel = {
    x: Math.sin((state.own.heading * Math.PI) / 180) * state.own.speed,
    y: Math.cos((state.own.heading * Math.PI) / 180) * state.own.speed,
  };
  for (const track of state.tracks) {
    const contact = state.contacts.find((item) => item.id === track.contactId);
    if (!contact || !contact.alive) {
      track.threat = Math.max(0, track.threat - 20);
      continue;
    }
    const range = rangeBetween(own, contact.pos);
    const closeSpeed = -(
      (contact.vel.x - ownVel.x) * (own.x - contact.pos.x) +
      (contact.vel.y - ownVel.y) * (own.y - contact.pos.y)
    ) / Math.max(0.01, range);
    const closing = Math.max(0, closeSpeed);
    let threat = 0;
    if (contact.kind === "asm") threat = 100;
    else if (AIR_KINDS.has(contact.kind)) {
      threat = track.classified === "hostile" ? 72 : track.classified === "assumed-hostile" ? 64 : track.classified === "unknown" ? 44 : 10;
      threat += clamp(closing * 60, 0, 20);
      if (range < 80) threat += 6;
    } else if (SURFACE_KINDS.has(contact.kind)) {
      threat = track.classified === "hostile" ? 46 : track.classified === "unknown" ? 22 : 6;
      if (contact.kind === "destroyer") threat += 10;
    }
    if (track.identified && contact.identity === "neutral") threat = Math.min(threat, 8);
    track.threat = clamp(threat, 0, 100);
    track.closing = closing;
    track.range = range;
    track.bearing = bearingBetween(own, contact.pos);
  }
}

function pruneTracks(state) {
  const aliveTrackIds = new Set();
  state.tracks = state.tracks.filter((track) => {
    if (track.status === "expired") return false;
    aliveTrackIds.add(track.id);
    return true;
  });
  for (const mount of state.mounts) {
    mount.assigned = mount.assigned.filter((id) => aliveTrackIds.has(id));
  }
  state.tracks.forEach((track) => {
    track.engagedBy = track.engagedBy.filter((mountId) =>
      state.mounts.some((mount) => mount.id === mountId && mount.assigned.includes(track.id)),
    );
  });
}

/** 判断航迹能否作为火控目标 */
export function isFireControlTrack(track) {
  if (!track || track.status !== "active") return false;
  if (track.bearingOnly) return false;
  if (track.quality < 0.5) return false;
  return track.classified === "hostile" || track.classified === "assumed-hostile";
}

export function trackSummary(track) {
  const type = track.typeLabel ?? (track.bearingOnly ? "辐射源" : CONTACT_TYPES[track.kind]?.label ?? "接触");
  return `${track.id} · ${type} · ${CLASSIFICATION_LABEL[track.classified] ?? track.classified}`;
}

export function missionLabel(aircraft) {
  if (!aircraft.mission) return "—";
  return MISSION[aircraft.mission]?.short ?? aircraft.mission;
}
