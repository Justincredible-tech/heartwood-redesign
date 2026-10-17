// Zoom-on-load troll: load the page and IMMEDIATELY zoom to the maximum, straight back out, repeatedly and faster each cycle;
// measure per screencast frame how much of the screen is only background, when text/art arrive at each zoom, when the
// re-raster at the new scale is crisp, frame cadence, and what is still loading (network, image decodes, fonts) at every step.
// Not a gate: a reproducible baseline (seeded, deterministic schedule) to prove or disprove a first-screen stand-in.
//   tools/diagnostics/browser-lock.sh node tools/diagnostics/zoom-troll.mjs [--base http://127.0.0.1:8766] [--routes a,b]
//     [--envs 1424x820@2,1365x768@1,375x812@3t]    t = phone: touch + isMobile, pinch zoom (visual viewport) instead of ctrl zoom
//     [--levels 2,3,5] [--pinch-levels 5] [--cycles 4] [--hold 800] [--speedup 2] [--jitter 0.2] [--seed 1] [--settle 4000]
//     [--triggers commit] [--touch-triggers commit,dcl] [--touch-cpu 4,6] [--pinch-speed 800] [--ref-settle 2500] [--keep-frames] [--marker CSS] [--out DIR]
// Desktop zoom = ctrl/cmd zoom: Emulation.setDeviceMetricsOverride with CSS viewport W/z and devicePixelRatio dpr*z (exactly what
// browser zoom does; physical pixels stay constant). Phone zoom = Input.synthesizePinchGesture (touch) to the level, then back.
// Triggers: commit (main frame navigated), firstPaint, fcp, dcl (DOMContentLoaded = "mid-load"), load. Without --base the run
// serves HW_SITE_ROOT/site on an owned loopback preview. Per run under --out: run.json (steps, frame timeline, worst moments
// with trace causes), trace.json.gz, frames/*.jpg; report.json + summary.txt for the whole invocation.
// Frames: the trace filmstrip (devtools.screenshot: every presented frame) plus the screencast (whose metadata gives the zoom on
// screen). Both are captured at CSS-px size, so on desktop ctrl zoom a stale lower-scale raster is invisible in pixels: there
// "crisp" is the trace's raster completion; the pixel sharpness metric is meaningful for phone pinch.
// Blank = 8 px blocks that are flat and within tolerance of the html/body background or unstyled white (tools/diagnostics/frame-metrics.mjs);
// excess blank = blank minus the settled page's own blank at that zoom; blank time = screen time >= 10%/50% excess (the
// commit->first paint wait counts). Text/art "first"/"ready" = 25%/90% of the settled filmstrip reference's non-background,
// non-animated text/art blocks match (mean |diff| <= 18). Crisp = Laplacian variance on the reference's sharpest stable crop >= 85%.
import {mkdir, writeFile, statfs} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {browserFixture, browserToolCLI, isLocalUrl, finishCDPTrace} from '../browser-test-lib.mjs';
import {loadSharp} from '../sharp-deps.mjs';
import {blankMask, laplacianVariance, sharpestCrop, blockDiff, coverage, percentile, zoomSchedule, blankTime as filmBlankTime} from './frame-metrics.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const sharp = loadSharp();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wall = () => performance.timeOrigin + performance.now();
const r1 = x => x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
const pc = x => x == null ? null : r1(x * 100);
const DIFF = 18, FIRST = .25, READY = .9, CRISP = .85, WHITE = [255, 255, 255];
const LIFE = {firstPaint: 'firstPaint', fcp: 'firstContentfulPaint', dcl: 'DOMContentLoaded', load: 'load'};
// devtools.screenshot = the Performance-panel filmstrip: a capture of each presented compositor frame, taken inside viz.
// (Page.captureScreenshot is NOT usable here: under device-metrics emulation it temporarily undoes the emulation to capture,
// flipping the page between zoom levels and returning tiled images; measured 2026-10-12.)
const CATEGORIES = 'disabled-by-default-devtools.screenshot,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,toplevel,cc,gpu,blink.user_timing,loading';
const markerFor = route => /mobile/.test(route) ? 'header.top#top' : /taste/.test(route) ? 'link[href*="taste."]' : 'symbol#hw-logo';
const RAF = `(()=>{const a=window.__ztRaf=[],o=performance.timeOrigin;const f=t=>{if(a.length<30000){a.push(o+t);requestAnimationFrame(f);}};requestAnimationFrame(f);})()`;
const DOM = () => ({ready: document.readyState, fonts: document.fonts.status, fontsLoading: [...document.fonts].filter(f => f.status === 'loading').length, imgs: document.images.length, imgsPending: [...document.images].filter(i => !i.complete).length});
// live text runs inside the visual viewport (visual-viewport CSS px), visual viewport size/scale, html/body background colours
const LAYOUT = () => {
  const vv = visualViewport, out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), rg = document.createRange();
  for (let n; (n = w.nextNode());) {
    if (!n.data.trim() || !n.parentElement || !n.parentElement.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
    rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1 && r.bottom > vv.offsetTop && r.top < vv.offsetTop + vv.height && r.right > vv.offsetLeft && r.left < vv.offsetLeft + vv.width) out.push([r.left - vv.offsetLeft, r.top - vv.offsetTop, r.width, r.height]);
  }
  const c = s => s && s !== 'rgba(0, 0, 0, 0)' && s !== 'transparent' ? s.match(/[\d.]+/g).slice(0, 3).map(Number) : null;
  return {text: out, vw: vv.width, vh: vv.height, scale: vv.scale, bgs: [c(getComputedStyle(document.documentElement).backgroundColor), c(getComputedStyle(document.body).backgroundColor)].filter(Boolean)};
};
const short = u => { try { const x = new URL(u); return x.pathname.split('/').pop().replace(/\.[0-9a-f]{12,}\./, '.') || x.pathname; } catch { return String(u).slice(0, 40); } };
const gaps = ts => ts.slice(1).map((t, i) => t - ts[i]);
const nearest = (z, levels) => { const l = levels.reduce((a, b) => Math.abs(Math.log(b / z)) < Math.abs(Math.log(a / z)) ? b : a); return Math.abs(z / l - 1) < .04 ? l : null; };

export function parseEnv(s) {
  const m = /^(\d{3,4})x(\d{3,4})@(\d(?:\.\d+)?)(t?)$/.exec(s);
  if (!m) throw Error(`--envs entry "${s}" must look like 1424x820@2 or 375x812@3t`);
  const e = {w: +m[1], h: +m[2], dpr: +m[3], touch: m[4] === 't', name: s};
  if (e.dpr < 1 || e.dpr > 4) throw Error('dpr must be 1..4: ' + s);
  return e;
}

async function decode(buf, A) {
  const {data, info} = await sharp(buf).resize(A.w, A.h, {fit: 'fill'}).removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height, channels: info.channels};
}
const setZoom = (cdp, env, z) => cdp.send('Emulation.setDeviceMetricsOverride', {width: Math.round(env.w / z), height: Math.round(env.h / z), deviceScaleFactor: env.dpr * z, mobile: false});
// the anchor is in CSS px of the current visual viewport (Chrome multiplies it by the current page scale): screen centre = centre / from
const pinch = (cdp, env, from, to, speed) => cdp.send('Input.synthesizePinchGesture', {x: Math.round(env.w / 2 / from), y: Math.round(env.h / 2 / from), scaleFactor: to / from, relativeSpeed: Math.round(speed), gestureSourceType: 'touch'});
const domProbe = page => Promise.race([page.evaluate(DOM).catch(e => ({error: e.message.split('\n')[0].slice(0, 90)})), sleep(1500).then(() => ({busy: 'main thread did not answer within 1.5 s'}))]);

// settled page at zoom z, from the same filmstrip pipeline as the measured frames (an untraced-for-cost, screenshot-only trace):
// the last presented frame after cfg.refSettle ms (each finished raster presents a frame, so it is the settled view); the last
// three frames give the animated (unstable) mask; text/art/blank masks; sharpest crop.
async function reference(page, cdp, env, z, A, cfg, warnings, rt) {
  await cdp.send('Tracing.start', {categories: 'disabled-by-default-devtools.screenshot', transferMode: 'ReturnAsStream'});
  if (env.touch) { if (z > 1) await pinch(cdp, env, 1, z, cfg.pinchSpeed); } else await setZoom(cdp, env, z);
  await sleep(cfg.refSettle);
  const ev = JSON.parse(await finishCDPTrace(cdp, {runtime: rt, timeoutMs: 60000}));
  const all = (ev.traceEvents || ev).filter(e => e.name === 'Screenshot' && e.args?.snapshot).sort((a, b) => a.ts - b.ts), endTs = all.at(-1)?.ts;
  if (!all.length) throw Error(`no frame was presented while settling the reference at zoom ${z}`);
  // animation mask: walk back from the final frame through the last 1.2 s (<= 40 frames) while frames differ only locally
  // (mean block diff < 8); a wholesale difference is the zoom transition or pre-raster state, not animation
  const film = all.filter(e => e.ts >= endTs - 1.2e6).slice(-40).map(e => Buffer.from(e.args.snapshot, 'base64'));
  const decoded = await Promise.all(film.map(j => decode(j, A))), cur = decoded.at(-1), jpeg = film.at(-1), {width, height} = await sharp(jpeg).metadata(), imgs = [cur];
  for (let k = decoded.length - 2; k >= 0; k--) { const d = blockDiff(decoded[k], cur); if (d.reduce((s, v) => s + v, 0) / d.length >= 8) break; imgs.unshift(decoded[k]); }
  const L = await page.evaluate(LAYOUT);
  if (Math.abs((env.touch ? L.scale : env.w / L.vw) / z - 1) > .05) warnings.push(`reference zoom ${z} measured ${r1(env.touch ? L.scale : env.w / L.vw)}`);
  const bgs = [...L.bgs, WHITE], bm = blankMask(cur, bgs), {cols, rows} = bm, unstable = new Uint8Array(cols * rows);
  for (let k = 1; k < imgs.length; k++) blockDiff(imgs[k - 1], imgs[k]).forEach((v, i) => { if (v > DIFF) unstable[i] = 1; });
  const kx = A.w / L.vw, ky = A.h / L.vh, text = coverage(L.text.map(([x, y, w, h]) => [x * kx, y * ky, w * kx, h * ky]), cols, rows);
  // text/art blocks are never flat background blocks: a blank frame must not "match" them
  const textMask = text.map((t, i) => t && !bm.mask[i] && !unstable[i] ? 1 : 0), artMask = text.map((t, i) => !t && !bm.mask[i] && !unstable[i] ? 1 : 0);
  const still = {...cur, data: Buffer.from(cur.data)};   // the sharpness crop is chosen on stable blocks only (animated blocks flattened)
  unstable.forEach((u, i) => { if (u) for (let y = 0; y < bm.block; y++) still.data.fill(128, (((i / cols | 0) * bm.block + y) * cur.width + (i % cols) * bm.block) * 3, (((i / cols | 0) * bm.block + y) * cur.width + (i % cols + 1) * bm.block) * 3); });
  const crop = sharpestCrop(still, {size: Math.round(A.w / 8)});
  if (crop.v < 50) warnings.push(`zoom ${z}: no stable detailed region for the sharpness crop (variance ${r1(crop.v)}); crisp unmeasured`);
  const ref = {z, img: cur, jpeg, w: width, h: height, filmFrames: imgs.length, bgs, blank: bm.mask.reduce((s, v) => s + v, 0) / bm.mask.length, textMask, artMask, crop, sharp: crop.v >= 50 ? crop.v : null,
    blocks: {text: textMask.reduce((s, v) => s + v, 0), art: artMask.reduce((s, v) => s + v, 0), unstable: unstable.reduce((s, v) => s + v, 0), all: cols * rows}};
  if (env.touch) { if (z > 1) await pinch(cdp, env, z, 1, cfg.pinchSpeed); } else await setZoom(cdp, env, 1);
  await sleep(300);
  return ref;
}

function traceModel(trace, clock) {
  const ev = trace.traceEvents || trace, threads = {};
  for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  const sync = ev.find(e => e.name === 'clock_sync' && e.args?.sync_id === clock.id), start = ev.find(e => e.name === 'TracingStartedInBrowser');
  const anchor = sync || start; if (!anchor) return {events: [], shots: [], clock: 'none'};
  const off = (sync ? clock.mid : clock.start) - anchor.ts / 1000;
  const kind = n => /^CrRendererMain/.test(n) ? 'main' : /^Compositor$/.test(n) ? 'compositor' : /CompositorTileWorker/.test(n) ? 'raster' : /^CrGpuMain/.test(n) ? 'gpu' : /VizCompositor/.test(n) ? 'viz' : /ThreadPoolForeground/.test(n) ? 'pool' : null;
  const events = [], shots = [];
  for (const e of ev) { if (e.name === 'Screenshot' && e.args?.snapshot) { shots.push({t: e.ts / 1000 + off, jpeg: Buffer.from(e.args.snapshot, 'base64')}); continue; }
    if (e.ph !== 'X' || !e.dur) continue; const k = kind(threads[e.pid + ':' + e.tid] || ''); if (!k) continue;
    events.push({name: e.name, kind: k, s: e.ts / 1000 + off, e: (e.ts + e.dur) / 1000 + off}); }
  return {events, shots: shots.sort((a, b) => a.t - b.t), clock: sync ? 'sync-marker' : 'trace-start-approx'};
}
const isRaster = x => (x.kind === 'raster' && x.name === 'RasterTask') || (x.kind === 'gpu' && /Raster/i.test(x.name) && !/RunTask/.test(x.name));
const isDecode = x => /Decode/i.test(x.name) && !/RunTask/.test(x.name);
const WRAPPER = /RunTask|ThreadController|SequenceManager|MessageLoop|TaskGraphRunner|ThreadPool_|ProxyMain|RunLoop/;
function causes(events, a, b) {   // what each thread was doing in [a, b): top named events by overlapped ms
  const agg = {}, out = [];
  for (const x of events) { if (x.e <= a || x.s >= b || WRAPPER.test(x.name)) continue; const k = x.kind + ':' + x.name; agg[k] = (agg[k] || 0) + Math.min(b, x.e) - Math.max(a, x.s); }
  // a nested chain on one thread (GpuChannel::ExecuteDeferredRequest > GPUTask > RendererRasterWorker ...) has ~equal totals: keep its innermost name
  for (const [k, ms] of Object.entries(agg).sort((p, q) => q[1] - p[1])) { const prev = out.at(-1);
    if (prev && prev.k.split(':')[0] === k.split(':')[0] && ms >= prev.ms * .97) { prev.k = k; prev.ms = ms; } else out.push({k, ms}); }
  return out.slice(0, 6).map(({k, ms}) => `${k} ${r1(ms)}ms`);
}

async function trollRun(fx, cfg, OUT) {
  const rt = fx.runtime, {env, url} = cfg, levels = env.touch ? cfg.pinchLevels : cfg.levels, all = [1, ...levels];
  const A = {w: Math.min(env.w * env.dpr, Math.max(env.w, 750))}; A.h = Math.round(env.h * env.dpr * A.w / (env.w * env.dpr));
  const sched = zoomSchedule({levels, cycles: cfg.cycles, hold: cfg.hold, speedup: cfg.speedup, jitter: cfg.jitter, seed: cfg.seed});
  const dir = join(OUT, cfg.label), rel = f => f && `frames/${f}`, warnings = [];
  await mkdir(join(dir, 'frames'), {recursive: true});
  const ctx = await fx.browser.newContext({viewport: {width: env.w, height: env.h}, deviceScaleFactor: env.dpr, isMobile: env.touch, hasTouch: env.touch});
  try {
    await ctx.addInitScript(RAF);
    const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
    const frames = [], reqs = new Map(), lifeBy = {}, waiters = [];
    let nav = null;
    const lifeOf = name => nav && lifeBy[nav.loaderId]?.[name];
    const fire = () => { for (const w of [...waiters]) if (w.check()) { waiters.splice(waiters.indexOf(w), 1); w.resolve(); } };
    const until = check => new Promise(r => { if (check()) r(); else waiters.push({check, resolve: r}); });
    cdp.on('Page.screencastFrame', e => { frames.push({t: e.metadata.timestamp ? e.metadata.timestamp * 1000 : wall(), md: e.metadata, data: Buffer.from(e.data, 'base64')}); cdp.send('Page.screencastFrameAck', {sessionId: e.sessionId}).catch(() => {}); });
    cdp.on('Network.requestWillBeSent', e => { if (!reqs.has(e.requestId) && !/^data:/.test(e.request.url)) reqs.set(e.requestId, {url: e.request.url, type: e.type, s: wall(), e: null}); });
    const end = failed => e => { const r = reqs.get(e.requestId); if (r && r.e == null) { r.e = wall(); if (failed) r.failed = e.errorText; } };
    cdp.on('Network.loadingFinished', end(false)); cdp.on('Network.loadingFailed', end(true));
    await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Page.setLifecycleEventsEnabled', {enabled: true});
    const mainId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    cdp.on('Page.lifecycleEvent', e => { if (e.frameId === mainId) { (lifeBy[e.loaderId] ||= {})[e.name] ??= wall(); fire(); } });
    cdp.on('Page.frameNavigated', e => { if (e.frame.id === mainId && e.frame.url.startsWith(url) && !nav) { nav = {loaderId: e.frame.loaderId, t: wall()}; fire(); } });
    if (cfg.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', {rate: cfg.cpu});
    await cdp.send('Tracing.start', {categories: CATEGORIES, transferMode: 'ReturnAsStream'});
    const clock = {id: 'zoom-troll-' + cfg.seed, start: wall()};
    await cdp.send('Tracing.recordClockSyncMarker', {syncId: clock.id}).catch(e => warnings.push('clock sync marker unavailable: ' + e.message));
    clock.mid = (clock.start + wall()) / 2;
    await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 80, maxWidth: env.w * env.dpr, maxHeight: env.h * env.dpr, everyNthFrame: 1});
    const t0 = wall();
    let navError = null;
    const navP = page.goto(url, {waitUntil: 'load', timeout: 60000}).catch(e => { navError = e; });
    await rt.deadline(`wait for ${cfg.trigger} of ${url}`, () => until(() => navError || (cfg.trigger === 'commit' ? nav : lifeOf(LIFE[cfg.trigger]))), {timeoutMs: 30000});
    if (navError) throw Error(`navigation to ${url} failed: ${navError.message}`);
    // ---- the troll
    const steps = [], probes = [];
    for (const [i, s] of sched.entries()) {
      const tCmd = wall(), step = {i, ...s, tCmd};
      steps.push(step); probes.push(domProbe(page).then(v => { step.dom = v; }));
      // a pinch issued during load can fall short, so pinch from the scale actually on screen (latest screencast metadata)
      if (env.touch) { const live = frames.at(-1)?.md.pageScaleFactor || s.from; step.fromActual = r1(live);
        if (Math.abs(live / s.to - 1) > .02) await rt.deadline(`pinch step ${i} ${r1(live)}->${s.to}`, () => pinch(cdp, env, live, s.to, cfg.pinchSpeed * cfg.speedup ** s.cycle)); }
      else await rt.deadline(`zoom step ${i} ${s.from}->${s.to}`, () => setZoom(cdp, env, s.to));
      step.tDone = wall();
      await sleep(Math.max(0, tCmd + s.hold - wall()));
    }
    const tEnd = wall(), endDom = domProbe(page);
    await rt.deadline('page load of ' + url, () => navP, {timeoutMs: 60000});
    if (navError) throw Error(`navigation to ${url} failed: ${navError.message}`);
    const id = await page.evaluate(sel => ({path: location.pathname, title: document.title, marker: !!document.querySelector(sel)}), cfg.marker);
    if (id.path !== new URL(url).pathname || !/Heartwood/.test(id.title) || !id.marker) throw Error(`expected page did not load at ${url} (marker ${cfg.marker}): ${JSON.stringify(id)}`);
    await sleep(cfg.settle);
    const tStop = wall();
    await rt.deadline('DOM loading probes', () => Promise.allSettled([...probes, endDom]), {timeoutMs: 35000});
    const afterDom = await endDom;
    await cdp.send('Page.stopScreencast');
    const raf = await page.evaluate(() => window.__ztRaf || []);
    const traceText = await finishCDPTrace(cdp, {runtime: rt, timeoutMs: 180000});
    await writeFile(join(dir, 'trace.json.gz'), gzipSync(traceText));
    const T = traceModel(JSON.parse(traceText), clock);
    if (T.clock !== 'sync-marker') warnings.push('trace clock ' + T.clock);
    // ---- settled references at every zoom level (untraced, after the troll)
    if (cfg.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
    const refs = {};
    for (const z of all) refs[z] = await reference(page, cdp, env, z, A, cfg, warnings, rt);
    for (const z of all) await writeFile(join(dir, 'frames', `reference-zoom${z}.jpg`), refs[z].jpeg);
    // ---- per frame, two streams, each compared with the reference resampled to the frame's own size (low resolution alone
    // never reads as missing content): screencast frames (CSS px; zoom from their metadata) and the trace filmstrip
    // (every presented frame; no metadata, so zoom = whichever of the step's from/to references it matches best)
    const shots = T.shots;
    frames.sort((a, b) => a.t - b.t);
    const stepOf = t => { let k = -1; for (const s of steps) if (s.tCmd <= t) k = s.i; return k; };
    const bgs = refs[1].bgs, minBlank = Math.min(...all.map(z => refs[z].blank)), rows = [], refCache = new Map();
    const fraction = m => m.reduce((s, v) => s + v, 0) / m.length;
    const refFor = async (l, w, h) => { const k = l + ':' + w + 'x' + h;
      if (w === refs[l].w && h === refs[l].h) return refs[l];
      if (!refCache.has(k)) { const img = await decode(await sharp(refs[l].jpeg).resize(w, h, {fit: 'fill'}).jpeg({quality: 80}).toBuffer(), A); refCache.set(k, {...refs[l], img, blank: fraction(blankMask(img, bgs).mask)}); }
      return refCache.get(k); };
    const measure = (img, ref, row) => { const d = blockDiff(img, ref.img), shown = m => { let n = 0, k = 0; for (let i = 0; i < m.length; i++) if (m[i]) { n++; if (d[i] <= DIFF) k++; } return n ? k / n : null; };
      row.text = shown(ref.textMask); row.art = shown(ref.artMask); row.excess = Math.max(0, row.blank - ref.blank); return d; };
    for (const [k, f] of frames.entries()) {
      const img = await decode(f.data, A), {width, height} = await sharp(f.data).metadata(), z = env.touch ? f.md.pageScaleFactor : env.w / f.md.deviceWidth, lvl = nearest(z, all);
      const row = {src: 'cast', k, t: f.t, z, lvl, fw: width, dw: f.md.deviceWidth, psf: f.md.pageScaleFactor, blank: fraction(blankMask(img, bgs).mask), text: null, art: null, sharp: null};
      row.excess = Math.max(0, row.blank - minBlank);
      if (lvl) measure(img, await refFor(lvl, width, height), row);
      rows.push(row);
    }
    for (const [k, p] of shots.entries()) {
      // zoom of a filmstrip frame = metadata of the screencast frame presented with it (<= 50 ms); only without one, the
      // step's from/to reference it matches best. Intermediate scales (a pinch in flight or fallen short) stay unlabelled.
      const near = frames.reduce((b, f) => Math.abs(f.t - p.t) < Math.abs((b?.t ?? Infinity) - p.t) ? f : b, null), zc = near && Math.abs(near.t - p.t) <= 50 ? (env.touch ? near.md.pageScaleFactor : env.w / near.md.deviceWidth) : null;
      const img = await decode(p.jpeg, A), {width, height} = await sharp(p.jpeg).metadata(), sa = stepOf(p.t), cand = zc != null ? [nearest(zc, all)].filter(Boolean) : sa < 0 ? [1] : [...new Set([steps[sa].from, steps[sa].to])];
      const row = {src: 'film', k, t: p.t, z: zc, lvl: null, fw: width, blank: fraction(blankMask(img, bgs).mask), text: null, art: null, sharp: null};
      row.excess = Math.max(0, row.blank - minBlank);
      let best = Infinity;
      for (const l of cand) { const ref = await refFor(l, width, height), r = {blank: row.blank}, d = measure(img, ref, r), m = d.reduce((s, v) => s + v, 0) / d.length;
        if (m < best) { best = m; Object.assign(row, r, {lvl: l, z: zc ?? l, zSource: zc != null ? 'screencast' : 'content', sharp: ref === refs[l] && ref.sharp ? laplacianVariance(img, ref.crop) / ref.sharp : null}); } }   // sharpness only against a same-size reference
      rows.push(row);
    }
    rows.sort((a, b) => a.t - b.t);
    const dataOf = r => r.src === 'cast' ? frames[r.k].data : shots[r.k].jpeg;
    if (cfg.keepFrames) { await mkdir(join(dir, 'all'), {recursive: true}); for (const r of rows) await writeFile(join(dir, 'all', `${String(Math.round(r.t - t0)).padStart(6, '0')}-${r.src}-z${r1(r.z)}-step${stepOf(r.t)}.jpg`), dataOf(r)); }
    const inflightAt = t => [...reqs.values()].filter(r => r.s <= t && (r.e == null || r.e > t));
    const rafIn = (a, b) => { const i = raf.findIndex(t => t >= a); if (i < 0) return []; const j = raf.findIndex(t => t >= b); return raf.slice(Math.max(0, i - 1), j < 0 ? raf.length : j); };
    // screen time with >= thr excess blank, from the filmstrip (every presented frame; the commit->first paint wait counts)
    const film = rows.filter(r => r.src === 'film'), blankTime = (a, b, thr) => r1(filmBlankTime(film, a, b, thr));
    // ---- per step
    for (const s of steps) {
      const tNext = steps[s.i + 1]?.tCmd ?? tStop, R = rows.filter(r => r.t >= s.tCmd && r.t < tNext), at = R.filter(r => r.lvl === s.to);
      s.blank10Ms = blankTime(s.tCmd, tNext, .1); s.blank50Ms = blankTime(s.tCmd, tNext, .5);
      const first = q => { const r = at.find(q); return r ? r1(r.t - s.tCmd) : null; };
      const ras = T.events.filter(x => isRaster(x) && x.s >= s.tCmd && x.s < tNext), dec = T.events.filter(x => isDecode(x) && x.s >= s.tCmd && x.s < tNext);
      const g = gaps(rafIn(s.tCmd, tNext)), net = inflightAt(s.tCmd);
      Object.assign(s, {windowMs: r1(tNext - s.tCmd), cmdMs: r1(s.tDone - s.tCmd), frames: R.length, inputToFrameMs: first(() => true),
        blankMax: pc(Math.max(0, ...R.map(r => r.blank))), excessMax: pc(Math.max(0, ...R.map(r => r.excess))),
        textFirstMs: first(r => r.text != null && r.text >= FIRST), textReadyMs: first(r => r.text != null && r.text >= READY),
        artFirstMs: first(r => r.art != null && r.art >= FIRST), artReadyMs: first(r => r.art != null && r.art >= READY), crispMs: first(r => r.sharp != null && r.sharp >= CRISP),
        raster: {tasks: ras.length, ms: r1(ras.reduce((t, x) => t + x.e - x.s, 0)), doneMs: ras.length ? r1(Math.max(...ras.map(x => x.e)) - s.tCmd) : null, cutByNextStep: ras.some(x => x.e > tNext)},
        decodes: {started: dec.length, ms: r1(dec.reduce((t, x) => t + x.e - x.s, 0)), runningAtStart: T.events.filter(x => isDecode(x) && x.s <= s.tCmd && x.e > s.tCmd).length},
        rafP95: r1(percentile(g, .95)), rafMax: r1(Math.max(0, ...g)), loading: {net: net.length, urls: net.slice(0, 6).map(r => short(r.url)), dom: s.dom || null}});
      delete s.dom;
    }
    // ---- worst moments: biggest excess blank (distinct steps) and longest frame gap, with what the trace shows in the 300 ms before
    const worst = [], seen = new Set();
    for (const r of [...rows].sort((a, b) => b.excess - a.excess || a.t - b.t)) { const k = stepOf(r.t); if (r.t < nav.t || seen.has(k) || r.excess <= 0 || worst.length >= 3) continue; seen.add(k);   // before commit = the previous about:blank
      const file = `worst${worst.length + 1}-step${k}-${Math.round(r.t - t0)}ms-${r.src}.jpg`; await writeFile(join(dir, 'frames', file), dataOf(r));
      worst.push({kind: 'blank', tMs: r1(r.t - t0), step: k, src: r.src, zoom: r1(r.z), blank: pc(r.blank), excess: pc(r.excess), frame: rel(file), causes: causes(T.events, r.t - 300, r.t), netInflight: inflightAt(r.t).map(q => short(q.url)).slice(0, 8)}); }
    const allGaps = gaps(raf), gi = allGaps.indexOf(Math.max(0, ...allGaps));
    if (gi >= 0) worst.push({kind: 'frame-gap', tMs: r1(raf[gi] - t0), step: stepOf(raf[gi]), gapMs: r1(allGaps[gi]), causes: causes(T.events, raf[gi], raf[gi + 1]), netInflight: inflightAt(raf[gi]).map(q => short(q.url)).slice(0, 8)});
    // representative frames: first frame at the max zoom in the first and last cycle, first frame after the final zoom-out, text-ready of the final step
    const save = async (name, r) => { if (!r) return; const file = `${name}-${Math.round(r.t - t0)}ms-${r.src}.jpg`; await writeFile(join(dir, 'frames', file), dataOf(r)); return rel(file); };
    const maxL = Math.max(...levels), last = steps.at(-1), firstAt = (s, q = () => true) => rows.find(r => r.t >= s.tCmd && r.t < (steps[s.i + 1]?.tCmd ?? tStop) && r.lvl === s.to && q(r));
    const saved = {firstMaxCycle0: await save('max-cycle0', firstAt(steps.find(s => s.to === maxL))), firstMaxLastCycle: await save('max-lastcycle', firstAt(steps.findLast(s => s.to === maxL))),
      finalZoomOut: await save('final-zoomout', firstAt(last)), finalTextReady: await save('final-text-ready', firstAt(last, r => r.text >= READY))};
    // "after" = troll end .. settle end only (the reference phase that follows also loads, e.g. @3x art at 5x)
    const runReqs = [...reqs.values()].filter(r => r.s <= tStop);
    const after = {inflightAtEnd: inflightAt(tEnd).map(r => short(r.url)), startedAfterEnd: runReqs.filter(r => r.s > tEnd).map(r => short(r.url)), inflightAtSettleEnd: inflightAt(tStop).map(r => short(r.url)),
      lastRequestEndMs: r1(Math.max(...runReqs.map(r => r.e ?? Infinity)) - tEnd), idleWork: causes(T.events, tStop - 1000, tStop), lastDecodeEndMs: r1(Math.max(-Infinity, ...T.events.filter(isDecode).map(x => x.e)) - tEnd),
      lastRasterEndMs: r1(Math.max(-Infinity, ...T.events.filter(isRaster).map(x => x.e)) - tEnd), dom: afterDom, loadMs: r1(lifeOf('load') - tEnd),
      finalStep: {textFirstMs: last.textFirstMs, textReadyMs: last.textReadyMs, artReadyMs: last.artReadyMs, crispMs: last.crispMs}};
    const allRaf = gaps(raf.filter(t => t >= steps[0].tCmd && t < tStop));
    const run = {label: cfg.label, url, route: cfg.route, env: env.name, touch: env.touch, trigger: cfg.trigger, cpu: cfg.cpu, seed: cfg.seed, levels, schedule: sched, analysis: A, clock: T.clock,
      nav: Object.fromEntries([['commit', nav?.t], ...Object.entries(LIFE).map(([k, v]) => [k, lifeOf(v)]), ['firstImagePaint', lifeOf('firstImagePaint')], ['trollStart', steps[0].tCmd], ['trollEnd', tEnd]].map(([k, v]) => [k, v == null ? null : r1(v - t0)])),
      blankTime: {over50Ms: blankTime(nav.t, tStop, .5), over10Ms: blankTime(nav.t, tStop, .1), firstContentMs: (r => r ? r1(r.t - nav.t) : null)(film.find(r => r.t >= nav.t && r.blank < .5))},
      frames: {cast: frames.length, film: shots.length, filmWidth: rows.find(r => r.src === 'film')?.fw ?? null, filmIntervalP50: r1(percentile(gaps(shots.map(p => p.t)), .5))}, worst: worst.find(w => w.kind === 'blank') || null, rafP95: r1(percentile(allRaf, .95)), rafMax: r1(Math.max(0, ...allRaf)),
      maxZoomSeen: r1(Math.max(...rows.map(r => r.z))), refs: Object.fromEntries(all.map(z => [z, {blank: pc(refs[z].blank), sharp: r1(refs[z].sharp), crop: refs[z].crop, blocks: refs[z].blocks}])),
      steps, worstMoments: worst, after, savedFrames: saved, warnings, timelineColumns: ['src', 'tMs', 'zoom', 'blank%', 'excess%', 'text%', 'art%', 'sharp', 'castFrameWidth', 'castDeviceWidth', 'castPageScale'], timeline: rows.map(r => [r.src, r1(r.t - t0), r1(r.z), pc(r.blank), pc(r.excess), pc(r.text), pc(r.art), r.sharp == null ? null : r1(r.sharp), r.fw ?? null, r.dw ?? null, r.psf ?? null])};
    if (run.maxZoomSeen < maxL * .8) warnings.push(`zoom never reached ${maxL} on screen (max seen ${run.maxZoomSeen})`);
    await writeFile(join(dir, 'run.json'), JSON.stringify(run) + '\n');
    return run;
  } finally { await ctx.close(); }
}

const fmt = v => v == null ? '-' : String(v);
export function summarize(runs) {
  const L = [];
  for (const r of runs) {
    if (r.error) { L.push(`${r.label}: ERROR ${r.error}`, ''); continue; }
    const a = r.after, w = r.worst;
    L.push(`${r.label}  nav(ms) commit ${fmt(r.nav.commit)} fcp ${fmt(r.nav.fcp)} dcl ${fmt(r.nav.dcl)} load ${fmt(r.nav.load)} | troll ${fmt(r.nav.trollStart)}..${fmt(r.nav.trollEnd)} | worst blank ${w ? `${w.blank}% (excess ${w.excess}%) at ${w.tMs} ms zoom ${w.zoom}` : '-'} | blank screen (excess >=50%) ${r.blankTime.over50Ms} ms, >=10% ${r.blankTime.over10Ms} ms, first content ${fmt(r.blankTime.firstContentMs)} ms after commit | rAF p95/max ${fmt(r.rafP95)}/${fmt(r.rafMax)} ms | max zoom seen ${r.maxZoomSeen} | frames cast ${r.frames.cast} film ${r.frames.film} (${r.frames.filmWidth} px, p50 interval ${r.frames.filmIntervalP50} ms)${r.warnings.length ? ' | WARN ' + r.warnings.join('; ') : ''}`);
    L.push(`  settled blank% by zoom: ${Object.entries(r.refs).map(([z, x]) => `${z}x ${x.blank}`).join(', ')}`);
    L.push('  step cyc  zoom  hold  in->frame blank%max excess%max ms>=10%/50% text1st/ready  art1st/ready  crisp  raster(done ms/tasks/cut) rAFp95/max  loading at step');
    for (const s of r.steps) L.push(`  ${String(s.i).padStart(4)} ${String(s.cycle).padStart(3)}  ${(s.from + '>' + s.to).padEnd(5)} ${String(s.hold).padStart(4)}  ${fmt(s.inputToFrameMs).padStart(8)}  ${fmt(s.blankMax).padStart(8)}  ${fmt(s.excessMax).padStart(9)}  ${(s.blank10Ms + '/' + s.blank50Ms).padStart(11)}  ${(fmt(s.textFirstMs) + '/' + fmt(s.textReadyMs)).padStart(13)} ${(fmt(s.artFirstMs) + '/' + fmt(s.artReadyMs)).padStart(13)} ${fmt(s.crispMs).padStart(6)}  ${(fmt(s.raster.doneMs) + '/' + s.raster.tasks + (s.raster.cutByNextStep ? '/cut' : '')).padStart(18)}  ${(fmt(s.rafP95) + '/' + fmt(s.rafMax)).padStart(11)}  net ${s.loading.net}${s.loading.urls.length ? ' [' + s.loading.urls.join(' ') + ']' : ''} ${s.loading.dom ? (s.loading.dom.busy ? 'dom busy' : s.loading.dom.error ? 'dom n/a' : `imgs ${s.loading.dom.imgsPending}/${s.loading.dom.imgs} fonts ${s.loading.dom.fonts}`) : ''} dec ${s.decodes.runningAtStart}`);
    L.push(`  after troll: in flight ${a.inflightAtEnd.length} [${a.inflightAtEnd.join(' ')}] started after ${a.startedAfterEnd.length}${a.startedAfterEnd.length ? ' [' + a.startedAfterEnd.join(' ') + ']' : ''} still loading at settle end ${a.inflightAtSettleEnd.length} | last request ${fmt(a.lastRequestEndMs)} decode +${fmt(a.lastDecodeEndMs)} raster +${fmt(a.lastRasterEndMs)} ms | load ${fmt(a.loadMs)} ms | fonts ${a.dom?.fonts ?? '?'} | final zoom-out text ${fmt(a.finalStep.textFirstMs)}/${fmt(a.finalStep.textReadyMs)} art ${fmt(a.finalStep.artReadyMs)} crisp ${fmt(a.finalStep.crispMs)} ms | last settled second: ${a.idleWork.join(', ') || 'idle'}`);
    for (const m of r.worstMoments) L.push(`  worst ${m.kind}: t=${m.tMs} ms step ${m.step} ${m.kind === 'blank' ? `zoom ${m.zoom} blank ${m.blank}% excess ${m.excess}% ${m.frame}` : `gap ${m.gapMs} ms`} | ${m.causes.join(', ')} | net ${m.netInflight.length}`);
    L.push('');
  }
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const o = browserToolCLI({base: {type: 'string'}, routes: {type: 'string', default: 'optimized,optimized-taste,optimized-mobile-next'}, envs: {type: 'string', default: '1424x820@2,1365x768@1,375x812@3t'},
    levels: {type: 'string', default: '2,3,5'}, 'pinch-levels': {type: 'string', default: '5'}, cycles: {type: 'string', default: '4'}, hold: {type: 'string', default: '800'}, speedup: {type: 'string', default: '2'},
    jitter: {type: 'string', default: '0.2'}, seed: {type: 'string', default: '1'}, settle: {type: 'string', default: '4000'}, triggers: {type: 'string', default: 'commit'}, 'touch-triggers': {type: 'string', default: 'commit,dcl'},
    'touch-cpu': {type: 'string', default: '4,6'}, 'pinch-speed': {type: 'string', default: '800'}, 'ref-settle': {type: 'string', default: '2500'}, 'keep-frames': {type: 'boolean'}, marker: {type: 'string'}, out: {type: 'string'}},
  'Zoom-on-load troll: zoom to the maximum at commit and straight back out, N cycles at increasing speed (ctrl zoom on desktop, pinch on phone); per-frame blank fraction, text/art/crisp arrival per zoom step, frame cadence and what is still loading. Without --base an owned loopback preview of HW_SITE_ROOT/site is used.');
  const num = (k, lo, hi, v = o[k]) => { const n = Number(v); if (v === '' || !Number.isFinite(n) || n < lo || n > hi) throw Error(`--${k} must be a number in ${lo}..${hi}`); return n; };
  const list = (k, lo, hi) => o[k].split(',').map(v => num(k, lo, hi, v.trim()));
  const names = (k, ok) => { const a = o[k].split(',').map(s => s.trim()); if (!a.length || a.some(s => !ok(s))) throw Error(`--${k} has an invalid entry: ${o[k]}`); return a; };
  if (o.base !== undefined && (!/^https?:\/\//.test(o.base) || !isLocalUrl(o.base))) throw Error('--base must be a loopback http(s) URL (zero third-party traffic)');
  const routes = names('routes', s => /^[a-z0-9-]+$/i.test(s)), envs = o.envs.split(',').map(s => parseEnv(s.trim()));
  const trig = s => s === 'commit' || s in LIFE, triggers = names('triggers', trig), touchTriggers = names('touch-triggers', trig);
  const cfg0 = {levels: list('levels', 1.1, 5), pinchLevels: list('pinch-levels', 1.1, 5), cycles: num('cycles', 1, 12), hold: num('hold', 16, 10000), speedup: num('speedup', 1, 4), jitter: num('jitter', 0, .9),
    seed: num('seed', 0, 2 ** 31), settle: num('settle', 0, 60000), pinchSpeed: num('pinch-speed', 50, 20000), refSettle: num('ref-settle', 500, 20000), keepFrames: !!o['keep-frames']};
  const touchCpu = list('touch-cpu', 1, 20);
  const plan = [];
  for (const route of routes) for (const env of envs) for (const trigger of env.touch ? touchTriggers : triggers) for (const cpu of env.touch ? touchCpu : [1])
    plan.push({...cfg0, route, env, trigger, cpu, marker: o.marker || markerFor(route), label: `${route}-${env.w}x${env.h}@${env.dpr}${env.touch ? '-touch' : ''}-${trigger}-cpu${cpu}`});
  const OUT = resolve(o.out || process.env.HW_OUT);
  await mkdir(OUT, {recursive: true});
  const fx = await browserFixture({runTimeoutMs: plan.length * 5 * 60000 + 120000});
  const base = (o.base || fx.base).replace(/\/$/, ''), runs = [];
  const flush = () => Promise.all([writeFile(join(OUT, 'report.json'), JSON.stringify({base, plan: plan.map(p => p.label), runs: runs.map(r => ({...r, timeline: undefined, steps: undefined}))}, null, 1) + '\n'), writeFile(join(OUT, 'summary.txt'), summarize(runs))]);
  try {
    for (const cfg of plan) {
      const fs = await statfs(OUT); if (fs.bavail * fs.bsize < 5e9) throw Error(`disk has ${r1(fs.bavail * fs.bsize / 1e9)} GB free (< 5 GB): stopping before ${cfg.label}`);
      cfg.url = `${base}/${cfg.route}/`;
      fx.runtime.step('troll ' + cfg.label);
      console.log(`=== ${cfg.label} ${cfg.url}`);
      const run = await trollRun(fx, cfg, OUT);
      runs.push(run); await flush();
      console.log(summarize([run]).split('\n').filter(l => !/^ {2}\s*\d+ /.test(l)).join('\n'));
    }
  } catch (e) { console.error(e.stack || e.message); process.exitCode ||= 1; runs.push({label: 'aborted', error: e.message}); }
  finally {
    try { await fx.close(); } catch (e) { console.error('cleanup: ' + e.message); process.exitCode ||= 1; }
    await flush(); console.log(`report ${join(OUT, 'report.json')}\nsummary ${join(OUT, 'summary.txt')}`);
  }
}
