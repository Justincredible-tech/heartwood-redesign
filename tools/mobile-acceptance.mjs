import {analyzeFrameWindow} from './abuse-measurement.mjs';
// Pure mobile verifier contracts: unsupported observations cannot become PASS.
export const MOBILE_JOURNEYS=['arrival','tags','categories and detail','search, roots, newsletter, menu','home navigation','rotation and text size','interruptions','frames xs x4','frames xs x6','frames p402 x4','night frames xs x4','night frames xs x6','night frames p402 x4','fling','night fling','leaks','night and reduced motion'];
export function mobileThemes(value='both'){
 if(!['day','night','both'].includes(value))throw Error('Phone --theme must be day, night or both');
 return value==='both'?['day','night']:[value];
}
export function mobilePerformancePlan({quick=false,theme='both'}={}){
 return mobileThemes(theme).flatMap(mode=>(quick?[['xs',4]]:[['xs',4],['xs',6],['p402',4]]).map(([kind,rate])=>({theme:mode,kind,rate,name:(mode==='night'?'night ':'')+'frames '+kind+' x'+rate})));
}
export function mobileThemeSelection(value,{quick=false,theme='both'}={}){
 const selected=mobileSelection(value,{quick}),themes=mobileThemes(theme);if(selected===null)return null;
 const nightOnly=MOBILE_JOURNEYS.filter(j=>j.startsWith('night')),dayOnly=MOBILE_JOURNEYS.filter(j=>!j.startsWith('night'));
 const isNightOnly=name=>nightOnly.some(j=>j.startsWith(name))&&!dayOnly.some(j=>j.startsWith(name));   // a typed prefix whose every match is a night journey
 return [...new Set(selected.flatMap(name=>{
  if(isNightOnly(name)){if(!themes.includes('night'))throw Error('Night timing selection conflicts with --theme day');return [name];}
  if(name.startsWith('frames')||name==='fling')return themes.map(mode=>(mode==='night'?'night ':'')+name);
  return [name];
 }))];
}
export function phoneLagCoverage({executed=[],checks=[],browserErrors=[],failures=[],theme='day',quick=false}={}){
 const prefix=theme==='night'?'night ':'',required=mobilePerformancePlan({quick,theme}).map(row=>row.name).concat(prefix+'fling');
 const observed=executed.filter(name=>name.startsWith(prefix+'frames ')||name===prefix+'fling');
 const relevant=checks.filter(row=>row.performanceTheme===theme);
 const complete=required.every(name=>observed.includes(name))&&required.every(name=>(name.endsWith('fling')?['painted','frame','slow4g']:['frame','burst']).every(metric=>relevant.filter(row=>row.journey===name&&row.performanceMetric===metric).length===1));
 const clean=failures.length===0&&browserErrors.length===0;
 return {status:!observed.length?'NOT_RUN':complete&&clean&&relevant.length&&relevant.every(row=>row.pass===true)?'PASS':'INCOMPLETE_OR_FAIL',executedFrameAndFlingJourneys:observed,requiredJourneys:required,fullProfile:!quick,scope:'Host Chromium viewport/CPU emulation; heartbeat, trusted feedback and painted-fling evidence, not physical presentation'};
}
export function mobileSelection(value,{quick=false}={}){
 if(value===undefined)return null;
 const available=quick?MOBILE_JOURNEYS.filter(n=>!/(?:frames xs x6|frames p402 x4)$/.test(n)):MOBILE_JOURNEYS;
 const names=value.split(',').map(n=>n.trim());
 if(names.some(n=>!n)||new Set(names).size!==names.length)throw Error('Empty or duplicate mobile --only selection');
 for(const n of names)if(!available.some(a=>a.startsWith(n)))throw Error('Unknown or unavailable mobile journey '+JSON.stringify(n));
 return names;
}
export function mobileLayerEvidence(before,after){return Number.isInteger(before)&&before>0&&Number.isInteger(after)&&after>0&&after<=before;}
export function hasMobileTrace(events){return Array.isArray(events)&&events.some(e=>e.ph==='M'&&e.name==='thread_name'&&Number.isInteger(e.pid)&&e.pid>0&&Number.isInteger(e.tid)&&e.tid>0&&typeof e.args?.name==='string'&&e.args.name.length>0)&&events.some(e=>e.ph!=='M'&&Number.isFinite(e.ts)&&e.ts>0);}
export function mobileDrawEvidence(events,{startMark='hw-mobile-trace-start',endMark='hw-mobile-trace-end',minDurationMs=0}={}){
 const issues=[];if(!hasMobileTrace(events))issues.push('missing valid thread and timed trace evidence');
 if(!Number.isFinite(minDurationMs)||minDurationMs<0)issues.push('minDurationMs must be a finite nonnegative number');   // NaN/null/negative must fail closed, not disable the floor
 const rows=Array.isArray(events)?events:[],starts=rows.filter(e=>e.name===startMark&&Number.isFinite(e.ts)),ends=rows.filter(e=>e.name===endMark&&Number.isFinite(e.ts));
 const start=starts[0],end=ends[0];if(starts.length!==1||ends.length!==1||!(end?.ts>start?.ts)||start?.pid!==end?.pid||start?.tid!==end?.tid)issues.push('missing unique ordered same-renderer measurement markers');
 const threads=rows.filter(e=>e.ph==='M'&&e.name==='thread_name'&&Number.isInteger(e.pid)&&Number.isInteger(e.tid)&&typeof e.args?.name==='string');
 if(!threads.some(e=>e.pid===start?.pid&&e.tid===start?.tid&&e.args.name==='CrRendererMain'))issues.push('measurement markers have no renderer thread provenance');
 const durationMs=start&&end?(end.ts-start.ts)/1000:null;if(!Number.isFinite(durationMs)||durationMs<minDurationMs)issues.push('insufficient trace measurement duration');
 const targets=rows.filter(e=>['DrawFrame','Graphics.Pipeline.DrawAndSwap'].includes(e.name));if(targets.some(e=>!Number.isFinite(e.ts)||(e.ts>=start?.ts&&e.ts<=end?.ts&&!threads.some(t=>t.pid===e.pid&&t.tid===e.tid&&/Compositor|CrGpuMain/.test(t.args.name)))))issues.push('draw records lack supported timestamp/thread provenance');
 const frames=targets.filter(e=>e.ts>=start?.ts&&e.ts<=end?.ts&&threads.some(t=>t.pid===e.pid&&t.tid===e.tid&&/Compositor|CrGpuMain/.test(t.args.name))).length;
 return {supported:issues.length===0,issues,frames,durationMs,rendererPid:start?.pid,source:'recorded compositor draw trace events; not GPU utilization or physical presentation'};
}

// The hero tags against the crown. mask = {w, h, alpha} (one alpha byte per pixel of mobile/art/masters/tree-crown@3x.png), box = the
// .tree element's rect (the art fills it exactly), rect = a tag's bounding rect (page px). Returns the opaque crown pixels under the
// rect, the horizontal gap (page px) from the rect to the nearest opaque crown pixel in the rect's rows (Infinity if none) and the
// crown's opaque extent in those rows, in mask fractions. "Opaque" = alpha >= threshold (the soft drop shadows are not the crown).
export function maskClash(mask,box,rect,{threshold=128}={}){
 const sx=box.width/mask.w,sy=box.height/mask.h;
 const y0=Math.max(0,Math.floor((rect.top-box.top)/sy)),y1=Math.min(mask.h-1,Math.ceil((rect.bottom-box.top)/sy)-1);
 let opaque=0,gap=Infinity,lo=Infinity,hi=-Infinity;
 for(let y=y0;y<=y1;y++)for(let x=0;x<mask.w;x++){
  if(mask.alpha[y*mask.w+x]<threshold)continue;
  const l=box.left+x*sx,r=l+sx;lo=Math.min(lo,x);hi=Math.max(hi,x+1);
  if(r>rect.left&&l<rect.right)opaque++;
  gap=Math.min(gap,r<=rect.left?rect.left-r:l>=rect.right?l-rect.right:0);
 }
 return {opaque,gap,extent:lo<=hi?[lo/mask.w,hi/mask.w]:null};
}
// the phone widths the margin rule promises (iPhone XS/11 Pro, 12-16, 17 Pro) in portrait and landscape
export const TAG_VIEWPORTS=[[375,812],[390,844],[402,874],[812,375],[844,390],[874,402]];
export const overlaps=(a,b,pad=0)=>a.left<b.right+pad&&b.left<a.right+pad&&a.top<b.bottom+pad&&b.top<a.bottom+pad;
// Runs IN THE PAGE (page.evaluate): the tree box, the hero tags and every branch tier's tag and leaf targets.
export function tagProbe(){
 const R=e=>{const r=e.getBoundingClientRect();return {left:r.left+scrollX,top:r.top+scrollY,right:r.right+scrollX,bottom:r.bottom+scrollY,width:r.width,height:r.height};};
 const tree=document.querySelector('.tree');
 return {vw:document.documentElement.clientWidth,flow:tree.classList.contains('is-flow'),tree:R(tree),
  tags:[...tree.querySelectorAll('.tag')].map(t=>({kind:t.dataset.cat,...R(t)})),lead:[...document.querySelectorAll('.hero h1, .hero__cta .btn')].map(R),
  tiers:[...document.querySelectorAll('.tier')].map(s=>({id:s.id,tag:R(s.querySelector(':scope > details > summary')),leaves:[...s.querySelectorAll('.leaf')].map(R)}))};
}
// every failure of the margin rule for one probe (empty = pass): flow fallback, off screen, under 44 px, touching each other or the
// headline, on the crown's opaque pixels, or a branch tag on a leaf target
export function tagFailures(p,mask,{edge=4}={}){
 const out=[];
 if(p.flow)out.push('tags fell back to the list layout (is-flow)');
 p.tags.forEach((t,i)=>{
  if(t.left<edge||t.right>p.vw-edge)out.push(`${t.kind}: off screen (${Math.round(t.left)}..${Math.round(t.right)} of ${p.vw})`);
  if(t.height<44||t.width<44)out.push(`${t.kind}: ${Math.round(t.width)}x${Math.round(t.height)} < 44 px`);
  p.tags.slice(i+1).forEach(u=>{if(overlaps(t,u,2))out.push(`${t.kind} touches ${u.kind}`);});
  if((p.lead||[]).some(l=>overlaps(t,l)))out.push(`${t.kind}: on the headline or its buttons`);
  const c=maskClash(mask,p.tree,t);
  if(c.opaque)out.push(`${t.kind}: on the crown (${c.opaque} opaque mask px)`);
 });
 for(const s of p.tiers)s.leaves.forEach((l,j)=>{if(overlaps(s.tag,l))out.push(`${s.id}: branch tag on leaf target ${j}`);});
 return out;
}

export function mobileFeedbackPass(row,{leaf=false,budget=2,maxMs=34}={}){return !!row&&Number.isInteger(row.frames)&&row.frames>0&&row.frames<=budget&&Number.isFinite(row.ms)&&row.ms>=0&&row.ms<=maxMs&&(!leaf||(Number.isInteger(row.leafFrames)&&row.leafFrames>0&&row.leafFrames<=budget&&Number.isFinite(row.leafMs)&&row.leafMs>=row.ms&&row.leafMs<=maxMs));}
export function mobileScrollEvidence(window){const row=analyzeFrameWindow(window);return {supported:row.valid,issues:row.issues,timestamps:Array.isArray(window?.frames)?window.frames:[],frames:window?.frames?.length??0,p50:row.p50Ms,p95:row.p95Ms,max:row.maxMs,over50:row.intervals?.filter(g=>g.gapMs>50).length??null,intervals:row.intervals,startMs:window?.startMs,endMs:window?.endMs,source:'main-thread rAF heartbeat including first/last boundary gaps; not physical display presentation'};}

// Foreground motion (review round 048): a motion record is {at, focused, visibility, live, groups:[{cls,on}], animations:[{name,state,time,target}]}
// as recorded by verify-mobile.mjs' sampleMotion. A frozen or paused foreground is never a pass: matched loops must show real
// document-timeline progress between the samples, and an unsupported/absent observation fails closed.
const saneMotion=s=>!!s&&s.focused===true&&s.visibility==='visible'&&s.live===true&&Number.isFinite(s.at)&&Array.isArray(s.groups)&&s.groups.some(g=>g&&g.on===true)&&Array.isArray(s.animations)&&s.animations.every(a=>a&&typeof a.name==='string'&&typeof a.state==='string'&&typeof a.target==='string'&&(a.time===null||Number.isFinite(a.time)));
const saneRatio=r=>Number.isFinite(r)&&r>0;
const runningTimes=(s,filter)=>{const m=new Map();for(const a of s.animations){if(a.state!=='running'||!Number.isFinite(a.time))continue;if(filter&&!filter(a))continue;const k=a.name+'|'+a.target,v=m.get(k);if(v===undefined||a.time>v)m.set(k,a.time);}return m;};
const maxAdvance=(before,after,filter)=>{const m0=runningTimes(before,filter),m1=runningTimes(after,filter);if(!m0.size||!m1.size)return null;let advance=0;for(const [k,t1] of m1){const t0=m0.get(k);if(t0!==undefined&&t1-t0>advance)advance=t1-t0;}return advance;};
export function mobileForegroundPass(before,after,{minAdvanceRatio=0.5}={}){
 if(!saneMotion(before)||!saneMotion(after)||!saneRatio(minAdvanceRatio))return false;
 const elapsed=after.at-before.at;if(!(elapsed>0))return false;
 const advance=maxAdvance(before,after);
 return advance!==null&&advance>=elapsed*minAdvanceRatio;
}
// Offscreen (review round 048): the supported viewport context — the real IntersectionObserver `on` state is gone while the page is
// still focused and visible, the loops are held as paused records (not deleted), and the two post-return samples must show
// real resumed progress.
export function mobileOffscreenPass(onscreen,offscreen,resumed,advancing,{minAdvanceRatio=0.5}={}){
 const crit=a=>!!a&&typeof a.target==='string'&&/\bcrit\b/.test(a.target);
 const runningCrit=s=>s.animations.some(a=>crit(a)&&a.state==='running'&&Number.isFinite(a.time));
 const held=!!offscreen&&offscreen.focused===true&&offscreen.visibility==='visible'&&offscreen.live===true&&Number.isFinite(offscreen.at)&&Array.isArray(offscreen.groups)&&offscreen.groups.some(g=>g&&g.on===false)&&Array.isArray(offscreen.animations)&&offscreen.animations.filter(crit).length>0&&!runningCrit(offscreen);
 if(!saneMotion(onscreen)||!saneMotion(resumed)||!saneMotion(advancing)||!held||!saneRatio(minAdvanceRatio))return false;
 if(!runningCrit(onscreen)||!runningCrit(resumed)||!runningCrit(advancing))return false;
 const after=advancing.at-resumed.at;if(!(after>0))return false;
 const advance=maxAdvance(resumed,advancing,crit);
 return advance!==null&&advance>=after*minAdvanceRatio;
}
