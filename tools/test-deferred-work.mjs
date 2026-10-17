// Deferred work must be invisible: after the nastiest scrolling a visitor can do (fling down/up, Home, End, instant jumps, a jump to every section, 20 rapid
// alternating jumps) and a settle, the page must be indistinguishable from a fresh load at the same position. Everything the build defers (lazy images, the
// scheduled stone-clearing pass, leaf-out, network centring, media recovery) is asserted to have caught up.
//   node tools/test-deferred-work.mjs [--only completeness|recovery|completeness,recovery] [--list]
// Ordinary completeness is the default. The existing abort/recovery fixture is
// explicit opt-in; it is never silently included in a normal acceptance run.
// "Every manifest asset loaded" = every css/js/ico asset in the route manifest and the woff2 faces covering U+0000-00FF were fetched (other faces load only on demand); images near each observed destination complete naturally (no eager/decode intervention) (images ship as srcset
// variants, so one viewport loads one variant per picture, never all of them). The stone-clearing comparison covers the strata the scheduler owns at the
// final position (within one viewport above and two below), because strata far away are never prepared by design.
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {PNG} from './fidelity-deps.mjs';
import pixelmatch from './fidelity-deps.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectDeferredChecks,observeDeferredDestination} from './deferred-work-checks.mjs';

const options=browserToolCLI({only:{type:'string'},list:{type:'boolean'}});
const selected=selectDeferredChecks(options.only);
if(options.list){console.log('completeness: natural image completion, every section comparison, narrow Network centring');console.log('recovery: explicit existing WebP-abort recovery fixture');process.exit(0);}
const route=process.env.HW_ROUTE||'optimized',out=resolve(process.env.HW_OUT||'output/playwright/deferred-work');
await mkdir(out,{recursive:true});
const siteRoot=process.env.HW_SITE_ROOT||resolve('publish'),manifest=JSON.parse(await readFile(resolve(siteRoot,route,'manifest.json'),'utf8'));
const identity=async()=>createHash('sha256').update(await readFile(resolve(siteRoot,route,'index.html'))).digest('hex');
const htmlSha256=await identity();assert.equal(htmlSha256,manifest.htmlSha256,'HTML/manifest identity mismatch before deferred acceptance');
const fixture=await browserFixture(),report={browser:fixture.browser.version(),route,siteRoot,htmlSha256,selected,notRun:['completeness','recovery'].filter(s=>!selected.includes(s)),checks:{},sections:[],visualFailures:[]};
const VIEW={width:1365,height:768},SECTIONS=['about','work','gatherings','news','network','support'];
const ok=(name,value)=>{report.checks[name]=value;console.log('PASS',name,typeof value==='object'?JSON.stringify(value).slice(0,200):value);};
// BEGIN independent visual ledger
function recordVisualResult(row){
  report.sections.push(row);
  if(row.outsideHeaderDiffPixels!==0){
    const failure={id:row.id,outsideHeaderDiffPixels:row.outsideHeaderDiffPixels,message:row.id+': first observed stressed screenshot differs outside the header'};
    report.visualFailures.push(failure);console.error('FAIL '+failure.message+' ('+failure.outsideHeaderDiffPixels+' pixels)');
  }else ok(row.id+': original stressed arrival equals untouched ordinary first arrival',row);
}
function assertVisualResults(){
  assert.deepEqual(report.visualFailures,[],'Independent destination visual failures; every outside-header diff must remain zero');
}
// END independent visual ledger
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Fonts and ordinary scheduled layout settle without altering native image loading.
const settle=async page=>{
  await page.evaluate(async()=>{await document.fonts.ready;document.documentElement.style.scrollBehavior='auto';});
  await page.waitForFunction(()=>!window.leafLift?.busy(),null,{timeout:10000});
  await page.waitForTimeout(2500);
};
const arrive=async(page,id)=>{
  const y=await page.evaluate(id=>{
    const el=document.getElementById(id);if(!el)throw Error('Missing section '+id);
    const target=id==='top'?0:el.getBoundingClientRect().top+scrollY-(id==='gatherings'?218:0);
    const y=Math.max(0,Math.min(Math.round(target),document.documentElement.scrollHeight-innerHeight));
    scrollTo({top:y,behavior:'instant'});return y;
  },id);
  await page.waitForFunction(y=>Math.abs(scrollY-y)<=1,y,{timeout:10000});return y;
};
const read=page=>page.evaluate(()=>{
  const h=document.documentElement.clientHeight,strata=[...document.querySelectorAll('.deep .stratum')];
  const near=strata.map((st,i)=>({st,i,r:st.getBoundingClientRect()})).filter(({r})=>r.bottom>=-h&&r.top<=h*2);
  const leaves=[...document.querySelectorAll('.tree button.leaf[data-leaf]')],fills=[...document.querySelectorAll('.tree .leaf.fill')];
  const shown=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none'&&Number(c.opacity)>0;};
  const net=document.getElementById('net'),cover=document.querySelector('.issue__cover img');
  return {
    scrollY,
    leaves:leaves.length,leavesShown:leaves.filter(shown).length,fills:fills.length,fillsShown:fills.filter(shown).length,
    leafOutRunning:document.getAnimations().filter(a=>a.animationName==='leaf-out'&&a.playState!=='finished').length,
    cleared:near.flatMap(({st,i})=>[...st.querySelectorAll('.stones > i')].map((bit,j)=>bit.classList.contains('is-cleared')?i+':'+j:null).filter(Boolean)),
    nearStrata:near.map(n=>n.i),
    netOffset:net.scrollLeft,netCentre:(net.scrollWidth-net.clientWidth)/2,
    cover:cover?{complete:cover.complete,w:cover.naturalWidth,src:cover.currentSrc.split('/').pop()}:null,
    brokenImages:[...document.images].filter(i=>!(i.complete&&i.naturalWidth>0)).map(i=>i.currentSrc||i.src),
    infinite:document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime===Infinity).map(a=>({n:a.animationName||a.transitionProperty,t:a.effect.target?.className?.toString?.().replace(/hw-s-\w+/g,'').trim()||a.effect.target?.tagName,start:a.startTime,state:a.playState}))
  };
});
// Pause every animation at t=4000 (as tools/test-rendered-output.mjs does), then capture.
const freezeShot=async page=>{
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(async a=>{a.pause();await a.ready;a.currentTime=4000;}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  return PNG.sync.read(await page.screenshot());
};
const wheel=async(page,total,steps,gap=8)=>{for(let i=0;i<steps;i++){await page.mouse.wheel(0,total/steps);await sleep(gap);}};

try{
 if(selected.includes('completeness')){
  const css=await readFile(resolve(siteRoot,route,'assets',manifest.assets.find(a=>/^heartwood\.[0-9a-f]+\.css$/.test(a.file)).file),'utf8');
  const latin=[...css.matchAll(/@font-face\s*\{[^}]*?url\(\.\/([^)]+\.woff2)\)[^}]*?unicode-range:\s*([^;}]*)/g)].filter(m=>/U\+0000-00FF/.test(m[2])).map(m=>m[1]);
  const must=manifest.assets.filter(a=>!a.file.startsWith('.precompressed/')&&(/\.(css|js|ico)$/.test(a.file)||latin.includes(a.file)));
  const watched=async()=>{
    const context=await fixture.browser.newContext({viewport:VIEW,deviceScaleFactor:1,reducedMotion:'no-preference'}),page=await context.newPage();
    const data={context,page,failed:[],bad:[],errors:[],fetched:new Set()};
    page.on('requestfailed',r=>data.failed.push(r.url()+' '+r.failure()?.errorText));
    page.on('response',r=>{data.fetched.add(new URL(r.url()).pathname);if(r.status()>=400)data.bad.push(r.status()+' '+r.url());});
    page.on('pageerror',e=>data.errors.push('pageerror: '+e.message));
    page.on('console',m=>{if(m.type()==='error')data.errors.push('console: '+m.text());});
    return data;
  };
  const networkClean=(data,label)=>{
    assert.deepEqual(data.failed,[],label+': failed requests');assert.deepEqual(data.bad,[],label+': HTTP errors');assert.deepEqual(data.errors,[],label+': console/page errors');
  };
  // Each destination gets its own stressed page and its own ordinary FIRST-
  // ARRIVAL reference. No page is warmed by a tour after its final arrival.
  // Gatherings is observed first, retaining the original regression destination.
  for(const id of ['gatherings','top',...SECTIONS.filter(s=>s!=='gatherings')]){
    const stress=await watched();let reference;
    try{
      const page=stress.page;
      await page.goto(fixture.base+'/'+route+'/',{waitUntil:'load'});await page.waitForTimeout(1500);
      const before=await read(page),H=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
      await page.mouse.move(40,400);
      await wheel(page,H*1.2,30);await wheel(page,-H*1.2,30);
      await page.keyboard.press('End');await sleep(300);await page.keyboard.press('Home');await sleep(300);
      for(const f of [.9,.15,.62,.33,.97,.05,.48,.71])await page.evaluate(f=>scrollTo({top:f*(document.documentElement.scrollHeight-innerHeight),behavior:'instant'}),f);
      for(const section of ['top',...SECTIONS]){await page.evaluate(section=>{location.hash='#'+section;},section);await page.waitForTimeout(450);}
      for(let i=0;i<20;i++){await page.evaluate(i=>{const el=document.getElementById(['top','network','news','about','support','gatherings','work'][i%7]);scrollTo({top:i%2?document.documentElement.scrollHeight:el.getBoundingClientRect().top+scrollY,behavior:'instant'});},i);await sleep(40);}
      await page.mouse.move(2,2);const y=await arrive(page,id);
      // This is the FIRST post-stress observation. Only waiting and inspection
      // occur before state/capture; no new arrival, tour, eager mode or decode.
      const observed=await observeDeferredDestination(page,{label:'stressed '+id,settle,read,capture:freezeShot,scope:'near'});
      const after=observed.state;
      assert.equal(after.scrollY,y,id+': destination moved after stressed arrival');
      assert.equal(after.leaves,149);assert.equal(after.leavesShown,149);assert(after.fills>0);assert.equal(after.fillsShown,after.fills);assert.equal(after.leafOutRunning,0);
      assert(Math.abs(after.netOffset-after.netCentre)<=1,id+': Network not centred after stress');
      assert.equal(after.infinite.length,before.infinite.length,id+': infinite animation count changed');
      const moved=after.infinite.filter((a,i)=>a.start!==before.infinite[i].start||a.state!=='running'||a.n!==before.infinite[i].n);assert.deepEqual(moved,[],id+': critter animation restarted or paused before observation');
      if(id==='news')assert(after.cover&&after.cover.complete&&after.cover.w>0,'newsletter cover incomplete on stressed News arrival');
      networkClean(stress,'stressed '+id);
      const missing=must.filter(a=>![...stress.fetched].some(path=>path.endsWith('/'+a.file)));assert.deepEqual(missing.map(a=>a.file),[],id+': required css/js/ico/Latin fonts never fetched');
      await writeFile(resolve(out,id+'-stressed.png'),PNG.sync.write(observed.shot));
      // The reference has no prior section navigation. It is created only after
      // the stressed state/frame were saved, and arrives at this destination once.
      reference=await watched();const fresh=reference.page;
      await fresh.goto(fixture.base+'/'+route+'/',{waitUntil:'load'});await fresh.mouse.move(2,2);await arrive(fresh,id);
      const ordinary=await observeDeferredDestination(fresh,{label:'ordinary first arrival '+id,settle,read,capture:freezeShot,scope:'near'});
      networkClean(reference,'ordinary '+id);const base=ordinary.state;
      assert.equal(base.scrollY,after.scrollY);assert.deepEqual(after.nearStrata,base.nearStrata);assert.deepEqual(after.cleared,base.cleared,id+': scheduled stones differ from ordinary FIRST arrival');
      const a=observed.shot,b=ordinary.shot;assert.equal(a.width,b.width);assert.equal(a.height,b.height);
      const hdr=await page.evaluate(()=>{const r=document.getElementById('top').getBoundingClientRect();return [r.left,r.top,r.right,r.bottom].map(Math.round);});
      const diff=new PNG({width:a.width,height:a.height});pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:0});
      let px=0,pxHeader=0;for(let i=0;i<diff.data.length;i+=4)if(diff.data[i]===255&&diff.data[i+1]===0&&diff.data[i+2]===0){const p=i/4,x=p%a.width,y=Math.floor(p/a.width);if(x>=hdr[0]&&x<hdr[2]&&y>=hdr[1]&&y<hdr[3])pxHeader++;else px++;}
      await writeFile(resolve(out,id+'-fresh.png'),PNG.sync.write(b));if(px)await writeFile(resolve(out,id+'-diff.png'),PNG.sync.write(diff));
      const row={id,y,pixels:a.width*a.height,outsideHeaderDiffPixels:px,headerOnlyDiffPixels:pxHeader,nearStrata:after.nearStrata,cleared:after.cleared.length,imageScope:'near: one viewport above, two below',stressedNaturalImages:observed.naturalImages,referenceNaturalImages:ordinary.naturalImages,stressedUnreadyOffscreenImages:after.brokenImages,referenceUnreadyOffscreenImages:base.brokenImages,referenceNavigation:'fresh context; exactly one destination arrival',postStressNavigationBeforeObservation:0};
      recordVisualResult(row);
    }finally{if(reference)await reference.context.close();await stress.context.close();}
  }
 }

  // ---------- 3. media recovery after an aborted image ----------
 if(selected.includes('recovery')){
  const ctx3=await fixture.browser.newContext({viewport:VIEW,reducedMotion:'no-preference'}),rec=await ctx3.newPage();let aborted=0;
  await ctx3.route(/fall-2026-\d+\.[0-9a-f]+\.webp$/,r=>{aborted++;return r.abort();});
  await rec.goto(`${fixture.base}/${route}/`,{waitUntil:'load'});
  await rec.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';document.getElementById('news').scrollIntoView({behavior:'instant'});});
  await rec.waitForFunction(()=>{const i=document.querySelector('.issue__cover img');return i&&i.complete&&i.naturalWidth>0;},null,{timeout:10000});
  const rc=await rec.evaluate(()=>{const i=document.querySelector('.issue__cover img');return {src:i.currentSrc.split('/').pop(),sources:i.closest('picture')?.querySelectorAll('source').length};});
  assert(aborted>0,'the webp request was never aborted: the test did not exercise recovery');assert(/^Fall-2026\./.test(rc.src)&&rc.sources===0,'recovery should fall back to the original image: '+JSON.stringify(rc));ok('media recovery after an aborted image',{aborted,...rc});
  await ctx3.close();
 }
  // ---------- 4. network centring where the network actually scrolls (it does not at 1365) ----------
 if(selected.includes('completeness')){
  const ctx4=await fixture.browser.newContext({viewport:{width:390,height:844},reducedMotion:'no-preference'}),nar=await ctx4.newPage();
  await nar.goto(`${fixture.base}/${route}/`,{waitUntil:'load'});await nar.waitForTimeout(500);
  for(const f of [1,0,.5])await nar.evaluate(f=>scrollTo({top:f*(document.documentElement.scrollHeight-innerHeight),behavior:'instant'}),f);   // fling past the network both ways
  await nar.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';document.getElementById('network').scrollIntoView({behavior:'instant'});});await nar.waitForTimeout(1500);
  const nc=await nar.evaluate(()=>{const n=document.getElementById('net');return {offset:n.scrollLeft,centre:(n.scrollWidth-n.clientWidth)/2};});
  assert(nc.centre>0&&Math.abs(nc.offset-nc.centre)<=1,'network not centred at 390: '+JSON.stringify(nc));ok('network centred at 390 after jumps',nc);await ctx4.close();
 }
  assert.equal(await identity(),htmlSha256,'Artifact changed during deferred acceptance; discard this run');
  if(selected.includes('completeness'))assert.deepEqual(report.sections.map(row=>row.id),['gatherings','top',...SECTIONS.filter(id=>id!=='gatherings')],'Independent destination coverage incomplete');
  assertVisualResults();
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,1));
  console.log('\ndeferred-work suite: OK');
}catch(e){report.failure=e.message;await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,1)).catch(()=>{});throw e;}
finally{await fixture.close();}
