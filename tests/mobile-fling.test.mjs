// A fast fling must land on a painted page (the project direction, 2026-10-12: "it gets to the location quickly, but it's just the brown background").
// What the phone build does about it, checked on the built output (tools/diagnostics/fling-blank-probe.mjs measures it in a browser):
// nothing rasters under the whole page, rectangular paper casts box-shadows (no offscreen filter pass per sheet), art is loaded and decoded
// ahead of a fling, and the first screen's two fonts arrive with the stylesheet. These required checks always
// build their own current owned composition (no historical-artifact override).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {mobileBuild} from './mobile-build-fixture.mjs';
import {boxShadow} from '../source/mobile/night.mjs';

const files = async () => {
  const {out, html} = await mobileBuild();
  const asset = re => readFileSync(join(out, re.exec(html)[1]), 'utf8');
  const nightHtml = readFileSync(join(out, 'night.html'), 'utf8');
  return {out, html, css: asset(/href="(assets\/mobile-(?:light|dark)\.[0-9a-f]+\.css)"/), js: asset(/src="(assets\/mobile\.[0-9a-f]+\.js)"/), dark: readFileSync(join(out, /href="(assets\/mobile-dark\.[0-9a-f]+\.css)"/.exec(nightHtml)[1]), 'utf8')};
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the declarations of the top-level rule whose selector is exactly `sel` (the first one; media blocks are not top-level)
const rule = (css, sel) => { const m = new RegExp(`(?:^|\\})\\s*${esc(sel)}\\s*\\{([^{}]*)\\}`, 'm').exec(css); assert(m, 'no rule for ' + sel); return m[1]; };

test('the body carries no paper grain: it is never seen, and its grain was rastered under every tile of the page', async () => {
  const {css} = await files();
  const body = rule(css, 'body');
  assert(!/--grain|gradient/.test(body), 'body background: ' + /background:[^;]*/.exec(body)?.[0]);
  assert(/background: var\(--below\)/.test(body), 'the body keeps its colour (what shows past the page ends)');
});

test('rectangular paper casts its shadow as box-shadow, the same shadows as --lay / --lay-up, by day and by night', async () => {
  const {css, dark} = await files();
  for (const sel of ['.btn', '.card', '.tier__bar', '.tier__lede', '.slip', '.finder input', '.issue__cover', '.tag--tier', '.net__pin', '.sheet__text figure']) {
    const body = rule(css, sel);
    assert(/box-shadow: var\(--lay(-up)?-box\)/.test(body), sel + ' has no --lay-box shadow');
    assert(!/filter: (?!none)/.test(body), sel + ' still runs a filter: ' + /filter:[^;]*/.exec(body)?.[0]);
  }
  assert(/\.card:active \{[^}]*box-shadow: var\(--lay-up-box\)/.test(css) && !/\.card:active \{[^}]*filter:/.test(css), 'a pressed card lifts with the box-shadow');
  // the values: box-shadow is the drop-shadow chain with twice the blur (Chrome: drop-shadow sigma = its length, box-shadow sigma = half)
  const root = rule(css, ':root'), v = k => new RegExp(`${k}: ([^;]*);`).exec(root)[1].trim();
  assert.equal(v('--lay-box'), boxShadow(v('--lay')));
  assert.equal(v('--lay-up-box'), boxShadow(v('--lay-up')));
  const night = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? rule(dark, ':root'), n = k => new RegExp(`${k}: ([^;]*);`).exec(night)?.[1].trim();
  assert.equal(n('--lay-box'), boxShadow(n('--lay')), 'night --lay-box follows the night --lay');
  assert.equal(n('--lay-up-box'), boxShadow(n('--lay-up')), 'night --lay-up-box follows the night --lay-up');
  assert.equal(boxShadow('drop-shadow(0 0 .5px rgb(30 15 0 / .35)) drop-shadow(1.5px 3px 3px rgb(20 10 0 / .3))'), '0 0 1px rgb(30 15 0 / .35), 1.5px 3px 6px rgb(20 10 0 / .3)');
  assert.throws(() => boxShadow('blur(2px)'));
});

test('art on the first two screens loads eagerly; art further down is lazy and fetched and decoded three screens ahead by script', async () => {
  const {html, js} = await files();
  const imgs = [...html.matchAll(/<img class="([\w_-]+)"[^>]*>/g)].map(m => ({cls: m[1], lazy: / loading="lazy"/.test(m[0])}));
  const tiers = imgs.filter(i => i.cls === 'tier__img');
  assert.equal(tiers.length, 4);
  assert(tiers.every(i => !i.lazy), 'branch art (the first two screens under the tree) must not be lazy');
  for (const cls of ['net__img', 'issue__img']) assert(imgs.find(i => i.cls === cls)?.lazy, cls + ' (far below) stays lazy without script');
  assert(/new IntersectionObserver\([\s\S]*?\.loading = 'eager'[\s\S]*?\.decode\(\)[\s\S]*?rootMargin: '300% 0px'/.test(js), 'app.js fetches and decodes art three screens ahead');
  assert(/\$\('\.net__img'\)[\s\S]*?loading = 'eager'[\s\S]*?saveData[\s\S]*?addEventListener\('load', early/.test(js), 'the roots art is fetched once the page has loaded, unless Save-Data');
});

test('the first screen\'s two Latin faces are preloaded with the stylesheet (text in his fonts sooner; swap keeps it visible meanwhile)', async () => {
  const {html, css, out} = await files();
  const head = html.slice(0, html.indexOf('</head>'));
  const pre = [...head.matchAll(/<link rel="preload" href="(assets\/[\w.-]+\.woff2)" as="font" type="font\/woff2" crossorigin>/g)].map(m => m[1]);
  assert.equal(pre.length, 2, 'exactly the two Latin faces');
  assert(head.indexOf(pre[1]) < head.indexOf('rel="stylesheet"'), 'preloads come before the stylesheet');
  for (const f of pre) { readFileSync(join(out, f)); assert(css.includes('url(' + f.replace('assets/', '') + ')'), f + ' is a face the stylesheet uses'); }
  assert(/3qTpojO2nS2VtkB3KtkQZ1t93kY/.test(pre.join()) && /SZe1Q/.test(pre.join()), 'Young Serif and Instrument Sans, Latin ranges');
  assert.equal([...css.matchAll(/font-display: swap/g)].length, 4, 'every face swaps: text is visible in the fallback at once');
});
