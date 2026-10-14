import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../source/js/live-photos.js',import.meta.url),'utf8');
const PHOTO='https://heartwood.org/heartbeat/Fall-2026.jpg';
function fixture({fail=false,hang=false,body=null,observe=false,maxImageLoads=Infinity}={}) {
  let time=1,version=1,imageFailure=false,imageErrors=0,imageLoads=0;let observerCallback; let stopLoop=()=>{}; const calls=[],pending=new Set(),listeners=new Map(); let bodySeam=null;
  class Image {
    constructor(){this.attributes=[];this.dataset={};this.isConnected=false;this.complete=true;this.naturalWidth=10;if(bodySeam)bodySeam.events.push('image:new');}
    set src(url){this.url=url;queueMicrotask(()=>{this.version=version;if(url.startsWith('https:')&&++imageLoads>=maxImageLoads)stopLoop();if(imageFailure&&url.startsWith('https:')){imageErrors++;this.onerror?.();if(imageErrors===2)stopLoop();}else this.onload?.();});}
    get src(){return this.url;}
    decode(){return Promise.resolve();}
    setAttribute(name,value){this.attributes=this.attributes.filter(x=>x.name!==name);this.attributes.push({name,value});if(name==='data-live-photo')this.dataset.livePhoto=value;}
    getAttribute(name){return this.attributes.find(x=>x.name===name)?.value??null;}
    closest(){return this.picture||null;}
    replaceWith(next){this.isConnected=false;next.isConnected=true;next.picture=this.picture;if(this.picture)this.picture.current=next;this.replacement=next;}
    getClientRects(){return this.isConnected?[{}]:[];}
  }
  const win={Image,location:{href:'http://127.0.0.1:8080/'},setTimeout:(f,ms)=>{const t=setTimeout(f,ms);pending.add(t);return t;},clearTimeout:t=>{pending.delete(t);clearTimeout(t);},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);},fetch:async(url,opts)=>{calls.push({url,...opts});if(hang)return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));if(fail)throw Error('offline');if(body){const events=[];let sink;const stream=new ReadableStream({start(c){sink=c},pull(){events.push('pull')}});bodySeam={events,release:0};if(body==='streamed'){queueMicrotask(()=>{sink.enqueue(new Uint8Array(65536).fill(7));events.push('chunk:0');sink.enqueue(new Uint8Array(65536).fill(9));events.push('chunk:1');sink.close();events.push('closed');});}opts.signal.addEventListener('abort',()=>{events.push('abort');try{sink.error(opts.signal.reason??Error('stopped'))}catch{}},{once:true});return {type:'basic',status:200,body:{getReader:()=>{const reader=stream.getReader();return {read:async()=>{events.push('read');try{const value=await reader.read();events.push(value.done?'read:done':'read:chunk');return value}catch(error){events.push('read:error');throw error}},releaseLock:()=>{bodySeam.release++;events.push('release');reader.releaseLock()}}}}};}return {type:'opaque',status:0};}};
  if(observe)win.IntersectionObserver=class{constructor(fn){observerCallback=fn;}observe(){}unobserve(){}disconnect(){}};
  const doc={hidden:false,addEventListener:win.addEventListener,removeEventListener:win.removeEventListener};win.document=doc;
  const scope=vm.createContext({window:win,AbortController,URL,Date,Promise,Set,Map,WeakMap});vm.runInContext(source,scope);
  const controller=scope.HeartwoodPhotos.create({window:win,now:()=>time,timeoutMs:25});stopLoop=()=>controller.close();
  const img=()=>{const el=new Image();el.isConnected=true;el.src='local.webp';el.setAttribute('data-live-photo',PHOTO);el.setAttribute('class','cover');el.setAttribute('alt','Current issue');el.setAttribute('srcset','local.webp 320w');el.picture={sources:[{remove(){this.removed=true;}}],querySelectorAll(){return this.sources;},current:el};return el;};
  const watch=(...images)=>controller.watch({querySelectorAll:()=>images});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {controller,calls,pending,listeners,img,watch,settle,advance:n=>time+=n,change:()=>version++,failImages:()=>imageFailure=true,imageErrors:()=>imageErrors,doc,event:n=>listeners.get(n)?.(),intersection:(el,on)=>observerCallback([{target:el,isIntersecting:on}]),seam:()=>bodySeam};
}
test('100 concurrent watches coalesce one conditional GET and remove picture source overrides only after readiness',async()=>{
  const f=fixture(),a=f.img(),b=f.img();try{for(let i=0;i<100;i++)f.watch(a,b);await f.settle();assert.equal(f.calls.length,1);assert.equal(f.calls[0].cache,'no-cache');assert.equal(f.calls[0].mode,'no-cors');assert.equal(f.calls[0].credentials,'include');assert.equal(f.calls[0].redirect,'follow');assert.equal(a.replacement.src,PHOTO);assert.equal(a.replacement.getAttribute('class'),'cover');assert.equal(a.replacement.getAttribute('alt'),'Current issue');assert.equal(a.replacement.getAttribute('srcset'),null);assert.equal(a.picture.sources[0].removed,true);}finally{f.controller.close();}assert.equal(f.pending.size,0);
});
test('offline and timed-out attempts preserve the local image and do not become rapid retry loops',async()=>{
  for(const opts of [{fail:true},{hang:true}]){const f=fixture(opts),a=f.img();try{f.watch(a);await new Promise(r=>setTimeout(r,40));assert.equal(a.replacement,undefined);assert.equal(a.picture.sources[0].removed,undefined);for(let i=0;i<100;i++)f.watch(a);await f.settle();assert.equal(f.calls.length,1);}finally{f.controller.close();}assert.equal(f.pending.size,0);}
});
test('a changed source can replace the current native image after the interval, preserving metadata',async()=>{
  const f=fixture(),a=f.img();try{f.watch(a);await f.settle();const before=a.replacement;f.change();f.advance(6*60*60*1000+1);f.watch(before);await f.settle();assert.equal(f.calls.length,2);assert.equal(before.replacement.version,2);assert.equal(before.replacement.getAttribute('alt'),'Current issue');}finally{f.controller.close();}
});
test('closed/disconnected targets cannot receive a late update and close releases timers/listeners',async()=>{
  const f=fixture({hang:true}),a=f.img();f.watch(a);a.isConnected=false;f.controller.close();await f.settle();assert.equal(a.replacement,undefined);assert.equal(f.pending.size,0);assert.equal(f.listeners.size,0);f.watch(a);assert.equal(f.calls.length,1);
});
test('unknown external origins are never acquired and loopback fixture resolution stays explicit',async()=>{
  const f=fixture(),a=f.img();a.setAttribute('data-live-photo','https://unrelated.example/a.jpg');try{f.watch(a);await f.settle();assert.equal(f.calls.length,0);}finally{f.controller.close();}
});

test('a failed native cache reuse consumes cooldown instead of automatically retrying',async()=>{
  const f=fixture(),a=f.img();try{f.watch(a);await f.settle();assert(a.replacement);f.advance(2*60*60*1000);f.failImages();const detail=f.img();f.watch(detail);await f.settle();assert.equal(f.imageErrors(),1,'Second native error closes this bounded control: it proves an unwanted automatic retry');assert.equal(detail.replacement,undefined);for(let i=0;i<100;i++)f.watch(detail);await f.settle();assert.equal(f.imageErrors(),1);assert.equal(f.calls.length,1);}finally{f.controller.close();}assert.equal(f.pending.size,0);
});

test('canonical host casing does not prevent installation or create a successful-load retry loop',async()=>{
  const f=fixture({maxImageLoads:8}),a=f.img();a.setAttribute('data-live-photo','https://HEARTWOOD.ORG/heartbeat/Fall-2026.jpg');try{f.watch(a);await f.settle();const installed=!!a.replacement;f.controller.close();assert(installed,'The normalized URL must still install into its original target');assert.equal(f.calls.length,1);}finally{f.controller.close();}
});

test('pageshow and focus cannot acquire a target that never intersected the viewport',async()=>{
  const f=fixture({observe:true}),a=f.img();try{f.watch(a);f.event('pageshow');f.event('visibilitychange');await f.settle();assert.equal(f.calls.length,0);f.intersection(a,true);await f.settle();assert.equal(f.calls.length,1);assert(a.replacement);}finally{f.controller.close();}
});
test('an exposed readable warm body is streamed to completion before the native image is created',async()=>{
  const f=fixture({body:'streamed'}),a=f.img();try{f.watch(a);await f.settle();const seam=f.seam();assert(seam,'the readable-body seam must have been exercised');assert.equal(f.calls.length,1);assert.equal(a.replacement.src,PHOTO,'the warm body still installs the native image');const events=seam.events;const born=events.indexOf('image:new');assert(born>0,'the native image must be created only after the body work');assert(events.slice(0,born).includes('read:done'),'the stream must be fully read (done) before native allocation');assert.equal(events.filter(x=>x==='read:chunk').length,2,'chunks are streamed one at a time, never buffered whole');assert(events.indexOf('release')<born,'the reader lock is released before native allocation');assert.equal(seam.release,1);}finally{f.controller.close();}assert.equal(f.pending.size,0);
});
test('a stalled readable body under the attempt timeout preserves the fallback, consumes cooldown and releases the reader',async()=>{
  const f=fixture({body:'stalled'}),a=f.img();try{f.watch(a);await new Promise(r=>setTimeout(r,60));const seam=f.seam();assert(seam,'the readable-body seam must have been exercised');assert.equal(a.replacement,undefined,'a stalled readable body must never install');assert.equal(f.calls.length,1);const events=seam.events;assert(events.includes('abort'),'the attempt deadline aborts the fetch signal');assert(events.includes('read:error'),'the pending body read ends under the abort');assert.equal(events.includes('image:new'),false,'no native image is created for a stalled body');assert.equal(seam.release,1,'the reader lock is released on the error path');for(let i=0;i<100;i++)f.watch(a);await f.settle();assert.equal(f.calls.length,1,'the failure consumes the cooldown instead of retrying');}finally{f.controller.close();}assert.equal(f.pending.size,0);assert.equal(f.listeners.size,0);
});
