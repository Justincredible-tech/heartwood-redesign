// Focused grain-wiring tests (codex-046, written before the wiring): the dedicated night tile replaces the
// live fine expansion in BOTH night paths — desktop taste (prepareTaste → darkCss → darkPalette → grainOf)
// and phone (loadNight → mobileNight/ darkCss) — the three mottles stay live with the approved night alpha,
// phone day switches to the shipped day tile, and the data-absent fallback keeps the live expansion.
// Pure Node: reads real source files, no browser, no writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {prepareTaste} from '../source/taste/index.mjs';
import {loadNight, darkCss} from '../source/mobile/night.mjs';
import {forceColourScheme} from '../tools/mobile-theme.mjs';

const FORK = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(FORK + p, 'utf8');
const siteHtml = read('source/heartwood-site.html');
const siteCss = read('source/css/heartwood-site.css');
const referenceCss = read('source/mobile/reference-paper.css');
const mobileCss = read('source/mobile/mobile.css');
const provenance = JSON.parse(read('source/assets/grain/grain-provenance.json'));
const nightNames = Object.values(provenance.night.tiles).map(record => record.file);
const scopedNightRoots = css => [...css.matchAll(/html\[data-hw-theme="night"\]\{([^}]*)\}/g)].map(m => m[1]).join('\n');

test('prepareTaste wires the night tile plus the three live mottles (desktop taste)', () => {
  const t = prepareTaste({html: siteHtml, css: siteCss, nightTiles: nightNames});
  const roots = scopedNightRoots(t.css);
  assert.match(roots, /--grain: var\(--grain-tile-night\) 0 0 \/ 256px 256px,/);
  assert.match(roots, /--grain-tile-night: url\(\.\.\/assets\/grain\/grain-fine-night-256@1x\./);
  assert(!/var\(--grain-tile\)/.test(roots), 'no day-tile reference may remain in the night root');
  assert.match(roots, /rgb\(255 255 255 \/ 0\.039\)/, 'mottles keep the approved night alpha');
  assert.match(roots, /rgb\(0 0 0 \/ 0\.078\)/);
  for (const name of nightNames) assert(t.css.includes('grain/' + name), 'every night tile is referenced: ' + name);
  assert.match(t.contract.grain, /tile/i);
});

test('prepareTaste keeps the live fallback when no night tiles are available', () => {
  const t = prepareTaste({html: siteHtml, css: siteCss});
  const roots = scopedNightRoots(t.css);
  assert(!/grain-tile-night/.test(roots), 'no tile declarations without tile data');
  assert.match(roots, /0 \.5px/, 'fine flecks are painted live again when the tile data is absent');
});
test('excluding Night removes even supplied Night tiles, art and runtime; static fallback is Day', () => {
  const t = prepareTaste({html:siteHtml, css:siteCss, nightTiles:nightNames, exclude:['night']});
  assert(!t.css.includes('grain-tile-night'));
  for(const name of nightNames)assert(!t.css.includes(name));
  assert(!t.html.includes('hw-firefly-extra'));
  assert(t.html.includes('data-hw-theme="day"'));
  assert(!t.headJs.includes('darkreader'));
  assert.equal(t.contract.nightFireflies,0);
});

test('phone night uses the tile with nested density steps; day keeps only its own family', async () => {
  const n = await loadNight(FORK, {siteCss: referenceCss, nightTile: true});
  assert.match(n.tokens['--grain'], /^var\(--grain-tile-night\) 0 0 \/ 256px 256px,/);
  assert.match(n.tokens['--grain'], /rgb\(255 255 255 \/ 0\.039\)/);
  assert(!/0 \.5px/.test(n.tokens['--grain']), 'the fine half is the tile, not live flecks');
  const css = darkCss(n);
  assert.match(css, /--grain-tile-night: url\(@grain-night-1x\)/);
  assert.match(css, /@media \(min-resolution: 1\.125dppx\)[^{]*\{ :root \{ --grain-tile-night: url\(@grain-night-1\.25x\)/);
  assert.match(css, /--grain: var\(--grain-tile-night\) 0 0 \/ 256px 256px/);
  const dark = forceColourScheme(css, 'dark');
  assert.match(dark, /--grain-tile-night: url\(@grain-night-1x\)/, 'the night build keeps the tile declarations');
  const light = forceColourScheme(css, 'light');
  assert(!/grain-tile-night/.test(light), 'the day build carries no night tile declarations');
  const fallback = await loadNight(FORK, {siteCss: referenceCss, nightTile: false});
  assert.match(fallback.tokens['--grain'], /0 \.5px/, 'fallback keeps the live fine layers');
  assert(!/@grain-night/.test(darkCss(fallback)), 'fallback declares no tile');
});

test('mobile.css carries the day tile and placeholder steps; the builders resolve the placeholders', () => {
  assert.match(mobileCss, /--grain:\s*\n\s*var\(--grain-tile\) 0 0 \/ 256px 256px,/);
  assert.match(mobileCss, /--grain-tile: url\(@grain-day-1x\)/);
  assert.match(mobileCss, /@media \(min-resolution: 1\.125dppx\)[^{]*\{ :root \{ --grain-tile: url\(@grain-day-1\.25x\)/);
  assert(read('tools/build-mobile.mjs').includes('@grain-(day|night)-'), 'build-mobile resolves the grain placeholders');
  assert(read('tools/build-site.mjs').includes('grain-fine-night-'), 'build-site publishes the night family');
});

test('the packager allowlist and the delivery pin cover the night family', () => {
  assert(read('tools/package-upload.py').includes('grain-fine(?:-night)?-'), 'packager accepts night tiles');
  const delivery = read('tools/test-delivery.py');
  assert(delivery.includes("provenance.get('night')"), 'delivery pins the night section');
  assert(delivery.includes('render-grain'), 'delivery reuses the render-grain transform for the night pin');
});
