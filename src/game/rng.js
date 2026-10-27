/**
 * 确定性随机源（mulberry32）。
 * 整场推演只使用这一个随机源，命令序列相同的两次运行必须得到完全相同的结果。
 */
export function createRng(seed = 0x5eed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.chance = (p) => next() < p;
  next.range = (min, max) => min + next() * (max - min);
  next.int = (min, max) => Math.floor(min + next() * (max - min + 1));
  next.pick = (list) => list[Math.min(list.length - 1, Math.floor(next() * list.length))];
  next.sign = () => (next() < 0.5 ? -1 : 1);
  return next;
}
