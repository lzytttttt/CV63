/**
 * 场景导演：时间线、增援/目标生成、情报请求、胜负结算。
 */

import { SCENARIO, CONTACT_TYPES, MISSION } from "./constants.js";
import { destination, rangeBetween, bearingBetween, formatBearing, formatRange } from "./geo.js";
import { pushMessage, trackForContact } from "./state.js";
import { spawnAirContact, spawnContact, spawnSurfaceGroup } from "./contacts.js";

export function updateScenario(state) {
  if (!state.scenario.timeline) {
    state.scenario.timeline = [...SCENARIO.timelines].sort((a, b) => a.t - b.t);
  }
  const timeline = state.scenario.timeline;
  while (state.scenario.index < timeline.length) {
    const event = timeline[state.scenario.index];
    if (state.time < event.t) break;
    state.scenario.index += 1;
    runEvent(state, event);
  }
}

function runEvent(state, event) {
  switch (event.type) {
    case "message":
      pushMessage(state, event);
      break;
    case "spawnSurface":
      spawnSurface(state);
      break;
    case "spawnNeutralAir":
      spawnNeutralAir(state);
      break;
    case "spawnNeutralSurface":
      spawnNeutralSurface(state);
      break;
    case "spawnStrike":
      spawnAirRaid(state, event);
      break;
    case "spawnEscort":
      spawnEscort(state, event);
      break;
    default:
      break;
  }
}

function spawnSurface(state) {
  SCENARIO.surfaceGroup.forEach((spec, index) => {
    const pos = {
      x: spec.pos.x + index * -1.5,
      y: spec.pos.y + index * 2.0,
    };
    spawnSurfaceGroup(state, {
      name: spec.name,
      pos,
      course: spec.course,
      salvo: spec.salvo,
    });
  });
  pushMessage(state, {
    channel: "ESM",
    tone: "warn",
    text: "ESM 发现两个水面辐射源，方位 022–026，距离 130+ km，航向西南。",
  });
}

function spawnNeutralAir(state) {
  spawnContact(state, {
    kind: "airliner",
    name: "CIVIL 882",
    identity: "neutral",
    pos: { x: -125, y: 150 },
    course: 100,
    speed: 0.24,
    altitude: 10,
    hp: 1,
    emitter: { on: true, label: "气象雷达 / S 波段", band: "S" },
    role: "neutral",
  });
}

function spawnNeutralSurface(state) {
  const pos = destination(state.own.pos, 214, 36);
  spawnContact(state, {
    kind: "fishing",
    name: "渔船编队",
    identity: "neutral",
    pos,
    course: 88,
    speed: 0.006,
    hp: 1,
    emitter: { on: false, label: "导航雷达", band: "X" },
    role: "neutral",
  });
}

function spawnAirRaid(state, event) {
  const count = event.count ?? 2;
  const bearing = event.bearing ?? 60;
  const range = event.range ?? 128;
  for (let i = 0; i < count; i += 1) {
    const offset = (i - (count - 1) / 2) * 14;
    const pos = destination(state.own.pos, bearing + offset, range);
    spawnAirContact(state, {
      kind: "strike",
      name: `BANDIT 打击机 ${i + 1}`,
      pos,
      course: bearingBetween(pos, state.own.pos),
      speed: CONTACT_TYPES.strike.speed,
      role: "strike",
      targetId: "CV-63",
    });
  }
  pushMessage(state, {
    channel: "AEW",
    tone: "warn",
    text: `远程预警：发现 ${count} 批打击机，方位 ${formatBearing(bearing)}，距离 ${formatRange(range)} km，正在建立攻击航路。`,
  });
}

function spawnEscort(state, event) {
  const count = event.count ?? 2;
  const bearing = event.bearing ?? 42;
  const range = event.range ?? 140;
  for (let i = 0; i < count; i += 1) {
    const pos = destination(state.own.pos, bearing + i * 6 - 3, range + i * 4);
    spawnAirContact(state, {
      kind: "fighter",
      name: `BANDIT 护航机 ${i + 1}`,
      pos,
      course: bearingBetween(pos, state.own.pos),
      speed: CONTACT_TYPES.fighter.speed,
      role: "fighter",
    });
  }
  pushMessage(state, {
    channel: "AEW",
    tone: "alert",
    text: `敌护航战斗机进入警戒区，方位 ${formatBearing(bearing)}，距离 ${formatRange(range)} km。`,
  });
}

/** HQ 情报请求：对当前一条未识别/未精确定位的航迹给出提示 */
export function requestIntel(state) {
  const cooldown = 45;
  if (state.time - state.scenario.intelAt < cooldown) {
    const wait = Math.ceil(cooldown - (state.time - state.scenario.intelAt));
    return { ok: false, message: `情报链路繁忙，${wait}s 后再试` };
  }
  const candidates = state.tracks.filter((track) => track.status === "active");
  if (!candidates.length) return { ok: false, message: "当前没有可查询的航迹" };
  const target = candidates.sort((a, b) => b.threat - a.threat)[0];
  state.scenario.intelAt = state.time;
  state.intelRequests += 1;
  const contact = state.contacts.find((item) => item.id === target.contactId);
  if (!contact) return { ok: false, message: "情报无更新" };

  if (contact.identity === "neutral") {
    pushMessage(state, {
      channel: "HQ",
      tone: "info",
      text: `情报回复：${target.id} 已与民航/渔业通报交叉核对，判定为中立目标。保持距离。`,
      trackId: target.id,
    });
    target.notes.push("HQ：中立目标");
    target.quality = Math.max(target.quality, 0.62);
  } else if (contact.kind === "destroyer") {
    pushMessage(state, {
      channel: "HQ",
      tone: "warn",
      text: `情报回复：${target.id} 为“铁巢”编队导弹驱逐舰，配备超音速反舰导弹。建议优先瘫痪。`,
      trackId: target.id,
    });
    target.notes.push("HQ：导弹驱逐舰");
    target.quality = Math.max(target.quality, 0.58);
  } else if (["fighter", "strike"].includes(contact.kind)) {
    pushMessage(state, {
      channel: "HQ",
      tone: "warn",
      text: `情报回复：${target.id} 挂载反舰导弹，判定为敌对打击编队。`,
      trackId: target.id,
    });
    target.notes.push("HQ：敌对打击机");
    target.quality = Math.max(target.quality, 0.58);
  } else {
    pushMessage(state, {
      channel: "HQ",
      tone: "info",
      text: `情报回复：${target.id} 无可比对档案，建议自行识别。`,
      trackId: target.id,
    });
  }
  return { ok: true, message: "情报已更新" };
}

export function objectiveSummary(state) {
  const destroyers = state.contacts.filter((contact) => contact.kind === "destroyer");
  return [
    { id: "survive", label: "坚持至推演结束（10:00）", done: state.phase === "won" || state.time >= state.duration },
    { id: "carrier", label: "航母保持战斗力（舰体 > 0）", done: state.own.hull > 0 },
    {
      id: "iron",
      label: "瘫痪“铁巢”水面编队",
      done: destroyers.length > 0 && destroyers.every((contact) => !contact.alive),
    },
    {
      id: "neutral",
      label: "避免误击中立目标",
      done: state.stats.neutralEngaged === 0,
    },
  ];
}

export function finishMission(state, outcome) {
  if (state.result) return;
  const survived = state.time >= state.duration && state.own.hull > 0;
  const finalOutcome = outcome ?? (state.own.hull > 0 ? "won" : "lost");
  const ironAlive = state.contacts.some((contact) => contact.kind === "destroyer" && contact.alive);
  let score = state.score;
  if (finalOutcome === "won") score += 320;
  score += Math.round(state.own.hull * 2);
  if (!ironAlive) score += 180;
  if (state.stats.neutralEngaged === 0) score += 80;

  let grade = "C";
  if (finalOutcome === "lost") {
    grade = "D";
  } else if (score >= 900 && state.own.hull >= 60) {
    grade = "S";
  } else if (score >= 720 && state.own.hull >= 30) {
    grade = "A";
  } else if (score >= 520) {
    grade = "B";
  } else if (score >= 320) {
    grade = "C";
  } else {
    grade = "D";
  }

  state.phase = finalOutcome;
  state.result = {
    outcome: finalOutcome,
    survived,
    grade,
    score: Math.max(0, Math.round(score)),
    ironAlive,
    time: state.time,
    hull: Math.round(state.own.hull),
    stats: { ...state.stats },
    objectives: objectiveSummary(state),
    lines: buildResultLines(state, finalOutcome, ironAlive),
  };
  pushMessage(state, {
    channel: "SYS",
    tone: finalOutcome === "won" ? "good" : "alert",
    text:
      finalOutcome === "won"
        ? `推演结束：航母保持战斗力，评级 ${grade}，总分 ${state.result.score}。`
        : `推演结束：航母失去战斗力。评级 ${grade}。`,
    sticky: true,
  });
}

function buildResultLines(state, outcome, ironAlive) {
  const lines = [];
  lines.push(`舰体完整度：${Math.round(state.own.hull)}%`);
  lines.push(`拦截来袭导弹：${state.stats.missilesIntercepted} 枚 / 被命中 ${state.stats.missilesHit} 枚`);
  lines.push(`击落敌机：${state.stats.hostileAirKilled} 架`);
  lines.push(`“铁巢”编队：${ironAlive ? "仍有战力" : "已被瘫痪"}`);
  lines.push(`舰载机出动：${state.stats.launched} 架次 / 损失 ${state.stats.aircraftLost} 架`);
  lines.push(`误击中立目标：${state.stats.neutralEngaged} 次`);
  lines.push(`鱼叉命中：${state.stats.harpoonHits} 发`);
  if (outcome === "won" && !ironAlive && state.stats.neutralEngaged === 0) {
    lines.push("评语：信息优势转化为火力优势，甲板节奏与武器协同均达到预期。");
  } else if (outcome === "won") {
    lines.push("评语：防住了这一轮，但情报识别与甲板周转仍有改进空间。");
  } else {
    lines.push("评语：航母失去战斗力。检查 EMCON 切换、拦截弹分配与甲板回收节奏。");
  }
  return lines;
}

export function missionTimeLabel(state) {
  return `${String(Math.floor(state.time / 60)).padStart(2, "0")}:${String(Math.floor(state.time % 60)).padStart(2, "0")}`;
}

export function threatBearing(state) {
  const track = state.tracks
    .filter((item) => item.status === "active" && item.threat >= 40)
    .sort((a, b) => b.threat - a.threat)[0];
  return track?.bearing ?? null;
}

export function targetTrackForStrike(state) {
  return state.tracks
    .filter(
      (track) =>
        track.status === "active" &&
        track.kind === "destroyer" &&
        !track.bearingOnly &&
        track.quality >= 0.45 &&
        (track.classified === "hostile" || track.classified === "assumed-hostile"),
    )
    .sort((a, b) => b.quality - a.quality)[0] ?? null;
}

export function missionDescription(aircraft) {
  if (!aircraft.mission) return "—";
  return MISSION[aircraft.mission]?.label ?? aircraft.mission;
}

export function detectRangeLabel(state) {
  return state.capabilities.aew ? "AEW 400 km" : state.emcon === "active" ? "雷达 230 km" : "仅 ESM";
}

export function nearestThreatRange(state) {
  const ranges = state.contacts
    .filter((contact) => contact.alive && contact.identity === "hostile")
    .map((contact) => rangeBetween(state.own.pos, contact.pos));
  return ranges.length ? Math.min(...ranges) : null;
}

export function contactLabel(state, track) {
  const contact = state.contacts.find((item) => item.id === track.contactId);
  if (!contact) return "接触";
  if (track.identified) return CONTACT_TYPES[contact.kind]?.label ?? contact.kind;
  return track.bearingOnly ? "辐射源" : CONTACT_TYPES[contact.kind]?.symbol === "surface" ? "水面接触" : "空中接触";
}
