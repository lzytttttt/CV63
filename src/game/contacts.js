/**
 * 接触（contact）生成与摧毁。接触是“真实世界”，航迹是“被感知的世界”。
 */

import { CONTACT_TYPES, DEFENSE } from "./constants.js";
import { bearingBetween, destination, rangeBetween } from "./geo.js";
import { pushMessage, trackForContact } from "./state.js";

export function spawnContact(state, spec) {
  const id = spec.id ?? `C${String(state.scenario.nextContact++).padStart(2, "0")}`;
  const type = CONTACT_TYPES[spec.kind] ?? CONTACT_TYPES.fighter;
  const course = spec.course ?? 180;
  const speed = spec.speed ?? type.speed;
  const rad = (course * Math.PI) / 180;
  const contact = {
    id,
    kind: spec.kind,
    name: spec.name ?? `${type.label} ${id}`,
    identity: spec.identity ?? "hostile",
    pos: { ...spec.pos },
    course,
    speed,
    vel: { x: Math.sin(rad) * speed, y: Math.cos(rad) * speed },
    altitude: spec.altitude ?? (spec.kind === "asm" ? DEFENSE.missileAltitude : type.symbol === "air" ? 8 : 0),
    rcs: spec.rcs ?? type.rcs,
    hp: spec.hp ?? 1,
    maxHp: spec.hp ?? 1,
    alive: true,
    emitter: spec.emitter ?? {
      on: spec.identity === "hostile" && spec.kind !== "asm",
      label: spec.emitterLabel ?? "搜索雷达",
      band: "X",
    },
    ecm: spec.ecm ?? 0,
    ai: {
      role: spec.role ?? null,
      launched: false,
      launchedAt: null,
      targetId: spec.targetId ?? null,
      origin: spec.origin ?? null,
      egress: false,
      engagedBy: null,
      orbit: 0,
    },
    spawnedAt: state.time,
    destroyedAt: null,
    destroyedBy: null,
    damage: 0,
    salvo: spec.salvo ?? null,
  };
  if (contact.salvo) contact.salvo = contact.salvo.map((entry) => ({ ...entry, fired: false }));
  if (spec.course !== undefined) {
    contact.vel = { x: Math.sin(rad) * speed, y: Math.cos(rad) * speed };
  }
  state.contacts.push(contact);
  return contact;
}

export function setContactCourse(contact, course, speed = contact.speed) {
  contact.course = (course + 360) % 360;
  contact.speed = speed;
  const rad = (contact.course * Math.PI) / 180;
  contact.vel = { x: Math.sin(rad) * speed, y: Math.cos(rad) * speed };
}

export function moveContact(contact, dt) {
  contact.pos.x += contact.vel.x * dt;
  contact.pos.y += contact.vel.y * dt;
}

export function destroyContact(state, contact, reason = "unknown", by = "CIC") {
  if (!contact.alive) return;
  contact.alive = false;
  contact.destroyedAt = state.time;
  contact.destroyedBy = reason;
  const track = trackForContact(state, contact.id);
  if (track) {
    track.status = "destroyed";
    track.destroyedAt = state.time;
    track.quality = 0;
    track.threat = 0;
  }
  if (contact.kind === "asm") {
    if (reason === "intercept") {
      state.stats.missilesIntercepted += 1;
      state.score += 45;
    }
  } else if (contact.kind === "destroyer") {
    state.stats.shipsDestroyed += 1;
    state.score += 160;
    pushMessage(state, {
      channel: "WEAPONS",
      tone: "good",
      text: `${contact.name} 被命中起火，失去战斗力。`,
    });
  } else if (["fighter", "strike"].includes(contact.kind)) {
    state.stats.hostileAirKilled += 1;
    state.score += 90;
    pushMessage(state, {
      channel: "CIC",
      tone: "good",
      text: `${contact.name} 被击落（${by}）。`,
    });
  } else if (contact.identity === "neutral") {
    state.stats.neutralEngaged += 1;
    state.score -= 220;
    pushMessage(state, {
      channel: "HQ",
      tone: "alert",
      text: `严重事件：中立目标 ${contact.name} 被击毁。指挥部要求立即停止射击并提交报告。`,
    });
  }
}

export function spawnSurfaceGroup(state, spec) {
  const contact = spawnContact(state, {
    kind: "destroyer",
    name: spec.name,
    identity: "hostile",
    pos: spec.pos,
    course: spec.course ?? 210,
    speed: 0.0093,
    hp: 3,
    emitter: { on: true, label: "顶板搜索雷达 / X 波段", band: "X" },
    role: "surface",
    salvo: spec.salvo ?? [],
  });
  contact.salvo = (spec.salvo ?? []).map((entry) => ({ ...entry, fired: false }));
  return contact;
}

export function spawnAirContact(state, spec) {
  return spawnContact(state, {
    kind: spec.kind ?? "strike",
    name: spec.name ?? (spec.kind === "fighter" ? "BANDIT 护航机" : "BANDIT 打击机"),
    identity: "hostile",
    pos: spec.pos,
    course: spec.course ?? 0,
    speed: spec.speed ?? CONTACT_TYPES[spec.kind ?? "strike"].speed,
    altitude: spec.altitude ?? 8,
    hp: 1,
    emitter: { on: true, label: spec.kind === "fighter" ? "机载火控雷达" : "机载搜索雷达", band: "X" },
    role: spec.role ?? spec.kind ?? "strike",
    targetId: spec.targetId ?? null,
  });
}

export function spawnMissile(state, spec) {
  const target = state.own.pos;
  const bearing = spec.bearing ?? bearingBetween(spec.origin, target);
  const missile = spawnContact(state, {
    kind: "asm",
    name: spec.name ?? "ASM 反舰导弹",
    identity: "hostile",
    pos: { ...spec.origin },
    course: bearing,
    speed: spec.speed ?? DEFENSE.missileSpeed,
    altitude: DEFENSE.missileAltitude,
    hp: 1,
    emitter: { on: false, label: "主动雷达导引头", band: "Ku" },
    role: "asm",
    targetId: spec.targetId ?? null,
  });
  return missile;
}

export function contactsInRange(state, pos, range, filter) {
  return state.contacts.filter(
    (contact) => contact.alive && rangeBetween(pos, contact.pos) <= range && (!filter || filter(contact)),
  );
}

export function nearestContact(state, pos, maxRange = Infinity, filter) {
  let best = null;
  let bestRange = maxRange;
  for (const contact of state.contacts) {
    if (!contact.alive) continue;
    if (filter && !filter(contact)) continue;
    const range = rangeBetween(pos, contact.pos);
    if (range < bestRange) {
      bestRange = range;
      best = contact;
    }
  }
  return best ? { contact: best, range: bestRange } : null;
}

export function predictContact(contact, seconds) {
  return {
    x: contact.pos.x + contact.vel.x * seconds,
    y: contact.pos.y + contact.vel.y * seconds,
  };
}
