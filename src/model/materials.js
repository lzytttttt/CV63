import * as THREE from "three";
import {
  ANGLED_DECK,
  CATAPULTS,
  COLORS,
  DECK_BOUNDS,
  DECK_OUTLINE,
  ELEVATOR_NOTCHES,
  SHIP,
  deckEdgeAt,
} from "./constants.js";
import { CV63_PARAMS, seededRandom } from "./params.js";

/* ── 画布贴图工具 ─────────────────────────────────────────── */

function canvasTexture(width, height, draw, { colorSpace = THREE.SRGBColorSpace } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/* ── 飞行甲板贴图 ─────────────────────────────────────────── */

const DECK_TEX_W = 1024;
const DECK_TEX_H = 4096;

function deckPixel(x, z) {
  const { minX, maxX, minZ, maxZ } = DECK_BOUNDS;
  return [
    ((x - minX) / (maxX - minX)) * DECK_TEX_W,
    ((z - minZ) / (maxZ - minZ)) * DECK_TEX_H,
  ];
}

function deckScaleX(metres) {
  return (metres / DECK_BOUNDS.width) * DECK_TEX_W;
}

function deckScaleZ(metres) {
  return (metres / DECK_BOUNDS.length) * DECK_TEX_H;
}

function pathOutline(ctx) {
  ctx.beginPath();
  DECK_OUTLINE.forEach(([x, z], index) => {
    const [px, py] = deckPixel(x, z);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function makeDeckTexture() {
  // 固定种子：每次生成的甲板噪点/板缝一致，便于逐版本比对
  const rnd = seededRandom(CV63_PARAMS.deck.textureSeed);
  return canvasTexture(DECK_TEX_W, DECK_TEX_H, (ctx, W, H) => {
    const { minX, maxX, minZ, maxZ } = DECK_BOUNDS;
    const toPx = deckPixel;

    // 基础非防滑涂层
    ctx.fillStyle = "#3c4247";
    ctx.fillRect(0, 0, W, H);

    // 甲板拼板缝与色差
    ctx.save();
    pathOutline(ctx);
    ctx.clip();
    for (let z = minZ; z < maxZ; z += 6) {
      const [, py] = toPx(0, z);
      ctx.strokeStyle = `rgba(18,22,25,${0.28 + rnd() * 0.2})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(W, py);
      ctx.stroke();
    }
    for (let x = minX; x < maxX; x += 6) {
      const [px] = toPx(x, 0);
      ctx.strokeStyle = "rgba(20,24,27,0.24)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
    }
    // 大面积色斑，避免纯色感
    for (let i = 0; i < 260; i++) {
      const [px] = toPx(minX + rnd() * (maxX - minX), 0);
      const [, py] = toPx(0, minZ + rnd() * (maxZ - minZ));
      const r = 12 + rnd() * 60;
      const shade = rnd() > 0.5 ? "60,68,74" : "46,52,57";
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, `rgba(${shade},0.34)`);
      grad.addColorStop(1, `rgba(${shade},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 系留孔网格（按甲板实际包围盒铺满）
    ctx.fillStyle = "rgba(24,28,31,0.5)";
    for (let x = minX + 1; x <= maxX - 1; x += 3.4) {
      for (let z = minZ + 1; z <= maxZ - 1; z += 3.4) {
        const [px, py] = toPx(x, z);
        ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
      }
    }
    ctx.restore();

    const white = "#e7edf0";
    const yellow = "#d8b365";
    const red = "#b8483c";

    // 甲板外缘白线
    ctx.save();
    pathOutline(ctx);
    ctx.strokeStyle = "rgba(232,240,243,0.95)";
    ctx.lineWidth = deckScaleX(1.15);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();

    // 前部甲板中线（舰艏 → 斜角甲板前端）
    {
      const [ax, ay] = toPx(0, -152);
      const [bx, by] = toPx(0, 18);
      ctx.save();
      ctx.setLineDash([deckScaleZ(11), deckScaleZ(6)]);
      ctx.strokeStyle = "rgba(232,238,241,0.72)";
      ctx.lineWidth = deckScaleX(0.55);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── 斜角甲板着舰区
    const stern = ANGLED_DECK.centerStern;
    const bow = ANGLED_DECK.centerBow;
    const dx = bow[0] - stern[0];
    const dz = bow[1] - stern[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const halfW = ANGLED_DECK.width / 2;
    const corners = [
      [stern[0] + nx * halfW, stern[1] + nz * halfW],
      [bow[0] + nx * halfW, bow[1] + nz * halfW],
      [bow[0] - nx * halfW, bow[1] - nz * halfW],
      [stern[0] - nx * halfW, stern[1] - nz * halfW],
    ];
    ctx.save();
    pathOutline(ctx);
    ctx.clip();
    // 着舰区底色略深
    ctx.beginPath();
    corners.forEach(([x, z], i) => {
      const [px, py] = toPx(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(30,35,39,0.45)";
    ctx.fill();

    // 着舰区两侧边界虚线
    const drawAngledLine = (offset, style, width, dash) => {
      const [sx, sy] = toPx(stern[0] + nx * offset, stern[1] + nz * offset);
      const [bx, by] = toPx(bow[0] + nx * offset, bow[1] + nz * offset);
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.moveTo(sx, sy);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawAngledLine(halfW, white, deckScaleX(1.0), [deckScaleZ(12), deckScaleZ(5)]);
    drawAngledLine(-halfW, red, deckScaleX(0.85), [deckScaleZ(7), deckScaleZ(4)]);
    drawAngledLine(-halfW + 1.6, white, deckScaleX(0.36), []);
    // 中线虚线
    drawAngledLine(0, "rgba(236,242,244,0.9)", deckScaleX(0.55), [deckScaleZ(9), deckScaleZ(7)]);
    // 中线上的接地标记
    for (let i = 0; i < 7; i++) {
      const t = 0.52 + i * 0.055;
      const cx = stern[0] + dx * t;
      const cz = stern[1] + dz * t;
      const [px, py] = toPx(cx, cz);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-Math.atan2(uz, ux) + Math.PI / 2);
      ctx.strokeStyle = "rgba(240,245,247,0.85)";
      ctx.lineWidth = deckScaleX(0.45);
      ctx.beginPath();
      ctx.moveTo(-deckScaleX(3.2), 0);
      ctx.lineTo(deckScaleX(3.2), 0);
      ctx.stroke();
      ctx.restore();
    }

    // 拦阻索：垂直于着舰方向
    ANGLED_DECK.wiresZ.forEach((wz) => {
      const t = (wz - stern[1]) / dz;
      const cx = stern[0] + dx * t;
      const cz = wz;
      const a = [cx + nx * (halfW - 1.4), cz + nz * (halfW - 1.4)];
      const b = [cx - nx * (halfW - 1.4), cz - nz * (halfW - 1.4)];
      const [ax, ay] = toPx(a[0], a[1]);
      const [bx, by] = toPx(b[0], b[1]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = "rgba(232,238,240,0.9)";
      ctx.lineWidth = deckScaleX(0.55);
      ctx.stroke();
      // 拦阻索支座
      for (const [sx, sy] of [
        [ax, ay],
        [bx, by],
      ]) {
        ctx.fillStyle = "#20262a";
        ctx.beginPath();
        ctx.arc(sx, sy, deckScaleX(1.3), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 着舰区入口 T 形标
    {
      const [px, py] = toPx(bow[0], bow[1]);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-Math.atan2(uz, ux) + Math.PI / 2);
      ctx.strokeStyle = white;
      ctx.lineWidth = deckScaleX(8);
      ctx.beginPath();
      ctx.moveTo(-deckScaleX(9), 0);
      ctx.lineTo(deckScaleX(9), 0);
      ctx.stroke();
      ctx.lineWidth = deckScaleX(1.0);
      ctx.beginPath();
      ctx.moveTo(-deckScaleX(9), -deckScaleZ(1.2));
      ctx.lineTo(deckScaleX(9), -deckScaleZ(1.2));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ── 弹射器轨道
    CATAPULTS.forEach((cat) => {
      const [sx, sy] = toPx(cat.start[0], cat.start[1]);
      const [ex, ey] = toPx(cat.end[0], cat.end[1]);
      const ang = Math.atan2(ey - sy, ex - sx);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      const length = Math.hypot(ex - sx, ey - sy);
      ctx.fillStyle = "rgba(26,30,33,0.85)";
      ctx.fillRect(0, -deckScaleX(0.34), length, deckScaleX(0.68));
      ctx.strokeStyle = "rgba(220,228,231,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -deckScaleX(1.2));
      ctx.lineTo(length, -deckScaleX(1.2));
      ctx.moveTo(0, deckScaleX(1.2));
      ctx.lineTo(length, deckScaleX(1.2));
      ctx.stroke();
      // 弹射滑块
      ctx.fillStyle = "rgba(200,208,212,0.55)";
      ctx.fillRect(length * 0.36, -deckScaleX(0.7), deckScaleX(2.4), deckScaleX(1.4));
      ctx.restore();

      // 喷流挡板 JBD（网格状）
      const [jx, jy] = toPx(cat.jbd[0], cat.jbd[1]);
      ctx.save();
      ctx.translate(jx, jy);
      ctx.rotate(ang);
      const jw = deckScaleX(12);
      const jh = deckScaleZ(4.6);
      ctx.fillStyle = "rgba(28,32,35,0.9)";
      ctx.fillRect(-jw / 2, -jh / 2, jw, jh);
      ctx.strokeStyle = "rgba(216,179,101,0.9)";
      ctx.lineWidth = 1.4;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo((i / 4) * (jw / 2), -jh / 2);
        ctx.lineTo((i / 4) * (jw / 2), jh / 2);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(230,238,240,0.8)";
      ctx.strokeRect(-jw / 2, -jh / 2, jw, jh);
      ctx.restore();
    });

    // ── 危险线 & 边缘通道
    ctx.save();
    pathOutline(ctx);
    ctx.clip();
    // 舷侧安全通道：跟着真实甲板外缘内缩 1.6 m
    ctx.strokeStyle = "rgba(184,72,60,0.55)";
    ctx.lineWidth = deckScaleX(0.45);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      let started = false;
      for (let z = SHIP.bowZ + 4; z <= SHIP.sternZ - 4; z += 3) {
        const x = deckEdgeAt(z, side) - side * 1.6;
        const [px, py] = toPx(x, z);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // 升降机井口标记（贴图只画井口内缘，井体几何由 elevators.js 提供）
    ELEVATOR_NOTCHES.forEach((notch) => {
      const [ax, ay] = toPx(notch.inner, notch.z0);
      const [bx, by] = toPx(notch.inner, notch.z1);
      ctx.strokeStyle = "rgba(224,178,102,0.85)";
      ctx.lineWidth = deckScaleX(0.55);
      ctx.setLineDash([deckScaleZ(2.4), deckScaleZ(1.6)]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // 舰艏舷号 63（沿甲板纵向排布，顶部朝舰艏）
    {
      const [px, py] = toPx(0, SHIP.bowZ + 15);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = "rgba(240,245,247,0.96)";
      ctx.font = `bold ${deckScaleX(10.5)}px "Arial Black", Impact, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("63", 0, 0);
      ctx.restore();
    }
    // 弹射器编号
    CATAPULTS.forEach((cat) => {
      const [px, py] = toPx(cat.start[0] + 1.6, cat.start[1] + 5);
      ctx.fillStyle = "rgba(230,238,241,0.72)";
      ctx.font = `bold ${deckScaleX(2.4)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(cat.label, px, py);
    });
    ctx.restore();
  });
}

/* ── 舷号 / 舷侧文字贴图 ─────────────────────────────────── */

export function makeTextTexture(text, { width = 512, height = 256, font = "bold 150px Arial", color = "#eef3f5", letterSpacing = 0 } = {}) {
  return canvasTexture(width, height, (ctx) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (letterSpacing) {
      const total = [...text].reduce((sum, ch) => sum + ctx.measureText(ch).width + letterSpacing, 0);
      let cursor = width / 2 - total / 2;
      ctx.textAlign = "left";
      for (const ch of text) {
        ctx.fillText(ch, cursor, height / 2);
        cursor += ctx.measureText(ch).width + letterSpacing;
      }
    } else {
      ctx.fillText(text, width / 2, height / 2 + 6);
    }
  });
}

/* ── 通用纹理 ─────────────────────────────────────────────── */

function makeWindowTexture(columns = 18, rows = 3) {
  return canvasTexture(1024, 256, (ctx, W, H) => {
    ctx.fillStyle = "#1a2229";
    ctx.fillRect(0, 0, W, H);
    const cellW = W / columns;
    const cellH = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const lit = Math.random() > 0.45;
        ctx.fillStyle = lit ? "rgba(148,196,216,0.92)" : "rgba(22,32,40,0.95)";
        ctx.fillRect(c * cellW + cellW * 0.16, r * cellH + cellH * 0.2, cellW * 0.68, cellH * 0.5);
      }
    }
    ctx.strokeStyle = "rgba(90,104,112,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  });
}

function makeGrilleTexture() {
  return canvasTexture(256, 256, (ctx, W, H) => {
    ctx.fillStyle = "#20262a";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#3c454b";
    ctx.lineWidth = 4;
    for (let y = 8; y < H; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  });
}

function makeRadarFaceTexture() {
  return canvasTexture(512, 512, (ctx, W, H) => {
    ctx.fillStyle = "#7d8a92";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(38,46,52,0.7)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 24; i++) {
      const p = (i / 24) * W;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(W, p);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(226,234,238,0.5)";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, W - 8, H - 8);
  });
}

function makeWarningTexture() {
  return canvasTexture(256, 64, (ctx, W, H) => {
    ctx.fillStyle = "#d8b365";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1c2024";
    ctx.save();
    ctx.translate(0, 0);
    for (let x = -H; x < W + H; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 16, H);
      ctx.lineTo(x + 16 + H, 0);
      ctx.lineTo(x + H, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  });
}

function makeSoftSprite(color = "255,255,255", softness = 1) {
  return canvasTexture(256, 256, (ctx, W, H) => {
    const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    grad.addColorStop(0, `rgba(${color},${0.95 * softness})`);
    grad.addColorStop(0.45, `rgba(${color},${0.38 * softness})`);
    grad.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  });
}

/* ── 材质集 ───────────────────────────────────────────────── */

export function createMaterials() {
  const deckMap = makeDeckTexture();
  const windowMap = makeWindowTexture();
  const grilleMap = makeGrilleTexture();
  const radarMap = makeRadarFaceTexture();
  const warningMap = makeWarningTexture();

  const standard = (params) => new THREE.MeshStandardMaterial(params);

  return {
    deckMap,
    windowMap,
    grilleMap,
    radarMap,
    warningMap,
    softSprite: makeSoftSprite("255,255,255", 0.7),
    steamSprite: makeSoftSprite("226,238,244", 0.55),
    fireSprite: makeSoftSprite("255,176,96", 0.8),

    hull: standard({ color: COLORS.hull, roughness: 0.72, metalness: 0.28 }),
    hullUnder: standard({ color: COLORS.underwater, roughness: 0.85, metalness: 0.12 }),
    hullDark: standard({ color: COLORS.hullDark, roughness: 0.68, metalness: 0.3 }),
    boot: standard({ color: COLORS.boot, roughness: 0.85, metalness: 0.1 }),
    deck: standard({
      map: deckMap,
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.16,
    }),
    deckUnder: standard({ color: 0x2a3035, roughness: 0.8, metalness: 0.25 }),
    deckEdge: standard({ color: COLORS.deckEdge, roughness: 0.7, metalness: 0.35 }),
    elevator: standard({ color: 0x4c545a, roughness: 0.78, metalness: 0.28 }),
    island: standard({ color: COLORS.island, roughness: 0.7, metalness: 0.24 }),
    islandDark: standard({ color: COLORS.islandDark, roughness: 0.65, metalness: 0.3 }),
    steel: standard({ color: COLORS.steel, roughness: 0.55, metalness: 0.5 }),
    steelDark: standard({ color: COLORS.steelDark, roughness: 0.6, metalness: 0.45 }),
    black: standard({ color: COLORS.black, roughness: 0.9, metalness: 0.1 }),
    rubber: standard({ color: COLORS.rubber, roughness: 0.95, metalness: 0.02 }),
    white: standard({ color: COLORS.white, roughness: 0.6, metalness: 0.12 }),
    red: standard({ color: 0xb8483c, roughness: 0.62, metalness: 0.2 }),
    warning: standard({ color: COLORS.warning, roughness: 0.6, metalness: 0.25 }),
    warningStriped: standard({ map: warningMap, roughness: 0.6, metalness: 0.2 }),
    bronze: standard({ color: COLORS.bronze, roughness: 0.35, metalness: 0.85 }),
    jet: standard({ color: COLORS.jet, roughness: 0.5, metalness: 0.55 }),
    jetDark: standard({ color: COLORS.jetDark, roughness: 0.5, metalness: 0.5 }),
    jetWhite: standard({ color: 0xc9d3d8, roughness: 0.55, metalness: 0.2 }),
    canopy: standard({
      color: 0x1d2a31,
      roughness: 0.12,
      metalness: 0.7,
      transparent: true,
      opacity: 0.82,
    }),
    radome: standard({ color: 0xbcc6cb, roughness: 0.55, metalness: 0.05 }),
    radarFace: standard({ map: radarMap, roughness: 0.5, metalness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x18333f,
      roughness: 0.16,
      metalness: 0.1,
      transparent: true,
      opacity: 0.66,
      envMapIntensity: 1.4,
    }),
    glassLit: standard({
      color: 0x0f2129,
      emissive: 0x6fa8bf,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.2,
    }),
    windowStrip: standard({ map: windowMap, roughness: 0.4, metalness: 0.3 }),
    grille: standard({ map: grilleMap, roughness: 0.7, metalness: 0.4 }),
    hangarFloor: standard({ color: 0x33393d, roughness: 0.9, metalness: 0.15 }),
    hangarWall: standard({ color: 0x4a5257, roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide }),
    frame: new THREE.MeshBasicMaterial({
      color: 0x7fc6dc,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
    frameBright: new THREE.MeshBasicMaterial({
      color: 0x9fdcf0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
    lineSoft: new THREE.LineBasicMaterial({ color: 0xa8c8d6, transparent: true, opacity: 0.22, depthWrite: false }),
    lineRail: new THREE.LineBasicMaterial({ color: 0xbcd2dc, transparent: true, opacity: 0.42, depthWrite: false }),
    lineWarn: new THREE.LineBasicMaterial({ color: 0xe0b266, transparent: true, opacity: 0.5, depthWrite: false }),
    lineGlow: new THREE.LineBasicMaterial({ color: 0x79e6ff, transparent: true, opacity: 0.65, depthWrite: false }),
    markWhite: new THREE.MeshBasicMaterial({ color: 0xe8eef1, transparent: true, opacity: 0.5, depthWrite: false }),
    markWarn: new THREE.MeshBasicMaterial({ color: 0xd8b365, transparent: true, opacity: 0.55, depthWrite: false }),
    glassDark: standard({ color: 0x101c22, roughness: 0.25, metalness: 0.4 }),
    engineGlow: new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.65 }),
    afterburner: new THREE.MeshBasicMaterial({
      color: 0xffb066,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

export function applyMaterialAnisotropy(materials, anisotropy) {
  Object.values(materials).forEach((mat) => {
    if (mat && mat.map) mat.map.anisotropy = Math.min(16, anisotropy);
  });
}
