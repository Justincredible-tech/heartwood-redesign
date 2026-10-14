// Pure pixel metrics for screencast frames (raw RGB/RGBA buffers: {data, width, height, channels}). No browser, no I/O.
// Shared by tools/diagnostics/zoom-troll.mjs; tested by tests/zoom-troll.test.mjs.
//  blank   = an 8 px block that is flat (luma sd < flat, tolerates faint grain) and within tol of a page background colour:
//            nothing but background is on screen there (the project’s "blank or stretched-but-empty screen").
//  sharp   = variance of the 4-neighbour Laplacian of luma on a crop: drops when a tile is a stretched lower-scale raster.
export const BLOCK = 8;
const luma = (d, o) => .299 * d[o] + .587 * d[o + 1] + .114 * d[o + 2];

export function blankMask(f, bgs, {block = BLOCK, tol = 14, flat = 6, y0 = 0, y1 = f.height} = {}) {
  const ch = f.channels || 3, cols = Math.floor(f.width / block), rows = Math.floor((y1 - y0) / block), mask = new Uint8Array(cols * rows), n = block * block;
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    let r = 0, g = 0, b = 0, s = 0, s2 = 0;
    for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) {
      const o = ((y0 + by * block + y) * f.width + bx * block + x) * ch, l = luma(f.data, o);
      r += f.data[o]; g += f.data[o + 1]; b += f.data[o + 2]; s += l; s2 += l * l;
    }
    const sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), m = [r / n, g / n, b / n];
    mask[by * cols + bx] = sd < flat && bgs.some(c => Math.max(...c.map((v, i) => Math.abs(v - m[i]))) < tol) ? 1 : 0;
  }
  return {mask, cols, rows, block, y0};
}
export function blankFraction(f, bgs, opts) { const {mask} = blankMask(f, bgs, opts); let k = 0; for (const v of mask) k += v; return mask.length ? k / mask.length : 0; }

export function laplacianVariance(f, {x = 0, y = 0, w = f.width, h = f.height} = {}) {
  const ch = f.channels || 3, W = f.width, L = (xx, yy) => luma(f.data, (yy * W + xx) * ch);
  let s = 0, s2 = 0, n = 0;
  for (let yy = y + 1; yy < y + h - 1; yy++) for (let xx = x + 1; xx < x + w - 1; xx++) {
    const v = 4 * L(xx, yy) - L(xx - 1, yy) - L(xx + 1, yy) - L(xx, yy - 1) - L(xx, yy + 1); s += v; s2 += v * v; n++;
  }
  return n ? Math.max(0, s2 / n - (s / n) ** 2) : 0;
}
// the most detailed size x size window on a half-size stride (deterministic: first maximum wins)
export function sharpestCrop(f, {size = 128} = {}) {
  size = Math.min(size, f.width, f.height); const step = Math.max(1, size >> 1); let best = {x: 0, y: 0, w: size, h: size, v: -1};
  for (let y = 0; y + size <= f.height; y += step) for (let x = 0; x + size <= f.width; x += step) { const v = laplacianVariance(f, {x, y, w: size, h: size}); if (v > best.v) best = {x, y, w: size, h: size, v}; }
  return best;
}
// mean |channel difference| per block (same-size frames)
export function blockDiff(a, b, {block = BLOCK} = {}) {
  const ca = a.channels || 3, cb = b.channels || 3, cols = Math.floor(a.width / block), rows = Math.floor(a.height / block), out = new Float32Array(cols * rows);
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) { let d = 0;
    for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) { const p = (by * block + y) * a.width + bx * block + x, oa = p * ca, ob = p * cb;
      d += Math.abs(a.data[oa] - b.data[ob]) + Math.abs(a.data[oa + 1] - b.data[ob + 1]) + Math.abs(a.data[oa + 2] - b.data[ob + 2]); }
    out[by * cols + bx] = d / (block * block * 3); }
  return out;
}
// blocks covered by at least a third by any rect [x, y, w, h] (frame px)
export function coverage(rects, cols, rows, block = BLOCK) {
  const m = new Uint8Array(cols * rows);
  for (const [x, y, w, h] of rects) for (let by = Math.max(0, Math.floor(y / block)); by < Math.min(rows, Math.ceil((y + h) / block)); by++) for (let bx = Math.max(0, Math.floor(x / block)); bx < Math.min(cols, Math.ceil((x + w) / block)); bx++) {
    const ov = (Math.min((bx + 1) * block, x + w) - Math.max(bx * block, x)) * (Math.min((by + 1) * block, y + h) - Math.max(by * block, y));
    if (ov >= block * block / 3) m[by * cols + bx] = 1; }
  return m;
}
// ms inside [a, b) that the screen showed >= thr excess blank. film = every presented frame {t, excess} in time order; each
// stays on screen until the next; before the first one nothing new is on screen, which counts as blank.
export function blankTime(film, a, b, thr) {
  const f = [{t: -Infinity, excess: 1}, ...film];
  return f.reduce((ms, r, i) => { const s = Math.max(a, r.t), e = Math.min(b, f[i + 1]?.t ?? b); return e > s && r.excess >= thr ? ms + e - s : ms; }, 0);
}
export const percentile = (a, q) => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : null;
export function mulberry32(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
// troll cycles: zoom in through every level, then straight back to 1; each cycle `speedup` x faster, seeded jitter on every hold
export function zoomSchedule({levels, cycles, hold, speedup, jitter = 0, seed = 1}) {
  const rnd = mulberry32(seed), out = []; let at = 1;
  for (let c = 0; c < cycles; c++) for (const to of [...levels, 1]) { out.push({cycle: c, from: at, to, hold: Math.max(16, Math.round(hold / speedup ** c * (1 + jitter * (rnd() - .5))))}); at = to; }
  return out;
}
