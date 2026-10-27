/**
 * v1.1 作战模式控制器：推演循环 + CIC 界面 + 三维桥接。
 */

import { createSimulation, command as applyCommand, step } from "./sim.js";
import { createCIC } from "./cic.js";
import { createGameBridge } from "./bridge3d.js";

const FIXED_STEP = 0.1;

export function createCombatGame({
  ship,
  api,
  effects,
  camera,
  scene,
  controls,
  hooks = {},
  seed = 0x1c63,
}) {
  let state = createSimulation({ seed });
  let active = false;
  let accumulator = 0;
  let simulationSeed = seed;

  const bridge = createGameBridge({
    ship,
    api,
    effects,
    camera,
    scene,
    controls,
    hooks: {
      onImpact: () => ui.flashImpact(),
    },
  });

  const ui = createCIC({
    getState: () => state,
    dispatch: (cmd) => dispatch(cmd),
    onExit: () => exit(),
    onRestart: () => restart(),
    onDeckView: (enabled) => {
      hooks.deckView?.(enabled);
    },
  });

  function dispatch(cmd) {
    if (!active && cmd.type !== "start") {
      return { ok: false, message: "作战台未激活" };
    }
    if (state.phase === "briefing" && cmd.type !== "start") {
      return { ok: false, message: "请先开始作战" };
    }
    return applyCommand(state, cmd);
  }

  function enter() {
    if (active) return;
    active = true;
    state.paused = state.phase === "running" ? false : state.paused;
    hooks.enter?.();
    bridge.activate();
    ui.show();
    accumulator = 0;
  }

  function exit() {
    if (!active) return;
    active = false;
    state.paused = true;
    bridge.deactivate();
    ui.hide();
    hooks.exit?.();
  }

  function restart() {
    state = createSimulation({ seed: simulationSeed });
    accumulator = 0;
    ui.show();
    ui.openBriefing();
  }

  function update(dt) {
    if (!active) return;
    if (state.phase === "running" && !state.paused) {
      accumulator += Math.min(dt, 0.25) * state.speed;
      let guard = 0;
      while (accumulator >= FIXED_STEP && guard < 120) {
        step(state, FIXED_STEP);
        accumulator -= FIXED_STEP;
        guard += 1;
        if (state.phase !== "running") break;
      }
      if (accumulator > 1) accumulator = 1;
    }
    bridge.update(dt, state);
    ui.update(dt);
  }

  /** 截图 / 回归测试：脱离 rAF 推进指定秒数 */
  function advance(seconds = 1, { start = true } = {}) {
    if (!active) enter();
    if (start && state.phase === "briefing") ui.begin();
    let remaining = Math.max(0, seconds);
    let guard = 0;
    while (remaining > 1e-4 && guard < 200000) {
      const dt = Math.min(FIXED_STEP, remaining);
      step(state, dt);
      remaining -= dt;
      guard += 1;
      if (state.phase !== "running") break;
    }
    bridge.update(1 / 60, state);
    ui.update(0.12);
    return state;
  }

  function setDeckView(enabled) {
    ui.setDeckView(enabled);
  }

  return {
    enter,
    exit,
    restart,
    update,
    advance,
    setDeckView,
    get active() {
      return active;
    },
    get state() {
      return state;
    },
    command: (cmd) => dispatch(cmd),
    get ui() {
      return ui;
    },
    get bridge() {
      return bridge;
    },
    setSeed(value) {
      simulationSeed = value;
    },
    destroy() {
      exit();
    },
  };
}
