// Verifies the rAF-coalesced header state (the maintained header `stuckSoon` behavior): .is-stuck must be correct in the same frame as the scroll and before the first
// frame of a page that loads scrolled. Reports the same numbers for the previous build (synchronous listener) so the two can be compared.
//   HW_SITE_ROOT=<site dir> node tools/diagnostics/check-header-stuck.mjs [--route optimized]
// A later scroll listener schedules a rAF; the page's own rAF was queued earlier, so it runs first in the same frame: the check sees the settled class.
import {browserFixture,browserToolCLI} from '../browser-test-lib.mjs';
import assert from 'node:assert/strict';
const {route}=browserToolCLI({route:{type:'string',default:'optimized'}});
const f=await browserFixture();
try{
  const ctx=await f.browser.newContext({viewport:{width:1365,height:768},reducedMotion:'no-preference'}),page=await ctx.newPage();
  // Page-load probe: class changes with timestamps, first rAF after DOMContentLoaded (queued after the page's deferred scripts), paint timings.
  await ctx.addInitScript(()=>{const P=window.__hs={changes:[],firstRaf:null,paints:{}};
    new PerformanceObserver(l=>l.getEntries().forEach(e=>P.paints[e.name]=e.startTime)).observe({type:'paint',buffered:true});
    document.addEventListener('DOMContentLoaded',()=>{const top=document.getElementById('top');new MutationObserver(()=>P.changes.push({t:performance.now(),stuck:top.classList.contains('is-stuck')})).observe(top,{attributes:true,attributeFilter:['class']});
      requestAnimationFrame(()=>{P.firstRaf={t:performance.now(),scrollY,stuck:top.classList.contains('is-stuck')};});
      addEventListener('scroll',()=>requestAnimationFrame(()=>P.loadFrames.push({t:performance.now(),y:scrollY,stuck:top.classList.contains('is-stuck')})),{passive:true});});   // registered after the page's own scroll listener
    P.loadFrames=[];});
  await page.goto(`${f.base}/${route}/#gatherings`,{waitUntil:'load'});await page.waitForTimeout(800);
  const load=await page.evaluate(()=>({...window.__hs,scrollY}));
  assert(load.scrollY>8,'page did not load scrolled');assert(load.firstRaf.stuck===(load.firstRaf.scrollY>8),'first rAF after DOMContentLoaded: class disagrees with scroll '+JSON.stringify(load.firstRaf));
  const lw=load.loadFrames.filter(x=>x.stuck!==(x.y>8));assert(load.loadFrames.some(x=>x.y>8),'no scrolled frame observed during load');assert.deepEqual(lw,[],'load: frames where .is-stuck disagrees with scrollY>8');
  // Same-frame check during scrolling: wheel steps across the 8 px threshold both ways, plus instant jumps.
  await page.evaluate(()=>{const top=document.getElementById('top'),R=window.__hs.frames=[];addEventListener('scroll',()=>requestAnimationFrame(()=>R.push({y:scrollY,stuck:top.classList.contains('is-stuck')})),{passive:true});});
  await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';scrollTo({top:0,behavior:'instant'});});await page.waitForTimeout(100);
  await page.mouse.move(40,400);
  for(const dy of [3,3,3,3,10,10,-10,-10,-3,-3,-3,-3,40,-40,400,-400])await page.mouse.wheel(0,dy),await page.waitForTimeout(40);
  for(const y of [0,5,9,0,2000,0,7,9])await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y),await page.waitForTimeout(60);
  const fr=await page.evaluate(()=>window.__hs.frames),wrong=fr.filter(x=>x.stuck!==(x.y>8));
  assert(fr.length>=15,'too few scroll frames sampled: '+fr.length);assert.deepEqual(wrong,[],'frames where .is-stuck disagrees with scrollY>8');
  const FCP=load.paints['first-contentful-paint'];
  console.log(JSON.stringify({route,loadedScrolledY:load.scrollY,firstRaf:load.firstRaf,loadFramesChecked:load.loadFrames.length,firstScrolledFrame:load.loadFrames.find(x=>x.y>8),fcpMs:Math.round(FCP),classChangesMs:load.changes.map(c=>({t:Math.round(c.t),stuck:c.stuck})),firstChangeBeforeFcp:load.changes.length?load.changes[0].t<=FCP:null,scrollFramesChecked:fr.length,mismatches:wrong.length}));
  console.log('header-stuck check: OK');
}finally{await f.close();}
