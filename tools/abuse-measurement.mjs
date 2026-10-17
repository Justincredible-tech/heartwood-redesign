// Pure acceptance logic. rAF is a main-thread heartbeat; DrawFrame is compositor
// submission; Event Timing is quantized event-to-next-paint timing. None is a
// physical presentation measurement. Unsupported evidence never yields PASS.
const finite=Number.isFinite;
const percentile=(a,q)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))]:null;
const EXCLUSION='lifecycle-frozen-and-first-resume-frame';

const DEFAULTS={frameP95Ms:25,frameMaxMs:50,inputToPaintP95Ms:34,navFirstMoveP95Ms:34,navArrivalMaxMs:2000,scrollStallMaxRatio:.1,resumeFrameMaxMs:100,
 leaks:{cycles:50,domNodesDelta:0,listenersDelta:0,documentsDelta:0,layersDelta:0,heapDeltaKB:1024}};
export function resolveAbuseBudgets(overrides={}, {quick=false}={}){
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw Error('invalid budget object');
 const result={...DEFAULTS,leaks:{...DEFAULTS.leaks}};
 const nonnegative=(name,value)=>{if(typeof value!=='number'||!finite(value)||value<0)throw Error(name+' must be a finite nonnegative number');};
 for(const [name,value] of Object.entries(overrides)){
  if(name==='leaks')continue;
  if(!(name in DEFAULTS))throw Error('unknown budget '+name);
  nonnegative(name,value);if(value>DEFAULTS[name])throw Error(name+' would loosen the absolute budget');result[name]=value;
 }
 if(overrides.leaks!==undefined){
  if(!overrides.leaks||typeof overrides.leaks!=='object'||Array.isArray(overrides.leaks))throw Error('invalid leak budget object');
  for(const [name,value] of Object.entries(overrides.leaks)){
   if(!(name in DEFAULTS.leaks))throw Error('unknown leak budget '+name);
   if(name==='cycles'){
    if(!Number.isSafeInteger(value)||value<DEFAULTS.leaks.cycles)throw Error('full leak cycles must be a positive integer >= '+DEFAULTS.leaks.cycles);
   }else {nonnegative('leaks.'+name,value);if(value>DEFAULTS.leaks[name])throw Error('leaks.'+name+' would loosen the absolute budget');}
   result.leaks[name]=value;
  }
 }
 if(quick)result.leaks.cycles=12;
 result.samplingMode=quick?'quick-limited':'full';return result;
}

export function validateAbuseSelection(options={},roster={}){
 const seconds=Number(options.seconds??8);
 if(!finite(seconds)||seconds<=0)throw Error('invalid duration: --seconds must be positive and finite');
 const list=(name,choices)=>{
  if(options[name]===undefined)return null;
  const values=String(options[name]).split(',').map(v=>v.trim());
  if(!values.length||values.some(v=>!v))throw Error('empty --'+name+' selection');
  if(choices)for(const value of values)if(!choices.includes(value))throw Error('unknown --'+name+' choice '+value);
  return [...new Set(values)];
 };
 const result={seconds,only:list('only',roster.scenarioNames),configs:list('configs',roster.configNames),routes:list('route',roster.routeNames)};
 if(roster.planCount!==undefined&&(!Number.isInteger(roster.planCount)||roster.planCount<0))throw Error('invalid plan count');
 if(roster.planCount===0&&!roster.doChaos)throw Error('acceptance selection has no work');
 return result;
}

export function validateLeakCounters(counters={}){
 const issues=[];
 for(const name of ['nodes','listeners','documents','heapKB','layers','animations'])if(!finite(counters[name])||counters[name]<0)issues.push('unavailable or invalid '+name+' counter');
 for(const name of ['nodes','documents','heapKB','layers'])if(counters[name]===0)issues.push('no '+name+' evidence for the loaded art page');
 return {valid:issues.length===0,issues};
}

export function analyzeActivityCoverage(activity={},requirements={}){
 const failures=Array.isArray(activity.retainedFailures??[])?(activity.retainedFailures||[]).map(f=>'retained operation failure: '+(f.message||String(f))):['invalid retained-operation failure ledger'];
 for(const group of ['sent','native','regions','responses'])for(const [name,min] of Object.entries(requirements[group]||{})){
  const value=activity[group]?.[name];if(!finite(value)||value<min)failures.push(`${group}.${name}: ${value??'unobserved'} < ${min}`);
 }
 for(const name of ['uniqueLeaves','rounds'])if(requirements[name]!==undefined&&!(activity[name]>=requirements[name]))failures.push(`${name}: ${activity[name]??'unobserved'} < ${requirements[name]}`);
 if(activity.heldKeys?.length||activity.heldButtons?.length)failures.push('input ownership remains pressed');
 return {valid:failures.length===0,failures,requirements,activity};
}

function exclusionSpans(exclusions,start,end){
 const issues=[],records=[];
 for(const e of exclusions||[]){
  if(!e||e.reason!==EXCLUSION||!finite(e.fromMs)||!finite(e.toMs)||e.toMs<e.fromMs){issues.push('invalid or unrecognized lifecycle exclusion');continue;}
  const fromMs=Math.max(start,e.fromMs),toMs=Math.min(end,e.toMs);
  if(toMs>fromMs)records.push({...e,fromMs,toMs});
 }
 const spans=[];
 for(const e of [...records].sort((a,b)=>a.fromMs-b.fromMs)){
  const last=spans.at(-1);if(last&&e.fromMs<=last.toMs)last.toMs=Math.max(last.toMs,e.toMs);else spans.push({fromMs:e.fromMs,toMs:e.toMs});
 }
 return {issues,records,spans};
}
const overlap=(a,b,spans)=>spans.reduce((s,e)=>s+Math.max(0,Math.min(b,e.toMs)-Math.max(a,e.fromMs)),0);

export function analyzeFrameWindow({startMs,endMs,frames=[],exclusions=[]},{minSamples=2,minActiveMs=50}={}){
 const issues=[];
 if(!finite(startMs)||!finite(endMs)||endMs<=startMs)issues.push('invalid measurement duration');
 if(!Array.isArray(frames)||frames.length<minSamples)issues.push(`insufficient rAF samples: need ${minSamples}`);
 const ordered=Array.isArray(frames)&&frames.every((t,i)=>finite(t)&&t>=startMs&&t<=endMs&&(!i||t>frames[i-1]));
 if(!ordered)issues.push('invalid rAF timestamp order or outside measurement window');
 const x=exclusionSpans(exclusions,startMs,endMs);issues.push(...x.issues);
 const durationMs=endMs-startMs,excludedMs=finite(durationMs)?overlap(startMs,endMs,x.spans):0,activeDurationMs=durationMs-excludedMs;
 if(!(activeDurationMs>=minActiveMs))issues.push(`insufficient active measurement duration: need ${minActiveMs} ms`);
 const intervals=[];
 if(ordered&&finite(durationMs)&&durationMs>0){
  const points=[startMs,...frames.filter(t=>t>startMs&&t<endMs),endMs];
  for(let i=1;i<points.length;i++){
   const fromMs=points[i-1],toMs=points[i],wallMs=toMs-fromMs,excluded=overlap(fromMs,toMs,x.spans),gapMs=Math.max(0,wallMs-excluded);
   intervals.push({fromMs,toMs,wallMs,excludedMs:excluded,gapMs,kind:i===1?'begin-to-first-rAF':i===points.length-1?'last-rAF-to-end':'main-rAF'});
  }
 }
 const gaps=intervals.filter(i=>i.gapMs>0).map(i=>i.gapMs);
 return {valid:issues.length===0,issues,source:'main-thread-rAF-heartbeat',semantics:'Includes begin/end boundary delays; does not measure physical presentation',
  startMs,endMs,durationMs,activeDurationMs,excludedMs,exclusions:x.records,samples:Array.isArray(frames)?frames.length:0,intervals,
  p50Ms:percentile(gaps,.5),p95Ms:percentile(gaps,.95),maxMs:gaps.length?Math.max(...gaps):null};
}

export function analyzeInput({eventCount=0,entries=[],supported=false}={}){
 const issues=[];
 if(!Number.isInteger(eventCount)||eventCount<0)issues.push('invalid captured event count');
 if(!Array.isArray(entries)||entries.some(e=>!finite(e?.duration)||e.duration<0))issues.push('invalid Event Timing entry');
 const durations=Array.isArray(entries)?entries.filter(e=>finite(e?.duration)&&e.duration>=0).map(e=>e.duration):[];
 if(durations.length>eventCount)issues.push('observer/captured event counts do not match');
 const unobservedEvents=Math.max(0,eventCount-durations.length);
 const coverage=issues.length?'unsupported':eventCount===0?'not-applicable':!supported?'unsupported':unobservedEvents?'partial':'complete';
 return {events:eventCount,observedSamples:durations.length,unobservedEvents,durations,entries,issues,coverage,
  quantized:true,p95Ms:percentile(durations,.95),p95UpperBoundMs:null,maxMs:durations.length?Math.max(...durations):null,
  source:'PerformanceEventTiming.duration',semantics:'Observed quantized event-to-next-paint durations only, not physical presentation. takeRecords drains queued records, not pending paint. Omissions remain unknown and do not establish a population bound.'};
}

export function analyzeTraceInputs({captured=[],traceEvents=[],startMs,endMs,rendererPid,frameId,exclusions=[]}={}){
 const issues=[],samples=[],used=new Set(),x=exclusionSpans(exclusions,startMs,endMs);issues.push(...x.issues);
 if(!finite(startMs)||!finite(endMs)||endMs<=startMs)issues.push('invalid trace-input measurement window');
 if(captured.length&&(rendererPid===undefined||!frameId))issues.push('trace-input renderer/frame ownership is absent');
 const fingerprints=new Set(),begins=[];
 for(const e of traceEvents){
  const d=e.args?.data;if(e.name!=='EventTiming'||e.ph!=='b'||e.pid!==rendererPid||d?.frame!==frameId)continue;
  const key=JSON.stringify([e.pid,e.id,e.ts,d]);if(fingerprints.has(key))continue;fingerprints.add(key);begins.push(e);
 }
 for(const c of captured){
  if(!finite(c.timeStamp)||!c.name||c.timeStamp<startMs||c.timeStamp>endMs){issues.push(`captured input ${c.id}: unknown eligibility/timestamp`);continue;}
  const candidates=begins.filter(e=>!used.has(e)&&e.args.data.type===c.name&&Math.abs(e.args.data.timeStamp-c.timeStamp)<=.1&&finite(e.args.data.duration)&&e.args.data.duration>=0);
  if(candidates.length!==1){issues.push(`captured input ${c.id}: ${candidates.length} matching trace starts`);continue;}
  const b=candidates[0],d=b.args.data;
  const ends=[...new Map(traceEvents.filter(e=>e.name==='EventTiming'&&e.ph==='e'&&e.pid===b.pid&&e.id===b.id&&Math.abs((e.ts-b.ts)/1000-d.duration)<=.1).map(e=>[JSON.stringify(e),e])).values()];
  if(ends.length!==1||d.timeStamp+d.duration>endMs){issues.push(`captured input ${c.id}: unique in-window paint completion is not observed`);continue;}
  const excludedMs=overlap(d.timeStamp,d.timeStamp+d.duration,x.spans);
  used.add(b);samples.push({capturedId:c.id,name:c.name,timeStamp:c.timeStamp,rawDuration:d.duration,excludedMs,duration:Math.max(0,d.duration-excludedMs),traceId:b.id,startedAtTraceUs:b.ts,completedAtTraceUs:ends[0].ts});
 }
 const durations=samples.map(s=>s.duration),complete=issues.length===0&&samples.length===captured.length;
 const coverage=!captured.length?'not-applicable':complete?'complete':'unsupported';
 return {source:'CDP EventTiming completed trace spans',semantics:'Unrounded recorded event-to-render-completion spans in the instrumented run; not physical display presentation. Every captured trusted event must match an observed completed span.',
  quantized:false,events:captured.length,observedSamples:samples.length,unobservedEvents:captured.length-samples.length,samples,durations,issues,coverage,
  p95Ms:percentile(durations,.95),p95UpperBoundMs:complete?percentile(durations,.95):null,maxMs:durations.length?Math.max(...durations):null};
}

export function correlateMissIntervals(rows){
 const sorted=[...rows].sort((a,b)=>a.fromMs-b.fromMs||a.toMs-b.toMs),groups=[];
 for(const row of sorted){let group=groups.at(-1);if(!group||row.fromMs>=group.toMs){group={id:'interval-cluster-'+(groups.length+1),toMs:row.toMs,members:[]};groups.push(group);}group.toMs=Math.max(group.toMs,row.toMs);group.members.push(row.id);}
 const byId=new Map(groups.flatMap(g=>g.members.map(id=>[id,g])));
 return rows.map(r=>({...r,stream:r.kind==='compositor-submission'?'compositor-submission':'main-thread-heartbeat',correlationId:byId.get(r.id)?.id,correlatedIds:byId.get(r.id)?.members||[],correlationMeaning:'Overlapping measured intervals, not unique physical frames'}));
}

// Self-contained because the browser probe installs this function via toString.
export function createNavigationTracker({tolerancePx=2}={}){
 const rows=[];let active=null,nextId=1;
 const request=({timeMs,fromY,destinationY,targetId=null,targetFound=true})=>{
  if(active&&active.arrivalAtMs==null)active.supersededAtMs=timeMs;
  const row={id:nextId++,timeMs,fromY,destinationY,targetId,targetFound,firstMoveAtMs:null,arrivalAtMs:null,supersededAtMs:null,noOp:false};
  rows.push(row);active=row;
  if(targetFound&&Number.isFinite(fromY)&&Number.isFinite(destinationY)&&Math.abs(fromY-destinationY)<=tolerancePx){row.noOp=true;row.firstMoveAtMs=timeMs;row.arrivalAtMs=timeMs;active=null;}
  return row.id;
 };
 const sample=({timeMs,y,destinationY})=>{
  if(!active)return;
  if(destinationY===null){active.targetFound=false;return;}
  if(Number.isFinite(destinationY))active.destinationY=destinationY;
  if(active.firstMoveAtMs==null&&Math.abs(y-active.fromY)>tolerancePx)active.firstMoveAtMs=timeMs;
  if(Math.abs(y-active.destinationY)<=tolerancePx){active.arrivalAtMs=timeMs;active=null;}
 };
 const cancel=({timeMs,reason})=>{if(active){active.supersededAtMs=timeMs;active.supersededReason=reason;active=null;}};
 return {request,sample,cancel,current:()=>active?{...active}:null,snapshot:()=>rows.map(r=>({...r}))};
}

export function analyzeNavigation({requests=[],endMs,exclusions=[]},{firstMoveMaxMs=34,arrivalMaxMs=2000}={}){
 const failures=[],rows=[];let pending=0,superseded=0,noOps=0;
 const start=Math.min(endMs,...requests.map(r=>r.timeMs)),x=exclusionSpans(exclusions,start,endMs);
 failures.push(...x.issues);
 const elapsed=(a,b)=>Math.max(0,b-a-overlap(a,b,x.spans));
 if(!finite(endMs))failures.push('navigation measurement end is invalid');
 const ids=new Set();
 for(const request of requests){
  const r={...request};
  if(ids.has(r.id))failures.push(`navigation ${r.id}: duplicate request identifier`);ids.add(r.id);
  if(!r.targetFound||!finite(r.timeMs)||!finite(r.fromY)||!finite(r.destinationY)){failures.push(`navigation ${r.id}: missing or invalid target`);rows.push({...r,status:'invalid'});continue;}
  const stop=r.arrivalAtMs??r.supersededAtMs??endMs,age=elapsed(r.timeMs,stop);
  const movementMs=r.firstMoveAtMs==null?null:elapsed(r.timeMs,r.firstMoveAtMs);
  const arrivalMs=r.arrivalAtMs==null?null:elapsed(r.timeMs,r.arrivalAtMs);
  if(stop<r.timeMs||r.timeMs>endMs)failures.push(`navigation ${r.id}: invalid request observation times`);
  const status=r.noOp?'already-arrived':arrivalMs!==null?'arrived':r.supersededAtMs!==null?'superseded':'pending';
  if(status==='already-arrived')noOps++;
  if(status==='superseded')superseded++;
  if(status==='pending')pending++;
  if(!r.noOp&&((movementMs===null&&arrivalMs===null&&age>firstMoveMaxMs)||(movementMs!==null&&movementMs>firstMoveMaxMs)))failures.push(`navigation ${r.id}: first movement missed ${firstMoveMaxMs} ms (${movementMs??'unanswered'}; active age ${age} ms)`);
  if(!r.noOp&&((arrivalMs===null&&age>=arrivalMaxMs)||(arrivalMs!==null&&arrivalMs>arrivalMaxMs)))failures.push(`navigation ${r.id}: destination arrival missed ${arrivalMaxMs} ms (${arrivalMs??'unanswered'})`);
  rows.push({...r,status,activeObservedMs:age,movementMs,arrivalMs});
 }
 const movement=rows.filter(r=>r.movementMs!==null&&r.movementMs!==undefined).map(r=>r.movementMs);
 return {valid:failures.length===0,failures,requests:requests.length,pending,superseded,noOps,rows,
  firstMoveP95Ms:percentile(movement,.95),arrivalMaxMs:rows.some(r=>r.arrivalMs!=null)?Math.max(...rows.filter(r=>r.arrivalMs!=null).map(r=>r.arrivalMs)):null,
  semantics:'Each meaningful request must respond promptly and reach its clamped real target within a bounded deadline; superseded intent remains recorded.'};
}

export function analyzeCompositorWindow({startMs,endMs,draws=[],dropped=[],exclusions=[]}={}){
 const window=analyzeFrameWindow({startMs,endMs,frames:draws,exclusions}),issues=[...window.issues];
 if(!Array.isArray(dropped)||dropped.some(t=>!finite(t)))issues.push('invalid compositor drop timestamp');
 const activeDrops=(Array.isArray(dropped)?dropped:[]).filter(t=>t>=startMs&&t<=endMs&&!window.exclusions.some(e=>t>=e.fromMs&&t<=e.toMs));
 const dropGaps=window.intervals.filter(i=>i.gapMs>0&&activeDrops.some(t=>t>=i.fromMs&&t<=i.toMs));
 return {...window,valid:issues.length===0,issues,source:'compositor-submission-trace',sampleCount:draws.length,
  dropped:activeDrops,dropGaps,semantics:'DirectRenderer::DrawFrame submissions and PipelineReporter dropped intervals under tracing; physical display presentation is not measured'};
}

export function evaluateAcceptance({raf,presentation,compositor,input,navigation},{frameP95Ms=25,frameMaxMs=50,inputToPaintP95Ms=34}={}){
 // Validate summaries again at this boundary: a claimed-valid adapter with NaN,
 // null or missing counters must not defeat the numeric budget comparisons.
 resolveAbuseBudgets({frameP95Ms,frameMaxMs,inputToPaintP95Ms});
 const breaches=[],unsupported=[],unverified=[];
 const nonnegative=value=>finite(value)&&value>=0;
 const metrics=summary=>nonnegative(summary?.p95Ms)&&nonnegative(summary?.maxMs)&&summary.maxMs>=summary.p95Ms;
 const count=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
 const issueText=(issues,fallback)=>Array.isArray(issues)&&issues.length?issues.join('; '):fallback;
 if(raf?.valid!==true||!count(raf?.samples,2)||!metrics(raf))breaches.push('invalid rAF measurement: '+issueText(raf?.issues,'absent, incomplete or nonfinite summary'));
 if(nonnegative(raf?.p95Ms)&&raf.p95Ms>=frameP95Ms)breaches.push(`main-thread heartbeat p95 ${raf.p95Ms} ms (budget < ${frameP95Ms})`);
 if(nonnegative(raf?.maxMs)&&raf.maxMs>frameMaxMs)breaches.push(`main-thread heartbeat/boundary max ${raf.maxMs} ms (budget <= ${frameMaxMs})`);
 if(compositor){
  unverified.push('physical display presentation','continuous pointer/wheel input-to-display latency');
  if(compositor.valid!==true||compositor.source!=='compositor-submission-trace'||!count(compositor.sampleCount,2)||!metrics(compositor))unsupported.push('compositor submission acceptance unsupported: '+issueText(compositor.issues,'stream absent, incomplete or nonfinite summary'));
  else {if(compositor.p95Ms>=frameP95Ms)breaches.push(`traced compositor submission p95 ${compositor.p95Ms} ms (budget < ${frameP95Ms})`);if(compositor.maxMs>frameMaxMs)breaches.push(`traced compositor submission/boundary max ${compositor.maxMs} ms (budget <= ${frameMaxMs})`);}
 }else if(presentation?.status!=='supported'||presentation?.source!=='physical-presentation')unsupported.push('physical presentation acceptance unsupported: rAF and compositor DrawFrame do not prove presentation');
 else if(!metrics(presentation))unsupported.push('physical presentation samples are invalid or absent');
 else {if(presentation.p95Ms>=frameP95Ms)breaches.push(`physical presentation p95 ${presentation.p95Ms} ms`);if(presentation.maxMs>frameMaxMs)breaches.push(`physical presentation max ${presentation.maxMs} ms`);}
 let inputScope='discrete-event render timing unavailable or incomplete';
 if(!input)unsupported.push('discrete input timing evidence is absent');
 else {
  if(Array.isArray(input.issues)&&input.issues.length)breaches.push('invalid input measurement: '+input.issues.join('; '));
  const inputShape=count(input.events)&&count(input.observedSamples)&&count(input.unobservedEvents)&&input.observedSamples<=input.events&&input.unobservedEvents===input.events-input.observedSamples&&
   Array.isArray(input.issues)&&Array.isArray(input.durations)&&input.durations.length===input.observedSamples&&input.durations.every(nonnegative)&&typeof input.quantized==='boolean';
  const inputMetrics=input.observedSamples===0?input.p95Ms===null&&input.maxMs===null:metrics(input);
  if(!inputShape||!inputMetrics)unsupported.push('discrete input timing summary has invalid or absent counters/samples/metrics');
  if(input.events===0){
   if(!inputShape||!inputMetrics||input.coverage!=='not-applicable'||input.p95UpperBoundMs!==null)unsupported.push('idle discrete-input N/A requires explicitly zero captured and observed events, no timings and not-applicable coverage');
   else inputScope='discrete-event render timing not applicable (no captured discrete events)';
  }else if(count(input.events,1)){
   const complete=inputShape&&inputMetrics&&input.coverage==='complete'&&input.quantized===false&&input.observedSamples===input.events&&input.unobservedEvents===0&&nonnegative(input.p95UpperBoundMs)&&input.p95UpperBoundMs>=input.p95Ms;
   if(!complete)unsupported.push(`input latency coverage ${input.coverage}: ${input.observedSamples} actual samples for ${input.events} captured events${input.quantized?' (quantized observer data, not a strict latency bound)':''}`);
   else inputScope='completed discrete-event render timing in the separate traced run';
   if(nonnegative(input.p95UpperBoundMs)&&input.p95UpperBoundMs>inputToPaintP95Ms)breaches.push(`recorded discrete-input render-completion p95 ${input.p95UpperBoundMs} ms (budget ${inputToPaintP95Ms}; ${input.coverage} coverage)`);
  }
 }
 if(navigation?.valid!==true)breaches.push(...(Array.isArray(navigation?.failures)&&navigation.failures.length?navigation.failures:['navigation evidence absent or invalid']));
 if(navigation?.pending)unsupported.push(`${navigation.pending} navigation request(s) did not receive a complete bounded observation`);
 return {status:breaches.length?'FAIL':unsupported.length?'UNSUPPORTED':'PASS',scope:compositor?'main-thread heartbeat, '+inputScope+', bounded navigation and compositor submission':'main-thread heartbeat, '+inputScope+', bounded navigation and physical-presentation evidence',breaches,unsupported,unverified};
}

export function attributeAllMisses(rows,attribute){
 const allMisses=rows.map((row,index)=>{
  try{return {...row,...attribute(row,index)};}catch(error){return {...row,cause:'unresolved',attributionError:error.message};}
 }).map(row=>({...row,cause:row.cause||'unresolved'}));
 const byCause={};let unresolved=0;
 for(const row of allMisses){byCause[row.cause]=(byCause[row.cause]||0)+1;if(/unresolved|pending|none above/.test(row.cause))unresolved++;}
 return {allMisses,byCause,unresolved,worst:[...allMisses].sort((a,b)=>b.gapMs-a.gapMs).slice(0,6)};
}
export const attachAttribution=(clean,diagnostic)=>({...clean,attributionPass:{...diagnostic,interpretation:'Diagnostic evidence from a different run under tracing; does not replace, causally explain, or validate clean-run measurements.'}});
