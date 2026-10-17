// Public regression for the grain density-order defect (2026-10-14): JavaScript object key enumeration puts
// integer-like keys first, so `Object.values(provenance.night.tiles)` yields 1, 2, 3, 1.25, 1.5, 1.75, 2.5 —
// six of seven night media steps then select the wrong tile, in both the taste CSS and the preload steps, and
// the phone preload plan breaks the same way. This suite exercises the ACTUAL consumers (buildTaste end to
// end with a capture writer, the composed darkPalette output, and the shared ordered rows) against the real
// provenance. Written before the fix: it fails on the unfixed consumers rather than asserting source strings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, copyFile, writeFile, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROVENANCE = path.join(ROOT, 'source/assets/grain/grain-provenance.json');
const SITE_CSS = path.join(ROOT, 'source/css/heartwood-site.css');
const HTML = path.join(ROOT, 'source/heartwood-site.html');
const TILE_DIR = path.join(ROOT, 'source/assets/grain');

const {GRAIN_DENSITIES, GRAIN_STEP_FROM, grainRows, grainFiles, verifyGrainTileBytes, grainPreloadPlan, grainRecipeSha256} =
  await import(pathToFileURL(path.join(ROOT, 'tools/grain-inputs.mjs')));

const realProvenance = JSON.parse(await readFile(PROVENANCE, 'utf8'));
const realCss = await readFile(SITE_CSS, 'utf8');
const nightFixture = density => realProvenance.night.tiles[density];

function nightFilesFrom(css) {
  return [...css.matchAll(/--grain-tile-night:\s*url\(\.\.\/assets\/grain\/([^)]+)\)/g)].map(match => match[1]);
}

async function tasteFilesFrom(rootDir) {
  const {buildTaste} = await import(pathToFileURL(path.join(ROOT, 'tools/build-taste.mjs')));
  const captured = new Map();
  const result = await buildTaste({
    root: rootDir,
    htmlSource: await readFile(HTML, 'utf8'),
    cssSource: realCss,
    fontCss: '',
    authoredJsPath: 'js/heartwood-site.test.js',
    preloads: '',
    writer: async (publishDir, relative, data) => { captured.set(relative, Buffer.from(data)); },
    exclude: []
  });
  const cssName = result.generated.find(name => /^css\/heartwood-taste\.[0-9a-f]{12}\.css$/.test(name));
  assert.ok(cssName, 'the taste build emitted its stylesheet');
  return nightFilesFrom(captured.get(cssName).toString('utf8'));
}

async function withTempRoot(run) {
  // The output guard demands real path components (on macOS /var is a symlink to /private/var).
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'grain-order-')));
  try {
    await mkdir(path.join(dir, 'source/assets/grain'), {recursive: true});
    await run(dir);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

test('the composed taste palette maps all seven night labels to their matching media step (real provenance)', async () => {
  const rows = grainRows(realProvenance.night, {flavor: 'night'});
  assert.deepEqual(rows.map(row => row.density), GRAIN_DENSITIES, 'rows are canonically ordered');
  const {darkPalette} = await import(pathToFileURL(path.join(ROOT, 'source/taste/taste-dark.mjs')));
  const files = nightFilesFrom(darkPalette(realCss, grainFiles(rows)));
  assert.equal(files.length, 7);
  assert.equal(files[0], nightFixture('1').file, 'base declaration is the 1x tile');
  for (let i = 1; i < GRAIN_DENSITIES.length; i++) {
    assert.equal(files[i], nightFixture(GRAIN_DENSITIES[i]).file,
      `media step ${i} must be the ${GRAIN_DENSITIES[i]}x tile, not ${/@([\d.]+)x\./.exec(files[i])?.[1]}x`);
  }
});

test('buildTaste consumes the real provenance in canonical order (actual consumer, capture writer)', async () => {
  await withTempRoot(async dir => {
    await copyFile(PROVENANCE, path.join(dir, 'source/assets/grain/grain-provenance.json'));
    const files = await tasteFilesFrom(dir);
    assert.equal(files.length, 7);
    for (let i = 0; i < GRAIN_DENSITIES.length; i++) {
      assert.equal(files[i], nightFixture(GRAIN_DENSITIES[i]).file,
        `taste step ${i} must be the ${GRAIN_DENSITIES[i]}x tile`);
    }
  });
});

test('buildTaste stays canonical when the provenance keys are written in shuffled order', async () => {
  await withTempRoot(async dir => {
    const shuffled = {
      ...realProvenance,
      night: {...realProvenance.night, tiles: Object.fromEntries(
        ['3', '1', '2.5', '2', '1.75', '1.5', '1.25'].map(density => [density, nightFixture(density)]))}
    };
    await writeFile(path.join(dir, 'source/assets/grain/grain-provenance.json'), JSON.stringify(shuffled, null, 2));
    const files = await tasteFilesFrom(dir);
    for (let i = 0; i < GRAIN_DENSITIES.length; i++) {
      assert.equal(files[i], nightFixture(GRAIN_DENSITIES[i]).file, `shuffled step ${i}`);
    }
  });
});

test('the real day provenance matches the stylesheet declaration order', async () => {
  const dayRows = grainRows(realProvenance, {flavor: 'day'});
  const base = /--grain-tile:\s*url\(\.\.\/assets\/grain\/([^)]+)\);/.exec(realCss)?.[1];
  const steps = [...realCss.matchAll(/@media \(min-resolution: [\d.]+dppx\)[^{]*\{ :root \{ --grain-tile: url\(\.\.\/assets\/grain\/([^)]+)\); \} \}/g)].map(m => m[1]);
  assert.equal(base, dayRows[0].file);
  assert.deepEqual(steps, dayRows.slice(1).map(row => row.file));
});

test('grainRows validates the record shape, labels, filenames, uniqueness and the recipe pin', () => {
  const section = realProvenance.night;
  const clone = () => JSON.parse(JSON.stringify(section));
  assert.throws(() => grainRows({...clone(), tile_css_px: 128}, {flavor: 'night'}), /tile_css_px/);
  const missing = clone(); delete missing.tiles['2.5'];
  assert.throws(() => grainRows(missing, {flavor: 'night'}), /exactly 7|missing density/);
  const unknown = clone(); unknown.tiles['4'] = unknown.tiles['3'];
  assert.throws(() => grainRows(unknown, {flavor: 'night'}), /unknown density|exactly 7/);
  const duplicated = clone(); duplicated.tiles['2.5'] = duplicated.tiles['2'];
  assert.throws(() => grainRows(duplicated, {flavor: 'night'}), /names the 2x tile|reused|duplicate/);
  const mislabelled = clone(); mislabelled.tiles['1.5'] = mislabelled.tiles['1.25'];
  assert.throws(() => grainRows(mislabelled, {flavor: 'night'}), /1\.25x|density/);
  const wrongFlavor = clone(); wrongFlavor.tiles['1'] = realProvenance.tiles['1'];
  assert.throws(() => grainRows(wrongFlavor, {flavor: 'night'}), /filename|night/);
  const wrongSize = clone(); wrongSize.tiles['1'] = {...wrongSize.tiles['1'], file: wrongSize.tiles['1'].file.replace('256@', '512@')};
  assert.throws(() => grainRows(wrongSize, {flavor: 'night'}), /filename/);
  const badBytes = clone(); badBytes.tiles['1'] = {...badBytes.tiles['1'], bytes: 0};
  assert.throws(() => grainRows(badBytes, {flavor: 'night'}), /byte count/);
  assert.throws(() => grainRows(clone(), {flavor: 'night', expectedRecipeSha256: 'f'.repeat(64)}), /recipe pin/);
  assert.equal(grainRows(clone(), {flavor: 'night', expectedRecipeSha256: section.recipe_sha256}).length, 7);
});

test('verifyGrainTileBytes rejects wrong counts and same-length altered bytes', async () => {
  const [row] = grainRows(realProvenance.night, {flavor: 'night'});
  const bytes = await readFile(path.join(TILE_DIR, row.file));
  verifyGrainTileBytes(row, bytes);                                   // the adopted tile passes untouched
  assert.throws(() => verifyGrainTileBytes(row, bytes.subarray(0, bytes.length - 1)), /byte count/);
  const sameLength = Buffer.from(bytes);
  sameLength[sameLength.length >> 1] ^= 0xFF;
  assert.throws(() => verifyGrainTileBytes(row, sameLength), /fingerprint/);
  const synthetic = (width, height) => {
    const body = Buffer.alloc(9);
    body[0] = 0x2F;
    body.writeUInt32LE(((width - 1) & 0x3FFF) | (((height - 1) & 0x3FFF) << 14), 1);
    const chunk = Buffer.concat([Buffer.from('VP8L', 'ascii'), Buffer.from([9, 0, 0, 0]), body]);
    const riff = Buffer.alloc(12 + chunk.length);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(4 + chunk.length, 4);
    riff.write('WEBP', 8, 'ascii');
    chunk.copy(riff, 12);
    const fingerprint = createHash('sha256').update(riff).digest('hex').slice(0, 12);
    return {row: {density: '1', file: `grain-fine-256@1x.${fingerprint}.webp`, bytes: riff.length, fingerprint}, bytes: riff};
  };
  const rightDims = synthetic(256, 256);
  verifyGrainTileBytes(rightDims.row, rightDims.bytes);                       // fingerprint and dimensions both pass
  const wrongDims = synthetic(100, 100);
  assert.throws(() => verifyGrainTileBytes(wrongDims.row, wrongDims.bytes), /dimensions/);
});

test('the preload plan carries the canonical media steps', () => {
  const rows = grainRows(realProvenance.night, {flavor: 'night'});
  const plan = grainPreloadPlan(rows);
  assert.deepEqual(plan.map(entry => entry.density), GRAIN_DENSITIES);
  assert.equal(plan[0].media, '(max-resolution: 1.124dppx)');
  assert.equal(plan[1].media, '(min-resolution: 1.125dppx) and (max-resolution: 1.374dppx)');
  assert.equal(plan[6].media, '(min-resolution: 2.75dppx)');
  assert.deepEqual(plan.map(entry => entry.file), grainFiles(rows));
});

test('sensitivity: the raw object enumeration order is the trap this suite guards against', async () => {
  // JavaScript enumerates integer-like keys first: "1","2","3" then the rest. Feeding that order to
  // darkPalette mis-maps six of seven steps; the canonical rows must never be replaced by Object.values.
  const raw = Object.values(realProvenance.night.tiles).map(row => row.file);
  const canonical = grainFiles(grainRows(realProvenance.night, {flavor: 'night'}));
  assert.notDeepEqual(raw, canonical, 'raw enumeration differs from canonical order');
  const {darkPalette} = await import(pathToFileURL(path.join(ROOT, 'source/taste/taste-dark.mjs')));
  const files = nightFilesFrom(darkPalette(realCss, raw));
  const wrong = files.filter((name, i) => name !== nightFixture(GRAIN_DENSITIES[i]).file).length;
  assert.equal(wrong, 6, 'the raw order mis-maps exactly six of the seven steps (the 046 defect)');
});

test('the shared order constants are frozen', () => {
  assert.ok(Object.isFrozen(GRAIN_DENSITIES) && Object.isFrozen(GRAIN_STEP_FROM));
  assert.throws(() => { GRAIN_DENSITIES.push('4'); }, TypeError);
  assert.throws(() => { GRAIN_STEP_FROM[0] = 9; }, TypeError);
});

test('the JS recipe derivation reproduces the shipped day and night pins exactly', () => {
  assert.equal(grainRecipeSha256(realCss, 'day'), realProvenance.recipe_sha256);
  assert.equal(grainRecipeSha256(realCss, 'night'), realProvenance.night.recipe_sha256);
  assert.equal(grainRows(realProvenance.night, {flavor: 'night', expectedRecipeSha256: grainRecipeSha256(realCss, 'night')}).length, 7);
  assert.throws(() => grainRows(realProvenance, {flavor: 'day', expectedRecipeSha256: 'f'.repeat(64)}), /recipe pin/);
});
