import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhoneJourneyScope} from '../tools/phone-target-admission.mjs';

function setup(){
 const alive=[],events=[],deadlines=[],report={failures:[]};
 const runtime={async deadline(label,fn,options){deadlines.push({label,...options});return fn();}};
 const scope=createPhoneJourneyScope({browser:{contexts:()=>[...alive]},runtime,report});
 function context(name,{reject=false,syncThrow=false,tracked=true}={}){let closed=false;const ctx={async close(){if(closed)return;events.push('close '+name);if(reject)throw Error('cannot close '+name);closed=true;alive.splice(alive.indexOf(ctx),1);}};if(syncThrow)ctx.close=()=>{events.push('close '+name);throw Error('synchronous close failure '+name);};alive.push(ctx);if(tracked)scope.captureContext(ctx);return ctx;}
 return {alive,events,deadlines,report,scope,context};
}

test('a thrown journey closes all its tracked and failed-construction contexts before the next body',async()=>{
 const f=setup();await f.scope.block('frames',async()=>{f.events.push('frames body');f.context('normal');f.context('newPage failed',{tracked:false});throw Error('gesture failed');});
 await f.scope.block('next',async()=>{assert.equal(f.alive.length,0);f.events.push('next body');});
 assert.deepEqual(f.events,['frames body','close normal','close newPage failed','next body']);assert(f.report.failures.includes('frames crashed: gesture failed'));assert.equal(f.report.journeyCleanup[0].contexts,2);assert(f.deadlines.every(row=>row.cleanup===true&&row.timeoutMs>0&&row.timeoutMs<=8000));
});
test('a context already closed by a successful tail remains safe in finally',async()=>{
 const f=setup();await f.scope.block('arrival',async()=>{const ctx=f.context('arrival');await ctx.close();});
 assert.deepEqual(f.events,['close arrival']);assert.equal(f.alive.length,0);assert.deepEqual(f.report.failures,[]);assert.deepEqual(f.report.journeyCleanup[0].errors,[]);
});
test('cleanup failure prevents any following journey allocation or body',async()=>{
 const f=setup();await f.scope.block('fling',async()=>{f.context('fling',{reject:true});f.context('still must close');});let ran=false;
 await f.scope.block('later frames',async()=>{ran=true;f.context('unexpected');});
 assert.equal(ran,false);assert.equal(f.scope.cleanupUnsafe,true);assert(f.report.failures.some(row=>row.includes('cleanup failed')));assert(f.report.failures.includes('later frames not run: prior journey cleanup failed'));assert.deepEqual(f.report.notExecutedJourneys,[{name:'later frames',reason:'prior journey cleanup failed'}]);
 assert.deepEqual(f.events,['close fling','close still must close']);
});
test('page and console errors cannot pass a focused frame or fling scope',async()=>{
 const f=setup();
 for(const name of ['frames','fling'])await f.scope.block(name,async()=>{const ctx=f.context(name),journey=f.scope.captureContext(ctx);f.scope.noteBrowserError({journey,kind:'pageerror',message:'renderer crashed',url:'http://127.0.0.1/phone'});f.scope.noteBrowserError({journey,kind:'console.error',message:'failed paint',url:'http://127.0.0.1/phone'});});
 assert.equal(f.report.browserErrors.length,4);assert.equal(f.report.failures.length,4);assert.equal(f.alive.length,0);assert(f.report.failures.some(row=>row.startsWith('frames pageerror')));assert(f.report.failures.some(row=>row.startsWith('fling console.error')));
});
test('one synchronous close throw still initiates sibling closure and blocks the next journey',async()=>{
 const f=setup();await f.scope.block('fling',async()=>{f.context('sync throw',{syncThrow:true});f.context('sibling');});let ran=false;
 await f.scope.block('frames after failed close',async()=>{ran=true;});
 assert.equal(ran,false);assert.equal(f.scope.cleanupUnsafe,true);assert.deepEqual(f.events,['close sync throw','close sibling']);assert.equal(f.alive.length,1);assert.deepEqual(f.report.journeyCleanup[0].errors,['synchronous close failure sync throw']);assert.deepEqual(f.report.notExecutedJourneys,[{name:'frames after failed close',reason:'prior journey cleanup failed'}]);
});
