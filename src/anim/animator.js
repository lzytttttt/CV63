/**
 * 动效导演：逐帧更新器 + 序列时间轴 + 命名节点。
 * 所有区块通过 ctx.anim 注册自己的连续动效（雷达、螺旋桨、灯光），
 * 序列负责一次性演出（弹射、着舰、升降机转运、拆解、巡航镜头）。
 */
export class Animator {
  constructor(api = {}) {
    this.api = api;
    this.updaters = [];
    this.nodes = new Map();
    this.sequences = new Map();
    this.active = null;
    this.time = 0;
    this.speed = 1;
    this.paused = false;
    this.onState = null;
    this.listeners = new Set();
  }

  /** 注册逐帧更新；返回取消函数 */
  addUpdate(fn) {
    this.updaters.push(fn);
    return () => {
      const index = this.updaters.indexOf(fn);
      if (index >= 0) this.updaters.splice(index, 1);
    };
  }

  /** 注册命名节点，供序列 / 相机 / 标签使用 */
  node(name, object) {
    this.nodes.set(name, object);
    return object;
  }

  get(name) {
    return this.nodes.get(name);
  }

  /** 注册动效序列定义 */
  registerSequence(name, definition) {
    this.sequences.set(name, {
      name,
      label: definition.label ?? name,
      hint: definition.hint ?? "",
      duration: definition.duration ?? 8,
      loop: definition.loop ?? false,
      setup: definition.setup,
      update: definition.update,
      finish: definition.finish,
      cameraLocked: definition.cameraLocked ?? true,
    });
  }

  getSequence(name) {
    return this.sequences.get(name);
  }

  listSequences() {
    return [...this.sequences.values()];
  }

  play(name, options = {}) {
    const definition = this.sequences.get(name);
    if (!definition) return false;
    if (this.active && this.active.definition.name === name && !options.restart) return true;
    if (this.active) this.#finishActive({ silent: true });
    const sequence = {
      definition,
      t: 0,
      elapsed: 0,
      data: {},
      api: this.api,
    };
    this.active = sequence;
    definition.setup?.(sequence);
    this.api.onSequenceStart?.(definition, sequence);
    this.#notify();
    return true;
  }

  stop(options = {}) {
    if (!this.active) return;
    this.#finishActive(options);
  }

  setSpeed(value) {
    this.speed = Math.min(3, Math.max(0.15, value));
    this.#notify();
  }

  setPaused(value) {
    this.paused = Boolean(value);
    this.#notify();
  }

  isPlaying() {
    return Boolean(this.active) && !this.paused;
  }

  getProgress() {
    if (!this.active) return 0;
    return Math.min(1, this.active.t / Math.max(0.001, this.active.definition.duration));
  }

  #finishActive({ silent = false } = {}) {
    if (!this.active) return;
    const sequence = this.active;
    sequence.definition.finish?.(sequence);
    this.active = null;
    if (!silent) this.api.onSequenceEnd?.(sequence.definition, sequence);
    this.#notify();
  }

  #notify() {
    const payload = {
      active: this.active?.definition.name ?? null,
      label: this.active?.definition.label ?? null,
      progress: this.getProgress(),
      paused: this.paused,
      speed: this.speed,
    };
    this.onState?.(payload);
    this.listeners.forEach((listener) => listener(payload));
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(dt) {
    const clamped = Math.min(0.06, Math.max(0, dt));
    const scaled = clamped * this.speed * (this.paused ? 0 : 1);
    this.time += scaled;
    for (const updater of this.updaters) {
      updater(scaled, this.time, clamped);
    }
    if (this.active) {
      const sequence = this.active;
      sequence.elapsed += scaled;
      sequence.t = Math.min(sequence.definition.duration, sequence.t + scaled);
      const progress = sequence.t / Math.max(0.001, sequence.definition.duration);
      sequence.definition.update?.(sequence.t, scaled, progress, sequence);
      if (sequence.t >= sequence.definition.duration) {
        if (sequence.definition.loop) {
          sequence.t = 0;
          sequence.definition.setup?.(sequence);
        } else {
          this.#finishActive();
        }
      }
    }
    if (this.active) this.#notify();
  }
}

/** 序列内常用的时间窗工具：返回 0..1 的缓动进度 */
export function window01(t, start, end, ease = (x) => x) {
  if (t <= start) return 0;
  if (t >= end) return 1;
  return ease((t - start) / (end - start));
}

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
};
