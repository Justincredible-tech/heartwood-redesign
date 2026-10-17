/** Pure input and reversible timing for temporary modal diagnostics; no browser acquisition. */
export function validateInteractionOptions(o,devices){
 if(typeof o.route!=='string'||!o.route.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)))throw Error('--route must name a local site route');
 if(!devices[o.device])throw Error('Unknown --device '+o.device);
 const cpu=Number(o.cpu);if(typeof o.cpu!=='string'||!o.cpu.trim()||!Number.isFinite(cpu)||cpu<1||cpu>20)throw Error('--cpu must be finite in1..20');
 const integer=k=>{const n=Number(o[k]);if(typeof o[k]!=='string'||!o[k].trim()||!Number.isSafeInteger(n)||n<0)throw Error('--'+k+' must be a nonnegative safe integer');return n;};
 const repeat=o.repeat===undefined?undefined:integer('repeat');if(repeat!==undefined&&(repeat<1||repeat>50))throw Error('--repeat must be in1..50');
 const leaf=o.leaf===undefined?undefined:integer('leaf');if(o.phase!==undefined&&!['open','close'].includes(o.phase))throw Error('--phase open|close');
 for(const key of ['css','only'])if(o[key]!==undefined&&(typeof o[key]!=='string'||!o[key].trim()))throw Error('--'+key+' must be nonempty');return{cpu,repeat,leaf};
}
/** Serializable into only the owned test page. Snapshot outside measured interval, restore every state even after errors. */
export async function reversibleDomSample(apply,{elements=[],attributes=[],restoreFocus=false,flush=()=>getComputedStyle(document.body).color,frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,30))),clock=()=>performance.now(),doc=document}={}){
 const before=[...new Set(elements)].map(el=>({el,attrs:attributes.map(key=>[key,el.getAttribute(key)])})),focus=restoreFocus?doc.activeElement:null,errors=[];let duration;
 try{await frame();const t=clock();apply();flush();duration=clock()-t;if(!Number.isFinite(duration)||duration<0)throw Error('Invalid measured DOM sample');}catch(e){errors.push(e);}
 for(const {el,attrs}of before)for(const[key,value]of attrs)try{if(el.getAttribute(key)!==value){if(value===null)el.removeAttribute(key);else el.setAttribute(key,value);}}catch(e){errors.push(e);}
 if(restoreFocus&&focus&&doc.activeElement!==focus)try{if(focus.isConnected===false)throw Error('Original focus target was removed');focus.focus({preventScroll:true});if(doc.activeElement!==focus)throw Error('Cannot restore original focus');}catch(e){errors.push(e);}
 try{flush();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Sample or restore failed');return duration;
}

export function requireStyleTrace(events){
 if(!Array.isArray(events)||!events.length)throw Error('UNSUPPORTED: empty style trace');const threads={};for(const e of events)if(e?.ph==='M'&&e.name==='thread_name')threads[e.pid+':'+e.tid]=e.args?.name;
 const main=events.filter(e=>threads[e?.pid+':'+e?.tid]==='CrRendererMain'&&e.ph==='X'&&e.dur).sort((a,b)=>a.ts-b.ts);
 if(!main.length||main.some(e=>!Number.isFinite(e.ts)||!Number.isFinite(e.dur)||e.dur<=0))throw Error('UNSUPPORTED: no finite main-thread trace evidence');
 const tasks=main.filter(e=>e.name==='ThreadControllerImpl::RunTask'&&e.dur>15000);return{main,tasks,t0:tasks[0]?.ts??main[0].ts};
}
