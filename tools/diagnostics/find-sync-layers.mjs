// Dev-only, never shipped or packaged: run after adding animation. Finds lockstep animations, siblings one wrapper could
// drive, and compositor cost (main-thread animations, mask layers, render surfaces, overlap layers). Reports only; never rewrites CSS.
//   node tools/diagnostics/find-sync-layers.mjs [--route local|optimized|a,b] [--compare] [--json out.json] [--width 1424] [--dpr 2] [--strict]
// --compare = --route local,optimized plus a delta table. --strict exits 1 if an animation needs the main thread or the page ticks style recalcs while idle.
// Serves site/ (HW_SITE_ROOT overrides); HW_SECONDS = true-idle trace window (default 6). --compare cannot be combined with --route.
// JSON-only: rows[].layerReason (advisory Active*Animation reason on the target's layer; paint-less wrappers do not show it). The report is written even if a route fails.
import {browserFixture,finishCDPTrace,browserToolCLI} from '../browser-test-lib.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

const o=browserToolCLI({route:{type:'string'},compare:{type:'boolean'},json:{type:'string'},width:{type:'string',default:'1424'},dpr:{type:'string',default:'2'},strict:{type:'boolean'}});
if(o.compare&&o.route)throw Error('--compare already picks local,optimized; drop --route');
const routes=o.compare?['local','optimized']:(o.route||'local').split(','),seconds=Number(process.env.HW_SECONDS||6),viewport={width:Number(o.width),height:820};
for(const [k,v] of Object.entries({HW_SECONDS:seconds,'--width':Number(o.width),'--dpr':Number(o.dpr)}))if(!Number.isFinite(v)||!(v>0))throw Error(`${k} must be a positive number`);
// Properties Chrome can animate on the compositor (it can still refuse pixel-moving filters). A property outside this set is main-thread for certain.
const CC={transform:'Transform',translate:'Translate',rotate:'Rotate',scale:'Scale',opacity:'Opacity',filter:'Filter',backdropFilter:'BackdropFilter'};
const THREADS=['CrRendererMain','Compositor','VizCompositorThread','CrGpuMain'];
const count=(list,key)=>Object.values(Object.groupBy(list,key)).map(b=>({...b[0],n:b.length})).sort((a,b)=>b.n-a.n);

// Runs in the page: one synchronous pass, so every currentTime is read at the same instant. Read-only until __fslTag().
function inventory(){
 const lab=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+[...e.classList].filter(c=>!/^hw-s-/.test(c)).map(c=>'.'+c).join('');
 const fx=e=>{const s=getComputedStyle(e);return [s.filter!=='none'&&'filter',s.clipPath!=='none'&&'clip-path',(s.maskImage||'none')!=='none'&&'mask',s.mixBlendMode!=='normal'&&'blend',(s.backdropFilter||'none')!=='none'&&'backdrop-filter'].filter(Boolean);};
 // Lockstep identity = computed keyframes (CSS animations report easing "linear"; the timing function lives in the keyframes) plus the values of any var() they read.
 const kfKey=(a,t)=>{const s=JSON.stringify(a.effect.getKeyframes().map(({computedOffset,...k})=>k)),cs=getComputedStyle(t);return s+[...new Set(s.match(/--[\w-]+/g)||[])].map(v=>v+':'+cs.getPropertyValue(v).trim()).join(';');};
 const targets=[],parents=[],rows=[],around=[],seen=new Set();
 for(const a of document.getAnimations()){const t=a.effect?.target;if(a.playState!=='running'||!t)continue;
  const tm=a.effect.getTiming(),kf=a.effect.getKeyframes(),period=tm.duration>0?tm.duration*(/alternate/.test(tm.direction)?2:1):0;
  let i=targets.indexOf(t);if(i<0)i=targets.push(t)-1;
  rows.push({target:i,iterationStart:tm.iterationStart,name:a.animationName||a.transitionProperty||a.id||JSON.stringify(kf),kf:kfKey(a,t),pseudo:a.effect.pseudoElement||'',duration:tm.duration,delay:tm.delay,easing:tm.easing,iterations:tm.iterations,direction:tm.direction,rate:a.playbackRate,
   // ponytail: whole-ms phase; animations started in the same frame match exactly, later-started ones land in their own group
   phase:period?((Math.round(a.currentTime-tm.delay)%period)+period)%period:null,
   props:[...new Set(kf.flatMap(k=>Object.keys(k).filter(x=>!['offset','computedOffset','easing','composite'].includes(x))))]});}
 // Effects on ancestors of animated elements: that ancestor's surface/mask may be recomposited every frame.
 for(const t of targets)for(let e=t.parentElement;e&&e!==document.documentElement;e=e.parentElement)if(!seen.has(e)&&!targets.includes(e)){seen.add(e);for(const kind of fx(e))around.push({kind,label:lab(e)});}
 window.__fslTag=()=>{targets.forEach((t,i)=>t.setAttribute('data-fsl',i));for(const e of document.querySelectorAll('body *')){const k=fx(e);if(k.length)e.setAttribute('data-fsl-fx',k.join(' '));}};
 return {rows,around,targets:targets.map(t=>{const p=t.parentElement,html=t instanceof HTMLElement,cs=getComputedStyle(t),[ox,oy]=cs.transformOrigin.split(' ').map(parseFloat);let pi=parents.indexOf(p);if(pi<0)pi=parents.push(p)-1;
  return {label:lab(t),parent:pi,parentLabel:p?lab(p):'',index:p?[...p.children].indexOf(t):0,pivot:html?[t.offsetLeft+ox,t.offsetTop+oy]:null,size:html?[parseFloat(cs.width),parseFloat(cs.height)]:null,
   fx:fx(t),st:{translate:cs.translate,rotate:cs.rotate,scale:cs.scale,transform:cs.transform},z:cs.zIndex,anims:t.getAnimations().length};})};
}

async function measure(f,route){
 const c=await f.browser.newContext({viewport,deviceScaleFactor:Number(o.dpr),reducedMotion:'no-preference'});
 try{
  const p=await c.newPage(),res=await p.goto(`${f.base}/${route}/`,{waitUntil:'load'});if(!res?.ok())throw Error(`${route}: HTTP ${res?.status()}`);
  await p.evaluate(()=>document.fonts.ready);await p.mouse.move(2,2);await p.waitForTimeout(3000);
  const {rows,around,targets:T}=await p.evaluate(inventory),cdp=await c.newCDPSession(p);
  // True idle first, before any tagging or LayerTree work. No rAF probe: a rAF loop forces a main frame and re-layerization every vsync.
  await cdp.send('Performance.enable');const M=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  await cdp.send('Tracing.start',{categories:'toplevel,viz',transferMode:'ReturnAsStream'});const m0=await M();await p.waitForTimeout(seconds*1000);const m1=await M();
  const s=await finishCDPTrace(cdp);
  const ev=JSON.parse(s).traceEvents,th={},ms={},n={};for(const e of ev)if(e.ph==='M'&&e.name==='thread_name')th[e.pid+':'+e.tid]=e.args.name;
  // ponytail: threads keyed by name; assumes this page is the only renderer (true here: one context at a time)
  for(const e of ev)if(e.ph==='X'){const k=th[e.pid+':'+e.tid];if(e.name==='ThreadControllerImpl::RunTask'&&THREADS.includes(k))ms[k]=(ms[k]||0)+e.dur/1000;if(e.name==='DirectRenderer::DrawFrame'||e.name==='DirectRenderer::DrawRenderPass')n[e.name]=(n[e.name]||0)+1;}
  const idle={seconds,mainTaskMs:Math.round((m1.TaskDuration-m0.TaskDuration)*1000),recalcs:m1.RecalcStyleCount-m0.RecalcStyleCount,threadMs:Object.fromEntries(THREADS.map(k=>[k,Math.round(ms[k]||0)])),frames:n['DirectRenderer::DrawFrame']||0,renderPassesPerFrame:+((n['DirectRenderer::DrawRenderPass']||0)/(n['DirectRenderer::DrawFrame']||1)).toFixed(1)};
  await p.evaluate(()=>window.__fslTag());
  let layers=[],updates=0;cdp.on('LayerTree.layerTreeDidChange',e=>{if(e.layers){layers=e.layers;updates++;}});await cdp.send('LayerTree.enable');
  // layerTreeDidChange only fires on a change: add, then remove, a throwaway layer to get a fresh full tree.
  await p.evaluate(()=>{const d=document.createElement('i');d.id='fsl-nudge';d.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;will-change:transform';document.body.append(d);});await p.waitForTimeout(300);
  const before=updates;await p.evaluate(()=>document.getElementById('fsl-nudge').remove());for(let i=0;i<30&&updates===before;i++)await p.waitForTimeout(100);
  if(updates===before)throw Error(route+': no fresh layer tree from CDP');
  const all=await Promise.all(layers.map(async l=>{const reasons=(await cdp.send('LayerTree.compositingReasons',{layerId:l.layerId}).catch(()=>({}))).compositingReasonIds||[];
   const node=l.backendNodeId?(await cdp.send('DOM.describeNode',{backendNodeId:l.backendNodeId}).catch(()=>null))?.node??null:null,at=node?.attributes||[],get=k=>{const i=at.findIndex((x,j)=>j%2===0&&x===k);return i<0?null:at[i+1];};
   return {draws:l.drawsContent,area:l.width*l.height,node:!!node,reasons,fsl:get('data-fsl'),fx:get('data-fsl-fx'),label:node?(node.nodeName||'').toLowerCase()+(get('id')?'#'+get('id'):'')+(get('class')||'').split(/\s+/).filter(c=>c&&!/^hw-s-/.test(c)).map(c=>'.'+c).join(''):'(no node)'};}));
  // ponytail: if the nudge layer is still in the snapshot it is just dropped here (off by at most one layer)
  const L=all.filter(l=>l.label!=='i#fsl-nudge');
  if(rows.some(r=>!r.pseudo&&r.props.every(x=>CC[x]))&&!L.some(l=>l.fsl!==null))throw Error(route+': no animated element found in the layer tree');
  const reasonsOf=new Map();for(const l of L)if(l.fsl!==null)reasonsOf.set(+l.fsl,[...(reasonsOf.get(+l.fsl)||[]),...l.reasons]);
  // mainThreadProps is the deterministic verdict; layerReason (an Active*Animation reason on the target's layer) is advisory only: paint-less wrappers and inherited layers do not show it.
  for(const r of rows){r.label=T[r.target].label;r.mainThreadProps=r.props.filter(x=>!CC[x]);r.layerReason=r.pseudo?null:(reasonsOf.get(r.target)||[]).some(x=>/^Active\w+Animation$/.test(x));}
  const merges=new Map(),merge=(name,ts,why)=>{const m={name,parent:ts[0].parentLabel,members:ts.map(t=>t.label),why,ok:!why.length},k=JSON.stringify(m);merges.set(k,{...m,times:(merges.get(k)?.times||0)+1});};
  const ORDER=['translate','rotate','scale','transform'];
  const check=(ts,P,pseudo)=>{const why=[];
    if(ts.some((t,i)=>i&&t.index!==ts[i-1].index+1))why.push('not adjacent: other siblings paint between them, so a wrapper would change stacking');
    if(ts.some(t=>!t.pivot))why.push('SVG member: pivot not checked');
    else{if(ts.some(t=>Math.hypot(t.pivot[0]-ts[0].pivot[0],t.pivot[1]-ts[0].pivot[1])>.5))why.push('different transform-origin pivot');if(ts.some(t=>t.size+''!==ts[0].size+''))why.push('different box size (matters for % keyframes)');}
    if(ts.some(t=>t.anims>1))why.push('member runs other animations');
    if(ts.some(t=>ORDER.some((x,i)=>!P.includes(x)&&t.st[x]!=='none'&&i<=Math.max(...P.map(p=>ORDER.indexOf(p))))))why.push('static transform outside the animated one: a wrapper changes composition order');
    const other=P.filter(x=>!ORDER.includes(x));if(other.length)why.push(`${other} on a wrapper is not the same as on each member`);
    if(ts.some(t=>t.fx.some(x=>x==='blend'||x==='backdrop-filter')))why.push('blend/backdrop-filter member: a wrapper would isolate it');
    if(pseudo)why.push('pseudo-element animation: a wrapper around the hosts moves their whole content');
    if(ts.some(t=>t.z!=='auto'))why.push('z-index: a wrapper stacking context would confine it');
    return why;};
  const groups=Object.values(Object.groupBy(rows,r=>JSON.stringify([r.kf,r.pseudo,r.duration,r.iterations,r.direction,r.rate,r.phase,r.easing,r.iterationStart]))).sort((a,b)=>b.length-a.length).map(g=>{
   const ids=[...new Set(g.map(r=>r.target))],parents=new Set(ids.map(i=>T[i].parent)).size,buckets=Object.values(Object.groupBy(ids,i=>T[i].parent)).map(b=>b.map(i=>T[i]).sort((x,y)=>x.index-y.index)).filter(b=>b.length>1),P=g[0].props;
   for(const ts of buckets)merge(g[0].name,ts,check(ts,P,g[0].pseudo));

   return {name:g[0].name,duration:g[0].duration,easing:g[0].easing,direction:g[0].direction,phase:g[0].phase,count:g.length,elements:ids.length,parents,labels:[...new Set(g.map(r=>r.label))].slice(0,3),
    merge:buckets.length?`${buckets.length} parent(s) hold 2+ members: see merge candidates`:parents>1?`no merge: ${parents} different parents, each on its own path or mirroring`:''};});
  // Near misses: the same animation on siblings but out of phase (different delay), e.g. bee wing A/B.
  for(const b of Object.values(Object.groupBy(rows,r=>JSON.stringify([T[r.target].parent,r.kf,r.pseudo,r.duration,r.direction,r.easing,r.iterationStart])))){const ph=[...new Set(b.map(r=>r.phase))].sort((x,y)=>x-y);
   const ts=[...new Set(b.map(r=>r.target))].map(i=>T[i]).sort((x,y)=>x.index-y.index);
   if(ph.length>1&&ts.length>1)merge(b[0].name,ts,[`out of phase by ${ph.map(x=>x-ph[0]).join('/')}ms (different delay): one wrapper would change the motion`,...check(ts,b[0].props,b[0].pseudo)]);}
  const flags={
   nonComposited:count(rows.filter(r=>r.mainThreadProps.length),r=>r.name+'|'+r.label).map(({name,props,mainThreadProps,label,n})=>({name,props,label,n,why:`animates ${mainThreadProps} on the main thread every frame; animate transform/translate/scale/rotate/opacity instead`})),
   mainThreadTicking:idle.recalcs>seconds||idle.mainTaskMs>50*seconds,
   layerEffects:count(L.filter(l=>l.fx),l=>l.fx+'|'+l.label+'|'+l.reasons).map(({fx,label,reasons,n})=>({kind:fx,label,reasons:reasons.join('+'),n})),
   aroundAnimated:count(around,x=>x.kind+'|'+x.label).map(({kind,label,n})=>({kind,label,n})),
   overlap:count(L.filter(l=>l.reasons.some(x=>/Overlap/.test(x))),l=>l.label).map(({label,n})=>({label,n}))};
  const totals={animations:rows.length,elements:T.length,layers:L.length,drawingLayers:L.filter(l=>l.draws).length,
   maskLayers:L.filter(l=>l.draws&&!l.node&&!l.reasons.length&&l.area>0).length,// ponytail: heuristic (synthesized clip-path/mask layers have no node and no reason); matched the 27 bee masks
   overlapLayers:flags.overlap.reduce((s,x)=>s+x.n,0),renderPassesPerFrame:idle.renderPassesPerFrame,reasons:Object.fromEntries(count(L.flatMap(l=>l.reasons.map(reason=>({reason}))),x=>x.reason).map(x=>[x.reason,x.n]))};
  return {totals,idle,groups,merges:[...merges.values()],flags,rows,targets:T};
 }finally{await c.close();}
}

function print(route,r){const t=r.totals,i=r.idle,log=console.log;
 log(`\n== ${route}: ${t.animations} running animations on ${t.elements} elements (${viewport.width}x${viewport.height} @${o.dpr}x)`);
 log('Lockstep groups (same keyframes, duration, direction and phase):');
 for(const g of r.groups.filter(g=>g.count>1))log(`${String(g.count).padStart(4)}  ${g.name} ${g.duration}ms ${g.direction} @${g.phase}ms  ${g.labels.join(' | ')}${g.merge?'  -> '+g.merge:''}`);
 log(`      + ${r.groups.filter(g=>g.count===1).length} animations with no lockstep partner`);
 log('Merge candidates (siblings one animated wrapper could drive; a manual source edit, then check pixels):');
 for(const m of r.merges)log(`  ${m.ok?'OK     ':'BLOCKED'} x${m.times} ${m.name} in ${m.parent}: ${m.members.join(' + ')}${m.why.length?' - '+m.why.join('; '):''}`);
 if(!r.merges.length)log('  none');
 log('Cost flags:');
 for(const x of r.flags.nonComposited)log(`  NON-COMPOSITED x${x.n} ${x.name} on ${x.label}: ${x.why}`);
 if(!r.flags.nonComposited.length)log('  main-thread animations: none');
 log(r.flags.mainThreadTicking?`  MAIN-THREAD TICKING: ${i.recalcs} style recalcs in ${i.seconds}s of true idle and ${i.mainTaskMs}ms main-thread work (style recalcs or main-thread work while idle)`:`  main thread idle: ${i.recalcs} style recalcs, ${i.mainTaskMs}ms in ${i.seconds}s`);
 for(const x of r.flags.layerEffects)log(`  x${x.n} ${x.kind} on layer ${x.label} [${x.reasons||'no reason'}]: ${/clip|mask/.test(x.kind)?'may be a mask layer':'render surface'}, an extra GPU pass per frame`);
 for(const x of r.flags.aroundAnimated)log(`  x${x.n} ${x.kind} on ${x.label}, ancestor of animated layers: may be recomposited every frame`);
 log(`  ${t.overlapLayers} overlap layers (static content promoted because it paints over animated layers): ${r.flags.overlap.slice(0,6).map(x=>x.label+' x'+x.n).join(', ')}`);
 log(`Totals: ${t.layers} layers (${t.drawingLayers} drawing), ${t.maskLayers} mask, ${t.overlapLayers} overlap, ${i.renderPassesPerFrame} render passes/frame over ${i.frames} frames`);
 log(`True idle ${i.seconds}s, no rAF: main-thread TaskDuration ${i.mainTaskMs}ms, ${i.recalcs} style recalcs; busy ms ${Object.entries(i.threadMs).map(([k,v])=>k+' '+v).join(', ')}`);}

function compare([a,b],R){const A=R[a],B=R[b],row=(k,x,y)=>console.log(`  ${k.padEnd(32)}${String(x).padStart(8)} -> ${String(y).padStart(8)}  (${y>=x?'+':''}${+(y-x).toFixed(1)})`);
 console.log(`\n== ${a} -> ${b} (idle thread times are one ${seconds}s sample; repeat before trusting small deltas)`);
 for(const k of ['animations','layers','drawingLayers','maskLayers','overlapLayers','renderPassesPerFrame'])row(k,A.totals[k],B.totals[k]);
 row('idle main TaskDuration ms',A.idle.mainTaskMs,B.idle.mainTaskMs);row('idle style recalcs',A.idle.recalcs,B.idle.recalcs);for(const k of THREADS)row(`idle ${k} ms`,A.idle.threadMs[k],B.idle.threadMs[k]);}

const f=await browserFixture(),out={browser:f.browser.version(),viewport:{...viewport,dpr:Number(o.dpr)},routes:{}};
try{for(const r of routes){out.routes[r]=await measure(f,r);print(r,out.routes[r]);}if(routes.length===2)compare(routes,out.routes);}finally{await f.close();if(o.json){await mkdir(dirname(o.json),{recursive:true});await writeFile(o.json,JSON.stringify(out,null,1));}}
if(o.strict&&Object.values(out.routes).some(r=>r.flags.nonComposited.length||r.flags.mainThreadTicking)){console.error('FAIL --strict: main-thread animation or idle ticking listed above');process.exitCode=1;}
