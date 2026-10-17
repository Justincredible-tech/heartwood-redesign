const requireDarkReaderPath=()=>{const value=process.env.HW_DARKREADER;if(!value||!value.trim())throw Error('UNSUPPORTED: Dark Reader is not available; set HW_DARKREADER to a darkreader.js path or set HW_NO_DARKREADER=1 to skip it explicitly (see docs/TESTING.md)');return value.trim();};
// Frame budgets of the opt-in taste Network hover against the faithful page, with missed-frame attribution (HW_TRACE=1).
// node tools/verify-taste-lag.mjs   (serial browser; needs the taste build and Dark Reader as for verify-taste.mjs)
// Environments plain / Dark Reader at three settings / Chrome forced dark at 1424x820@2 and 1365x768@1; sweeps: random, trace out and back, fast trace, back-and-forth, alternating roots, zone 2/3 boundary, zigzag, hub spam, ring, and real-hover hops.
// Budgets asserted per run (taste only; the faithful page is measured beside it as the baseline; absolute, the original is never the benchmark): frame interval p95 < 25 ms, NO frame over 50 ms,
// input-to-render lag p95 <= 33.4 ms (two frames). A taste run lasts HW_SECONDS (5) and is extended (up to HW_MAX_SECONDS, 30) until it has sampled at least 40 light changes; a run that still has fewer is UNSUPPORTED, a failure, never a pass.
// (a 60 Hz display shows a frame every 16.7 ms). A failing budget names itself; rerun that case with HW_TRACE=1 HW_SWEEPS=<sweep> HW_COMBOS=<combo> for the missed-frame attribution (what each missed window was busy with: script by file, style, layout, paint+layerize, commit, GPU raster, draw/swap).
// env: HW_COMBOS, HW_SWEEPS, HW_VARIANTS (faithful-path,taste,faithful-hop,taste-hop), HW_SECONDS, HW_MAX_SECONDS, HW_SITE_ROOT, HW_OUT, HW_SAVE_TRACE (with HW_TRACE: keep the raw trace)
import {writeFile,mkdir} from 'node:fs/promises';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {extractNetwork,pick} from './taste-network.mjs';
import {browserFixture,finishCDPTrace,browserToolCLI} from './browser-test-lib.mjs';
export const BUDGET={frameP95:25,frameMax:50,lagP95:33.4,minSamples:40};
// The budget on one measured taste run: every failure it has (an empty list passes).
export function judgeLag(r){
  const id=(r?.combo||'?')+' '+(r?.variant||'?')+' '+(r?.sweep||'?')+': ',f=[];
  if(!r||!r.frames||!r.lagMs||!Array.isArray(r.errors))return [id+'UNSUPPORTED: incomplete lag row'];
  if(!Number.isInteger(r.frames.count)||r.frames.count<2||![r.frames.p95,r.frames.max,r.lagMs.p95,r.elapsedMs].every(v=>Number.isFinite(v)&&v>=0)||r.elapsedMs<=0||!Number.isInteger(r.frames.over50)||r.frames.over50<0||r.frames.over50>r.frames.count||!Number.isInteger(r.lightChangeFrames)||r.lightChangeFrames<0||r.lightChangeFrames>r.frames.count+1||!Number.isInteger(r.inputsDispatched)||r.inputsDispatched<1)f.push(id+'UNSUPPORTED: missing, invalid or inconsistent frame/input/window evidence');
  if(r.frames.max>BUDGET.frameMax)f.push(id+'maximum frame '+r.frames.max+' ms > '+BUDGET.frameMax);
  if(r.frames.p95>=BUDGET.frameP95)f.push(id+'frame p95 '+r.frames.p95+' ms >= '+BUDGET.frameP95);
  if(r.frames.over50>0)f.push(id+r.frames.over50+' frame(s) over '+BUDGET.frameMax+' ms (max '+r.frames.max+')');
  if(r.lightChangeFrames<BUDGET.minSamples)f.push(id+'UNSUPPORTED: only '+r.lightChangeFrames+' light changes sampled (need '+BUDGET.minSamples+'), so the lag budget is unproven');
  else if(r.lagMs.p95>BUDGET.lagP95)f.push(id+'lag p95 '+r.lagMs.p95+' ms > '+BUDGET.lagP95);
  if(r.sweep==='alternate'&&(!Number.isInteger(r.alternations)||r.alternations<1||r.lightChangeFrames<r.alternations*.5))f.push(id+'the alternate sweep did not alternate ('+r.lightChangeFrames+' light changes for '+r.alternations+' switches)');
  if(r.errors.length)f.push(id+'page errors '+r.errors.join('; '));
  return f;
}
if(process.argv[1]&&import.meta.filename===resolve(process.argv[1])){
browserToolCLI({});
const siteRoot=resolve(process.env.HW_SITE_ROOT||new URL('../publish',import.meta.url).pathname);
const out=resolve(process.env.HW_OUT||new URL('../output/playwright/review-taste-lag-budget',import.meta.url).pathname);
const T='/optimized-taste/';
const V={
  'faithful-path':{route:'/optimized/'},'faithful-hop':{route:'/optimized/',sweep:'hop'},   // hop: real hovers, circle to circle
  'taste':{route:T},'taste-hop':{route:T,sweep:'hop'},
};
const variants=(process.env.HW_VARIANTS??'faithful-path,taste,faithful-hop,taste-hop').split(',');for(const v of variants)if(!V[v])throw Error('unknown variant '+v);
// Modes: plain (light scheme), dark (prefers-color-scheme: dark: the taste build's designed dark mode), Dark Reader at the three settings verify-taste-colour uses
// (dr 100/100/0, dr-b120c90s10, dr-b80c110s30; light scheme, where the extension acts: under the dark preference the designed page locks it out), forced (Chrome forced dark; the designed dark page stands in).
const drOpts=m=>{const x=m.match(/^dr(?:-b(\d+)c(\d+)s(\d+))?$/);return x&&{brightness:+(x[1]||100),contrast:+(x[2]||100),sepia:+(x[3]||0)};};
const combos=(process.env.HW_COMBOS??['1424x820@2','1365x768@1'].flatMap(s=>['plain','dark','dr','dr-b120c90s10','dr-b80c110s30','forced'].map(m=>s+':'+m)).join(',')).split(',').map(c=>{const match=c.match(/^(\d+)x(\d+)@(\d+):(plain|dark|dr(?:-b\d+c\d+s\d+)?|forced)$/);if(!match)throw Error('Invalid HW_COMBOS entry '+JSON.stringify(c));const [,w,h,d,m]=match;if(![w,h,d].every(x=>Number.isFinite(+x)&&+x>0))throw Error('HW_COMBOS dimensions must be finite and positive');return {width:+w,height:+h,dpr:+d,mode:m};});
const seconds=Number(process.env.HW_SECONDS??5),maxSeconds=Number(process.env.HW_MAX_SECONDS??30),tracing=process.env.HW_TRACE==='1';
if(!Number.isFinite(seconds)||seconds<=0)throw Error('HW_SECONDS must be finite and positive');
if(!Number.isFinite(maxSeconds)||maxSeconds<seconds)throw Error('HW_MAX_SECONDS must be finite and at least HW_SECONDS');
const sweeps=(process.env.HW_SWEEPS??'default,trace,trace-fast,backforth,alternate,boundary,zigzag,hubspam,ring').split(',');
for(const sweep of sweeps)if(!['default','trace','trace-fast','backforth','alternate','boundary','zigzag','hubspam','ring'].includes(sweep))throw Error('Unknown HW_SWEEPS entry '+JSON.stringify(sweep));
const runtime=ensureToolRuntime({name:'taste lag verification',runTimeoutMs:150*60*1000});await runtime.ready;
await runtime.deadline('prepare lag output',()=>mkdir(out,{recursive:true}),{timeoutMs:5000});
const DR=combos.some(c=>c.mode.startsWith('dr'))?await readRegularInput(resolve(requireDarkReaderPath()),{runtime,syntax:'script'}):'';
const N=extractNetwork(await readRegularInput(resolve(siteRoot,'local/index.html'),{runtime})),rootOf=i=>{while(N.segs[i].parent>=0)i=N.segs[i].parent;return i;};
const pct=(a,q)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))]:0;
const r1=v=>Math.round(v*10)/10;
const fx=await browserFixture({siteRoot,runtime,runTimeoutMs:150*60*1000});   // 120 runs, taste runs extended until they have enough samples
const report={browser:fx.browser.version(),seconds,maxSeconds,budget:BUDGET,tracing,cases:[]};
{const g=await (await fx.browser.newBrowserCDPSession()).send('SystemInfo.getInfo');report.gpu={devices:g.gpu.devices.map(d=>d.deviceString||d.vendorString),featureStatus:g.gpu.featureStatus,gl:g.gpu.auxAttributes?.glRenderer||g.gpu.auxAttributes?.gl_renderer};console.log(JSON.stringify({gpu:report.gpu.devices,raster:report.gpu.featureStatus.rasterization,gpuComp:report.gpu.featureStatus.gpu_compositing,gl:report.gpu.gl}));}
let forcedB=null;
// pointer drivers. G = in-page geometry (spores, hub, strip centrelines). Each returns positions as a function of time / step.
const driverFor=(sweep,G,geo)=>{
  const {cx,cy,r:hr}=G.hub,along=(s,f)=>{const seg=Math.min(5,Math.floor(f*6)),u=f*6-seg;return [s.c[seg][0]+u*(s.c[seg+1][0]-s.c[seg][0]),s.c[seg][1]+u*(s.c[seg+1][1]-s.c[seg][1])];};
  const byLen=G.spores.map((s,i)=>[i,s[2].split(' ').length]).filter(([i])=>{const [x,y]=G.spores[i];return x>geo.L&&x<geo.R&&y>geo.T&&y<geo.B;}).sort((a,b)=>b[1]-a[1]);const ri=byLen[0][0];
  const rs=G.spores[ri][2].split(' ').map(k=>G.strips.find(s=>s.id==='hy-'+k)),pts=[];for(const s of rs)for(const f of [.1,.3,.5,.7,.9])pts.push(along(s,f));
  const [sx,sy]=G.spores[ri],sr=Math.hypot(sx-cx,sy-cy),snap=[sx+30*(sx-cx)/sr,sy+30*(sy-cy)/sr],ang=([x,y])=>Math.atan2(y-cy,x-cx),a0=ang([sx,sy]);
  const nb=G.spores.map((s,i)=>[i,Math.abs(((ang(s)-a0+3*Math.PI)%(2*Math.PI))-Math.PI)]).filter(([i])=>G.spores[i][2].split(' ')[0]!==G.spores[ri][2].split(' ')[0]).sort((a,b)=>a[1]-b[1])[0][0];
  // alternate: zone-2 points on the circle 30 units out from the hub edge, on the two neighbouring roots nearest the long path's direction (pick() decides the root), switched every two frames
  const toClient=([x,y])=>[G.stage.left+x*G.stage.width/N.w,G.stage.top+y*G.stage.height/N.h],runs=[];
  for(let d=0;d<720;d++){const a=d*Math.PI/360,p=[N.cx+(N.hub+30)*Math.cos(a),N.cy+(N.hub+30)*Math.sin(a)],z=pick(N,...p,-1),rt=z.zone===2?rootOf(z.seg):-1;if(runs.at(-1)?.rt===rt)runs.at(-1).a.push(a);else runs.push({rt,a:[a]});}
  const roots=runs.filter(r=>r.rt>=0&&r.a.length>=6).map(r=>({rt:r.rt,a:r.a[r.a.length>>1]})),near=(x,y)=>Math.abs(((x-y+3*Math.PI)%(2*Math.PI))-Math.PI);
  const k=roots.reduce((b,r,i)=>near(r.a,a0)<near(roots[b].a,a0)?i:b,0),pair=[roots[k],roots[(k+1)%roots.length]];
  if(pair[0].rt===pair[1].rt)throw Error('alternate sweep: no two neighbouring roots');
  const [myPt,nbPt]=pair.map(r=>toClient([N.cx+(N.hub+30)*Math.cos(r.a),N.cy+(N.hub+30)*Math.sin(r.a)]));
  const tour=[...pts,snap,snap,...[...pts].reverse(),[cx,cy],[cx,cy]];   // out along a root, into zone 3, back in, into the hub
  return {
    'trace':(t,i)=>tour[Math.floor(t*25)%tour.length],                    // ~25 positions/s: a deliberate trace out and back
    'trace-fast':(t,i)=>tour[Math.floor(t*90)%tour.length],
    'backforth':t=>pts[Math.min(pts.length-1,Math.floor((.5+.5*Math.sin(t*14))*pts.length))],
    'alternate':t=>Math.floor(t*30)%2?nbPt:myPt,
    'boundary':t=>{const l=pts.at(-1),u=.5+.5*Math.sin(t*16);return [l[0]+u*(snap[0]-l[0]),l[1]+u*(snap[1]-l[1])];},
    'zigzag':t=>{const a=a0+.6*Math.sin(t*12),r=hr+40+50*(.5+.5*Math.sin(t*5));return [cx+r*Math.cos(a),cy+r*Math.sin(a)];},
    'hubspam':t=>{const r=hr*(.6+.8*(.5+.5*Math.sin(t*18)));return [cx+r*Math.cos(a0),cy+r*Math.sin(a0)];},
    'ring':t=>{const a=t*Math.PI*2*1.4,r=hr+30+60*(.5+.5*Math.sin(t*11));return [cx+r*Math.cos(a),cy+r*Math.sin(a)];},
  }[sweep];
};
try{
for(const combo of combos)for(const sweep of sweeps)for(const name of variants){
  const v=V[name];if(v.sweep==='hop'&&sweep!==sweeps[0])continue;   // real-hover hops do not depend on the sweep
  if(combo.mode==='forced')forcedB||=await fx.launch(['--force-dark-mode','--enable-features=WebContentsForceDark']);
  const context=await (combo.mode==='forced'?forcedB:fx.browser).newContext({viewport:{width:combo.width,height:combo.height},deviceScaleFactor:combo.dpr,bypassCSP:true,colorScheme:combo.mode==='dark'||combo.mode==='forced'?'dark':'light'});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(drOpts(combo.mode))await page.addInitScript({content:DR+';document.addEventListener("DOMContentLoaded",()=>DarkReader.enable('+JSON.stringify(drOpts(combo.mode))+'));'});
    await page.goto(fx.base+v.route,{waitUntil:'load'});
    await page.waitForFunction(()=>window.leafLift&&document.querySelectorAll('#net .spore').length>0);
    await page.waitForTimeout(3500);
    await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));
    await page.waitForTimeout(400);
    if(drOpts(combo.mode)&&!await page.evaluate(()=>document.querySelectorAll('style.darkreader').length>0))throw Error('Dark Reader inactive');
    if(['dark','forced'].includes(combo.mode)&&name.startsWith('taste')&&!await page.evaluate(()=>!!document.querySelector('meta[name="darkreader-lock"]')&&matchMedia('(prefers-color-scheme: dark)').matches))throw Error('designed dark mode inactive');
    const geo=await page.evaluate(()=>{const b=document.querySelector('#net .net__stage').getBoundingClientRect(),vw=innerWidth,vh=innerHeight;
      return {L:Math.max(b.left,4),R:Math.min(b.right,vw-4),T:Math.max(b.top,4),B:Math.min(b.bottom,vh-4),spores:[...document.querySelectorAll('#net .spore')].map(s=>{const r=s.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];}).filter(([x,y])=>x>4&&x<vw-4&&y>4&&y<vh-4)};});
    const G=await page.evaluate(()=>{const stage=document.querySelector('#net .net__stage'),hy=stage.querySelector('.net__hyphae'),hub=stage.querySelector('.net__hub').getBoundingClientRect();
      const sb=stage.getBoundingClientRect();
      return {stage:{left:sb.left,top:sb.top,width:sb.width,height:sb.height},hub:{cx:hub.left+hub.width/2,cy:hub.top+hub.height/2,r:hub.width/2},spores:[...stage.querySelectorAll('.spore')].map(s=>{const r=s.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,s.dataset.path];}),
        strips:[...hy.children].map(el=>{const r=el.getBoundingClientRect(),m=getComputedStyle(el).clipPath.match(/polygon\((.*)\)/);if(!m)return null;const P=m[1].split(',').map(s=>s.trim().split(/\s+/).map(parseFloat)).map(([x,y])=>[r.left+r.width*x/100,r.top+r.height*y/100]);return {id:el.id,c:[0,1,2,3,4,5,6].map(i=>[(P[i][0]+P[13-i][0])/2,(P[i][1]+P[13-i][1])/2])};}).filter(Boolean)};});
    const drive=sweep==='default'?null:driverFor(sweep,G,geo);if(sweep!=='default'&&!drive)throw Error('unknown sweep '+sweep);
    const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
    await page.mouse.move(geo.L-2>0?geo.L-2:2,2);await page.waitForTimeout(300);
    await page.evaluate(()=>{
      // changes counts exactly what the judgement samples (one per rendered frame that shows a light change made after an input), so a run is extended until it really has enough samples
      const p=window.__p={frames:[],inputs:[],muts:[],running:true,longFrames:[],changes:0,pend:false};
      const tick=t=>{const f={raf:t,now:performance.now(),done:0};p.frames.push(f);const ch=new MessageChannel();ch.port1.onmessage=()=>{f.done=performance.now();if(p.pend){p.pend=false;p.changes++;}};ch.port2.postMessage(0);if(p.running)requestAnimationFrame(tick);};
      requestAnimationFrame(tick);
      p.onInput=e=>p.inputs.push([performance.now(),e.timeStamp,e.type==='pointerover'?1:0]);
      document.addEventListener('pointermove',p.onInput,{capture:true,passive:true});document.addEventListener('pointerover',p.onInput,{capture:true,passive:true});
      p.mo=new MutationObserver(recs=>{let lit=0;for(const r of recs){const t=r.target;if(t.nodeName==='I'||t.classList.contains('spore')||t.classList.contains('net__hub'))lit++;}if(lit){p.muts.push([performance.now(),lit]);if(p.inputs.length)p.pend=true;}});
      p.mo.observe(document.getElementById('net'),{subtree:true,attributes:true,attributeFilter:['class','style']});
      if(PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')){p.lo=new PerformanceObserver(l=>p.longFrames.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration,renderStart:e.renderStart,styleAndLayoutStart:e.styleAndLayoutStart,scripts:e.scripts.map(s=>({d:s.duration,f:s.sourceFunctionName,inv:s.invoker,forced:s.forcedStyleAndLayoutDuration}))}))));p.lo.observe({type:'long-animation-frame'});}
    });
    let layerPaints=[],layers=[];
    if(tracing){
      cdp.on('LayerTree.layerPainted',e=>layerPaints.push(e));cdp.on('LayerTree.layerTreeDidChange',e=>{if(e.layers)layers=e.layers;});await cdp.send('LayerTree.enable');
      await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,blink,cc,viz,gpu,disabled-by-default-devtools.timeline.frame'+(process.env.HW_LAYERS_TRACE?',disabled-by-default-devtools.timeline.layers,disabled-by-default-cc.debug,disabled-by-default-blink.invalidation':''),transferMode:'ReturnAsStream'});
    }
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const before=await metrics();
    const start=performance.now(),extend=name.startsWith('taste');let moves=0,hop=0,polled=start,changes=0;
    for(;;){const now=performance.now();
      if(now-start>=seconds*1000&&(!extend||changes>=BUDGET.minSamples+10||now-start>=maxSeconds*1000))break;   // taste runs go on until they have enough light changes to judge
      if(extend&&now-start>=seconds*1000&&now-polled>500){polled=now;changes=await page.evaluate(()=>window.__p.changes);}
      if(drive){await page.mouse.move(...drive((performance.now()-start)/1000,moves));}
      else if(v.sweep==='hop'){const [x,y]=geo.spores[(hop=(hop*7+13)%geo.spores.length)];await page.mouse.move(x,y);}
      else{const t=(performance.now()-start)/1000;await page.mouse.move(geo.L+(geo.R-geo.L)*(.5+.46*Math.sin(t*Math.PI*7)),geo.T+(geo.B-geo.T)*(.5+.43*Math.sin(t*Math.PI*4.3)));}
      moves++;await new Promise(r=>setTimeout(r,4));
    }
    const elapsed=performance.now()-start;
    await page.waitForTimeout(200);
    const after=await metrics();
    const d=await page.evaluate(()=>{const p=window.__p;p.running=false;p.mo.disconnect();p.lo?.disconnect();document.removeEventListener('pointermove',p.onInput,true);document.removeEventListener('pointerover',p.onInput,true);return {frames:p.frames,inputs:p.inputs,muts:p.muts,longFrames:p.longFrames};});
    // frame pacing over the sweep only
    const fr=d.frames.filter(f=>f.done),iv=fr.slice(1).map((f,i)=>f.raf-fr[i].raf);
    // input-to-render: for each frame that rendered a light change, done - timeStamp of the input it reflects
    const lags=[],queue=[],workMs=fr.map(f=>f.done-f.now);let mi=0,ii=0,lastIn=null;
    const seen=new Set();
    for(const [m] of d.muts){
      while(ii<d.inputs.length&&d.inputs[ii][0]<=m){lastIn=d.inputs[ii];ii++;}
      const f=fr.find(f=>f.done>m);if(!f||!lastIn||seen.has(f))continue;seen.add(f);
      lags.push(f.done-lastIn[1]);queue.push(lastIn[0]-lastIn[1]);
    }
    const row={combo:`${combo.width}x${combo.height}@${combo.dpr}:${combo.mode}`,variant:name,sweep,moves,elapsedMs:Math.round(elapsed),...(sweep==='alternate'&&!v.sweep&&{alternations:Math.floor(elapsed/1000*30)}),inputsDispatched:d.inputs.length,lightChangeFrames:lags.length,
      frames:{count:iv.length,p50:r1(pct(iv,.5)),p95:r1(pct(iv,.95)),max:r1(Math.max(0,...iv)),over25:iv.filter(x=>x>25).length,over50:iv.filter(x=>x>50).length},
      mainFrameWorkMs:{p50:r1(pct(workMs,.5)),p95:r1(pct(workMs,.95)),max:r1(Math.max(0,...workMs))},
      lagMs:{p50:r1(pct(lags,.5)),p95:r1(pct(lags,.95)),max:r1(Math.max(0,...lags)),mean:r1(lags.reduce((a,b)=>a+b,0)/(lags.length||1))},
      inputQueueMs:{p50:r1(pct(queue,.5)),p95:r1(pct(queue,.95))},
      cpuMs:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k,Math.round((after[k]-before[k])*1000)])),
      longFrames:{count:d.longFrames.length,maxMs:r1(Math.max(0,...d.longFrames.map(l=>l.duration))),renderMsP50:r1(pct(d.longFrames.map(l=>l.start+l.duration-l.renderStart),.5)),scriptMs:r1(d.longFrames.reduce((a,l)=>a+l.scripts.reduce((b,s)=>b+s.d,0),0))},errors};
    if(tracing){
      const trace=await finishCDPTrace(cdp);
      const ev=JSON.parse(trace),events=ev.traceEvents||ev,names={},pidOf={};
      for(const e of events)if(e.ph==='M'&&e.name==='thread_name')names[e.pid+':'+e.tid]=e.args.name;
      // the renderer = the pid whose CrRendererMain ran FireAnimationFrame / EventDispatch most
      const cnt={};for(const e of events)if(names[e.pid+':'+e.tid]==='CrRendererMain'&&(e.name==='EventDispatch'||e.name==='FireAnimationFrame'))cnt[e.pid]=(cnt[e.pid]||0)+1;
      const rpid=+Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]?.[0];
      const by={};const add=(thr,n,dur)=>{const k=thr+'|'+n,o=by[k]??={thread:thr,name:n,count:0,ms:0,maxMs:0};o.count++;o.ms+=dur;o.maxMs=Math.max(o.maxMs,dur);};
      let paintArea=0,paints=0,styleEls=0,inval={},styleInval={};
      for(const e of events){
        const th=names[e.pid+':'+e.tid]||'?';
        if(e.ph==='X'&&e.dur!=null){const thr=e.pid===rpid&&th==='CrRendererMain'?'main':e.pid===rpid&&th==='Compositor'?'compositor':/CompositorTileWorker|RasterWorker/.test(th)?'raster':th==='VizCompositorThread'?'viz':th==='CrGpuMain'?'gpu':null;if(thr)add(thr,e.name,e.dur/1000);}
        if(e.pid===rpid&&e.name==='Paint'&&e.ph==='X'){paints++;const q=e.args?.data?.clip;if(q&&q.length===8){const xs=[q[0],q[2],q[4],q[6]],ys=[q[1],q[3],q[5],q[7]];paintArea+=(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));}}
        if(e.pid===rpid&&e.name==='UpdateLayoutTree'&&e.ph==='X')styleEls+=e.args?.elementCount||0;
        if(e.name==='PaintInvalidationTracking'){const n=e.args?.data?.nodeName||'?';inval[n]=(inval[n]||0)+1;}
        if(/StyleRecalcInvalidationTracking|StyleInvalidatorInvalidationTracking/.test(e.name)){const n=(e.args?.data?.nodeName||'?')+' '+(e.args?.data?.reason||e.args?.data?.invalidationList?.length||'');styleInval[n]=(styleInval[n]||0)+1;}
      }
      const keep=['Paint','PrePaint','Layerize','UpdateLayoutTree','Layout','Commit','FireAnimationFrame','EventDispatch','FunctionCall','HitTest','RasterTask','ProxyMain::BeginMainFrame','ThreadProxy::BeginMainFrame','LayerTreeHost::UpdateLayers','PaintArtifactCompositor::Update','LocalFrameView::RunPaintLifecyclePhase','LocalFrameView::RunPrePaintLifecyclePhase','LocalFrameView::UpdateStyleAndLayoutIfNeededRecursive','Document::UpdateStyle','TileManager::FlushAndIssueSignals','LayerTreeHostImpl::PrepareToDraw','DisplayScheduler::DrawAndSwap','Graphics.Pipeline','SkiaOutputSurfaceImplOnGpu::SwapBuffers','RunMicrotasks','v8.callFunction','TimerFire'];
      const rows=Object.values(by).map(o=>({...o,ms:r1(o.ms),maxMs:r1(o.maxMs)}));
      const gpid=+(Object.entries(names).find(([k,n])=>n==='CrGpuMain')?.[0].split(':')[0]);
      const thr={};for(const e of events)if(e.ph==='X'&&e.dur!=null&&(e.pid===rpid||e.pid===gpid)){const n=(e.pid===rpid?'R:':'G:')+(names[e.pid+':'+e.tid]||e.tid);const o=(thr[n]??={})[e.name]??={c:0,ms:0,max:0};o.c++;o.ms+=e.dur/1000;o.max=Math.max(o.max,e.dur/1000);}
      const threads={};for(const [n,m] of Object.entries(thr)){const top=Object.entries(m).map(([k,o])=>[k,o.c,r1(o.ms),r1(o.max)]).sort((a,b)=>b[2]-a[2]);if(top[0]?.[2]>5)threads[n]=top.slice(0,8);}
      const paintSamples=events.filter(e=>e.pid===rpid&&e.name==='Paint'&&e.ph==='X').slice(0,400).map(e=>e.args?.data).filter(Boolean);
      const pn={};for(const p of paintSamples){const k=(p.nodeName||p.nodeId||'?')+'';const q=p.clip;const a=q&&q.length===8?Math.round((Math.max(q[0],q[2],q[4],q[6])-Math.min(q[0],q[2],q[4],q[6]))*(Math.max(q[1],q[3],q[5],q[7])-Math.min(q[1],q[3],q[5],q[7]))):null;const o=pn[k]??={c:0,area:0,ex:p};o.c++;o.area+=a||0;}
      row.trace={rendererPid:rpid,gpuPid:gpid,threads,paintByNode:Object.entries(pn).sort((a,b)=>b[1].c-a[1].c).slice(0,8).map(([k,o])=>[k,o.c,o.area,JSON.stringify(o.ex).slice(0,200)]),selected:rows.filter(o=>keep.includes(o.name)).sort((a,b)=>b.ms-a.ms),topMain:rows.filter(o=>o.thread==='main').sort((a,b)=>b.ms-a.ms).slice(0,12),rasterTotalMs:r1(rows.filter(o=>o.thread==='raster').reduce((a,o)=>a+(o.name==='RasterTask'?o.ms:0),0)),paints,paintAreaPx:Math.round(paintArea),styleRecalcElements:styleEls,
        paintInvalidationsByNode:Object.entries(inval).sort((a,b)=>b[1]-a[1]).slice(0,10),styleInvalidationsByNode:Object.entries(styleInval).sort((a,b)=>b[1]-a[1]).slice(0,8)};
      // which composited layers were repainted, how often, how much area
      const per={};for(const p of layerPaints){const o=per[p.layerId]??={count:0,area:0,maxArea:0};const a=p.clip.width*p.clip.height;o.count++;o.area+=a;o.maxArea=Math.max(o.maxArea,a);}
      const lp=[];for(const [id,o] of Object.entries(per)){const L=layers.find(l=>l.layerId===id);let node=null;if(L?.backendNodeId){try{const n=(await cdp.send('DOM.describeNode',{backendNodeId:L.backendNodeId})).node;node=n.nodeName+(n.attributes?'.'+(n.attributes[n.attributes.indexOf('class')+1]||''):'');}catch{}}lp.push({layerId:id,node,size:L?[Math.round(L.width),Math.round(L.height)]:null,paints:o.count,areaPx:Math.round(o.area),maxClip:Math.round(o.maxArea)});}
      row.trace.layerPainted=lp.sort((a,b)=>b.areaPx-a.areaPx).slice(0,10);row.trace.layerCount=layers.length;
      // raster per cc layer: RasterTask (worker) carries the layer id; the GPU-side DoRasterCHROMIUM + its Flush are matched to them in order
      const rt=events.filter(e=>e.name==='RasterTask'&&e.ph==='X'&&e.pid===rpid).sort((a,b)=>a.ts-b.ts);
      const gr=events.filter(e=>e.pid===gpid&&e.ph==='X'&&e.name==='RasterDecoderImpl::DoRasterCHROMIUM').sort((a,b)=>a.ts-b.ts);
      const gf=events.filter(e=>e.pid===gpid&&e.ph==='X'&&e.name==='RasterDecoderImpl::DoEndRasterCHROMIUM::Flush').sort((a,b)=>a.ts-b.ts);
      const rl={};rt.forEach((e,i)=>{const id=String(e.args?.tileData?.layerId);const o=rl[id]??={tasks:0,frames:new Set(),workerMs:0,gpuMs:0};o.tasks++;o.frames.add(e.args?.tileData?.sourceFrameNumber);o.workerMs+=e.dur/1000;o.gpuMs+=((gr[i]?.dur||0)+(gf[i]?.dur||0))/1000;});
      const rows2=[];for(const [id,o] of Object.entries(rl).sort((a,b)=>b[1].gpuMs-a[1].gpuMs).slice(0,6)){const L=layers.find(l=>l.layerId===id);let node=null;if(L?.backendNodeId){try{const n=(await cdp.send('DOM.describeNode',{backendNodeId:L.backendNodeId})).node;const a=n.attributes||[];node=n.nodeName+(a.includes('id')?'#'+a[a.indexOf('id')+1]:'')+(a.includes('class')?'.'+a[a.indexOf('class')+1].split(' ').slice(0,2).join('.'):'');}catch{}}rows2.push({layerId:id,node,size:L?[Math.round(L.width),Math.round(L.height)]:null,rasterTasks:o.tasks,frames:o.frames.size,workerMs:r1(o.workerMs),gpuMs:r1(o.gpuMs)});}
      // missed-frame attribution: the probe asks for a main frame every vsync, so a gap > 20 ms between BeginMainFrame starts is a missed frame window.
      // In each window, the busy time of every cause; the window's cause = the largest. GPU raster is split by cc layer (in-order match above).
      const layerName=id=>{const x=rows2.find(r=>r.layerId===id);return x?(x.node||'layer '+id):'layer '+id;};
      const scriptCat=e=>{const u=e.args?.data?.url||'';return /taste\./.test(u)?'script: taste.js':/content\.|leaf\.|media\./.test(u)?'script: site':u?'script: other '+u.split('/').pop().slice(0,30):(drOpts(combo.mode)?'script: inline (Dark Reader + probe)':'script: inline (probe)');};
      const cats=[];
      for(const e of events){if(e.ph!=='X'||e.dur==null)continue;const th=names[e.pid+':'+e.tid];
        if(e.pid===rpid&&th==='CrRendererMain'){const c={UpdateLayoutTree:'style recalc',Layout:'layout','LocalFrameView::RunPrePaintLifecyclePhase':'prepaint','LocalFrameView::RunPaintLifecyclePhase':'paint+layerize',Commit:'commit',HitTest:'hit test'}[e.name]||(e.name==='FunctionCall'?scriptCat(e):null);if(c)cats.push([e.ts,e.ts+e.dur,c]);}
        if(e.pid===gpid&&th==='CrGpuMain'&&e.name==='SkiaOutputSurfaceImplOnGpu::SwapBuffers')cats.push([e.ts,e.ts+e.dur,'gpu: draw/swap']);}
      gr.forEach((e,i)=>cats.push([e.ts,e.ts+e.dur+(gf[i]?.dur||0),'gpu raster: '+layerName(String(rt[i]?.args?.tileData?.layerId))]));
      const bmf=events.filter(e=>e.pid===rpid&&e.ph==='X'&&e.name==='ProxyMain::BeginMainFrame').map(e=>e.ts).sort((a,b)=>a-b);
      const miss={},busy={};let missed=0,windows=0;
      for(let i=1;i<bmf.length;i++){const a=bmf[i-1],b=bmf[i],gap=(b-a)/1000;if(gap<=20)continue;windows++;const n=Math.max(1,Math.round(gap/16.67)-1);missed+=n;
        const w={};for(const [s,e,c] of cats){const o=Math.min(e,b)-Math.max(s,a);if(o>0)w[c]=(w[c]||0)+o/1000;}
        const top=Object.entries(w).sort((x,y)=>y[1]-x[1])[0]?.[0]||'idle/unknown';miss[top]=(miss[top]||0)+n;for(const [c,ms] of Object.entries(w))busy[c]=(busy[c]||0)+ms;}
      const tot={};for(const [s,e,c] of cats)tot[c]=(tot[c]||0)+(e-s)/1000;
      row.trace.missedFrames={mainFrames:bmf.length,missedFrameWindows:windows,missedFrames:missed,byDominantCause:Object.entries(miss).sort((a,b)=>b[1]-a[1]),busyMsInMissedWindows:Object.entries(busy).map(([c,ms])=>[c,r1(ms)]).sort((a,b)=>b[1]-a[1]).slice(0,10),totalMsByCause:Object.entries(tot).map(([c,ms])=>[c,r1(ms)]).sort((a,b)=>b[1]-a[1]).slice(0,12)};
      row.trace.rasterByLayer=rows2;row.trace.gpuRasterMs=r1(gr.concat(gf).reduce((a,e)=>a+e.dur/1000,0));row.trace.rasterTasks=rt.length;
      if(process.env.HW_SAVE_TRACE)await writeFile(resolve(out,`trace-${name}-${row.combo.replace(/[:@x]/g,'_')}.json`),trace);
    }
    report.cases.push(row);
    console.log(JSON.stringify({c:row.combo,v:name,s:sweep,moves,inputs:row.inputsDispatched,changes:row.lightChangeFrames,frames:row.frames,work:row.mainFrameWorkMs,lag:row.lagMs,q:row.inputQueueMs,cpu:row.cpuMs,loaf:row.longFrames.count,err:errors.length,...(row.trace&&{paints:row.trace.paints,paintArea:row.trace.paintAreaPx,raster:row.trace.rasterTotalMs,styleEls:row.trace.styleRecalcElements,layerPainted:row.trace.layerPainted.slice(0,3)})}));
  }catch(e){console.error('ERROR',combo,name,e.message);report.cases.push({combo,variant:name,error:e.message});}
  finally{await context.close();}
}
}finally{if(forcedB)await forcedB.close();await fx.close();}
// Budgets on the taste rows (the faithful rows are the baseline, reported beside them).
const fails=[],table=[];
for(const r of report.cases){
  if(r.error){fails.push(JSON.stringify(r.combo)+' '+r.variant+': '+r.error);continue;}
  const base=report.cases.find(b=>!b.error&&b.combo===r.combo&&b.sweep===r.sweep&&b.variant===r.variant.replace('taste','faithful')),taste=r.variant.startsWith('taste');
  table.push([r.combo,r.variant,r.sweep,'fr p95',r.frames.p95,'max',r.frames.max,'>50',r.frames.over50,'lag p95',r.lagMs.p95,base?'| faithful fr p95 '+base.frames.p95+' lag p95 '+base.lagMs.p95:''].join(' '));
  if(taste)fails.push(...judgeLag(r));
}
report.passed=!fails.length&&report.cases.length>0;report.failures=fails;
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
console.log(table.join('\n'));
console.log(JSON.stringify({passed:report.passed,runs:report.cases.length,failures:fails.slice(0,12),report:resolve(out,'report.json')}));
process.exit(report.passed?0:1);
}
