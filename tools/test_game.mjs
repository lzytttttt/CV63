#!/usr/bin/env node
/**
 * v1.1 作战核心回归测试。
 * 不需要浏览器：直接驱动纯 JS 推演，验证规则、甲板约束、确定性与平衡。
 *
 *   node tools/test_game.mjs
 */

import assert from "node:assert/strict";
import {
  createSimulation,
  command,
  step,
  simulationHash,
} from "../src/game/sim.js";
import {
  AIRCRAFT_TYPES,
  DECK_SPOTS,
  DECK_TIMING,
  WAIST_CATS,
} from "../src/game/constants.js";
import {
  CATAPULTS,
  ISLAND,
  SHIP,
  deckContains,
} from "../src/model/constants.js";
import { assignMount, canEngage, deployChaff } from "../src/game/defense.js";
import { spawnContact } from "../src/game/contacts.js";
import { rangeBetween } from "../src/game/geo.js";

let passed = 0;
let failed = 0;
const failures = [];
const started = performance.now();

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    process.stdout.write(`  ✗ ${name}\n      ${error.message}\n`);
  }
}

function runFor(state, seconds) {
  const steps = Math.round(seconds / 0.1);
  for (let i = 0; i < steps; i += 1) {
    if (state.phase !== "running") break;
    step(state, 0.1);
  }
  return state;
}

function runUntil(state, predicate, maxSeconds = 180) {
  const steps = Math.round(maxSeconds / 0.1);
  for (let i = 0; i < steps; i += 1) {
    if (state.phase !== "running") break;
    if (predicate(state)) return true;
    step(state, 0.1);
  }
  return predicate(state);
}

function startedState(seed = 7) {
  const state = createSimulation({ seed });
  command(state, { type: "start" });
  return state;
}

function injectTrack(state, opts = {}) {
  const contact = spawnContact(state, {
    kind: "asm",
    identity: "hostile",
    pos: opts.pos ?? { x: 10, y: 0 },
    course: 270,
    speed: 0.7,
    hp: 1,
    role: "asm",
  });
  const track = {
    id: "TRK-TEST",
    contactId: contact.id,
    kind: "asm",
    kindHint: "asm",
    symbol: "missile",
    typeLabel: "反舰导弹",
    identity: null,
    classified: opts.classified ?? "hostile",
    identified: true,
    bearingOnly: false,
    quality: opts.quality ?? 0.85,
    source: "radar",
    pos: { ...contact.pos },
    bearing: 90,
    range: 10,
    speed: 0.7,
    course: 270,
    altitude: 0.03,
    threat: 100,
    engagedBy: [],
    status: "active",
    createdAt: state.time,
    updatedAt: state.time,
    lastLostAt: null,
    notes: [],
    manual: false,
  };
  state.tracks.push(track);
  return { contact, track };
}

function optimalRun(seed = 7) {
  const state = createSimulation({ seed });
  command(state, { type: "start" });
  command(state, { type: "autoSam", value: true });
  const done = new Set();
  const once = (key, fn) => {
    if (done.has(key)) return;
    done.add(key);
    fn();
  };
  let ticks = 0;
  while (state.time < 610 && state.phase === "running" && ticks < 6200) {
    const t = state.time;
    if (t >= 10) {
      once("aew", () => command(state, { type: "sortie", aircraftId: "hawkeye-1", mission: "aew" }));
    }
    if (t >= 18) {
      once("ew", () => command(state, { type: "sortie", aircraftId: "prowler-1", mission: "ew" }));
    }
    if (t >= 25) {
      once("cap1", () => command(state, { type: "sortie", aircraftId: "tomcat-1", mission: "cap" }));
    }
    if (t >= 30) {
      once("cap2", () => command(state, { type: "sortie", aircraftId: "tomcat-2", mission: "cap" }));
    }
    if (t >= 40) {
      const track = state.tracks.find((item) => item.kind === "destroyer" && item.status === "active");
      if (track) once("esm", () => command(state, { type: "esmFix", trackId: track.id }));
    }
    if (ticks % 20 === 0) {
      for (const track of state.tracks) {
        if (track.status !== "active" || track.classified !== "unknown" || track.identified) continue;
        if (track.bearingOnly) continue;
        if (track.kind === "destroyer" && track.quality >= 0.45) {
          command(state, { type: "classify", trackId: track.id, value: "hostile" });
        }
        if (["fighter", "strike"].includes(track.kind) && track.quality >= 0.5) {
          command(state, { type: "classify", trackId: track.id, value: "hostile" });
        }
      }
    }
    if (t >= 180) {
      const hasSurface = state.tracks.some(
        (track) => track.kind === "destroyer" && track.classified === "hostile",
      );
      if (hasSurface) {
        for (const id of ["hornet-1", "hornet-2", "hornet-3", "hornet-4"]) {
          once(`strike-${id}`, () => command(state, { type: "sortie", aircraftId: id, mission: "strike" }));
        }
      }
    }
    if (t >= 430) {
      once("cap3", () => command(state, { type: "sortie", aircraftId: "hornet-5", mission: "cap" }));
    }
    step(state, 0.1);
    ticks += 1;
  }
  return state;
}

process.stdout.write("\nCV-63 v1.1 作战核心测试\n");
process.stdout.write("────────────────────────────────────────\n");

test("初始状态：14 架飞机 / 12 个甲板机位 / 3 个机库位", () => {
  const state = createSimulation({ seed: 1 });
  assert.equal(state.aircraft.length, 14);
  assert.equal(state.spots.length, 12);
  assert.equal(state.hangarBays.length, 3);
  assert.equal(state.phase, "briefing");
  assert.equal(state.own.hull, 100);
  const deckReady = state.aircraft.filter((a) => a.state === "ready").length;
  assert.equal(deckReady, 11);
  assert.equal(state.aircraft.filter((a) => a.state === "hangar").length, 3);
});

test("简报阶段 step 不推进时间", () => {
  const state = createSimulation({ seed: 1 });
  runFor(state, 5);
  assert.equal(state.time, 0);
  command(state, { type: "start" });
  runFor(state, 2);
  assert.ok(state.time > 1.9);
});

test("甲板机位：除升降机平台外均落在飞行甲板轮廓内", () => {
  const elevatorSpots = new Set(["S10", "S11"]);
  DECK_SPOTS.forEach((spot) => {
    if (elevatorSpots.has(spot.id)) return;
    assert.ok(deckContains(spot.x, spot.z, -0.2), `${spot.id} 不在甲板轮廓内`);
  });
  for (const cat of CATAPULTS) {
    assert.ok(deckContains(cat.start[0], cat.start[1], -0.5), `${cat.id} 起点不在甲板内`);
    assert.ok(deckContains(cat.end[0], cat.end[1], -0.5), `${cat.id} 终点不在甲板内`);
  }
});

test("弹射器：E-2C 只能使用腰部弹射器", () => {
  const state = startedState();
  command(state, { type: "sortie", aircraftId: "hawkeye-1", mission: "aew" });
  let used = null;
  runUntil(state, () => {
    const aircraft = state.aircraft.find((a) => a.id === "hawkeye-1");
    if (aircraft.launchCat) used = aircraft.launchCat;
    return aircraft.state === "airborne";
  }, 150);
  const aircraft = state.aircraft.find((a) => a.id === "hawkeye-1");
  assert.equal(aircraft.state, "airborne");
  assert.ok(WAIST_CATS.includes(used), `E-2C 使用了 ${used}`);
  assert.equal(state.stats.launched, 1);
});

test("甲板班组：同时最多 2 架处于弹射流程", () => {
  const state = startedState();
  for (const id of ["tomcat-1", "tomcat-2", "hornet-3", "hornet-4"]) {
    command(state, { type: "sortie", aircraftId: id, mission: "cap" });
  }
  let maxBusy = 0;
  let maxCat = 0;
  for (let i = 0; i < 2200; i += 1) {
    step(state, 0.1);
    const busy = state.launchCrews.filter((crew) => crew.aircraftId).length;
    maxBusy = Math.max(maxBusy, busy);
    maxCat = Math.max(maxCat, state.aircraft.filter((a) => ["taxi", "hook", "stroke"].includes(a.state)).length);
    if (state.aircraft.filter((a) => a.state === "airborne").length >= 4) break;
  }
  assert.ok(maxBusy <= DECK_TIMING.launchCrews, `同时占用班组 ${maxBusy}`);
  assert.ok(maxCat <= DECK_TIMING.launchCrews + 1, `同时弹射流程 ${maxCat}`);
  assert.equal(state.aircraft.filter((a) => a.state === "airborne").length, 4);
});

test("甲板班组：第 3 架排队等待，不会越过班组上限", () => {
  const state = startedState();
  command(state, { type: "sortie", aircraftId: "tomcat-1", mission: "cap" });
  command(state, { type: "sortie", aircraftId: "tomcat-2", mission: "cap" });
  command(state, { type: "sortie", aircraftId: "tomcat-3", mission: "cap" });
  runFor(state, 1);
  const queued = state.aircraft.filter((a) => a.state === "queued").length;
  assert.ok(queued >= 1, "第三架应仍在队列");
  const busy = state.launchCrews.filter((crew) => crew.aircraftId).length;
  assert.equal(busy, 2);
});

test("机库飞机：需要升降机与空闲机位，流程可完成", () => {
  const state = startedState();
  const result = command(state, { type: "sortie", aircraftId: "hangar-fa18", mission: "cap" });
  assert.equal(result.ok, true);
  const aircraft = state.aircraft.find((a) => a.id === "hangar-fa18");
  assert.equal(aircraft.state, "elevating");
  const lift = Object.values(state.elevators).find((item) => item.aircraftId === "hangar-fa18");
  assert.ok(lift);
  runFor(state, 40);
  assert.ok(["spotting", "queued", "taxi", "hook", "stroke", "airborne"].includes(aircraft.state));
  runFor(state, 80);
  assert.equal(aircraft.state, "airborne");
});

test("回收作业期间腰部弹射器不可用", () => {
  const state = startedState();
  command(state, { type: "sortie", aircraftId: "tomcat-1", mission: "cap" });
  runUntil(state, () => state.aircraft.find((a) => a.id === "tomcat-1").state === "airborne", 120);
  command(state, { type: "recall", aircraftId: "tomcat-1" });
  runUntil(state, () => Boolean(state.recovery.active), 240);
  assert.ok(state.recovery.active, "应进入回收作业");
  const result = command(state, { type: "sortie", aircraftId: "hawkeye-1", mission: "aew" });
  assert.equal(result.ok, true);
  runFor(state, 30);
  const aew = state.aircraft.find((a) => a.id === "hawkeye-1");
  assert.ok(
    ["queued", "ready"].includes(aew.state),
    `回收期间 E-2C 不应开始腰部弹射（实际 ${aew.state}）`,
  );
});

test("召回与回收：CAP 可返航、拦阻、补给并恢复待命", () => {
  const state = startedState();
  command(state, { type: "sortie", aircraftId: "tomcat-1", mission: "cap" });
  runUntil(state, () => state.aircraft.find((a) => a.id === "tomcat-1").state === "airborne", 120);
  command(state, { type: "recall", aircraftId: "tomcat-1" });
  runUntil(state, () => state.aircraft.find((a) => a.id === "tomcat-1").state === "ready", 300);
  const aircraft = state.aircraft.find((a) => a.id === "tomcat-1");
  assert.equal(aircraft.state, "ready");
  assert.ok(aircraft.spotId, "回收后应重新分配停机位");
  assert.equal(state.spots.find((spot) => spot.id === aircraft.spotId).aircraftId, aircraft.id);
  assert.equal(state.stats.traps, 1);
});

test("火控规则：质量不足 / 方位线 / 射界外 / 静默 均拒绝", () => {
  const state = startedState();
  const { contact, track } = injectTrack(state, { quality: 0.3 });
  assert.equal(canEngage(state, state.mounts[0], track).ok, false);
  track.quality = 0.85;
  track.bearingOnly = true;
  assert.equal(canEngage(state, state.mounts[0], track).ok, false);
  track.bearingOnly = false;
  contact.pos = { x: -10, y: 0 };
  assert.equal(canEngage(state, state.mounts[0], track).ok, false);
  contact.pos = { x: 10, y: 0 };
  state.emcon = "silent";
  const silent = canEngage(state, state.mounts[0], track);
  assert.equal(silent.ok, false);
  assert.match(silent.reason, /EMCON/);
  state.emcon = "active";
  const ok = canEngage(state, state.mounts[0], track);
  assert.equal(ok.ok, true);
});

test("火控规则：指派后按装填周期开火并消耗弹药", () => {
  const state = startedState();
  const { track } = injectTrack(state);
  const mount = state.mounts[0];
  const before = mount.ammo;
  const result = assignMount(state, mount.id, track.id);
  assert.equal(result.ok, true);
  step(state, 0.1);
  assert.equal(mount.ammo, before - 1);
  assert.ok(mount.assigned.includes(track.id));
});

test("软杀伤：箔条只在 11 km 内可用，并消耗载荷", () => {
  const state = startedState();
  const before = state.chaff;
  const tooFar = injectTrack(state, { pos: { x: 20, y: 0 } });
  const rejected = deployChaff(state);
  assert.equal(rejected.ok, false);
  assert.equal(state.chaff, before);
  tooFar.contact.alive = false;

  const near = injectTrack(state, { pos: { x: 10, y: 0 } });
  const originalChance = state.rng.chance;
  state.rng.chance = () => true;
  const result = deployChaff(state);
  state.rng.chance = originalChance;
  assert.equal(result.ok, true);
  assert.equal(state.chaff, before - 1);
  assert.equal(near.contact.alive, false);
  assert.equal(state.stats.chaffUsed, 1);
});

test("EMCON：雷达静默时不会产生舰载雷达航迹，ESM 方位线仍存在", () => {
  const state = startedState();
  command(state, { type: "emcon", value: "silent" });
  runFor(state, 20);
  const surfaceTracks = state.tracks.filter((track) => track.kind === "destroyer");
  assert.ok(surfaceTracks.length > 0);
  assert.ok(surfaceTracks.every((track) => track.source !== "radar"));
  command(state, { type: "emcon", value: "active" });
  runFor(state, 5);
  assert.equal(state.capabilities.radar, true);
});

test("IFF：民航目标应答并识别为中立", () => {
  const state = startedState();
  runUntil(state, () => state.tracks.some((track) => track.kind === "airliner"), 40);
  const track = state.tracks.find((item) => item.kind === "airliner");
  assert.ok(track, "应发现民航航迹");
  command(state, { type: "identify", trackId: track.id });
  runFor(state, 6);
  assert.equal(track.identified, true);
  assert.equal(track.classified, "neutral");
});

test("确定性：相同种子 + 相同命令序列 → 相同状态哈希", () => {
  const a = optimalRun(7);
  const b = optimalRun(7);
  assert.equal(simulationHash(a), simulationHash(b));
  assert.equal(a.time.toFixed(1), b.time.toFixed(1));
  assert.equal(a.score, b.score);
});

test("平衡：完全被动会在 10 分钟内失去航母", () => {
  const state = startedState(7);
  runFor(state, 620);
  assert.equal(state.phase, "lost");
  assert.equal(Math.round(state.own.hull), 0);
  assert.equal(state.result?.grade, "D");
});

test("平衡：完整指挥链可以保持航母战斗力并取得评级", () => {
  const state = optimalRun(7);
  assert.equal(state.phase, "won", `结果 ${state.phase}，舰体 ${state.own.hull}`);
  assert.ok(state.own.hull > 20, `舰体仅剩 ${state.own.hull}`);
  assert.ok(state.result);
  assert.ok(["S", "A", "B"].includes(state.result.grade));
  assert.ok(state.stats.launched >= 7, `只出动 ${state.stats.launched} 架次`);
  assert.ok(state.stats.missilesIntercepted >= 3);
});

test("数值健康：长时间推演无 NaN / 非法速度 / 负弹药", () => {
  const state = optimalRun(7);
  const numbers = [
    state.own.hull,
    state.own.pos.x,
    state.own.pos.y,
    ...state.aircraft.flatMap((a) => [a.fuel, a.flightPos.x, a.flightPos.y, a.health]),
    ...state.mounts.flatMap((m) => [m.ammo, m.cooldown]),
    ...state.tracks.flatMap((t) => [t.quality, t.threat, t.bearing]),
  ];
  assert.ok(numbers.every((value) => Number.isFinite(value)), "存在非有限数值");
  assert.ok(state.mounts.every((m) => m.ammo >= 0));
  assert.ok(state.aircraft.every((a) => a.fuel >= 0));
});

test("性能：6000 个 0.1 s 步进小于 1.5 s", () => {
  const state = createSimulation({ seed: 3 });
  command(state, { type: "start" });
  command(state, { type: "autoSam", value: true });
  const t0 = performance.now();
  for (let i = 0; i < 6000; i += 1) step(state, 0.1);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 1500, `耗时 ${elapsed.toFixed(0)} ms`);
  process.stdout.write(`      （6000 步 ${elapsed.toFixed(0)} ms，舰体 ${state.own.hull.toFixed(0)}）\n`);
});

process.stdout.write("────────────────────────────────────────\n");
if (failed) {
  process.stdout.write(`✗ ${passed} passed, ${failed} failed\n`);
  for (const failure of failures) {
    process.stdout.write(`\n${failure.name}\n${failure.error.stack}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`✓ ${passed} passed in ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
}
