// Real pointer stress on the served artifact. `original` loads /local/; `shipped` is the
// optimized route; other variants are CSS experiments, never acceptance.
import {browserFixture,finishCDPTrace,browserToolCLI} from './browser-test-lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {assertHoverCoverage} from './fidelity-acceptance.mjs';

browserToolCLI({});
const out=resolve(process.env.HW_OUT||'output/playwright/hover-profile');
await mkdir(out,{recursive:true});
const seconds=Number(process.env.HW_SECONDS||5);
if(!Number.isFinite(seconds)||seconds<1)throw Error('HW_SECONDS must be at least1 for meaningful canopy coverage');
// Variants that promoted `.tree button.leaf` were removed: the shipped build already wraps each leaf in a promoted layer, so they would double-promote.
const known=new Set(['original','shipped','no-tag','face-layers','tree-layer','scene-layer','tree-filter','tree-contain','tree-isolate','wood-layers','fill-layers','scene-filter','no-z-index','no-grain','no-transition','tag-contain','no-filter']);
const variants=(process.env.HW_HOVER_VARIANTS??'original,shipped').split(',').map(v=>v.trim());for(const v of variants)if(!known.has(v))throw Error(`Unknown HW_HOVER_VARIANTS entry "${v}"; known: ${[...known].join(',')}`);
const activities=(process.env.HW_ACTIVITIES??'true-idle,idle,sweep').split(',').map(v=>v.trim());
for(const activity of activities)if(!['true-idle','idle','sweep'].includes(activity))throw Error('Unknown HW_ACTIVITIES entry '+JSON.stringify(activity));
if(new Set(variants).size!==variants.length||new Set(activities).size!==activities.length)throw Error('Duplicate profiler selection');
const dpr=Number(process.env.HW_DPR??2),cpuRate=Number(process.env.HW_CPU??1);
if(!Number.isFinite(dpr)||dpr<=0||!Number.isFinite(cpuRate)||cpuRate<1)throw Error('HW_DPR must be positive and HW_CPU at least1, both finite');
const htmlSha256=createHash('sha256').update(await readFile(resolve(process.env.HW_SITE_ROOT||'publish','optimized/index.html'))).digest('hex');
const fixture=await browserFixture();
const report={browser:fixture.browser.version(),engine:fixture.engine,viewport:{width:1424,height:820},dpr,cpuRate,seconds,htmlSha256,cases:[]};
try {
const browserSession=await fixture.browser.newBrowserCDPSession();
const gpuInfo=await browserSession.send('SystemInfo.getInfo');
report.gpu={devices:gpuInfo.gpu.devices,featureStatus:gpuInfo.gpu.featureStatus,auxAttributes:gpuInfo.gpu.auxAttributes};
report.headless=process.env.HW_HEADLESS!=='0';
console.log(JSON.stringify({gpu:report.gpu.devices,features:report.gpu.featureStatus,headless:report.headless}));
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))]??0;
for(const variant of variants){
  const context=await fixture.browser.newContext({viewport:report.viewport,deviceScaleFactor:report.dpr,bypassCSP:variant!=='shipped'&&variant!=='original'});
  try{
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(variant==='no-tag')await page.route('**/content.*.js',async route=>{const response=await route.fetch({timeout:30000});const text=await response.text();if(!text.includes('function showTag(leaf) {'))throw Error('Tag diagnostic no longer matches');await route.fulfill({response,body:text.replace('function showTag(leaf) {','function showTag(leaf) { return;')});});
    await page.goto(`${fixture.base}/${variant==='original'?'local':'optimized'}/`,{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(4000);
    if(variant==='face-layers')await page.addStyleTag({content:'.tree button.leaf .leaf__face{will-change:transform}'});
    if(variant==='tree-layer')await page.addStyleTag({content:'.tree{will-change:transform}'});
    if(variant==='scene-layer')await page.addStyleTag({content:'.scene{will-change:transform}'});
    if(variant==='tree-filter')await page.addStyleTag({content:'.tree{filter:opacity(1)}'});
    if(variant==='tree-contain')await page.addStyleTag({content:'.tree{contain:paint}'});
    if(variant==='tree-isolate')await page.addStyleTag({content:'.tree{isolation:isolate}'});
    if(variant==='wood-layers')await page.addStyleTag({content:'.tree>.cut{will-change:transform}'});
    if(variant==='fill-layers')await page.addStyleTag({content:'.tree>.cut,.tree>.leaf.fill{will-change:transform}'});
    if(variant==='scene-filter')await page.addStyleTag({content:'.scene{filter:opacity(1)}'});
    if(variant==='no-z-index')await page.addStyleTag({content:'.tree button.leaf:hover{z-index:auto}'});
    if(variant==='no-grain')await page.addStyleTag({content:'.tree .leaf__top{background:var(--a)}'});
    if(variant==='no-transition')await page.addStyleTag({content:'.tree button.leaf{transition:none}'});
    if(variant==='tag-contain')await page.addStyleTag({content:'.leaftag{contain:layout style}'});
    if(variant==='no-filter')await page.addStyleTag({content:'.tree button.leaf{filter:none!important}'});
    const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:report.cpuRate});
    let layers=[];if(process.env.HW_LAYERS==='1'){cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers||[];});await cdp.send('LayerTree.enable');}
    const bounds=await page.evaluate(()=>{const leaves=[...document.querySelectorAll('button.leaf[data-item]')].map(l=>l.getBoundingClientRect());return {left:Math.min(...leaves.map(r=>r.left)),right:Math.max(...leaves.map(r=>r.right)),top:Math.max(90,Math.min(...leaves.map(r=>r.top))),bottom:Math.min(innerHeight-20,Math.max(...leaves.map(r=>r.bottom)))};});
    const entry=await page.evaluate(()=>{const f=document.querySelector('main.frame')?.getBoundingClientRect(),out={x:innerWidth/2,y:Math.max(2,Math.min(f?f.top:20,40)/2)};for(let y=innerHeight*.35;y>100;y-=8)for(let x=innerWidth*.5;x<innerWidth*.68;x+=8)if(document.elementFromPoint(x,y)?.closest('button.leaf[data-item]'))return{out,leaf:{x,y}};return{out,leaf:{x:innerWidth/2,y:innerHeight/3}};});
    // true-idle runs no rAF probe and no pointer input; the probed `idle` keeps a rAF loop that forces a main frame (and re-layerization) every vsync, so its TaskDuration is the per-frame cost at 60 fps, not idle cost.
    for(const activity of activities){
      const probed=activity!=='true-idle';
      await page.mouse.move(2,2);await page.waitForTimeout(400);
      if(probed)await page.evaluate(()=>{
        window.__hoverProbe={frames:[],longFrames:[],events:0,leaves:new Set(),running:true,startedAt:performance.now(),lastAt:null};const probe=window.__hoverProbe;
        const tick=()=>{if(!probe.running)return;const now=performance.now();probe.frames.push(Math.max(0,now-(probe.lastAt??probe.startedAt)));probe.lastAt=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
        probe.listener=e=>{const l=e.target.closest('button.leaf');if(l){probe.events++;probe.leaves.add(l.dataset.leaf);}};document.addEventListener('pointerover',probe.listener);
        if(PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')){probe.observer=new PerformanceObserver(list=>probe.longFrames.push(...list.getEntries().map(e=>({duration:e.duration,blockingDuration:e.blockingDuration,renderStart:e.renderStart,styleAndLayoutStart:e.styleAndLayoutStart,scripts:e.scripts.map(s=>({duration:s.duration,forcedStyleAndLayoutDuration:s.forcedStyleAndLayoutDuration,sourceFunctionName:s.sourceFunctionName,invoker:s.invoker}))}))));probe.observer.observe({type:'long-animation-frame'});}
      });
      const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
      const before=await metrics();
      const tracing=process.env.HW_TRACE==='1'||!probed;
      if(tracing)await cdp.send('Tracing.start',{categories:process.env.HW_TRACE==='1'?'devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,viz':'toplevel',transferMode:'ReturnAsStream'});
      const start=performance.now();let moves=0;
      while(performance.now()-start<seconds*1000){
        if(activity==='entry'){const p=Math.floor((performance.now()-start)/400)%2?entry.leaf:entry.out;await page.mouse.move(p.x,p.y);moves++;}
        else if(activity==='sweep'){
          // Sweep the full canopy ~7 times/second; jump between its vertical
          // bands and reverse directions. Actual browser hit-testing stays on.
          const t=(performance.now()-start)/1000;
          const x=bounds.left+(bounds.right-bounds.left)*(.5+.46*Math.sin(t*Math.PI*7));
          const y=bounds.top+(bounds.bottom-bounds.top)*(.5+.43*Math.sin(t*Math.PI*4.3));
          await page.mouse.move(x,y);moves++;
        }
        await new Promise(r=>setTimeout(r,4));
      }
      const after=await metrics();const elapsedMs=performance.now()-start;
      const data=probed?await page.evaluate(()=>{const p=window.__hoverProbe;p.running=false;p.endedAt=performance.now();p.frames.push(Math.max(0,p.endedAt-(p.lastAt??p.startedAt)));p.observer?.disconnect();document.removeEventListener('pointerover',p.listener);return {frames:p.frames,longFrames:p.longFrames,events:p.events,leaves:[...p.leaves],sampleSpanMs:p.endedAt-p.startedAt};}):{frames:[],longFrames:[],events:0,leaves:[]};
      if(process.env.HW_LAYERS==='1'){
        if(!probed)console.warn('HW_LAYERS=1 perturbs true-idle: LayerTree adds work, so its threadMs/TaskDuration are not idle numbers');
        const annotated=[];for(const layer of layers){let node,reasons;try{if(layer.backendNodeId)node=(await cdp.send('DOM.describeNode',{backendNodeId:layer.backendNodeId})).node;reasons=await cdp.send('LayerTree.compositingReasons',{layerId:layer.layerId});}catch{}annotated.push({...layer,node:node?{name:node.nodeName,attributes:node.attributes}:undefined,reasons});}await writeFile(resolve(out,`${variant}-${activity}-layers.json`),JSON.stringify(annotated,null,2));
      }
      const traceTotals={},threadMs={};
      if(tracing){
        const trace=await finishCDPTrace(cdp);if(process.env.HW_TRACE==='1')await writeFile(resolve(out,`${variant}-${activity}-trace.json`),trace);
        const events=JSON.parse(trace).traceEvents,names={};for(const e of events)if(e.ph==='M'&&e.name==='thread_name')names[e.pid+':'+e.tid]=e.args.name;
        // ponytail: threads keyed by name; assumes this page is the only renderer. Per-thread busy ms are not trustworthy with HW_LAYERS=1 (LayerTree adds work).
        for(const e of events)if(e.ph==='X'&&e.name==='ThreadControllerImpl::RunTask'&&['CrRendererMain','Compositor','VizCompositorThread','CrGpuMain'].includes(names[e.pid+':'+e.tid])){const k=names[e.pid+':'+e.tid];threadMs[k]=(threadMs[k]||0)+e.dur/1000;}
        for(const k in threadMs)threadMs[k]=Math.round(threadMs[k]);// round once: per-task rounding drops sub-0.5 ms tasks
        if(process.env.HW_TRACE==='1')for(const e of events)if(e.ph==='X'&&e.dur&&['Paint','Layout','UpdateLayoutTree','RasterTask','PrePaint','Commit','EventDispatch'].includes(e.name)){const row=traceTotals[e.name]??={count:0,ms:0,maxMs:0};row.count++;row.ms+=e.dur/1000;row.maxMs=Math.max(row.maxMs,e.dur/1000);}
      }
      const row={variant,diagnostic:variant!=='shipped'&&variant!=='original',activity,elapsedMs,moves,hoverEvents:data.events,uniqueLeaves:data.leaves.length,frames:probed?{count:data.frames.length,sampleSpanMs:data.sampleSpanMs,includesStartAndEndGaps:true,p50:percentile(data.frames,.5),p95:percentile(data.frames,.95),p99:percentile(data.frames,.99),max:Math.max(0,...data.frames),over25ms:data.frames.filter(x=>x>25).length,over50ms:data.frames.filter(x=>x>50).length}:null,cpuMs:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k,(after[k]-before[k])*1000])),threadMs,traceTotals,longFrames:data.longFrames,errors};
      report.cases.push(row);console.log(JSON.stringify({...row,longFrames:row.longFrames.length}));
    }
  }finally{await context.close();}
}
}finally{await fixture.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
// Frame cadence is main-thread rAF evidence, not physical presentation or
// input-to-display latency. Require healthy functional coverage too.
for(const r of report.cases)if(r.variant==='shipped'){
  try{
    if(r.errors.length)throw Error('Hover profiler page errors: '+r.errors.join('; '));
    if(r.activity==='sweep')assertHoverCoverage(r,{seconds:report.seconds,cpuRate:report.cpuRate});
  }catch(error){console.error('FAIL shipped '+r.activity+': '+error.message);process.exitCode=1;}
}
