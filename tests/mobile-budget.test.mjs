// Absolute budgets for the separate phone build (never compared to the original): first-screen art bytes and
// decoded pixels, only phone-sized assets, DOM size, and the ambient motion rules (four layers, compositor only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {mobileBuild} from './mobile-build-fixture.mjs';
import {PHOTO_INPUTS} from '../tools/mobile-source-inputs.mjs';

export const BUDGET = {firstScreenArt3x: 150 * 1024, firstScreenDecodedPx3x: 3.5e6, dom: 1500, pageBytes3x: 760 * 1024, ambientLayers: 4};
// the art on the arrival screen (header, headline, the whole tree in its sky): tree, hills, clouds, the sky critters
const FIRST = ['tree', 'ridges', 'clouds', 'sky'];
const size = (out, p) => readFileSync(join(out, p)).length;

test('first-screen art at @3x is at most 150 KB (AVIF), by day and by night', async () => {
  const {out, manifest} = await mobileBuild();
  for (const sfx of ['', '-night']) {
    const bytes = FIRST.reduce((n, k) => n + size(out, manifest.art[k + sfx]['3x.avif']), 0);
    console.log(`# first-screen art @3x AVIF${sfx || ' (day)'}: ${(bytes / 1024).toFixed(1)} KB`);
    assert(bytes <= BUDGET.firstScreenArt3x, `first-screen art${sfx} ${bytes} B > ${BUDGET.firstScreenArt3x}`);
  }
});

test('first-screen decoded pixels at @3x stay bounded (decoded size, not just bytes)', async () => {
  const {manifest} = await mobileBuild();
  const px = FIRST.reduce((n, k) => n + manifest.art[k].px3[0] * manifest.art[k].px3[1], 0);
  console.log(`# first-screen decoded @3x: ${(px / 1e6).toFixed(2)} MP = ${(px * 4 / 2 ** 20).toFixed(1)} MiB RGBA`);
  assert(px <= BUDGET.firstScreenDecodedPx3x);
});

test('a whole visit (all day art @3x AVIF, fonts, page) fits the budget; photos only load on demand', async () => {
  const {out, manifest, html} = await mobileBuild();
  const art = Object.entries(manifest.art).filter(([k]) => !k.endsWith('-night')).reduce((n, [, a]) => n + size(out, a['3x.avif']), 0);
  const css = manifest.files.find(f => /^assets\/mobile-(?:light|dark)\.[0-9a-f]+\.css$/.test(f.path)).bytes, js = manifest.files.find(f => /^assets\/mobile\.[0-9a-f]+\.js$/.test(f.path)).bytes;
  const fonts = manifest.files.filter(f => f.path.endsWith('.woff2') && /SZe1Q|t93kY/.test(f.path)).reduce((n, f) => n + f.bytes, 0);   // latin files
  const total = art + css + js + fonts + Buffer.byteLength(html);
  console.log(`# visit @3x (uncompressed text): art ${(art / 1024).toFixed(0)} KB, fonts ${(fonts / 1024).toFixed(0)} KB, html+css+js ${((css + js + Buffer.byteLength(html)) / 1024).toFixed(0)} KB = ${(total / 1024).toFixed(0)} KB`);
  assert(total <= BUDGET.pageBytes3x, `visit ${total} B > ${BUDGET.pageBytes3x}`);
});

test('only the phone asset family is referenced: nothing from the desktop scene, nothing missing, nothing unused', async () => {
  const {out, html} = await mobileBuild();
  const cssFile = /href="(assets\/mobile-(?:light|dark)\.[0-9a-f]+\.css)"/.exec(html)[1];
  const css = readFileSync(join(out, cssFile), 'utf8');
  const nightHtml = readFileSync(join(out, 'night.html'), 'utf8');
  const darkCss = readFileSync(join(out, /href="(assets\/mobile-dark\.[0-9a-f]+\.css)"/.exec(nightHtml)[1]), 'utf8');
  const data = /<script type="application\/json" id="hw-records">([\s\S]*?)<\/script>/.exec(html)[1];
  const refs = new Set([...html.matchAll(/assets\/[\w@.-]+/g), ...nightHtml.matchAll(/assets\/[\w@.-]+/g), ...data.matchAll(/assets\/[\w@.-]+/g)].map(m => m[0]).concat([...css.matchAll(/url\(([\w@.-]+)\)/g), ...darkCss.matchAll(/url\(([\w@.-]+)\)/g)].map(m => 'assets/' + m[1])));
  const files = new Set(readdirSync(join(out, 'assets')).map(f => 'assets/' + f));
  for (const r of refs) assert(files.has(r), 'missing asset ' + r);
  for (const f of files) if (!/-OFL\.txt\.[0-9a-f]+\.txt$/.test(f)) assert(refs.has(f), 'emitted but unused ' + f);   // the OFL license texts ship beside their fonts as provenance, not as page sub-resources
  // (the record data keeps the original image path only as the key to its phone-sized picture; it is never fetched)
  const markup = (html + nightHtml).replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '');
  const sourcePhotoKeys=new Set(PHOTO_INPUTS.map(p=>p.url));
  let scrubbed=markup + css + darkCss;
  for (const url of sourcePhotoKeys) scrubbed=scrubbed.split(url).join('');   // the reviewed source-photo URLs are allowlisted noscript fallbacks, exactly as in the record data below
  assert(!/_external|heartwood\.[0-9a-f]{16}\.css|leaf\.[0-9a-f]{16}\.js|\/optimized\//.test(markup + css + darkCss), 'desktop asset referenced');
  assert(!/(?:src|srcset)="[^"]*https?:|url\(["']?https?:/.test(scrubbed), 'third-party sub-resource referenced');
  for (const m of data.matchAll(/"src":"([^"]+)"/g)) assert(m[1].startsWith('assets/') || sourcePhotoKeys.has(m[1]), 'unexpected record image ' + m[1]);
});

test(`the static page has fewer than ${BUDGET.dom} DOM elements`, async () => {
  const {html} = await mobileBuild();
  const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<script></script>');
  const elements = [...body.matchAll(/<[a-zA-Z][\w-]*[\s>/]/g)].length;
  console.log('# DOM elements in the shipped HTML: ' + elements);
  assert(elements < BUDGET.dom);
});

test('ambient motion: four layers (sky, wingbeats, canopy, ground), each one element, transform/opacity only; no animated filter, mask or clip-path', async () => {
  const {out, html} = await mobileBuild();
  const css = readFileSync(join(out, /href="(assets\/mobile-(?:light|dark)\.[0-9a-f]+\.css)"/.exec(html)[1]), 'utf8');
  const frames = [...css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?\})\s*\}/g)];
  for (const [, name, body] of frames) {
    const props = new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map(m => m[1]));
    for (const p of props) assert(['transform', 'opacity', 'animation-timing-function'].includes(p), `@keyframes ${name} animates ${p}`);   // (per-keyframe easing is not an animated property)
  }
  // infinite animations = ambient; they may only sit on the four critter layers: sky, the flock's wingbeat strip inside it (the 4th layer,
  // approved by the project 2026-10-12), canopy (bee; the fireflies swap in at night in the same layer) and ground
  const ambient = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*animation:[^;{}]*infinite[^{}]*\}/g)].map(m => m[1].trim());
  for (const sel of ambient) assert(/^\.crit--(sky|wings|bee|walk|flies)$/.test(sel), 'ambient animation outside the four layers: ' + sel);
  const layers = new Set(ambient.map(s => s === '.crit--flies' ? '.crit--bee' : s));
  assert.equal(layers.size, BUDGET.ambientLayers, [...layers].join());
  assert(/\.crit--wings \{[^}]*animation: wings [^;}]*steps\(/.test(css), 'the wingbeat layer steps through its baked frames');
  assert(/<i class="crit crit--sky"><i class="crit crit--wings"><\/i><\/i>/.test(html), 'the wingbeat strip sits inside the sky element');
  assert.equal([...html.matchAll(/class="crit crit--/g)].length, 5, 'five critter elements: sky, wings, bee, fireflies (night, same layer), walkers');
  assert(/\.is-live \.on \.crit \{ animation-play-state: running; \}/.test(css) && /\.birds \.crit, \.bees \.crit, \.bugs \.crit \{ animation-play-state: paused; \}/.test(css), 'ambient motion must be paused unless on screen and active');
});
