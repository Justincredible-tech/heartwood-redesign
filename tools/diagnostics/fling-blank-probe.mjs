// Fling probe: a fast touch fling top -> bottom -> top right after load, then how much of the viewport was NOT yet showing its
// content in each compositor frame (screencast), how long text and art take to arrive after each landing, the rAF frame
// cadence, and raster/decode/paint cost from a trace. Phone conventions: touch, isMobile, CPU throttling (main thread only).
//   node tools/diagnostics/fling-blank-probe.mjs [--route optimized-mobile-next] [--site DIR] [--width 375 --height 812 --dpr 3]
//        [--cpu 4] [--speed 12000] [--wait 500] [--css '<rules>'] [--label NAME] [--out DIR] [--no-ref]
//        [--net slow4g]    Lighthouse's mobile slow 4G (150 ms RTT, 1.6 Mbps): lazy art meets real latency
//        [--slow-raster]   software raster on ONE raster thread: a stand-in for a phone GPU that cannot keep up (the emulator symptom)
// Overscroll stretch/bounce is switched off on the page under test (html style overscroll-behavior: none, CSSOM, CSP-safe): at the
// ends of the page it moves content without moving the scroll offset, which would read as missing content.
// Pass A (traced, no screencast): rAF cadence + raster cost. Pass B (fresh context, cold cache; screencast, untraced):
// per-frame "incomplete" area = 8 px blocks that differ from a settled reference of the page at that scroll offset (stitched
// viewport screenshots after everything is loaded), "checker" area = flat blocks of the root background colour (what Chrome draws
// where a tile is not rastered yet: the project’s brown screen). Text area = blocks under live text runs (Range rects).
// Not a gate. flingProbe() is exported for the Android harness (output/playwright/android/android-check.mjs, part "fling").
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {flingFrameEvidence,settleReferenceFrame} from '../fling-evidence.mjs';
import {loadSharp} from '../sharp-deps.mjs';

const root = resolve(import.meta.dirname, '../..');
const sharp = (...args) => loadSharp()(...args);   // lazy: --help must not demand the optional dependency
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, q) => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : null;
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const B = 8, DIFF = 18, FLAT = 2.5, NEAR = 12;   // block px, incomplete if mean |diff| > DIFF; checker if luma sd < FLAT and within NEAR of the root colour

// rAF cadence, and for every <img>: was it loaded and decoded the first time it entered the viewport during the fling?
const FRAMES = `(()=>{const P=window.__fp={t:[],sy:[],run:false,art:{}};P.begin=()=>{P.t=[];P.sy=[];P.art={};P.run=true;P.start=performance.now();const f=t=>{if(!P.run)return;P.t.push(t);P.sy.push(scrollY);requestAnimationFrame(f);};requestAnimationFrame(f);
P.io=new IntersectionObserver(es=>es.forEach(e=>{const i=e.target,k=i.className+'@'+Math.round(i.getBoundingClientRect().top+scrollY);if(!e.isIntersecting||P.art[k])return;P.art[k]={ready:i.complete&&i.naturalWidth>0,at:Math.round(performance.now()-P.start)};}));
document.querySelectorAll('img').forEach(i=>{if(i.getBoundingClientRect().bottom<0||i.getBoundingClientRect().top>innerHeight)P.io.observe(i);});};
P.end=()=>{P.run=false;P.io.disconnect();return {startMs:P.start,endMs:performance.now(),frames:P.t,sy:P.sy,art:P.art};};})()`;

// one fling: down to the bottom, land, back up to the top, land. Waits on the page's own scrollY (never the screen).
async function fling(page, cdp, {speed, x, y0, y1}) {
  const marks = {};
  const H = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const settle = async target => { let last = -1, same = 0; const t = Date.now();
    while (Date.now() - t < 8000) { const s = await page.evaluate(() => scrollY); if (Math.abs(s - last) < 1) { if (++same >= 4) break; } else same = 0; last = s; await sleep(60); }
    return {at: last, target, ms: Date.now() - t}; };
  marks.downStart = Date.now();
  await cdp.send('Input.synthesizeScrollGesture', {x, y: y0, yDistance: -(H + 2000), speed, gestureSourceType: 'touch', preventFling: false});
  marks.down = await settle(H); await sleep(1500);
  marks.upStart = Date.now();
  await cdp.send('Input.synthesizeScrollGesture', {x, y: y1, yDistance: H + 2000, speed, gestureSourceType: 'touch', preventFling: false});
  marks.up = await settle(0); await sleep(1500);
  return {H, marks};
}

function traceCost(events) {
  const names = {}, threads = {}, busy = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  const sum = {rasterTaskMs: 0, decodeMs: 0, paintMs: 0, rasterTasks: 0, decodes: 0};
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const th = threads[e.pid + ':' + e.tid] || '', ms = e.dur / 1000;
    if (e.name === 'RasterTask') { sum.rasterTaskMs += ms; sum.rasterTasks++; }
    else if (e.name === 'ImageDecodeTask' || e.name === 'Decode Image') { sum.decodeMs += ms; sum.decodes++; }
    else if (e.name === 'Paint' && /CrRendererMain/.test(th)) sum.paintMs += ms;
    if (/CompositorTileWorker|CrGpuMain|VizCompositor|Compositor$/.test(th)) (busy[th.replace(/\d+$/, '')] ||= []).push([e.ts, e.ts + e.dur]);
    names[e.name] = (names[e.name] || 0) + ms;
  }
  const union = iv => { iv.sort((a, b) => a[0] - b[0]); let t = 0, s = -1, en = -1; for (const [a, b] of iv) { if (a > en) { if (en > s) t += en - s; s = a; en = b; } else en = Math.max(en, b); } if (en > s) t += en - s; return t / 1000; };
  return {...Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, r1(v)])), threadBusyMs: Object.fromEntries(Object.entries(busy).map(([k, v]) => [k, r1(union(v))]))};
}

// the page in document coordinates: live text runs, sticky/fixed header height, root background colour
const LAYOUT = () => {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), rg = document.createRange();
  for (let n; (n = w.nextNode());) {
    if (!n.data.trim() || !n.parentElement || !n.parentElement.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
    rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) out.push([r.left, r.top + scrollY, r.width, r.height]);
  }
  let head = 0;
  for (const el of document.querySelectorAll('body *')) { const p = getComputedStyle(el).position; if (p !== 'sticky' && p !== 'fixed') continue; const r = el.getBoundingClientRect(); if (r.top <= 1 && r.bottom > 0 && r.height < innerHeight / 3 && r.width > innerWidth / 2) head = Math.max(head, r.bottom); }
  const c = s => s && s !== 'rgba(0, 0, 0, 0)' && s !== 'transparent' ? s : null;
  const bg = c(getComputedStyle(document.documentElement).backgroundColor) || c(getComputedStyle(document.body).backgroundColor) || 'rgb(255, 255, 255)';
  return {text: out, head: Math.ceil(head), bg: bg.match(/[\d.]+/g).slice(0, 3).map(Number), vw: innerWidth, vh: innerHeight, H: document.documentElement.scrollHeight};
};

async function raw(buf, w) { const img = sharp(buf).removeAlpha(); const m = await img.metadata(); const h = Math.round(m.height * w / m.width);
  const {data} = await img.resize(w, h, {fit: 'fill'}).raw().toBuffer({resolveWithObject: true}); return {data, w, h}; }

// a settled reference of the whole page: viewport screenshots stitched below the header, each only accepted once two in a row agree
async function reference(page, L, log) {
  await page.evaluate(async () => { for (const i of document.querySelectorAll('img')) { i.loading = 'eager'; } await Promise.all([...document.querySelectorAll('img')].map(i => i.decode().catch(() => {}))); await document.fonts.ready; });
  const W = L.vw, H = L.H, strip = Buffer.alloc(W * H * 3), step = L.vh - L.head - 16,proof=[];
  for (let y = 0; ; y += step) {
    const at = await page.evaluate(y => { scrollTo({top: y, behavior: 'instant'}); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY)))); }, y);
    // accepted once two shots in a row agree AND no unrastered (flat root-colour) area is left: a slow GPU (the Android emulator) can show
    // the same brown checkerboard twice in a row
    let settled;try{settled=await settleReferenceFrame({readFrame:async()=>raw(await page.screenshot({scale:'css'}),W),meanDifference:(a,b)=>meanDiff(a.data,b.data),flatShare:img=>flatShare(img,L),wait:sleep});}catch(error){error.message+=' at scrollY '+at;log('reference failed '+JSON.stringify({scrollY:at,message:error.message,lastMeasurements:error.proof?.observations?.slice(-3)}));throw error;}
    const img=settled.frame;proof.push({scrollY:at,...settled.proof});
    for (let r = L.head; r < img.h && at + r < H; r++) img.data.copy(strip, (at + r) * W * 3, r * W * 3, (r + 1) * W * 3);
    if (at + img.h >= H || y > H) break;
  }
  return {W, H, data: strip,proof};
}
// share of 8 px blocks that are flat root background colour (an unrastered tile)
function flatShare({data, w, h}, L) { let n = 0, f = 0; for (let by = L.head; by + B <= h; by += B) for (let bx = 0; bx + B <= w; bx += B) { let s = 0, s2 = 0, m = [0, 0, 0];
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const o = ((by + y) * w + bx + x) * 3, l = .299 * data[o] + .587 * data[o + 1] + .114 * data[o + 2]; s += l; s2 += l * l; m[0] += data[o]; m[1] += data[o + 1]; m[2] += data[o + 2]; }
  n++; if (Math.sqrt(Math.max(0, s2 / 64 - (s / 64) ** 2)) < FLAT && m.every((v, i) => Math.abs(v / 64 - L.bg[i]) < NEAR)) f++; } return n ? f / n : 0; }
function meanDiff(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i += 7) s += Math.abs(a[i] - b[i]); return s / (n / 7); }

// per-frame block analysis against the reference at the frame's own scroll offset
function analyse(fr, sy, ref, L, textMask) {
  const {data, w, h} = fr, bg = L.bg;
  let blocks = 0, inc = 0, chk = 0, tBlocks = 0, tInc = 0;
  for (let by = L.head; by + B <= h; by += B) {
    const dy = Math.round(sy) + by; if (dy < 0 || dy + B > ref.H) continue;
    for (let bx = 0; bx + B <= w; bx += B) {
      let d = 0, sl = 0, sl2 = 0, mr = 0, mg = 0, mb = 0;
      for (let yy = 0; yy < B; yy++) { const fo = ((by + yy) * w + bx) * 3, ro = ((dy + yy) * ref.W + bx) * 3;
        for (let xx = 0; xx < B * 3; xx += 3) { const R = data[fo + xx], G = data[fo + xx + 1], Bl = data[fo + xx + 2];
          d += Math.abs(R - ref.data[ro + xx]) + Math.abs(G - ref.data[ro + xx + 1]) + Math.abs(Bl - ref.data[ro + xx + 2]);
          const l = .299 * R + .587 * G + .114 * Bl; sl += l; sl2 += l * l; mr += R; mg += G; mb += Bl; } }
      const n = B * B, md = d / n / 3, sd = Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2));
      const flatBg = sd < FLAT && Math.abs(mr / n - bg[0]) < NEAR && Math.abs(mg / n - bg[1]) < NEAR && Math.abs(mb / n - bg[2]) < NEAR;
      const bad = md > DIFF;
      blocks++; if (bad) inc++; if (bad && flatBg) chk++;
      if (textMask(bx, dy)) { tBlocks++; if (bad) tInc++; }
    }
  }
  return {inc: blocks ? inc / blocks : 0, chk: blocks ? chk / blocks : 0, text: tBlocks ? tInc / tBlocks : 0, tBlocks};
}

// the probe proper. load(): navigates to the page and resolves once it reports ready (caller-owned: Chromium context or Android tab).
export async function flingProbe({page, cdp, load, speed = 12000, waitMs = 500, framesDir = null, withReference = true, traced = true, log = () => {}}) {
  const res = {speed, waitMs};
  const load0 = load; load = async () => { await load0(); await page.evaluate(() => { document.documentElement.style.overscrollBehavior = 'none'; }); };
  const vp = await (async () => { await load(); return page.evaluate(() => ({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})); })();
  const x = Math.round(vp.w / 2), y0 = Math.round(vp.h * .8), y1 = Math.round(vp.h * .25);
  res.viewport = vp;
  // ---- pass A: trace + rAF
  if (traced) {
    await sleep(waitMs);
    await cdp.send('Tracing.start', {categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,gpu,viz,toplevel', transferMode: 'ReturnAsStream'});
    await page.evaluate(FRAMES); await page.evaluate(() => window.__fp.begin());
    const f = await fling(page, cdp, {speed, x, y0, y1});
    const win = await page.evaluate(() => window.__fp.end());
    const {finishCDPTrace} = await import('../browser-test-lib.mjs');
    const trace = JSON.parse(await finishCDPTrace(cdp, {timeoutMs: 120000}));
    const observed=flingFrameEvidence(win);if(!observed.supported)throw Error('UNSUPPORTED fling rAF stream: '+observed.issues.join('; '));
    res.passA = {...observed,landed: f.marks,artAtEntry: win.art, artNotReady: Object.entries(win.art).filter(([, v]) => !v.ready).map(([k]) => k), cost: traceCost(trace.traceEvents || trace)};
    log('pass A ' + JSON.stringify({...res.passA,timestamps:undefined,intervals:undefined}));
    await load();
  }
  // ---- pass B: screencast
  await sleep(waitMs);
  const frames = [];
  const onFrame = e => { frames.push({t: e.metadata.timestamp * 1000, sy: e.metadata.scrollOffsetY, data: Buffer.from(e.data, 'base64')}); cdp.send('Page.screencastFrameAck', {sessionId: e.sessionId}).catch(() => {}); };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 80, maxWidth: vp.w, maxHeight: vp.h, everyNthFrame: 1});
  await sleep(300);
  const t0 = Date.now(), f = await fling(page, cdp, {speed, x, y0, y1});
  await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', onFrame);
  const L = await page.evaluate(LAYOUT);
  res.passB = {frames: frames.length, H: f.H, head: L.head, rootBg: L.bg, landed: f.marks};
  if (!withReference || frames.length < 3) { res.passB.error = frames.length < 3 ? 'screencast produced ' + frames.length + ' frames' : null; return res; }
  const ref = await reference(page, L, log);
  res.passB.reference={converged:true,strips:ref.proof};
  // text mask on the block grid: a block is "text" if a text run covers at least a third of it
  const tset = new Set();
  for (const [tx, ty, tw, th] of L.text) for (let by = Math.floor(ty / B) * B; by < ty + th; by += B) for (let bx = Math.max(0, Math.floor(tx / B) * B); bx < Math.min(L.vw, tx + tw); bx += B) {
    const ov = (Math.min(bx + B, tx + tw) - Math.max(bx, tx)) * (Math.min(by + B, ty + th) - Math.max(by, ty)); if (ov >= B * B / 3) tset.add(bx + ',' + by); }
  const textMask = (bx, dy) => tset.has(bx + ',' + (Math.floor(dy / B) * B));   // block rows are scroll-aligned to B only approximately; nearest grid row
  const rows = [];
  for (const fr of frames) { const img = await raw(fr.data, vp.w); rows.push({t: fr.t, sy: fr.sy, ...analyse(img, fr.sy, ref, L, textMask)}); fr.img = img; }
  const tBase = rows[0].t, maxY = f.H;
  const down = rows.findIndex(r => r.sy >= maxY - 2), upFrom = rows.findIndex(r => r.t >= tBase + (f.marks.upStart - t0) - 50);
  const top = upFrom < 0 ? -1 : rows.findIndex((r, i) => i >= upFrom && r.sy <= 1);
  const landing = (i, name) => { if (i < 0) return {name, landed: false};
    const L0 = rows[i], after = rows.slice(i), until = q => { const j = after.findIndex(q); return j < 0 ? null : r1(after[j].t - L0.t); };
    return {name, landed: true, sy: L0.sy, firstFrame: {incomplete: r1(L0.inc * 100), checker: r1(L0.chk * 100), textMissing: r1(L0.text * 100)},
      textReadyMs: until(r => r.text <= .01), artReadyMs: until(r => r.inc <= .02), frames: after.length}; };
  const flight = rows.filter((r, i) => (i < down || (upFrom >= 0 && i >= upFrom && (top < 0 || i < top))));
  const stat = k => ({mean: r1(flight.reduce((s, r) => s + r[k], 0) / Math.max(1, flight.length) * 100), p95: r1(pct(flight.map(r => r[k] * 100), .95)), max: r1(Math.max(0, ...flight.map(r => r[k] * 100)))});
  Object.assign(res.passB, {flightFrames: flight.length, incomplete: stat('inc'), checker: stat('chk'), textMissing: stat('text'),
    framesOver10pct: flight.filter(r => r.inc > .1).length, landings: [landing(down, 'bottom'), landing(top, 'top')],
    timeline: rows.map(r => [r1(r.t - tBase), Math.round(r.sy), r1(r.inc * 100), r1(r.chk * 100), r1(r.text * 100)])});
  if (framesDir) {   // the worst flight frame and both landing frames, for looking at
    await mkdir(framesDir, {recursive: true});
    if (ref.H <= 16383) await sharp(ref.data, {raw: {width: ref.W, height: ref.H, channels: 3}}).webp({quality: 70}).toFile(join(framesDir, 'reference.webp'));   // what "complete" means
    const worst = flight.reduce((a, r) => r.inc > (a?.inc ?? -1) ? r : a, null);
    for (const [name, r] of [['worst', worst], ['land-bottom', rows[down]], ['land-top', rows[top]]]) if (r) { const fr = frames[rows.indexOf(r)];
      await sharp(fr.img.data, {raw: {width: fr.img.w, height: fr.img.h, channels: 3}}).png().toFile(join(framesDir, `${name}-${Math.round(r.sy)}.png`)); }
  }
  log('pass B ' + JSON.stringify({...res.passB, timeline: undefined}));
  return res;
}

// Chromium phone emulation: every pass in a fresh context (cold cache), touch, CPU throttling, optional slow 4G and CSS (CSP bypassed).
export async function flingChromium({browser, url, width = 375, height = 812, dpr = 3, cpu = 4, net = null, css = null, speed = 12000, waitMs = 500, framesDir = null, withReference = true, log = () => {}}) {
  const ctxFor = async () => { const ctx = await browser.newContext({viewport: {width, height}, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, bypassCSP: !!css}); const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', {rate: cpu});
    if (net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8}); }   // Lighthouse's mobile slow 4G
    return {ctx, page, cdp}; };
  // each pass gets a fresh context: load() swaps the page under the probe
  const holder = {}, ctxs = [];
  const load = async () => { if (holder.page) await holder.page.goto('about:blank'); const c = await ctxFor(); ctxs.push(c.ctx); holder.page = c.page; holder.cdp = c.cdp;
    await holder.page.goto(url, {waitUntil: 'load'}); if (css) await holder.page.addStyleTag({content: css}); await holder.page.evaluate(() => document.fonts.ready); };
  const proxy = name => new Proxy({}, {get: (_, k) => { const t = holder[name], v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }});
  try { return await flingProbe({page: proxy('page'), cdp: proxy('cdp'), load, speed, waitMs, framesDir, withReference, log}); }
  finally { for (const c of ctxs) await c.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const {browserFixture, browserToolCLI} = await import('../browser-test-lib.mjs');
  const o = browserToolCLI({route: {type: 'string', default: 'optimized-mobile-next'}, site: {type: 'string'}, width: {type: 'string', default: '375'}, height: {type: 'string', default: '812'}, dpr: {type: 'string', default: '3'},
    cpu: {type: 'string', default: '4'}, speed: {type: 'string', default: '12000'}, wait: {type: 'string', default: '500'}, css: {type: 'string'}, label: {type: 'string'}, out: {type: 'string'}, 'no-ref': {type: 'boolean'}, 'slow-raster': {type: 'boolean'}, net: {type: 'string'}},
  'Fling top -> bottom -> top on a phone viewport; blank/incomplete area per frame, text/art arrival after landing, frame cadence, raster cost.');
  const num = (k, lo, hi) => { const v = Number(o[k]); if (typeof o[k]!=='string'||!o[k].trim()||!Number.isFinite(v) || v < lo || v > hi) throw Error(`--${k} must be in ${lo}..${hi}`); return v; };
  const W = num('width', 200, 2000), Hh = num('height', 300, 3000), dpr = num('dpr', 1, 4), cpu = num('cpu', 1, 20), speed = num('speed', 500, 50000), wait = num('wait', 0, 30000);
  if (!/^[a-z0-9-]+$/i.test(o.route)) throw Error('--route must be a nonempty bare route name');
  if (o.net !== undefined && o.net !== 'slow4g') throw Error('--net accepts only slow4g');
  const label = o.label || `${o.site ? 'site' : o.route}-${W}x${Hh}@${dpr}-cpu${cpu}${o['slow-raster'] ? '-slowraster' : ''}${o.net ? '-' + o.net : ''}`;
  const OUT = resolve(o.out || process.env.HW_OUT || join(root, 'output/playwright/fling-blank'));
  const fx = await browserFixture({siteRoot: o.site, runTimeoutMs: 15 * 60000});
  const url = fx.base + (o.site ? '/' : `/${o.route}/`);
  let report;
  try {
    const browser = o['slow-raster'] ? await fx.launch(['--disable-gpu-rasterization', '--num-raster-threads=1']) : fx.browser;
    report = {label, url, cpu, net: o.net || null, slowRaster: !!o['slow-raster'], css: o.css || null, ...(await flingChromium({browser, url, width: W, height: Hh, dpr, cpu, net: o.net, css: o.css, speed, waitMs: wait,
      framesDir: join(OUT, label), withReference: !o['no-ref'], log: m => console.log(label + ' ' + m.slice(0, 900))}))};
  } finally { await fx.close(); }
  await mkdir(OUT, {recursive: true});
  await writeFile(join(OUT, label + '.json'), JSON.stringify(report, null, 1) + '\n');
  const b = report.passB, a = report.passA;
  console.log(`\n${label}: frames p95 ${a?.p95} max ${a?.max} | raster ${a?.cost.rasterTaskMs} ms decode ${a?.cost.decodeMs} ms paint ${a?.cost.paintMs} ms gpu ${a?.cost.threadBusyMs?.CrGpuMain} ms | art not loaded at entry ${JSON.stringify(a?.artNotReady)} | flight incomplete mean ${b.incomplete?.mean}% max ${b.incomplete?.max}% checker max ${b.checker?.max}% text-missing max ${b.textMissing?.max}% | `
    + (b.landings || []).map(l => `${l.name}: first frame ${JSON.stringify(l.firstFrame)} text ${l.textReadyMs} ms art ${l.artReadyMs} ms`).join(' | ') + `\nreport ${join(OUT, label + '.json')}`);
  if (b.error || (b.frames ?? 0) < 3) { console.error('FAIL: incomplete fling measurement — ' + (b.error || b.frames + ' frames')); process.exitCode = 1; }
}
