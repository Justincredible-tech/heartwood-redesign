import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fc} from './property-lib.mjs';
const source=await readFile(new URL('../source/mobile/app.js',import.meta.url),'utf8');
const start=source.indexOf("const sheet = $('#sheet'), body = $('#sheet-body'), main = $('main');"),end=source.indexOf('// ------------------------------------------------------------------ member search');assert(start>=0&&end>start,'extract exact actual detail-sheet block');
const block=source.slice(start,end);
function fixture({deep=false,calm=false}={}){
 const events=[],listeners={},timers=new Map();let nextTimer=1,index=0,backCalls=0,replaceCalls=0,pushCalls=0,focusCalls=0,pendingBack=false,pendingIndex=0,renderCalls=0;
 const entries=[{url:'/phone/?open=work&q=sierra'+(deep?'#leaf-first':''),state:null}],location={};
 const sync=()=>{const u=new URL(entries[index].url,'http://127.0.0.1');Object.assign(location,{pathname:u.pathname,search:u.search,hash:u.hash});};sync();
 const classes=new Set(),sheet={hidden:true,classList:{contains:c=>classes.has(c),add:c=>{events.push('add:'+c);classes.add(c);},remove:c=>{events.push('remove:'+c);classes.delete(c);}},querySelector:()=>({scrollTop:0}),addEventListener:(name,fn)=>listeners['sheet:'+name]=fn};
 const body={innerHTML:'',textContent:'initial',focus:()=>events.push('sheet-focus')},main={inert:false},top={inert:false},opener={isConnected:true,focus:()=>{focusCalls++;events.push('opener-focus');}};
 const history={get state(){return entries[index].state;},pushState:(state,_,url)=>{pushCalls++;entries.splice(index+1);entries.push({url,state});index++;sync();},replaceState:(state,_,url)=>{replaceCalls++;events.push('replace');entries[index]={url,state};sync();},back:()=>{backCalls++;events.push('back');assert(!classes.has('is-open'),'sheet must start closing before asynchronous history.back');assert.equal(main.inert,false,'main navigation released before history dispatch');assert.equal(top.inert,false,'header navigation released before history dispatch');pendingBack=true;pendingIndex=Math.max(0,index-1);}};
 const records=new Map(['first','second'].map(id=>[id,{id,title:id}]));
 const context={document:{activeElement:opener,querySelector:()=>null},history,location,calm,opener,$:selector=>({'#sheet':sheet,'#sheet-body':body,main,'.top':top})[selector],data:()=>({byId:records,kinds:{},pics:{}}),renderRecord:r=>{renderCalls++;return '<p>'+r.title+'</p>';},livePhotos:{watch(){}},addEventListener:(name,fn)=>listeners[name]=fn,openCats(){},CATS:[],parseState:(_search,hash)=>({leaf:hash.startsWith('#leaf-')?hash.slice(6):null}),setTimeout:(fn,ms)=>{const id=nextTimer++;events.push('timer:'+ms);timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(block+'\napi={show,hide,close};',context,{timeout:1000});
 return {api:context.api,sheet,body,main,top,classes,events,opener,history,location,timers,renders:()=>renderCalls,counts:()=>({backCalls,replaceCalls,pushCalls,focusCalls}),nativeBack:()=>{backCalls++;pendingBack=true;pendingIndex=Math.max(0,index-1);events.push('native-back');},flushBack:()=>{assert(pendingBack);pendingBack=false;index=pendingIndex;sync();listeners.popstate();},forward:()=>{assert(index<entries.length-1);index++;sync();listeners.popstate();},fireTimer:id=>{const timer=timers.get(id);if(timer){timers.delete(id);timer.fn();}}};
}
test('pushed close starts visible tuck and releases navigation before Back; duplicate close/popstate cannot restart it',()=>{
 const r=fixture();r.api.show('first',true,r.opener);r.events.length=0;r.api.close();
 assert.deepEqual(r.counts(),{backCalls:1,replaceCalls:0,pushCalls:1,focusCalls:1});assert.deepEqual(r.events,['remove:is-open','timer:280','opener-focus','back']);assert.equal(r.sheet.hidden,false,'paper remains mounted for the original tuck');assert.equal(r.timers.size,1);
 const [timer]=r.timers.keys();r.api.close();assert.equal(r.counts().backCalls,1);assert.equal(r.counts().replaceCalls,0);assert.equal(r.counts().focusCalls,1);assert.deepEqual([...r.timers.keys()],[timer]);
 r.flushBack();assert.equal(r.location.hash,'');assert.equal(r.counts().focusCalls,1);assert.deepEqual([...r.timers.keys()],[timer],'popstate cannot postpone tuck by replacing its timer');r.fireTimer(timer);assert.equal(r.sheet.hidden,true);assert.equal(r.body.textContent,'');
 r.forward();assert.equal(r.location.hash,'#leaf-first');assert.equal(r.sheet.hidden,false);assert(r.classes.has('is-open'));assert.equal(r.main.inert,true);assert.equal(r.top.inert,true);assert.equal(r.counts().pushCalls,1,'Forward must not push another entry');
});
test('unpushed deep-link close preserves category/search URL and performs no Back',()=>{
 const r=fixture({deep:true});r.api.show('first',false,r.opener);r.events.length=0;r.api.close();assert.deepEqual(r.counts(),{backCalls:0,replaceCalls:1,pushCalls:0,focusCalls:1});assert.equal(r.location.pathname+r.location.search+r.location.hash,'/phone/?open=work&q=sierra');assert.deepEqual(r.events,['remove:is-open','timer:280','opener-focus','replace']);
});
test('native Back still uses popstate hide and the same visual tuck; Forward cancels a still-pending hide',()=>{
 const r=fixture();r.api.show('first',true,r.opener);
 // Native browser Back does not call close(); exercise the actual registered popstate callback directly.
 r.nativeBack();r.flushBack();assert(!r.classes.has('is-open'));assert.equal(r.main.inert,false);assert.equal(r.top.inert,false);assert.deepEqual(r.counts(),{backCalls:1,replaceCalls:0,pushCalls:1,focusCalls:1});const [timer]=r.timers.keys();assert.equal(r.timers.get(timer).ms,280);r.forward();assert.equal(r.timers.size,0);r.fireTimer(timer);assert.equal(r.sheet.hidden,false);assert(r.classes.has('is-open'));assert.equal(r.location.hash,'#leaf-first');
});
test('calm preference retains the existing zero-delay closure rather than changing animation policy',()=>{
 const r=fixture({calm:true});r.api.show('first',true,r.opener);r.api.close();assert([...r.timers.values()].every(t=>t.ms===0));assert.equal(r.timers.size,1);
});
test('immediate different-record open survives the pending asynchronous Back with no delayed hide or second render',()=>{
 const r=fixture();r.api.show('first',true,r.opener);r.api.close();const [staleTimer]=r.timers.keys();r.api.show('second',true,r.opener);
 assert.equal(r.location.hash,'#leaf-second','visible record and route agree immediately');assert(r.classes.has('is-open'));assert.equal(r.body.innerHTML,'<p>second</p>');r.flushBack();
 assert.equal(r.location.hash,'#leaf-second');assert.equal(r.history.state.hwLeaf,'second');assert(r.classes.has('is-open'));assert.equal(r.main.inert,true);assert.equal(r.top.inert,true);assert.equal(r.timers.size,0);assert.equal(r.renders(),2,'traversal must not rerender already visible paper');r.fireTimer(staleTimer);assert.equal(r.sheet.hidden,false);
 r.api.close();r.flushBack();assert.equal(r.location.hash,'');r.forward();assert.equal(r.location.hash,'#leaf-second');assert(r.classes.has('is-open'));
});
test('closing the queued new record cancels it without a duplicate Back or a stale reopen',()=>{
 const r=fixture();r.api.show('first',true,r.opener);r.api.close();r.api.show('second',true,r.opener);r.api.close();r.api.close();assert.equal(r.counts().backCalls,1);r.flushBack();assert.equal(r.location.hash,'');assert(!r.classes.has('is-open'));assert.equal(r.main.inert,false);assert.equal(r.top.inert,false);
 r.forward();assert.equal(r.location.hash,'');assert.equal(r.history.state,null,'cancelled queued entry cannot retain a stale sheet ownership marker');assert(!r.classes.has('is-open'));
});
test('latest of multiple immediate opens owns one new entry after Back resolves',()=>{
 const r=fixture();r.api.show('first',true,r.opener);r.api.close();r.api.show('second',true,r.opener);r.api.show('first',true,r.opener);r.flushBack();assert.equal(r.location.hash,'#leaf-first');assert.equal(r.history.state.hwLeaf,'first');assert(r.classes.has('is-open'));assert.equal(r.counts().pushCalls,2,'first entry plus exactly one queued final entry');assert.equal(r.body.innerHTML,'<p>first</p>');
});
test('bounded fast-check queued opens/closures preserve latest visible route and avoid a redundant render',()=>{
 fc.assert(fc.property(fc.array(fc.constantFrom('first','second','close'),{minLength:1,maxLength:8}),fc.boolean(),(actions,calm)=>{
  const r=fixture({calm});r.api.show('first',true,r.opener);r.api.close();let expected=null;
  for(const action of actions){if(action==='close'){r.api.close();expected=null;}else{r.api.show(action,true,r.opener);expected=action;}}
  const renders=r.renders();r.flushBack();assert.equal(r.renders(),renders);assert.equal(r.counts().backCalls,1);
  assert.equal(r.location.hash,expected?'#leaf-'+expected:'');assert.equal(r.main.inert,!!expected);assert.equal(r.top.inert,!!expected);assert.equal(r.classes.has('is-open'),!!expected);
  if(expected){assert.equal(r.history.state.hwLeaf,expected);assert.equal(r.body.innerHTML,'<p>'+expected+'</p>');assert.equal(r.timers.size,0);}else assert.equal(r.location.search,'?open=work&q=sierra');
 }),{numRuns:200,seed:1301026});
});
