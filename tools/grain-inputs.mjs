// Shared grain-tile admission (2026-10-14, codex-056/057): the provenance record is keyed by density labels,
// and JavaScript object key enumeration puts integer-like keys first ("1", "2", "3", then the rest), so any
// positional consumer of Object.values(tiles) reads the seven densities out of order. This module is the one
// place that turns the record into explicitly SORTED rows (1, 1.25, 1.5, 1.75, 2, 2.5, 3), validates the
// record, the 256px filename size, the byte count, the SHA256-prefix fingerprint and the intrinsic pixel
// dimensions, derives the canonical preload media steps, and verifies the record against the current recipe
// hashes derived exactly like tools/render-grain.py (day: whitespace-collapsed --grain-fine; night: the same
// text with highlights x0.55 and shadows x1.3 at three decimals). Consumers never enumerate the object.
import crypto from 'node:crypto';

export const GRAIN_DENSITIES = Object.freeze(['1', '1.25', '1.5', '1.75', '2', '2.5', '3']);
export const GRAIN_TILE_CSS_PX = 256;
export const GRAIN_STEP_FROM = Object.freeze([0, 1.125, 1.375, 1.625, 1.875, 2.25, 2.75]);
const TILE_NAME = {
  day: /^grain-fine-256@([\d.]+)x\.([0-9a-f]{12})\.webp$/,
  night: /^grain-fine-night-256@([\d.]+)x\.([0-9a-f]{12})\.webp$/
};

export function dayRecipe(cssText) {
  const match = /--grain-fine:\s*([\s\S]*?);/.exec(cssText);
  if (!match) throw Error('grain recipe: no --grain-fine in the stylesheet');
  return match[1].trim().split(/\s+/).join(' ');
}

export function nightRecipe(cssText) {
  return dayRecipe(cssText)
    .replace(/rgb\(255 255 255 \/ ([\d.]+)\)/g, (_, alpha) => `rgb(255 255 255 / ${(parseFloat(alpha) * 0.55).toFixed(3)})`)
    .replace(/rgb\(0 0 0 \/ ([\d.]+)\)/g, (_, alpha) => `rgb(0 0 0 / ${(parseFloat(alpha) * 1.3).toFixed(3)})`);
}

export function grainRecipeSha256(cssText, flavor) {
  if (flavor !== 'day' && flavor !== 'night') throw Error('grain flavor must be day or night');
  const recipe = flavor === 'day' ? dayRecipe(cssText) : nightRecipe(cssText);
  return crypto.createHash('sha256').update(recipe, 'utf8').digest('hex');
}

export function grainRows(section, {flavor, expectedRecipeSha256 = null} = {}) {
  if (flavor !== 'day' && flavor !== 'night') throw Error('grain flavor must be day or night');
  if (!section || typeof section !== 'object' || Array.isArray(section)) throw Error(`grain ${flavor} provenance section missing`);
  if (section.tile_css_px !== GRAIN_TILE_CSS_PX) throw Error(`grain ${flavor} tile_css_px must be ${GRAIN_TILE_CSS_PX}`);
  const tiles = section.tiles;
  if (!tiles || typeof tiles !== 'object' || Array.isArray(tiles)) throw Error(`grain ${flavor} tiles missing`);
  const keys = Object.keys(tiles);
  if (keys.length !== GRAIN_DENSITIES.length) throw Error(`grain ${flavor} tiles must hold exactly ${GRAIN_DENSITIES.length} densities`);
  for (const density of GRAIN_DENSITIES) {
    if (!Object.prototype.hasOwnProperty.call(tiles, density)) throw Error(`grain ${flavor} is missing density ${density}`);
  }
  for (const key of keys) {
    if (!GRAIN_DENSITIES.includes(key)) throw Error(`grain ${flavor} has an unknown density ${key}`);
  }
  const seen = new Set();
  const rows = [];
  for (const density of GRAIN_DENSITIES) {
    const record = tiles[density];
    if (!record || typeof record !== 'object') throw Error(`grain ${flavor} record ${density} malformed`);
    const match = typeof record.file === 'string' ? TILE_NAME[flavor].exec(record.file) : null;
    if (!match) throw Error(`grain ${flavor} record ${density} is not a ${GRAIN_TILE_CSS_PX}px ${flavor} tile filename: ${record.file}`);
    if (match[1] !== density) throw Error(`grain ${flavor} record ${density} names the ${match[1]}x tile`);
    if (seen.has(record.file)) throw Error(`grain ${flavor} tile reused: ${record.file}`);
    seen.add(record.file);
    if (!Number.isSafeInteger(record.bytes) || record.bytes <= 0) throw Error(`grain ${flavor} record ${density} has no valid byte count`);
    rows.push({density, file: record.file, bytes: record.bytes, fingerprint: match[2]});
  }
  if (expectedRecipeSha256 != null && section.recipe_sha256 !== expectedRecipeSha256) {
    throw Error(`grain ${flavor} recipe pin mismatch: the stylesheet recipe no longer matches the tiles; run tools/render-grain.py`);
  }
  return rows;
}

export function grainFiles(rows) {
  return rows.map(row => row.file);
}

function webpDimensions(bytes) {
  if (bytes.length < 16 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw Error('grain tile is not a WebP RIFF container');
  }
  let at = 12, canvas = null;
  while (at + 8 <= bytes.length) {
    const fourcc = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    if (size > bytes.length - body) throw Error('grain tile WebP chunk exceeds the file');
    if (fourcc === 'VP8X') {
      if (size < 10) throw Error('grain tile VP8X header malformed');
      canvas = {width: 1 + (bytes[body + 4] | (bytes[body + 5] << 8) | (bytes[body + 6] << 16)),
        height: 1 + (bytes[body + 7] | (bytes[body + 8] << 8) | (bytes[body + 9] << 16))};
    } else if (fourcc === 'VP8L') {
      if (size < 5 || bytes[body] !== 0x2F) throw Error('grain tile VP8L header malformed');
      const bits = bytes.readUInt32LE(body + 1);
      return {width: (bits & 0x3FFF) + 1, height: ((bits >>> 14) & 0x3FFF) + 1};
    } else if (fourcc === 'VP8 ') {
      if (size < 10) throw Error('grain tile VP8 header malformed');
      return {width: bytes.readUInt16LE(body + 6) & 0x3FFF, height: bytes.readUInt16LE(body + 8) & 0x3FFF};
    }
    at = body + size + (size % 2);
  }
  if (canvas) return canvas;
  throw Error('grain tile WebP dimensions not found');
}

export function verifyGrainTileBytes(row, bytes) {
  if (!bytes || typeof bytes.length !== 'number') throw Error('grain tile bytes must be a buffer');
  if (bytes.length !== row.bytes) throw Error(`grain tile byte count changed: ${row.file}`);
  const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  if (fingerprint !== row.fingerprint) throw Error(`grain tile fingerprint changed: ${row.file}`);
  const expected = GRAIN_TILE_CSS_PX * Number(row.density);
  const {width, height} = webpDimensions(bytes);
  if (width !== expected || height !== expected) {
    throw Error(`grain tile dimensions changed: ${row.file} is ${width}x${height}, expected ${expected}px`);
  }
}

export function grainMedia(index) {
  const from = GRAIN_STEP_FROM[index], next = GRAIN_STEP_FROM[index + 1];
  return [from && `(min-resolution: ${from}dppx)`, next && `(max-resolution: ${(next - .001).toFixed(3)}dppx)`].filter(Boolean).join(' and ');
}

export function grainPreloadPlan(rows) {
  return rows.map((row, index) => ({density: row.density, file: row.file, media: grainMedia(index)}));
}
