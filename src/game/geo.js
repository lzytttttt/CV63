/**
 * 战术平面几何与显示格式。
 * 坐标：x 向东（km），y 向北（km），航母为原点；方位角 0° = 正北，顺时针。
 * 本模块不依赖 three.js / DOM，可在 Node 中直接测试。
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const KN_PER_KMPS = 1943.8444924406;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export function bearingBetween(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.atan2(dx, dy) * RAD + 360) % 360;
}

export function rangeBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function destination(origin, bearingDeg, distance) {
  const rad = bearingDeg * DEG;
  return {
    x: origin.x + Math.sin(rad) * distance,
    y: origin.y + Math.cos(rad) * distance,
  };
}

/** -180 … 180 */
export function angleDelta(a, b) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/** 方位是否落在以 center 为中心、半宽 halfWidth 的扇区（自动跨 0°） */
export function inArc(bearing, center, halfWidth) {
  return Math.abs(angleDelta(bearing, center)) <= halfWidth;
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function formatBearing(deg) {
  return String(Math.round((((deg % 360) + 360) % 360))).padStart(3, "0");
}

export function formatRange(km) {
  if (!Number.isFinite(km)) return "—";
  if (km < 10) return km.toFixed(1);
  return String(Math.round(km));
}

export function formatSpeed(kmps) {
  return String(Math.round(kmps * KN_PER_KMPS));
}

export function formatPercent(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

/** 航迹质量分档，UI 与规则共用 */
export function qualityBand(quality) {
  if (quality >= 0.8) return "A";
  if (quality >= 0.6) return "B";
  if (quality >= 0.4) return "C";
  return "D";
}

export function objectivePoints(pos) {
  return { x: pos.x, y: pos.y };
}
