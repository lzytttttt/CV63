/**
 * 推演主循环与命令接口。
 * 所有状态变更都通过 command()，便于 UI、测试与回放使用同一套规则。
 */

import { AIRCRAFT_TYPES, SENSOR_INTERVAL } from "./constants.js";
import { clamp } from "./geo.js";
import {
  createInitialState,
  pushMessage,
  trackById,
  aircraftById,
  mountById,
  airborneAircraft,
} from "./state.js";
import { updateSensors } from "./sensors.js";
import { updateDeckOps, orderSortie, recallAircraft, isAirborne } from "./deckops.js";
import {
  updateOwnShip,
  updateCapabilities,
  updateAirOps,
  destroyAircraft,
} from "./airops.js";
import {
  updateDefense,
  assignMount,
  unassignMount,
  callEscort,
  deployChaff,
} from "./defense.js";
import {
  updateScenario,
  requestIntel,
  targetTrackForStrike,
  finishMission,
} from "./scenario.js";
import { rangeBetween } from "./geo.js";

export { createInitialState };

let simulationSerial = 0;

export function createSimulation(options = {}) {
  const state = createInitialState(options);
  state.simulationId = ++simulationSerial;
  return state;
}

/* ── 命令 ─────────────────────────────────────────────────── */

export function command(state, cmd) {
  if (!cmd || typeof cmd.type !== "string") return { ok: false, message: "无效指令" };
  if (state.phase !== "running" && cmd.type !== "start") {
    return { ok: false, message: state.phase === "briefing" ? "请先开始作战" : "推演已结束" };
  }
  switch (cmd.type) {
    case "start": {
      if (state.phase !== "briefing") return { ok: false, message: "推演已开始" };
      state.phase = "running";
      pushMessage(state, {
        channel: "SYS",
        tone: "good",
        text: "推演开始。信息优先：先用 E-2C/ESM 建立航迹，再决定开火与甲板节奏。",
      });
      return { ok: true, message: "推演开始" };
    }
    case "pause": {
      state.paused = Boolean(cmd.value ?? true);
      return { ok: true, message: state.paused ? "已暂停" : "已继续" };
    }
    case "speed": {
      state.speed = clamp(Number(cmd.value) || 1, 0.5, 4);
      return { ok: true, message: `时间倍率 ${state.speed}×` };
    }
    case "emcon": {
      const value = cmd.value === "silent" ? "silent" : "active";
      if (value === "active" && !state.systems.radar.online) {
        return { ok: false, message: "对空雷达战损，无法开机" };
      }
      if (state.emcon === value) return { ok: true, message: "状态未变" };
      state.emcon = value;
      pushMessage(state, {
        channel: "CIC",
        tone: value === "active" ? "warn" : "info",
        text:
          value === "active"
            ? "EMCON 主动：雷达开机，海麻雀可制导；同时暴露自身位置，来袭导弹的末段锁定更稳定。"
            : "EMCON 静默：雷达关机，仅靠 ESM/预警机；海麻雀无法制导，来袭导弹有概率丢失目标。",
        sticky: true,
      });
      return { ok: true, message: value === "active" ? "雷达开机" : "转入静默" };
    }
    case "roe": {
      const value = cmd.value === "free" ? "free" : "tight";
      state.roe = value;
      pushMessage(state, {
        channel: "CIC",
        tone: value === "free" ? "warn" : "info",
        text:
          value === "free"
            ? "交战规则：自由开火。CAP 可对未识别空中目标开火——误击风险由指挥官承担。"
            : "交战规则：严格识别。CAP 只对已判定敌对目标开火。",
        sticky: true,
      });
      return { ok: true, message: value === "free" ? "自由开火" : "严格识别" };
    }
    case "autoDefense": {
      state.autoDefense = Boolean(cmd.value);
      return { ok: true, message: state.autoDefense ? "密集阵自动防御开启" : "密集阵自动防御关闭" };
    }
    case "autoSam": {
      state.autoSam = Boolean(cmd.value);
      return { ok: true, message: state.autoSam ? "海麻雀自动分配开启" : "海麻雀自动分配关闭" };
    }
    case "jam": {
      if (!cmd.value) {
        state.jam = false;
        return { ok: true, message: "电子干扰关闭" };
      }
      if (!state.capabilities.ew) return { ok: false, message: "需要 EA-6B 在空中" };
      state.jam = true;
      pushMessage(state, {
        channel: "WEAPONS",
        tone: "info",
        text: "EA-6B 开始压制：来袭导弹末段锁概率下降。",
      });
      return { ok: true, message: "电子干扰开启" };
    }
    case "chaff":
      return deployChaff(state);
    case "classify": {
      const track = trackById(state, cmd.trackId);
      if (!track) return { ok: false, message: "未找到航迹" };
      if (track.identified) return { ok: false, message: "目标身份已确认，无法人工改判" };
      const value = cmd.value;
      if (!["unknown", "hostile", "assumed-hostile", "neutral", "friendly"].includes(value)) {
        return { ok: false, message: "无效判定" };
      }
      track.classified = value;
      track.manual = true;
      track.notes.push(`人工判定：${value}`);
      pushMessage(state, {
        channel: "CIC",
        tone: value === "hostile" || value === "assumed-hostile" ? "warn" : "info",
        text: `航迹 ${track.id} 人工判定为${value === "hostile" ? "敌对" : value === "assumed-hostile" ? "疑似敌对" : value === "neutral" ? "中立" : value === "friendly" ? "友方" : "未识别"}。`,
        trackId: track.id,
      });
      return { ok: true, message: "判定已更新" };
    }
    case "identify": {
      const track = trackById(state, cmd.trackId);
      if (!track) return { ok: false, message: "未找到航迹" };
      if (track.identified) return { ok: false, message: "身份已确认" };
      if (track.iff?.active) return { ok: false, message: "IFF 询问进行中" };
      track.iff = { active: true, timeLeft: 5 };
      pushMessage(state, {
        channel: "CIC",
        tone: "info",
        text: `对 ${track.id} 发起 IFF 询问…`,
        trackId: track.id,
      });
      return { ok: true, message: "IFF 询问已发出" };
    }
    case "esmFix": {
      const track = trackById(state, cmd.trackId);
      if (!track) return { ok: false, message: "未找到航迹" };
      if (track.esmFix?.active) return { ok: false, message: "ESM 交叉定位进行中" };
      track.esmFix = { active: true, timeLeft: 7, resolved: false };
      pushMessage(state, {
        channel: "ESM",
        tone: "info",
        text: `正在对 ${track.id} 进行 ESM 交叉定位…`,
        trackId: track.id,
      });
      return { ok: true, message: "ESM 定位中" };
    }
    case "visualId": {
      const track = trackById(state, cmd.trackId);
      if (!track) return { ok: false, message: "未找到航迹" };
      if (track.identified) return { ok: false, message: "身份已确认" };
      if (track.visualRequest?.active) return { ok: false, message: "目视识别已在进行" };
      const contact = state.contacts.find((item) => item.id === track.contactId);
      if (!contact) return { ok: false, message: "目标已消失" };
      const candidate = airborneAircraft(state, "fighter")
        .filter((aircraft) => rangeBetween(aircraft.flightPos, contact.pos) <= 70 && !aircraft.combat)
        .sort(
          (a, b) =>
            rangeBetween(a.flightPos, contact.pos) - rangeBetween(b.flightPos, contact.pos),
        )[0];
      if (!candidate) return { ok: false, message: "70 km 内没有可用的战斗巡逻机" };
      const flightTime = rangeBetween(candidate.flightPos, contact.pos) / Math.max(0.05, AIRCRAFT_TYPES[candidate.type].speed);
      candidate.visualTargetId = contact.id;
      track.visualRequest = {
        active: true,
        timeLeft: Math.min(120, Math.max(20, Math.round(flightTime) + 12)),
        aircraftId: candidate.id,
      };
      pushMessage(state, {
        channel: "CIC",
        tone: "info",
        text: `${candidate.callsign} 转向目标 ${track.id} 执行目视识别（预计 ${Math.round(flightTime)} s 抵达）。`,
        trackId: track.id,
        aircraftId: candidate.id,
      });
      return { ok: true, message: "目视识别已派遣" };
    }
    case "assign": {
      return assignMount(state, cmd.mountId, cmd.trackId);
    }
    case "unassign":
      return unassignMount(state, cmd.mountId, cmd.trackId ?? null);
    case "callEscort":
      return callEscort(state, cmd.trackId);
    case "intel":
      return requestIntel(state);
    case "sortie": {
      const aircraft = aircraftById(state, cmd.aircraftId);
      if (!aircraft) return { ok: false, message: "未找到飞机" };
      if (cmd.mission === "strike") {
        const target = targetTrackForStrike(state);
        if (!target) {
          return { ok: false, message: "没有满足火控条件的水面目标（需已判定敌对、质量 ≥ 45%）" };
        }
        aircraft.targetContactId = target.contactId;
      }
      const result = orderSortie(state, cmd.aircraftId, cmd.mission);
      if (result.ok) state.selected = { ...state.selected, aircraftId: aircraft.id };
      return result;
    }
    case "recall": {
      const aircraft = aircraftById(state, cmd.aircraftId);
      if (!aircraft) return { ok: false, message: "未找到飞机" };
      return recallAircraft(state, aircraft.id);
    }
    default:
      return { ok: false, message: `未知指令：${cmd.type}` };
  }
}

/* ── 主循环 ───────────────────────────────────────────────── */

export function step(state, dt) {
  if (state.phase !== "running" || state.paused) return state;
  const stepDt = Math.min(0.2, Math.max(0, dt));
  state.time = Math.min(state.duration, state.time + stepDt);
  state.tick += 1;

  updateOwnShip(state, stepDt);
  updateCapabilities(state);
  updateScenario(state);
  state.sensorAcc = (state.sensorAcc ?? 0) + stepDt;
  if (state.sensorAcc >= SENSOR_INTERVAL) {
    state.sensorAcc -= SENSOR_INTERVAL;
    updateSensors(state);
  }
  updateDeckOps(state, stepDt);
  updateAirOps(state, stepDt);
  updateDefense(state, stepDt);
  cleanupContacts(state);
  checkOutcome(state);
  return state;
}

function cleanupContacts(state) {
  state.contacts = state.contacts.filter((contact) => {
    if (contact.alive) return true;
    return state.time - (contact.destroyedAt ?? state.time) < 30;
  });
  state.tracks = state.tracks.filter((track) => {
    if (track.status === "destroyed") return state.time - (track.destroyedAt ?? state.time) < 12;
    return track.status !== "expired" && track.status !== "lost";
  });
}

function capName(name) {
  return name ? name.toUpperCase() : "";
}

export function checkOutcome(state) {
  if (state.phase !== "running") return;
  if (state.own.hull <= 0) {
    finishMission(state, "lost");
    return;
  }
  if (state.time >= state.duration) {
    finishMission(state, state.own.hull > 0 ? "won" : "lost");
    return;
  }
}

/* ── 便捷查询（UI / 测试） ─────────────────────────────────── */

export function getAirborneFighters(state) {
  return state.aircraft.filter((aircraft) => aircraft.state === "airborne" && aircraft.role === "fighter");
}

export function getTrackContact(state, track) {
  return state.contacts.find((contact) => contact.id === track.contactId) ?? null;
}

export function nearestIncomingMissile(state) {
  const missiles = state.contacts
    .filter((contact) => contact.alive && contact.kind === "asm")
    .map((contact) => ({ contact, range: rangeBetween(state.own.pos, contact.pos) }))
    .sort((a, b) => a.range - b.range);
  return missiles[0] ?? null;
}

export function threatLevel(state) {
  const missiles = state.contacts.filter((contact) => contact.alive && contact.kind === "asm");
  if (missiles.length) return "critical";
  if (state.tracks.some((track) => track.status === "active" && track.threat >= 70)) return "high";
  if (state.tracks.some((track) => track.status === "active" && track.threat >= 40)) return "elevated";
  return "normal";
}

export function simulationHash(state) {
  const compact = {
    time: Number(state.time.toFixed(2)),
    hull: Number(state.own.hull.toFixed(2)),
    score: state.score,
    phase: state.phase,
    aircraft: state.aircraft.map((aircraft) => [
      aircraft.id,
      aircraft.state,
      Number(aircraft.fuel.toFixed(1)),
      Number((aircraft.flightPos?.x ?? 0).toFixed(2)),
      Number((aircraft.flightPos?.y ?? 0).toFixed(2)),
      aircraft.mission,
      aircraft.harpoons,
    ]),
    contacts: state.contacts
      .filter((contact) => contact.alive)
      .map((contact) => [contact.id, contact.kind, Number(contact.pos.x.toFixed(2)), Number(contact.pos.y.toFixed(2)), contact.hp]),
    tracks: state.tracks.map((track) => [track.id, track.classified, Number(track.quality.toFixed(2)), track.status]),
    mounts: state.mounts.map((mount) => [mount.id, mount.ammo, mount.assigned.length, Number(mount.cooldown.toFixed(1))]),
    stats: state.stats,
  };
  return JSON.stringify(compact);
}
