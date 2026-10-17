// Cold-load deep links must arrive at once (rendering never traps navigation): every in-page section opened as a
// fresh page at /<route>/#<section>, in Chromium phone emulation with a 4x CPU throttle (and one desktop pass).
// Each frame records scrollY against the section's destination (scroll-padding/margin, clamped to the page); the
// page has arrived when it sits on the destination and stays there. Fails if any section never arrives, arrives
// later than ARRIVE_MS after the first rendered frame, or drifts off afterwards.
//   node tools/test-deep-links.mjs     (HW_SITE_ROOT, HW_ROUTE default optimized, HW_OUT; serial browser: wrap in browser-lock.sh)
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {devices} from './browser-deps.mjs';
browserToolCLI({});
const route=process.env.HW_ROUTE||'optimized',out=resolve(process.env.HW_OUT||'output/playwright/deep-links');
const ARRIVE_MS=300,TAIL_MS=1500;   // after the first frame; the smooth load-time jump started ~1.5 s late on a phone and often stalled
const configs=[{name:'Pixel 7 cpu x4',ctx:{...devices['Pixel 7']},cpu:4},{name:'1365x768@1',ctx:{viewport:{width:1365,height:768}},cpu:1}];
const PROBE=`(()=>{const id=decodeURIComponent(location.hash.slice(1)),F=window.__deep=[];
  const dest=()=>{const t=document.getElementById(id);if(!t)return null;const pad=parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)||0,mar=parseFloat(getComputedStyle(t).scrollMarginTop)||0;
    return Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,t.getBoundingClientRect().top+scrollY-pad-mar));};
  const f=()=>{F.push({t:performance.now(),y:scrollY,d:dest()});if(F.length<2000)requestAnimationFrame(f);};requestAnimationFrame(f);})();`;
const fx=await browserFixture();
const report={route,siteRoot:process.env.HW_SITE_ROOT||'site',arriveMs:ARRIVE_MS,cases:[]};
try{
  let sections;
  for(const cfg of configs){
    {const ctx=await fx.browser.newContext(cfg.ctx),page=await ctx.newPage();await page.goto(`${fx.base}/${route}/`,{waitUntil:'load'});
      sections??=await page.evaluate(()=>[...new Set([...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href').slice(1)))].filter(id=>{const e=document.getElementById(id);return e&&e.matches('section, [id="top"]')&&id!=='top';}));await ctx.close();}
    assert(sections.length>=5,'expected the page sections, found '+sections);
    for(const id of sections){
      const ctx=await fx.browser.newContext(cfg.ctx),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
      if(cfg.cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cfg.cpu});
      await page.addInitScript(PROBE);
      await page.goto(`${fx.base}/${route}/#${id}`,{waitUntil:'load'});
      await page.waitForTimeout(TAIL_MS);
      const {frames,load}=await page.evaluate(()=>({frames:window.__deep,load:performance.getEntriesByType('navigation')[0]?.loadEventEnd}));
      const at=frames.findIndex((f,i)=>f.d!==null&&frames.slice(i).every(g=>g.d!==null&&Math.abs(g.y-g.d)<=1));
      const row={config:cfg.name,id,frames:frames.length,firstFrameMs:Math.round(frames[0]?.t),loadMs:Math.round(load),arrivedMs:at<0?null:Math.round(frames[at].t),final:frames.at(-1)};
      row.afterFirstFrameMs=at<0?null:Math.round(frames[at].t-frames[0].t);
      row.pass=at>=0&&row.afterFirstFrameMs<=ARRIVE_MS;
      report.cases.push(row);console.log(`${row.pass?'PASS':'FAIL'} ${cfg.name.padEnd(15)} #${id.padEnd(11)} arrived ${row.arrivedMs===null?'never':row.afterFirstFrameMs+' ms after the first frame'} (first frame ${row.firstFrameMs} ms, load ${row.loadMs} ms, final y ${Math.round(row.final?.y)} of ${Math.round(row.final?.d)})`);
      await ctx.close();
    }
  }
}finally{await fx.close();}
await mkdir(out,{recursive:true});await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,1));
const bad=report.cases.filter(c=>!c.pass);
console.log(bad.length?`${bad.length}/${report.cases.length} deep links did not arrive within ${ARRIVE_MS} ms of the first frame`:`all ${report.cases.length} deep links arrived within ${ARRIVE_MS} ms of the first frame`);
process.exitCode=bad.length?1:0;
