// Real Android Chrome checks on a fresh run-owned emulator over adb + CDP (loopback-only).
// Use node tools/device-session.mjs android-run --avd hw_budget --base http://127.0.0.1:8766 --out DIR.
// The controller owns the lease, unique forward, reverse, Chrome setup and emulator lifetime.
// Screens via `adb exec-out screencap`; input via `adb shell input` (real OS touch path); measurement via an in-page rAF/LoAF probe over CDP.
// Network guard: context.route blocks every non-loopback request (tools/browser-test-lib createGuard), emulator Wi-Fi/data are off as well.
import {ensureToolRuntime} from './tool-runtime.mjs';
import {DeviceSession,androidFrameStats} from './device-session.mjs';
import {normalizeAndroidPlan} from './device-route-plan.mjs';
import {randomUUID} from 'node:crypto';
import {createGuard,managedConnectOverCDP,isLocalUrl} from './browser-test-lib.mjs';
import {chromium} from './browser-deps.mjs';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';

const {values:o}=parseArgs({options:{help:{type:'boolean',short:'h'},serial:{type:'string'},lease:{type:'string'},cdp:{type:'string'},out:{type:'string'},routes:{type:'string'},parts:{type:'string'},base:{type:'string',default:'http://127.0.0.1:8766'}}});
if(o.help){console.log('Usage: node tools/android-check.mjs --serial emulator-N --lease OWNED_RUN_LEASE --cdp LOOPBACK --out DIR [--routes ROUTES] [--parts shots,interact,abuse,fling]\nUse tools/device-session.mjs android-run to acquire a fresh emulator. Phone interact/abuse is unsupported; explicit shots/fling are diagnostic only.');process.exit(0);}
let plan;try{plan=normalizeAndroidPlan(o);}catch(error){if(error.code!=='HW_DEVICE_EVIDENCE_UNSUPPORTED')throw error;console.error(error.message);process.exit(error.exitCode);}
o.base=plan.origin;o.routes=plan.routes.join(',');o.parts=plan.parts.join(',');console.log('[Android exact URLs] '+JSON.stringify(plan));
if(!o.serial||!o.lease||!o.cdp||!o.out||!isLocalUrl(o.cdp)||!isLocalUrl(o.base))throw Error('Exact --serial, owned --lease, loopback --cdp/--base and --out are required');
const parts=new Set(o.parts.split(','));for(const part of parts)if(!['shots','interact','abuse','fling'].includes(part))throw Error('Unknown Android part '+JSON.stringify(part));
if(!o.routes.split(',').every(r=>/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(r)))throw Error('Invalid route path');
// part "fling" (tools/diagnostics/fling-blank-probe.mjs flingProbe): HW_FLING_VARIANTS='{"name":"<css or empty>",...}' adds CSS ablations per route
const flingVariants=process.env.HW_FLING_VARIANTS?JSON.parse(process.env.HW_FLING_VARIANTS):{base:''};
if(!flingVariants||typeof flingVariants!=='object'||!Object.keys(flingVariants).length||!Object.entries(flingVariants).every(([k,v])=>/^[a-z0-9-]+$/.test(k)&&typeof v==='string'))throw Error('HW_FLING_VARIANTS must map lower-case names to CSS strings');
const shotWaitMs=Number(process.env.HW_SHOT_WAIT_MS??12000);if((process.env.HW_SHOT_WAIT_MS!==undefined&&!process.env.HW_SHOT_WAIT_MS.trim())||!Number.isFinite(shotWaitMs)||shotWaitMs<0||shotWaitMs>30000)throw Error('HW_SHOT_WAIT_MS must be finite in0..30000; default12000 preserves the observed10s GPU settle');
const runtime=ensureToolRuntime({name:'owned Android scenarios',runTimeoutMs:30*60000});await runtime.ready;
const session=new DeviceSession(runtime),lease=await session.ownedAndroid(o.lease);if(lease.serial!==o.serial)throw Error('Lease serial differs from requested serial');
const OUT=resolve(o.out);
const FRAGS = ['top', 'about', 'work', 'gatherings', 'news', 'network', 'support'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const adb = (...a) => session.adb(o.serial,...a);
// swipe coordinates below are written for 1080x2400 (hw_pixel); scale them to the attached screen (hw_budget is 720x1600)
const [SW, SH] = (await adb('shell', 'wm','size')).toString().match(/(\d+)x(\d+)/).slice(1).map(Number);
const scaleSwipes = cmd => cmd.replace(/input swipe (\d+) (\d+) (\d+) (\d+)/g, (m, a, b, c, d) => `input swipe ${Math.round(a * SW / 1080)} ${Math.round(b * SH / 2400)} ${Math.round(c * SW / 1080)} ${Math.round(d * SH / 2400)}`);
const sh = async cmd => (await adb('shell', scaleSwipes(cmd))).toString();
const cap = async file => writeFileSync(file,await session.call('adb',['-H','127.0.0.1','-P',String(session.serverPort),'-s',o.serial,'exec-out','screencap','-p'],{encoding:null}));
const pct = (a, q) => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : 0;
const r1 = x => Math.round(x * 10) / 10;

const PROBE = `(()=>{if(window.__hw)return;const P=window.__hw={err:[],loaf:[],frames:[],sy:[],run:false,down:[]};
addEventListener('error',e=>P.err.push(String(e.message)),true);addEventListener('unhandledrejection',e=>P.err.push('rejection '+String(e.reason)));
addEventListener('pointerdown',e=>P.down.push({x:e.clientX,y:e.clientY,t:performance.now()}),true);
try{new PerformanceObserver(l=>{if(P.run)for(const e of l.getEntries())P.loaf.push({t:e.startTime,d:e.duration,blocking:e.blockingDuration,s:e.scripts.map(s=>({d:s.duration,u:(s.sourceURL||'').split('/').pop(),f:s.sourceFunctionName,inv:s.invoker,forced:s.forcedStyleAndLayoutDuration}))})}).observe({type:'long-animation-frame'})}catch{}
P.begin=()=>{Object.assign(P,{startMs:performance.now(),frames:[],sy:[],loaf:[],run:true});const f=t=>{if(!P.run)return;P.frames.push(t);P.sy.push(scrollY);requestAnimationFrame(f);};requestAnimationFrame(f);};
P.end=()=>{P.run=false;return {startMs:P.startMs,endMs:performance.now(),frames:P.frames,sy:P.sy,loaf:P.loaf,err:P.err.splice(0)};};})();`;

// Main-thread rAF cadence; this is not a physical display/compositor frame measurement.
function stats(w) {
  const frame=androidFrameStats(w),d=frame.intervals;
  const loafTop = {};
  for (const l of w.loaf) for (const s of l.s) { const k = `${s.u}:${s.f || s.inv}`; loafTop[k] = r1((loafTop[k] || 0) + s.d); }
  return {frames: w.frames.length,intervalCount:d.length,frameEvidence:frame.evidence,p50: r1(pct(d, .5)), p95: r1(pct(d, .95)), max: r1(Math.max(0, ...d)), over25: d.filter(x => x > 25).length, over50: d.filter(x => x > 50).length,
    loaf: w.loaf.length, loafMax: r1(Math.max(0, ...w.loaf.map(l => l.d))), loafScripts: Object.entries(loafTop).sort((a, b) => b[1] - a[1]).slice(0, 5), errors: w.err,
    budget: pct(d, .95) < 25 && Math.max(0, ...d) <= 50 ? 'PASS' : 'MISS'};
}
// longest run of frames with unchanged scrollY strictly between the start and end of a scroll (a visible "pause")
function longestStall(w) {
  let best = 0, start = null;
  for (let i = 1; i < w.sy.length; i++) {
    const moving = w.sy[i] !== w.sy[i - 1], mid = w.sy[i] > 0 && w.sy[i] < Math.max(...w.sy);
    if (!moving && mid) { start ??= w.frames[i - 1]; best = Math.max(best, w.frames[i] - start); } else start = null;
  }
  return r1(best);
}

await adb('shell','input','keyevent','224');
await adb('shell','am','start','-n','com.android.chrome/com.google.android.apps.chrome.Main');
// Android Chrome 124 never answered Target.createBrowserContext: browser.newContext() hung for the whole 30-min run (2026-10-12, run
// heartwood-run-MvKbMo) while the AVD's restored desktop tab stayed in front. So the probe opens a NEW tab of its own in the default context
// (Target.createTarget brings it to the front), checks it is the requested page (assertRoute) and closes it at the end.
let defaultContext=null;
const browserType={connectOverCDP:async(endpoint,options)=>{const b=await chromium.connectOverCDP(endpoint,{...options,noDefaults:false});defaultContext=b.contexts()[0]||null;return b;}};
const browser=await managedConnectOverCDP(o.cdp,{runtime,browserType}),guard=createGuard({route:true});
if(!defaultContext)throw Error('Android Chrome exposed no default browser context over CDP');
const ctx=defaultContext;await guard.guardContext(ctx);await ctx.addInitScript(PROBE);
const page=await ctx.newPage();
// CSP bypass only for the fling part's CSS ablations (it does not change rendering); the session stays open so the setting holds
const cspSession=parts.has('fling')?await ctx.newCDPSession(page):null;if(cspSession)await cspSession.send('Page.setBypassCSP',{enabled:true});
const errors = [];
page.on('pageerror', e => errors.push('pageerror ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ' ' + m.text()); });
await page.bringToFront();
const report = {measurement:'main-thread rAF cadence including start/end gaps; independent native screenshots/recording, no physical frame-rate claim',plan,scope:plan.scope,fullPhoneJourneys:false,device:o.serial,ownedLease:lease,chrome: browser.version(), routes: {}};

const ev = (fn, arg) => page.evaluate(fn, arg);
const begin = () => ev(() => window.__hw.begin());
const end = () => ev(() => window.__hw.end());
const rest = () => ev(() => { const d = document.getElementById('dialog'); return {dialogHidden: d?.hidden, state: window.leafLift?.state?.(), busy: window.leafLift?.busy?.(), lifted: document.querySelectorAll('.is-lifted,.is-away').length, lit: document.querySelectorAll('.is-lit').length, flyers: document.querySelectorAll('#lift .flyer').length, sx: scrollX, overflowX: document.documentElement.scrollWidth - innerWidth, url: location.pathname + location.hash}; });
const atRest = r => r.dialogHidden && (r.state === 'idle' || r.state === undefined) && !r.busy && !r.lifted && !r.lit && !r.flyers && !r.sx && r.overflowX <= 0;
// The page under test must be OUR tab, in front, at the requested route, and report ready: Chrome restores the AVD's last tabs (once a
// desktop page sat in front of the probe's tab and a "phone" run tested nothing). Judged from the page over CDP, never the screen; bounded.
async function assertRoute(url) {
  const expected = new URL(url),want=expected.pathname,phone=plan.urls.find(r=>new URL(r.url).pathname===want)?.kind==='phone';
  await page.bringToFront();
  try {
    await page.waitForFunction(([want, origin, phone]) => location.origin === origin && location.pathname === want && document.readyState === 'complete' && document.visibilityState === 'visible'
      && (phone ? (!!document.querySelector('.climb .tier__art') && !!document.querySelector('.tree .tags') && !!document.querySelector('#hw-records') && !document.querySelector('.stage')) : !!document.querySelector('.stage .tree')), [want, expected.origin, phone], {timeout: 30000, polling: 250});
    console.log('[Android page ready] '+JSON.stringify({expected:url,...await ev(()=>({url:location.href,path:location.pathname,ready:document.readyState,visibility:document.visibilityState,phoneBuild:!!document.querySelector('.climb .tier__art'),desktopStage:!!document.querySelector('.stage')}))}));
  } catch {
    const at = await ev(() => ({path: location.pathname, ready: document.readyState, visibility: document.visibilityState, phoneBuild: !!document.querySelector('.climb .tier__art'), desktopStage: !!document.querySelector('.stage')})).catch(e => ({error: String(e)}));
    throw Error(`not the requested page after 30 s: wanted ${want}${phone ? ' (phone build)' : ''}, the probe's tab reports ${JSON.stringify(at)}`);
  }
}
async function load(url) {
  await sleep(300);   // let a pending Back navigation settle first
  await page.goto('about:blank').catch(() => sleep(800));
  await page.goto(url, {waitUntil: 'load'}).catch(async () => { await sleep(1000); await page.goto(url, {waitUntil: 'load'}); });
  await assertRoute(url);
  await page.waitForFunction(() => (window.leafLift && document.querySelector('.tree button.leaf[data-leaf]')) || document.querySelector('.climb'), null, {timeout: 20000}).catch(() => {});
  await sleep(3500);   // canopy entrance
}

// screen mapping: device px = css * dpr + top; the content bottom edge is fixed, the top moves when Chrome's toolbar hides
let bottomPx = null;
async function calibrate() {
  await ev(() => scrollTo({top: 0, behavior: 'instant'})); await sleep(400);
  const t = await ev(() => { const h = document.querySelector('h1'); const r = h.getBoundingClientRect(); window.__hw.down.length = 0; return {x: r.left + 20, y: r.top + r.height / 2, ih: innerHeight, dpr: devicePixelRatio}; });
  const guessTop = 2400 - 63 - t.ih * t.dpr;   // only used for the calibration tap on the (inert) heading
  const [scrW, scrH] = [SW, SH];
  // gesture-nav bar height differs per density (63 px @420 dpi, 48 px @320 dpi); try a few until the page sees the tap
  let gy, gx = Math.round(t.x * t.dpr), d = null;
  for (const nav of [Math.round(63 * t.dpr / 2.625), 63, 48, 0, 126]) {
    gy = Math.round(t.y * t.dpr + (scrH - nav - t.ih * t.dpr));
    await adb('shell', 'input', 'tap', String(gx), String(gy)); await sleep(600);
    d = await ev(() => window.__hw.down.at(-1));
    if (d) break;
  }
  if (!d) throw Error('calibration tap not seen by the page');
  const top = gy - d.y * t.dpr; bottomPx = top + t.ih * t.dpr;
  return {top: r1(top), bottomPx: r1(bottomPx), dpr: t.dpr, scrW, scrH, guessTop: r1(guessTop)};
}
async function toDevice(x, y) { const {ih, dpr} = await ev(() => ({ih: innerHeight, dpr: devicePixelRatio})); return [Math.round(x * dpr), Math.round(y * dpr + bottomPx - ih * dpr)]; }
const visible = sel => ev(sel => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, t = document.elementFromPoint(x, y); return {x, y, w: r.width, h: r.height, hit: !!t && (e.contains(t) || t.contains(e)), ext: !!t?.closest('a[href]') && t.closest('a[href]').origin !== location.origin}; }).filter(r => r.w && r.hit && !r.ext && r.y > 30 && r.y < innerHeight - 30 && r.x > 4 && r.x < innerWidth - 4), sel);
async function tapSel(sel, i = 0) { const rs = await visible(sel); if (!rs.length) return null; const r = rs[i % rs.length]; const [x, y] = await toDevice(r.x, r.y); await adb('shell', 'input', 'tap', String(x), String(y)); return r; }
const scrollToSel = sel => ev(sel => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); scrollTo({top: Math.max(0, scrollY + r.top + r.height / 2 - innerHeight / 2), behavior: 'instant'}); }, sel);
const toTop = () => ev(() => scrollTo({top: 0, behavior: 'instant'}));
const swipe = async (y1, y2, ms) => await sh(`input swipe 540 ${y1} 540 ${y2} ${ms}`);
const dialogOpen = () => page.waitForFunction(() => !document.getElementById('dialog').hidden, null, {timeout: 3000, polling: 50}).then(() => true, () => false);

try{
for (const route of o.routes.split(',')) {
  const R = report.routes[route] = {}, dir = resolve(OUT, route), url = `${o.base}/${route}/`;
  mkdirSync(dir, {recursive: true});
  if (parts.has('shots')) {
    R.shots = {};
    for (const f of FRAGS) {
      await load(url + (f === 'top' ? '' : '#' + f));
      const pos = await ev(f => { const e = f === 'top' ? null : document.getElementById(f); return {sy: Math.round(scrollY), target: e ? Math.round(e.getBoundingClientRect().top) : 0}; }, f);
      pos.landed = Math.abs(pos.target) < 120;   // deep link put the section at the top (header ~68 px)
      if (!pos.landed) { await ev(f => document.getElementById(f).scrollIntoView({block: 'start', behavior: 'instant'}), f); }
      await sleep(shotWaitMs);   // the emulator's GPU raster lags the page by up to ~10 s after a jump (present-check.mjs) (earlier sheets showed the top while scrollY was already at the section)
      pos.atCapture = await ev(f => f === 'top' ? Math.round(scrollY) : Math.round(document.getElementById(f).getBoundingClientRect().top), f);
      await assertRoute(url+(f==='top'?'':'#'+f));pos.observedURL=await ev(()=>location.href);
      await cap(resolve(dir, `${f}.png`)); R.shots[f] = pos;
    }
  }
  if (parts.has('fling')) {   // a fast fling top -> bottom -> top right after load, per CSS variant (tools/diagnostics/fling-blank-probe.mjs)
    const {flingProbe} = await import('./diagnostics/fling-blank-probe.mjs');
    const cdp = await ctx.newCDPSession(page);
    R.fling = {};
    for (const [name, css] of Object.entries(flingVariants)) {
      const loadFling = async () => { await page.goto('about:blank').catch(() => sleep(800)); await page.goto(url, {waitUntil: 'load', timeout: 90000}); await assertRoute(url);
        if (css) await page.addStyleTag({content: css}); await ev(() => document.fonts.ready.then(() => true)); };
      try { R.fling[name] = {css: css || null, ...await flingProbe({page, cdp, load: loadFling, speed: Number(process.env.HW_FLING_SPEED || 12000), waitMs: 500, framesDir: resolve(dir, 'fling-' + name), log: m => console.log(route + ' ' + name + ' ' + m.slice(0, 600))})}; }
      catch (e) { R.fling[name] = {error: String(e.message || e).split('\n')[0],unsupported:e.code==='HW_FLING_REFERENCE_UNSUPPORTED',referenceProof:e.proof}; }
    }
    await cdp.detach().catch(() => {});
  }
  if (parts.has('interact')) {
    const I = R.interact = {};
    await load(url); I.calibration = await calibrate();
    // tap targets (CSS px)
    I.tapTargets = await ev(() => Object.fromEntries(Object.entries({leaves: '.tree button.leaf[data-leaf]', chips: '#key-chips .chip', spores: '.spore[data-item]', nav: '#nav a, #nav button, .nav button'}).map(([k, s]) => { const r = [...document.querySelectorAll(s)].map(e => e.getBoundingClientRect()).filter(r => r.width); const m = r.map(r => Math.min(r.width, r.height)); return [k, {n: r.length, minSide: Math.round(Math.min(...m)), under24: m.filter(x => x < 24).length, under44: m.filter(x => x < 44).length}]; })));
    // fling to bottom, then straight back to top (screenrecorded): is there a pause on scroll-back?
    // pass 1 measures (no recorder: the emulator's software screenrecord encoder competes for the same CPU/GPU); pass 2 records the same gestures for eyeballing
    const H = await ev(() => document.documentElement.scrollHeight - innerHeight);
    const flingPass = async () => {
      await toTop(); await sleep(800); await begin();
      for (let i = 0; i < 30 && (await ev(() => scrollY)) < H - 5; i++) await swipe(1900, 300, 60);
      const down = await end(); await sleep(400); await begin();
      for (let i = 0; i < 30 && (await ev(() => scrollY)) > 0; i++) await swipe(500, 2100, 60);
      await sleep(1500); const up = await end();
      return {down, up};
    };
    const m = await flingPass();
    I.flingDown = {...stats(m.down), stallMs: longestStall(m.down)};
    I.flingUp = {...stats(m.up), stallMs: longestStall(m.up), heroRunningAfter: await ev(() => document.getAnimations().filter(a => a.playState === 'running').length)};
    const remote='/sdcard/heartwood-'+runtime.runId+'-'+randomUUID()+'.mp4';
    // Host adb is a foreground, registered child. Remote recording is bounded
    // at20s and belongs to this fresh read-only emulator, whose exit reaps it.
    const recorder=await runtime.spawn('adb',['-H','127.0.0.1','-P',String(session.serverPort),'-s',o.serial,'shell','screenrecord','--time-limit','20','--bit-rate','4000000',remote],{label:'owned Android foreground recording',stdio:['ignore','pipe','pipe']});
    recorder.stdout.resume();recorder.stderr.resume();
    const rec=await flingPass();I.flingRecordedPass={downStallMs:longestStall(rec.down),upStallMs:longestStall(rec.up),upMax:stats(rec.up).max};
    const recorded=await runtime.deadline('screenrecord actual completion',()=>recorder.toolDone,{timeoutMs:25000});if(recorded.code!==0)throw Error('Owned screenrecord failed '+JSON.stringify(recorded));
    await adb('pull',remote,resolve(dir,'fling-down-up.mp4'));
    const backHome = async tag => { const u = page.url(); if (u.startsWith(url)) return null; await load(url); await calibrate().catch(() => {}); return `${tag}: Back left the page (now ${u})`; };
    // leaf -> dialog -> back key
    await toTop(); await sleep(600);
    const leaf = await tapSel('.tree button.leaf[data-leaf]', 17);
    I.leaf = {tapped: !!leaf, size: leaf && [r1(leaf.w), r1(leaf.h)], dialogOpened: await dialogOpen()};
    await sleep(900); await cap(resolve(dir, 'leaf-dialog.png'));
    await adb('shell', 'input', 'keyevent', '4'); await sleep(1500);
    I.leaf.backLeftPage = await backHome('leaf');
    I.leaf.afterBack = await rest(); I.leaf.closedByBack = !I.leaf.backLeftPage && I.leaf.afterBack.dialogHidden && I.leaf.afterBack.url.startsWith(`/${route}/`);
    // filter chip
    await scrollToSel('#key-chips'); await sleep(500);
    const chipSel = '#key-chips .chip[data-filter]:not([data-filter="all"])';
    const chip = await tapSel(chipSel, 1); await sleep(900);
    I.chip = {tapped: !!chip, state: await ev(() => ({pressed: [...document.querySelectorAll('#key-chips .chip[aria-pressed="true"]')].map(c => c.dataset.filter), filtered: document.querySelectorAll('.is-filtered').length}))};
    await cap(resolve(dir, 'chip-filter.png'));
    await tapSel('#key-chips .chip[data-filter="all"]'); await sleep(600);
    // member circle in the network
    await scrollToSel('#net'); await sleep(900);
    const spore = await tapSel('.spore[data-item]', 5);
    I.spore = {tapped: !!spore, size: spore && [r1(spore.w), r1(spore.h)], dialogOpened: await dialogOpen()};
    await sleep(900); await cap(resolve(dir, 'spore-dialog.png'));
    await adb('shell', 'input', 'keyevent', '4'); await sleep(1500);
    I.spore.backLeftPage = await backHome('spore');
    I.spore.afterBack = await rest();
    if (I.spore.backLeftPage) { await scrollToSel('#net'); await sleep(900); }
    // near-miss tap in the network stage (taste zone 3 on desktop: hover-preview, then click opens): beside a circle, not on one; tapped twice
    I.media = await ev(() => ({hover: matchMedia('(hover: hover)').matches, anyHover: matchMedia('(any-hover: hover)').matches, coarse: matchMedia('(pointer: coarse)').matches}));
    const near = await ev(() => { const st = document.querySelector('#net .net__stage'); if (!st) return null; for (const s of document.querySelectorAll('#net .spore')) { const r = s.getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 80) continue; const x = r.right + 8, y = r.top + r.height / 2, t = document.elementFromPoint(x, y); if (t && st.contains(t) && !t.closest('.spore,[data-open]')) return {x, y, d: Math.round(r.width), hit: t.tagName.toLowerCase() + '.' + [...t.classList].join('.')}; } return null; });
    if (near) {
      const [nx, ny] = await toDevice(near.x, near.y); const snapOrOpen = () => ev(() => ({snap: document.querySelectorAll('.hw-taste-snap').length, lit: document.querySelectorAll('.is-lit,.hw-taste-lit').length, open: !document.getElementById('dialog').hidden}));
      await adb('shell', 'input', 'tap', String(nx), String(ny)); await sleep(700); const first = await snapOrOpen();
      await adb('shell', 'input', 'tap', String(nx), String(ny)); await sleep(900); const second = await snapOrOpen();
      I.nearMissTap = {at: near, first, second};
      if (second.open) { await adb('shell', 'input', 'keyevent', '4'); await sleep(1200); I.nearMissTap.backLeftPage = await backHome('near-miss'); }
    } else I.nearMissTap = 'no free point beside a visible circle';
    I.errors = errors.splice(0);
  }
  if (parts.has('abuse')) {
    const X = R.abuse = {};
    // a Back press with no dialog open is a real history navigation: record it, reload and carry on (otherwise the probe's context is gone)
    const win = async (name, fn) => { await begin(); const t = Date.now(); try { await fn(); } catch (e) { X[name] = {error: String(e)}; } await sleep(1000);
      let w = null; if (page.url().startsWith(url)) w = await end().catch(() => null);
      if (!w) { X[name] = {...(X[name] || {}), leftPage: page.url(), ms: Date.now() - t, errors: errors.splice(0)}; await load(url); await calibrate().catch(() => {}); return; }
      await sleep(1500); const r = page.url().startsWith(url) ? await rest().catch(() => null) : null;
      X[name] = {...(X[name] || {}), ...stats(w), stallMs: longestStall(w), ms: Date.now() - t, rest: r, atRest: !!r && atRest(r)};
      if (!r) { X[name].leftPage = page.url(); await load(url); await calibrate().catch(() => {}); return; }   // a late Back navigation (after the window closed)
      if (!X[name].atRest) await cap(resolve(dir, `abuse-${name}-not-at-rest.png`)); };
    await load(url); await calibrate();
    await win('native-fling-flips', async () => { await sh('for i in 1 2 3 4 5 6 7 8; do input swipe 540 1900 540 300 40; input swipe 540 1900 540 300 40; input swipe 540 500 540 2000 40; done'); });
    await win('native-fling-bottom-top', async () => { await sh('for i in $(seq 1 12); do input swipe 540 2000 540 200 30; done; for i in $(seq 1 12); do input swipe 540 400 540 2200 30; done'); await sleep(1200); });
    await toTop(); await sleep(500);
    const lf = await visible('.tree button.leaf[data-leaf]'); const pts = [];
    for (const i of [3, 11, 29, 47, 63]) if (lf[i % lf.length]) pts.push(await toDevice(lf[i % lf.length].x, lf[i % lf.length].y));
    await win('native-leaf-back-spam', async () => { await sh(pts.concat(pts).map(([x, y]) => `input tap ${x} ${y}; sleep 0.25; input keyevent 4; sleep 0.1;`).join(' ')); await sleep(800); });
    await win('native-leaf-tap-spam', async () => { await sh(pts.concat(pts, pts).map(([x, y]) => `input tap ${x} ${y};`).join(' ')); await sleep(800); await adb('shell', 'input', 'keyevent', '4'); });
    await scrollToSel('#key-chips'); await sleep(500);
    const cs = await visible('#key-chips .chip'); const cp = []; for (const c of cs) cp.push(await toDevice(c.x, c.y));
    await win('native-chip-spam', async () => { await sh(cp.concat(cp, cp).map(([x, y]) => `input tap ${x} ${y};`).join(' ')); await sleep(600); if (cp[0]) await adb('shell', 'input', 'tap', String(cp[0][0]), String(cp[0][1])); });
    await scrollToSel('#net'); await sleep(800);
    const sp = (await visible('.spore[data-item]')).slice(0, 8); const spp = []; for (const s of sp) spp.push(await toDevice(s.x, s.y));
    await win('native-spore-back-spam', async () => { await sh(spp.map(([x, y]) => `input tap ${x} ${y}; sleep 0.3; input keyevent 4; sleep 0.1;`).join(' ')); await sleep(800); });
    await win('native-net-hswipe-during-vscroll', async () => { await sh('for i in 1 2 3 4 5 6; do input swipe 900 1200 150 1250 80 & input swipe 540 1700 540 900 120; wait; input swipe 150 1200 900 1150 80 & input swipe 540 900 540 1700 120; wait; done'); });
    // orientation flips (real rotation via the window manager)
    await win('native-orientation-flips', async () => { for (let i = 0; i < 6; i++) { await sh(`settings put system user_rotation ${i % 2 ? 0 : 1}`); await sleep(1300); } await sh('settings put system user_rotation 0'); await sleep(1500); });
    await calibrate().catch(() => {});
    // member finder: real IME (keyboard resize) + typing spam
    await scrollToSel('#group-find'); await sleep(600);
    const vvBefore = await ev(() => visualViewport.height);
    await win('native-finder-ime-typing', async () => {
      await tapSel('#group-find'); await sleep(1200);
      X.imeViewport = {before: r1(vvBefore), withKeyboard: r1(await ev(() => visualViewport.height)), focused: await ev(() => document.activeElement?.id)};
      for (const w of ['forest', 'river', 'coal', 'zzzz']) { await sh(`input text ${w}`); await sh('for i in 1 2 3 4 5 6; do input keyevent 67; done'); }
      await adb('shell', 'input', 'keyevent', '4'); await sleep(800);
    });
    await ev(() => { const f = document.getElementById('group-find'); if (f) { f.value = ''; f.dispatchEvent(new Event('input', {bubbles: true})); f.blur(); } });
    // background / foreground
    await toTop(); await sleep(500);
    const syB = await ev(() => scrollY);
    await win('native-background-foreground', async () => { for (let i = 0; i < 4; i++) { await adb('shell', 'input', 'keyevent', '3'); await sleep(1200); await sh('am start -n com.android.chrome/com.google.android.apps.chrome.Main >/dev/null'); await sleep(1500); } });
    X.bgScrollPreserved = (await ev(() => scrollY)) === syB;
    X.errors = errors.splice(0);
  }
}
report.networkBlocked=guard.blocked;report.failures=[];
const inspect=(value,path)=>{if(!value||typeof value!=='object')return;if(value.budget==='MISS'||value.passed===false||value.supported===false)report.failures.push(path+': failed/unsupported measured evidence');if(value.error)report.failures.push(path+': '+value.error);if(Array.isArray(value.errors)&&value.errors.length)report.failures.push(path+': page errors');if(value.atRest===false)report.failures.push(path+': did not settle');for(const [k,v]of Object.entries(value))if(k!=='ownedLease')inspect(v,path+'.'+k);};
inspect(report.routes,'routes');
for(const [route,R]of Object.entries(report.routes)){
 for(const [fragment,shot]of Object.entries(R.shots||{}))if(!shot.landed)report.failures.push(route+'.'+fragment+': deep-link did not land naturally');
 const I=R.interact;if(I){for(const key of ['leaf','spore'])if(!I[key]?.tapped||!I[key]?.dialogOpened||I[key]?.backLeftPage)report.failures.push(route+'.'+key+': real touch/open/Back coverage failed');if(I.leaf?.closedByBack!==true)report.failures.push(route+'.leaf: Back failed to close');if(!I.chip?.tapped)report.failures.push(route+'.chip: no filter tap');}
}
report.passed=report.failures.length===0;
mkdirSync(OUT, {recursive: true});
writeFileSync(resolve(OUT, `report-${o.parts.replace(/,/g, '-')}-${o.routes.replace(/,/g, '-')}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report,null,1));if(!report.passed)process.exitCode=1;
}catch(error){process.exitCode=process.exitCode||1;report.passed=false;report.runError=error.stack||error.message;mkdirSync(OUT,{recursive:true});writeFileSync(resolve(OUT,'failed-run.json'),JSON.stringify(report,null,2));console.error(error);}
finally{try{await page.close();}finally{await browser.close();}}
guard.assert();
if(Object.values(report.routes).some(R=>Object.values(R.abuse||{}).some(w=>w.error||w.budget==='MISS'||w.errors?.length)||R.interact?.errors?.length))process.exitCode=1;
