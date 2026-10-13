// The night set for the phone build: the SAME dark mode as the taste build, read from its source (source/taste/taste-dark.mjs: mobileNight(),
// the FIREFLY knobs and darkPalette()), never copied. Every night colour on the phone is one of its tokens, a colour its palette sets,
// or one of the author's paper colours put through its night curve (nightHex below evaluates that curve at build time).
import assert from 'node:assert/strict';

export async function loadNight(root, {siteCss} = {}) {
  const m = await import('../taste/taste-dark.mjs');
  assert(typeof m.mobileNight === 'function' && typeof m.darkPalette === 'function' && m.FIREFLY, 'source/taste/taste-dark.mjs must export mobileNight(), darkPalette() and FIREFLY (the shared dark mode)');
  assert(typeof siteCss === 'string' && siteCss.trim(), 'loadNight needs an explicit reviewed original paper CSS input');
  const pal = m.darkPalette(siteCss);
  const pick = (re, what) => { const x = re.exec(pal); assert(x, 'source/taste/taste-dark.mjs darkPalette() no longer sets ' + what + '; update mobile/night.mjs'); return x[1]; };
  return {...await m.mobileNight({siteCss}), source: 'source/taste/taste-dark.mjs',
    halo: m.FIREFLY.halo,                                                                          // halo diameter, x the firefly's body length
    header: pick(/\.top::after \{ background: var\(--grain\), (#[0-9a-f]{6}); \}/, 'the header strip'),
    placeholder: pick(/\.finder input::placeholder \{ color: (#[0-9a-f]{6}); \}/, 'the search placeholder'),
    lcSand: pick(/\.stratum--sand[^{]*\{ background: var\(--grain\), linear-gradient\(90deg, oklch\(from var\(--c\) (.*?) h\)/, 'the sand band curve')};
}

// The night transform evaluated at build time (sRGB -> OKLCH -> new L and C -> sRGB), so the phone CSS needs no
// relative-colour support and gives the same colours the taste build computes in the browser.
const lin = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const gam = v => Math.round(255 * Math.min(1, Math.max(0, v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055)));
export function toOklch(hex) {
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .793617785 * m - .0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
export function fromOklch([L, C, H]) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + .3963377774 * A + .2158037573 * B) ** 3, m = (L - .1055613458 * A - .0638541728 * B) ** 3, s = (L - .0894841775 * A - 1.291485548 * B) ** 3;
  return '#' + [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s]
    .map(gam).map(v => v.toString(16).padStart(2, '0')).join('');
}
// "calc(A + B * pow(l, P)) calc(c * K)" -> numbers (the only shape the taste build uses; anything else fails the build)
function lcFn(expr) {
  const m = /^calc\(([\d.]+) \+ ([\d.]+) \* pow\(l, ([\d.]+)\)\) calc\(c \* ([\d.]+)\)$/.exec(expr.trim());
  assert(m, 'night transform has an unexpected shape: ' + expr);
  const [A, B, P, K] = m.slice(1).map(Number);
  return ([L, C, H]) => [A + B * L ** P, C * K, H];
}
export const nightHex = (n, hex, curve = n.lc) => fromOklch(lcFn(curve)(toOklch(hex)));
// a token the taste build writes as relative colour (oklch(from #hex <curve> h)) becomes its hex here; any other value passes through
const relative = /^oklch\(from (#[0-9a-f]{6}) (calc\(.*\)) h\)$/;
export const resolveToken = (n, v) => { const m = relative.exec(v); return m ? nightHex(n, m[1], m[2]) : v; };

// a chain of drop-shadow()s as the equivalent box-shadow list (rectangular paper): box-shadow blur = 2 x drop-shadow blur (mobile.css --lay-box)
export function boxShadow(drop) {
  const parts = [...drop.matchAll(/drop-shadow\(\s*(\S+)\s+(\S+)\s+([\d.]+)px\s+(rgba?\([^)]*\))\s*\)/g)];
  assert(parts.length && drop.replace(/drop-shadow\([^()]*\([^)]*\)\s*\)/g, '').trim() === '', 'unexpected shadow shape: ' + drop);
  return parts.map(([, x, y, b, c]) => `${x} ${y} ${+(2 * b).toFixed(3)}px ${c}`).join(', ');
}

// The phone page's dark layer. @art(x) names are resolved by the builder like the rest of mobile.css.
// Only the night art is referenced in here, so a dark-mode visitor downloads only the night family.
export function darkCss(n) {
  const T = n.tokens, N = h => nightHex(n, h);
  const tone = ['#3f6b3f', '#56894f', '#72a35f', '#9bb45c', '#b9d482'].map((h, i) => `.t${i + 1}{--a:${N(h)}}`).join('') + `.t6{--a:${nightHex(n, '#ecd24a', n.lcGold)}}`;
  // his strata papers; the sand band sits a step lower on the curve, as in the taste build, so cream words on it pass AA
  const strata = [['clay', '#a9663d', '#925531', '#d49a72', n.lc], ['sand', '#b68f55', '#cba56a', '#edd5a6', n.lcSand], ['bedrock', '#50545b', '#42464c', '#a39a8a', n.lc]]
    .map(([k, c, c2, t, lc]) => `.stratum--${k}{--c:${nightHex(n, c, lc)};--c2:${nightHex(n, c2, lc)};--tear:${N(t)}}`).join('');
  return `
/* ------------------------------------------------------------------ night: the taste build's dark mode (${n.source}) */
@media (prefers-color-scheme: dark) {
  :root { color-scheme: dark; ${['--sky-left', '--sky-right', '--paper', '--paper-2', '--card', '--ink', '--ink-soft', '--gold', '--gold-deep', '--cream', '--focus', '--scrim', '--lay', '--lay-up', '--grain', '--below']
    .filter(k => T[k]).map(k => `${k}: ${resolveToken(n, T[k])};`).join(' ')}
    ${T['--lay'] ? `--lay-box: ${boxShadow(T['--lay'])};` : ''} ${T['--lay-up'] ? `--lay-up-box: ${boxShadow(T['--lay-up'])};` : ''}
    --leaf-bright: ${N('#b9d482')}; --leaf-mid: ${N('#56894f')}; }
  ${tone}
  .cap::before { --a: ${N('#9bb45c')}; } .stratum .cap, .roots .cap, .bark .cap { --cap-tone: ${N('#56894f')}; }
  .stratum .cap::before, .roots .cap::before, .bark .cap::before { --a: ${N('#56894f')}; }
  ${strata}
  .stratum--sand { --on: var(--cream); --on-soft: var(--cream); }
  .stratum--sand .card { color: var(--ink); }
  .roots { --meadow: ${N('#9aac58')}; --meadow-2: ${N('#78a477')}; --topsoil: ${N('#8a6f52')}; --soil: ${N('#664e35')}; --soil-2: ${N('#553d26')}; }
  .bark { background: var(--grain), linear-gradient(100deg, ${N('#7f6143')}, ${N('#6a4e33')} 70%); }
  .season { background: ${N('#b9d482')}; } .season--fall { background: ${N('#e9a86a')}; }
  .top { background: var(--grain), ${n.header}; color: var(--cream); --logo: var(--cream); }
  .menu[open] > .menu__btn { background: color-mix(in srgb, var(--cream) 12%, transparent); }
  .hero, .tier__open > summary:not(.tag) { color: var(--cream); }
  .hero .btn--quiet { color: var(--cream); }
  .finder input::placeholder { color: ${n.placeholder}; }
  .sheet.is-open { background: var(--scrim); }
  .issue__cover img, .sheet__text img { filter: brightness(.9); }
  /* the night sky: his paper stars and a paper moon cut from the night's cream, its craters his critter shade (static, nothing moves) */
  .hero { background: ${n.stars}; background-size: 100% 70%; background-repeat: no-repeat; }
  .hero { position: relative; }
  .hero::after { content: ""; position: absolute; right: 9%; top: calc(var(--top-h) + 1.6rem); width: 2.4rem; aspect-ratio: 1; border-radius: 50%; pointer-events: none; z-index: 0;
    --crater: color-mix(in srgb, ${N('#d6c7a3')} 70%, transparent);
    background: var(--grain), radial-gradient(circle at 34% 30%, var(--crater) 0 7%, transparent 7.6%), radial-gradient(circle at 66% 58%, var(--crater) 0 11%, transparent 11.6%),
      radial-gradient(circle at 40% 76%, var(--crater) 0 5%, transparent 5.6%), var(--cream);
    box-shadow: 0 0 14px 3px color-mix(in srgb, var(--cream) 22%, transparent); filter: var(--lay); }
  .hero__lead, .scene { position: relative; z-index: 1; }
  /* the night art: the same cuts, moonlit */
  .scene { background-image: @art(ridges-night); }
  .scene::before { background-image: @art(clouds-night); }
  .tree { background-image: @art(tree-night); }
  .climb, .trunk { background-image: @art(trunk-night); }
  .roots::before { background-image: @art(ground-night); }
  .tones { background-image: @art(leaves-night); }
  /* night critters in the same layers: owls, a luna moth and one red bat (with their wingbeats); synchronous fireflies; a raccoon and the cottontail */
  .crit--wings { background-image: @art(sky-night); }
  .crit--walk { background-image: @art(walk-night); }
  .crit--bee { display: none; background-image: none; }
  .crit--flies { display: block; width: 140px; height: 90px; background-image: @art(flies-night); background-size: 140px 90px;
    animation: drift 30s ease-in-out -4s infinite alternate, nx-sync ${n.syncSeconds}s ease-in-out infinite; animation-play-state: paused; }
  .is-live .on .crit--flies { animation-play-state: running; }
}
@keyframes nx-sync {
  ${n.syncKeyframes.replace(/opacity: 0;/g, 'opacity: .18;')}
}
@keyframes drift { 0% { transform: translate(150px, 30px); } 30% { transform: translate(110px, 70px); } 60% { transform: translate(190px, 110px); } 100% { transform: translate(60px, 150px); } }
@media (prefers-color-scheme: dark) and (prefers-reduced-motion: reduce) { .crit--flies { animation: none; opacity: .6; transform: translate(150px, 60px); } }
`;
}
