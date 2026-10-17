// Pure contracts for the dark browser verifier. References are diagnostic;
// they never excuse an absolute failure. These timings are not physical paint.
import {analyzeFrameWindow} from './abuse-measurement.mjs';
const pct=(a,q)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))]:null;
export function darkSelection(value,names){
 if(value===undefined)return null;
 const selected=String(value).split(',').map(n=>n.trim());
 if(selected.some(n=>!n)||new Set(selected).size!==selected.length)throw Error('Empty or duplicate HW_ONLY selection');
 for(const n of selected)if(!names.includes(n))throw Error('Unknown HW_ONLY case '+JSON.stringify(n));
 return new Set(selected);
}
export function analyzeDarkTiming(d={}){
 const issues=[];
 const frames=Array.isArray(d.frames)?d.frames:[];
 if(frames.some(f=>![f?.raf,f?.now,f?.done].every(Number.isFinite)||f.done<f.now||f.now<f.raf))issues.push('invalid frame completion evidence');
 const eligible=frames.filter(f=>f.raf>=d.startMs&&f.raf<=d.endMs);
 const window=analyzeFrameWindow({startMs:d.startMs,endMs:d.endMs,frames:eligible.map(f=>f.raf)},{minSamples:2,minActiveMs:3000});
 issues.push(...window.issues);
 const inputs=Array.isArray(d.inputs)?d.inputs:[];
 if(!inputs.length)issues.push('no captured native inputs');
 if(!Number.isInteger(d.sent)||d.sent<1)issues.push('no sent input operations');
 const lags=[];
 for(const input of inputs){
  if(!Array.isArray(input)||input.length!==2||!input.every(Number.isFinite)||input[0]<d.startMs||input[0]>d.endMs||input[1]>input[0]){issues.push('invalid input timestamp');continue;}
  const f=eligible.find(f=>f.now>=input[0]);
  if(!f||!Number.isFinite(f.done)){issues.push('captured input has no completed following frame');continue;}
  const lag=f.done-input[1];if(lag<0||!Number.isFinite(lag))issues.push('invalid input-to-frame latency');else lags.push(lag);
 }
 const iv=window.intervals.filter(i=>i.gapMs>0).map(i=>i.gapMs);
 return {valid:!issues.length,issues,inputs:inputs.length,sent:d.sent,frames:eligible.length,p95:window.p95Ms,max:window.maxMs,over50:iv.filter(x=>x>50).length,lagP50:pct(lags,.5),lagP95:pct(lags,.95),window,
 semantics:'rAF heartbeat including window boundaries and event-to-following-frame task completion; not physical presentation'};
}
export function darkTimingProblems(row){
 const issues=[...(row?.issues||[])];
 if(!row?.valid)issues.push('timing evidence is incomplete');
 if(!Number.isFinite(row?.p95)||row.p95>=25)issues.push('frame p95 must be <25 ms');
 if(!Number.isFinite(row?.max)||row.max>50||row.over50!==0)issues.push('no frame may exceed 50 ms');
 if(!Number.isFinite(row?.lagP95)||row.lagP95>36)issues.push('input-to-frame p95 must be <=36 ms');
 return issues;
}
export function darkLeakProblems(grew){
 const issues=[];
 for(const k of ['nodes','listeners','documents'])if(!Number.isFinite(grew?.[k]))issues.push('missing '+k+' growth counter');
 if(grew?.nodes>50)issues.push('DOM nodes grew more than the original absolute allowance of 50');
 if(grew?.listeners>0)issues.push('event listeners grew');
 if(grew?.documents!==0)issues.push('document count changed');
 return issues;
}
export function darkCompositeEvidence(events,expectedNames=[]){
 const ours=n=>/^(hw-|fly|flap|bird-bob|bird-bound|scurry|bee-)/.test(n||'');
 const rows=Array.isArray(events)?events:[],relevant=rows.filter(e=>e.name==='Animation'&&ours(e.args?.data?.name));
 const expected=[...new Set(expectedNames.filter(ours))],owner=rows.filter(e=>e.name==='hw-dark-compositor-owner'&&Number.isFinite(e.ts)&&Number.isInteger(e.pid)&&Number.isInteger(e.tid));
 const issues=[];if(!expected.length)issues.push('missing running animation-name roster');
 if(owner.length!==1||!rows.some(e=>e.ph==='M'&&e.name==='thread_name'&&e.pid===owner[0]?.pid&&e.tid===owner[0]?.tid&&e.args?.name==='CrRendererMain'))issues.push('missing renderer trace-owner provenance');
 if(!relevant.length)issues.push('missing named animation observations');
 if(relevant.some(e=>!Number.isFinite(e.ts)||e.ts<=0||!Number.isInteger(e.tid)||!['b','e','n','X','I','i'].includes(e.ph)||e.pid!==owner[0]?.pid))issues.push('invalid or foreign animation observations');
 const observed=new Set(relevant.map(e=>e.args.data.name)),missing=expected.filter(n=>!observed.has(n));if(missing.length)issues.push('running animation names absent from trace');
 const failed=[...new Set(relevant.filter(e=>e.args.data.compositeFailed).map(e=>e.args.data.name))];if(failed.length)issues.push('explicit composite failures');
 return {observed:relevant.length,expectedNames:expected,missing,failed,issues,valid:!issues.length,semantics:'Observed running animation-name coverage and explicit compositor-failure records; not per-instance or physical-presentation proof'};
}
