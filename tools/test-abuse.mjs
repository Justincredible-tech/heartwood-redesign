// ABUSE suite: ruthless stress of OUR builds (/optimized/ and /optimized-taste/) against ABSOLUTE budgets. The original is not a benchmark (--baseline adds /local/, report only).
// All measured heartbeat/submission misses are retained, attributed or marked unresolved, and ranked. A separate unconditional traced pass validates CDP compositor submission health.
// Main rAF, Event Timing next-paint durations and compositor submissions are distinct streams; physical display presentation is unmeasured. Chrome only (CDP).
// Each run owns an independent browser session by default; legacy --no-lock/--no-wait are harmless compatibility flags. Never contacts a third-party host (network guard in browser-test-lib).
//   node tools/test-abuse.mjs [--quick|--full] [--route optimized,optimized-taste] [--configs d1,d2,m] [--only a,b] [--seconds N] [--json out.json] [--out dir] [--baseline] [--deferred] [--list] [--no-lock|--no-wait] [--cdp loopback-url] [--base loopback-url] [--port N]
//   --quick: limited windows/subset/cycles; never full acceptance. --full (default): both desktops and mobile, 8 s ordinary windows, >=30 s/8 combined rounds, >=50 modal leak cycles, longer chaos. Actual time/cost is recorded.
//   --cdp retains experimental existing-device functional diagnostics; unisolated compositor ownership/leak acceptance is UNSUPPORTED. No remote host is contacted by this tool.
//   HW_ABUSE_SEED=<n> seeds every scenario's random choices (default 1337). Chaos monkey (fast-check commands, shrinks to a minimal failing sequence): HW_FC_SEED=<n> replays, HW_FC_RUNS=<n> sequences.
//   HW_SITE_ROOT picks the site (default ./site). Exit 1 on any budget breach.
// Budgets: tools/budgets.json browser.abuse may TIGHTEN the absolute gates below (frameP95Ms 25, frameMaxMs 50, inputToPaintP95Ms 34) but never loosen them.
// perf-trace.mjs runs its whole CLI at import so it cannot be imported; the trace indexing / frame / attribution core below uses the same event names and the same MAIN map (keep them in step).
import {browserFixture,isLocalUrl,createGuard,finishCDPTrace,manageCDPSession,managedConnectOverCDP,listenServer,closeServer} from './browser-test-lib.mjs';
import {devices,chromium} from './browser-deps.mjs';
import {fc,seed as fcSeed} from '../tests/property-lib.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {abuseSchedule} from './abuse-schedule.mjs';
import {commandCleanupProblems} from './command-acceptance.mjs';
import {createPreviewServer} from './serve.mjs';
import {loadavg} from 'node:os';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {analyzeFrameWindow,analyzeCompositorWindow,analyzeInput,createNavigationTracker,analyzeNavigation,evaluateAcceptance,attributeAllMisses,attachAttribution,resolveAbuseBudgets,validateAbuseSelection,validateLeakCounters,analyzeActivityCoverage,analyzeTraceInputs,correlateMissIntervals} from './abuse-measurement.mjs';

const root=resolve(import.meta.dirname,'..');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const SOURCE_FILES=['tools/test-abuse.mjs','tools/abuse-measurement.mjs','tools/abuse-schedule.mjs','tools/browser-test-lib.mjs','tools/serve.mjs','tools/budgets.json','tests/property-lib.mjs','tools/tool-runtime.mjs','tools/run-supervised.mjs','tools/process-identity.c','tools/server-lifecycle.mjs','tools/cleanup-resource-actions.mjs','tools/command-acceptance.mjs'];
const sourceHashes=()=>Object.fromEntries(SOURCE_FILES.map(p=>[p,sha256(readFileSync(resolve(root,p)))]));
const LOADED_SOURCE_HASHES=sourceHashes();
const {values:o}=parseArgs({options:{help:{type:'boolean',short:'h'},quick:{type:'boolean'},full:{type:'boolean'},route:{type:'string'},only:{type:'string'},configs:{type:'string'},seconds:{type:'string'},json:{type:'string'},out:{type:'string'},baseline:{type:'boolean'},deferred:{type:'boolean'},list:{type:'boolean'},'plan-json':{type:'boolean'},'no-wait':{type:'boolean'},'no-lock':{type:'boolean'},cdp:{type:'string'},base:{type:'string'},port:{type:'string'}}});
if(o.help){console.log('Usage: node tools/test-abuse.mjs [--quick|--full] [--route ROUTES] [--configs CONFIGS] [--only SCENARIOS] [--seconds N] [--out DIR] [--json FILE] [--list|--plan-json] [--baseline] [--deferred] [--cdp LOOPBACK_URL] [--base LOOPBACK_URL] [--port N]');process.exit(0);}
if(o.quick&&o.full)throw Error('--quick and --full are exclusive');
const CHAOS_MS=Number(process.env.HW_FC_MS||(o.quick?150000:420000));
for(const [name,value] of [['HW_FC_MS',CHAOS_MS]])if(!Number.isFinite(value)||value<=0)throw Error(name+' must be positive and finite');
for(const name of ['cdp','base'])if(o[name]&&!isLocalUrl(o[name]))throw Error('--'+name+' must be a loopback URL');if(o.port!==undefined&&(!Number.isInteger(Number(o.port))||Number(o.port)<0||Number(o.port)>65535))throw Error('--port must be 0..65535');if(o.cdp&&o.configs&&o.configs.split(',').some(c=>c.trim()!=='m'))throw Error('--cdp only supports actual-device config m');
const quick=!!o.quick,SEED=Number(process.env.HW_ABUSE_SEED||1337);
if(!Number.isInteger(SEED)||SEED<0||SEED>0xffffffff)throw Error('HW_ABUSE_SEED must be an integer in 0..4294967295');
const DUR=validateAbuseSelection({seconds:o.seconds??(quick?'3':'8')}).seconds,outDir=resolve(root,o.out||process.env.HW_OUT||'output/playwright/abuse/'+new Date().toISOString().replace(/[:.]/g,'-'));
if(!quick&&DUR<8)throw Error('Full abuse requires --seconds >=8; use --quick for limited sampling');
const routes=[...new Set((o.route||(quick?'optimized-taste':'optimized,optimized-taste')).split(',').map(s=>s.trim()).concat(o.baseline?['local']:[]))];

// ---- budgets (absolute; the file may only tighten) ----
const fileB=JSON.parse(readFileSync(resolve(root,'tools/budgets.json'),'utf8')).browser?.abuse??{};
const G=resolveAbuseBudgets(fileB,{quick});
const LEAK_CYCLES=quick?12:G.leaks.cycles;

// ---- helpers ----
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),r1=x=>Math.round(x*10)/10,sum=a=>a.reduce((s,x)=>s+x,0);
const pct=(a,q)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))]:0;
const rngOf=(str,base)=>{let h=base>>>0;for(const c of str)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return ()=>{h=h+0x6D2B79F5|0;let t=Math.imul(h^h>>>15,1|h);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};   // mulberry32
const pick=(rng,a)=>a[Math.floor(rng()*a.length)];

// Runs are independent. Optional measurement serialization belongs to run-supervised, never a nested private lock.
async function cdpFixture(url){
 let base=o.base,server=null,browser=null,context=null;const guard=createGuard({route:true});
 const close=async()=>{const results=await Promise.allSettled([context?.close(),browser?.close(),server?closeServer(server,{runtime}):Promise.resolve()]);guard.assert();const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;};
 const unregister=runtime.onCleanup('abuse CDP fixture',close);
 try{
  if(!base){server=await createPreviewServer(process.env.HW_SITE_ROOT?{siteRoot:resolve(process.env.HW_SITE_ROOT)}:{});await listenServer(server,{runtime,port:Number(o.port||0)});base='http://127.0.0.1:'+server.address().port;console.log('[cdp] owned preview '+base+'; device mapping must be owned by its device session');}
  browser=await managedConnectOverCDP(url,{runtime});
  // Existing device tabs/default contexts are borrowed and must never be reused or closed.
  context=await browser.newContext({viewport:null});await guard.guardContext(context);
  return {browser,context,base,engine:'chromium',cdpMode:true,blocked:guard.blocked,runtime,close:async()=>{try{await close();}finally{unregister();}}};
 }catch(e){await close().catch(c=>{e.cleanupError=c.message;});unregister();throw e;}
}
const openFixture=()=>o.cdp?cdpFixture(o.cdp):browserFixture({runtime});

// ---- in-page probe (installed before any page script): frames, scroll samples, event timing, CSP violations, errors, LoAF ----
const PROBE=`(()=>{const createNavigationTracker=${createNavigationTracker.toString()};
const makeActivity=()=>({native:{},regions:{},events:[],leaves:new Set(),pressedKeys:new Set(),pressedButtons:new Set(),scrollChanges:0,finderInputs:0});
const A=window.__ab={frames:[],sy:[],marks:[],exclusions:[],actionMarks:[],activity:makeActivity(),ev:[],evN:0,capturedInputs:[],syntheticEvents:0,eligibilityUnknown:0,csp:[],err:[],loaf:[],run:false,active:false,stall:0,activeFrames:0,eventSupported:false,startMs:0,nav:createNavigationTracker()};
const T=new Set(['pointerdown','pointerup','click','keydown','keyup','pointerover']);
for(const t of T)addEventListener(t,e=>{if(!A.run)return;if(!e.isTrusted){A.syntheticEvents++;return;}if(!Number.isFinite(e.timeStamp)||e.timeStamp<A.startMs){A.eligibilityUnknown++;return;}A.evN++;A.capturedInputs.push({id:A.evN,name:e.type,timeStamp:e.timeStamp,actionId:A.currentActionId??null,target:e.target?.id||e.target?.tagName||null});},true);
for(const t of ['pointermove','wheel','keydown','keyup','input','pointerdown','pointerup','pointercancel','click','resize'])addEventListener(t,e=>{
 if(!e.isTrusted)return;const a=A.activity,key=e.code||e.key;if(t==='keydown')a.pressedKeys.add(key);if(t==='keyup')a.pressedKeys.delete(key);if(t==='pointerdown')a.pressedButtons.add(e.button);if(t==='pointerup'||t==='pointercancel')a.pressedButtons.clear();if(!A.run)return;
 a.native[t]=(a.native[t]||0)+1;const leaf=e.target?.closest?.('button.leaf[data-leaf]')?.dataset?.leaf;if(leaf)a.leaves.add(leaf);if(t==='input'&&e.target?.id==='group-find')a.finderInputs++;
 if(t==='pointermove'){const node=e.target?.closest?.('.tree,#net,.net,#key-chips,#nav'),region=node?.matches?.('.tree')?'tree':node?.id==='key-chips'?'key':node?.id==='nav'?'nav':node?'net':null;if(region)a.regions[region]=(a.regions[region]||0)+1;}
 a.events.push({id:a.events.length+1,type:t,timeMs:performance.now(),eventStartMs:e.timeStamp,actionId:A.currentActionId??null,target:e.target?.id||leaf||e.target?.tagName||null});
 if(t==='wheel'||t==='pointerdown'||t==='pointercancel'||(t==='keydown'&&['Home','End','PageUp','PageDown','ArrowUp','ArrowDown',' '].includes(e.key)))A.nav.cancel({timeMs:performance.now(),reason:'trusted-'+t});
},true);
for(const type of ['leaf:pick','leaf:open','leaf:close'])document.addEventListener(type,e=>{if(A.run){const a=A.activity;a.native[type]=(a.native[type]||0)+1;a.events.push({id:a.events.length+1,type,timeMs:performance.now(),actionId:A.currentActionId??null,target:e.detail?.id});}});
addEventListener('blur',()=>{A.activity.pressedKeys.clear();A.activity.pressedButtons.clear();});
document.addEventListener('securitypolicyviolation',e=>A.csp.push(e.violatedDirective+' '+e.blockedURI),true);
addEventListener('error',e=>A.err.push(String(e.message)),true);addEventListener('unhandledrejection',e=>A.err.push('rejection '+String(e.reason)));
const destination=id=>{if(!id||id==='top')return 0;const target=document.getElementById(id);if(!target)return null;const padding=parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)||0,margin=parseFloat(getComputedStyle(target).scrollMarginTop)||0;return Math.max(0,Math.min(Math.max(0,document.documentElement.scrollHeight-innerHeight),target.getBoundingClientRect().top+scrollY-padding-margin));};
addEventListener('click',e=>{if(!A.run||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a||a.hasAttribute('data-open'))return;let id;try{id=decodeURIComponent(a.getAttribute('href').slice(1));}catch{id=null;}const to=id===null?null:destination(id);A.nav.request({timeMs:performance.now(),fromY:scrollY,destinationY:to,targetId:id,targetFound:to!==null});},true);
const takeEvents=entries=>{for(const e of entries)if(A.run&&T.has(e.name)&&e.startTime>=A.startMs)A.ev.push({name:e.name,duration:e.duration,startTime:e.startTime,interactionId:e.interactionId});};
try{A.eventObserver=new PerformanceObserver(l=>takeEvents(l.getEntries()));A.eventObserver.observe({type:'event',durationThreshold:16});A.eventSupported=PerformanceObserver.supportedEntryTypes.includes('event');}catch{}
try{new PerformanceObserver(l=>{if(A.run)for(const e of l.getEntries())A.loaf.push({d:e.duration,s:e.scripts.map(s=>({d:s.duration,u:s.sourceURL,f:s.sourceFunctionName,forced:s.forcedStyleAndLayoutDuration}))})}).observe({type:'long-animation-frame'})}catch{}
A.begin=()=>{A.eventObserver?.takeRecords();Object.assign(A,{frames:[],sy:[],marks:[],exclusions:[],actionMarks:[],activity:makeActivity(),ev:[],evN:0,capturedInputs:[],syntheticEvents:0,eligibilityUnknown:0,loaf:[],stall:0,activeFrames:0,startMs:performance.now(),nav:createNavigationTracker(),run:true});let prev=scrollY;const f=t=>{if(!A.run)return;A.frames.push(performance.now());const y=scrollY;A.sy.push(y);if(y!==prev)A.activity.scrollChanges++;if(A.active&&y>0&&y<document.documentElement.scrollHeight-innerHeight){A.activeFrames++;if(y===prev)A.stall++;}prev=y;const n=A.nav.current();if(n)A.nav.sample({timeMs:performance.now(),y,destinationY:destination(n.targetId)});requestAnimationFrame(f);};requestAnimationFrame(f);};
A.end=()=>{takeEvents(A.eventObserver?.takeRecords()||[]);const endMs=performance.now();A.run=false;const {frames,sy,marks,exclusions,actionMarks,ev,evN,capturedInputs,syntheticEvents,eligibilityUnknown,loaf,stall,activeFrames,startMs,eventSupported}=A,a=A.activity;return {frames,sy,marks,exclusions,actionMarks,activity:{native:a.native,regions:a.regions,events:a.events,uniqueLeaves:a.leaves.size,heldKeys:[...a.pressedKeys],heldButtons:[...a.pressedButtons],scrollChanges:a.scrollChanges,finderInputs:a.finderInputs},ev,evN,capturedInputs,syntheticEvents,eligibilityUnknown,loaf,stall,activeFrames,startMs,endMs,eventSupported,eventObserverDrained:!!A.eventObserver,navigation:A.nav.snapshot(),csp:A.csp.splice(0),err:A.err.splice(0)};};
})();`;

// ---- tracing / frame / attribution core (same events and MAIN map as perf-trace.mjs) ----
const CATS='toplevel,viz,cc,gpu,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,blink.user_timing,loading,blink,benchmark';
const MAIN={UpdateLayoutTree:'style',Layout:'layout',PrePaint:'prepaint',Paint:'paint',Layerize:'layerize',Commit:'commit',FunctionCall:'script',EventDispatch:'event',TimerFire:'timer',FireAnimationFrame:'raf',MajorGC:'gc',MinorGC:'gc','Decode Image':'decode'};
function index(ev){const th={};for(const e of ev)if(e.ph==='M'&&e.name==='thread_name')th[e.pid+':'+e.tid]=e.args.name;const X=[],I=[];for(const e of ev){e.th=th[e.pid+':'+e.tid];if(e.ph==='X'&&e.dur>0)X.push(e);else if(e.ph!=='M'&&e.ph!=='E'&&e.ph!=='B')I.push(e);}X.sort((a,b)=>a.ts-b.ts);I.sort((a,b)=>a.ts-b.ts);const mark=ev.find(e=>e.name==='pt-sync');return {X,I,mark,rpid:mark?.pid};}
async function traced(cdp,fn){await cdp.send('Tracing.start',{categories:CATS,transferMode:'ReturnAsStream'});let r,err;try{r=await fn();}catch(e){err=e;}
  const s=await finishCDPTrace(cdp,{runtime});
  const tracePath=resolve(outDir,'trace-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');await writeFile(tracePath,s);if(err){err.tracePath=tracePath;throw err;}return {r,tr:index(JSON.parse(s).traceEvents),tracePath};}
const srcOf=u=>!u?'inline':/chrome-extension:|extension/.test(u)?'extension':/taste\.[0-9a-f]+\.js/.test(u)?'taste':/(content|leaf|media)\.[0-9a-f]+\.js|\/(optimized|optimized-taste)\/?(index\.html)?$/.test(u)?'site':/\.js/.test(u)?'site':'inline';
function attribute(tr,lo,hi){const cat={},fn={},src={},paints=[],inv={},raster={};let rasterMs=0,gpu=0,gpuRaster=0,mainBusy=0,fcEnd=0;
  for(const e of tr.X){if(e.ts>=hi)break;const end=e.ts+e.dur;if(end<=lo)continue;const c=(Math.min(end,hi)-Math.max(e.ts,lo))/1000,d=e.args?.data;
    if(e.th==='CrRendererMain'&&e.pid===tr.rpid){if(e.name==='ThreadControllerImpl::RunTask')mainBusy+=c;const k=MAIN[e.name];if(k){cat[k]=(cat[k]||0)+c;
      if(e.name==='FunctionCall'&&d&&e.ts>=fcEnd){fcEnd=e.ts+e.dur;const key=(d.functionName||'(anon)')+' '+String(d.url||'').split('/').pop()+':'+d.lineNumber;fn[key]=(fn[key]||0)+c;const s=srcOf(d.url);src[s]=(src[s]||0)+c;}   // top-level calls only: nested calls would double count
      if(e.name==='Paint'&&d?.nodeId){const q=d.clip||[];paints.push({nodeId:d.nodeId,ms:c,area:q.length>=6?Math.round(Math.abs((q[2]-q[0])*(q[5]-q[1]))):null});}}}
    else if(e.name==='RasterTask'&&e.pid===tr.rpid&&e.args?.tileData){const id=e.args.tileData.layerId,r=raster[id]??={tiles:0,ms:0};r.tiles++;r.ms+=c;rasterMs+=c;}
    else if(e.th==='CrGpuMain'&&e.name==='RendererRasterWorker'){gpuRaster+=c;}
    else if((e.th==='CrGpuMain'&&e.name==='GPUTask')||e.name==='DirectRenderer::DrawFrame')gpu+=c;}
  for(const e of tr.I){if(e.ts>=hi)break;if(e.ts<lo)continue;if(/InvalidationTracking$/.test(e.name)&&e.pid===tr.rpid){const d=e.args?.data||{};const k=e.name.replace('InvalidationTracking','')+': '+(d.reason||d.invalidatedSelectorId||d.changedClass||d.changedAttribute||d.extraData||'')+' '+(d.invalidationSet||'');const r=inv[k]??={n:0,nodeId:d.nodeId,nodeName:d.nodeName};r.n++;}}
  const script=Math.max(cat.script||0,cat.raf||0,cat.event||0,cat.timer||0),groups={script,style:cat.style||0,layout:cat.layout||0,prepaint:cat.prepaint||0,paint:cat.paint||0,layerize:cat.layerize||0,commit:cat.commit||0,raster:rasterMs,gpu},dom=Object.entries(groups).sort((a,b)=>b[1]-a[1])[0];
  const cause=dom[1]<2?'none above 2 ms (compositor/GPU/vsync starvation or page frozen)':dom[0]==='gpu'&&gpuRaster>=gpu*.5?'gpu-raster':dom[0];   // gpu-raster = GPU-process raster of tiles (RendererRasterWorker) is most of the GPU time
  return {mainBusyMs:r1(mainBusy),ms:{...Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,r1(v)])),gpuRaster:r1(gpuRaster)},cause,scriptBySource:Object.fromEntries(Object.entries(src).map(([k,v])=>[k,r1(v)])),
    topFunctions:Object.entries(fn).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>({fn:k,ms:r1(v)})),paints:paints.sort((a,b)=>b.ms-a.ms).slice(0,3),invalidations:Object.entries(inv).sort((a,b)=>b[1].n-a[1].n).slice(0,4).map(([k,v])=>({what:k,n:v.n,nodeId:v.nodeId,nodeName:v.nodeName})),
    rasterLayers:Object.entries(raster).sort((a,b)=>b[1].tiles-a[1].tiles||b[1].ms-a[1].ms).slice(0,3).map(([id,v])=>({layerId:id,tiles:v.tiles,ms:r1(v.ms)}))};}
async function labelNodes(cdp,ids){const out={};try{await cdp.send('DOM.enable');await cdp.send('DOM.getDocument',{depth:0});}catch{return out;}
  await Promise.all([...ids].slice(0,200).map(async id=>{try{const n=(await cdp.send('DOM.describeNode',{backendNodeId:id})).node,at=n.attributes||[],g=k=>{const i=at.findIndex((x,j)=>j%2===0&&x===k);return i<0?'':at[i+1];};out[id]=n.nodeName.toLowerCase()+(g('id')?'#'+g('id'):'')+g('class').split(/\s+/).filter(c=>c&&!/^hw-s-/.test(c)).map(c=>'.'+c).join('');}catch{}}));return out;}
// cc layer id -> element label (end-of-window layer tree), for raster-per-layer attribution and layer-count leaks
async function layerMap(S){const {cdp,page}=S;let L=[],u=0;const on=e=>{if(e.layers){L=e.layers;u++;}};cdp.on('LayerTree.layerTreeDidChange',on);await cdp.send('LayerTree.enable');
  await page.evaluate(()=>{const d=document.createElement('i');d.id='ab-nudge';d.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;will-change:transform';document.body.append(d);});await sleep(250);const b=u;await page.evaluate(()=>document.getElementById('ab-nudge')?.remove());for(let i=0;i<30&&u===b;i++)await sleep(100);
  await cdp.send('LayerTree.disable');cdp.off('LayerTree.layerTreeDidChange',on);if(u===b||!L.length)throw Error('UNSUPPORTED layer counter: no fresh post-nudge LayerTree event');const map={};
  await Promise.all(L.map(async l=>{let label='(no node)';if(l.backendNodeId){const n=(await cdp.send('DOM.describeNode',{backendNodeId:l.backendNodeId}).catch(()=>null))?.node;if(n){const at=n.attributes||[],g=k=>{const i=at.findIndex((x,j)=>j%2===0&&x===k);return i<0?'':at[i+1];};label=n.nodeName.toLowerCase()+(g('id')?'#'+g('id'):'')+g('class').split(/\s+/).filter(c=>c&&!/^hw-s-/.test(c)).map(c=>'.'+c).join('');}}map[l.layerId]={label,w:l.width,h:l.height};}));
  return {map,count:Object.values(map).filter(x=>x.label!=='i#ab-nudge').length,total:L.length};}

// ---- sessions ----
const CONFIGS={
  d1:{name:'1365x768@1',ctx:{viewport:{width:1365,height:768},deviceScaleFactor:1,reducedMotion:'no-preference'},w:1365,h:768,dpr:1,mobile:false,cpu:1},
  d2:{name:'1424x820@2',ctx:{viewport:{width:1424,height:820},deviceScaleFactor:2,reducedMotion:'no-preference'},w:1424,h:820,dpr:2,mobile:false,cpu:1},
  m:{name:'Pixel 7 cpu x4',ctx:{...devices['Pixel 7'],reducedMotion:'no-preference'},w:devices['Pixel 7'].viewport.width,h:devices['Pixel 7'].viewport.height,dpr:devices['Pixel 7'].deviceScaleFactor,mobile:true,cpu:4},
};
const SNAP=()=>{const shown=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none'&&Number(c.opacity)>0;};
  return {lit:document.querySelectorAll('.is-lit').length,taste:document.querySelectorAll('[class*="hw-taste-"]').length,htmlStyle:document.documentElement.style.cssText,bodyStyle:document.body.style.cssText,infinite:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getComputedTiming().endTime===Infinity).length,leaves:document.querySelectorAll('.tree button.leaf[data-leaf]').length,leavesShown:[...document.querySelectorAll('.tree button.leaf[data-leaf]')].filter(shown).length};};
async function openSession(F,cfg,route,name,log){
  let ctx,page;if(F.cdpMode){ctx=F.context;if(!ctx.__abProbe){await ctx.addInitScript(PROBE);ctx.__abProbe=true;}page=await ctx.newPage();}else{ctx=await F.browser.newContext(cfg.ctx);await ctx.addInitScript(PROBE);page=await ctx.newPage();}const cdp=manageCDPSession(await ctx.newCDPSession(page),runtime);
  const S={F,ctx,page,cdp,cfg:{...cfg},route,name,cdpMode:!!F.cdpMode,close:async()=>F.cdpMode?page.close().catch(()=>{}):ctx.close().catch(()=>{}),errors:[],failed:[],resume:[],orient:0,rng:rngOf(route+name,SEED),actionLog:[],operationStats:{attempted:{},sent:{},skipped:{}},heldKeys:new Set(),heldButtons:new Set()};
  page.on('pageerror',e=>S.errors.push('pageerror: '+e.message.split('\n')[0]));
  page.on('console',m=>{const t=m.text();if(m.type()==='error'&&!/ERR_PROXY|ERR_TUNNEL|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_BLOCKED/.test(t))S.errors.push('console: '+t.slice(0,200));});
  page.on('requestfailed',r=>{if(isLocalUrl(r.url())&&!/ERR_ABORTED/.test(r.failure()?.errorText||''))S.failed.push(r.url()+' '+r.failure()?.errorText);});
  page.on('response',r=>{if(isLocalUrl(r.url())&&r.status()>=400)S.failed.push(r.status()+' '+r.url());});
  const response=await page.goto(`${F.base}/${route}/`,{waitUntil:'load'});if(!response)throw Error('navigation response missing');
  const htmlSha256=sha256(await response.body()),m=route==='local'?null:await ctx.request.get(`${F.base}/${route}/manifest.json`),manifestBytes=m?await m.body():null;
  if(m&&!m.ok())throw Error('manifest response '+m.status());const manifest=manifestBytes?JSON.parse(manifestBytes):null;if(manifest&&manifest.htmlSha256!==htmlSha256)throw Error('served HTML and manifest generations differ');
  S.provenance={url:response.url(),htmlSha256,manifestSha256:manifestBytes?sha256(manifestBytes):null,sourceHashes:LOADED_SOURCE_HASHES,browser:F.browser.version(),engine:F.engine,headless:F.cdpMode?null:process.env.HW_HEADLESS!=='0',executableSelection:F.cdpMode?'existing CDP connection':process.env.HW_BROWSER_EXECUTABLE||'browser fixture platform default',platform:process.platform,arch:process.arch,node:process.version,config:cfg,loadedAtUtc:new Date().toISOString(),cdpMode:!!F.cdpMode,requestedConfig:cfg,contentEncoding:response.headers()['content-encoding']||'identity'};
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>window.leafLift&&document.querySelector('.tree button.leaf[data-leaf]'),null,{timeout:15000});
  if(F.cdpMode)Object.assign(S.cfg,await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})),{mobile:true,cpu:1});
  if(cfg.cpu>1&&!F.cdpMode)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cfg.cpu});
  await cdp.send('HeapProfiler.enable').catch(()=>{});await sleep(S.cfg.cpu>1?4500:3000);   // original canopy entrance (leaf-out) finishes before abuse starts
  S.provenance.effectiveConfig=S.cfg;S.frameId=(await cdp.send('Page.getFrameTree')).frameTree.frame.id;S.base0=await page.evaluate(SNAP);return S;}
const metricsOverride=(S,w=S.cfg.w,h=S.cfg.h,dpr=S.cfg.dpr,extra={})=>S.cdpMode?Promise.resolve(false):S.cdp.send('Emulation.setDeviceMetricsOverride',{width:Math.round(w),height:Math.round(h),deviceScaleFactor:dpr,mobile:S.cfg.mobile,...extra});

// ---- actions (shared by scenarios and the chaos monkey). Only same-page anchors and buttons are ever clicked: never an external link. ----
// viewport mode also hit-tests the centre (covered or hidden targets are skipped: a tap there would land on whatever is on top, possibly an outbound link)
const rects=(S,sel,viewportOnly=true)=>S.page.evaluate(([sel,vo])=>[...document.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;let hit=true;if(vo){const t=document.elementFromPoint(x,y);hit=!!t&&(e.contains(t)||t.contains(e));}return {x,y,w:r.width,h:r.height,l:r.left,t:r.top,r:r.right,b:r.bottom,hit};}).filter(r=>r.w>0&&r.h>0&&(!vo||(r.hit&&r.x>2&&r.x<innerWidth-2&&r.y>2&&r.y<innerHeight-2))),[sel,viewportOnly]);
const scrollTo_=(S,fn,arg)=>S.page.evaluate(([f,a])=>{const el=document.querySelector(a);if(!el)return false;window.__ab.nav.cancel({timeMs:performance.now(),reason:'explicit-target-reposition'});const r=el.getBoundingClientRect();scrollTo({top:Math.max(0,scrollY+r.top+r.height/2-innerHeight/2),behavior:'instant'});return true;},[fn,arg]);
const extLink=(S,x,y)=>S.page.evaluate(([x,y])=>{const a=document.elementFromPoint(x,y)?.closest('a[href]');return !!a&&a.origin!==location.origin;},[x,y]);
const tapAt=async(S,x,y)=>{if(await extLink(S,x,y))return false;return S.cfg.mobile?S.page.touchscreen.tap(x,y):S.page.mouse.click(x,y);};   // never click an outbound link
const maxY=S=>S.page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
const gesture=(S,p)=>S.cdp.send('Input.synthesizeScrollGesture',Object.fromEntries(Object.entries(p).map(([k,v])=>[k,typeof v==='number'?Math.round(v):v])));
const A={
  wheel:(S,dy)=>S.cfg.mobile?gesture(S,{x:S.cfg.w/2,y:S.cfg.h/2,yDistance:-dy,speed:Math.max(800,Math.abs(dy)*8),gestureSourceType:'touch'}):S.page.mouse.wheel(0,dy),
  key:(S,k)=>S.page.keyboard.press(k),
  jump:(S,f)=>S.page.evaluate(f=>{window.__ab.nav.cancel({timeMs:performance.now(),reason:'explicit-instant-jump'});const m=Math.max(0,document.documentElement.scrollHeight-innerHeight),requested=Math.round(f*m),t=Math.max(0,Math.min(m,requested));scrollTo({top:requested,behavior:'instant'});return {requested,t,y:scrollY};},f),
  async nav(S,i){let rs=await rects(S,'#nav a[href^="#"]');if(!rs.length){const menu=await rects(S,'.top__menu');if(menu.length){await tapAt(S,menu[0].x,menu[0].y);await sleep(160);rs=await rects(S,'#nav a[href^="#"]');}}if(!rs.length)return false;return tapAt(S,rs[i%rs.length].x,rs[i%rs.length].y);},
  async brand(S){const rs=await rects(S,'#top a[href="#top"]');if(!rs.length)return false;return tapAt(S,rs[0].x,rs[0].y);},
  async hover(S,fx,fy){return S.page.mouse.move(S.cfg.w*fx,S.cfg.h*fy);},
  async chip(S,i){let rs=await rects(S,'#key-chips .chip');if(!rs.length){await scrollTo_(S,'',"#key-chips");rs=await rects(S,'#key-chips .chip');}if(rs.length)return tapAt(S,rs[i%rs.length].x,rs[i%rs.length].y);return false;},
  async leaf(S,i){let rs=await rects(S,'.tree button.leaf[data-item]');if(!rs.length){await S.page.evaluate(()=>{window.__ab.nav.cancel({timeMs:performance.now(),reason:'leaf-target-reposition'});scrollTo({top:0,behavior:'instant'});});await sleep(60);rs=await rects(S,'.tree button.leaf[data-item]');}if(rs.length){const r=rs[i%rs.length];return tapAt(S,r.x,r.y);}return false;},
  esc:S=>S.page.keyboard.press('Escape'),
  back:S=>S.page.evaluate(()=>history.back()),fwd:S=>S.page.evaluate(()=>history.forward()),
  async type(S,str){const f=S.page.locator('#group-find');if(!(await rects(S,'#group-find')).length)await scrollTo_(S,'',"#group-find");await f.focus();if(!await S.page.evaluate(()=>document.activeElement?.id==='group-find'))return false;await S.page.keyboard.type(str,{delay:S.cfg.mobile?40:15});},
  async tab(S,n,shift=false){for(let i=0;i<n;i++){await S.page.keyboard.press(shift?'Shift+Tab':'Tab');await sleep(22);}},
  resize:(S,w)=>metricsOverride(S,w,S.cfg.h),
  zoom:(S,z)=>metricsOverride(S,S.cfg.w/z,S.cfg.h/z,S.cfg.dpr*z),
  dpr:(S,d)=>metricsOverride(S,S.cfg.w,S.cfg.h,d),
  rm:(S,on)=>S.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:on?'reduce':'no-preference'}]}),
  async pinch(S,s){try{await S.cdp.send('Input.synthesizePinchGesture',{x:S.cfg.w/2,y:S.cfg.h/2,scaleFactor:s,relativeSpeed:900,gestureSourceType:'touch'});}catch{await S.cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:Math.max(1,Math.min(3,s))}).catch(()=>{});}},
  async freeze(S,ms){const fromMs=await S.page.evaluate(()=>performance.now());await S.cdp.send('Page.setWebLifecycleState',{state:'frozen'});await sleep(ms);const t=Date.now();await S.cdp.send('Page.setWebLifecycleState',{state:'active'});await S.page.evaluate(fromMs=>new Promise(r=>requestAnimationFrame(()=>{const n=performance.now();window.__ab.marks.push(n);window.__ab.exclusions.push({fromMs,toMs:n,reason:'lifecycle-frozen-and-first-resume-frame'});r(n);})),fromMs);S.resume.push(Date.now()-t);},
  async orient(S){S.orient^=1;const l=S.orient===1;return metricsOverride(S,l?S.cfg.h:S.cfg.w,l?S.cfg.w:S.cfg.h,S.cfg.dpr,{screenOrientation:{type:l?'landscapePrimary':'portraitPrimary',angle:l?90:0}});},
  async swipeNet(S,dx){const rs=await rects(S,'#net, .net',false);const r=rs.find(r=>r.b>0&&r.t<S.cfg.h)||rs[0];if(r)return gesture(S,{x:Math.max(10,Math.min(S.cfg.w-10,r.x)),y:Math.max(10,Math.min(S.cfg.h-10,r.y)),xDistance:dx,speed:2500,gestureSourceType:'touch'});},
  async longPress(S,x,y){return S.cdp.send('Input.synthesizeTapGesture',{x,y,duration:650,tapCount:1,gestureSourceType:'touch'});},
  async spore(S,i){let rs=await rects(S,'.spore[data-item]');if(!rs.length){await scrollTo_(S,'',".spore[data-item]");rs=await rects(S,'.spore[data-item]');}if(rs.length)return tapAt(S,rs[i%rs.length].x,rs[i%rs.length].y);return false;},
  async keyDown(S,key){await S.page.keyboard.down(key);S.heldKeys.add(key);},
  async keyUp(S,key){await S.page.keyboard.up(key);S.heldKeys.delete(key);},
  async pointerDown(S,x,y){await S.page.mouse.move(x,y);if(await extLink(S,x,y))return false;await S.page.mouse.down();S.heldButtons.add('left');},
  async pointerUp(S){await S.page.mouse.up();S.heldButtons.delete('left');},
};
// One causal mark per controlled action, not per rAF. Marks and native events are
// correlation evidence; they do not prove that a particular selector caused a stall.
async function performed(S,kind,args,fn){
  if(!S.captureActions)return fn();
  const id=S.actionLog.length+1,row={id,kind,args,status:'attempted',wallStart:new Date().toISOString()};S.actionLog.push(row);
  S.operationStats.attempted[kind]=(S.operationStats.attempted[kind]||0)+1;
  row.fromMs=await S.page.evaluate(({id,kind})=>{const a=window.__ab;a.currentActionId=id;const t=performance.now();a.actionMarks.push({id,kind,fromMs:t});return t;},{id,kind});
  const metricAction=['resize','zoom','dpr','orient','pinch'].includes(kind),metric=()=>S.page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scale:visualViewport?.scale}));if(metricAction)row.beforeMetrics=await metric();
  try{const result=await fn();row.status=result===false?'skipped':'sent';const group=result===false?'skipped':'sent';S.operationStats[group][kind]=(S.operationStats[group][kind]||0)+1;return result;}
  catch(e){row.status='failed';row.error=e.message;throw e;}
  finally{if(metricAction){row.afterMetrics=await metric();if(JSON.stringify(row.beforeMetrics)!==JSON.stringify(row.afterMetrics))response(S,'metricsChanged');}row.toMs=await S.page.evaluate(id=>{const a=window.__ab,t=performance.now();const m=a.actionMarks.find(m=>m.id===id);if(m)m.toMs=t;return t;},id);}
}
for(const [kind,fn] of Object.entries(A))A[kind]=(S,...args)=>performed(S,kind,args,()=>fn(S,...args));
const requireSent=(result,label)=>{if(result===false)throw Error('UNSUPPORTED activity: '+label+' had no visible target / native operation');};
const response=(S,kind)=>{S.responses??={};S.responses[kind]=(S.responses[kind]||0)+1;};
const featureState=S=>S.page.evaluate(()=>({y:scrollY,filter:document.querySelector('#key-chips .chip[aria-pressed="true"]')?.dataset.filter,finder:document.getElementById('group-find')?.value,
  state:window.leafLift.state(),busy:window.leafLift.busy(),dialogOpen:!document.getElementById('dialog').hidden,lit:document.querySelectorAll('.net__hyphae .is-lit').length,width:innerWidth,dpr:devicePixelRatio}));
async function hoverBurst(S,count=24){return performed(S,'hoverBurst',[count],async()=>{
  const rs=await rects(S,'.tree button.leaf[data-item]');if(rs.length<3)return false;
  for(let j=0;j<count;j++){const r=rs[(Math.floor(S.rng()*rs.length)+j*7)%rs.length];await S.page.mouse.move(r.x,r.y);if(j%6===5)await S.page.mouse.wheel(0,(j%12?1:-1)*40);}
});}
async function sweepRegion(S,sel,ms,rng){const g=await S.page.evaluate(sel=>{const els=[...document.querySelectorAll(sel)].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);if(!els.length)return null;return {l:Math.min(...els.map(r=>r.left)),r:Math.max(...els.map(r=>r.right)),t:Math.min(...els.map(r=>r.top))+scrollY,b:Math.max(...els.map(r=>r.bottom))+scrollY};},sel);if(!g)return false;
  await S.page.evaluate(y=>scrollTo({top:Math.max(0,y),behavior:'instant'}),(g.t+g.b)/2-S.cfg.h/2);await sleep(250);const sy=await S.page.evaluate(()=>scrollY),t0=Date.now(),ph=rng()*6;
  while(Date.now()-t0<ms){const t=(Date.now()-t0)/1000,x=g.l+(g.r-g.l)*(.5+.47*Math.sin(t*Math.PI*7+ph)),y=Math.min(S.cfg.h-4,Math.max(4,g.t-sy+Math.min(g.b-g.t,S.cfg.h-8)*(.5+.45*Math.sin(t*Math.PI*4.3))));await S.page.mouse.move(x,y);await sleep(4);}return true;}

// ---- return to rest + invariants ----
async function toRest(S){const {page,cdp}=S,notes=[];
  for(const key of [...S.heldKeys]){await page.keyboard.up(key);S.heldKeys.delete(key);}for(const button of [...S.heldButtons]){await page.mouse.up({button});S.heldButtons.delete(button);}
  await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1}).catch(()=>{});await metricsOverride(S);await A.rm(S,false).catch(()=>{});await cdp.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});
  await page.keyboard.press('Escape').catch(()=>{});
  try{await page.waitForFunction(()=>!window.leafLift.busy(),null,{timeout:9000});}catch{notes.push('leafLift still busy 9 s after Escape');}
  await page.evaluate(()=>{document.querySelector('#key-chips .chip[data-filter="all"]')?.click();const f=document.getElementById('group-find');if(f&&f.value){f.value='';f.dispatchEvent(new Event('input',{bubbles:true}));}document.activeElement?.blur?.();});
  if(!S.cfg.mobile)await page.mouse.move(2,2);await sleep(1500);return notes;}
async function restState(S,notes=[]){const v=[...notes],b=S.base0;
  const s=await S.page.evaluate(()=>{const dlg=document.getElementById('dialog'),at=(x,y)=>{const e=document.elementFromPoint(x,y);return !!(e&&e.closest('#scrim,#dialog'));};
    return {sy:scrollY,sx:scrollX,max:document.documentElement.scrollHeight-innerHeight,hash:location.hash,dlgHidden:dlg.hidden,state:window.leafLift.state(),busy:window.leafLift.busy(),flyers:document.querySelectorAll('#lift .flyer').length,lifted:document.querySelectorAll('.is-lifted,.is-away').length,lit:document.querySelectorAll('.is-lit').length,
      taste:[...document.querySelectorAll('[class*="hw-taste-"]')].length,searching:document.querySelectorAll('.is-searching').length,filtered:document.querySelectorAll('.is-filtered').length,scrimHit:at(innerWidth/2,innerHeight/2)||at(8,innerHeight/2),vv:window.visualViewport?.scale,focus:document.activeElement?.tagName,
      heldKeys:[...window.__ab.activity.pressedKeys],heldButtons:[...window.__ab.activity.pressedButtons],csp:window.__ab.csp.splice(0),err:window.__ab.err.splice(0)};});
  const now=await S.page.evaluate(SNAP);
  if(!s.dlgHidden)v.push('dialog still open');if(s.state!=='idle')v.push('leafLift state '+s.state);if(s.flyers)v.push(s.flyers+' flyer(s) left in #lift');if(s.lifted)v.push(s.lifted+' stuck lifted/away leaf(s)');
  if(s.lit!==b.lit)v.push(`${s.lit} element(s) .is-lit at rest vs ${b.lit} at load (lit route stuck or lost)`);if(s.taste!==b.taste)v.push(`${s.taste} hw-taste-* element(s) at rest vs ${b.taste} at load`);if(s.scrimHit)v.push('scrim/dialog intercepts the page centre');if(s.searching||s.filtered)v.push('finder/filter state left');
  if(s.hash.startsWith('#leaf-')&&s.dlgHidden)v.push('stale hash '+s.hash+' with the dialog closed');if(s.sy<0||s.sy>s.max+1)v.push(`scrollY ${s.sy} outside 0..${s.max}`);if(s.sx)v.push('horizontal page scroll '+s.sx);if(s.vv&&Math.abs(s.vv-1)>.001)v.push('page scale '+s.vv);
  if(now.htmlStyle!==b.htmlStyle||now.bodyStyle!==b.bodyStyle)v.push(`html/body inline style changed (scroll lock left?): "${now.htmlStyle}" "${now.bodyStyle}"`);
  if(now.leavesShown<b.leavesShown)v.push(`leaves shown ${now.leavesShown}/${b.leavesShown}`);if(now.infinite<b.infinite*.9)v.push(`infinite animations running ${now.infinite} vs ${b.infinite} at load (stuck paused?)`);
  if(s.csp.length)v.push('CSP violations: '+s.csp.slice(0,3).join('; '));if(s.err.length)v.push('page errors: '+s.err.slice(0,3).join('; '));
  if(s.heldKeys.length||s.heldButtons.length)v.push('input still pressed at rest: '+JSON.stringify({keys:s.heldKeys,buttons:s.heldButtons}));
  if(S.errors.length)v.push('console/page errors: '+S.errors.splice(0).slice(0,3).join('; '));if(S.failed.length)v.push('failed local requests: '+S.failed.splice(0).slice(0,3).join('; '));
  return v;}

// ---- measurement window ----
// The clean heartbeat/input/navigation pass and the unconditional compositor validation trace are distinct measurements. Trace overhead is reported, never silently normalized away.
async function measure(S,action,{trace=false}={}){const {page,cdp}=S;
  const body=async()=>{S.captureActions=true;const utcStart=new Date().toISOString();const mk=await page.evaluate(()=>{const m=performance.mark('pt-sync').startTime;window.__ab.begin();return m;});const t=Date.now();await action();const actionMs=Date.now()-t;
    await page.waitForFunction(deadline=>{const a=window.__ab,n=a.nav.current();if(!n)return true;const now=performance.now(),frozen=a.exclusions.reduce((s,e)=>s+Math.max(0,Math.min(now,e.toMs)-Math.max(n.timeMs,e.fromMs)),0);return now-n.timeMs-frozen>=deadline;},G.navArrivalMaxMs,{timeout:G.navArrivalMaxMs+1000});
    await sleep(100);const d=await page.evaluate(()=>window.__ab.end());S.captureActions=false;return {mk,d,actionMs,tailMs:Date.now()-t-actionMs,utcStart,utcEnd:new Date().toISOString()};};
  const {tr,r,tracePath}=trace?await traced(cdp,body):{tr:null,r:await body()};
  const {mk,d}=r;if(tr&&!tr.mark)throw Error('compositor validation trace has no synchronization mark');const off=tr?tr.mark.ts/1000-mk:0,fr=d.frames;
  const raf=analyzeFrameWindow({startMs:d.startMs,endMs:d.endMs,frames:fr,exclusions:d.exclusions});
  const draws=!tr?[]:tr.X.filter(e=>e.name==='DirectRenderer::DrawFrame').map(e=>e.ts/1000-off).filter(t=>t>=d.startMs&&t<=d.endMs).sort((a,b)=>a-b);
  const dropped=!tr?[]:[...tr.X,...tr.I].filter(e=>e.name==='PipelineReporter'&&e.ph==='b'&&e.args?.chrome_frame_reporter?.state==='STATE_DROPPED').map(e=>e.ts/1000-off);
  const compositor=tr?analyzeCompositorWindow({startMs:d.startMs,endMs:d.endMs,draws:[...new Set(draws)],dropped,exclusions:d.exclusions}):null;
  const all=correlateMissIntervals([...raf.intervals.filter(g=>g.gapMs>25).map((g,i)=>({...g,id:'raf-'+i,kind:g.kind})),...(compositor?.intervals||[]).filter(g=>g.gapMs>25).map((g,i)=>({...g,id:'compositor-'+i,kind:'compositor-submission'}))].sort((a,b)=>b.gapMs-a.gapMs));
  const ids=new Set(),attribution=attributeAllMisses(all,m=>{const lo=(m.fromMs+off)*1000,hi=(m.toMs+off)*1000;if(!tr)return {atMs:r1(m.fromMs-d.startMs),cause:'unresolved-clean-run',ms:{},topFunctions:[],paints:[],invalidations:[],rasterLayers:[],scriptBySource:{}};const a=attribute(tr,lo,hi);a.paints.forEach(p=>ids.add(p.nodeId));a.invalidations.forEach(i=>i.nodeId&&ids.add(i.nodeId));return {atMs:r1(m.fromMs-d.startMs),...a};});
  const {allMisses,worst}=attribution;
  const names=tr?await labelNodes(cdp,ids):{};let lm=null;if(worst.some(w=>w.rasterLayers.length&&w.ms.raster>2))lm=await layerMap(S).catch(()=>null);
  for(const w of allMisses){w.paints=(w.paints||[]).map(p=>({...p,el:names[p.nodeId]||'node '+p.nodeId}));w.invalidations=(w.invalidations||[]).map(i=>({...i,el:names[i.nodeId]||i.nodeName||''}));w.rasterLayers=(w.rasterLayers||[]).map(l=>({...l,el:lm?.map[l.layerId]?.label||'layer '+l.layerId}));}
  const loafSrc={};for(const f of d.loaf)for(const s of f.s){const k=srcOf(s.u);loafSrc[k]=(loafSrc[k]||0)+s.d;}
  const input=analyzeInput({eventCount:d.evN,entries:d.ev,supported:d.eventSupported});
  const inputTrace=tr?analyzeTraceInputs({captured:d.capturedInputs,traceEvents:tr.I,startMs:d.startMs,endMs:d.endMs,rendererPid:tr.rpid,frameId:S.frameId,exclusions:d.exclusions}):null;input.syntheticEvents=d.syntheticEvents;input.eligibilityUnknown=d.eligibilityUnknown;
  if(inputTrace&&d.eligibilityUnknown){inputTrace.issues.push(d.eligibilityUnknown+' trusted events had unknown eligibility');inputTrace.coverage='unsupported';inputTrace.p95UpperBoundMs=null;}
  const navigation=analyzeNavigation({requests:d.navigation,endMs:d.endMs,exclusions:d.exclusions},{firstMoveMaxMs:G.navFirstMoveP95Ms,arrivalMaxMs:G.navArrivalMaxMs});
  const res={frames:fr.length,intervals:raf.intervals.length,p50Ms:raf.p50Ms,p95Ms:raf.p95Ms,maxMs:raf.maxMs,misses:all.length,missesOver50:all.filter(m=>m.gapMs>50).length,...attribution,raf,compositor,input,inputTrace,navigation,
    provenance:S.provenance,activity:{...d.activity,...S.operationStats,responses:{...(S.responses||{}),scrollChanges:d.activity.scrollChanges,finderInputs:d.activity.finderInputs,navRequests:navigation.requests,navArrivals:navigation.rows.filter(r=>r.status==='arrived').length},rounds:S.rounds||0,retainedFailures:S.retainedFailures||[]},actionLog:S.actionLog,actionMarks:d.actionMarks,trollDuration:S.trollDuration||null,
    physicalPresentation:{status:'unmeasured',reason:'CDP compositor submission and main-thread rAF are not physical display presentation'},continuousInputLatency:{status:'unmeasured',reason:'EventTiming captures eligible discrete events; wheel/pointermove-to-display latency is not measured'},measurement:{trace,tracePath,traceSha256:tracePath?sha256(readFileSync(tracePath)):null,actionMs:r.actionMs,tailMs:r.tailMs,startMs:d.startMs,endMs:d.endMs,utcStart:r.utcStart,utcEnd:r.utcEnd,capturedInputs:d.capturedInputs,streamScopes:["main-thread-rAF","CDP EventTiming completed spans","compositor submission"],instrumentation:'Two action-mark Runtime calls per controlled action; native event ledger and geometry/response reads add overhead. Dedicated pointer sweeps batch moves.'},
    scrollStall:d.activeFrames?{activeFrames:d.activeFrames,stalled:d.stall,ratio:r1(d.stall/d.activeFrames*1000)/1000}:null,scriptBySourceMs:Object.fromEntries(Object.entries(loafSrc).map(([k,v])=>[k,r1(v)])),longAnimationFrames:d.loaf.length,pageErrors:d.err,csp:d.csp};
  if(S.resume.length){res.resumeFrameMs={n:S.resume.length,max:Math.max(...S.resume),p95:pct(S.resume,.95)};S.resume=[];}
  return res;}

// ---- scenarios ----
// each: {name, cfgs, quick, run(S, dur) => action run INSIDE the measured window; setup(S) before; leak:true => leak probe instead of a frame window}
const loop=async(ms,fn)=>{const t=Date.now();let i=0;while(Date.now()-t<ms)await fn(i++);return i;};
const flag=(S,on)=>S.page.evaluate(on=>{window.__ab.active=on;},on);
const SC=[
  {name:'idle-floor',cfgs:['d1','d2','m'],quick:true,run:async(S,dur)=>{await sleep(dur*1000);},note:'no input at all: the floor every abuse number sits on (critters, network, hero animations)'},
  {name:'troll-combined',emu:true,cfgs:['d1','d2'],quick:true,run:async(S,dur)=>{
    // A seeded macro keeps every class effective. Short windows are explicitly
    // limited; full mode keeps churning for at least 30 s and eight full rounds.
    const started=Date.now(),windowMs=Math.max(dur*1000,quick?8000:30000),minRounds=quick?2:8;S.rounds=0;S.retainedFailures=[];
    const macroSent=(result,label)=>{if(result===false){S.retainedFailures.push({round:S.rounds,kind:'unavailable-native-operation',message:label+' had no eligible native target / operation'});return false;}return true;};
    while(Date.now()-started<windowMs||S.rounds<minRounds){const i=S.rounds++;
      await A.esc(S);await idleWait(S);await A.jump(S,0);await sleep(45);
      macroSent(await hoverBurst(S), 'canopy hover burst');
      const y=(await featureState(S)).y;await A.wheel(S,350+S.rng()*450);await A.keyDown(S,'ArrowDown');await sleep(55);await A.keyDown(S,'ArrowDown');await A.keyUp(S,'ArrowDown');await sleep(35);if((await featureState(S)).y!==y)response(S,'scroll');
      const before=await featureState(S);macroSent(await A.chip(S,1+i%6),'filter');const after=await featureState(S);if(before.filter!==after.filter&&after.filter!=='all')response(S,'filter');
      macroSent(await A.type(S,'forest'),'finder');if((await featureState(S)).finder.includes('forest'))response(S,'finder');await A.key(S,process.platform==='darwin'?'Meta+A':'Control+A');await A.key(S,'Backspace');macroSent(await A.chip(S,0),'reset filter');
      await A.jump(S,0);await sleep(40);macroSent(await A.leaf(S,Math.floor(S.rng()*120)),'modal leaf');if((await featureState(S)).busy)response(S,'modalStarted');
      const width=(await featureState(S)).width;await A.resize(S,i%2?1100:860);if((await featureState(S)).width!==width)response(S,'viewport');await A.dpr(S,i%2?1:2);if((await featureState(S)).dpr===(i%2?1:2))response(S,'dpr');
      await A.freeze(S,70);
      if(i%2){try{await S.page.waitForFunction(()=>window.leafLift.state()==='open'&&!document.getElementById('dialog').hidden,null,{timeout:6000});response(S,'modalOpened');}catch(error){S.retainedFailures.push({round:i+1,kind:'modal-open-coverage',message:error.message});}}
      else {await A.wheel(S,120);await A.key(S,'PageDown');}
      // A visible brand must remain usable during opening/open overlays, even
      // when its destination is the already-current document top.
      try{requireSent(await A.brand(S),'brand navigation during overlay');await S.page.waitForFunction(()=>!window.leafLift.busy(),null,{timeout:G.navArrivalMaxMs});response(S,'overlayNavSettled');}
      catch(error){const diagnostic=await S.page.evaluate(()=>{const el=document.querySelector('#top a[href="#top"]'),r=el?.getBoundingClientRect(),x=r?r.left+r.width/2:null,y=r?r.top+r.height/2:null,hit=r?document.elementFromPoint(x,y):null,c=el?getComputedStyle(el):null;
        return {timeMs:performance.now(),selector:'#top a[href="#top"]',rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,hit:hit?{tag:hit.tagName,id:hit.id,className:String(hit.className)}:null,targetContainsHit:!!el&&!!hit&&(el.contains(hit)||hit.contains(el)),style:c?{display:c.display,visibility:c.visibility,opacity:c.opacity,pointerEvents:c.pointerEvents}:null,overlayState:window.leafLift.state(),dialogOpen:!document.getElementById('dialog').hidden,scrollY,hash:location.hash,viewport:{width:innerWidth,height:innerHeight}};});
        S.retainedFailures.push({round:i+1,kind:'brand-during-overlay',message:error.message,diagnostic,interpretation:'Required native navigation operation/settlement failed; target availability alone is not proof of a product navigation bug.'});}
      // Real Escape recovery lets every later feature class run. The retained
      // failure is still fatal to coverage in BOTH clean and instrumented passes.
      await A.esc(S);await idleWait(S);response(S,'modalSettled');await metricsOverride(S);
      const rs=await rects(S,'.tree button.leaf[data-item]');if(rs.length){const r=rs[Math.floor(S.rng()*rs.length)];if(macroSent(await A.pointerDown(S,r.x,r.y),'leaf press')){await S.page.mouse.move(3,3);await A.wheel(S,90);await A.esc(S);await A.pointerUp(S);await idleWait(S);}}else macroSent(false,'leaf pointer ownership');
      macroSent(await A.nav(S,1+i%5),'anchor navigation');await sleep(60);macroSent(await A.brand(S),'brand #top retarget');await sleep(65);
      const r=await A.jump(S,-.25);if(r.y!==0||r.t!==0)S.retainedFailures.push({round:i+1,kind:'negative-offset',message:'negative offset did not clamp to document top',observed:r});macroSent(await A.brand(S),'brand no-op target'); // legitimate no-op target
      await scrollTo_(S,'','.net__stage, #net');const spores=await rects(S,'.spore[data-item]');if(!spores.length)macroSent(false,'network hover target');else {const sp=spores[(i*11)%spores.length];await performed(S,'networkHover',[i],()=>S.page.mouse.move(sp.x,sp.y));if((await featureState(S)).lit>0)response(S,'network');await S.page.mouse.move(2,2);}
      await A.resize(S,S.cfg.w);await A.dpr(S,S.cfg.dpr);
      if(S.rounds>minRounds*4&&Date.now()-started>windowMs+15000)throw Error('combined stress could not complete bounded rounds');
    }
    S.trollDuration={requestedMs:dur*1000,minimumMs:windowMs,actualMs:Date.now()-started,minimumRounds:minRounds};
  },coverage:()=>({sent:{hoverBurst:2,wheel:4,keyDown:4,keyUp:2,chip:4,type:2,leaf:2,resize:4,dpr:4,freeze:2,pointerDown:2,pointerUp:2,nav:2,brand:2,networkHover:2},native:{pointermove:20,wheel:4,keydown:4,keyup:4,input:2,pointerdown:4,pointerup:4,'leaf:pick':2,'leaf:close':2},responses:{scroll:1,filter:2,finder:2,modalStarted:2,modalOpened:1,modalSettled:2,overlayNavSettled:2,viewport:2,dpr:2,network:2},uniqueLeaves:3,rounds:quick?2:8}),note:'seeded real-input combined churn; quick >=8 s /2 rounds, full >=30 s /8 rounds; class/effect minima; continuous pointer/wheel input-to-display latency remains unmeasured'},
  {name:'scroll-wheel-flips',cfgs:['d1','d2','m'],quick:true,run:async(S,dur)=>{let dir=1,left=0;await loop(dur*1000,async()=>{if(left--<=0){dir=-dir;left=3+Math.floor(S.rng()*6);}const y=await S.page.evaluate(()=>scrollY),m=await maxY(S);if(y<200)dir=1;else if(y>m-200)dir=-1;await A.wheel(S,dir*(150+S.rng()*1100));await sleep(6+S.rng()*10);});}},
  {name:'scroll-fling-bottom-top',cfgs:['d1','d2','m'],quick:true,run:async(S,dur)=>{const H=await maxY(S);await loop(dur*1000,async i=>{await flag(S,true);await gesture(S,{x:S.cfg.w/2,y:S.cfg.h/2,yDistance:(i%2?1:-1)*H,speed:15000,gestureSourceType:S.cfg.mobile?'touch':'mouse'});await flag(S,false);await sleep(120);});}},
  {name:'scroll-keys-hold',cfgs:['d1'],quick:true,run:async(S,dur)=>{await loop(dur*1000,async i=>{const key=i%2?'ArrowUp':'ArrowDown';await A.keyDown(S,key);for(let j=0;j<4;j++){await A.keyDown(S,key);await S.page.mouse.move(20+j*40,80+i%4*50);await sleep(33);}await A.keyUp(S,key);});}},
  {name:'scrollbar-drag',cfgs:['d1'],run:async(S,dur)=>{const x=S.cfg.w-3;await S.page.mouse.move(x,40);await S.page.mouse.down();await loop(dur*1000,async i=>{await S.page.mouse.move(x,40+Math.abs(Math.sin(i/9))*(S.cfg.h-80));await sleep(8);});await S.page.mouse.up();},note:'headless Chrome hides scrollbars, so this drag may not scroll; frame numbers still apply'},
  {name:'nav-anchor-spam',cfgs:['d1','d2','m'],quick:true,run:async(S,dur)=>{await loop(dur*1000,async i=>{await A.nav(S,Math.floor(S.rng()*6));await sleep(60+S.rng()*190);});}},
  {name:'instant-jumps',cfgs:['d1','m'],quick:true,run:async(S,dur)=>{const bad=[];await loop(dur*1000,async()=>{const f=S.rng(),r=await A.jump(S,f);if(r.y!==r.t)bad.push(r);await sleep(30+S.rng()*40);});S.jumpMismatch=bad.length;}},
  {name:'zoom-thrash',emu:true,cfgs:['d1'],run:async(S,dur)=>{const zs=[.5,.75,1,1.25,1.5,2,3,1,.5,2,1];await loop(dur*1000,async i=>{await A.zoom(S,zs[i%zs.length]);await sleep(110);});}},
  {name:'resize-breakpoints',emu:true,cfgs:['d1'],run:async(S,dur)=>{const ws=[1365,1100,860,720,500,1100,720,1365,860,1000,700,1366];await loop(dur*1000,async i=>{await A.resize(S,ws[i%ws.length]);await sleep(130);});}},
  {name:'dpr-switch',emu:true,cfgs:['d1'],run:async(S,dur)=>{await loop(dur*1000,async i=>{await A.dpr(S,i%2?1:2);await sleep(160);});}},
  {name:'pinch-spam',cfgs:['d1','m'],run:async(S,dur)=>{await loop(dur*1000,async i=>{await A.pinch(S,i%2?.5:2.2);await sleep(60);});}},
  {name:'pointer-sweeps',cfgs:['d1','d2'],quick:true,run:async(S,dur)=>{const per=dur*1000/4;for(const sel of ['.tree button.leaf[data-item]','.net__stage, #net','#key-chips','#nav'])await sweepRegion(S,sel,per,S.rng);}},
  {name:'chip-spam',cfgs:['d1','d2','m'],quick:true,run:async(S,dur)=>{await loop(dur*1000,async()=>{await A.chip(S,Math.floor(S.rng()*7));await sleep(25+S.rng()*60);});}},
  {name:'leaf-open-close-spam',cfgs:['d1','d2','m'],quick:true,run:async(S,dur)=>{await loop(dur*1000,async i=>{await A.leaf(S,Math.floor(S.rng()*149));await sleep(30+S.rng()*260);if(S.rng()<.7)await A.esc(S);await sleep(20+S.rng()*120);});}},
  {name:'history-back-forward-spam',cfgs:['d1'],run:async(S,dur)=>{await A.leaf(S,3);await sleep(300);await loop(dur*1000,async i=>{if(i%7===0)await A.leaf(S,Math.floor(S.rng()*149));await A[i%2?'fwd':'back'](S);await sleep(40+S.rng()*90);});}},
  {name:'finder-typing-spam',cfgs:['d1','m'],run:async(S,dur)=>{await scrollTo_(S,'',"#group-find");const words=['forest','appalachia','coal','river','mountain','sierra','citizens','zzzz','a','e'];await loop(dur*1000,async()=>{await A.type(S,pick(S.rng,words));for(let i=0;i<4;i++)await S.page.keyboard.press('Backspace');await sleep(10);});}},
  {name:'tab-hold-focus-cycle',cfgs:['d1'],run:async(S,dur)=>{await loop(dur*1000,async i=>{await S.page.keyboard.press(i%97<80?'Tab':'Shift+Tab');await sleep(25);});}},
  {name:'see-everything-spam',cfgs:['d1'],run:async(S,dur)=>{await loop(dur*1000,async()=>{await scrollTo_(S,'','a.card[data-open]');const cards=await rects(S,'a.card[data-open]');if(!cards.length)throw Error('no visible same-page card opener');const c=pick(S.rng,cards);requireSent(await tapAt(S,c.x,c.y),'card opener');
      await S.page.waitForFunction(()=>!document.getElementById('dialog').hidden&&window.leafLift.state()==='open',null,{timeout:6000,polling:30});const close=await rects(S,'#dialog .dialog__more a[data-close]');if(!close.length)throw Error('no visible See everything target');requireSent(await tapAt(S,close[0].x,close[0].y),'See everything');await idleWait(S);await sleep(80+S.rng()*160);});}},
  {name:'visibility-freeze-toggle',cfgs:['d1','m'],run:async(S,dur)=>{const sweep=sweepRegion(S,'.tree button.leaf[data-item]',dur*1000,S.rng);const tog=loop(dur*1000-300,async()=>{await sleep(180+S.rng()*250);await A.freeze(S,60+S.rng()*200);});await Promise.all([sweep,tog]);}},
  {name:'reduced-motion-toggle',cfgs:['d1','m'],run:async(S,dur)=>{const sweep=sweepRegion(S,'.tree button.leaf[data-item]',dur*1000,S.rng);const tog=loop(dur*1000,async i=>{await A.rm(S,i%2===0);await sleep(120+S.rng()*180);});await Promise.all([sweep,tog]);await A.rm(S,false);}},
  // mobile extras
  {name:'m-fling-direction-flips',cfgs:['m'],quick:true,run:async(S,dur)=>{const H=await maxY(S);await loop(dur*1000,async i=>{await flag(S,true);await gesture(S,{x:S.cfg.w/2,y:S.cfg.h*(.3+S.rng()*.4),yDistance:(i%2?1:-1)*(800+S.rng()*Math.min(H,6000)),speed:3000+S.rng()*9000,gestureSourceType:'touch'});await flag(S,false);await sleep(30);});}},
  {name:'m-orientation-flips',emu:true,cfgs:['m'],run:async(S,dur)=>{await loop(dur*1000,async()=>{await A.orient(S);await sleep(250);});S.orient=1;await A.orient(S);}},
  {name:'m-tap-spam',cfgs:['m'],quick:true,run:async(S,dur)=>{await loop(dur*1000,async i=>{const k=i%3;await (k===0?A.leaf(S,Math.floor(S.rng()*149)):k===1?A.chip(S,Math.floor(S.rng()*7)):A.spore(S,Math.floor(S.rng()*106)));await sleep(40+S.rng()*160);if(S.rng()<.4)await A.esc(S);});}},
  {name:'m-long-press',cfgs:['m'],run:async(S,dur)=>{await loop(dur*1000,async()=>{const rs=await rects(S,'.tree button.leaf[data-leaf]');if(rs.length){const r=pick(S.rng,rs);await A.longPress(S,r.x,r.y);}else await A.wheel(S,300);await sleep(100);});}},
  {name:'m-net-swipe-during-scroll',cfgs:['m'],run:async(S,dur)=>{await scrollTo_(S,'',"#net, .net");await flag(S,false);await loop(dur*1000,async i=>{await Promise.all([A.swipeNet(S,i%2?-500:500),gesture(S,{x:S.cfg.w/2,y:S.cfg.h*.3,yDistance:i%3?-400:400,speed:2500,gestureSourceType:'touch'})]);await sleep(60);});}},
  {name:'m-keyboard-resize',emu:true,cfgs:['m'],run:async(S,dur)=>{await scrollTo_(S,'',"#group-find");await loop(dur*1000,async i=>{await S.page.locator('#group-find').focus().catch(()=>{});await metricsOverride(S,S.cfg.w,Math.round(S.cfg.h*.48));await sleep(180);await S.page.keyboard.type('fo',{delay:20});await metricsOverride(S);await S.page.evaluate(()=>{const f=document.getElementById('group-find');f.value='';f.dispatchEvent(new Event('input',{bubbles:true}));});await sleep(150);});}},
  {name:'m-background-foreground',cfgs:['m'],run:async(S,dur)=>{await loop(dur*1000,async()=>{await A.wheel(S,500);await A.freeze(S,120+S.rng()*300);await sleep(100);});}},
];
function coverageFor(s){
  if(s.coverage)return s.coverage();if(s.name==='idle-floor')return {};
  if(s.name==='pointer-sweeps')return {native:{pointermove:20},regions:{tree:2,net:2,key:2,nav:2},uniqueLeaves:3};
  if(/scroll|fling|background-foreground/.test(s.name))return {responses:{scrollChanges:1}};
  if(s.name==='nav-anchor-spam')return {native:{click:1},responses:{navRequests:1}};
  if(s.name==='chip-spam')return {native:{click:1},sent:{chip:1}};
  if(/leaf-open|see-everything/.test(s.name))return {native:{'leaf:pick':1}};
  if(/finder|keyboard-resize/.test(s.name))return {native:{input:1},responses:{finderInputs:1}};
  if(/zoom|resize|dpr|pinch|orientation/.test(s.name))return {responses:{metricsChanged:1}};
  if(/pointer|focus-cycle|long-press/.test(s.name))return {native:{[s.name.includes('focus')?'keydown':s.name.includes('long')?'pointerdown':'pointermove']:1}};
  if(s.name==='m-tap-spam')return {native:{pointerdown:1}};
  // Some lifecycle/history cases have additional dedicated checks. This lower
  // bound is explicit and does not claim every possible feature was exercised.
  return {minimumActivity:1};
}
function checkActivity(s,frame){const requirements=coverageFor(s),activity=frame.activity;
  if(requirements.minimumActivity){const total=Object.values(activity.sent||{}).reduce((a,b)=>a+b,0)+Object.values(activity.native||{}).reduce((a,b)=>a+b,0);requirements.responses={minimumActivity:1};activity.responses.minimumActivity=total;delete requirements.minimumActivity;}
  return analyzeActivityCoverage(activity,requirements);
}
// ---- leak probes: N cycles, GC, then DOM nodes / listeners / layers / animations / heap deltas against the budget ----
async function counters(S){await S.cdp.send('HeapProfiler.collectGarbage');await S.cdp.send('HeapProfiler.collectGarbage');await sleep(300);const c=await S.cdp.send('Memory.getDOMCounters'),h=await S.cdp.send('Runtime.getHeapUsage'),anim=await S.page.evaluate(()=>document.getAnimations().length),lm=await layerMap(S);const measured={nodes:c.nodes,listeners:c.jsEventListeners,documents:c.documents,heapKB:Math.round(h.usedSize/1024),layers:lm.count,animations:anim},validation=validateLeakCounters(measured);if(!validation.valid)throw Error('UNSUPPORTED leak counters: '+validation.issues.join('; '));const hist=await S.page.evaluate(()=>{const h={};for(const e of document.querySelectorAll('*')){const k=e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+[...e.classList].filter(c=>!/^hw-s-/.test(c)).slice(0,3).map(c=>'.'+c).join('');h[k]=(h[k]||0)+1;}return h;});return {...measured,hist};}
const idleWait=S=>S.page.waitForFunction(()=>!window.leafLift.busy(),null,{timeout:9000});
const LEAKS=[
  {name:'leak-leaf-open-close',cfgs:['d1'],quick:true,cycles:quick?6:LEAK_CYCLES,cycle:async(S,i)=>{await A.jump(S,0);await sleep(80);requireSent(await A.leaf(S,[5,40,77,101][i%4]),'leak leaf');await S.page.waitForFunction(()=>!document.getElementById('dialog').hidden&&window.leafLift.state()==='open',null,{timeout:6000,polling:50});await A.esc(S);await idleWait(S);return true;}},
  {name:'leak-leaf-hover',cfgs:['d1'],quick:true,warm:150,cycles:quick?200:500,cycle:async(S,i)=>{const rs=await rects(S,'.tree button.leaf[data-item]');if(!rs.length)throw Error('no effective hover leaf');const r=rs[(i*7)%rs.length];await S.page.mouse.move(r.x,r.y);if(!await S.page.evaluate(()=>!!document.querySelector('.tree button.leaf[data-item]:hover')))throw Error('leaf hover did not reach a target');await S.page.mouse.move(2,2);return true;}},
  {name:'leak-chip-filter',cfgs:['d1'],cycles:quick?60:200,cycle:async(S,i)=>{requireSent(await A.chip(S,1+i%6),'leak filter');if((await featureState(S)).filter==='all')throw Error('filter did not activate');requireSent(await A.chip(S,0),'leak filter reset');if((await featureState(S)).filter!=='all')throw Error('filter did not reset');return true;}},
  {name:'leak-finder',cfgs:['d1'],cycles:quick?20:60,cycle:async(S,i)=>{requireSent(await A.type(S,'forest'),'leak finder');if(!(await featureState(S)).finder.endsWith('forest'))throw Error('finder input did not take effect');await A.key(S,process.platform==='darwin'?'Meta+A':'Control+A');await A.key(S,'Backspace');if((await featureState(S)).finder!=='')throw Error('finder did not clear');return true;},
    // Control: the same keystrokes into a bare <input> in the same browser. Chrome keeps one Text node per editing undo step (1000-step stack), so page leak = page - control.
    control:async(C,i)=>{await C.page.focus('#group-find');await C.page.keyboard.type('forest',{delay:15});if(await C.page.inputValue('#group-find')!=='forest')throw Error('control input did not take effect');await C.page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await C.page.keyboard.press('Backspace');if(await C.page.inputValue('#group-find')!=='')throw Error('control input did not clear');return true;}},
  {name:'leak-network-hover',cfgs:['d1'],warm:110,cycles:quick?100:300,cycle:async(S,i)=>{await scrollTo_(S,'',".net__stage, #net");const rs=await rects(S,'.spore[data-item]');if(!rs.length)throw Error('no effective network hover target');const r=rs[(i*11)%rs.length];await S.page.mouse.move(r.x,r.y);if((await featureState(S)).lit===0)throw Error('network hover did not light its thread');await S.page.mouse.move(2,2);return true;}},
];

// ---- chaos monkey: fast-check commands over every action, invariants after each command, shrinking to a minimal failing sequence ----
async function stateInvariants(S){const s=await S.page.evaluate(()=>{const dlg=document.getElementById('dialog');return {sy:scrollY,max:document.documentElement.scrollHeight-innerHeight,sx:scrollX,hidden:dlg.hidden,state:window.leafLift.state(),csp:window.__ab.csp.splice(0),err:window.__ab.err.splice(0)};});
  const v=[];if(s.sy<0||s.sy>s.max+1)v.push(`scrollY ${s.sy} outside 0..${s.max}`);if(s.sx)v.push('scrollX '+s.sx);if(!s.hidden&&s.state==='idle')v.push('dialog visible while leafLift idle');if(s.csp.length)v.push('CSP '+s.csp[0]);if(s.err.length)v.push('page error '+s.err[0]);if(S.errors.length)v.push('console/page error '+S.errors.splice(0)[0]);return v;}
const cmd=(label,fn)=>({check:()=>true,run:async(m,S)=>{const row={label,status:'attempted'};S.commandLog.push(row);try{const r=await fn(S);row.status=r===false?'skipped':'completed';const v=await stateInvariants(S);if(v.length)throw Error(`after ${label}: ${v.join('; ')}`);}catch(e){row.status='failed';row.error=e.message;throw e;}},toString:()=>label});
const chaosCommands=()=>fc.commands([
  fc.integer({min:-1500,max:1500}).map(dy=>cmd(`wheel(${dy})`,S=>A.wheel(S,dy))),
  fc.constantFrom('PageDown','PageUp','Home','End','ArrowDown','ArrowUp','Space','Escape','Tab','Shift+Tab').map(k=>cmd(`key(${k})`,S=>A.key(S,k))),
  fc.double({min:0,max:1,noNaN:true}).map(f=>cmd(`jump(${f.toFixed(3)})`,S=>A.jump(S,f))),
  fc.integer({min:0,max:5}).map(i=>cmd(`nav(${i})`,S=>A.nav(S,i))),
  fc.tuple(fc.double({min:0,max:1,noNaN:true}),fc.double({min:0,max:1,noNaN:true})).map(([x,y])=>cmd(`hover(${x.toFixed(2)},${y.toFixed(2)})`,S=>A.hover(S,x,y))),
  fc.integer({min:0,max:6}).map(i=>cmd(`chip(${i})`,S=>A.chip(S,i))),
  fc.integer({min:0,max:148}).map(i=>cmd(`leaf(${i})`,S=>A.leaf(S,i))),
  fc.integer({min:0,max:105}).map(i=>cmd(`spore(${i})`,S=>A.spore(S,i))),
  fc.constant(cmd('history.back',S=>A.back(S))),fc.constant(cmd('history.forward',S=>A.fwd(S))),
  fc.stringMatching(/^[a-z]{1,6}$/).map(t=>cmd(`type(${t})`,S=>A.type(S,t))),
  fc.integer({min:1,max:6}).map(n=>cmd(`tab x${n}`,S=>A.tab(S,n))),
  fc.constantFrom(1365,1100,860,720,500).map(w=>cmd(`resize(${w})`,S=>A.resize(S,w))),
  fc.constantFrom(.5,.8,1,1.5,2.5).map(z=>cmd(`zoom(${z})`,S=>A.zoom(S,z))),
  fc.constantFrom(1,2).map(d=>cmd(`dpr(${d})`,S=>A.dpr(S,d))),
  fc.boolean().map(b=>cmd(`reducedMotion(${b})`,S=>A.rm(S,b))),
  fc.integer({min:20,max:250}).map(ms=>cmd(`freeze(${ms}ms)`,S=>A.freeze(S,ms))),
  fc.integer({min:10,max:200}).map(ms=>cmd(`wait(${ms}ms)`,()=>sleep(ms))),
],{maxCommands:quick?20:60}).filter(cs=>[...cs].length>=3&&[...cs].some(c=>/^(wheel|key|nav|leaf|chip|hover|type|tab|resize|zoom|dpr)/.test(c.toString())));
async function chaos(F,route){const runs=Number(process.env.HW_FC_RUNS||(quick?2:10));if(!Number.isInteger(runs)||runs<1)throw Error('HW_FC_RUNS must be a positive integer');let S=null,N=0;const t0=Date.now(),sequences=[];
  try{
    const prop=fc.asyncProperty(chaosCommands(),async cmds=>{if(runtime.signal.aborted)throw runtime.signal.reason;N++;await S?.close();S=await openSession(F,CONFIGS[o.cdp?'m':'d1'],route,'chaos-attempt-'+N);
      await toRest(S);S.errors.length=0;await S.page.evaluate(()=>window.__ab.csp.splice(0));
      S.commandLog=[];S.actionLog=[];S.responses={};S.operationStats={attempted:{},sent:{},skipped:{}};S.captureActions=true;await S.page.evaluate(()=>window.__ab.begin());const sequence={attempt:N};sequences.push(sequence);
      try{await fc.asyncModelRun(()=>({model:{},real:S}),cmds);const activity=(await S.page.evaluate(()=>window.__ab.end())).activity;sequence.activity=activity;
        if(!Object.values(activity.native).some(n=>n>0)&&!S.responses?.metricsChanged)throw Error('UNSUPPORTED chaos coverage: no effective native input/viewport action');
        S.captureActions=false;const notes=await toRest(S),v=await restState(S,notes);if(v.length)throw Error('not at rest after the sequence: '+v.join('; '));sequence.status='pass';}
      catch(e){sequence.status='fail';sequence.error=e.message;sequence.probe=await S.page.evaluate(()=>window.__ab.end()).catch(()=>null);throw e;}
      finally{S.captureActions=false;sequence.commands=S.commandLog;sequence.actionLog=S.actionLog;}
    });
    const details=await fc.check(prop,{numRuns:runs,seed:fcSeed,verbose:0,interruptAfterTimeLimit:CHAOS_MS,markInterruptAsFailure:true,...(process.env.HW_FC_PATH?{path:process.env.HW_FC_PATH}:{})});
    const res={runs:details.numRuns,seed:fcSeed,interrupted:details.interrupted,failed:details.failed,seconds:r1((Date.now()-t0)/1000),coverage:'functional invariants only; at least three generated commands and an effective native input/viewport action',timingMeasured:false,sequences,provenance:S?.provenance};
    if(details.failed){res.counterexample=details.counterexample?.[0]?.toString?.()||String(details.counterexample);res.error=String(details.errorInstance?.message||details.error);res.shrinks=details.numShrinks;res.counterexamplePath=details.counterexamplePath;res.replay=`HW_FC_SEED=${fcSeed} HW_FC_RUNS=${runs} HW_FC_PATH=${details.counterexamplePath} node tools/test-abuse.mjs --only chaos --route ${route} ${quick?'--quick':'--full'}`;}
    return res;
  }finally{await S?.close();}}

// ---- run ----
const roster={scenarioNames:[...SC,...LEAKS].map(s=>s.name).concat('chaos'),configNames:Object.keys(CONFIGS),routeNames:['optimized','optimized-taste','local']};
const selection=validateAbuseSelection({...o,seconds:String(DUR)},roster),wanted=selection.only?new Set(selection.only):null,cfgFilter=selection.configs?new Set(selection.configs):o.cdp?new Set(['m']):null;
const plan=[];for(const s of [...SC,...LEAKS]){if(wanted&&!wanted.has(s.name))continue;if(o.cdp&&s.emu)continue;if(quick&&!s.quick&&!wanted)continue;for(const c of s.cfgs){if(cfgFilter&&!cfgFilter.has(c))continue;if(quick&&!cfgFilter&&c!=='d1'&&!/^m-/.test(s.name))continue;plan.push({s,c});}}
const doChaos=(!wanted||wanted.has('chaos'))&&(!cfgFilter||cfgFilter.has(o.cdp?'m':'d1'));
validateAbuseSelection({...o,seconds:String(DUR)},{...roster,planCount:plan.length,doChaos});
// Overall ceiling follows the selected work; it never pads successful runs or weakens measurement windows.
const schedule=abuseSchedule({items:plan.map(({s,c})=>({name:s.name,config:c,cycles:s.cycles??null,warm:s.warm??4,control:!!s.control})),routes,seconds:DUR,quick,chaos:doChaos,chaosMs:CHAOS_MS,deferred:!!o.deferred}),selectedCostMs=schedule.timeoutMs;
const itemBudget=new Map(schedule.stages.map(s=>[s.name+'/'+s.config,s.timeoutMs]));
if(o['plan-json']){console.log('HW_ABUSE_PLAN='+JSON.stringify({schema:1,routes,seconds:DUR,mode:quick?'quick':'full',scenarioConfigs:plan.map(({s,c})=>({name:s.name,config:c,cycles:s.cycles||null})),chaos:doChaos,chaosMs:CHAOS_MS,deferred:!!o.deferred,schedule,timeoutMs:Math.max(60000,selectedCostMs)}));process.exit(0);}
if(o.list){for(const p of plan)console.log(p.s.name.padEnd(30),p.c,p.s.cycles?'leak x'+p.s.cycles:DUR+' s');if(doChaos)console.log('chaos'.padEnd(30),'d1','fast-check commands, seed',fcSeed);process.exit(0);}
const runtime=ensureToolRuntime({name:'test-abuse',runTimeoutMs:Math.max(60000,selectedCostMs),stepTimeoutMs:30000});await runtime.ready;
await mkdir(outDir,{recursive:true});
const report={startedAt:new Date().toISOString(),loadedSourceHashes:LOADED_SOURCE_HASHES,tool:'test-abuse',mode:quick?'quick':'full',seed:SEED,chaosSeed:fcSeed,budgets:G,durationSec:DUR,routes,schedule,results:[],chaos:{},targets:[],deferred:{}};
const lost=new Map(),breachList=[];
const breach=(R,msg)=>{R.breaches.push(msg);};
function collectTargets(R){for(const w of R.frame?.attributionPass?.allMisses||R.frame?.allMisses||[]){const over=Math.max(0,w.gapMs-16.7);if(over<=0)continue;
  const detail=w.cause==='script'?(w.topFunctions[0]?.fn||'script')+' ['+Object.entries(w.scriptBySource).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+v).join(', ')+']':w.cause==='paint'?(w.paints[0]?.el||'paint'):/raster/.test(w.cause)?(w.rasterLayers[0]?w.rasterLayers[0].el+' ('+w.rasterLayers[0].tiles+' tiles'+(w.rasterLayers[1]?'; next '+w.rasterLayers[1].el:'')+')':'raster'):w.cause==='gpu'?'GPU composite (viz DrawFrame) with little raster':/style|layout/.test(w.cause)?(w.invalidations[0]?w.invalidations[0].what.trim().slice(0,70)+' on '+w.invalidations[0].el:w.cause):w.cause;
  const key=w.stream+' :: '+w.cause+' :: '+detail,t=lost.get(key)??{key,stream:w.stream,cause:w.cause,detail,count:0,streamExcessMs:0,worstMs:0,correlationIds:new Set(),where:new Set(),sample:null};t.count++;t.streamExcessMs+=over;t.correlationIds.add(w.correlationId);t.worstMs=Math.max(t.worstMs,w.gapMs);t.where.add(R.route+'/'+R.cfg+'/'+R.scenario);t.sample??=w.ms;lost.set(key,t);}}
const save=()=>writeFile(resolve(outDir,'abuse-report.json'),JSON.stringify(report,null,1));
async function runItem(F,route,s,c){const cfg=CONFIGS[c],R={load1m:r1(loadavg()[0]),route,cfg:c,cfgName:cfg.name,scenario:s.name,breaches:[],note:s.note||null};const t0=Date.now();let S;try{
        S=await openSession(F,cfg,route,s.name);
        R.provenance=S.provenance;
        if(s.cycle){   // leak probe
          if(F.cdpMode)throw Error('UNSUPPORTED existing-CDP leak acceptance: renderer/context ownership and counter scope are not isolated');
          R.cycleCoverage={warmCompleted:0,completed:0,required:s.cycles,mode:quick?'quick-limited':'full'};R.phaseCosts={};let phaseStarted=Date.now();console.log('[abuse phase] '+route+'/'+c+'/'+s.name+' warm '+(s.warm??4)+' cycles');
          for(let i=0;i<(s.warm??4);i++){if(await s.cycle(S,i)!==true)throw Error('warm cycle '+i+' did not prove its feature effect');R.cycleCoverage.warmCompleted++;if((i+1)%25===0)console.log('[abuse warm] '+s.name+' '+(i+1)+'/'+(s.warm??4));}R.phaseCosts.warmMs=Date.now()-phaseStarted;const a=await counters(S);R.cycles=s.cycles;phaseStarted=Date.now();console.log('[abuse phase] '+s.name+' measured '+s.cycles+' cycles');
          for(let i=0;i<s.cycles;i++){if(await s.cycle(S,i)!==true)throw Error('cycle '+i+' did not prove its feature effect');R.cycleCoverage.completed++;if((i+1)%Math.min(25,s.cycles)===0)console.log('[abuse measured] '+s.name+' '+(i+1)+'/'+s.cycles);}R.phaseCosts.measuredMs=Date.now()-phaseStarted;await sleep(600);const b=await counters(S);
          const {hist:ha,...a2}=a,{hist:hb,...b2}=b;let d=Object.fromEntries(Object.keys(a2).map(k=>[k,b2[k]-a2[k]]));R.leaks={before:a2,after:b2,delta:d,grew:Object.entries(hb).map(([k,v])=>[k,v-(ha[k]||0)]).filter(([,v])=>v>0).sort((x,y)=>y[1]-x[1]).slice(0,6)};
          if(s.control){   // control-relative: identical cycles on a bare <input> in a fresh context of the same browser/config; the gate judges page - control, the absolute delta stays in the report
            const cctx=await F.browser.newContext(cfg.ctx),C={page:await cctx.newPage()};try{C.cdp=manageCDPSession(await cctx.newCDPSession(C.page),runtime);await C.page.setContent('<!doctype html><input id="group-find">');
              for(let i=0;i<(s.warm??4);i++)if(await s.control(C,i)!==true)throw Error('control warm cycle '+i+' failed');const ca=await counters(C);for(let i=0;i<s.cycles;i++)if(await s.control(C,i)!==true)throw Error('control cycle '+i+' failed');await sleep(600);const cb=await counters(C);
              const cd=Object.fromEntries(Object.keys(d).map(k=>[k,cb[k]-ca[k]]));R.leaks.control={cycles:s.cycles,delta:cd};R.leaks.absoluteDelta=d;d=Object.fromEntries(Object.keys(d).map(k=>[k,d[k]-cd[k]]));R.leaks.delta=d;R.leaks.relative='page - bare <input> control';}
            finally{await cctx.close().catch(()=>{});}}
          if(d.nodes>G.leaks.domNodesDelta)breach(R,`DOM nodes grew by ${d.nodes} over ${s.cycles} cycles (budget ${G.leaks.domNodesDelta})`+(R.leaks.control?` (page - control; absolute ${R.leaks.absoluteDelta.nodes}, bare-input control ${R.leaks.control.delta.nodes})`:''));if(d.listeners>G.leaks.listenersDelta)breach(R,`JS event listeners grew by ${d.listeners} (budget ${G.leaks.listenersDelta})`);
          if(d.layers>G.leaks.layersDelta)breach(R,`compositor layers grew by ${d.layers} (budget ${G.leaks.layersDelta})`);if(d.heapKB>G.leaks.heapDeltaKB)breach(R,`heap grew by ${d.heapKB} KB after GC (budget ${G.leaks.heapDeltaKB})`);if(d.animations>0)breach(R,`animations grew by ${d.animations}`);
          if(d.documents>G.leaks.documentsDelta)breach(R,`documents grew by ${d.documents} (budget ${G.leaks.documentsDelta})`);
        }else{
          R.frame=await measure(S,()=>s.run(S,DUR));const f=R.frame;
          R.activityCoverage=checkActivity(s,f);for(const v of R.activityCoverage.failures)breach(R,'UNSUPPORTED clean activity: '+v);
          for(const v of await restState(S,await toRest(S)))breach(R,'rest: '+v);
          if(S.jumpMismatch)breach(R,`${S.jumpMismatch} instant jump(s) did not land synchronously on the requested offset`);
          await S.close();S=null;   // The global Viz trace must not include the still-running clean context.
          let validation=null,S2;
          try{if(F.cdpMode)throw Error('UNSUPPORTED existing-CDP compositor/input acceptance: default-context global trace ownership is not isolated');const validationStart=Date.now();S2=await openSession(F,cfg,route,s.name);if(S2.provenance.htmlSha256!==R.provenance.htmlSha256||S2.provenance.manifestSha256!==R.provenance.manifestSha256)throw Error('site generation changed between clean and instrumented runs');validation=await measure(S2,()=>s.run(S2,DUR),{trace:true});R.frame=attachAttribution(f,validation);
            R.validationActivityCoverage=checkActivity(s,validation);for(const v of R.validationActivityCoverage.failures)breach(R,'UNSUPPORTED traced activity: '+v);
            R.frame.validationCost={seconds:r1((Date.now()-validationStart)/1000),cleanActionMs:f.measurement.actionMs,tracedActionMs:validation.measurement.actionMs,note:'Trace overhead and action-count differences are recorded; traced submission health gates its own stream, not the earlier clean run.'};
            for(const v of await restState(S2,await toRest(S2)))breach(R,'validation rest: '+v);
            if(validation.pageErrors.length)breach(R,'validation page errors: '+validation.pageErrors.join('; '));if(validation.csp.length)breach(R,'validation CSP violations: '+validation.csp.join('; '));
          }catch(e){R.frame.validationError=e.message;R.validationFailure={tracePath:e.tracePath||null,provenance:S2?.provenance,actionLog:S2?.actionLog,probe:await S2?.page.evaluate(()=>window.__ab.end()).catch(()=>null)};}finally{await S2?.close();}
          R.acceptance=evaluateAcceptance({raf:f.raf,compositor:validation?.compositor,input:validation?.inputTrace,navigation:f.navigation},G);
          for(const message of R.acceptance.breaches)breach(R,message);for(const message of R.acceptance.unsupported)breach(R,'UNSUPPORTED: '+message);
          if(f.scrollStall&&f.scrollStall.ratio>G.scrollStallMaxRatio)breach(R,`scroll position stalled on ${f.scrollStall.stalled}/${f.scrollStall.activeFrames} frames during a fling (budget ${G.scrollStallMaxRatio*100}%)`);
          if(f.resumeFrameMs&&f.resumeFrameMs.max>G.resumeFrameMaxMs)breach(R,`first frame after resume took ${f.resumeFrameMs.max} ms (budget <= ${G.resumeFrameMaxMs})`);
          if(f.pageErrors.length)breach(R,'page errors: '+f.pageErrors.slice(0,2).join('; '));if(f.csp.length)breach(R,'CSP violations: '+f.csp.slice(0,2).join('; '));
          collectTargets(R);
        }
        if(S)for(const v of await restState(S,await toRest(S)))breach(R,'rest: '+v);
      }catch(e){R.failureEvidence={tracePath:e.tracePath||null,provenance:S?.provenance,actionLog:S?.actionLog,probe:await S?.page.evaluate(()=>window.__ab.end()).catch(()=>null)};breach(R,'scenario crashed: '+(e.stack||e.message).split('\n').slice(0,3).join(' | '));}
      finally{await S?.close();}
      R.seconds=r1((Date.now()-t0)/1000);report.results.push(R);await save();
      const f=R.frame,l=R.leaks;console.log(`${R.breaches.length?'FAIL':'ok  '} ${route.padEnd(15)} ${c.padEnd(3)} ${s.name.padEnd(28)} ${f?`rAF samples ${f.frames} p95 ${f.p95Ms} max ${f.maxMs} misses ${f.misses} | traced compositor max ${f.attributionPass?.compositor?.maxMs??'unavailable'} | traced completed-input p95 ${f.attributionPass?.inputTrace?.p95UpperBoundMs??'unknown'} (${f.attributionPass?.inputTrace?.coverage??'unavailable'})`:l?`leaks nodes ${l.delta.nodes} listeners ${l.delta.listeners} layers ${l.delta.layers} heap ${l.delta.heapKB} KB anim ${l.delta.animations} (${R.cycles} cycles)${l.control?` [page - bare-input control; absolute nodes ${l.absoluteDelta.nodes} heap ${l.absoluteDelta.heapKB} KB, control nodes ${l.control.delta.nodes} heap ${l.control.delta.heapKB} KB]`:''}`:'crashed'}  [${R.seconds}s]`);
      for(const b of R.breaches)console.log('       - '+b);
      for(const w of (f?.worst||[]).slice(0,R.breaches.length?3:1))if(w.gapMs>25)console.log(`       miss @${w.atMs} ms gap ${w.gapMs} (${w.kind}) cause=${w.cause} ms=${JSON.stringify(w.ms)}${w.topFunctions[0]?' fn='+w.topFunctions[0].fn+' '+w.topFunctions[0].ms+'ms '+JSON.stringify(w.scriptBySource):''}${w.paints[0]?' paint='+w.paints[0].el+' '+w.paints[0].ms.toFixed(1)+'ms':''}${w.rasterLayers[0]?' raster='+w.rasterLayers[0].el+' '+w.rasterLayers[0].ms+'ms/'+w.rasterLayers[0].tiles+' tiles':''}${w.invalidations[0]?' inval='+w.invalidations[0].what.trim().slice(0,60)+' on '+w.invalidations[0].el:''}`);
}
async function closeFixture(F,R){try{await F.close();}catch(e){console.error(e.message);process.exitCode=1;if(R){R.breaches.push('fixture cleanup: '+e.message.split('\n').slice(0,3).join(' | '));}else report.guard=(report.guard||'')+e.message;}}
async function runRoute(route){
  const todo=[...plan];
  while(todo.length){if(runtime.signal.aborted)throw runtime.signal.reason;runtime.step('abuse '+route+' '+todo[0].s.name,'scenario completion');const {s,c}=todo.shift(),F=await openFixture();try{if(!report.gpu&&!F.cdpMode)try{const g=await (await F.browser.newBrowserCDPSession()).send('SystemInfo.getInfo');report.gpu??={devices:g.gpu.devices?.map(d=>d.deviceString),glRenderer:g.gpu.auxAttributes?.glRenderer,features:g.gpu.featureStatus};console.log('gpu:',JSON.stringify(report.gpu));}catch{}await runtime.deadline('abuse '+route+'/'+c+'/'+s.name,()=>runItem(F,route,s,c),{timeoutMs:itemBudget.get(s.name+'/'+c)});}finally{await closeFixture(F,report.results.at(-1)?.scenario===s.name&&report.results.at(-1)?.cfg===c?report.results.at(-1):null);await save();}}
  if(doChaos){runtime.step('chaos '+route,'generated sequence completion');const F=await openFixture();try{
    if(doChaos){console.log(`[chaos] ${route}: fast-check commands, seed ${fcSeed}`);const C=await chaos(F,route).catch(e=>({failed:true,error:'chaos crashed: '+(e.stack||e.message).split('\n').slice(0,3).join(' | ')}));report.chaos[route]=C;
      console.log(C.failed?`FAIL chaos ${route}: minimal failing sequence: ${C.counterexample||'(n/a)'}\n       ${C.error}\n       replay: ${C.replay||'HW_FC_SEED='+fcSeed}`:`ok   chaos ${route}: ${C.runs} sequences, all invariants held (seed ${fcSeed})`);}
  }finally{await closeFixture(F,null);await save();}}}


console.log(`test-abuse ${quick?'QUICK (limited coverage)':'FULL'} seed ${SEED} chaos seed ${fcSeed} window ${DUR}s routes ${routes.join(',')} gates: rAF heartbeat + separate traced compositor submission p95 < ${G.frameP95Ms} ms, max <= ${G.frameMaxMs} ms; Event Timing next-paint population p95 bound <= ${G.inputToPaintP95Ms} ms; physical display unmeasured; leak cycles ${LEAK_CYCLES}`);
for(const r of routes)await runRoute(r);
if(o.deferred)for(const r of routes){const x=await runtime.runCommand(process.execPath,['tools/test-deferred-work.mjs'],{label:'deferred '+r,timeoutMs:180000,cwd:root,stdio:'inherit',env:{...process.env,HW_ROUTE:r,HW_OUT:resolve(outDir,'deferred-'+r)}});const cleanupProblems=commandCleanupProblems(x);report.deferred[r]=x.status===0&&!cleanupProblems.length?'pass':'FAIL';if(x.status!==0||cleanupProblems.length){report.deferredCleanupProblems??={};report.deferredCleanupProblems[r]=cleanupProblems;process.exitCode=1;}}

// ---- summary ----
report.targets=[...lost.values()].sort((a,b)=>b.streamExcessMs-a.streamExcessMs).slice(0,20).map(t=>({rank:0,...t,streamExcessMs:r1(t.streamExcessMs),correlationIds:[...t.correlationIds],costMeaning:"Per-stream interval excess, not unique physical time lost; overlapping streams remain separate",where:[...t.where].slice(0,6)})).map((t,i)=>({...t,rank:i+1}));
const gating=report.results.filter(r=>r.route!=='local'),bad=gating.filter(r=>r.breaches.length),chaosBad=Object.entries(report.chaos).filter(([r,c])=>c.failed&&r!=='local');
console.log('\n=== per-scenario table ===');console.log('route'.padEnd(15)+'cfg'.padEnd(5)+'scenario'.padEnd(30)+'frames'.padEnd(8)+'p95'.padEnd(7)+'max'.padEnd(8)+'misses'.padEnd(8)+'>50'.padEnd(5)+'inputP95'.padEnd(10)+'leaks(n/l/L/KB)'.padEnd(18)+'status');
for(const r of report.results){const f=r.frame,l=r.leaks?.delta;console.log(r.route.padEnd(15)+r.cfg.padEnd(5)+r.scenario.padEnd(30)+String(f?.frames??'-').padEnd(8)+String(f?.p95Ms??'-').padEnd(7)+String(f?.maxMs??'-').padEnd(8)+String(f?.misses??'-').padEnd(8)+String(f?.missesOver50??'-').padEnd(5)+String(f?.attributionPass?.inputTrace?.p95Ms??'-').padEnd(10)+(l?`${l.nodes}/${l.listeners}/${l.layers}/${l.heapKB}`:'-').padEnd(18)+(r.breaches.length?'FAIL':'ok'));}
console.log('\n=== ranked optimization targets (by per-stream interval excess beyond 16.7 ms; overlapping streams are not additive physical loss) ===');
if(!report.targets.length)console.log('(no missed frames above 25 ms)');for(const t of report.targets)console.log(`${String(t.rank).padStart(2)}. ${String(t.streamExcessMs).padStart(7)} ms stream excess  x${String(t.count).padStart(3)} worst ${t.worstMs} ms  ${t.cause} :: ${t.detail}\n      in ${t.where.join(', ')}  main ms ${JSON.stringify(t.sample)}`);
console.log('\n=== breaches ===');for(const r of bad)for(const b of r.breaches)console.log(`${r.route} ${r.cfg} ${r.scenario}: ${b}`);for(const [r,c] of chaosBad)console.log(`${r} chaos: ${c.error} | minimal sequence: ${c.counterexample} | replay ${c.replay}`);
if(!bad.length&&!chaosBad.length)console.log('none');
report.sourceDrift=Object.entries(sourceHashes()).filter(([p,h])=>LOADED_SOURCE_HASHES[p]!==h);if(report.sourceDrift.length){report.provenanceInvalid=true;process.exitCode=1;}report.finishedAt=new Date().toISOString();
await writeFile(resolve(outDir,'abuse-report.json'),JSON.stringify(report,null,1));if(o.json){await mkdir(resolve(o.json,'..'),{recursive:true});await writeFile(resolve(o.json),JSON.stringify(report,null,1));}
console.log(`\nreport: ${resolve(outDir,'abuse-report.json')}`);
const timed=gating.some(r=>r.frame);
console.log(bad.length||chaosBad.length||process.exitCode?`\nFAILED OR UNSUPPORTED: ${bad.length} scenario(s)${chaosBad.length?', chaos monkey found a failing sequence':''}`:timed?'\nselected heartbeat/compositor-submission/navigation/discrete render-completion budgets held; physical display and continuous input latency unmeasured'+(quick?' (quick is limited coverage)':''):'\nselected functional/leak checks held; frame/input/compositor budgets were NOT measured');
process.exitCode=bad.length||chaosBad.length||process.exitCode?1:0;await runtime.shutdown('completed');
