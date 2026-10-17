// Browser check of an explicit current public phone artifact; historical builds require --legacy-capture.
//   node tools/verify-mobile.mjs --site DIR [--source-root FORK] [--out DIR] [--quick]
// Chrome via the network-guarded fixture (loopback only; nothing may leave the machine). Exit 1 on any failure.
// Report: <out>/verify-report.json (with the artifact hash), screens in <out>/screens/.
import {mkdir, writeFile, readFile,lstat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {browserFixture,finishCDPTrace,browserToolCLI} from './browser-test-lib.mjs';
import {createRequire} from 'node:module';
import {mobileThemeSelection,mobileThemes,mobilePerformancePlan,phoneLagCoverage,mobileLayerEvidence,hasMobileTrace,mobileDrawEvidence,mobileFeedbackPass,mobileScrollEvidence,mobileForegroundPass,mobileOffscreenPass,tagProbe,tagFailures,maskClash,TAG_VIEWPORTS} from './mobile-acceptance.mjs';
import {phoneGestureBurst} from './mobile-abuse.mjs';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {pathToFileURL} from 'node:url';
import {phoneTargetOptions,admitPhoneTarget,verifyPhoneTargetUnchanged,judgePhoneObservation,judgePhoneResource,createPhoneJourneyScope,loadCurrentPhoneComposers} from './phone-target-admission.mjs';
import {beginTimingRun} from './timing-environment.mjs';
import {composeFreshPhone} from './fresh-phone-composition.mjs';
import {loadSharp} from './sharp-deps.mjs';

const root = resolve(import.meta.dirname, '..');
const options = browserToolCLI({site:{type:'string'},'source-root':{type:'string'},'legacy-capture':{type:'boolean'},out:{type:'string'},quick:{type:'boolean'},only:{type:'string'},theme:{type:'string'},'trace-burst':{type:'boolean'}},'Current public phone acceptance requires --site DIR; no archived autobuild is implicit. --source-root FORK binds source/mask. --theme day|night|both selects timing profiles (current default both; historical default Day). --only frames/fling expands to selected timing themes. --trace-burst records causal diagnostics, never timing acceptance. --legacy-capture explicitly labels old capture evidence.');
const targetOptions=phoneTargetOptions({auditRoot:root,site:options.site,sourceRoot:options['source-root'],legacyCapture:!!options['legacy-capture']});
const opt = n => options[n.slice(2)];
const OUT = resolve(root, opt('--out') || process.env.HW_OUT || 'output/playwright/review-mobile-build');
const quick = !!options.quick;
const timingTheme=options.theme??(targetOptions.mode==='historical'?'day':'both');
const timingThemes=mobileThemes(timingTheme);
if(targetOptions.mode==='historical'&&timingTheme!=='day')throw Error('Historical capture timing supports Day only; current Night timing requires explicit current --site');
const only = mobileThemeSelection(options.only,{quick,theme:timingTheme});
const BUDGET = {p95: 25, max: 50, tapFrames: 2, tapMs:34, dom: 1500, leakNodes: 0, leakListeners: 0};
const runtime=ensureToolRuntime({name:'phone verification',runTimeoutMs:30*60*1000});await runtime.ready;
const readInput=path=>readRegularInput(path,{runtime,timeoutMs:10000,maxBytes:8*1024*1024,encoding:null});
const directHarnessPaths=['verify-mobile.mjs','phone-target-admission.mjs','fresh-phone-composition.mjs','browser-test-lib.mjs','mobile-acceptance.mjs','mobile-abuse.mjs','tool-runtime.mjs','tool-operations.mjs','timing-environment.mjs','command-acceptance.mjs','diagnostics/fling-blank-probe.mjs',...(targetOptions.mode==='historical'?['build-mobile.mjs']:[])];
async function snapshotDirectHarness(){
 const rows=[];
 for(const path of directHarnessPaths){const file=resolve(import.meta.dirname,path),before=await lstat(file);if(!before.isFile()||before.isSymbolicLink())throw Error('Direct harness input must be regular: '+path);const bytes=await readInput(file),after=await lstat(file);if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('Direct harness input changed while reading: '+path);rows.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),identity:{dev:before.dev,ino:before.ino,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs}});}
 return rows;
}
const harnessBefore=await runtime.deadline('capture direct verifier/harness input epoch',snapshotDirectHarness,{timeoutMs:30000});
let site=targetOptions.site;
if(!site){const {buildMobile}=await import('./build-mobile.mjs');site=(await buildMobile()).out;} // explicit historical mode only
const currentComposers=targetOptions.mode==='current'?await loadCurrentPhoneComposers():[];
const admission=await runtime.deadline('admit complete explicit phone artifact against fresh current source',()=>admitPhoneTarget({...targetOptions,site,readInput,composers:currentComposers,composeReference:({sourceRoot})=>composeFreshPhone({sourceRoot,runtime})}),{timeoutMs:60000});
site=admission.site;
const manifest=admission.manifest;
const {matches,nearest,CATS,TIER_ID}=await import(pathToFileURL(admission.statePath).href);
if(typeof matches!=='function'||typeof nearest!=='function'||!Array.isArray(CATS)||!TIER_ID)throw Error('Admitted phone state helpers do not implement the required source contract');
await runtime.deadline('create phone capture output',()=>mkdir(join(OUT, 'screens'), {recursive:true}),{timeoutMs:10000});
const report = {artifact: manifest.artifact, site, scope:admission.mode==='historical'?'Historical capture journeys; not current phone acceptance':'Explicit public phone artifact journeys/absolute budgets after exact fresh current-source composition equality, in host Chromium emulation; physical presentation and historical asset generation require separate proof',inputIdentity:{mode:admission.mode,phonePrefix:admission.phonePrefix,manifests:admission.manifests,sourceRoot:admission.sourceRoot,sourceFiles:admission.sourceFiles,sourceOrigin:admission.sourceOrigin,admissionScope:admission.performanceAcceptance},observedPhones:[],started: new Date().toISOString(), loadavgAtStart: (await import('node:os')).loadavg(), measurementEnvironment:{mode:'untimed-functional-selection',timingIsolation:'NOT_ESTABLISHED',physicalPhone:false,physicalPresentation:false,platform:'Chromium viewport and CPU emulation on the host'}, checks: [], measures: {}, failures: []};
report.harnessInputs={before:harnessBefore,node:{version:process.version,execPath:process.execPath,versions:process.versions},limitations:['Observed direct local harness disk inputs and Node version only. Current admission separately proves selected served bytes/recipes match a fresh composition of the declared current source inputs. This does not prove pre-entry parser/cache bytes, full transitive harness/native binary/toolchain closure or historical asset generation. Full TA02 closure remains open.']};
report.measurementEnvironment.diagnosticTracing=!!options['trace-burst'];
report.journeyCleanup=[];report.browserErrors=[];
report.performanceCoverage={day:{status:'NOT_RUN',executedFrameAndFlingJourneys:[]},night:{status:'NOT_RUN',executedFrameAndFlingJourneys:[]},fullNightLagAcceptance:false};
const timingNames=['arrival',...mobilePerformancePlan({quick,theme:timingTheme}).map(row=>row.name),...timingThemes.map(theme=>(theme==='night'?'night ':'')+'fling')];
const timed=only===null||timingNames.some(name=>only.some(prefix=>name.startsWith(prefix)));
const timing=timed?await beginTimingRun(runtime,{traced:!!options['trace-burst']}):null;
report.timingObservations=[];
if(timing){report.measurementEnvironment={...timing.environment,platform:'Chromium viewport and CPU emulation on the host'};report.sleepPrevention=timing.sleepPrevention;report.timingObservations.push({phase:'start',environment:timing.environment});}
let performanceScope=null;
const ok = (name, pass, detail = {}) => { report.checks.push({name, pass: !!pass, ...performanceScope,...detail}); if (!pass) report.failures.push(name); console.log((pass ? 'PASS ' : 'FAIL ') + name + (Object.keys(detail).length ? ' ' + JSON.stringify(detail).slice(0, 300) : '')); };

const fixture=await browserFixture({runtime,siteRoot:site,runTimeoutMs:30*60*1000});
const fx={...fixture,base:fixture.base+admission.phonePrefix};
const expectedThemes=new WeakMap(),targetRequestIssues=new Set(),targetRequests=new Set(),observedLoads=[];
const journeys=createPhoneJourneyScope({browser:fx.browser,runtime,report,selected:only,loads:()=>observedLoads});
const newContext=fx.browser.newContext.bind(fx.browser);
fx.browser.newContext=async(...args)=>{
  const ctx=await newContext(...args),journey=journeys.captureContext(ctx);
  ctx.on('request',request=>{targetRequests.add(request.url());for(const issue of judgePhoneResource(admission,request.url(),{origin:fixture.base}))targetRequestIssues.add(issue);});
  ctx.on('page',page=>{
    const note=(kind,message)=>journeys.noteBrowserError({journey,kind,message,url:page.url()});
    page.on('pageerror',error=>note('pageerror',String(error)));page.on('console',message=>{if(message.type()==='error')note('console.error',message.text());});
  });
  // Shared fling diagnostics make their own contexts; retain the requested theme, not a redirect's observed theme.
  if(admission.mode==='current'&&args[0]?.colorScheme===undefined)ctx.on('page',page=>page.on('load',()=>{
    if(!page.url().startsWith(fixture.base+'/'))return;
    observedLoads.push(observeCurrentPhone(page,journey.startsWith('night ')?'night':'day').catch(error=>targetRequestIssues.add('positive phone load observation: '+error.message)));
  }));
  return ctx;
};
// A failed journey may continue only after its own contexts/CDP have closed successfully.
const block=async(name,fn,scope=null)=>{const start=report.failures.length,prior=performanceScope;performanceScope=scope?{...scope,journey:name}:null;try{await journeys.block(name,async()=>{if(timing&&scope)report.timingObservations.push({phase:'before',journey:name,environment:await timing.snapshot()});await fn();if(timing&&scope)report.timingObservations.push({phase:'after',journey:name,environment:await timing.snapshot()});});for(const failure of report.failures.slice(start))console.error('FAIL '+failure);}finally{performanceScope=prior;}};
const PHONES = {xs: {viewport: {width: 375, height: 812}, deviceScaleFactor: 3}, p402: {viewport: {width: 402, height: 874}, deviceScaleFactor: 3}};
async function phone(kind = 'xs', extra = {}) {
  const ctx = await fx.browser.newContext({...PHONES[kind], isMobile: true, hasTouch: true, colorScheme:'light', ...extra});
  const page = await ctx.newPage();
  expectedThemes.set(page,extra.colorScheme==='dark'?'night':'day');
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push(r.url()));
  const cdp = await ctx.newCDPSession(page);
  return {ctx, page, cdp, errors, requests};
}
const shot = (page, name, full = false) => page.screenshot({path: join(OUT, 'screens', name + '.png'), fullPage: full});
async function observeCurrentPhone(page,expectedTheme){
    const observed=await page.evaluate(()=>({url:location.href,theme:document.documentElement.dataset.hwTheme,phone:!!document.querySelector('.climb .tier__art')&&!!document.querySelector('.tree .tags')&&!!document.querySelector('#hw-records'),desktop:!!document.querySelector('.stage'),ready:document.readyState,visibility:document.visibilityState,resources:performance.getEntriesByType('resource').map(entry=>entry.name)}));
    const issues=judgePhoneObservation(admission,observed,{origin:fixture.base,expectedTheme});
    if(issues.length)throw Error('UNSUPPORTED current phone observation: '+issues.join('; '));
    report.observedPhones.push(observed);
}
const settle = async page => {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))));
  if(admission.mode==='current')await observeCurrentPhone(page,expectedThemes.get(page)||'day');
};
const visibleAssets = reqs => reqs.filter(u => u.includes('/assets/')).map(u => u.split('/assets/')[1]);

// frames from an input to its visible response: count rAF callbacks until `cond` holds (evaluated each frame)
// cond: ['sheet'] = the detail sheet is opening; ['open', kind] = that branch is open and its representative leaf has started to lift
async function tapFrames(page, selector, cond) {
  await page.evaluate(([kind, cat]) => {
    window.__fb = null;
    const rep = cat && document.querySelector(`details[data-cat="${cat}"]`).closest('section').querySelector('.leaf--rep');
    if(kind==='open'&&!rep)throw Error('UNSUPPORTED branch feedback: representative leaf missing');
    const before = rep && getComputedStyle(rep).transform;
    // first visible response (the sheet / the branch opening: tag inks, cards appear), then the leaf actually moving
    const first = kind === 'sheet' ? () => document.getElementById('sheet').classList.contains('is-open') : () => document.querySelector(`details[data-cat="${cat}"]`).open;
    const leaf = () => !rep || getComputedStyle(rep).transform !== before;
    addEventListener('click', e => { if(!e.isTrusted||!Number.isFinite(e.timeStamp)||e.timeStamp<0||e.timeStamp>performance.now()+5)throw Error('UNSUPPORTED: invalid trusted input timestamp');const t0 = e.timeStamp; let n = 0, r = null;
      const f = () => { n++; if (!r && first()) r = {frames: n, ms: +(performance.now() - t0).toFixed(1)};
        if (r && leaf()) { window.__fb = {...r, leafFrames: n, leafMs:+(performance.now()-t0).toFixed(1)}; return; } if (n < 30) requestAnimationFrame(f); else window.__fb = r ? {...r, leafFrames: 99} : {frames: 99}; };
      requestAnimationFrame(f); }, {capture: true, once: true}); }, cond);
  await page.tap(selector);
  await page.waitForFunction(() => window.__fb, null, {timeout: 5000});
  return page.evaluate(() => window.__fb);
}
async function scrollFrames(page, cdp, distance) {
  await page.evaluate(() => { window.__fr = [];window.__frCallbacks=[];window.__frStart=performance.now();window.__go = true;const f = frameTime => {const enteredAt=performance.now();window.__fr.push(enteredAt);window.__frCallbacks.push({frameTime,enteredAt});if(window.__go)window.__frHandle=requestAnimationFrame(f);};window.__frHandle=requestAnimationFrame(f);});
  await cdp.send('Input.synthesizeScrollGesture', {x: 180, y: 600, yDistance: -distance, speed: 1800, gestureSourceType: 'touch', repeatCount: 1});
  await cdp.send('Input.synthesizeScrollGesture', {x: 180, y: 300, yDistance: distance, speed: 4000, gestureSourceType: 'touch'});
  const window=await page.evaluate(() => {window.__go=false;cancelAnimationFrame(window.__frHandle);return {startMs:window.__frStart,endMs:performance.now(),frames:window.__fr,callbacks:window.__frCallbacks};});
  return {...mobileScrollEvidence(window),callbacks:window.callbacks};
}

try {
  // ------------------------------------------------------------------ arrival (375 x 812 @3, iPhone XS profile)
  await block('arrival', async () => {
    const {ctx, page, errors, requests, cdp} = await phone('xs');
    await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page);
    await shot(page, '01-arrival-xs375');
    const a = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const tags = [...document.querySelectorAll('.tree .tag')].map(t => t.getBoundingClientRect());
      return {h1: r('.hero h1').bottom, cta: r('.hero__cta .btn').bottom, treeTop: r('.tree').top, treeBottom: r('.tree').bottom, vh: innerHeight, flow: document.querySelector('.tree').classList.contains('is-flow'),
        tags: tags.map(t => [t.left, t.top, t.width, t.height]), overlap: tags.some((x, i) => tags.some((y, j) => j > i && x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom)),
        dom: document.querySelectorAll('*').length, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth};
    });
    ok('arrival: compact header + headline, first content action visible', a.cta < a.vh * .5, {cta: a.cta});
    ok('arrival: the whole tree is on the first screen (812 px layout viewport)', a.treeTop >= 0 && a.treeBottom <= a.vh, {top: a.treeTop, bottom: a.treeBottom});
    ok('arrival: category tags on the tree, at least 44 x 44, disjoint, on screen', a.tags.length > 0 && !a.flow && !a.overlap && a.tags.every(([l, , w, h]) => w >= 44 && h >= 44 && l >= 0 && l + w <= a.vw), {n: a.tags.length});
    ok('arrival: no sideways scrolling', a.sw <= a.vw, {sw: a.sw});
    const tt = await page.evaluate(() => [...document.querySelectorAll('summary.tag--tier, .tier__all, .leaf, .groups__all, .net__open, .menu__btn, .top__donate')].filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return [e.className, Math.round(r.left), Math.round(r.right), Math.round(r.width), Math.round(r.height)]; }));
    const lv = await page.evaluate(() => [...document.querySelectorAll('.tier__art')].map(art => { const r = [...art.querySelectorAll('.leaf, summary')].concat([...art.parentElement.querySelectorAll(':scope > details > summary')]).map(e => e.getBoundingClientRect());
      return r.some((x, i) => r.some((y, j) => j > i && x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom)); }));
    ok('leaf targets and branch tags never overlap each other', lv.length > 0 && lv.every(o => !o), {perTier: lv});
    ok('every branch tag, leaf and control is at least 44 x 44 and fully on screen', tt.length > 0 && tt.every(([, l, r, w, h]) => l >= 0 && r <= a.vw && w >= 44 && h >= 44), {small: tt.filter(([, l, r, w, h]) => !(l >= 0 && r <= a.vw && w >= 44 && h >= 44))});
    ok('DOM below budget at load', a.dom < BUDGET.dom, {dom: a.dom});
    const loaded = visibleAssets(requests);
    ok('only the day phone art family is downloaded (no night set, no desktop, no photos at arrival)', loaded.length>0 && loaded.every(f => !/-night@|cover-|poster-/.test(f)) && requests.every(u => u.startsWith(fx.base)), {loaded: loaded.length});
    const first = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /(tree|ridges|clouds|sky)@\dx/.test(e.name)).map(e => [e.name.split('/').pop(), e.encodedBodySize]));
    report.measures.firstScreenArt = {files: first, bytes: first.reduce((n, [, b]) => n + b, 0)};
    ok('first-screen art downloaded <= 150 KB at @3x', first.length>0 && first.every(([,bytes])=>Number.isFinite(bytes)&&bytes>0) && report.measures.firstScreenArt.bytes <= 150 * 1024, report.measures.firstScreenArt);
    // A normal scroll control proves this browser's draw feed works before foreground evidence is trusted.
    const beginTrace=async()=>{await cdp.send('Tracing.start',{categories:'disabled-by-default-devtools.timeline.frame,viz,blink.user_timing',transferMode:'ReturnAsStream'});await page.evaluate(()=>{performance.clearMarks('hw-mobile-trace-start');performance.clearMarks('hw-mobile-trace-end');performance.mark('hw-mobile-trace-start');});};
    const endTrace=async minDurationMs=>{await page.evaluate(()=>performance.mark('hw-mobile-trace-end'));return traceCount(cdp,minDurationMs);};
    await beginTrace();await page.mouse.wheel(0,120);await page.waitForTimeout(150);await page.mouse.wheel(0,-120);await page.waitForTimeout(150);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    const control=await endTrace(250);
    // The foreground holds a real scene (review round 048): while focused, visible and on screen the authored loops run and their
    // document-timeline time must actually advance, with nonempty compositor draw evidence. A frozen foreground is a failure,
    // never a pass; the old 9.5-10 s freeze wait and its 3 s idle window are gone. Paused behavior is required only in
    // supported lifecycle contexts: the real viewport/IntersectionObserver step below and the separate reduced-motion journey
    // (headless cannot establish the focus-loss transition; root's headed component check owns that).
    const sampleMotion=()=>page.evaluate(()=>{
      const timeOf=t=>typeof t==='number'?t:(t&&typeof t.value==='number'?t.value:null);
      return {at:performance.now(),focused:document.hasFocus(),visibility:document.visibilityState,live:document.documentElement.classList.contains('is-live'),
        groups:[...document.querySelectorAll('.birds, .bees, .bugs')].map(g=>({cls:g.className,on:g.classList.contains('on')})),
        animations:document.getAnimations().map(a=>({name:a.animationName||a.constructor.name,state:a.playState,time:timeOf(a.currentTime),target:(a.effect&&a.effect.target&&a.effect.target.className)||''}))};
    });
    const foregroundBefore=await sampleMotion();
    await page.waitForTimeout(800);
    const foregroundAfter=await sampleMotion();
    await beginTrace();await page.waitForTimeout(1100);const foregroundTrace=await endTrace(900);
    report.measures.foreground={before:foregroundBefore,after:foregroundAfter,trace:foregroundTrace,drawControl:control};
    ok('foreground: focused, visible, onscreen loops advance on the document timeline and the compositor draws (no frozen idle scene)',control.supported&&control.frames>0&&mobileForegroundPass(foregroundBefore,foregroundAfter)&&foregroundTrace.supported&&foregroundTrace.frames>0,report.measures.foreground);
    // Offscreen is a supported lifecycle context: the real IntersectionObserver drops `.on` when the scene leaves the viewport,
    // the loops hold (paused records, not deleted), and scrolling back resumes them with real progress between two samples.
    await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(300);
    const offscreen=await sampleMotion();
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(300);
    const resumed=await sampleMotion();
    await page.waitForTimeout(300);
    const advancing=await sampleMotion();
    report.measures.offscreen={onscreen:foregroundAfter,offscreen,resumed,advancing};
    ok('offscreen: the viewport context holds the loops off screen and scrolling back resumes real progress',mobileOffscreenPass(foregroundAfter,offscreen,resumed,advancing),report.measures.offscreen);
    ok('no page or console errors (arrival)', !errors.length, {errors});
    await ctx.close();
  });

  // ------------------------------------------------------------------ the hero tags hang in the margins, never on the crown (the project direction, 2026-10-12)
  // Each tag against the crown's baked alpha (mobile/art/masters/tree-crown@3x.png, kept fresh by the build like the art) and each
  // branch tag against its leaf targets, at 375, 390 and 402 px, portrait and landscape.
  await block('tags', async () => {
    const sharp = loadSharp();   // optional dependency resolved by package name; missing -> UNSUPPORTED
    const {data, info} = await sharp(await readInput(admission.maskPath)).ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject: true});
    const mask = {w: info.width, h: info.height, alpha: data};
    ok('tags: the crown mask is a real crown (enough opaque pixels to test against)', data.filter(a => a >= 128).length > mask.w * mask.h * .15, {w: mask.w, h: mask.h});
    for (const [width, height] of TAG_VIEWPORTS) {
      const ctx = await fx.browser.newContext({viewport: {width, height}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page);
      const p = await page.evaluate(tagProbe), f = tagFailures(p, mask);
      ok(`tags ${width}x${height}: in the margins, >= 44 px, disjoint from the crown, each other, the headline and the leaf targets`, !f.length && p.tags.length === 7 && !errors.length,
        {failures: f, errors, clearance: p.tags.map(t => [t.kind, +maskClash(mask, p.tree, t).gap.toFixed(1)])});
      if (width === 375 || width === 812) await shot(page, `01t-tags-${width}x${height}`);
      await ctx.close();
    }
  });

  // ------------------------------------------------------------------ every category, record detail + Back, deep links
  await block('categories and detail', async () => {
    const {ctx, page, errors} = await phone('xs');
    await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page);
    const counts = {};
    for (const k of CATS) {
      const sel = `.tree .tag[data-cat="${k}"]`;
      await page.evaluate(() => scrollTo(0, 0));
      await page.tap(sel);
      await page.waitForTimeout(350);
      const st = await page.evaluate(([k, id]) => { const d = document.querySelector(`details[data-cat="${k}"]`), sec = document.getElementById(id).getBoundingClientRect();
        return {open: d.open, cards: d.querySelectorAll('.card').length, top: sec.top, url: location.search + location.hash}; }, [k, TIER_ID[k]]);
      counts[k] = st.cards;
      ok(`category ${k}: the tag goes to its branch and opens all its cards`, st.open && st.cards > 0 && st.top < 160, st);
      await shot(page, `02-category-${k}`);
    }
    const expected = JSON.parse(await page.evaluate(() => document.getElementById('hw-records').textContent)).records.reduce((m, r) => (m[r.kind] = (m[r.kind] || 0) + 1, m), {});
    ok('every category shows ALL its original records', CATS.length > 0 && CATS.every(k => counts[k] === expected[k]), {counts, expected});
    // tap-to-feedback on a branch tag (closed -> open): the leaf lifts within two frames
    await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page);
    await page.evaluate(() => document.getElementById('work').scrollIntoView());
    const fb = await tapFrames(page, '#tag-work', ['open', 'work']);
    report.measures.tagFeedback = fb;
    ok('tap a branch tag: paper-lift feedback within about 2 frames', mobileFeedbackPass(fb,{leaf:true,budget:BUDGET.tapFrames,maxMs:BUDGET.tapMs}), fb);
    await page.waitForTimeout(400); await shot(page, '03-branch-open-leaf-lifted');
    // record detail and Back
    const y0 = await page.evaluate(() => scrollY);
    const fb2 = await tapFrames(page, '#work .card', ['sheet']);
    report.measures.cardFeedback = fb2;
    ok('tap a card: the detail sheet responds within about 2 frames', mobileFeedbackPass(fb2,{budget:BUDGET.tapFrames}), fb2);
    await page.waitForTimeout(400); await shot(page, '04-record-detail');
    const d1 = await page.evaluate(() => ({hash: location.hash, links: [...document.querySelectorAll('#sheet-body a')].map(a => a.href), back: !!document.querySelector('.sheet__back')}));
    ok('detail: a route (#leaf-id) with a visible Back and every original link', d1.hash === '#leaf-forest-watch' && d1.back && d1.links.some(h => h.includes('forestwatch')), d1);
    await page.goBack(); await page.waitForTimeout(400);
    const d2 = await page.evaluate(() => ({hidden: document.getElementById('sheet').hidden, y: scrollY, hash: location.hash, open: document.querySelector('details[data-cat=work]').open, search: location.search}));
    ok('browser Back closes the detail and keeps category and place', d2.hidden && Math.abs(d2.y - y0) < 2 && !d2.hash && d2.open && d2.search.includes('open=work'), d2);
    await page.goForward(); await page.waitForTimeout(300);
    ok('browser Forward reopens the record', await page.evaluate(() => !document.getElementById('sheet').hidden));
    await page.tap('.sheet__back'); await page.waitForTimeout(400);
    ok('the sheet Back button closes it', await page.evaluate(() => document.getElementById('sheet').hidden && !location.hash));
    // deep link restores category, search and the record; closing keeps the rest
    await page.goto(fx.base + '/?open=work,news&q=sierra#leaf-forest-watch', {waitUntil: 'load'}); await settle(page);
    const dl = await page.evaluate(() => ({sheet: !document.getElementById('sheet').hidden, title: document.getElementById('sheet-title')?.textContent, work: document.querySelector('details[data-cat=work]').open, news: document.querySelector('details[data-cat=news]').open, q: document.getElementById('group-find').value, rows: [...document.querySelectorAll('#groups li')].filter(l => !l.hidden).length}));
    const sierra = matches(JSON.parse(await page.evaluate(() => document.getElementById('hw-records').textContent)).records.filter(r => r.kind === 'group').map(r => r.title), 'sierra').length;
    ok('deep link restores record, categories and member search', dl.sheet && dl.title === 'Forest Watch' && dl.work && dl.news && dl.q === 'sierra' && dl.rows === sierra, {...dl, sierra});
    await page.tap('.sheet__close'); await page.waitForTimeout(400);
    ok('closing a deep-linked record keeps ?open and ?q', await page.evaluate(() => /open=work(%2C|,)news/.test(location.search) && location.search.includes('q=sierra') && !location.hash));
    // reload restores scroll position (browser) and state (URL)
    await page.evaluate(() => document.getElementById('t-news').scrollIntoView()); await page.waitForTimeout(300);
    const yb = await page.evaluate(() => scrollY); await page.reload({waitUntil: 'load'}); await settle(page); await page.waitForTimeout(300);
    const yr = await page.evaluate(() => scrollY);
    ok('reload restores the scroll position', Math.abs(yr - yb) < 40, {yb, yr});
    ok('no page or console errors (categories, detail)', !errors.length, {errors});
    await ctx.close();
  });

  // ------------------------------------------------------------------ member search with the keyboard open, root snap, newsletter, menu
  await block('search, roots, newsletter, menu', async () => {
    const {ctx, page, errors} = await phone('xs');
    await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page);
    await page.evaluate(() => document.getElementById('network').scrollIntoView());
    await page.tap('#group-find');
    await page.setViewportSize({width: 375, height: 812 - 336});            // the on-screen keyboard takes ~336 px on this phone
    await page.keyboard.type('kentucky', {delay: 30}); await page.waitForTimeout(400);
    const ks = await page.evaluate(() => { const rows = [...document.querySelectorAll('#groups li')].filter(l => !l.hidden), head = document.querySelector('.top').getBoundingClientRect().bottom;
      const first = rows[0].getBoundingClientRect(); return {rows: rows.length, firstTop: first.top, firstBottom: first.bottom, head, vh: innerHeight, tally: document.getElementById('group-tally').textContent, input: document.getElementById('group-find').getBoundingClientRect().top}; });
    ok('member search: named results come first and stay visible above the keyboard', ks.rows === 4 && ks.firstTop >= ks.head && ks.firstBottom <= ks.vh && ks.input >= ks.head, ks);
    await shot(page, '05-member-search-keyboard');
    await page.setViewportSize(PHONES.xs.viewport);
    const pick = await page.evaluate(() => [...document.querySelectorAll('#groups li')].find(l => !l.hidden).querySelector('a').dataset.i);
    await page.tap(`#groups a[data-i="${pick}"]`); await page.waitForTimeout(400);
    ok('a member result opens its detail', await page.evaluate(() => /^Kentucky/.test(document.getElementById('sheet-title').textContent)));
    await page.goBack(); await page.waitForTimeout(400);
    const acc = await page.evaluate(() => ({d: document.querySelector('.net__path path').getAttribute('d').length, sel: document.querySelector('#groups .is-sel a')?.dataset.i}));
    ok('the list selection accents its root', acc.d > 10 && acc.sel === pick, acc);
    // tap near the roots: snaps to the nearest member
    await page.evaluate(() => { document.getElementById('group-find').value = ''; document.getElementById('group-find').dispatchEvent(new Event('input')); document.querySelector('.net').scrollIntoView(); });
    await page.waitForTimeout(300);
    const box = await page.evaluate(() => { const b = document.querySelector('.net__img').getBoundingClientRect(); return {x: b.left, y: b.top, w: b.width, h: b.height}; });
    const net = JSON.parse(await page.evaluate(() => document.getElementById('hw-net').textContent));
    const tx = box.x + box.w * .37, ty = box.y + Math.min(box.h * .3, 500);
    await page.touchscreen.tap(tx, ty); await page.waitForTimeout(400);
    const want = nearest(net.spores.map(n => net.nodes[n]), (tx - box.x) / box.w * net.w, (ty - box.y) / box.h * net.h);
    const pin = await page.evaluate(() => ({hidden: document.querySelector('.net__pin').hidden, n: document.querySelector('.net__n').textContent, name: document.querySelector('.net__name').textContent}));
    ok('tapping near the roots snaps to the nearest member', !pin.hidden && +pin.n === want + 1, {...pin, want: want + 1});
    await shot(page, '06-roots-snap');
    // newsletter
    await page.evaluate(() => document.getElementById('news').scrollIntoView()); await page.waitForTimeout(500);
    const nl = await page.evaluate(() => { const img = document.querySelector('.issue__img'), pdf = [...document.querySelectorAll('.issue__links a')][0].getBoundingClientRect();
      return {cover: img.complete && img.naturalWidth > 0, w: img.getBoundingClientRect().width, pdf: [...document.querySelectorAll('.issue__links a')][0].href, pdfH: pdf.height, back: document.querySelectorAll('.issue__back a').length}; });
    ok('newsletter: a cover thumbnail and a prominent Read PDF / archive', nl.cover && nl.w <= 140 && /Fall-2026\.pdf$/.test(nl.pdf) && nl.pdfH >= 44 && nl.back === 5, nl);
    await shot(page, '07-newsletter');
    for (const id of ['gatherings', 'support', 'contact']) { await page.evaluate(i => document.getElementById(i).scrollIntoView(), id); await page.waitForTimeout(300); await shot(page, '08-' + id); }
    // menu jump and Back
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
    await page.tap('.menu__btn'); await page.waitForTimeout(200); await shot(page, '09-menu');
    await page.tap('.menu__nav a[href="#network"]'); await page.waitForTimeout(300);
    const mj = await page.evaluate(() => ({top: document.getElementById('network').getBoundingClientRect().top, menu: document.querySelector('.menu').open, hash: location.hash}));
    ok('named menu: arrives immediately at the section and closes', Math.abs(mj.top - document_head()) < 80 && !mj.menu && mj.hash === '#network', mj);
    await page.goBack(); await page.waitForTimeout(300);
    ok('Back after a menu jump returns to the top', await page.evaluate(() => scrollY < 10));
    ok('no page or console errors (search, roots, menu)', !errors.length, {errors});
    await ctx.close();
  });

  // ------------------------------------------------------------------ rotation (portrait -> landscape -> portrait), 200 % text
  await block('rotation and text size', async () => {
    const {ctx, page, errors, requests} = await phone('xs');
    await page.goto(fx.base + '/?open=work', {waitUntil: 'load'}); await settle(page);
    await page.evaluate(() => { const c = document.querySelectorAll('#work .card')[3]; scrollTo(0, scrollY + c.getBoundingClientRect().top - 60); });
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => document.querySelectorAll('#work .card')[3].getBoundingClientRect().top);
    await page.setViewportSize({width: 812, height: 375}); await page.waitForTimeout(500);
    const land = await page.evaluate(() => ({cardTop: document.querySelectorAll('#work .card')[3].getBoundingClientRect().top, vh: innerHeight, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, open: document.querySelector('details[data-cat=work]').open, cols: getComputedStyle(document.querySelector('#work .cards')).gridTemplateColumns.split(' ').length}));
    ok('rotation to landscape keeps the place, the open category and no sideways scroll', land.cardTop > -60 && land.cardTop < land.vh && land.sw <= land.vw && land.open, {before, ...land});
    await shot(page, '10-landscape-same-place');
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300); await shot(page, '11-landscape-arrival');
    ok('landscape is the same phone composition (no desktop scene downloaded)', visibleAssets(requests).every(f => !/heartwood\.|leaf\.|stage/.test(f)) && await page.evaluate(() => !!document.querySelector('.tree') && !document.querySelector('.stage')));
    await page.setViewportSize(PHONES.xs.viewport); await page.waitForTimeout(400);
    ok('no page or console errors (rotation)', !errors.length, {errors});
    await ctx.close();
    const big = await phone('xs', {bypassCSP: true});
    await big.page.goto(fx.base + '/?open=act', {waitUntil: 'load'});
    await big.page.addStyleTag({content: 'html{font-size:200% !important}'}); await settle(big.page);
    await big.page.evaluate(() => dispatchEvent(new Event('resize'))); await big.page.waitForTimeout(400);
    const bt = await big.page.evaluate(() => { const vw = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('a, button, summary, input')].filter(e => { const r = e.getBoundingClientRect(); return e.checkVisibility() && r.width && (r.right > vw + 1 || r.left < -1); });
      const tags = [...document.querySelectorAll('.tree .tag')].map(t => t.getBoundingClientRect());
      return {sw: document.documentElement.scrollWidth, vw, offscreen: bad.map(e => (e.textContent.trim() || e.getAttribute('aria-label') || e.className).slice(0, 40) + ' @' + Math.round(e.getBoundingClientRect().left) + '..' + Math.round(e.getBoundingClientRect().right)), flow: document.querySelector('.tree').classList.contains('is-flow'), overlap: tags.some((x, i) => tags.some((y, j) => j > i && x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom))}; });
    ok('200% text: nothing runs off the side, tags never overlap (they become a list)', bt.sw <= bt.vw + 1 && !bt.offscreen.length && !bt.overlap, bt);
    await shot(big.page, '12-text-200'); await big.page.evaluate(() => document.getElementById('t-act').scrollIntoView()); await big.page.waitForTimeout(300); await shot(big.page, '12b-text-200-branch');
    await big.ctx.close();
  });

  // ------------------------------------------------------------------ native Home links must reach the real top, not the sticky header's visible position
  await block('home navigation',async()=>{
    for(const theme of ['day','night']){
      const {ctx,page,errors}=await phone('xs',{colorScheme:theme==='night'?'dark':'light'});
      await page.goto(fx.base+'/',{waitUntil:'load'});await settle(page);
      for(const [name,selector,menu] of [['header','.top .brand',false],['menu','.menu__nav a[href="#top"]',true],['footer','.foot .brand',false]]){
        await page.evaluate(()=>document.getElementById('network').scrollIntoView());
        const before=await page.evaluate(()=>scrollY);if(!(before>812))throw Error('UNSUPPORTED: Home did not start below the tree');
        if(menu)await page.tap('.menu__btn');
        if(name==='footer')await page.evaluate(()=>document.querySelector('.foot').scrollIntoView());
        await page.tap(selector);
        let arrivalError=null;try{await page.waitForFunction(()=>scrollY<=1,null,{timeout:2000,polling:'raf'});}catch(error){arrivalError=error.message.split('\n')[0];}
        const state=await page.evaluate(()=>({y:scrollY,hash:location.hash,menuOpen:document.querySelector('.menu').open,sheetHidden:document.getElementById('sheet').hidden}));
        ok(theme+' '+name+' Home arrives at the real tree top',!arrivalError&&state.y<=1&&state.hash==='#top'&&!state.menuOpen&&state.sheetHidden,{before,...state,arrivalError});
      }
      ok(theme+' Home has no page or console errors',!errors.length,{errors});await ctx.close();
    }
  });

  // ------------------------------------------------------------------ interrupted taps and scrolls
  await block('interruptions', async () => {
    const {ctx, page, cdp, errors} = await phone('xs');
    await page.goto(fx.base + '/?open=work', {waitUntil: 'load'}); await settle(page);
    await page.evaluate(() => document.getElementById('work').scrollIntoView());
    const c = await page.evaluate(() => { const r = document.querySelector('#work .card').getBoundingClientRect(); return {x: r.left + 40, y: r.top + 20}; });
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y}]});
    await touch('touchStart', c.x, c.y); for (let i = 1; i <= 8; i++) await touch('touchMove', c.x, c.y - i * 8); await touch('touchEnd');
    await page.waitForTimeout(400);
    ok('a touch that turns into a scroll never opens a card', await page.evaluate(() => document.getElementById('sheet').hidden));
    await page.tap('#work .card'); await page.goBack(); await page.tap('#work .card'); await page.waitForTimeout(50); await page.goBack(); await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({hidden: document.getElementById('sheet').hidden, hash: location.hash, inert: document.querySelector('main').inert, overflow: getComputedStyle(document.documentElement).overflow}));
    ok('rapid open/Back/open/Back leaves the page usable (no stuck sheet, inert or scroll lock)', st.hidden && !st.hash && !st.inert && st.overflow !== 'hidden', st);
    const y1 = await page.evaluate(() => scrollY);
    await cdp.send('Input.synthesizeScrollGesture', {x: 180, y: 600, yDistance: -4000, speed: 12000, gestureSourceType: 'touch'});
    await cdp.send('Input.synthesizeScrollGesture', {x: 180, y: 300, yDistance: 9000, speed: 15000, gestureSourceType: 'touch'});
    ok('a fling down and back up is never trapped', await page.evaluate(y => scrollY < y, y1));
    ok('no page or console errors (interruptions)', !errors.length, {errors});
    await ctx.close();
  });

  // ------------------------------------------------------------------ frame budgets: 375x812@3 at CPU x4 and x6, 402 px at x4
  for (const {kind,rate,theme,name} of mobilePerformancePlan({quick,theme:timingTheme})) { await block(name, async () => {
    const measurePrefix=theme==='night'?'night-':'';
    const {ctx, page, cdp} = await phone(kind,{colorScheme:theme==='night'?'dark':'light'});
    await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page);
    await page.evaluate(() => [...document.querySelectorAll('img[loading=lazy]')].forEach(i => { i.loading = 'eager'; }));  // measure scrolling, not first decode
    await page.waitForTimeout(800);
    const foregroundRunning=await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);   // the frames window keeps measuring the fully animated foreground (review round 048)
    await cdp.send('Emulation.setCPUThrottlingRate', {rate});
    const s = await scrollFrames(page, cdp, 5200);
    const fb = await (async () => { await page.evaluate(() => document.getElementById('t-gather').scrollIntoView()); await page.waitForTimeout(300);
      return tapFrames(page, '#tag-gather', ['open', 'gather']); })();
    let burst;
    if(options['trace-burst'])await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,cc,disabled-by-default-devtools.timeline.invalidationTracking',transferMode:'ReturnAsStream'});
    try{burst=await phoneGestureBurst(page,cdp,{width:kind==='p402'?402:375,height:kind==='p402'?874:812,dpr:3});}
    finally{if(options['trace-burst']){const trace=await finishCDPTrace(cdp,{timeoutMs:10000});await writeFile(join(OUT,theme+'-burst-'+kind+'-cpu'+rate+'.trace.json'),trace);}}
    report.measures[measurePrefix+'burst-'+kind+'-cpu'+rate]=burst;ok(theme+' phone burst '+kind+' x'+rate+': native preview/sheet/swipe/rotation stays responsive and recovers',burst.verdict.passed,{...burst,performanceMetric:'burst'});
    // A fresh document/context has no phone listeners, pending timers or inherited CSP.
    const controlContext=await fx.browser.newContext({...PHONES[kind],isMobile:true,hasTouch:true,colorScheme:'light'}),controlPage=await controlContext.newPage(),controlCDP=await controlContext.newCDPSession(controlPage);
    await controlCDP.send('Emulation.setCPUThrottlingRate',{rate});
    await controlPage.setContent('<!doctype html><body style="margin:0;height:12000px;background:linear-gradient(#cde,#fed)"></body>');await controlPage.waitForTimeout(300);
    const control = await scrollFrames(controlPage, controlCDP, 5200);
    control.document=await controlPage.evaluate(()=>({url:location.href,bodyHeight:document.body.scrollHeight,background:getComputedStyle(document.body).backgroundImage,phone:!!document.querySelector('#hw-records')}));
    if(control.document.url!=='about:blank'||control.document.bodyHeight!==12000||!control.document.background.startsWith('linear-gradient(')||control.document.phone)throw Error('UNSUPPORTED: bare control document did not load independently');
    await controlContext.close();
    report.measures[`${measurePrefix}scroll-${kind}-cpu${rate}`] = {...s, tapFeedback: fb, emptyPageControl: control, foregroundRunning};
    ok(`${theme} frames ${kind} CPU x${rate}: p95 < ${BUDGET.p95} ms, none over ${BUDGET.max} ms, tap feedback <= 2 frames and34ms`, s.supported && s.frames>=2 && s.p95 < BUDGET.p95 && s.max <= BUDGET.max && mobileFeedbackPass(fb,{leaf:true,budget:BUDGET.tapFrames,maxMs:BUDGET.tapMs}), {...report.measures[`${measurePrefix}scroll-${kind}-cpu${rate}`],performanceMetric:'frame'});
    await ctx.close();
  },{performanceTheme:theme}); }

  // ------------------------------------------------------------------ a fast fling lands on a painted page (the project direction, 2026-10-12: "just the brown background").
  // tools/diagnostics/fling-blank-probe.mjs: 375x812@3, touch, CPU x4, fresh context per pass; the visitor flings top -> bottom -> top after load.
  for(const theme of timingThemes)await block((theme==='night'?'night ':'')+'fling', async () => {
    const measurePrefix=theme==='night'?'night-':'';
    const {flingChromium} = await import('./diagnostics/fling-blank-probe.mjs');
    const r = await flingChromium({browser: fx.browser, url: fx.base + (admission.mode==='current'?'/'+theme+'.html':'/?theme='+(theme==='night'?'dark':'light')), cpu: 4, waitMs: 500, framesDir: join(OUT, 'screens', theme+'-fling'), log: m => console.log(theme+' fling ' + m.slice(0, 240))});
    report.measures[measurePrefix+'fling'] = {...r, passB: {...r.passB, timeline: undefined}};
    const L = r.passB.landings || [];
    ok(theme+' fling CPU x4: both landings show their text on the first frame and all their art within 100 ms', L.length === 2 && L.every(l => l.landed && l.firstFrame.textMissing <= 1 && l.textReadyMs === 0 && l.artReadyMs !== null && l.artReadyMs <= 100), {landings: L,performanceMetric:'painted'});
    ok(`${theme} fling CPU x4: frames p95 < ${BUDGET.p95} ms, none over ${BUDGET.max} ms`, r.passA.frames >= 2 && r.passA.p95 < BUDGET.p95 && r.passA.max <= BUDGET.max, {p95: r.passA.p95, max: r.passA.max, cost: r.passA.cost,performanceMetric:'frame'});
    // on a phone network (slow 4G) a visitor who looks at the tree for 4 s and then flings meets every piece of art already loaded (the old
    // build's lazy roots were still missing); the photos (newsletter cover) stay on demand by design and are not counted
    const n = await flingChromium({browser: fx.browser, url: fx.base + (admission.mode==='current'?'/'+theme+'.html':'/?theme='+(theme==='night'?'dark':'light')), cpu: 4, net: 'slow4g', waitMs: 4000, withReference: false, log: m => console.log(theme+' fling 4G ' + m.slice(0, 240))});
    const art = Object.fromEntries(Object.entries(n.passA.artAtEntry).filter(([k]) => !k.startsWith('issue__img')));
    report.measures[measurePrefix+'flingSlow4g'] = {artAtEntry: n.passA.artAtEntry, p95: n.passA.p95, max: n.passA.max};
    ok(theme+' fling on slow 4G, 4 s after load: every piece of art is loaded before it scrolls into view', Object.keys(art).length >= 4 && Object.values(art).every(a => a.ready), {art, photos: n.passA.artNotReady.filter(k => k.startsWith('issue__img')),performanceMetric:'slow4g'});
  },{performanceTheme:theme});

  // ------------------------------------------------------------------ leaks over repeated open/close cycles; layers at rest
  await block('leaks', async () => {
    const {ctx, page, cdp, errors} = await phone('xs');
    await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page);
    const layers = []; cdp.on('LayerTree.layerTreeDidChange', e => { if (e.layers) layers.push(e.layers.length); });await cdp.send('LayerTree.enable');
    const counters = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(200); return cdp.send('Memory.getDOMCounters'); };
    const cycle = async () => {
      await page.tap('.tree .tag[data-cat=work]'); await page.tap('#work .card'); await page.waitForTimeout(320); await page.tap('.sheet__back'); await page.waitForTimeout(320);
      await page.tap('#tag-work'); await page.evaluate(() => document.getElementById('network').scrollIntoView());
      await page.evaluate(() => { const f = document.getElementById('group-find'); for (const v of ['appal', '']) { f.value = v; f.dispatchEvent(new Event('input')); } });   // (typing is tested above; typed input keeps an undo history that is the browser's, not a page leak)
      const b = await page.evaluate(() => { document.querySelector('.net').scrollIntoView(); const r = document.querySelector('.net__img').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 120]; }); await page.touchscreen.tap(...b);
      await page.evaluate(() => scrollTo(0, 0));
    };
    await cycle(); await cycle();
    const restLayers = layers.at(-1);
    const c0 = await counters();
    const N = quick ? 10 : 30;
    for (let i = 0; i < N; i++) await cycle();
    const c1 = await counters();
    report.measures.leaks = {cycles: N, before: c0, after: c1, layersAtRest: restLayers, layersAfter: layers.at(-1), domAfterAll: await page.evaluate(() => document.querySelectorAll('*').length)};
    const leakBaseline = Number.isFinite(c0.nodes) && c0.nodes > 0 && Number.isFinite(c0.documents) && c0.documents > 0 && Number.isFinite(c0.jsEventListeners) && c0.jsEventListeners >= 0;   // zero deltas and zero listeners are valid; zero/unsupported nodes or documents are not evidence
    ok(`no DOM or listener leak over ${N} open/close cycles`, leakBaseline && c1.nodes - c0.nodes <= BUDGET.leakNodes && c1.jsEventListeners - c0.jsEventListeners <= BUDGET.leakListeners && c1.documents === c0.documents, {...report.measures.leaks, baseline: c0});
    ok('no layer leak (layer count back to rest)', mobileLayerEvidence(restLayers,layers.at(-1)), report.measures.leaks);
    ok('no page or console errors (leak cycles)', !errors.length, {errors});
    await ctx.close();
  });

  // ------------------------------------------------------------------ night (prefers-color-scheme: dark), reduced motion / Save-Data
  await block('night and reduced motion', async () => {
    const {ctx, page, requests, errors} = await phone('xs', {colorScheme: 'dark'});
    await page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(page); await page.waitForTimeout(300);
    await shot(page, '20-night-arrival');
    const art = visibleAssets(requests).filter(f => /@\dx/.test(f));
    ok('night: only the night art is downloaded', art.length && art.every(f => /-night@|leaves-night|flies-night/.test(f)), {art});
    ok('night: the darkreader-lock meta is present and color-scheme is light dark', await page.evaluate(() => !!document.querySelector('meta[name=darkreader-lock]') && /light dark/.test(document.querySelector('meta[name=color-scheme]').content)));
    for (const id of ['t-act', 'about', 'network', 'news', 'support']) { await page.evaluate(i => document.getElementById(i).scrollIntoView(), id); await page.waitForTimeout(400); await shot(page, '21-night-' + id); }
    ok('no page or console errors (night)', !errors.length, {errors});
    await ctx.close();
    const calm = await phone('xs', {reducedMotion: 'reduce'});
    await calm.page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(calm.page);
    const anim = await calm.page.evaluate(() => document.getAnimations().length);
    ok('reduced motion: nothing animates and the page is complete', anim === 0 && await calm.page.evaluate(() => document.querySelectorAll('.card').length > 30), {anim});
    await shot(calm.page, '22-reduced-motion');
    await calm.ctx.close();
    const p4 = await phone('p402');
    await p4.page.goto(fx.base + '/', {waitUntil: 'load'}); await settle(p4.page); await shot(p4.page, '01b-arrival-402');
    await p4.page.goto(fx.base + '/?open=act', {waitUntil: 'load'}); await settle(p4.page); await p4.page.evaluate(() => document.getElementById('t-act').scrollIntoView()); await p4.page.waitForTimeout(400); await shot(p4.page, '02b-branch-402');
    await p4.ctx.close();
  });
} catch (e) {
  report.failures.push('crashed: ' + e.message); console.error(e);
} finally {
  report.blocked = fx.blocked;
  report.finished = new Date().toISOString(); report.loadavgAtEnd = (await import('node:os')).loadavg();
  report.harnessSha256=harnessBefore.find(row=>row.path==='verify-mobile.mjs').sha256;
  if(!report.executedJourneys?.length||!report.checks.length)report.failures.push('No mobile acceptance journeys/checks executed');
  try{await runtime.deadline('complete pending fixed-phone load observations',()=>Promise.all(observedLoads),{timeoutMs:8000});}catch(e){report.failures.push('phone readiness observation failed: '+e.message);}
  try { await fx.close(); } catch (e) { report.failures.push(e.message); console.error(e.message); }
  try{report.harnessInputs.after=await runtime.deadline('verify direct verifier/harness input epoch unchanged',snapshotDirectHarness,{timeoutMs:30000});if(JSON.stringify(report.harnessInputs.after)!==JSON.stringify(harnessBefore))throw Error('Direct executing verifier/harness disk input epoch changed during run');report.harnessInputs.afterVerified=true;}catch(e){report.failures.push('harness identity: '+e.message);}
  report.targetRequests=[...targetRequests];for(const issue of targetRequestIssues)report.failures.push('target resource identity: '+issue);
  try{report.inputIdentity.after=await runtime.deadline('verify complete phone artifact remained unchanged',()=>verifyPhoneTargetUnchanged(admission,{readInput}),{timeoutMs:60000});}catch(e){report.failures.push('phone artifact/source changed: '+e.message);}
  if(admission.mode==='current'&&!report.observedPhones.length)report.failures.push('No positive current phone route/theme/content/resource observation');
  if(timing){try{report.timingObservations.push({phase:'end',environment:await timing.snapshot()});}catch(error){report.failures.push('timing ownership: '+error.message);}try{await timing.release();}catch(error){report.failures.push('timing assertion cleanup: '+error.message);}if(timing.sleepPrevention.loss)report.failures.push('timing assertion was lost during this run');}
  for(const theme of ['day','night'])report.performanceCoverage[theme]=phoneLagCoverage({executed:report.executedJourneys||[],checks:report.checks,browserErrors:report.browserErrors,failures:report.failures,theme,quick});
  if(options['trace-burst'])for(const row of Object.values(report.performanceCoverage))if(row?.status==='PASS')row.status='DIAGNOSTIC';
  report.performanceCoverage.fullNightLagAcceptance=admission.mode==='current'&&!options['trace-burst']&&!quick&&report.performanceCoverage.night.status==='PASS';
  await writeFile(join(OUT, 'verify-report.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(`\n${report.checks.filter(c => c.pass).length}/${report.checks.length} checks passed; artifact ${report.artifact}; report ${join(OUT, 'verify-report.json')}`);
  if (report.failures.length) { console.log('FAILURES:\n  ' + report.failures.join('\n  ')); process.exitCode = 1; }
}

function document_head() { return 56; }   // header height (3.5rem at 16 px)
async function traceCount(cdp,minDurationMs){const data=JSON.parse(await finishCDPTrace(cdp));return mobileDrawEvidence(data.traceEvents||data,{minDurationMs});}
