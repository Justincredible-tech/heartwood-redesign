// The phone artwork: a young tulip poplar (Liriodendron tulipifera) cut from paper in the buddy's technique
// (clip-path plies, his grain, per-ply drop shadows, his palette, his critters taken from his own markup).
// Every function here is pure and deterministic: artDocs() returns the HTML documents the baker renders
// (tools/build-mobile.mjs --bake, headless Chrome) and artMeta() the coordinates the page needs
// (tag anchors, leaf slots, the root network). The crown is HAND-PLACED: every clump below is a chosen
// position; only the leaves inside a clump follow a golden-angle spiral, so a clump is evenly filled.
// Night variants are the same documents with the taste build's night transform (mobile/night.mjs) applied
// to every paper colour, deeper shadows, and the night critter set.
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ geometry helpers
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const f1 = n => (Math.round(n * 10) / 10).toString();
const poly = pts => `polygon(${pts.map(p => `${f1(p[0])}px ${f1(p[1])}px`).join(',')})`;
const piece = (pts, extra = '') => `<i style="clip-path:${poly(pts)};${extra}"></i>`;
const sheet = (cls, inner, style = '') => `<div class="cut ${cls}"${style ? ` style="${style}"` : ''}>${Array.isArray(inner) ? inner.join('') : inner}</div>`;
const bez = (a, b, c, d, n = 16) => Array.from({length: n + 1}, (_, i) => { const t = i / n, u = 1 - t;
  return [u*u*u*a[0] + 3*u*u*t*b[0] + 3*u*t*t*c[0] + t*t*t*d[0], u*u*u*a[1] + 3*u*u*t*b[1] + 3*u*t*t*c[1] + t*t*t*d[1]]; });
function strip(path, w0, w1, lateral = 0) {            // a tapered paper strip along a path
  const L = [], R = [], n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const w = (w0 + (w1 - w0) * i / (n - 1)) / 2;
    L.push([path[i][0] - dy * (w + lateral), path[i][1] + dx * (w + lateral)]);
    R.push([path[i][0] + dy * (w - lateral), path[i][1] - dx * (w - lateral)]);
  }
  return [...L, ...R.reverse()];
}
const deg = (dx, dy) => Math.atan2(dx, -dy) * 180 / Math.PI;   // 0 = up, clockwise

// the tulip-tree leaf (Liriodendron tulipifera), bottom to top on the left: a long petiole, the broad truncate base, the lower lobe
// pointing out, a rounded sinus, the upper lobe's pointed "ear", then the squared-off top with its shallow notch on the midrib
const HALF = [[48.8,100],[48.4,80],[47.6,76.5],[44,74.5],[36,72.5],[26,69.5],[16,64],[8,56.5],[3,48.5],[0,40.5],[6,38.6],[14,37.4],[21,35.8],[26,33.5],
  [25.5,30],[21,25],[16,18],[13,10],[12.5,1.5],[19,3.2],[27,4.6],[35,5.6],[42,6.6],[50,9]];
export const TULIP = [...HALF, ...HALF.slice(0, -1).reverse().map(p => [100 - p[0], p[1]])];
export const TULIP_CSS = 'polygon(' + TULIP.map(p => `${p[0]}% ${p[1]}%`).join(',') + ')';

// ------------------------------------------------------------------ the buddy's palette and paper (from his stylesheet)
export const PALETTE = {
  cloud: '#f6f6f4', barkDark: '#6a4e33', barkMid: '#7f6143', barkLight: '#9e7c57', barkBack: '#755839', seam: '#4f3822',
  crown: '#2f5a37', t1: '#3f6b3f', t2: '#56894f', t3: '#72a35f', t4: '#9bb45c', t5: '#b9d482', t6: '#ecd24a',
  hillA: '#9aac58', hillB: '#78a477', mycelium: '#f2ead4', critterLight: '#f5eeda', critterShade: '#d6c7a3',
  subsoil: '#664e35', subsoil2: '#553d26', topsoil: '#8a6f52',
};
const SHADE = {t1: ['rgb(6 22 8/.30)', 'rgb(6 22 8/.46)'], t2: ['rgb(8 26 10/.23)', 'rgb(8 26 10/.40)'], t3: ['rgb(10 30 12/.19)', 'rgb(10 30 12/.36)'],
  t4: ['rgb(24 44 10/.17)', 'rgb(24 44 10/.34)'], t5: ['rgb(30 56 12/.15)', 'rgb(30 56 12/.32)'], t6: ['rgb(120 78 0/.20)', 'rgb(120 78 0/.42)']};
// at night the grain's light flecks fade and its dark ones deepen (the taste build's night grain)
const nightGrain = g => g.replace(/rgb\(255 255 255 \/ \.?([\d.]+)\)/g, (_, a) => `rgb(255 255 255 / ${(+('0.' + a.replace(/^0?\./, '')) * .55).toFixed(3)})`)
  .replace(/rgb\(0 0 0 \/ \.?([\d.]+)\)/g, (_, a) => `rgb(0 0 0 / ${(+('0.' + a.replace(/^0?\./, '')) * 1.3).toFixed(3)})`);

export function bakeCss(grain, n, shapes = '') {   // n = the night set, or null for day; shapes = the night critters' cut shapes (the cottontail walks by day too)
  const P = PALETTE, k = n ? 1.4 : 1;   // shadows deepen at night
  const sh = (x, y, b, rgb, a) => `drop-shadow(${x}px ${y}px ${b}px rgb(${rgb}/${Math.min(.85, a * k).toFixed(2)}))`;
  const cc = n ? `oklch(from var(--c) ${n.lc} h)` : 'var(--c)';
  return `*{box-sizing:border-box}html,body{margin:0;background:transparent}
:root{--grain:${n ? nightGrain(grain) : grain}}
.cv{position:relative;overflow:hidden}
.cut{position:absolute;inset:0}.cut>i,.crit b>i{--cc:${cc}}
.cut>i{position:absolute;inset:0;background:var(--grain),var(--cc)}
${Object.entries(SHADE).map(([t, [s, v]]) => `.${t}{--c:${P[t]};--shade:${s};--vein:${v}}`).join('\n')}
${n ? `.cut>i.t6{--cc:oklch(from var(--c) ${n.lcGold} h)}` : ''}
.cut>i.lf{inset:auto;transform-origin:50% 100%;clip-path:${TULIP_CSS};--vw:max(.4px,1.6%);--sw:max(.3px,.9%);--side:color-mix(in srgb,var(--vein) 78%,transparent);
 --vl:linear-gradient(to top right,transparent calc(50% - var(--sw)),var(--side) 0 calc(50% + var(--sw)),transparent 0);
 --vr:linear-gradient(to top left,transparent calc(50% - var(--sw)),var(--side) 0 calc(50% + var(--sw)),transparent 0);
 background:linear-gradient(90deg,transparent calc(50% - var(--vw)),var(--vein) 0 calc(50% + var(--vw)),transparent 0) 0 100%/100% 91% no-repeat,
 var(--vl) 20.3% 3.5%/36% 28% no-repeat,var(--vr) 79.7% 3.5%/36% 28% no-repeat,var(--vl) 0 47.6%/48% 15% no-repeat,var(--vr) 100% 47.6%/48% 15% no-repeat,
 linear-gradient(90deg,rgb(255 255 255/${n ? '.10' : '.13'}),transparent 44%,transparent 50%,var(--shade) 50%,color-mix(in srgb,var(--shade) 100%,rgb(0 0 0/.34)) 100%),
 var(--grain),var(--cc)}
.cut>i.dk{inset:auto;transform-origin:50% 100%;clip-path:${TULIP_CSS};background:var(--grain),var(--cc)}
.crown--far{--c:${P.crown};filter:${sh(1.2, 2.2, 1.8, '18 34 14', .4)}}
.crown--near{--c:${P.crown};filter:${sh(1.4, 2.6, 2, '4 16 6', .6)}}
.lv-back{filter:${sh(1, 1.8, 1.4, '18 34 14', .45)}}
.lv-mid,.lv-front{filter:${sh(1, 2, 1.4, '18 34 14', .42)}}
.wood{--c:${P.barkBack};filter:drop-shadow(0 0 .5px rgb(30 15 0/.45)) ${sh(1.4, 2.4, 2, '20 8 0', .5)}}
.wood--seam{--c:${P.seam};filter:${sh(1, 1.4, 1.1, '24 11 0', .6)}}
.wood--mid{--c:${P.barkMid};filter:${sh(1.2, 1.4, 1.2, '24 11 0', .7)}}
.wood--light{--c:${P.barkLight};filter:${sh(1.1, 1.6, 1.3, '28 13 0', .6)}}
.crease{filter:blur(.35px)}.crease>i{background:rgb(38 20 6/.6)}
.clouds{--c:${P.cloud};filter:${sh(2, 4, 3, '50 80 120', .34)}}
.hills{filter:drop-shadow(0 -1px 1.5px rgb(20 40 15/${(.22 * k).toFixed(2)}))}
.hills>i,.soil>i{background:var(--grain),linear-gradient(90deg,${n ? `oklch(from var(--c) ${n.lc} h) 12%,oklch(from var(--c2,var(--c)) ${n.lc} h) 88%` : 'var(--c) 12%,var(--c2,var(--c)) 88%'})}
.btree{filter:${sh(.6, 1, .7, '20 40 15', .3)}}
.soil{filter:${sh(0, 3, 3, '20 10 0', .42)}}
.myc{--c:${P.mycelium};filter:${sh(1.2, 2.2, 1.3, '25 12 0', .5)}}
.spore{filter:${sh(1.2, 2, 1.2, '15 8 0', .5)}}
.flower{filter:${sh(1, 1.8, 1.2, '30 20 0', .45)}}
.crit{position:absolute}
.crit b{position:absolute;inset:0}.crit b>i{position:absolute;inset:0;background:var(--grain),var(--cc)}
.crit--bird{filter:${sh(1, 2, 1.2, '50 80 120', .3)}}
.crit .bird__wing{transform-origin:50% 53%;scale:1 var(--s,1)}.crit .bird__wing--far{scale:1 var(--sf,1)}.crit .bird__wing--both{transform-origin:50% 62%}
.crit--bug{filter:${sh(.6, 1.1, .7, '20 10 0', .5)}}
.crit--shroom b{filter:${sh(.8, 1.3, .9, '20 8 0', .5)}}
.left{scale:-1 1}
.bee{position:absolute;filter:${sh(.5, 1, .5, '20 30 10', .4)}}
.bee__body{position:absolute;inset:0;clip-path:polygon(0% 50%,6% 26%,20% 8%,42% 0%,66% 2%,86% 14%,97% 34%,100% 52%,96% 72%,84% 90%,64% 100%,40% 100%,18% 90%,5% 72%);
 background:${n ? n.fireflyBody : 'linear-gradient(90deg,#f1bb2e 0 17%,#2b2016 17% 30%,#f1bb2e 30% 47%,#2b2016 47% 60%,#f1bb2e 60% 75%,#2b2016 75%)'}}
.bee__wing{position:absolute;left:14%;bottom:66%;width:48%;height:100%;background:${n ? 'rgb(236 242 214/.55)' : 'rgb(252 250 240/.92)'};clip-path:ellipse(50% 50%);transform-origin:50% 100%;rotate:-20deg;scale:1 .72}
.bee__wing--b{left:38%;rotate:20deg;background:${n ? 'rgb(226 236 214/.5)' : 'rgb(236 240 232/.9)'}}
.glow{position:absolute;border-radius:50%;background:${n ? n.fireflyGlow : 'none'}}
${shapes}
`;
}
const doc = (css, w, h, inner, n) => `<!doctype html><meta charset=utf-8><style>${css}</style><div class="cv${n ? ' night' : ''}" id="cv" style="width:${w}px;height:${h}px">${inner}</div>`;

// ------------------------------------------------------------------ leaves and clumps
const leafI = (l, cls, k = 1, extra = '') => {      // l: base x,y, size s (height), angle a; k scales about the base (backing sheets)
  const s = l.s * k, w = s * .96;
  return `<i class="${cls}" style="left:${f1(l.x - w / 2)}px;top:${f1(l.y - s)}px;width:${f1(w)}px;height:${f1(s)}px;transform:rotate(${Math.round(l.a)}deg)${extra}"></i>`;
};
// A clump: leaves on long stalks around a point, facing outwards and up. Golden-angle spiral = even cover, no holes.
function clump({x, y, rx, ry, n, size = [16, 24], seed = 1, gold = 0}) {
  const r = rng(seed * 7919 + 17), out = [];
  for (let k = 0; k < n; k++) {
    const q = Math.sqrt((k + .5) / n), th = k * 2.39996 + seed;
    const px = x + Math.cos(th) * rx * q, py = y + Math.sin(th) * ry * q;
    const away = deg(px - x, py - (y + ry * .7));              // pivot below the centre: leaves fan up and out
    const layer = q > .78 ? 0 : q > .5 ? 1 : 2;                 // outer ring = back of the clump, centre = front
    const tones = [['t1', 't2', 't1'], ['t2', 't3', 't3', 't4'], ['t4', 't5', 't4', 't3']][layer];
    let t = tones[Math.floor(r() * tones.length)];
    if (layer === 2 && gold && r() < gold) t = 't6';
    const s = size[0] + (size[1] - size[0]) * (layer === 0 ? .7 + r() * .3 : r());
    out.push({x: px + (r() - .5) * 2, y: py + s * .45, s, a: away * .8 + (r() - .5) * 40, t, layer});
  }
  return out;
}
function crownSheets(leaves, leafScale = 1) { // Keep the backing silhouette; only hero papers use the larger individual leaf size.
  const by = L => leaves.filter(l => l.layer === L);
  return sheet('crown--far', leaves.map(l => leafI(l, 'dk', 1.34)))
    + sheet('crown--near', leaves.map(l => leafI(l, 'dk', 1.1)))
    + sheet('lv-back', by(0).map(l => leafI(l, 'lf ' + l.t, leafScale)))
    + sheet('lv-mid', by(1).map(l => leafI(l, 'lf ' + l.t, leafScale)))
    + sheet('lv-front', by(2).map(l => leafI(l, 'lf ' + l.t, leafScale)));
}
// a tulip-tree flower: a cup of greenish-yellow petals with the orange band at its foot
function flower(x, y, s) {
  const P = (pts, c) => piece(pts.map(p => [x + (p[0] - 50) / 100 * s, y + (p[1] - 100) / 100 * s * 1.05]), '--c:' + c);
  return sheet('flower', [
    P([[4,18],[22,34],[36,10],[50,30],[64,10],[78,34],[96,18],[92,60],[76,92],[50,100],[24,92],[8,60]], '#d7d37a'),
    P([[10,62],[26,92],[50,100],[74,92],[90,62],[70,70],[50,74],[30,70]], '#e8833a'),
    P([[36,10],[50,30],[64,10],[58,48],[42,48]], '#c3c565')]);
}
function bark(path, w0, w1) {          // a limb: back sheet, mid sheet, light sheet, his three browns
  return sheet('wood', piece(strip(path, w0, w1))) + sheet('wood wood--mid', piece(strip(path, w0 * .64, w1 * .64, w0 * .05)))
    + sheet('wood wood--light', piece(strip(path, w0 * .28, w1 * .28, w0 * .19)));
}

// ------------------------------------------------------------------ 1. the whole young tree (arrival), 250 x 560
export const TREE = {w: 250, h: 560};
const TRUNK = [[125, 556], [127, 410], [121, 210], [124, 26]];
const trunkX = y => { const p = bez(...TRUNK, 60); let best = p[0]; for (const q of p) if (Math.abs(q[1] - y) < Math.abs(best[1] - y)) best = q; return best[0]; };
// A woodland tulip poplar: one straight bole and a narrow, alternate-branched crown, as a young tree grows in a stand. The crown is
// narrow where a category tag hangs, so the tags sit in the side margins beside their branches (never on the leaves; verify-mobile
// measures every tag against the crown's baked alpha), and fuller between them, which gives the crown its alternate, uneven edge.
// branches: [y where it leaves the trunk, tip x, tip y]; short and ascending, alternating left and right
const LIMBS = [[78, 108, 48], [92, 146, 52], [122, 168, 96], [150, 98, 118], [196, 64, 166], [186, 158, 152], [250, 192, 222],
  [236, 104, 214], [330, 66, 300], [306, 156, 282], [372, 100, 352], [380, 160, 360]];
// the clumps, placed by hand (x, y, rx, ry, leaves, seed); bigger at the branch tips, filling in around the trunk
const CLUMPS = [
  [124, 34, 14, 22, 10, 1], [112, 66, 16, 16, 8, 2], [140, 66, 16, 16, 8, 3],
  [126, 98, 16, 18, 8, 6], [166, 96, 22, 20, 11, 5],
  [116, 134, 18, 18, 9, 9], [150, 140, 18, 18, 9, 10],
  [72, 166, 22, 19, 11, 13], [104, 180, 18, 20, 9, 14], [140, 178, 18, 20, 9, 11], [160, 156, 12, 14, 6, 12],
  [126, 216, 14, 18, 8, 16], [150, 228, 18, 18, 9, 15], [188, 232, 22, 20, 11, 18],
  [116, 258, 16, 16, 8, 19], [146, 266, 16, 16, 8, 20],
  [70, 316, 22, 20, 11, 22], [106, 314, 18, 18, 9, 24], [140, 300, 16, 18, 8, 21], [160, 320, 12, 12, 6, 23],
  [96, 344, 18, 16, 8, 25], [136, 346, 20, 16, 9, 26], [118, 372, 18, 12, 7, 27],
];
// category tags hang off the end of a bare branch (tree-box units): x = the twig's end, where the tag's punched hole is tied;
// side = which way the tag hangs (outwards). About and Member groups hang on the trunk and at its foot.
export const TAGS = [
  {kind: 'all', x: 170, y: 22, side: 1, limb: 70}, {kind: 'act', x: 77, y: 96, side: -1, limb: 126},
  {kind: 'work', x: 196, y: 168, side: 1, limb: 204}, {kind: 'gather', x: 72, y: 252, side: -1, limb: 280},
  {kind: 'news', x: 212, y: 314, side: 1, limb: 348},
  {kind: 'about', x: 136, y: 458, side: 1}, {kind: 'group', x: 104, y: 548, side: -1},
];
let SHROOM = '';
const crownLeaves = () => CLUMPS.flatMap(([x, y, rx, ry, k, seed]) => clump({x, y, rx, ry, n: k, seed, size: [17, 25], gold: .08}));
const FLOWERS = [[124, 14, 12], [170, 84, 11], [66, 160, 11], [194, 216, 11], [64, 292, 11], [146, 218, 10], [100, 296, 10]];
const HERO_LEAF_SCALE = 1.18; // Fuller visible papers on arrival; retain the backing silhouette and branch-tier art.
const crownDoc = css => doc(css, TREE.w, TREE.h, crownSheets(crownLeaves(), HERO_LEAF_SCALE) + FLOWERS.map(f => flower(...f)).join(''));   // the crown alone: the tag check's mask
function treeDoc(css, n) {
  const leaves = crownLeaves();
  const limbs = LIMBS.map(([y0, tx, ty]) => {
    const x0 = trunkX(y0), dx = tx - x0;
    return bark(bez([x0, y0], [x0 + dx * .25, y0 - 6], [x0 + dx * .7, ty + (y0 - ty) * .45], [tx, ty], 14), Math.max(4, 9 - (420 - y0) / 80), 1.6);
  });
  // the tag branches: from the trunk, up and out past the crown's edge, bare at the end where the tag is tied
  const tagTwigs = TAGS.filter(t => t.limb).map(t => { const x0 = trunkX(t.limb), dx = t.x - x0;
    return bark(bez([x0, t.limb], [x0 + dx * .3, t.limb - 8], [x0 + dx * .75, t.y + 6], [t.x - t.side * 1.5, t.y], 14), Math.max(3.6, 8 - (420 - t.limb) / 80), 1.3); });
  const trunk = bez(...TRUNK, 40);
  const flare = [[101, 560], [108, 552], [114, 540], [116, 520], [134, 520], [136, 540], [142, 552], [150, 560]];
  const hummock = [[60, 560], [74, 548], [96, 543], [125, 541], [154, 543], [176, 548], [190, 560]];
  const shrooms = [[94, 556, 13, 4], [160, 557, 11, -6], [168, 559, 8, 3]];
  return doc(css, TREE.w, TREE.h,
    sheet('wood', piece(strip(trunk, 24, 3)))
    + sheet('wood wood--seam', piece(strip(trunk, 9, 1.4, 4)))
    + sheet('wood wood--mid', piece(strip(trunk, 15, 2, -2)))
    + sheet('wood wood--light', piece(strip(trunk, 6, 1, -5)))
    + sheet('wood', piece(flare)) + sheet('wood wood--mid', piece(flare.map(p => [125 + (p[0] - 125) * .62 - 1, p[1]])))
    + limbs.join('') + tagTwigs.join('')
    + crownSheets(leaves, HERO_LEAF_SCALE)
    + FLOWERS.map(f => flower(...f)).join('')
    + sheet('hills', piece(hummock, `--c:${PALETTE.hillA};--c2:${PALETTE.hillB}`))
    + shrooms.map(([x, y, s, tilt]) => critter(SHROOM, 'crit--shroom', x - s / 2, y - s, s, s, tilt)).join(''), n);
}

// ------------------------------------------------------------------ 2. the hills behind it: a repeating strip of Appalachian ridges (420 x 220)
export const RIDGES = {w: 420, h: 220};
function ridgesDoc(css, n) {
  const W = RIDGES.w, P = PALETTE, per = x => 2 * Math.PI * x / W;          // every edge is periodic in x, so the strip tiles
  const ridge = (base, amp, k, ph, c, c2, bumps = 0) => { const pts = [[0, RIDGES.h]];
    for (let x = 0; x <= W; x += 3) { const b = bumps ? Math.abs(Math.sin(per(x) * bumps + ph)) * 2.2 : 0;
      pts.push([x, base - amp * (Math.sin(per(x) * k + ph) * .6 + Math.sin(per(x) * (k + 1) + ph * 2) * .4) - b]); }
    pts.push([W, RIDGES.h]); return piece(pts, `--c:${c};--c2:${c2}`); };
  const trees = (base, amp, k, ph, cnt, s, c, seed) => { const r = rng(seed), out = [];   // little paper trees along a ridge, as on his hills
    for (let i = 0; i < cnt; i++) { const x = (i + r() * .6) * W / cnt, y = base - amp * (Math.sin(per(x) * k + ph) * .6 + Math.sin(per(x) * (k + 1) + ph * 2) * .4) + 2, h = s * (.75 + r() * .5);
      out.push(piece([[x - h * .28, y], [x - h * .3, y - h * .55], [x - h * .14, y - h * .92], [x, y - h], [x + h * .15, y - h * .9], [x + h * .3, y - h * .5], [x + h * .28, y]], '--c:' + c)); }
    return out; };
  // by day the far ridges fade to the sky (the phone's own aerial blues); by night every ridge is one of his own hill papers
  // (the desktop scene's .hills colours), so the night curve gives exactly the desktop dark mode's moonlit hills
  const C = n ? {r1: ['#c6d283', '#c6d283'], t1: '#748a54', r2: ['#748a54', '#748a54'], t2: P.hillB, r3: [P.hillB, P.hillB], t3: '#748a54', r4: [P.hillA, P.hillA]}
    : {r1: ['#b4c9cf', '#a9c0c9'], t1: '#9cb7b5', r2: ['#8fb09a', '#86a893'], t2: '#6f9a7a', r3: [P.hillB, '#6f9b6c'], t3: '#5d8a5f', r4: [P.hillA, '#a3b462']};
  return doc(css, W, RIDGES.h,
    sheet('hills', ridge(70, 22, 2, .4, ...C.r1, 9), 'filter:drop-shadow(0 -.5px 1px rgb(40 70 80/.18))')
    + sheet('btree', trees(70, 22, 2, .4, 30, 9, C.t1, 3), 'opacity:.9')
    + sheet('hills', ridge(104, 26, 1, 2.1, ...C.r2, 13))
    + sheet('btree', trees(104, 26, 1, 2.1, 24, 12, C.t2, 5))
    + sheet('hills', ridge(140, 18, 3, 1.2, ...C.r3, 7))
    + sheet('btree', trees(140, 18, 3, 1.2, 20, 15, C.t3, 9))
    + sheet('hills', ridge(186, 7, 2, .3, ...C.r4))
    + sheet('flower', Array.from({length: 26}, (_, i) => { const r = rng(40 + i), x = (i + .5) * W / 26 + (r() - .5) * 8, y = 196 + r() * 18, s = 2.2 + r() * 1.4;
      return piece(Array.from({length: 10}, (_, k) => { const t = k / 10 * 2 * Math.PI, q = k % 2 ? s * .45 : s; return [x + Math.cos(t) * q, y + Math.sin(t) * q]; }), '--c:#f6f5ea'); })), n);
}

// ------------------------------------------------------------------ 3. clouds (375 x 150)
export const CLOUDS = {w: 375, h: 150};
const cloud = (cx, cy, R, ph) => { const pts = []; for (let a = 0; a < 360; a += 8) { const t = a * Math.PI / 180, rr = R * (1 + .2 * Math.sin(5 * t + ph) + .1 * Math.sin(9 * t));
  pts.push([cx + rr * Math.cos(t) * 1.9, cy + rr * Math.sin(t) * (Math.sin(t) < 0 ? 1 : .38)]); } return pts; };
const cloudsDoc = (css, n) => doc(css, CLOUDS.w, CLOUDS.h, sheet('clouds', [cloud(58, 46, 22, 0), cloud(318, 30, 17, 2), cloud(300, 112, 13, 4), cloud(40, 126, 11, 1)].map(p => piece(p))), n);

// ------------------------------------------------------------------ 4. trunk tile, close up (375 x 240, periodic in y)
export const TRUNKTILE = {w: 375, h: 240, cx: 187.5, half: 24};
const TW = y => { const p = y / 240 * 2 * Math.PI; return [163.5 + 2.2 * Math.sin(p) + 1.1 * Math.sin(3 * p + 1), 211.5 + 2 * Math.sin(p + 2) + 1 * Math.sin(2 * p)]; };
function trunkTile(ya, yb) {
  const ys = []; for (let y = ya; y <= yb + .1; y += 8) ys.push(y);
  const band = (a, b) => [...ys.map(y => { const [l, r] = TW(y); return [l + (r - l) * a, y]; }), ...ys.map(y => { const [l, r] = TW(y); return [l + (r - l) * b, y]; }).reverse()];
  const crease = k => { const f = [.24, .5, .74][k]; const pts = ys.map(y => { const [l, r] = TW(y); return [l + (r - l) * f + 1.6 * Math.sin(y / 240 * 4 * Math.PI + k * 2), y]; });
    return [...pts.map(p => [p[0] - 1, p[1]]), ...pts.map(p => [p[0] + 1.1, p[1]]).reverse()]; };
  return sheet('wood', piece(band(0, 1))) + sheet('wood wood--seam', piece(band(.62, .9))) + sheet('wood wood--mid', piece(band(.04, .66)))
    + sheet('wood wood--light', piece(band(.08, .3))) + sheet('crease', [0, 1, 2].map(k => piece(crease(k))));
}

// ------------------------------------------------------------------ 5. one branch per tier, close up (375 x 300). Two cuts, left and right.
export const TIER = {w: 375, h: 300};
function tierGeometry(side, seed) {     // a branch reaching to `side` (-1 left, +1 right); mirrored, re-seeded
  const X = x => side < 0 ? x : TIER.w - x;
  // a real limb: it leaves the trunk, rises, and carries its leaves in clusters at the twig ends, with wood showing between
  const path = bez([X(176), 254], [X(130), 238], [X(72), 172], [X(22), 98], 22);
  const at = f => path[Math.round(f * (path.length - 1))];
  const twigs = [[.22, 1, 46], [.5, -1, 28], [.76, 1, 40]].map(([f, up, len]) => { const p = at(f), q = at(Math.min(1, f + .05));
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]) + up * side * -1.05; return {p, e: [p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len]}; });
  const C = [[X(34), 96, 34, 28, 16], ...twigs.map((t, i) => [t.e[0], t.e[1] - 6, i === 1 ? 17 : 22, i === 1 ? 14 : 18, i === 1 ? 6 : 9]), [X(110), 226, 18, 13, 5]];
  const leaves = C.flatMap(([x, y, rx, ry, k], i) => clump({x, y, rx, ry, n: k, seed: seed + i * 3, size: [22, 34], gold: .05}));
  // the shoot on the trunk's other side, so the trunk is never bare between branches
  const shootPath = bez([X(206), 128], [X(226), 112], [X(246), 92], [X(262), 74], 8);
  const shoot = clump({x: X(268), y: 76, rx: 22, ry: 18, n: 8, seed: seed + 50, size: [22, 32]});
  // live leaf slots: five front positions spread along the branch (the page puts a real button on each)
  // four disjoint 48 px targets on the tip clump and three twig ends, whole on a 375 px screen
  const slots = [[X(40), 100], [X(92), 118], [twigs[1].e[0], twigs[1].e[1] + 6], [twigs[0].e[0], twigs[0].e[1] + 4]].map(([x, y], i) => ({x: +f1(Math.min(TIER.w - 40, Math.max(40, x))), y: +f1(y), a: Math.round(side * (-24 + i * 12))}));
  return {path, twigs, leaves: [...leaves, ...shoot], shootPath, slots, flowers: [[X(30), 74, 20], [twigs[2].e[0], twigs[2].e[1] - 22, 16]]};
}
function tierDoc(css, side, seed, n) {
  const g = tierGeometry(side, seed);
  return doc(css, TIER.w, TIER.h, bark(g.path, 22, 5) + g.twigs.map(t => bark(bez(t.p, t.p, t.e, t.e, 6), 6.5, 2.4)).join('')
    + bark(g.shootPath, 8, 3) + crownSheets(g.leaves) + g.flowers.map(f => flower(...f)).join(''), n);
}

// ------------------------------------------------------------------ 6. live leaf sheet: one leaf per tone, at rest (row 1) and lifted (row 2), cells of 56 px
export const LEAFCELL = 56;
function leafSheetDoc(css, n) {
  const k = n ? 1.4 : 1;
  const cell = (t, i, up) => { const l = {x: i * LEAFCELL + LEAFCELL / 2, y: (up ? LEAFCELL : 0) + LEAFCELL - 8, s: 40, a: 0};
    const shadow = up ? `drop-shadow(0 0 .5px rgb(30 15 0/.35)) drop-shadow(2.6px 5.5px 4.5px rgb(18 34 14/${(.42 * k).toFixed(2)}))` : `drop-shadow(1px 2px 1.4px rgb(18 34 14/${(.45 * k).toFixed(2)}))`;
    return `<div class="cut" style="filter:${shadow}">${leafI(l, 'lf ' + t)}${up ? leafI(l, 'dk', 1, ';background:rgb(255 252 230/.17)') : ''}</div>`; };
  return doc(css, LEAFCELL * 6, LEAFCELL * 2, ['t1', 't2', 't3', 't4', 't5', 't6'].map((t, i) => cell(t, i, 0) + cell(t, i, 1)).join(''), n);
}

// ------------------------------------------------------------------ 7. the ground where the trunk goes in (375 x 120), then roots and the member network (375 x 780)
export const GROUND = {w: 375, h: 120};
export const ROOTS = {w: 375, h: 780, hub: [187.5, -8]};
const tear = (W, H, y, amp, seed) => { const q = rng(seed), pts = [[0, H], [0, y]]; for (let x = 0; x <= W; x += 12) pts.push([x, y + (q() - .5) * amp + Math.sin(x / 50 + seed) * amp * .5]); pts.push([W, y], [W, H]); return pts; };
function groundDoc(css, n) {
  const P = PALETTE, W = GROUND.w, H = GROUND.h, hub = 187.5;
  const day = s => n ? '' : s;     // the phone's own second strip colours are day-only; at night each strip is his one paper, through the night curve
  const meadow = (y, amp, seed) => { const q = rng(seed), pts = [[0, H]]; for (let x = 0; x <= W; x += 6) pts.push([x, y + Math.sin(x / 41 + seed) * amp - (q() < .3 ? q() * 4 : 0)]); pts.push([W, H]); return pts; };
  // in cross-section, as in his artwork: the soil behind, the root flare and its first roots on it, the trunk, then the grass in front where it goes in
  const flare = [[164, 38], [211, 38], [215, 56], [226, 68], [246, 79], [231, 86], [214, 84], [204, 94], [187.5, 98], [171, 94], [161, 84], [144, 86], [129, 79], [149, 68], [160, 56]];
  const roots = [[144, 84, 118, 122], [174, 94, 166, 122], [201, 94, 210, 122], [231, 84, 258, 122]].map(([x0, y0, x1, y1]) => bez([x0, y0], [x0 + (x1 - x0) * .2, y0 + 10], [x1, y1 - 12], [x1, y1 + 2], 6));
  const grass = (y, seed) => { const q = rng(seed), pts = [[0, y + 14]]; for (let x = 0; x <= W; x += 5) pts.push([x, y - (x % 10 ? q() * 3 : 4 + q() * 5)]); pts.push([W, y + 14]); return pts; };
  return doc(css, W, H,
    sheet('hills', piece(meadow(30, 3, 3), `--c:${P.hillB}${day(';--c2:#6f9b6c')}`))
    + sheet('soil', piece(tear(W, H, 50, 6, 2), `--c:${P.topsoil}${day(';--c2:#7d6249')}`)) + sheet('soil', piece(tear(W, H, 66, 8, 5), `--c:${P.subsoil};--c2:${P.subsoil2}`))
    + roots.map(r => bark(r, 11, 8)).join('')
    + trunkTile(0, 48)
    + sheet('wood', piece(flare)) + sheet('wood wood--mid', piece(flare.map(p => [hub + (p[0] - hub) * .7, 38 + (p[1] - 38) * .92])))
    + sheet('wood wood--light', piece(flare.map(p => [hub - 7 + (p[0] - hub) * .3, 38 + (p[1] - 38) * .8])))
    + sheet('hills', piece(grass(44, 8), `--c:${P.hillA}${day(';--c2:#a3b462')}`))
    + [[124, 46, 15, -4], [262, 47, 12, 5], [276, 50, 9, -3], [96, 50, 9, 6]].map(([x, y, s, t]) => critter(SHROOM, 'crit--shroom', x - s / 2, y - s, s, s, t)).join(''), n);
}
export function network(nSpores) {     // pure: spore sites, tree, and each node's curve from its parent
  const r = rng(23), H = ROOTS.h, hub = ROOTS.hub, sites = []; let md = 46;
  while (sites.length < nSpores) { for (let t = 0; t < 8000 && sites.length < nSpores; t++) { const p = [22 + r() * 331, 92 + r() * (H - 124)];
    if (sites.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) >= md)) sites.push(p); } md -= 1.5; }
  sites.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const anchors = [[150, 20], [226, 22], [187.5, 40], [82, 92], [300, 98], [176, 130], [44, 220], [330, 232], [136, 262], [240, 290], [90, 400], [292, 410],
    [186, 452], [50, 540], [326, 552], [140, 580], [240, 620], [70, 690], [300, 700]];
  const nodes = [{p: hub, par: -1, spore: -1}, ...anchors.map(p => ({p, par: -1, spore: -1})), ...sites.map((p, i) => ({p, par: -1, spore: i}))];
  const inT = new Set([0]);
  while (inT.size < nodes.length) { let best = null;      // Prim from the hub; climbing costs extra, spores are leaves only
    for (const i of inT) for (let j = 0; j < nodes.length; j++) { if (inT.has(j) || nodes[i].spore >= 0) continue;
      const dx = nodes[j].p[0] - nodes[i].p[0], dy = nodes[j].p[1] - nodes[i].p[1], w = Math.hypot(dx, dy) + (dy < 0 ? -dy * .9 : 0);
      if (!best || w < best.w) best = {w, i, j}; }
    nodes[best.j].par = best.i; inT.add(best.j); }
  const size = nodes.map(() => 1), depth = i => { let c = 0; while (nodes[i].par >= 0) { i = nodes[i].par; c++; } return c; };
  [...nodes.keys()].sort((a, b) => depth(b) - depth(a)).forEach(i => { if (nodes[i].par >= 0) size[nodes[i].par] += size[i]; });
  const rr = rng(99);
  nodes.forEach((nd, i) => { if (nd.par < 0) return; const a = nodes[nd.par].p, b = nd.p, dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, off = (rr() - .5) * d * .26;
    nd.path = bez(a, [a[0] + dx * .3 - dy / d * off, a[1] + dy * .3 + dx / d * off], [a[0] + dx * .7 - dy / d * off, a[1] + dy * .7 + dx / d * off], b, 8).map(p => [+f1(p[0]), +f1(p[1])]);
    nd.w = 1.5 + 13 * Math.pow(size[i] / nodes.length, .6); nd.size = size[i]; });
  return {nodes};
}
function rootsDoc(css, nSpores, n) {
  const {nodes} = network(nSpores), P = PALETTE;
  const thick = [], mid = [], light = [], thin = [];
  nodes.forEach(nd => { if (nd.par < 0) return; const w0 = nodes[nd.par].par >= 0 ? Math.min(nodes[nd.par].w * .92, nd.w * 1.35) : nd.w * 1.25;
    if (nd.size >= 4) { thick.push(piece(strip(nd.path, w0, nd.w))); mid.push(piece(strip(nd.path, w0 * .62, nd.w * .62, nd.w * .06))); light.push(piece(strip(nd.path, w0 * .26, nd.w * .26, nd.w * .2))); }
    else thin.push(piece(strip(nd.path, Math.max(2.2, w0 * .7), Math.max(1.3, nd.w * .6)))); });
  const sp = (x, y) => Array.from({length: 12}, (_, k) => { const t = k / 12 * 2 * Math.PI; return [x + 8 * Math.cos(t), y + 7.6 * Math.sin(t)]; });
  const spores = nodes.filter(nd => nd.spore >= 0);
  return doc(css, ROOTS.w, ROOTS.h,
    sheet('myc', thin) + sheet('wood', thick) + sheet('wood wood--mid', mid) + sheet('wood wood--light', light)
    + sheet('spore', spores.map(s => piece(sp(s.p[0] + 1.2, s.p[1] + 1.6), `--c:${P.critterShade}`)))
    + sheet('spore', spores.map(s => piece(sp(...s.p), `--c:${P.critterLight}`))), n);
}

// ------------------------------------------------------------------ 8. his critters, cut out of his own markup (and the taste build's night ones)
function hisPart(body, startRe) {     // the first element matching startRe, with everything inside it
  const m = startRe.exec(body); assert(m, 'critter not found: ' + startRe);
  const tag = /^<(\w+)/.exec(m[0])[1]; let depth = 0; const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g'); re.lastIndex = m.index;
  for (let t; (t = re.exec(body));) { depth += t[1] ? -1 : 1; if (!depth) return body.slice(m.index, re.lastIndex); }
  throw Error('unterminated ' + tag);
}
const inner = html => html.replace(/^<[^>]+>/, '').replace(/<\/\w+>$/, '');
function critter(plies, cls, x, y, w, h, tilt = 0, left = false, extra = '') {
  return `<div class="crit ${cls}${left ? ' left' : ''}" style="left:${f1(x)}px;top:${f1(y)}px;width:${f1(w)}px;height:${f1(h)}px${tilt ? `;rotate:${tilt}deg` : ''}${extra}">${plies}</div>`;
}
export function critters(src) {
  const body = src.slice(src.indexOf('<body'));
  const face = re => inner(hisPart(body, re));
  SHROOM = inner(hisPart(body, /<div class="shroom"[^>]*>/));
  return {
    cardinal: face(/<span class="bird__face">(?=[\s\S]{0,40}#b4483b)/), jay: face(/<span class="bird__face bird__face--left">(?=[\s\S]{0,40}#5f85b3)/),
    goldfinch: face(/<span class="bird__face">(?=[\s\S]{0,40}#dfc044)/),
    ant: face(/<span class="bug__face" style="[^"]*aspect-ratio:31\.2 \/ 18\.2">/), beetle: face(/<span class="bug__face" style="[^"]*aspect-ratio:39\.0 \/ 20\.8">/),
    pillbug: face(/<span class="bug__face bug__face--left" style="[^"]*aspect-ratio:26\.0 \/ 15\.0">/),
  };
}
// the ambient layers' artwork: sky (birds / owls, moth, bat) and their wingbeats, canopy (a bee / a swarm of synchronous fireflies),
// ground (bugs and the cottontail / raccoon and cottontail)
export const SKY = {w: 170, h: 40}, WALK = {w: 280, h: 30}, BEE = {w: 22, h: 18}, FLIES = {w: 140, h: 90};
// Wingbeats: the flock is baked as a film strip of FLAP.frames frames (stacked down the sheet) over FLAP.loop seconds; the page steps
// through it with one transform. Each frame poses every wing with his own flap (the site's .bird__wing: scale 1 -> 1 -.72, ease-in-out,
// alternate, the far wing a quarter flap ahead), at the bird's own --flap from his markup, rounded to a whole number of beats per loop,
// and each bird starts at its own phase, so the flock never beats in unison.
export const FLAP = {frames: 12, loop: 1.04};
const bezierY = (x1, y1, x2, y2) => x => { let lo = 0, hi = 1, t = x;     // CSS cubic-bezier: solve x(t) = x by bisection, return y(t)
  for (let i = 0; i < 30; i++) { t = (lo + hi) / 2; const u = 1 - t, xt = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t; if (xt < x) lo = t; else hi = t; }
  const u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t; };
const easeInOut = bezierY(.42, 0, .58, 1);
export const loopFlap = f => FLAP.loop / 2 / Math.max(1, Math.round(FLAP.loop / 2 / f));   // the nearest flap with whole beats per loop
export const wingScale = (t, f) => { let u = ((t % (2 * f)) + 2 * f) % (2 * f) / f; if (u > 1) u = 2 - u; return 1 - 1.72 * easeInOut(u); };
function flock(css, birds, n) {   // birds: [plies, x, y, w, h, flap (s), phase (s)]
  const frame = k => { const t = k * FLAP.loop / FLAP.frames;
    return `<div style="position:absolute;left:0;top:${k * SKY.h}px;width:${SKY.w}px;height:${SKY.h}px;overflow:hidden">` + birds.map(([plies, x, y, w, h, flap, phase]) => {
      const f = loopFlap(flap); return critter(plies, 'crit--bird', x, y, w, h, 0, false, `;--s:${wingScale(t + phase, f).toFixed(3)};--sf:${wingScale(t + phase + f / 4, f).toFixed(3)}`); }).join('') + '</div>'; };
  return doc(css, SKY.w, SKY.h * FLAP.frames, Array.from({length: FLAP.frames}, (_, k) => frame(k)).join(''), n);
}
// the flaps are his (--flap on each .bird in the markup: cardinal .26 s, goldfinches .17 / .16 s, jay .3 s); at night each critter keeps
// the flap of the day bird whose path it flies in the taste build (moths beat at twice, the bat at 1.8 times it, as there)
export const FLOCK = {
  day: [['cardinal', 2, 11, 40, 25.6, .26, 0], ['goldfinch', 52, 3, 22, 14, .17, .07], ['goldfinch', 80, 15, 19, 12.2, .16, .2], ['jay', 112, 5, 46, 29.4, .3, .37]],
  night: [['barred', 2, 4, 50, 32, .26, 0], ['moth', 58, 2, 24, 12, .33 * 2, .3], ['screech', 86, 10, 38, 24.3, .17, .11], ['bat', 132, 3, 20, 12.8, .16 * 1.8, .19]],
};
function skyDoc(css, c, n) {
  return n ? flock(css, FLOCK.night.map(([k, ...r]) => [inner(n.templates[k]), ...r]), n) : flock(css, FLOCK.day.map(([k, ...r]) => [c[k], ...r]));
}
function walkDoc(css, c, n, T) {   // walking east in a line; the cottontail comes along by day too (taste build)
  const rabbit = critter(inner(T.rabbit), 'crit--bug', 232, 1, 44, 27.3);
  if (!n) return doc(css, WALK.w, WALK.h, critter(c.beetle, 'crit--bug', 2, 12, 32, 17) + critter(c.pillbug.replace(/bug__face--left/g, ''), 'crit--bug', 46, 15, 24, 13.8)
    + critter(c.ant, 'crit--bug', 82, 13, 30, 17.5) + rabbit);
  return doc(css, WALK.w, WALK.h, critter(inner(T.raccoon), 'crit--bug', 70, 0, 50, 30) + rabbit, n);
}
const beeDoc = css => doc(css, BEE.w, BEE.h, `<div class="bee" style="left:3px;top:7px;width:15px;height:9px"><i class="bee__wing"></i><i class="bee__wing bee__wing--b"></i><i class="bee__body"></i></div>`);
function fliesDoc(css, n) {     // five fireflies (the bee's paper, recut, his night colours), each with the taste build's halo baked round its lantern; they flash together
  const pos = [[18, 26], [52, 58], [74, 18], [104, 46], [124, 74]], L = 10, d = n.halo * L;   // halo: n.halo x the body length, centred on the lantern (the body's first 22%)
  return doc(css, FLIES.w, FLIES.h, pos.map(([x, y], i) => { const lx = x + (i % 2 ? 1 : -1) * (L / 2 - L * .11);
    return `<i class="glow" style="left:${f1(lx - d / 2)}px;top:${f1(y - d / 2)}px;width:${f1(d)}px;height:${f1(d)}px"></i>`
      + `<div class="bee${i % 2 ? ' left' : ''}" style="left:${x - L / 2}px;top:${y - 3}px;width:${L}px;height:6px"><i class="bee__wing"></i><i class="bee__wing bee__wing--b"></i><i class="bee__body"></i></div>`; }).join(''), n);
}

// ------------------------------------------------------------------ what the baker renders and what the page reads
export function artDocs(src, nSpores, nightSet) {
  const cssSource = typeof src === 'string' ? src : src?.css;
  const markup = typeof src === 'string' ? src : src?.markup;
  assert(typeof cssSource === 'string' && typeof markup === 'string', 'artDocs needs explicit markup and original paper CSS');
  const grainMatch = cssSource.match(/--grain:([\s\S]*?);\n\n/);
  assert(grainMatch, 'Original paper reference has no supported --grain recipe');
  const grain = grainMatch[1];
  const c = critters(markup);
  const out = [];
  assert(nightSet && nightSet.templates, 'artDocs needs the night set (mobile/night.mjs loadNight)');
  for (const n of [null, nightSet]) {
    const css = bakeCss(grain, n, nightSet.critterCss), sfx = n ? '-night' : '';
    out.push(
      {name: 'tree' + sfx, ...TREE, html: treeDoc(css, n)},
      {name: 'ridges' + sfx, ...RIDGES, html: ridgesDoc(css, n)},
      {name: 'clouds' + sfx, ...CLOUDS, html: cloudsDoc(css, n)},
      {name: 'trunk' + sfx, ...TRUNKTILE, html: doc(css, TRUNKTILE.w, TRUNKTILE.h, trunkTile(0, 240), n)},
      {name: 'tier-l' + sfx, ...TIER, html: tierDoc(css, -1, 101, n)},
      {name: 'tier-r' + sfx, ...TIER, html: tierDoc(css, 1, 211, n)},
      {name: 'leaves' + sfx, w: LEAFCELL * 6, h: LEAFCELL * 2, html: leafSheetDoc(css, n)},
      {name: 'ground' + sfx, ...GROUND, html: groundDoc(css, n)},
      {name: 'roots' + sfx, ...ROOTS, html: rootsDoc(css, nSpores, n)},
      {name: 'sky' + sfx, w: SKY.w, h: SKY.h * FLAP.frames, html: skyDoc(css, c, n)},
      {name: 'walk' + sfx, ...WALK, html: walkDoc(css, c, n, nightSet.templates)},
      n ? {name: 'flies-night', ...FLIES, html: fliesDoc(css, n)} : {name: 'bee', ...BEE, html: beeDoc(css)},
    );
    if (!n) out.push({name: 'tree-crown', ...TREE, html: crownDoc(css), mask: true});   // baked, never shipped: the crown's alpha for the tag check
  }
  return out;
}
export function artMeta(nSpores) {
  const {nodes} = network(nSpores);
  const roots = {...ROOTS, nodes: nodes.map(n => [+f1(n.p[0]), +f1(n.p[1]), n.par]), curves: nodes.map(n => n.path ? n.path.flat() : null),
    spores: nodes.map((n, i) => [n.spore, i]).filter(([s]) => s >= 0).sort((a, b) => a[0] - b[0]).map(([, i]) => i)};
  return {tree: TREE, tags: TAGS, tier: TIER, slots: {l: tierGeometry(-1, 101).slots, r: tierGeometry(1, 211).slots}, roots,
    leafCell: LEAFCELL, tulip: TULIP_CSS, flock: {...SKY, ...FLAP}};
}
