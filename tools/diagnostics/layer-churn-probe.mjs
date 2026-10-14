// Layer churn around one interaction: compositor layer count over time (every LayerTree update), what the layers that appear
// only transiently are and why they are composited (sampled ~150 ms after the trigger), and main-thread totals. Independent Chrome session;
// optional bounded serialization is available through browser-lock.sh. Not an acceptance gate.
//   node tools/diagnostics/layer-churn-probe.mjs [--route optimized] [--width 1365 --height 768 --dpr 1 | --device "Pixel 7" --cpu 4] [--trigger chip|nav|hop|leaf|idle] [--css '<rules>'] [--ms 900]
//   chip: click the "Get involved" key chip (filters the crown), then "All leaves"; nav: hover the first header nav link with data-kind (lights the crown);
//   hop: hover circle to circle in the Network (8 hops); leaf: open a leaf, Escape; idle: no input for --ms;
//   navsweep: sweep the header nav links back and forth for --ms (prints the number of crown is-filtered flips to stderr).
//   HW_SITE_ROOT picks the site. --ms is an integer1..10000 (default900), never an unlimited dwell.
//   --css injects rules for focused ablations (measures what a rule changes; it is not a fix).
import {browserFixture,browserToolCLI,finishCDPTrace} from '../browser-test-lib.mjs';
import {devices} from '../browser-deps.mjs';
// --trace adds raster attribution: tiles per cc layer (renderer RasterTask tileData) and GPU-process raster/task time over the window,
// the main-thread tasks over 30 ms with what they contain, and presented-frame gaps (viz DrawFrame).
// --device "Pixel 7" [--cpu 4] emulates a phone (taps instead of clicks).
const o=browserToolCLI({trace:{type:'boolean'},route:{type:'string',default:'optimized'},width:{type:'string',default:'1365'},height:{type:'string',default:'768'},dpr:{type:'string',default:'1'},trigger:{type:'string',default:'chip'},css:{type:'string'},ms:{type:'string',default:'900'},device:{type:'string'},cpu:{type:'string',default:'1'},at:{type:'string'}});   // --at '<selector>': scroll it into view before the trigger (e.g. idle at the Network)
// Validate consumed configuration before opening a preview, registry or browser.
const numeric=(key,min,max,integer=false)=>{const raw=o[key],n=Number(raw);if(typeof raw!=='string'||!raw.trim()||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error('--'+key+' must be '+(integer?'an integer':'finite')+' in '+min+'..'+max);return n;};
numeric('ms',1,10000,true);numeric('width',240,4096,true);numeric('height',240,4096,true);numeric('dpr',.25,4);numeric('cpu',1,20);
if(!['chip','nav','hop','leaf','idle','navsweep'].includes(o.trigger))throw Error('Unknown --trigger '+o.trigger);
if(o.device!==undefined&&!devices[o.device])throw Error('Unknown --device '+o.device);
if(typeof o.route!=='string'||o.route.length>128||!o.route.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)&&p!=='.'&&p!=='..'))throw Error('--route must name a local site route');
if(o.at!==undefined&&!o.at.trim())throw Error('--at must be a nonempty selector');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Two bounded diagnostic windows plus setup/trace shutdown fit within two minutes.
const fx=await browserFixture({runTimeoutMs:120000});
try{
  const dev=o.device?devices[o.device]:null;if(o.device&&!dev)throw Error('unknown --device '+o.device);
  const ctx=await fx.browser.newContext({...(dev||{viewport:{width:+o.width,height:+o.height},deviceScaleFactor:+o.dpr}),bypassCSP:!!o.css}),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
  if(+o.cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:+o.cpu});
  const press=loc=>dev?.hasTouch?loc.tap():loc.click();
  await page.goto(`${fx.base}/${o.route}/`,{waitUntil:'load'});await page.waitForFunction(()=>window.leafLift,null,{timeout:15000});
  if(o.css)await page.addStyleTag({content:o.css});
  await sleep(3500);
  if(o.at){await page.locator(o.at).first().scrollIntoViewIfNeeded();await sleep(1500);}
  const series=[],seen=new Map();let t0=Date.now(),latest=[];
  cdp.on('LayerTree.layerTreeDidChange',e=>{if(!e.layers)return;latest=e.layers;const t=Date.now()-t0;series.push([t,e.layers.length]);for(const l of e.layers){const s=seen.get(l.layerId)??{first:t,node:l.backendNodeId,w:l.width,h:l.height};seen.set(l.layerId,s);}});
  if(o.trace)await cdp.send('Tracing.start',{categories:'cc,disabled-by-default-cc.debug,gpu,viz,toplevel,disabled-by-default-devtools.timeline,devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,blink.user_timing',transferMode:'ReturnAsStream'});
  await cdp.send('LayerTree.enable');await cdp.send('Performance.enable');await cdp.send('DOM.getDocument',{depth:0});await sleep(600);
  const before=latest.length,base=new Set(seen.keys());
  const label=async id=>{const n=(await cdp.send('DOM.describeNode',{backendNodeId:id}).catch(()=>null))?.node;if(!n)return '(gone)';const at=n.attributes||[],g=k=>{const i=at.findIndex((x,j)=>j%2===0&&x===k);return i<0?'':at[i+1];};return n.nodeName.toLowerCase()+(g('id')?'#'+g('id'):'')+g('class').split(/\s+/).filter(c=>c&&!/^hw-s-/.test(c)).map(c=>'.'+c).join('');};
  const live={reasons:{},nodes:{}};let sampled=null;
  const sampleLive=async()=>{for(const l of latest.filter(l=>!base.has(l.layerId)).slice(0,300)){
    const r=(await cdp.send('LayerTree.compositingReasons',{layerId:l.layerId}).catch(()=>null))?.compositingReasonIds;const k=r?.join('+')||'(unavailable)';live.reasons[k]=(live.reasons[k]||0)+1;
    const n=l.backendNodeId?await label(l.backendNodeId):'(no node)';live.nodes[n]=(live.nodes[n]||0)+1;}};
  const go=async()=>{await page.evaluate(()=>performance.mark('probe-go'));t0=Date.now();if(!sampled)sampled=sleep(150).then(sampleLive).catch(e=>{live.error=e.message;});};
  const m0=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  if(o.trigger==='chip'){await page.locator('#key-chips').scrollIntoViewIfNeeded();await sleep(300);await go();await press(page.locator('#key-chips .chip').nth(1));await sleep(+o.ms);await press(page.locator('#key-chips .chip').nth(0));}
  else if(o.trigger==='nav'){const b=await page.locator('.nav a[data-kind]').first().boundingBox();await go();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await sleep(+o.ms);await page.mouse.move(2,2);}
  else if(o.trigger==='hop'){await page.locator('#net').scrollIntoViewIfNeeded();await sleep(1500);const pts=await page.evaluate(()=>[...document.querySelectorAll('.spore[data-item]')].map(e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];}).filter(([,y])=>y>0&&y<innerHeight));await go();for(let i=0,h=0;i<8;i++){h=(h*7+13)%pts.length;await page.mouse.move(...pts[h]);await sleep(120);}await page.mouse.move(2,2);}
  else if(o.trigger==='idle'){await go();await sleep(+o.ms);}
  else if(o.trigger==='navsweep'){   // sweep the header nav back and forth for --ms (4 ms steps, like test-abuse pointer-sweeps); counts crown is-filtered flips
    const bs=await page.evaluate(()=>[...document.querySelectorAll('.nav a[data-kind]')].map(a=>{const r=a.getBoundingClientRect();return [r.left,r.right,r.top+r.height/2];}));const l=Math.min(...bs.map(b=>b[0]))-20,r=Math.max(...bs.map(b=>b[1]))+20,y=bs[0][2];
    await page.evaluate(()=>{window.__flips=0;new MutationObserver(m=>{for(const x of m)if(x.oldValue?.includes('is-filtered')!==x.target.classList.contains('is-filtered'))window.__flips++;}).observe(document.querySelector('.tree'),{attributes:true,attributeFilter:['class'],attributeOldValue:true});});
    await go();const t0=Date.now();while(Date.now()-t0<+o.ms){const t=(Date.now()-t0)/1000;await page.mouse.move(l+(r-l)*(.5+.5*Math.sin(t*Math.PI*7)),y);await sleep(4);}await page.mouse.move(2,2);
    console.error('crown is-filtered flips during sweep: '+await page.evaluate(()=>window.__flips));}
  else if(o.trigger==='leaf'){await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await sleep(300);const leaf=page.locator('.tree button.leaf[data-item]').nth(20);const b=await leaf.boundingBox();await go();
    if(dev?.hasTouch)await page.touchscreen.tap(b.x+b.width/2,b.y+b.height*.6);else await leaf.click();await sleep(1900+(+o.cpu>1?1500:0));await page.keyboard.press('Escape');}
  else throw Error('unknown --trigger '+o.trigger);
  await sleep(+o.ms+300);await sampled;
  const m1=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  let raster=null;
  if(o.trace){
    // Renderer RasterTask tileData names the cc layer of every rastered tile; GPU-process raster (RendererRasterWorker / GPUTask) is the actual pixel work.
    const ev=JSON.parse(await finishCDPTrace(cdp)).traceEvents;const th={};for(const e of ev)if(e.ph==='M'&&e.name==='thread_name')th[e.pid+':'+e.tid]=e.args.name;
    const byLayer={};let gpuRasterMs=0,gpuTaskMs=0,gpuMax=0,drawMs=0;
    for(const e of ev){const t=th[e.pid+':'+e.tid];
      if(e.name==='RasterTask'&&e.args?.tileData){const id=e.args.tileData.layerId,r=byLayer[id]??={tiles:0,ms:0};r.tiles++;r.ms+=(e.dur||0)/1000;}
      else if(t==='CrGpuMain'&&e.name==='RendererRasterWorker'&&e.dur){gpuRasterMs+=e.dur/1000;}
      else if(t==='CrGpuMain'&&e.name==='GPUTask'&&e.dur){gpuTaskMs+=e.dur/1000;gpuMax=Math.max(gpuMax,e.dur/1000);}
      else if(e.name==='DirectRenderer::DrawFrame'&&e.dur)drawMs+=e.dur/1000;}
    // What the longest GPU-main tasks contain (nested slices over 1 ms), to name the expensive raster work.
    const gpuMain=ev.filter(e=>th[e.pid+':'+e.tid]==='CrGpuMain'&&e.ph==='X'&&e.dur).sort((a,b)=>a.ts-b.ts);
    const longTasks=gpuMain.filter(e=>e.name==='GPUTask'&&e.dur>20000).sort((a,b)=>b.dur-a.dur).slice(0,4).map(t=>({ms:Math.round(t.dur/100)/10,inside:Object.entries(gpuMain.filter(e=>e!==t&&e.ts>=t.ts&&e.ts+e.dur<=t.ts+t.dur&&e.dur>1000).reduce((m,e)=>{const k=e.name+(e.args?.data?.layer_id!=null?' layer '+e.args.data.layer_id:'');m[k]=(m[k]||0)+e.dur/1000;return m;},{})).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+' '+Math.round(v*10)/10)}));
    // Main-thread tasks over 30 ms: what is inside (style with element counts, layout, paint, prepaint, layerize, commit, script by source line).
    const rpid=ev.find(e=>e.name==='TracingStartedInBrowser')?.args?.data?.frames?.[0]?.processId;
    const goTs=ev.find(e=>e.name==='probe-go')?.ts??0;   // only what follows the trigger (scrolling to the target is setup, not the interaction)
    const main=ev.filter(e=>e.ts>=goTs&&th[e.pid+':'+e.tid]==='CrRendererMain'&&(!rpid||e.pid===rpid)&&e.ph==='X'&&e.dur).sort((a,b)=>a.ts-b.ts);
    const longMain=main.filter(e=>e.name==='ThreadControllerImpl::RunTask'&&e.dur>30000).sort((a,b)=>b.dur-a.dur).slice(0,6).map(t=>{const inside=main.filter(e=>e!==t&&e.ts>=t.ts&&e.ts+e.dur<=t.ts+t.dur),sum={};let elements=0;
      for(const e of inside){const k=e.name==='FunctionCall'?'script '+String(e.args?.data?.url||'').split('/').pop()+':'+e.args?.data?.lineNumber:{UpdateLayoutTree:'style',Layout:'layout',Paint:'paint',PrePaint:'prepaint',Layerize:'layerize',Commit:'commit',HitTest:'hittest'}[e.name];if(!k)continue;sum[k]=(sum[k]||0)+e.dur/1000;if(e.name==='UpdateLayoutTree')elements+=e.args?.elementCount||0;}
      const paints=inside.filter(e=>e.name==='Paint'&&e.args?.data?.nodeId).sort((a,b)=>b.dur-a.dur).slice(0,3).map(e=>({nodeId:e.args.data.nodeId,ms:Math.round(e.dur/100)/10,clip:e.args.data.clip?.length>=6?Math.round(Math.abs((e.args.data.clip[2]-e.args.data.clip[0])))+'x'+Math.round(Math.abs(e.args.data.clip[5]-e.args.data.clip[1])):null}));
      const inval={};for(const e of ev)if(/InvalidationTracking$/.test(e.name)&&e.ts>=t.ts-100000&&e.ts<=t.ts+t.dur){const d=e.args?.data||{};const k=e.name.replace('InvalidationTracking','')+': '+(d.reason||d.changedClass||d.changedAttribute||d.invalidatedSelectorId||'')+' @'+(d.nodeName||'');inval[k]=(inval[k]||0)+1;}
      return {invalidations:Object.entries(inval).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>k.slice(0,110)+' x'+v),ms:Math.round(t.dur/100)/10,atMs:Math.round((t.ts-main[0].ts)/1000),styleElements:elements,paints,inside:Object.entries(sum).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+' '+Math.round(v*10)/10)};});
    const draws=ev.filter(e=>e.name==='DirectRenderer::DrawFrame'&&e.ph==='X'&&e.ts>=goTs).map(e=>e.ts/1000).sort((a,b)=>a-b),gaps=draws.slice(1).map((t,i)=>t-draws[i]).sort((a,b)=>b-a);
    for(const t of longMain)for(const p of t.paints)p.el=await label(p.nodeId);
    const frameGaps={frames:draws.length,over25:gaps.filter(g=>g>25).length,over50:gaps.filter(g=>g>50).length,worst:gaps.slice(0,5).map(g=>Math.round(g*10)/10)};
    const rows=await Promise.all(Object.entries(byLayer).map(async([id,r])=>{const s=seen.get(+id)||seen.get(id);return {layer:id,label:s?.node?await label(s.node):'(unknown)',size:s?s.w+'x'+s.h:null,tiles:r.tiles,rendererMs:Math.round(r.ms*10)/10};}));
    const groups={};for(const r of rows){const g=groups[r.label]??={layers:0,tiles:0};g.layers++;g.tiles+=r.tiles;}
    raster={frameGaps,longMainTasks:longMain,longGpuTasks:longTasks,gpuRasterMs:Math.round(gpuRasterMs),gpuTaskMs:Math.round(gpuTaskMs),gpuTaskMaxMs:Math.round(gpuMax),drawMs:Math.round(drawMs),layersRastered:rows.length,tiles:rows.reduce((s,r)=>s+r.tiles,0),
      topLayers:rows.sort((a,b)=>b.tiles-a.tiles).slice(0,12),byLabel:Object.entries(groups).sort((a,b)=>b[1].tiles-a[1].tiles).slice(0,12)};
  }
  const d=k=>Math.round(((m1[k]||0)-(m0[k]||0))*1000*10)/10,after=series.filter(([t])=>t>=0);
  if(!after.length||!latest.length){console.error('UNSUPPORTED: no LayerTree feed arrived; no layer-churn measurement was completed (see docs/TESTING.md)');process.exitCode=64;}else console.log(JSON.stringify({route:o.route,trigger:o.trigger,css:o.css||null,viewport:`${o.width}x${o.height}@${o.dpr}`,layersBefore:before,layersPeak:Math.max(before,...after.map(([,n])=>n)),layersAfter:latest.length,
    transientLayers:[...seen.keys()].filter(id=>!base.has(id)).length,layerTreeUpdates:after.length,liveTransient:live,raster,
    mainMs:{style:d('RecalcStyleDuration'),layout:d('LayoutDuration'),script:d('ScriptDuration'),task:d('TaskDuration')},series:after.filter((x,i,a)=>i===0||x[1]!==a[i-1][1])}));
  await ctx.close();
}finally{await fx.close();}
