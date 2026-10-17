import {parseToolArgs,showToolHelp} from './tool-cli.mjs';
showToolHelp(parseToolArgs(),'Usage: node tools/test-scheduled-layout.mjs (historical inputs via HW_SCHEDULED_LAYOUT_SOURCE / HW_MEDIA_RECOVERY_SOURCE)');
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const sourcePath=process.env.HW_SCHEDULED_LAYOUT_SOURCE||resolve(import.meta.dirname,'../source/scheduled-layout.js');
let source;
try{source=await readFile(sourcePath,'utf8');}
catch(error){console.error('UNSUPPORTED: the historical source/scheduled-layout.js input is not present in this checkout ('+error.code+': '+sourcePath+'); supply an explicit legacy copy via HW_SCHEDULED_LAYOUT_SOURCE (see docs/TESTING.md).');process.exit(64);}
function harness() {
  const frames=new Map(),events=new Map(),documentEvents=new Map(),windowEvents=new Map(),cleared=[];
  let nextFrame=0;
  const bounds=[{top:10,bottom:120},{top:130,bottom:240},{top:900,bottom:1000},{top:1100,bottom:1200}];
  const strata=bounds.map((r,index)=>({index,getBoundingClientRect:()=>r}));
  const rect={left:0,right:20,top:0,bottom:20};
  const text={getBoundingClientRect:()=>rect};
  const bits=strata.map(st=>({getBoundingClientRect:()=>rect,classList:{toggle(name,value){assert.equal(name,'is-cleared');assert.equal(value,true);cleared.push(st.index);}}}));
  const doc={hidden:false,documentElement:{clientHeight:600},querySelectorAll(){return [];},addEventListener(name,fn,capture){events.set(name,fn);documentEvents.set(name,{fn,capture});}};
  const window={addEventListener(name,fn,capture){events.set(name,fn);windowEvents.set(name,{fn,capture});}};
  const $$=(selector,st)=>{
    if(selector==='.deep .stratum')return strata;
    if(selector==='.layer')return [];
    if(selector==='[data-type], .layer__head > *, .horizon, .more, .foot')return [text];
    if(selector==='.stones > i')return [bits[st.index]];
    throw Error('Unexpected selector '+selector);
  };
  const context={document:doc,window,$$,innerHeight:600,net:{getBoundingClientRect:()=>({top:3000,bottom:3300})},requestAnimationFrame(fn){frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame(id){frames.delete(id);},HTMLImageElement:class{},api:null};
  vm.runInNewContext(source+'\napi={clearType,scheduleLayout};',context,{timeout:1000});
  const step=()=>{const first=frames.entries().next().value;assert(first,'Expected a scheduled frame');frames.delete(first[0]);first[1]();};
  return {frames,events,documentEvents,windowEvents,cleared,step,api:context.api,context};
}
const ordinary=harness();
ordinary.step(); // Initial observer setup yields once before geometry.
ordinary.step(); // One batch: both visible strata plus only one offscreen.
assert.deepEqual(ordinary.cleared,[0,1,2]);
assert.equal(ordinary.frames.size,1,'Remaining offscreen work should have one pending frame');
ordinary.step();
assert.deepEqual(ordinary.cleared,[0,1,2,3]);
assert.equal(ordinary.frames.size,0,'No redundant empty frame should remain');

const print=harness();
print.step();
assert.equal(print.frames.size,1);
print.events.get('beforeprint')();
assert.equal(print.frames.size,0,'Synchronous print flush must cancel the pending frame');
assert.deepEqual(print.cleared,[0,1,2,3],'Printing must prepare all strata');
print.events.get('afterprint')();
assert.equal(print.frames.size,1,'Restoring normal layout should schedule exactly once');
const recoveryPath=process.env.HW_MEDIA_RECOVERY_SOURCE||resolve(import.meta.dirname,'../source/media-recovery.js');
let recovery;
try{recovery=await readFile(recoveryPath,'utf8');}
catch(error){console.error('UNSUPPORTED: the historical source/media-recovery.js input is not present in this checkout ('+error.code+': '+recoveryPath+'); supply an explicit legacy copy via HW_MEDIA_RECOVERY_SOURCE (see docs/TESTING.md).');process.exit(64);}
const failedImage=harness();
while(failedImage.frames.size)failedImage.step();
const before=failedImage.cleared.length;
vm.runInNewContext(recovery,failedImage.context,{timeout:1000});
let connected=true;
const figure={remove(){connected=false;}};
const img=new failedImage.context.HTMLImageElement();
img.complete=true;
img.naturalWidth=0;
img.closest=selector=>selector==='picture'?null:selector==='.deep'?(connected?{}:null):figure;
img.dataset={};
const event={target:img};
assert.equal(failedImage.windowEvents.get('error')?.capture,true,'Image error invalidation must run in window capture phase');
failedImage.windowEvents.get('error').fn(event);
failedImage.documentEvents.get('error').fn(event);
assert.equal(connected,false,'Real media recovery should remove the failed figure');
assert.equal(failedImage.frames.size,1,'Removing the figure must still invalidate collision geometry');
failedImage.step();
assert(failedImage.cleared.length>before,'Stale prepared strata must be recalculated after figure removal');

const busy=harness();
busy.context.window.leafLift={busy:()=>true};
while(busy.frames.size)busy.step();
assert.equal(busy.cleared.length,0,'Background geometry must yield while a leaf is active');
busy.context.window.leafLift.busy=()=>false;
busy.documentEvents.get('leaf:close').fn();
busy.step();
assert(busy.cleared.length>0,'Closing the leaf must resume deferred geometry');
console.log(JSON.stringify({allVisibleStrataPreparedBeforePaint:true,offscreenWorkBounded:true,noRedundantFrames:true,printCancelsPendingFrame:true,printPreparesAllStrata:true,failedFigureRemovalInvalidatesGeometry:true,leafCloseResumesDeferredWork:true}));
