const requireDarkReaderPath=()=>{const value=process.env.HW_DARKREADER;if(!value||!value.trim())throw Error('UNSUPPORTED: Dark Reader is not available; set HW_DARKREADER to a darkreader.js path or set HW_NO_DARKREADER=1 to skip it explicitly (see docs/TESTING.md)');return value.trim();};
// Browser check of the designed dark mode (taste build). Independent owned session by default.
// Needs site/optimized-taste (the one taste build from npm run build, dark mode included) beside site/optimized, and Dark Reader as for verify-taste.mjs
// (set HW_DARKREADER to a darkreader.js path). Every browser is guarded (loopback only).
// Cases (HW_ONLY=a,b): sections (every section dark, WCAG AA text), critters (all present, visible, animating, compositor-only, idle main thread),
// sync (one firefly clock, keyframes as generated, off-screen hold, burst frame strips), standdown (Dark Reader + Chrome forced dark),
// light (light mode = the taste build, cottontail apart: walkers hidden, and nothing hidden with 0 pixels differing outside the cottontail's own box), lag (frame p95 < 25 ms, none > 50 ms, input-to-frame p95 <= 36 ms), leaks, idle (dark <= light).
// Report + screens: output/playwright/review-taste-dark/deployed/ (HW_OUT). Exit 1 on any failure.
import {writeFile,mkdir} from 'node:fs/promises';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {loadSharp} from './sharp-deps.mjs';
const sharp=(...args)=>loadSharp()(...args);   // lazy seam: the optional dependency is demanded only at first use
import {browserFixture,finishCDPTrace,browserToolCLI} from './browser-test-lib.mjs';
import {darkSelection,analyzeDarkTiming,darkTimingProblems,darkLeakProblems,darkCompositeEvidence} from './dark-acceptance.mjs';
import {fireflyTiming,FIREFLY,NIGHT} from './taste-dark.mjs';

browserToolCLI({});
const siteRoot=resolve(process.env.HW_SITE_ROOT||new URL('../publish',import.meta.url).pathname);
const CASE_NAMES=["sections","critters","preview","sync","placement","standdown","light","lag","leaks","idle"];
const only=darkSelection(process.env.HW_ONLY,CASE_NAMES);
const out=resolve(process.env.HW_OUT||new URL('../output/playwright/review-taste-dark/deployed',import.meta.url).pathname);
// ROUTE: the one taste build (dark mode included). TASTE: the light reference without the dark mode, the faithful page by default (the taste build at rest equals it: verify-taste, verify-taste-tree).
const ROUTE=process.env.HW_ROUTE||'/optimized-taste/',TASTE=process.env.HW_TASTE_ROUTE||'/optimized/';
const runTimeoutMs=Number(process.env.HW_RUN_TIMEOUT_MS??45*60000);
const runtime=ensureToolRuntime({name:'taste dark verification',runTimeoutMs});await runtime.ready;
await runtime.deadline('prepare dark output',()=>mkdir(out,{recursive:true}),{timeoutMs:5000});
const DR=!only||only.has('standdown')?await readRegularInput(resolve(requireDarkReaderPath()),{runtime,syntax:'script'}):'';
const pct=(a,q)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))]:0,r1=v=>Math.round(v*10)/10;
const fx=await browserFixture({siteRoot,runtime,runTimeoutMs});let forcedB=null;   // all cases take ~20 min
const report={browser:fx.browser.version(),route:ROUTE,cases:{},failures:[]};
const fail=(c,msg)=>{report.failures.push(c+': '+msg);console.error('FAIL '+c+': '+msg);};
const check=(c,ok,msg)=>{if(!ok)fail(c,msg);return ok;};
const T=fireflyTiming();
async function open(route,{scheme='dark',w=1365,h=900,dpr=1,dr=false,forced=false,reduced}={}){
  const b=forced?(forcedB||=await fx.launch(['--force-dark-mode','--enable-features=WebContentsForceDark'])):fx.browser;
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:dpr,colorScheme:scheme,bypassCSP:true,...(reduced?{reducedMotion:'reduce'}:{})});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,200));});
  if(dr)await page.addInitScript({content:DR+';document.addEventListener("DOMContentLoaded",()=>DarkReader.enable({brightness:100,contrast:100,sepia:0}));'});
  await page.goto(fx.base+route,{waitUntil:'load'});
  await page.waitForFunction(()=>window.leafLift&&document.querySelectorAll('#net .spore').length>0);await page.waitForTimeout(1500);
  return {ctx,page,errors,cdp:await ctx.newCDPSession(page)};
}
// every animation to one time; twice, so animations a late layout pass starts (strata bugs) are caught too.
// A full-page capture flips (max-width: 800px) for a moment, so .bug--beside goes display:none and back and its animations are
// recreated mid-capture; the stylesheet makes any recreated animation start paused (pose fixed by its delay) instead of running.
const freeze=async(page,t=4000)=>{await page.addStyleTag({content:'*,*::before,*::after{animation-play-state:paused!important}'});for(let k=0;k<2;k++){await page.evaluate(t=>{for(const a of document.getAnimations()){a.pause();a.currentTime=t;}},t);await page.waitForTimeout(300);}};
const decode=async buf=>{const {data,info}=await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject:true});return {data,w:info.width,h:info.height};};
function pixDiff(a,b,tol=8){if(a.w!==b.w||a.h!==b.h)return {n:Infinity,frac:1};let n=0;for(let i=0;i<a.data.length;i+=3)if(Math.abs(a.data[i]-b.data[i])>tol||Math.abs(a.data[i+1]-b.data[i+1])>tol||Math.abs(a.data[i+2]-b.data[i+2])>tol)n++;return {n,frac:n/(a.w*a.h)};}
const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const SECTIONS={top:'.stage',about:'#about',work:'#work',gatherings:'#gatherings',news:'#news',network:'#network',support:'#support',footer:'.foot'};
async function run(name,fn){if(only&&!only.has(name))return;const t0=performance.now();console.log('== '+name);
  try{report.cases[name]=await fn(name)||{};}catch(e){fail(name,e.stack||String(e));report.cases[name]={error:String(e)};}
  report.cases[name].seconds=r1((performance.now()-t0)/1000);}

try{
// ---------------------------------------------------------------- every section in dark mode, WCAG AA text
await run('sections',async c=>{
  const res={};const shots={};
  for(const scheme of ['light','dark']){const {ctx,page,errors}=await open(ROUTE,{scheme});
    const H=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<H;y+=700){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(60);}await page.evaluate(()=>scrollTo(0,0));
    await page.waitForTimeout(500);await freeze(page);
    const full=await page.screenshot({fullPage:true});if(scheme==='dark')await writeFile(out+'/dark-full.png',full);else await writeFile(out+'/light-full.png',full);
    const boxes=await page.evaluate(S=>Object.fromEntries(Object.entries(S).map(([k,s])=>{const e=document.querySelector(s);if(!e)return [k,null];const r=e.getBoundingClientRect();return [k,{x:0,y:Math.round(r.top+scrollY),width:innerWidth,height:Math.round(Math.min(r.height,1400))}];})),SECTIONS);
    shots[scheme]={full:await decode(full),boxes};
    if(scheme==='dark'){
      for(const [k,b] of Object.entries(boxes))if(b)await sharp(full).extract({left:0,top:b.y,width:b.width,height:Math.min(b.height,shots.dark.full.h-b.y)}).toFile(out+`/dark-${k}.png`);
      // text contrast: text colour vs the painted background under it (the same page with every glyph transparent)
      const texts=await page.evaluate(()=>{const o=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
        while((n=w.nextNode())){if(!n.textContent.trim())continue;const el=n.parentElement;if(!el||el.closest('.scene,[aria-hidden="true"],script,style,noscript,template,dialog:not([open]),[hidden],.visually-hidden,.sr-only'))continue;
          const cs=getComputedStyle(el);if(cs.visibility!=='visible'||+cs.opacity===0)continue;const rg=document.createRange();rg.selectNodeContents(n);const r=rg.getBoundingClientRect();
          if(r.width<2||r.height<6)continue;let a=el,op=1;while(a){op*=+getComputedStyle(a).opacity;a=a.parentElement;}if(op<.05)continue;
          o.push({text:n.textContent.trim().slice(0,40),sel:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):''),color:cs.color,op,size:parseFloat(cs.fontSize),weight:+cs.fontWeight,r:{x:r.left,y:r.top+scrollY,w:r.width,h:r.height}});}
        return o;});
      await page.addStyleTag({content:'*,*::before,*::after{color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important;caret-color:transparent!important}input::placeholder,textarea::placeholder{color:transparent!important}'});
      await page.waitForTimeout(200);const bg=await decode(await page.screenshot({fullPage:true}));
      const bad=[];let checked=0;
      for(const t of texts){const m=t.color.match(/[\d.]+/g).map(Number),[cr,cg,cb]=m,ca=(m[3]??1)*t.op;const px=[];
        for(let y=Math.max(0,Math.floor(t.r.y));y<Math.min(bg.h,t.r.y+t.r.h);y+=2)for(let x=Math.max(0,Math.floor(t.r.x));x<Math.min(bg.w,t.r.x+t.r.w);x+=2){const i=(y*bg.w+x)*3;px.push([bg.data[i],bg.data[i+1],bg.data[i+2]]);}
        if(!px.length)continue;const med=[0,1,2].map(k=>pct(px.map(p=>p[k]),.5)),fg=[cr*ca+med[0]*(1-ca),cg*ca+med[1]*(1-ca),cb*ca+med[2]*(1-ca)];
        // worst case over the background under the text: the 10th and 90th percentile luminance pixels
        const byL=[...px].sort((a,b)=>lum(a)-lum(b)),lo=byL[Math.floor(byL.length*.1)],hi=byL[Math.floor(byL.length*.9)];
        const cr_=Math.min(ratio(fg,lo),ratio(fg,hi),ratio(fg,med)),large=t.size>=24||(t.size>=18.66&&t.weight>=700),need=large?3:4.5;checked++;
        if(cr_<need)bad.push({...t,ratio:+cr_.toFixed(2),need,bg:med.map(Math.round)});}
      res.text={checked,failures:bad.length,worst:bad.sort((a,b)=>a.ratio-b.ratio).slice(0,25)};
      check(c,checked>200,'only '+checked+' text runs found');check(c,bad.length===0,`${bad.length} text runs below WCAG AA, worst ${JSON.stringify(bad.slice(0,4))}`);
    }
    check(c,!errors.length,scheme+' page errors '+errors.join(' | '));await ctx.close();}
  // the whole page is designed dark: every section is clearly darker than by day
  res.sections={};
  for(const [k,b] of Object.entries(shots.dark.boxes)){if(!b)continue;const m=img=>{let s=0,n=0;for(let y=b.y;y<Math.min(img.h,b.y+b.height);y+=3)for(let x=0;x<img.w;x+=3){const i=(y*img.w+x)*3;s+=lum([img.data[i],img.data[i+1],img.data[i+2]]);n++;}return s/n;};
    const d=m(shots.dark.full),l=m(shots.light.full);res.sections[k]={darkLum:+d.toFixed(3),lightLum:+l.toFixed(3)};check(c,d<l*.8,`${k} is not dark (${d.toFixed(3)} vs ${l.toFixed(3)} by day)`);}
  return res;
});

// ---------------------------------------------------------------- critters: present, visible, animating, compositor-only
await run('critters',async c=>{
  const res={dark:{},light:{}};
  for(const scheme of ['dark','light']){const {ctx,page,errors,cdp}=await open(ROUTE,{scheme,h:947});
    const st=await page.evaluate(()=>{const vis=e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;
      const birds=[...document.querySelectorAll('.birds > .bird')].map(b=>{const n=b.querySelector('.hw-nface'),d=b.querySelector('.bird__face:not(.hw-nface)');
        return {cls:[...b.classList].find(k=>/^hw-n-\w+$/.test(k))||b.className.match(/bird--\w+/)[0],night:n?vis(n):null,day:vis(d),wings:n&&vis(n)?[...n.querySelectorAll('.bird__wing')].map(w=>w.getAnimations().filter(a=>a.playState==='running').length):null};});
      const walk=Object.fromEntries(['rabbit','raccoon'].map(k=>{const b=document.querySelector('.hw-nw-'+k);return [k,b?{shown:vis(b),anims:b.getAnimations({subtree:true}).filter(a=>a.playState==='running').map(a=>a.animationName)}:null];}));
      const ff=[...document.querySelectorAll('.bees > .bee')].map(b=>b.getAnimations({subtree:true}).filter(a=>a.playState==='running').map(a=>a.animationName+(a.effect.pseudoElement||'')));
      return {birds,walk,ff,lock:!!document.querySelector('meta[name="darkreader-lock"]'),scheme:getComputedStyle(document.documentElement).colorScheme};});
    res[scheme].state=st;
    if(scheme==='dark'){
      const want=[...NIGHT.cardinal,...NIGHT.jay,...NIGHT.goldfinch,...NIGHT.speck].filter(t=>t!=='day');
      check(c,st.birds.filter(b=>b.night).length===want.length&&st.birds.every(b=>b.night===null||!b.day),'night faces shown in place of the day birds: '+JSON.stringify(st.birds));
      check(c,st.birds.every(b=>!b.night||(b.wings.length===2&&b.wings.every(n=>n===1))),'every night critter beats both wings on the site flap');
      check(c,st.walk.rabbit?.shown&&st.walk.raccoon?.shown&&st.walk.raccoon.anims.length>=3&&st.walk.rabbit.anims.length>=3,'cottontail and raccoon walk at night '+JSON.stringify(st.walk));
      check(c,st.ff.length===FIREFLY.homes.length&&st.ff.every(a=>['hw-ff-drift','hw-ff-bob','hw-ff-lift'].every(n=>a.includes(n))&&a.some(n=>/^hw-ff-\d+::after$/.test(n))&&!a.includes('bee-wing')),'fireflies drift, bob, lift and flash, no bee wing-beat '+JSON.stringify(st.ff[0]));
      check(c,st.lock&&/dark/.test(st.scheme),'darkreader-lock and color-scheme under the dark preference');
    }else{
      check(c,st.birds.every(b=>b.day&&!b.night),'by day every bird is the site\'s own');
      check(c,st.walk.rabbit?.shown&&!st.walk.raccoon?.shown,'by day only the cottontail walks');
      check(c,st.ff.every(a=>a.some(n=>/^bee-\d/.test(n))&&a.includes('bee-wing')&&!a.some(n=>/hw-ff/.test(n))),'by day the bees are bees');
      check(c,!st.lock,'no darkreader-lock by day');
    }
    // visible in the page: bring each critter into view on its own path and compare with it hidden
    const items=await page.evaluate(()=>[...document.querySelectorAll('.birds > .bird.hw-night'),...document.querySelectorAll('.hw-nx-walkers > .bug'),...document.querySelectorAll('.bees > .bee')].map((e,i)=>{e.dataset.hwPv=i;return e.classList.contains('bee')?'firefly-'+i:(e.className.match(/hw-n-(\w+)-on-(\w+)/)||e.className.match(/hw-nw-(\w+)/)).slice(1).join('-on-')+'-'+i;}));
    res[scheme].visible={};await page.addStyleTag({content:'.top,.nav{visibility:hidden!important}'});   // the specks fly behind the header strip at some sizes
    for(const [i,label] of items.entries()){
      const box=await page.evaluate(({i,dark})=>{const e=document.querySelector(`[data-hw-pv="${i}"]`);const face=e.querySelector(dark&&e.classList.contains('bird')?'.hw-nface':e.classList.contains('bug')?'.bug__face':e.classList.contains('bee')?'.bee__face':'.bird__face');
        if(getComputedStyle(face).display==='none'||getComputedStyle(e).display==='none')return null;
        const all=document.getAnimations();for(const a of all)a.pause();
        const mine=e.getAnimations().find(a=>['fly','hw-rare-east','hw-rare-west','hw-ff-drift'].includes(a.animationName)||/^bee-\d/.test(a.animationName));
        const D=mine.effect.getComputedTiming().duration,vw=innerWidth;let best=null;
        for(const ok of [x=>(x>vw*.04&&x<vw*.26)||(x>vw*.76&&x<vw*.96),x=>x>vw*.04&&x<vw*.96]){for(let k=0;k<400&&best===null;k++){mine.currentTime=D*k/400;const r=face.getBoundingClientRect();if(r.width>0&&r.top>0&&ok(r.left+r.width/2))best=k;}if(best!==null)break;}
        if(best===null)return null;mine.currentTime=D*best/400;
        for(const a of all)if(/^hw-ff-\d/.test(a.animationName)){const kf=a.effect.getKeyframes().find(k=>+k.opacity===1);a.currentTime=kf.computedOffset*a.effect.getComputedTiming().duration;}
        const r=face.getBoundingClientRect();const m=e.classList.contains('bee')?40:8;return {x:Math.max(0,r.left-m),y:Math.max(0,r.top-m),width:Math.min(innerWidth-Math.max(0,r.left-m),r.width+2*m),height:r.height+2*m};},{i,dark:scheme==='dark'});
      if(!box){res[scheme].visible[label]='not shown';if(scheme==='dark'||/rabbit/.test(label))check(c,false,scheme+' '+label+' has no visible capture position');continue;}
      await page.waitForTimeout(120);const a=await page.screenshot({clip:box});
      await page.evaluate(i=>document.querySelector(`[data-hw-pv="${i}"]`).style.setProperty('visibility','hidden'),i);await page.waitForTimeout(120);
      const b=await page.screenshot({clip:box});await page.evaluate(i=>document.querySelector(`[data-hw-pv="${i}"]`).style.removeProperty('visibility'),i);
      const d=pixDiff(await decode(a),await decode(b),12);res[scheme].visible[label]=d.n;
      if(scheme==='dark'||/rabbit/.test(label))await sharp(a).resize({width:Math.round(box.width*4),kernel:'nearest'}).toFile(out+`/critter-${scheme}-${label}.png`);
      check(c,d.n>=12,`${scheme} ${label} is not visibly painted (${d.n} px)`);}
    await page.evaluate(()=>{for(const a of document.getAnimations())a.play();});
    // Explicit compositor failures and idle style/layout are separate evidence. Missing animation trace is unsupported.
    await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.animations,blink.user_timing',transferMode:'ReturnAsStream'});
    await page.reload({waitUntil:'load'});await page.waitForTimeout(6000);
    await cdp.send('Performance.enable');const M=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const m0=await M();await page.waitForTimeout(3000);const m1=await M();
    const expectedNames=await page.evaluate(()=>{performance.mark('hw-dark-compositor-owner');return document.getAnimations().filter(a=>a.playState==='running').map(a=>a.animationName).filter(Boolean);});
    const trace=JSON.parse(await finishCDPTrace(cdp));res[scheme].compositor=darkCompositeEvidence(trace.traceEvents||trace,expectedNames);
    check(c,res[scheme].compositor.valid,scheme+': compositor evidence missing or failed '+JSON.stringify(res[scheme].compositor));
    res[scheme].running=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length);
    res[scheme].idle3s={recalcStyle:m1.RecalcStyleCount-m0.RecalcStyleCount,layout:m1.LayoutCount-m0.LayoutCount,taskMs:Math.round((m1.TaskDuration-m0.TaskDuration)*1000)};
    check(c,res[scheme].idle3s.recalcStyle<=2&&res[scheme].idle3s.layout===0,scheme+': idle main-thread style/layout work '+JSON.stringify(res[scheme].idle3s));
    check(c,!errors.length,scheme+' page errors '+errors.join(' | '));await ctx.close();}
  return res;
});

// ---------------------------------------------------------------- creatures-preview.png: every critter large, by day (top) and by night (bottom), from the page's own markup and CSS
await run('preview',async c=>{
  const rows=[];
  for(const scheme of ['light','dark']){const {ctx,page,errors}=await open(ROUTE,{scheme,w:1340,h:520});
    const n=await page.evaluate(scheme=>{const q=s=>document.querySelector(s),cells=[];
      for(const k of ['barred','screech','moth','bat']){const b=q('.bird.hw-n-'+k),f=b.querySelector('.hw-nface').cloneNode(true);f.classList.remove('bird__face--left');cells.push([k==='barred'?'barred owl':k==='screech'?'screech owl':k==='moth'?'luna moth':'red bat',f,'bird hw-night hw-n-'+k,f.closest?getComputedStyle(b.querySelector('.bird__bob')).aspectRatio:'']);}
      for(const k of ['rabbit','raccoon']){const f=q('.hw-nwf-'+k).cloneNode(true);f.classList.remove('bug__face--left','hw-nwf-'+k);cells.push([k==='rabbit'?'cottontail':'raccoon',f,'bug',k==='rabbit'?'100 / 62':'100 / 60']);}
      const bee=q('.bees .bee__face').cloneNode(true);bee.classList.remove('bee__face--left');cells.push([scheme==='dark'?'firefly (flash)':'bee (day)',bee,'bee','11 / 6.6']);
      const st=document.createElement('style');st.textContent=`#pv{position:fixed;inset:0;z-index:99999;background:#222;display:flex;flex-wrap:wrap;gap:10px;padding:10px;align-content:flex-start;--u:1px}
#pv .cell{width:178px;height:150px;border-radius:5px;background:linear-gradient(90deg,var(--sky-left),var(--sky-right));position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
#pv .cell small{position:absolute;bottom:5px;left:0;right:0;text-align:center;font:600 12px system-ui,sans-serif;color:${scheme==='dark'?'#ece3c9':'#1e2a21'}}
#pv .box{position:relative;width:150px;animation:none!important;inset:auto!important;translate:none!important}
#pv .box .bird__face,#pv .box .bug__face{position:absolute!important;inset:0!important;width:100%!important;display:block!important;filter:drop-shadow(1px 2px 2px rgb(20 10 0/.35))}
#pv .bee.box{width:64px}#pv .bee.box .bee__face{position:absolute;inset:0}`;
      document.head.append(st);const pv=document.createElement('div');pv.id='pv';
      for(const [label,node,cls,ar] of cells){const cell=document.createElement('div');cell.className='cell';const box=document.createElement('div');box.className=cls+' box';box.style.aspectRatio=ar;if(cls==='bee')box.style.setProperty('--hw-ffk','hw-ff-1');box.append(node);cell.append(box);const s=document.createElement('small');s.textContent=label;cell.append(s);pv.append(cell);}
      document.body.append(pv);
      for(const a of document.getAnimations()){a.pause();a.currentTime=0;}
      for(const a of document.getAnimations())if(/^hw-ff-\d/.test(a.animationName)&&a.effect.target?.closest?.('#pv')){const k=a.effect.getKeyframes().find(k=>+k.opacity===1);a.currentTime=k.computedOffset*a.effect.getComputedTiming().duration;}
      return cells.length;},scheme);
    await page.waitForTimeout(250);rows.push(await page.screenshot({clip:{x:0,y:0,width:1340,height:170}}));
    check(c,n===7,'preview cells '+n);check(c,!errors.length,'page errors '+errors.join(' | '));await ctx.close();}
  await sharp({create:{width:1340,height:340,channels:3,background:'#222'}}).composite(rows.map((r,i)=>({input:r,top:i*170,left:0}))).png().toFile(out+'/creatures-preview.png');
  return {file:out+'/creatures-preview.png'};
});

// ---------------------------------------------------------------- fireflies: one clock, generated keyframes, off-screen hold, burst strips
await run('sync',async c=>{
  const {ctx,page,errors}=await open(ROUTE,{h:947});const res={};
  const read=()=>page.evaluate(()=>document.getAnimations().filter(a=>/^hw-ff-\d+$/.test(a.animationName)).map(a=>({n:+a.animationName.slice(6),start:a.startTime,cur:a.currentTime,state:a.playState,dur:a.effect.getComputedTiming().duration,delay:a.effect.getTiming().delay,kf:a.effect.getKeyframes().map(k=>[+k.computedOffset.toFixed(5),+k.opacity])})));
  let A=await read();
  check(c,A.length===FIREFLY.homes.length,'flash animations: '+A.length);
  check(c,new Set(A.map(a=>a.start)).size===1&&A.every(a=>a.delay===0&&a.state==='running'&&Math.abs(a.dur-T.super*1000)<1),'one clock: same start, no delay, '+r1(T.super)+' s each '+JSON.stringify(A.map(a=>[a.start,a.delay,a.dur])));
  for(const a of A){const want=T.flashes[a.n-1].flatMap(({t,s,f})=>[[t,0],[t+s,1],[t+s+f,0]]).map(([t,o])=>[+(+(t/T.super*100).toFixed(3)/100).toFixed(5),o]);
    const got=a.kf.filter(([o])=>o>0&&o<1);check(c,JSON.stringify(got)===JSON.stringify(want),`firefly ${a.n}: browser keyframes differ from fireflyTiming()`);}
  res.clock={start:A[0].start,durationS:r1(T.super),cycleS:+T.cycle.toFixed(2),order:FIREFLY.order};
  // off-screen: everything holds together; back on screen everything runs, still on one clock
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(500);
  A=await read();const held=A.every(a=>a.state==='paused')&&new Set(A.map(a=>Math.round(a.cur))).size===1;
  const heldAll=await page.evaluate(()=>[...document.querySelectorAll('.bees > .bee')].every(b=>b.getAnimations({subtree:true}).every(a=>a.playState==='paused')));
  await page.waitForTimeout(700);const A2=await read();check(c,held&&heldAll&&A2.every((a,i)=>a.cur===A[i].cur),'fireflies hold while the meadow is off-screen');
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(500);A=await read();
  check(c,A.every(a=>a.state==='running')&&new Set(A.map(a=>Math.round(a.cur))).size===1,'back on screen they run again on one clock');
  res.offscreen={held,heldAll};
  // frame strips of whole bursts on the shared clock (left-to-right, then centre-out)
  const stage=await page.evaluate(()=>{const r=document.querySelector('.stage').getBoundingClientRect();return {y:r.top+scrollY,h:r.height,w:r.width};});
  const clip={x:0,y:Math.round(stage.y+stage.h*.29),width:Math.round(stage.w),height:Math.round(stage.h*.14)};   // the meadow band the fireflies live in
  for(const b of [0,1]){const frames=[],t0=b*T.cycle+FIREFLY.lead-.3,t1=b*T.cycle+FIREFLY.lead+T.burst+FIREFLY.wave+.2;
    for(let t=t0;t<=t1+1e-9;t+=.1){await page.evaluate(t=>{for(const a of document.getAnimations()){a.pause();if(/^hw-ff-(\d+|lift)$/.test(a.animationName))a.currentTime=t*1000%(a.effect.getComputedTiming().duration);}},t);
      await page.waitForTimeout(40);frames.push(await page.screenshot({clip}));}
    const fh=clip.height,fw=clip.width;   // full resolution: the glow is judged at its real size
    await sharp({create:{width:fw,height:fh*frames.length,channels:3,background:'#000'}}).composite(frames.map((f,i)=>({input:f,top:i*fh,left:0}))).jpeg({quality:88}).toFile(out+`/firefly-burst-${b+1}-${FIREFLY.order[b]}.jpg`);
    res['strip'+(b+1)]={pattern:FIREFLY.order[b],frames:frames.length,stepMs:100};}
  // side by side over the top of the page: between bursts (left) and mid-burst (right), for judging distraction
  const atT=async t=>{await page.evaluate(t=>{for(const a of document.getAnimations()){a.pause();if(/^hw-ff-(\d+|lift)$/.test(a.animationName))a.currentTime=t*1000%a.effect.getComputedTiming().duration;}},t);await page.waitForTimeout(80);return page.screenshot();};
  const peakT=FIREFLY.lead+FIREFLY.wave/2+2*FIREFLY.interval+FIREFLY.swell;
  const off=await atT(T.cycle*.8),on=await atT(peakT),vp=page.viewportSize();
  await sharp({create:{width:vp.width*2+12,height:vp.height,channels:3,background:'#111'}}).composite([{input:off,left:0,top:0},{input:on,left:vp.width+12,top:0}]).png().toFile(out+'/firefly-peak-side-by-side.png');
  await sharp(on).extract({left:0,top:Math.round(vp.height*.3),width:vp.width,height:Math.round(vp.height*.2)}).resize({width:vp.width*2,kernel:'nearest'}).toFile(out+'/firefly-peak-zoom.png');
  res.sideBySide={betweenBurstsS:+(T.cycle*.8).toFixed(2),peakS:+peakT.toFixed(2)};
  check(c,!errors.length,'page errors '+errors.join(' | '));await ctx.close();return res;
});

// ---------------------------------------------------------------- fireflies never glow over words, buttons, chips or the header, at several window sizes
await run('placement',async c=>{
  const res={};
  for(const [w,h] of [[1365,900],[1440,900],[1920,1080],[1280,720],[1024,768],[1100,820],[390,844]]){
    const {ctx,page,errors}=await open(ROUTE,{w,h});
    const r=await page.evaluate(({halo,liftT})=>{
      const texts=[];const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
      while((n=tw.nextNode())){if(!n.textContent.trim())continue;const el=n.parentElement;if(!el||el.closest('.scene,script,style,noscript,template'))continue;if(getComputedStyle(el).visibility!=='visible')continue;
        const rg=document.createRange();rg.selectNodeContents(n);for(const q of rg.getClientRects())if(q.width>1&&q.height>4)texts.push({x:q.left,y:q.top,r:q.right,b:q.bottom,t:n.textContent.trim().slice(0,24)});}
      for(const el of document.querySelectorAll('header, .top, .nav, button:not(.leaf):not(.trunk), .btn, .chip, input'))if(!el.closest('.scene,.tree')){const q=el.getBoundingClientRect();if(q.width>1&&q.height>1&&getComputedStyle(el).visibility==='visible')texts.push({x:q.left,y:q.top,r:q.right,b:q.bottom,t:'<'+el.tagName.toLowerCase()+'.'+String(el.className).split(' ')[0]+'>'});}
      for(const a of document.getAnimations())a.pause();
      const bees=[...document.querySelectorAll('.bees > .bee')],hits=[],vis=new Set();let samples=0;
      const cb=document.querySelector('.bees').getBoundingClientRect(),cut=cb.top+cb.height*(1-.574);
      for(const f of [0,.31,.64,1])for(const bob of [0,1])for(const lift of [0,1])for(const b of bees){
        for(const a of b.getAnimations({subtree:true})){const D=a.effect.getComputedTiming().duration;
          if(a.animationName==='hw-ff-drift')a.currentTime=f*D;else if(a.animationName==='hw-ff-bob')a.currentTime=bob*D;else if(a.animationName==='hw-ff-lift')a.currentTime=lift?liftT:0;}
        const face=b.querySelector('.bee__face'),q=face.getBoundingClientRect(),left=getComputedStyle(face).scale.startsWith('-1');
        const cx=q.left+q.width*(left?.89:.11),cy=q.top+q.height/2,R=halo*q.width/2*.7;samples++;   // .7 R: where the halo has faded to ~0.1 of its peak
        if(cx+R<0||cx-R>innerWidth||cy+R<0||cy-R>innerHeight||cy-R>cut)continue;vis.add(b);
        for(const t of texts)if(cx+R>t.x&&cx-R<t.r&&cy+R>t.y&&cy-R<t.b){hits.push({ff:bees.indexOf(b)+1,t:t.t,drift:f,bob,lift,at:[Math.round(cx),Math.round(cy)]});break;}}
      return {hits:hits.slice(0,12),nHits:hits.length,samples,visible:vis.size,textBoxes:texts.length};},{halo:FIREFLY.halo,liftT:(FIREFLY.lead+T.burst*.55)*1000});
    res[w+'x'+h]=r;check(c,r.nHits===0,`${w}x${h}: a firefly halo overlaps text/controls ${JSON.stringify(r.hits.slice(0,3))}`);
    check(c,!errors.length,'page errors '+errors.join(' | '));await ctx.close();}
  return res;
});

// ---------------------------------------------------------------- Dark Reader and Chrome forced dark stand down
await run('standdown',async c=>{
  const res={};const shot=async o=>{const s=await open(o.route||ROUTE,o);await s.page.evaluate(()=>scrollTo(0,0));await freeze(s.page);await s.page.waitForTimeout(200);
    const st=await s.page.evaluate(()=>({drStyles:document.querySelectorAll('style.darkreader').length,drMode:document.documentElement.getAttribute('data-darkreader-mode'),lock:!!document.querySelector('meta[name="darkreader-lock"]'),pcsDark:matchMedia('(prefers-color-scheme: dark)').matches,cs:getComputedStyle(document.documentElement).colorScheme,inline:document.querySelectorAll('[data-darkreader-inline-bgcolor],[data-darkreader-inline-color]').length}));
    const img=await decode(await s.page.screenshot());await s.ctx.close();return {st,img,errors:s.errors};};
  const plain=await shot({}),dr=await shot({dr:true}),forced=await shot({forced:true,scheme:'no-override'});
  await sharp(plain.img.data,{raw:{width:plain.img.w,height:plain.img.h,channels:3}}).png().toFile(out+'/standdown-plain-dark.png');
  await sharp(dr.img.data,{raw:{width:dr.img.w,height:dr.img.h,channels:3}}).png().toFile(out+'/standdown-darkreader.png');
  await sharp(forced.img.data,{raw:{width:forced.img.w,height:forced.img.h,channels:3}}).png().toFile(out+'/standdown-forced-dark.png');
  res.darkReader={...dr.st,diff:pixDiff(plain.img,dr.img)};res.forced={...forced.st,diff:pixDiff(plain.img,forced.img)};
  check(c,dr.st.lock&&!dr.st.drStyles&&!dr.st.drMode&&!dr.st.inline,'Dark Reader stood down '+JSON.stringify(dr.st));
  check(c,res.darkReader.diff.frac<.001,'Dark Reader page differs from the designed dark page: '+JSON.stringify(res.darkReader.diff));
  check(c,forced.st.pcsDark&&/dark/.test(forced.st.cs),'forced dark reports the dark preference '+JSON.stringify(forced.st));
  check(c,res.forced.diff.frac<.001,'forced-dark page differs from the designed dark page: '+JSON.stringify(res.forced.diff));
  // controls: the same tools DO act on the plain taste page (so the harness can see them)
  const drT=await shot({route:TASTE,dr:true}),plainT=await shot({route:TASTE,scheme:'light'}),forcedT=await shot({route:TASTE,forced:true,scheme:'no-override'});
  res.controls={darkReaderStyles:drT.st.drStyles,forcedDiff:pixDiff(plainT.img,forcedT.img).frac};
  check(c,drT.st.drStyles>0,'control: Dark Reader inactive on the taste page, harness cannot see it');check(c,res.controls.forcedDiff>.2,'control: forced dark did not change the taste page');
  for(const s of [plain,dr,forced])check(c,!s.errors.length,'page errors '+s.errors.join(' | '));
  return res;
});

// ---------------------------------------------------------------- light mode: the taste build, cottontail apart
await run('light',async c=>{
  const res={};const shots=[];let rabbit=null;
  // [route, hide the walkers]: the taste build; the dark page with the walkers hidden; the dark page with NOTHING hidden (the stricter gate below)
  for(const [route,hide] of [[TASTE,false],[ROUTE,true],[ROUTE,false]]){const {ctx,page,errors}=await open(route,{scheme:'light'});
    const H=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<H;y+=700){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(60);}await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(500);
    if(hide){res.nightHidden=await page.evaluate(()=>[...document.querySelectorAll('.hw-nface,.hw-nw-raccoon')].every(e=>getComputedStyle(e).display==='none'));await page.addStyleTag({content:'.hw-nx-walkers{visibility:hidden!important}'});}
    await freeze(page);await page.waitForTimeout(200);shots.push(await decode(await page.screenshot({fullPage:true})));
    if(route===ROUTE&&!hide)rabbit=await page.evaluate(()=>{const f=document.querySelector('.hw-nw-rabbit .bug__face'),r=f&&f.getBoundingClientRect();return r&&{x:r.x+scrollX,y:r.y+scrollY,w:r.width,h:r.height};});   // the cottontail's own box, frozen at the shot's pose
    check(c,!errors.length,route+' page errors '+errors.join(' | '));await ctx.close();}
  // Stricter light gate: the dark page by day, nothing hidden, equals the taste build everywhere outside the cottontail's own box (4 px of margin for its shadow): 0 pixels over 8 levels.
  {const [A,,B]=shots;let n=0;const p=4;
   if(rabbit&&A.w===B.w&&A.h===B.h)for(let y=0;y<A.h;y++)for(let x=0;x<A.w;x++){if(x>=rabbit.x-p&&x<=rabbit.x+rabbit.w+p&&y>=rabbit.y-p&&y<=rabbit.y+rabbit.h+p)continue;const i=(y*A.w+x)*3;if(Math.max(Math.abs(A.data[i]-B.data[i]),Math.abs(A.data[i+1]-B.data[i+1]),Math.abs(A.data[i+2]-B.data[i+2]))>8)n++;}
   res.asIs={rabbitBox:rabbit,diffOutsideRabbit:rabbit&&A.w===B.w&&A.h===B.h?n:null,inside:pixDiff(A,B).n-n};
   check(c,rabbit!==null,'the cottontail is on the page by day');check(c,res.asIs.diffOutsideRabbit===0,'light mode, nothing hidden: pixels outside the cottontail differ from the taste build: '+JSON.stringify(res.asIs));
   shots.pop();}
  res.diff=pixDiff(shots[0],shots[1]);res.size=[shots[0].w,shots[0].h];
  {const [A,B]=shots;let x0=1e9,y0=1e9,x1=-1,y1=-1,mx=0;for(let y=0;y<A.h;y++)for(let x=0;x<A.w;x++){const i=(y*A.w+x)*3,d=Math.max(Math.abs(A.data[i]-B.data[i]),Math.abs(A.data[i+1]-B.data[i+1]),Math.abs(A.data[i+2]-B.data[i+2]));if(d>8){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);mx=Math.max(mx,d);}}
   if(x1>=0){res.diffBox={x:x0,y:y0,w:x1-x0+1,h:y1-y0+1,maxDelta:mx};const pad=30,l=Math.max(0,x0-pad),t=Math.max(0,y0-pad),w=Math.min(A.w-l,x1-x0+1+2*pad),h=Math.min(A.h-t,y1-y0+1+2*pad);
     const crop=async(img,n)=>sharp(img.data,{raw:{width:img.w,height:img.h,channels:3}}).extract({left:l,top:t,width:w,height:h}).png().toFile(out+'/light-diff-'+n+'.png');await crop(A,'taste');await crop(B,'taste-dark');}}
  check(c,res.nightHidden,'night art hidden by day');
  check(c,res.diff.frac<1e-5,'light mode differs from the taste build: '+JSON.stringify(res.diff)+' at '+JSON.stringify(res.diffBox));
  return res;
});

// ---------------------------------------------------------------- lag budgets (dark, with light beside it)
await run('lag',async c=>{
  const rows=[];
  // dark is gated; light taste and the faithful page are measured beside it as references
  for(const [w,h,dpr] of [[1424,820,2],[1365,768,1]])for(const [route,scheme] of [[ROUTE,'dark'],[ROUTE,'light'],['/optimized/','light']])for(const sweep of ['canopy','network','scroll']){
    const {ctx,page,errors}=await open(route,{scheme,w,h,dpr});
    const geo=await page.evaluate(sweep=>{if(sweep==='network')document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'});else scrollTo(0,0);
      const r=document.querySelector(sweep==='network'?'#net .net__stage':'.tree').getBoundingClientRect();return {L:Math.max(4,r.left+r.width*.3),R:Math.min(innerWidth-4,r.right-r.width*.3),T:Math.max(4,r.top+r.height*.06),B:Math.min(innerHeight-4,r.top+r.height*(sweep==='network'?.94:.3))};},sweep);
    await page.mouse.move(2,2);await page.waitForTimeout(400);
    await page.evaluate(()=>{const p=window.__p={startMs:performance.now(),frames:[],inputs:[],run:true};const tick=t=>{const f={raf:t,now:performance.now(),done:0};p.frames.push(f);const ch=new MessageChannel();ch.port1.onmessage=()=>{f.done=performance.now();ch.port1.close();ch.port2.close();};ch.port2.postMessage(0);if(p.run)p.raf=requestAnimationFrame(tick);};p.raf=requestAnimationFrame(tick);
      p.on=e=>p.inputs.push([performance.now(),e.timeStamp]);for(const t of ['pointermove','wheel'])addEventListener(t,p.on,{capture:true,passive:true});});
    const t0=performance.now();let i=0;
    while(performance.now()-t0<4000){const t=(performance.now()-t0)/1000;
      if(sweep==='scroll'){await page.mouse.wheel(0,(Math.floor(t/2)%2?-1:1)*120);}
      else await page.mouse.move(geo.L+(geo.R-geo.L)*(.5+.48*Math.sin(t*Math.PI*1.7)),geo.T+(geo.B-geo.T)*(.5+.45*Math.sin(t*Math.PI*2.9)));
      i++;await new Promise(r=>setTimeout(r,sweep==='scroll'?40:12));}
    await page.waitForTimeout(150);
    const d=await page.evaluate(()=>{const p=window.__p;p.run=false;cancelAnimationFrame(p.raf);for(const t of ['pointermove','wheel'])removeEventListener(t,p.on,{capture:true});return {startMs:p.startMs,endMs:performance.now(),frames:p.frames,inputs:p.inputs};});
    const row={size:`${w}x${h}@${dpr}`,page:route===ROUTE?'taste-dark':'faithful',scheme,sweep,...analyzeDarkTiming({...d,sent:i})};
    rows.push(row);console.log(JSON.stringify({...row,window:undefined}));
    check(c,row.valid,row.size+' '+scheme+' '+sweep+': '+row.issues.join('; '));
    if(scheme==='dark')for(const issue of darkTimingProblems(row))check(c,false,row.size+' '+sweep+': '+issue);
    check(c,!errors.length,'page errors '+errors.join(' | '));await ctx.close();}
  // Reference rows diagnose regressions; every dark sweep, including scroll, uses the absolute gates above.
  return {rows};
});

// ---------------------------------------------------------------- leaks: scheme flips, hovers, scrolls, a leaf panel
await run('leaks',async c=>{
  // 30 cycles of hovers, a leaf panel opened and closed, scroll to the bottom and back; once flipping light/dark every cycle, once in light only (control)
  const session=async flip=>{const {ctx,page,errors,cdp}=await open(ROUTE,{h:900,scheme:flip?'dark':'light'});
    const counters=async()=>{await cdp.send('HeapProfiler.collectGarbage');return (await cdp.send('Memory.getDOMCounters'));};
    const cycle=async k=>{if(flip)await page.emulateMedia({colorScheme:k%2?'light':'dark'});await page.evaluate(()=>scrollTo(0,0));
      const L=await page.evaluate(()=>[...document.querySelectorAll('.tree button.leaf')].slice(0,40).map(b=>{const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];}).filter(([x,y])=>y>0&&y<innerHeight));
      for(const p of L.slice(0,8))await page.mouse.move(...p);
      await page.mouse.click(...L[k%L.length]);await page.waitForTimeout(250);await page.keyboard.press('Escape');await page.waitForTimeout(250);
      await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(120);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(120);};
    const settle=async()=>{if(flip)await page.emulateMedia({colorScheme:'dark'});await page.mouse.move(1,1);await page.waitForTimeout(400);};
    for(let k=0;k<4;k++)await cycle(k);await settle();const before=await counters();
    for(let k=0;k<30;k++)await cycle(k);await settle();const after=await counters();
    const locks=await page.evaluate(()=>document.querySelectorAll('meta[name="darkreader-lock"]').length);
    check(c,!errors.length,'page errors '+errors.join(' | '));await ctx.close();
    return {before,after,grew:{nodes:after.nodes-before.nodes,listeners:after.jsEventListeners-before.jsEventListeners,documents:after.documents-before.documents},locks};};
  const flip=await session(true),light=await session(false);const res={flip,light};
  check(c,flip.locks===1,'one darkreader-lock after 34 scheme flips ('+flip.locks+')');check(c,light.locks===0,'no lock by day');
  for(const issue of darkLeakProblems(flip.grew))check(c,false,issue+'; dark '+JSON.stringify(flip.grew)+'; light reference '+JSON.stringify(light.grew));
  return res;
});

// ---------------------------------------------------------------- idle: dark costs no more than light (renderer, compositor, viz, GPU busy time)
await run('idle',async c=>{
  const res={top:{dark:[],light:[]},below:{dark:[],light:[]}};
  const busy=async(scheme,where)=>{const {ctx,page,errors}=await open(ROUTE,{scheme,h:947});await page.mouse.move(1,1);
    if(where==='below')await page.evaluate(()=>scrollTo(0,document.querySelector('#about').getBoundingClientRect().top+scrollY+400));await page.waitForTimeout(1500);
    const s=await ctx.newCDPSession(page);
    await s.send('Tracing.start',{categories:'toplevel,disabled-by-default-devtools.timeline',transferMode:'ReturnAsStream'});await page.waitForTimeout(5000);
    const trace=await finishCDPTrace(s);
    const ev=JSON.parse(trace);const events=ev.traceEvents||ev,names={};check(c,Array.isArray(events)&&events.length>0,'idle trace is empty');for(const e of events)if(e.ph==='M'&&e.name==='thread_name')names[e.pid+':'+e.tid]=e.args.name;
    const by={};for(const e of events)if(e.ph==='X'&&e.dur&&/^(ThreadControllerImpl::RunTask|ThreadPool_RunTask|RunTask)$/.test(e.name)){const n=names[e.pid+':'+e.tid]||'?';if(/^(CrRendererMain|Compositor|VizCompositorThread|CrGpuMain)$/.test(n))by[n]=(by[n]||0)+e.dur/1000;}
    check(c,Object.keys(by).length>0,'idle trace contains no measured renderer/compositor tasks');
    for(const k in by)by[k]=r1(by[k]/5);by.total=r1(Object.values(by).reduce((a,b)=>a+b,0));
    check(c,!errors.length,'page errors '+errors.join(' | '));await ctx.close();return by;};
  for(let k=0;k<3;k++)for(const where of ['top','below'])for(const scheme of k%2?['light','dark']:['dark','light'])res[where][scheme].push(await busy(scheme,where));
  for(const where of ['top','below']){const m=s=>pct(res[where][s].map(r=>r.total),.5);res[where].medianMsPerS={dark:m('dark'),light:m('light')};
    check(c,m('dark')<=m('light')*1.1+1,`${where}: idle dark ${m('dark')} ms/s vs light ${m('light')} ms/s`);}
  return res;
});
}finally{
  if(forcedB)await forcedB.close().catch(()=>{});
  if(!Object.keys(report.cases).length)fail('selection','No cases executed');
  await writeFile(out+'/report.json',JSON.stringify(report,null,1));
  await fx.close();
}
console.log(JSON.stringify({failures:report.failures.length,report:out+'/report.json'}));
if(report.failures.length)process.exitCode=1;
