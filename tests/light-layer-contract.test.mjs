// Light-layer contract regression: the crown's dim/lit/hover/focus brightness values, the single-instance
// overlay layers (scrim/lift/dialog/tag, plus the taste overlay and its bounded, removed clones), and the
// coalesced light/scroll wiring (lightSoon/stuckSoon) must stay exactly as shipped. These are the states a
// regression most easily flips: stale/duplicate layers, wrong brightness, or an uncoalesced light path.
// Cheap and browser-free; the runtime counterparts (per-frame dwell stability, rapid-crossing flip counts)
// are measured in the acceptance lane. If the art or interaction is deliberately edited, update the expected
// values here and re-verify the approved visual references before shipping.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = async url => { try { return await readFile(url, 'utf8'); } catch { return null; } };
const FILES = {
  html: await read(new URL('../source/heartwood-site.html', import.meta.url)),
  css: await read(new URL('../source/css/heartwood-site.css', import.meta.url)),
  js: await read(new URL('../source/js/heartwood-site.js', import.meta.url)),
  tasteNet: await read(new URL('../source/taste/taste-network.mjs', import.meta.url)),
  tasteTree: await read(new URL('../source/taste/taste-tree.mjs', import.meta.url)),
};
for (const [name, text] of Object.entries(FILES)) assert.ok(typeof text === 'string' && text.length > 1000, 'source file missing: ' + name);
const count = (text, re) => (text.match(re) || []).length;
const LAYER_IDS = ['scrim', 'lift', 'dialog', 'leaftag', 'stage', 'net', 'key-chips', 'groups', 'group-find', 'group-tally', 'dialog-close', 'dialog-title'];

// ---- the checkers (each returns violations; the self-test below proves each can fail) ----
function layerViolations(f) {
  const v = [];
  for (const id of LAYER_IDS) {
    const n = count(f.html, new RegExp('id=["\']?' + id + '["\']?(?=[\\s>])', 'g'));
    if (n !== 1) v.push('layer id="' + id + '" appears ' + n + ' times (want exactly 1): stale/duplicate layer');
  }
  if (count(f.js, /lift\.appendChild\(fx\)/g) !== 1) v.push('the flyer is not created exactly once (lift.appendChild(fx))');
  if (count(f.js, /a\.fx\.remove\(\);/g) !== 1) v.push('the flyer is not removed on the close path (missing a.fx.remove()): stale layer risk');
  if (!/function build\(\)\{\s*if\(ov\)return;\s*ov=document\.createElement\('div'\);ov\.className='net__hyphae hw-taste-ov';/.test(f.tasteNet))
    v.push('the taste network overlay is not created once behind a guard: duplicate overlay risk');
  if (count(f.tasteNet, /ov=document\.createElement\('div'\)/g) !== 1) v.push('the taste network creates its overlay in more than one place');
  if (!/hy\.after\(ov\);/.test(f.tasteNet)) v.push('the taste network overlay is not attached as a single node after the base');
  if (!/const unthread=\(\)=>\{for\(const i of hy\.querySelectorAll\(':scope > i\.is-lit'\)\)i\.classList\.remove\('is-lit'\);\}/.test(f.tasteNet))
    v.push('the taste network lost unthread() (base strips must net to unlit; one route at a time)');
  if (!/ov\|\|=document\.createElement\('div'\)/.test(f.tasteTree)) v.push('the taste tree overlay is not a lazily created singleton (ov||=...): duplicate overlay risk');
  if (!/if\(!ov\.isConnected\)wood\.after\(ov\)/.test(f.tasteTree)) v.push('the taste tree overlay is not re-attached as a single node (stale/duplicate overlay risk)');
  if (!/while\(recs\.size>MAX\)kill\(/.test(f.tasteTree)) v.push('the taste tree lost its concurrent-clone bound (while(recs.size>MAX)kill)');
  if (!/r\.L\.remove\(\);r\.U\.remove\(\);/.test(f.tasteTree)) v.push('taste tree kill() no longer removes both clone layers');
  return v;
}
function brightnessViolations(f) {
  const v = [], css = f.css;
  if (!/\.tree\.is-filtered \.leaf:not\(\.is-lit\):not\(:focus-visible\)\s*\{\s*opacity:\s*\.24;\s*filter:\s*saturate\(\.3\);\s*\}/.test(css))
    v.push('the filtered dim rule (.24 opacity, saturate(.3)) is missing or changed');
  if (/\.tree\.is-filtered \.leaf:not\(\.is-lit\)\s*\{/.test(css))
    v.push('the dim rule lost its :focus-visible exclusion (a focused leaf would lose its ring)');
  if (!/\.tree\.is-filtered \.leaf\.is-lit\s*\{\s*--lift:\s*1\.5;\s*z-index:\s*4;\s*\}/.test(css))
    v.push('the filtered lit rule (--lift 1.5, z-index 4) is missing or changed');
  if (!/button\.leaf:hover\s*\{\s*--lift:\s*1\.9;\s*z-index:\s*5;\s*transform:\s*translate\(-50%, -100%\) rotate\(calc\(var\(--angle\) \+ 3deg\)\) scale\(1\.14\);\s*\}/.test(css))
    v.push('the hover promotion pose (--lift 1.9, +3deg, scale 1.14) is missing or changed');
  if (!/filter: drop-shadow\(var\(--sx\) var\(--sy\) calc\(1\.7 \* var\(--lift\) \* var\(--u\)\) rgb\(18 34 14 \/ \.42\)\)/.test(css))
    v.push('the leaf paper shadow (alpha drop-shadow rgb(18 34 14 / .42)) is missing or changed');
  if (!/\.leaf:focus-visible\s*\{[^}]*filter:\s*drop-shadow\(/.test(css)) v.push('the focus-visible leaf ring (filter drop-shadow) is missing');
  if (!/\.leaf \{[^}]*transition:[^}]*transform[^}]*filter[^}]*opacity/.test(css)) v.push('the leaf transition no longer covers transform/filter/opacity');
  if (!/\.scrim \{[^}]*pointer-events:\s*none;/.test(css)) v.push('.scrim lost pointer-events:none (the closing-scrim interception regression)');
  if (!/\.is-lifted \.scrim \{[^}]*pointer-events:\s*auto;/.test(css)) v.push('.is-lifted .scrim lost pointer-events:auto (the scrim must stay interactive while lifted)');
  if (!/\.btn, \.chip, \.card, \.leaftag, \.leaf \{ transition: none; \}/.test(css)) v.push('the reduced-motion transition reset no longer includes .leaf');
  if (!/:is\([^)]*\.bee__face[^)]*\)\s*\{\s*animation-play-state:\s*paused;/.test(css)) v.push('the reduced-motion critter pause list no longer includes .bee__face');
  return v;
}
function wiringViolations(f) {
  const v = [], js = f.js;
  if (!/const lightSoon = kind => \{ lightNext = kind; if \(!lightFrame\) lightFrame = requestAnimationFrame\(/.test(js))
    v.push('lightSoon (one coalesced light per frame) is missing');
  if (!/function light\(kind\) \{\s*if \(lightFrame\) \{ cancelAnimationFrame\(lightFrame\); lightFrame = 0; \}/.test(js))
    v.push('light() no longer cancels a pending coalesced frame');
  const navEnter = (js.match(/a\.addEventListener\('pointerenter'[^\n]*/) || [''])[0];
  const navLeave = (js.match(/a\.addEventListener\('pointerleave'[^\n]*/) || [''])[0];
  if (!/lightSoon\(a\.dataset\.kind\)/.test(navEnter)) v.push('the nav pointerenter no longer uses the coalesced lightSoon');
  if (!/lightSoon\(chosen\)/.test(navLeave)) v.push('the nav pointerleave no longer restores the chosen filter through lightSoon');
  if (!/\n    light\(chosen\);/.test(js)) v.push('the chip click no longer lights synchronously (light(chosen))');
  if (!/const stuckSoon = \(\) => \{ if \(!stuckFrame\) stuckFrame = requestAnimationFrame/.test(js)) v.push('stuckSoon (coalesced header state) is missing');
  if (!/window\.addEventListener\('scroll', stuckSoon, \{ passive: true \}\); stuckSoon\(\);/.test(js)) v.push('the scroll listener no longer uses stuckSoon');
  if (!/document\.querySelectorAll\('\[data-page\], a\.skip'\)/.test(js)) v.push('the modal inert set no longer includes the skip link (a.skip)');
  return v;
}

test('layers: every overlay singleton appears exactly once and the taste clones are bounded and removed', () => {
  assert.deepEqual(layerViolations(FILES), []);
});
test('brightness: the dim/lit/hover/focus values and the paper shadow are exactly the shipped contract', () => {
  assert.deepEqual(brightnessViolations(FILES), []);
});
test('state races: the light and header paths keep their one-frame coalescing; the chip path stays synchronous', () => {
  assert.deepEqual(wiringViolations(FILES), []);
});
test('self-test: each checker detects its injected regression (no inflated ceiling)', () => {
  const M = (s, a, b) => s.split(a).join(b);
  assert.ok(layerViolations({...FILES, html: M(FILES.html, 'id="scrim"', 'id="scrim" id="scrim"')}).some(x => /scrim/.test(x)), 'duplicate layer undetected');
  assert.ok(layerViolations({...FILES, js: M(FILES.js, 'a.fx.remove();', '')}).some(x => /flyer/.test(x)), 'missing flyer cleanup undetected');
  assert.ok(layerViolations({...FILES, tasteTree: M(FILES.tasteTree, 'while(recs.size>MAX)kill(', 'while(false)kill(')}).some(x => /bound/.test(x)), 'clone-bound loss undetected');
  assert.ok(brightnessViolations({...FILES, css: M(FILES.css, 'saturate(.3)', 'saturate(.55)')}).some(x => /dim rule/.test(x)), 'wrong dim brightness undetected');
  assert.ok(brightnessViolations({...FILES, css: M(FILES.css, 'scale(1.14)', 'scale(1)')}).some(x => /hover promotion/.test(x)), 'wrong hover pose undetected');
  assert.ok(brightnessViolations({...FILES, css: M(FILES.css, 'pointer-events: none;', 'pointer-events: auto;')}).some(x => /scrim/.test(x)), 'scrim interception regression undetected');
  assert.ok(wiringViolations({...FILES, js: M(FILES.js, 'lightSoon(', 'light(')}).length > 0, 'uncoalesced nav light undetected');
  assert.ok(wiringViolations({...FILES, js: M(FILES.js, 'cancelAnimationFrame(lightFrame)', 'void 0')}).length > 0, 'missing frame cancel undetected');
  assert.ok(wiringViolations({...FILES, js: M(FILES.js, 'stuckSoon', 'stuckNow')}).length > 0, 'missing scroll coalescing undetected');
});
