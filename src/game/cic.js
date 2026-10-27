/**
 * v1.1 作战模式 UI：CIC 控制台。
 * 只通过 dispatch(command) 改变推演状态；显示层每 0.12 s 重绘一次。
 */

import "./cic.css";
import { ANGLED_DECK, CATAPULTS, DECK_OUTLINE, DECK_BOUNDS, ELEVATORS, ISLAND, SHIP } from "../model/constants.js";
import { AIRCRAFT_STATE_LABEL, AIRCRAFT_TYPES, MISSION } from "./constants.js";
import { CLASSIFICATION_LABEL, SOURCE_LABEL } from "./sensors.js";
import {
  clamp,
  formatBearing,
  formatClock,
  formatRange,
  formatSpeed,
  qualityBand,
} from "./geo.js";
import { objectiveSummary, targetTrackForStrike } from "./scenario.js";
import { mountStatus } from "./defense.js";
import { rangeBetween } from "./geo.js";

const RANGE_KM = 200;
const SPEEDS = [1, 2, 4];

const DECK_W = 320;
const DECK_H = 124;
const DECK_PAD = 5;
const Z_SPAN = SHIP.sternZ - SHIP.bowZ;
const X_SPAN = DECK_BOUNDS.maxX - DECK_BOUNDS.minX;

function px(z) {
  return DECK_PAD + ((z - SHIP.bowZ) / Z_SPAN) * (DECK_W - DECK_PAD * 2);
}
function py(x) {
  return DECK_H - DECK_PAD - ((x - DECK_BOUNDS.minX) / X_SPAN) * (DECK_H - DECK_PAD * 2);
}
function planePoint(x, z) {
  return `${px(z).toFixed(1)},${py(x).toFixed(1)}`;
}

function deckMapSVG() {
  const outline =
    DECK_OUTLINE.map(([x, z], index) => `${index === 0 ? "M" : "L"}${planePoint(x, z)}`).join(" ") + " Z";

  const stern = ANGLED_DECK.centerStern;
  const bow = ANGLED_DECK.centerBow;
  const dx = bow[0] - stern[0];
  const dz = bow[1] - stern[1];
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const half = ANGLED_DECK.width / 2;
  const stripCorners = [
    [stern[0] + nx * half, stern[1] + nz * half],
    [bow[0] + nx * half, bow[1] + nz * half],
    [bow[0] - nx * half, bow[1] - nz * half],
    [stern[0] - nx * half, stern[1] - nz * half],
  ]
    .map(([x, z]) => planePoint(x, z))
    .join(" ");

  const cats = CATAPULTS.map(
    (cat, index) =>
      `<line class="deck-cat" data-cat="${cat.id}" x1="${px(cat.start[1]).toFixed(1)}" y1="${py(cat.start[0]).toFixed(1)}" x2="${px(cat.end[1]).toFixed(1)}" y2="${py(cat.end[0]).toFixed(1)}"/>` +
      `<text class="deck-label" x="${((px(cat.start[1]) + px(cat.end[1])) / 2).toFixed(1)}" y="${(py((cat.start[0] + cat.end[0]) / 2) - 2).toFixed(1)}">C${index + 1}</text>`,
  ).join("");

  const lifts = ELEVATORS.map((lift) => {
    const x0 = Math.min(px(lift.z - lift.length / 2), px(lift.z + lift.length / 2));
    const x1 = Math.max(px(lift.z - lift.length / 2), px(lift.z + lift.length / 2));
    const y0 = Math.min(py(lift.inner), py(lift.outer));
    const y1 = Math.max(py(lift.inner), py(lift.outer));
    return `<rect class="deck-lift" data-lift="${lift.id}" x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}"/><text class="deck-label" x="${x0.toFixed(1)}" y="${(y0 - 1).toFixed(1)}">${lift.id}</text>`;
  }).join("");

  const island = `<rect class="deck-island" x="${px(ISLAND.z - ISLAND.length / 2).toFixed(1)}" y="${py(ISLAND.x + ISLAND.width / 2).toFixed(1)}" width="${(px(ISLAND.z + ISLAND.length / 2) - px(ISLAND.z - ISLAND.length / 2)).toFixed(1)}" height="${(py(ISLAND.x - ISLAND.width / 2) - py(ISLAND.x + ISLAND.width / 2)).toFixed(1)}"/><text class="deck-label" x="${px(ISLAND.z).toFixed(1)}" y="${(py(ISLAND.x) + 1.5).toFixed(1)}">ISLAND</text>`;

  return `
    <svg viewBox="0 0 ${DECK_W} ${DECK_H}" role="img" aria-label="飞行甲板调度图">
      <defs>
        <pattern id="deck-grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M8 0H0V8" fill="none" stroke="rgba(120,190,215,.06)" stroke-width=".3"/>
        </pattern>
      </defs>
      <rect width="${DECK_W}" height="${DECK_H}" fill="url(#deck-grid)" opacity=".7"/>
      <path class="deck-outline" d="${outline}"/>
      <polygon class="deck-strip" points="${stripCorners}"/>
      ${cats}
      ${lifts}
      ${island}
      <text class="deck-label" x="${px(SHIP.bowZ + 10).toFixed(1)}" y="${(DECK_H - 2).toFixed(1)}">BOW</text>
      <text class="deck-label" x="${(DECK_W - 18).toFixed(1)}" y="${(DECK_H - 2).toFixed(1)}">STERN</text>
      <g id="cic-ac-layer"></g>
    </svg>
  `;
}

function iconGlyph() {
  return `<path d="M0,-5.2 L3.7,4.7 L0,2.5 L-3.7,4.7 Z"></path>`;
}

export function createCIC({ getState, dispatch, onExit, onRestart, onDeckView }) {
  const root = document.createElement("div");
  root.className = "cic";
  root.id = "cic";
  root.hidden = true;
  document.body.appendChild(root);

  root.innerHTML = `
    <header class="cic-top">
      <div class="cic-brand">
        <span class="cic-sigil">CIC</span>
        <div>
          <b>CV-63 · 战役指挥</b>
          <small>OPERATION IRON NEST / v1.1</small>
        </div>
      </div>
      <div class="cic-clockbox">
        <span>MISSION CLOCK</span>
        <b id="cic-clock">00:00</b>
        <div class="cic-timeline"><i id="cic-timebar"></i></div>
      </div>
      <div class="cic-statusrow">
        <div class="cic-status" id="cic-status-threat"><span>THREAT</span><b>正常</b></div>
        <div class="cic-status" id="cic-status-hull"><span>HULL</span><b>100</b></div>
        <div class="cic-status"><span>AIRBORNE</span><b id="cic-air">00</b></div>
        <div class="cic-status"><span>READY</span><b id="cic-ready">00</b></div>
      </div>
      <div class="cic-actions">
        <div class="cic-speed" id="cic-speed">
          ${SPEEDS.map((value) => `<button type="button" data-act="speed" data-speed="${value}">${value}×</button>`).join("")}
        </div>
        <button class="cic-iconbtn" id="cic-pause" data-act="pause" type="button" title="暂停 / 继续">Ⅱ</button>
        <button class="cic-textbtn" id="cic-deck" data-act="deck" type="button">甲板视角</button>
        <button class="cic-iconbtn" id="cic-help" data-act="help" type="button" title="操作与规则">?</button>
        <button class="cic-textbtn is-danger" id="cic-exit" data-act="exit" type="button">退出</button>
      </div>
    </header>

    <aside class="cic-side cic-left">
      <section class="cic-panel cic-deckpanel">
        <header class="cic-panel-head">
          <span class="cic-index">01</span>
          <div><h2>甲板调度</h2><p>FLIGHT DECK OPS</p></div>
          <b id="cic-crews">L2 · S3</b>
        </header>
        <div class="cic-deckmap">${deckMapSVG()}</div>
        <div class="cic-deckstats" id="cic-deckstats"></div>
      </section>
      <section class="cic-panel cic-rosterpanel">
        <header class="cic-panel-head">
          <span class="cic-index">02</span>
          <div><h2>机队</h2><p>AIRFRAMES / DECK ROSTER</p></div>
          <b id="cic-roster-count">14</b>
        </header>
        <div class="cic-roster" id="cic-roster"></div>
      </section>
    </aside>

    <main class="cic-center">
      <section class="cic-panel cic-scopepanel">
        <header class="cic-panel-head">
          <span class="cic-index">03</span>
          <div><h2>战术态势</h2><p>TACTICAL SCOPE · 200 KM · NORTH UP</p></div>
          <div class="cic-legend">
            <span style="color:#ff6a5f"><i></i>敌对</span>
            <span style="color:#ffb25c"><i></i>未识别</span>
            <span style="color:#76f6bd"><i class="neutral"></i>中立</span>
            <span style="color:#63e7ff"><i></i>友方</span>
          </div>
        </header>
        <div class="cic-scopewrap">
          <canvas id="cic-scope" aria-label="战术态势雷达图"></canvas>
          <div class="cic-threatbanner" id="cic-alert" hidden>反舰导弹来袭 / INBOUND</div>
        </div>
      </section>
      <section class="cic-panel cic-trackspanel">
        <header class="cic-panel-head">
          <span class="cic-index">04</span>
          <div><h2>航迹表</h2><p>TRACK TABLE</p></div>
          <b id="cic-track-count">0</b>
        </header>
        <div class="cic-tracktable" id="cic-tracks"></div>
      </section>
    </main>

    <aside class="cic-side cic-right">
      <section class="cic-panel">
        <header class="cic-panel-head">
          <span class="cic-index">05</span>
          <div><h2>武器协同</h2><p>FIRE CONTROL</p></div>
          <b id="cic-mount-count">5</b>
        </header>
        <div class="cic-mounts" id="cic-mounts"></div>
        <div class="cic-hint" id="cic-weapon-hint"></div>
      </section>
      <section class="cic-panel">
        <header class="cic-panel-head">
          <span class="cic-index">06</span>
          <div><h2>信息与对抗</h2><p>EMCON / COUNTERMEASURES</p></div>
        </header>
        <div class="cic-toggle-row">
          <span>EMCON</span>
          <div class="cic-seg" id="cic-emcon">
            <button type="button" data-act="emcon" data-value="active">主动</button>
            <button type="button" data-act="emcon" data-value="silent">静默</button>
          </div>
        </div>
        <div class="cic-toggle-row">
          <span>ROE</span>
          <div class="cic-seg" id="cic-roe">
            <button type="button" data-act="roe" data-value="tight">严格识别</button>
            <button type="button" data-act="roe" data-value="free">自由开火</button>
          </div>
        </div>
        <div class="cic-chip-row" id="cic-counters"></div>
      </section>
      <section class="cic-panel">
        <header class="cic-panel-head">
          <span class="cic-index">07</span>
          <div><h2>损管</h2><p>DAMAGE CONTROL</p></div>
        </header>
        <div class="cic-dc" id="cic-dc"></div>
      </section>
    </aside>

    <section class="cic-bottom">
      <section class="cic-panel cic-dossier" id="cic-dossier"></section>
      <section class="cic-panel cic-logpanel">
        <header class="cic-panel-head">
          <span class="cic-index">08</span>
          <div><h2>通信与情报</h2><p>COMMS / INTELLIGENCE</p></div>
          <b id="cic-unread"></b>
        </header>
        <div class="cic-log" id="cic-log"></div>
      </section>
    </section>

    <div class="cic-deckhud" id="cic-deckhud">
      <h2>甲板作业 / DECK OPS</h2>
      <p id="cic-deck-hud-sub">CV-63 · LIVE DECK FEED</p>
      <div class="cic-deck-lines" id="cic-deck-hud-lines"></div>
      <div class="cic-buttons">
        <button class="cic-button" data-act="deck" type="button">返回战术台</button>
      </div>
    </div>

    <div class="cic-toast" id="cic-toast"></div>
    <div class="cic-flash" id="cic-flash"></div>
    <div class="cic-modal" id="cic-modal" role="dialog" aria-modal="true" aria-label="作战简报与结算" hidden></div>
  `;

  const el = {
    clock: root.querySelector("#cic-clock"),
    timebar: root.querySelector("#cic-timebar"),
    threat: root.querySelector("#cic-status-threat"),
    hull: root.querySelector("#cic-status-hull b"),
    air: root.querySelector("#cic-air"),
    ready: root.querySelector("#cic-ready"),
    speed: root.querySelector("#cic-speed"),
    pause: root.querySelector("#cic-pause"),
    crews: root.querySelector("#cic-crews"),
    deckStats: root.querySelector("#cic-deckstats"),
    rosterCount: root.querySelector("#cic-roster-count"),
    roster: root.querySelector("#cic-roster"),
    scope: root.querySelector("#cic-scope"),
    alert: root.querySelector("#cic-alert"),
    trackCount: root.querySelector("#cic-track-count"),
    tracks: root.querySelector("#cic-tracks"),
    mounts: root.querySelector("#cic-mounts"),
    mountCount: root.querySelector("#cic-mount-count"),
    weaponHint: root.querySelector("#cic-weapon-hint"),
    emcon: root.querySelector("#cic-emcon"),
    roe: root.querySelector("#cic-roe"),
    counters: root.querySelector("#cic-counters"),
    dc: root.querySelector("#cic-dc"),
    dossier: root.querySelector("#cic-dossier"),
    log: root.querySelector("#cic-log"),
    unread: root.querySelector("#cic-unread"),
    toast: root.querySelector("#cic-toast"),
    flash: root.querySelector("#cic-flash"),
    modal: root.querySelector("#cic-modal"),
    deckHud: root.querySelector("#cic-deckhud"),
    deckHudLines: root.querySelector("#cic-deck-hud-lines"),
    deckHudSub: root.querySelector("#cic-deck-hud-sub"),
    acLayer: root.querySelector("#cic-ac-layer"),
    deckCats: root.querySelectorAll("[data-cat]"),
    deckLifts: root.querySelectorAll("[data-lift]"),
  };

  const ctx = el.scope.getContext("2d");
  const selection = { trackId: null, aircraftId: null, mountId: null };
  const stateRef = { scopeHits: [] };
  let uiAcc = 0;
  let scopeAcc = 0;
  let toastTimer = 0;
  let flashTimer = 0;
  let resultShown = false;
  let deckView = false;
  let active = false;
  let logPinned = true;
  let lastLogCount = 0;
  let deckNative = { w: 0, h: 0, dpr: 1 };
  let resizeObserver = null;

  // 飞机图标
  const iconMap = new Map();
  root.querySelectorAll(".cic-ac-row").forEach(() => {});

  function ensureIcons(state) {
    if (iconMap.size) return;
    el.acLayer.innerHTML = "";
    state.aircraft.forEach((aircraft) => {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "cic-ac");
      g.setAttribute("data-act", "aircraft");
      g.setAttribute("data-aircraft", aircraft.id);
      g.innerHTML = iconGlyph();
      el.acLayer.appendChild(g);
      iconMap.set(aircraft.id, g);
    });
  }

  function showToast(text, isError = false) {
    el.toast.textContent = text;
    el.toast.classList.toggle("is-error", isError);
    el.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.toast.classList.remove("is-visible"), 2400);
  }

  function flashImpact() {
    el.flash.classList.remove("is-hit");
    void el.flash.offsetWidth;
    el.flash.classList.add("is-hit");
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => el.flash.classList.remove("is-hit"), 600);
  }

  function openModal(html) {
    el.modal.innerHTML = `<div class="cic-modal-card">${html}</div>`;
    el.modal.hidden = false;
  }

  function closeModal() {
    el.modal.hidden = true;
    el.modal.innerHTML = "";
  }

  function briefingHTML() {
    return `
      <div class="cic-modal-eyebrow">MISSION BRIEF / 作战简报</div>
      <h2>“铁巢”反舰突击<small>OPERATION IRON NEST · 1989 西太平洋（架空）</small></h2>
      <p>“铁巢”水面编队正在责任区东北方展开，携带超音速反舰导弹；空中打击编队与护航战斗机将在 10 分钟内分批进入。CV-63 必须在保持自身战斗力的同时，识别威胁、组织甲板作业并协调舰载与舰载武器。</p>
      <div class="cic-brief-grid">
        <div class="cic-brief-item"><b>信息优先</b><span>ESM 只给方位线，IFF 对敌机无应答不等于敌对。用 E-2C、ESM 交叉定位与目视确认建立可火控航迹。</span></div>
        <div class="cic-brief-item"><b>甲板节奏</b><span>2 个弹射班组、3 个补给班组。E-2C/EA-6B 只能使用腰部弹射器，回收作业期间腰部弹射器暂停。</span></div>
        <div class="cic-brief-item"><b>武器配合</b><span>海麻雀需要 EMCON 主动才能制导；密集阵自动拦截漏网目标；箔条与 EA-6B 干扰用于软杀伤。</span></div>
        <div class="cic-brief-item"><b>交战规则</b><span>严格识别下 CAP 不会攻击未识别目标。误击民航/渔船会严重扣分。自由开火会承担识别风险。</span></div>
      </div>
      <ul class="cic-brief-list">
        <li>主要目标：坚持至 10:00，舰体保持 &gt; 0。</li>
        <li>加分目标：瘫痪“铁巢”编队、击落敌机、拦截导弹、避免误击、保存舰载机。</li>
        <li>操作顺序建议：放飞 E-2C → 建立航迹 → IFF/ESM/目视识别 → 放飞 CAP/打击包 → 管理回收与补给。</li>
        <li>按 <kbd>SPACE</kbd> 暂停，<kbd>1/2/4</kbd> 变速，<kbd>D</kbd> 切换甲板视角。</li>
      </ul>
      <div class="cic-modal-actions">
        <button class="cic-button is-primary" type="button" data-modal-action="start">开始作战 / START</button>
        <button class="cic-button" type="button" data-modal-action="help">规则与操作</button>
        <button class="cic-button" type="button" data-modal-action="exit">返回工作台</button>
      </div>
    `;
  }

  function helpHTML() {
    return `
      <div class="cic-modal-eyebrow">OPERATOR MANUAL / 操作手册</div>
      <h2>CIC 速览<small>INFORMATION → DECISION → ACTION</small></h2>
      <div class="cic-help-grid">
        <div class="cic-help-item"><b>态势</b>点击雷达图或航迹表选择目标；右键拖拽可旋转三维视角（甲板视角）。</div>
        <div class="cic-help-item"><b>识别</b>IFF 询问（5 s）识别合作目标；ESM 交叉定位（7 s）提升航迹质量；目视识别需要 CAP 在 70 km 内。</div>
        <div class="cic-help-item"><b>判定</b>未识别目标可人工判定为敌对/中立，但误判由指挥官承担。导弹航迹自动判定敌对。</div>
        <div class="cic-help-item"><b>开火</b>选中航迹后，在右侧武器栏点“指派所选”。海麻雀要求 EMCON 主动、航迹质量 ≥ 50%、目标在射界内。</div>
        <div class="cic-help-item"><b>软杀伤</b>箔条：11 km 内来袭导弹，70% 诱骗。干扰：需要 EA-6B 在空中。静默：降低被锁定概率，但海麻雀无法制导。</div>
        <div class="cic-help-item"><b>甲板</b>机队列表选择飞机 → 下方任务按钮。机库飞机需要空闲机位与 E1/E2 升降机；回收期间腰部弹射器不可用。</div>
        <div class="cic-help-item"><b>损管</b>3 个损管队自动按“火灾优先”派遣；系统修复后自动恢复在线。舰体归零即失败。</div>
        <div class="cic-help-item"><b>快捷键</b><kbd>SPACE</kbd>暂停 <kbd>1/2/4</kbd>变速 <kbd>D</kbd>甲板视角 <kbd>ESC</kbd>关闭弹层 <kbd>C</kbd>箔条 <kbd>I</kbd>情报</div>
      </div>
      <div class="cic-modal-actions">
        <button class="cic-button is-primary" type="button" data-modal-action="close">返回</button>
      </div>
    `;
  }

  function resultHTML(state) {
    const result = state.result;
    if (!result) return "";
    return `
      <div class="cic-modal-eyebrow">${result.outcome === "won" ? "MISSION COMPLETE / 任务达成" : "MISSION FAILED / 任务失败"}</div>
      <h2>${result.outcome === "won" ? "航母保持战斗力" : "航母失去战斗力"}<small>${result.outcome === "won" ? "IRON NEST 突击被挫败" : "推演终止"}</small></h2>
      <div class="cic-result-grade">
        <b>${result.grade}</b>
        <span>总分 ${result.score}<br/>推演时间 ${formatClock(result.time)}<br/>舰体 ${result.hull}%</span>
      </div>
      <div class="cic-result-lines">
        ${result.lines.map((line) => `<div>${line}</div>`).join("")}
      </div>
      <div class="cic-modal-actions">
        <button class="cic-button is-primary" type="button" data-modal-action="restart">重新推演</button>
        <button class="cic-button" type="button" data-modal-action="exit">返回工作台</button>
      </div>
    `;
  }

  function setDeckView(next) {
    deckView = Boolean(next);
    document.body.classList.toggle("cic-deck-view", deckView);
    root.querySelector("#cic-deck").textContent = deckView ? "返回战术台" : "甲板视角";
    onDeckView?.(deckView);
  }

  function trackType(track) {
    if (track.bearingOnly) return "ESM 方位线";
    if (track.identified) return track.typeLabel ?? "接触";
    if (track.symbol === "missile") return "反舰导弹";
    if (track.symbol === "surface") return "水面接触";
    return "空中接触";
  }

  function trackClassColor(track) {
    if (track.classified === "hostile") return "#ff6a5f";
    if (track.classified === "assumed-hostile") return "#ffb25c";
    if (track.classified === "neutral") return "#76f6bd";
    if (track.classified === "friendly") return "#63e7ff";
    return "#ffb25c";
  }

  function qualityBars(value, count = 5) {
    const on = Math.round(clamp(value, 0, 1) * count);
    return `<span class="cic-qbar">${Array.from({ length: count }, (_, index) => `<i class="${index < on ? "on" : ""}"></i>`).join("")}</span>`;
  }

  function renderHeader(state) {
    el.clock.textContent = formatClock(state.time);
    el.timebar.style.width = `${clamp(state.time / state.duration, 0, 1) * 100}%`;
    el.hull.textContent = String(Math.round(state.own.hull));
    const hullStatus = el.hull.closest(".cic-status");
    hullStatus.dataset.tone = state.own.hull < 30 ? "alert" : state.own.hull < 65 ? "warn" : "good";

    const airborne = state.aircraft.filter((a) => ["airborne", "inbound", "holding"].includes(a.state)).length;
    const ready = state.aircraft.filter((a) => a.state === "ready").length;
    el.air.textContent = String(airborne).padStart(2, "0");
    el.ready.textContent = String(ready).padStart(2, "0");

    const missiles = state.tracks.filter((track) => track.status === "active" && track.kind === "asm");
    const high = state.tracks.some((track) => track.status === "active" && track.threat >= 70);
    const elevated = state.tracks.some((track) => track.status === "active" && track.threat >= 40);
    const threat = state.phase === "lost" ? "失败" : missiles.length ? "导弹来袭" : high ? "高" : elevated ? "升高" : "正常";
    el.threat.querySelector("b").textContent = threat;
    el.threat.dataset.tone = missiles.length || high ? "alert" : elevated ? "warn" : "good";
    el.alert.hidden = missiles.length === 0;
    if (missiles.length) {
      const nearest = [...missiles].sort((a, b) => a.range - b.range)[0];
      const impact = Math.max(0, Math.round(nearest.range / Math.max(0.1, nearest.speed)));
      el.alert.textContent = `反舰导弹来袭 / INBOUND · ${missiles.length} 枚 · 最近 ${impact} s`;
    }

    el.speed.querySelectorAll("[data-speed]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.speed) === state.speed);
    });
    el.pause.textContent = state.paused ? "▶" : "Ⅱ";
    el.pause.classList.toggle("is-active", state.paused);

    el.emcon.querySelectorAll("[data-value]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.value === state.emcon);
    });
    el.roe.querySelectorAll("[data-value]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.value === state.roe);
      button.classList.toggle("is-warn", button.dataset.value === "free" && state.roe === "free");
      button.classList.toggle("is-danger", button.dataset.value === "free" && state.roe === "free");
    });

    // 通信未读
    el.unread.textContent = state.unread ? `${state.unread} NEW` : "";
  }

  function renderCounters(state) {
    const ewAirborne = state.capabilities.ewCount > 0;
    el.counters.innerHTML = `
      <button class="cic-chip ${state.jam ? "is-on" : ""}" type="button" data-act="jam" ${ewAirborne ? "" : "disabled"} title="需要 EA-6B 在空中">干扰 ${state.jam ? "ON" : "OFF"}</button>
      <button class="cic-chip is-warn" type="button" data-act="chaff" ${state.chaff > 0 && state.chaffCooldown <= 0 ? "" : "disabled"}>箔条 ${state.chaff}</button>
      <button class="cic-chip ${state.autoSam ? "is-on" : ""}" type="button" data-act="autoSam">自动海麻雀 ${state.autoSam ? "ON" : "OFF"}</button>
      <button class="cic-chip ${state.autoDefense ? "is-on" : ""}" type="button" data-act="autoDefense">密集阵自动 ${state.autoDefense ? "ON" : "OFF"}</button>
      <button class="cic-chip" type="button" data-act="intel">情报请求</button>
    `;
    const emconWarning =
      state.emcon === "silent"
        ? "<b>EMCON 静默</b>：海麻雀无法制导，仅密集阵/护航舰可用。来袭导弹被锁定概率下降。"
        : "<b>EMCON 主动</b>：雷达全功率，海麻雀可制导；敌方可获得更稳定的目标指示。";
    el.weaponHint.innerHTML = `${emconWarning}<br/>选中航迹 → 在武器栏点“指派所选”。自动海麻雀会按装填顺序接管来袭导弹。`;
  }

  function renderDeck(state) {
    ensureIcons(state);
    const visibleAircraft = state.aircraft.filter((a) => a.vis.visible && !["airborne", "inbound", "holding", "hangar", "lost", "destroyed"].includes(a.state));
    const visMap = new Map(visibleAircraft.map((a) => [a.id, a]));
    for (const aircraft of state.aircraft) {
      const icon = iconMap.get(aircraft.id);
      if (!icon) continue;
      const visible = visMap.has(aircraft.id);
      icon.style.display = visible ? "" : "none";
      if (!visible) continue;
      const point = aircraft.vis;
      const angle = Math.atan2(-Math.cos(point.yaw ?? 0), -Math.sin(point.yaw ?? 0));
      icon.setAttribute("transform", `translate(${px(point.z).toFixed(1)},${py(point.x).toFixed(1)}) rotate(${((angle * 180) / Math.PI).toFixed(1)})`);
      const status = aircraft.state === "ready" ? "is-ready" : ["queued", "elevating", "spotting", "taxi", "hook", "stroke", "service"].includes(aircraft.state) ? "is-queued" : aircraft.state === "lost" ? "is-lost" : "";
      icon.setAttribute("class", `cic-ac ${status} ${selection.aircraftId === aircraft.id ? "is-selected" : ""}`);
    }

    el.deckCats.forEach((line) => {
      const cat = state.cats[line.dataset.cat];
      line.classList.toggle("is-busy", cat.state !== "idle" || cat.cooldown > 0);
      line.classList.toggle("is-offline", !cat.online);
    });
    el.deckLifts.forEach((rect) => {
      const lift = state.elevators[rect.dataset.lift];
      rect.style.opacity = lift && (lift.state !== "idle" || !lift.online) ? "0.95" : "0.45";
    });

    const launchUsing = state.launchCrews.filter((crew) => crew.aircraftId).length;
    const serviceUsing = state.serviceCrews.filter((crew) => crew.aircraftId).length;
    const recovery = state.recovery.active
      ? state.aircraft.find((a) => a.id === state.recovery.active)?.callsign ?? "—"
      : state.recovery.queue?.length
        ? `排队 ${state.recovery.queue.length}`
        : "空闲";
    el.crews.textContent = `L${state.launchCrews.length}/${state.serviceCrews.length}`;
    el.deckStats.innerHTML = `
      <div><span>弹射班组</span><b>${launchUsing} / ${state.launchCrews.length}</b></div>
      <div><span>补给班组</span><b>${serviceUsing} / ${state.serviceCrews.length}</b></div>
      <div><span>着舰</span><b>${recovery}</b></div>
    `;
  }

  function renderRoster(state) {
    el.rosterCount.textContent = `${state.aircraft.filter((a) => a.health > 0).length} / ${state.aircraft.length}`;
    el.roster.innerHTML = state.aircraft
      .map((aircraft) => {
        const fuel = clamp(aircraft.fuel / aircraft.endurance, 0, 1);
        const mission = aircraft.mission ? MISSION[aircraft.mission]?.short : "";
        const statusLabel =
          aircraft.state === "airborne"
            ? `${mission || "AIR"} · 空中`
            : aircraft.state === "service"
              ? "补给中"
              : aircraft.state === "elevating"
                ? "升降机"
                : AIRCRAFT_STATE_LABEL[aircraft.state] ?? aircraft.state;
        return `
          <button class="cic-ac-row ${selection.aircraftId === aircraft.id ? "is-selected" : ""} ${aircraft.health <= 0 ? "is-lost" : ""}" type="button" data-act="aircraft" data-aircraft="${aircraft.id}" data-state="${aircraft.state}">
            <span class="cic-ac-dot"></span>
            <span class="cic-ac-copy">
              <b>${aircraft.callsign}</b>
              <small>${aircraft.short} · ${aircraft.spotId ?? aircraft.bayId ?? "AIR"} · ${statusLabel}</small>
            </span>
            <span class="cic-ac-side">
              <em>${mission || (aircraft.state === "airborne" ? "AIR" : "")}</em>
              <i><b style="width:${(fuel * 100).toFixed(0)}%;background:${fuel < 0.25 ? "var(--red)" : "var(--cyan)"}"></b></i>
            </span>
          </button>
        `;
      })
      .join("");
  }

  function renderTracks(state) {
    const tracks = state.tracks
      .filter((track) => track.status !== "expired" && track.status !== "lost")
      .sort((a, b) => b.threat - a.threat || a.range - b.range);    el.trackCount.textContent = String(tracks.length).padStart(2, "0");
    if (!tracks.length) {
      el.tracks.innerHTML = `<div class="cic-head">TRACK</div><div class="cic-empty">无航迹<br/>放飞 E-2C 或开启雷达建立态势</div>`;
      return;
    }
    const head = `<div class="cic-track-head"><span>ID</span><span>类型 / 判定</span><span>方位/距离</span><span>速度</span><span>质量</span><span>威胁</span></div>`;
    const rows = tracks.map((track) => {
      const statusSuffix = track.status === "destroyed" ? " · 已摧毁" : track.status === "stale" ? " · 丢失" : "";
      return `
        <button class="cic-track-row ${selection.trackId === track.id ? "is-selected" : ""}" type="button" data-act="track" data-track="${track.id}" data-class="${track.classified}">
          <span class="cic-tr-id">${track.id}</span>
          <span class="cic-tr-type"><i class="cic-sym ${track.symbol}"></i>${trackType(track)}<em style="color:${trackClassColor(track)}">${CLASSIFICATION_LABEL[track.classified] ?? track.classified}</em>${statusSuffix}</span>
          <span>${formatBearing(track.bearing)} / ${track.bearingOnly ? "—" : formatRange(track.range)}</span>
          <span>${formatSpeed(track.speed)}</span>
          <span>${qualityBars(track.quality)}</span>
          <span class="cic-tr-class">${track.threat > 0 ? Math.round(track.threat) : "—"}</span>
        </button>
      `;
    });
    el.tracks.innerHTML = head + rows.join("");
  }

  function renderMounts(state) {
    const selected = state.tracks.find((track) => track.id === selection.trackId);
    el.mountCount.textContent = state.mounts.filter((m) => m.online).length;
    el.mounts.innerHTML = state.mounts
      .map((mount) => {
        const status = mountStatus(state, mount);
        const isCiws = mount.kind === "ciws";
        const pips = isCiws ? 8 : mount.magazine;
        const on = isCiws ? Math.round((mount.ammo / mount.magazine) * 8) : mount.ammo;
        const chips = mount.assigned
          .map(
            (trackId) =>
              `<span class="cic-target-chip">${trackId}<button type="button" data-act="unassign" data-mount="${mount.id}" data-track="${trackId}" aria-label="解除">×</button></span>`,
          )
          .join("");
        const canAssign = selected && mount.kind !== "ciws";
        return `
          <div class="cic-mount" data-act="mount" data-mount="${mount.id}">
            <div class="cic-mount-top">
              <b>${mount.short}</b>
              <em class="cic-ammo-num">${mount.kind === "ciws" ? `${mount.ammo} 发` : `${mount.ammo} / ${mount.magazine}`}</em>
              <span data-state="${status.key}">${status.label}</span>
            </div>
            <div class="cic-ammo">${Array.from({ length: pips }, (_, index) => `<i class="${index < on ? "on" : ""} ${isCiws ? "is-ciws" : ""}"></i>`).join("")}</div>
            <div class="cic-mount-targets">${chips || `<span style="font-family:var(--mono);font-size:8px;color:var(--muted-2)">未指派目标</span>`}</div>
            <div class="cic-mount-actions">
              <button class="cic-mini" type="button" data-act="assign" data-mount="${mount.id}" ${canAssign ? "" : "disabled"}>指派所选</button>
              <button class="cic-mini" type="button" data-act="unassign" data-mount="${mount.id}" ${mount.assigned.length ? "" : "disabled"}>全部解除</button>
              ${mount.kind === "escort" ? `<button class="cic-mini" type="button" data-act="escort" ${selected ? "" : "disabled"}>呼叫护航舰</button>` : ""}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderDamage(state) {
    const fires = state.incidents.filter((i) => !i.done && i.type === "fire");
    const systems = Object.values(state.systems);
    el.dc.innerHTML = `
      <div class="cic-hullbar">
        <span>HULL</span>
        <div><i class="${state.own.hull < 45 ? "is-low" : ""}" style="width:${clamp(state.own.hull, 0, 100)}%"></i></div>
        <b>${Math.round(state.own.hull)}</b>
      </div>
      <div class="cic-systems">
        ${systems.map((system) => `<span class="cic-system ${system.online ? "is-on" : "is-off"}" title="${system.label}">${system.short}</span>`).join("")}
      </div>
      <div class="cic-incidents">
        ${
          state.incidents.filter((i) => !i.done).length
            ? state.incidents
                .filter((i) => !i.done)
                .map(
                  (incident) => `
                    <div class="cic-incident ${incident.teamId ? "is-team" : ""}">
                      <span>${incident.type === "fire" ? "火" : "修"} · ${incident.label}</span>
                      <i><b style="width:${Math.min(100, incident.progress * 100).toFixed(0)}%"></b></i>
                    </div>`,
                )
                .join("")
            : `<div style="font-family:var(--mono);font-size:8px;color:var(--muted-2)">无进行中的损管作业${fires.length ? "" : " · 全系统正常"}</div>`
        }
      </div>
      <div style="margin-top:5px;font-family:var(--mono);font-size:8px;color:var(--muted)">损管队 ${state.dcTeams.filter((team) => team.incidentId).length} / ${state.dcTeams.length} 作业中</div>
    `;
  }

  function selectedTrack(state) {
    return state.tracks.find((track) => track.id === selection.trackId) ?? null;
  }

  function selectedAircraft(state) {
    return state.aircraft.find((aircraft) => aircraft.id === selection.aircraftId) ?? null;
  }

  function renderDossier(state) {
    const track = selectedTrack(state);
    const aircraft = selectedAircraft(state);
    if (!track && !aircraft) {
      const objectives = objectiveSummary(state);
      el.dossier.innerHTML = `
        <div class="cic-dossier-head"><h3>任务态势 / MISSION</h3><span>IRON NEST · ${formatClock(state.duration - state.time)} 剩余</span></div>
        <div class="cic-objectives">
          ${objectives.map((item) => `<div class="cic-objective ${item.done ? "is-done" : ""}"><i></i>${item.label}</div>`).join("")}
        </div>
        <div class="cic-buttons">
          <button class="cic-button" type="button" data-act="help">操作手册</button>
          <button class="cic-button" type="button" data-act="intel">请求 HQ 情报</button>
          <button class="cic-button" type="button" data-act="deck">查看甲板作业</button>
        </div>
        <ul class="cic-notes">
          <li>先建立航迹，再决定是否开火；点火前检查右侧射界/弹药/EMCON。</li>
          <li>点击甲板图或机队列表选择飞机，下达 CAP / AEW / 打击任务。</li>
          <li>威胁排序：导弹 &gt; 已判定敌机 &gt; 未识别高速目标 &gt; 水面编队。</li>
          ${(state.rescueMarkers ?? []).some((marker) => !marker.rescued) ? `<li style="color:var(--green)">海面有待救机组；选择 SH-3“海王 01”下达搜救巡逻。</li>` : ""}
        </ul>
      `;
      return;
    }

    if (track) {
      const contact = state.contacts.find((item) => item.id === track.contactId);
      const notes = [...track.notes];
      if (track.quality < 0.5) notes.push("航迹质量不足，无法用于火控；可等待刷新或执行 ESM 交叉定位。");
      if (track.bearingOnly) notes.push("仅有方位线：无法测距，也无法作为火控目标。");
      if (!track.identified) notes.push("身份未确认：IFF 无应答不代表敌对，目视识别最可靠。");
      const hasMissileTarget = track.kind === "asm";
      el.dossier.innerHTML = `
        <div class="cic-dossier-head">
          <h3>${track.id} · ${trackType(track)}</h3>
          <span>${SOURCES[track.source] ?? track.source} · ${track.status.toUpperCase()}</span>
        </div>
        <div class="cic-dossier-grid">
          <div class="cic-fact">判定<b style="color:${trackClassColor(track)}">${CLASSIFICATION_LABEL[track.classified] ?? track.classified}</b></div>
          <div class="cic-fact">方位 / 距离<b>${formatBearing(track.bearing)} / ${track.bearingOnly ? "—" : `${formatRange(track.range)} km`}</b></div>
          <div class="cic-fact">速度<b>${formatSpeed(track.speed)} kn</b></div>
          <div class="cic-fact">航迹质量<b>${Math.round(track.quality * 100)}% · ${qualityBand(track.quality)}</b></div>
          <div class="cic-fact">威胁值<b>${Math.round(track.threat)}</b></div>
          <div class="cic-fact">辐射源<b>${track.emitterLabel ?? "—"}</b></div>
          <div class="cic-fact">最近更新<b>${Math.max(0, state.time - track.updatedAt).toFixed(0)} s 前</b></div>
          <div class="cic-fact">接触类型<b>${contact ? (track.identified ? contact.name : "待识别") : "已消失"}</b></div>
        </div>
        <ul class="cic-notes">${notes.map((note) => `<li>${note}</li>`).join("")}</ul>
        <div class="cic-buttons">
          <button class="cic-button" type="button" data-act="iff" ${track.identified || track.iff?.active ? "disabled" : ""}>IFF 询问</button>
          <button class="cic-button" type="button" data-act="esm" ${track.esmFix?.active ? "disabled" : ""}>ESM 交叉定位</button>
          <button class="cic-button" type="button" data-act="visual" ${track.identified || track.visualRequest?.active ? "disabled" : ""}>目视识别</button>
          <button class="cic-button is-warn" type="button" data-act="classify" data-value="hostile" ${track.identified ? "disabled" : ""}>判定敌对</button>
          <button class="cic-button is-warn" type="button" data-act="classify" data-value="assumed-hostile" ${track.identified ? "disabled" : ""}>疑似敌对</button>
          <button class="cic-button" type="button" data-act="classify" data-value="neutral" ${track.identified ? "disabled" : ""}>判定中立</button>
          <button class="cic-button" type="button" data-act="classify" data-value="unknown" ${track.identified ? "disabled" : ""}>解除判定</button>
          <button class="cic-button" type="button" data-act="escort" ${hasMissileTarget || track.classified === "hostile" ? "" : "disabled"}>呼叫护航舰</button>
        </div>
      `;
      return;
    }

    const type = AIRCRAFT_TYPES[aircraft.type];
    const fuel = clamp(aircraft.fuel / aircraft.endurance, 0, 1);
    const canLaunch = ["ready", "hangar"].includes(aircraft.state);
    const missionButtons = [];
    if (canLaunch) {
      if (type.role === "fighter") {
        missionButtons.push(`<button class="cic-button is-primary" type="button" data-act="mission" data-mission="cap" data-aircraft="${aircraft.id}">出击 CAP</button>`);
        if (aircraft.harpoons > 0) {
          const target = targetTrackForStrike(state);
          missionButtons.push(`<button class="cic-button ${target ? "is-warn" : ""}" type="button" data-act="mission" data-mission="strike" data-aircraft="${aircraft.id}" ${target ? "" : "disabled"}>对海打击</button>`);
        }
      } else if (type.role === "aew") {
        missionButtons.push(`<button class="cic-button is-primary" type="button" data-act="mission" data-mission="aew" data-aircraft="${aircraft.id}">出击 AEW</button>`);
      } else if (type.role === "ew") {
        missionButtons.push(`<button class="cic-button is-primary" type="button" data-act="mission" data-mission="ew" data-aircraft="${aircraft.id}">出击 EW</button>`);
      } else if (type.role === "sar") {
        missionButtons.push(`<button class="cic-button is-primary" type="button" data-act="mission" data-mission="sar" data-aircraft="${aircraft.id}">搜救巡逻</button>`);
      }
    }
    if (["airborne", "inbound", "holding"].includes(aircraft.state)) {
      missionButtons.push(`<button class="cic-button is-warn" type="button" data-act="recall" data-aircraft="${aircraft.id}">召回</button>`);
    }
    el.dossier.innerHTML = `
      <div class="cic-dossier-head">
        <h3>${aircraft.callsign} · ${aircraft.short}</h3>
        <span>${aircraft.typeLabel} · ${AIRCRAFT_STATE_LABEL[aircraft.state] ?? aircraft.state}</span>
      </div>
      <div class="cic-dossier-grid">
        <div class="cic-fact">任务<b>${aircraft.mission ? MISSION[aircraft.mission]?.label : "—"}</b></div>
        <div class="cic-fact">位置<b>${aircraft.state === "airborne" ? "空中" : aircraft.spotId ?? aircraft.bayId ?? "—"}</b></div>
        <div class="cic-fact">燃油<b>${Math.round(fuel * 100)}%</b></div>
        <div class="cic-fact">鱼叉<b>${aircraft.harpoons} / ${type.harpoons}</b></div>
        <div class="cic-fact">出击架次<b>${aircraft.sorties}</b></div>
        <div class="cic-fact">战果<b>${aircraft.kills}</b></div>
        <div class="cic-fact">机组<b>${type.crew}</b></div>
        <div class="cic-fact">状态<b>${AIRCRAFT_STATE_LABEL[aircraft.state] ?? aircraft.state}</b></div>
      </div>
      <ul class="cic-notes">
        ${aircraft.state === "hangar" ? "<li>在机库内：出击需要空闲停机位与 E1/E2 升降机，流程约 1 分钟。</li>" : ""}
        ${aircraft.state === "service" ? "<li>补给班组正在补充燃油与武器，完成后自动待命。</li>" : ""}
        ${aircraft.state === "awaitingService" ? "<li>等待补给班组，当前无空闲班组。</li>" : ""}
        ${aircraft.state === "airborne" ? `<li>剩余燃油约 ${Math.round(aircraft.fuel)} s；燃油低于返航需求会自动返航。</li>` : ""}
        ${aircraft.health <= 0 ? `<li>该机已损失：${aircraft.lostReason ?? ""}</li>` : ""}
      </ul>
      <div class="cic-buttons">${missionButtons.join("") || `<span style="font-family:var(--mono);font-size:9px;color:var(--muted)">当前状态无可执行任务</span>`}</div>
    `;
  }

  function renderLog(state) {
    const messages = state.messages.slice(-40);
    el.log.innerHTML = messages
      .map(
        (message) => `
        <div class="cic-log-line ${message.sticky ? "is-sticky" : ""}" data-tone="${message.tone}" ${message.trackId ? `data-act="track" data-track="${message.trackId}"` : ""}>
          <time>${formatClock(message.t)}</time>
          <em>${message.channel}</em>
          <span>${message.text}</span>
        </div>`,
      )
      .join("");
    if (logPinned) el.log.scrollTop = el.log.scrollHeight;
    if (messages.length !== lastLogCount) {
      lastLogCount = messages.length;
      state.unread = 0;
      el.unread.textContent = "";
    }
  }

  function renderDeckHud(state) {
    el.deckHudSub.textContent = `${state.scenarioName} · ${formatClock(state.time)} / ${formatClock(state.duration)}`;
    const active = state.aircraft.filter((a) => ["taxi", "hook", "stroke", "approach", "trap", "clear", "elevating", "spotting"].includes(a.state));
    el.deckHudLines.innerHTML = `
      <span>舰体 <b>${Math.round(state.own.hull)}%</b></span>
      <span>空中 <b>${state.aircraft.filter((a) => ["airborne", "inbound", "holding"].includes(a.state)).length}</b></span>
      <span>弹射 <b>${active.filter((a) => ["taxi", "hook", "stroke"].includes(a.state)).map((a) => a.callsign).join(" · ") || "空闲"}</b></span>
      <span>回收 <b>${state.recovery.active ? state.aircraft.find((a) => a.id === state.recovery.active)?.callsign : "空闲"}</b></span>
    `;
  }

  function drawScope(state) {
    const canvas = el.scope;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      deckNative = { w: rect.width, h: rect.height, dpr };
    }
    const w = rect.width;
    const h = rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.46;
    const scale = radius / RANGE_KM;
    const own = state.own.pos;

    const bg = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * 1.06);
    bg.addColorStop(0, "rgba(16, 49, 64, 0.42)");
    bg.addColorStop(0.72, "rgba(5, 17, 24, 0.35)");
    bg.addColorStop(1, "rgba(2, 7, 11, 0.72)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 环与方位
    ctx.strokeStyle = "rgba(110, 190, 220, 0.12)";
    ctx.fillStyle = "rgba(140, 190, 210, 0.46)";
    ctx.font = "8px 'Cascadia Mono', monospace";
    ctx.textAlign = "left";
    for (let ring = 50; ring <= RANGE_KM; ring += 50) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (ring / RANGE_KM), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${ring}`, cx + 3, cy - radius * (ring / RANGE_KM) + 2);
    }
    for (let bearing = 0; bearing < 360; bearing += 30) {
      const rad = ((bearing - 90) * Math.PI) / 180;
      const x = cx + Math.cos(rad) * radius;
      const y = cy + Math.sin(rad) * radius;
      ctx.strokeStyle = "rgba(110, 190, 220, 0.07)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (bearing % 90 === 0) {
        ctx.fillStyle = "rgba(160, 210, 230, 0.55)";
        ctx.font = "9px 'Cascadia Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(bearing).padStart(3, "0"), cx + Math.cos(rad) * (radius + 12), cy + Math.sin(rad) * (radius + 12) + 3);
      }
    }

    // 雷达覆盖
    if (state.capabilities.radar) {
      ctx.strokeStyle = "rgba(99, 231, 255, 0.16)";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(radius, 230 * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (state.capabilities.aew) {
      ctx.strokeStyle = "rgba(118, 246, 189, 0.14)";
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(radius, 400 * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 扫描线
    const sweep = ((state.time * 36) % 360) * (Math.PI / 180) - Math.PI / 2;
    const sweepGrad = ctx.createLinearGradient(cx, cy, cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
    sweepGrad.addColorStop(0, "rgba(99, 231, 255, 0)");
    sweepGrad.addColorStop(1, "rgba(99, 231, 255, 0.5)");
    ctx.strokeStyle = sweepGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
    ctx.stroke();

    // 友军空中目标
    for (const aircraft of state.aircraft) {
      if (!["airborne", "inbound", "holding"].includes(aircraft.state)) continue;
      const x = cx + (aircraft.flightPos.x - own.x) * scale;
      const y = cy - (aircraft.flightPos.y - own.y) * scale;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      ctx.fillStyle = "#63e7ff";
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 3.2, y + 3.4);
      ctx.lineTo(x - 3.2, y + 3.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(160, 235, 255, 0.66)";
      ctx.font = "7px 'Cascadia Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(MISSION[aircraft.mission]?.short ?? "AIR", x + 5, y + 2);
    }

    // 友军鱼叉
    for (const missile of state.attackMissiles ?? []) {
      const x = cx + (missile.pos.x - own.x) * scale;
      const y = cy - (missile.pos.y - own.y) * scale;
      ctx.fillStyle = "rgba(118, 246, 189, 0.9)";
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 待救机组
    for (const marker of state.rescueMarkers ?? []) {
      if (marker.rescued) continue;
      const x = cx + (marker.pos.x - own.x) * scale;
      const y = cy - (marker.pos.y - own.y) * scale;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      ctx.strokeStyle = "rgba(118, 246, 189, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(118, 246, 189, 0.75)";
      ctx.font = "7px 'Cascadia Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText("SAR", x + 5, y + 2);
    }

    const hits = [];
    // 敌方航迹
    for (const track of state.tracks) {
      if (track.status !== "active" || track.status === "expired") continue;
      const color = trackClassColor(track);
      const contact = state.contacts.find((item) => item.id === track.contactId);
      if (!contact || !contact.alive) continue;
      let x;
      let y;
      if (track.bearingOnly) {
        const rad = ((track.bearing - 90) * Math.PI) / 180;
        x = cx + Math.cos(rad) * radius * 0.9;
        y = cy + Math.sin(rad) * radius * 0.9;
        ctx.strokeStyle = "rgba(255, 178, 92, 0.28)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        x = cx + (track.pos.x - own.x) * scale;
        y = cy - (track.pos.y - own.y) * scale;
      }
      if (Math.hypot(x - cx, y - cy) > radius + 4) continue;

      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = color;
      ctx.fillStyle = "rgba(6, 14, 20, 0.72)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (track.symbol === "surface") {
        ctx.rect(-4, -4, 8, 8);
      } else if (track.symbol === "missile") {
        ctx.moveTo(0, -6);
        ctx.lineTo(4.2, 4.8);
        ctx.lineTo(0, 2.4);
        ctx.lineTo(-4.2, 4.8);
        ctx.closePath();
      } else {
        ctx.moveTo(0, -5.4);
        ctx.lineTo(5.2, 0);
        ctx.lineTo(0, 5.4);
        ctx.lineTo(-5.2, 0);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      if (track.classified === "hostile") {
        ctx.fillStyle = "rgba(255, 106, 95, 0.14)";
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      if (selection.trackId === track.id) {
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.lineTo(-9, 0);
        ctx.moveTo(9, 0);
        ctx.lineTo(16, 0);
        ctx.moveTo(0, -16);
        ctx.lineTo(0, -9);
        ctx.moveTo(0, 9);
        ctx.lineTo(0, 16);
        ctx.stroke();
      }
      ctx.restore();

      ctx.fillStyle = color;
      ctx.font = "8px 'Cascadia Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(track.id.replace("TRK-", "T"), x + 8, y - 5);
      if (track.symbol === "missile") {
        ctx.fillStyle = "rgba(255, 106, 95, 0.45)";
        const rad = ((track.bearing - 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(rad) * 12, y - Math.sin(rad) * 12);
        ctx.strokeStyle = "rgba(255, 106, 95, 0.35)";
        ctx.stroke();
      }
      hits.push({ id: track.id, x, y });
    }

    // 本舰
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(99, 231, 255, 0.16)";
    ctx.strokeStyle = "rgba(99, 231, 255, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(4, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(160, 235, 255, 0.8)";
    ctx.font = "8px 'Cascadia Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("CV-63", 0, 16);
    ctx.restore();

    // 边框
    ctx.strokeStyle = "rgba(110, 190, 220, 0.16)";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    stateRef.scopeHits = hits;
  }

  function selectTrack(id) {
    selection.trackId = id;
    selection.aircraftId = null;
    const state = getState();
    state.selected = { ...state.selected, trackId: id, aircraftId: null };
  }

  function selectAircraft(id) {
    selection.aircraftId = id;
    selection.trackId = null;
    const state = getState();
    state.selected = { ...state.selected, trackId: null, aircraftId: id };
  }

  function handleAction(action, target) {
    const state = getState();
    const trackId = target.dataset.track ?? selection.trackId;
    const aircraftId = target.dataset.aircraft ?? selection.aircraftId;
    const mountId = target.dataset.mount ?? selection.mountId;

    if (action === "speed") {
      dispatch({ type: "speed", value: Number(target.dataset.speed) });
      return;
    }
    if (action === "pause") {
      dispatch({ type: "pause", value: !state.paused });
      return;
    }
    if (action === "deck") {
      setDeckView(!deckView);
      return;
    }
    if (action === "help") {
      openModal(helpHTML());
      return;
    }
    if (action === "exit") {
      onExit?.();
      return;
    }
    if (action === "track") {
      selectTrack(target.dataset.track);
      renderAll();
      return;
    }
    if (action === "aircraft") {
      selectAircraft(target.dataset.aircraft);
      renderAll();
      return;
    }
    if (action === "mount") {
      selection.mountId = target.dataset.mount;
      renderAll();
      return;
    }
    if (action === "mission") {
      const result = dispatch({ type: "sortie", aircraftId, mission: target.dataset.mission });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "recall") {
      const result = dispatch({ type: "recall", aircraftId });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "emcon") {
      const result = dispatch({ type: "emcon", value: target.dataset.value });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "roe") {
      const result = dispatch({ type: "roe", value: target.dataset.value });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "jam") {
      const result = dispatch({ type: "jam", value: !state.jam });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "chaff") {
      const result = dispatch({ type: "chaff" });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "autoSam") {
      const result = dispatch({ type: "autoSam", value: !state.autoSam });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "autoDefense") {
      const result = dispatch({ type: "autoDefense", value: !state.autoDefense });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "intel") {
      const result = dispatch({ type: "intel" });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "iff") {
      const result = dispatch({ type: "identify", trackId });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "esm") {
      const result = dispatch({ type: "esmFix", trackId });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "visual") {
      const result = dispatch({ type: "visualId", trackId });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "classify") {
      const result = dispatch({ type: "classify", trackId, value: target.dataset.value });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "assign") {
      if (!selection.trackId) {
        showToast("请先在态势图或航迹表选择目标", true);
        return;
      }
      const mount = state.mounts.find((item) => item.id === mountId);
      const result =
        mount?.kind === "escort"
          ? dispatch({ type: "callEscort", trackId: selection.trackId })
          : dispatch({ type: "assign", mountId, trackId: selection.trackId });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "unassign") {
      const result = dispatch({ type: "unassign", mountId, trackId: target.dataset.track ?? null });
      showToast(result.message, !result.ok);
      return;
    }
    if (action === "escort") {
      const result = dispatch({ type: "callEscort", trackId });
      showToast(result.message, !result.ok);
    }
  }

  root.addEventListener("click", (event) => {
    const modalAction = event.target.closest("[data-modal-action]")?.dataset.modalAction;
    if (modalAction) {
      if (modalAction === "start") {
        closeModal();
        dispatch({ type: "start" });
      } else if (modalAction === "help") {
        openModal(helpHTML());
      } else if (modalAction === "close") {
        closeModal();
      } else if (modalAction === "exit") {
        onExit?.();
      } else if (modalAction === "restart") {
        closeModal();
        resultShown = false;
        selection.trackId = null;
        selection.aircraftId = null;
        if (deckView) setDeckView(false);
        onRestart?.();
      }
      return;
    }
    const control = event.target.closest("[data-act]");
    if (!control) return;
    if (event.target.closest(".cic-target-chip button") && control.dataset.act !== "unassign") return;
    handleAction(control.dataset.act, control);
  });

  el.scope.addEventListener("click", (event) => {
    const rect = el.scope.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDistance = 18;
    for (const hit of stateRef.scopeHits) {
      const distance = Math.hypot(hit.x - x, hit.y - y);
      if (distance < bestDistance) {
        best = hit;
        bestDistance = distance;
      }
    }
    if (best) {
      selectTrack(best.id);
      renderAll();
    }
  });

  el.log.addEventListener("scroll", () => {
    const distance = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight;
    logPinned = distance < 28;
  });

  resizeObserver = new ResizeObserver(() => {
    const state = getState();
    if (state && active) drawScope(state);
  });
  resizeObserver.observe(el.scope.parentElement);

  function renderAll() {
    const state = getState();
    if (!state || !active) return;
    const rightPanel = root.querySelector(".cic-right");
    const scrolls = {
      roster: el.roster.scrollTop,
      tracks: el.tracks.scrollTop,
      right: rightPanel?.scrollTop ?? 0,
      dossier: el.dossier.scrollTop,
      log: el.log.scrollTop,
    };
    renderHeader(state);
    renderCounters(state);
    renderDeck(state);
    renderRoster(state);
    renderTracks(state);
    renderMounts(state);
    renderDamage(state);
    renderDossier(state);
    renderLog(state);
    renderDeckHud(state);
    el.roster.scrollTop = scrolls.roster;
    el.tracks.scrollTop = scrolls.tracks;
    el.dossier.scrollTop = scrolls.dossier;
    if (!logPinned) el.log.scrollTop = scrolls.log;
    if (rightPanel) rightPanel.scrollTop = scrolls.right;
  }

  function update(dt) {
    if (!active || root.hidden) return;
    const state = getState();
    if (!state) return;
    uiAcc += dt;
    scopeAcc += dt;
    if (uiAcc >= 0.12) {
      uiAcc = 0;
      renderAll();
    }
    if (scopeAcc >= 0.055) {
      scopeAcc = 0;
      drawScope(state);
    }
    if (state.phase === "won" || state.phase === "lost") {
      if (!resultShown && state.result) {
        resultShown = true;
        openModal(resultHTML(state));
      }
    }
    if (state.phase === "briefing" && el.modal.hidden) {
      openModal(briefingHTML());
    }
  }

  function show() {
    active = true;
    root.hidden = false;
    document.body.classList.add("is-combat");
    const state = getState();
    if (state?.phase === "briefing") {
      openModal(briefingHTML());
    } else if (state?.phase === "won" || state?.phase === "lost") {
      resultShown = false;
      if (state.result) {
        resultShown = true;
        openModal(resultHTML(state));
      }
    }
    if (state) {
      ensureIcons(state);
      renderAll();
      drawScope(state);
    }
    window.requestAnimationFrame(() => {
      if (state) drawScope(state);
    });
  }

  function hide() {
    active = false;
    root.hidden = true;
    document.body.classList.remove("is-combat", "cic-deck-view");
    deckView = false;
    const deckButton = root.querySelector("#cic-deck");
    if (deckButton) deckButton.textContent = "甲板视角";
    closeModal();
  }

  function onKeyDown(event) {
    if (!active) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (key === "escape") {
      if (!el.modal.hidden) {
        if (
          el.modal.innerHTML.includes('data-modal-action="start"') ||
          el.modal.innerHTML.includes('data-modal-action="restart"')
        ) {
          return;
        }
        closeModal();
      } else if (deckView) {
        setDeckView(false);
      }
      return;
    }
    if (!el.modal.hidden) return;
    if (key === " ") {
      event.preventDefault();
      dispatch({ type: "pause", value: !getState().paused });
    } else if (key === "1" || key === "2" || key === "4") {
      dispatch({ type: "speed", value: Number(key) });
    } else if (key === "d") {
      setDeckView(!deckView);
    } else if (key === "c") {
      const result = dispatch({ type: "chaff" });
      showToast(result.message, !result.ok);
    } else if (key === "i") {
      const result = dispatch({ type: "intel" });
      showToast(result.message, !result.ok);
    }
  }

  window.addEventListener("keydown", onKeyDown);

  return {
    show,
    hide,
    update,
    flashImpact,
    begin: () => {
      closeModal();
      return dispatch({ type: "start" });
    },
    get active() {
      return active;
    },
    isDeckView: () => deckView,
    setDeckView,
    showToast,
    openBriefing: () => openModal(briefingHTML()),
    closeModal,
  };
}

const SOURCES = {
  radar: "舰载雷达",
  aew: "E-2C 预警",
  esm: "ESM 被动",
  visual: "目视确认",
  intel: "情报通报",
};
