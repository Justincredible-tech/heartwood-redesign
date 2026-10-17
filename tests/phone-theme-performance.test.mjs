import test from 'node:test';
import assert from 'node:assert/strict';
import {fc} from './property-lib.mjs';
import {mobileThemes,mobilePerformancePlan,mobileSelection,mobileThemeSelection,phoneLagCoverage} from '../tools/mobile-acceptance.mjs';
test('phone timing defaults to separate complete Day and Night plans; bad flags fail before allocation',()=>{
 assert.deepEqual(mobileThemes(),['day','night']);assert.equal(mobilePerformancePlan().length,6);
 assert.deepEqual(mobilePerformancePlan({quick:true,theme:'night'}),[{theme:'night',kind:'xs',rate:4,name:'night frames xs x4'}]);
 for(const theme of ['',null,'dark','night,day'])assert.throws(()=>mobileThemes(theme));
 assert.deepEqual(mobileSelection('night frames xs x4'),['night frames xs x4']);assert.throws(()=>mobileSelection('night frames xs x6',{quick:true}));
 assert.deepEqual(mobileThemeSelection('frames,fling'),['frames','night frames','fling','night fling']);assert.deepEqual(mobileThemeSelection('frames',{theme:'night'}),['night frames']);assert.throws(()=>mobileThemeSelection('night fling',{theme:'day'}));
});
test('missing required timing metrics never gain acceptance across generated omission cases',()=>{
 const names=['night frames xs x4','night frames xs x6','night frames p402 x4','night fling'];
 const checks=names.flatMap(journey=>(journey.endsWith('fling')?['painted','frame','slow4g']:['frame','burst']).map(performanceMetric=>({journey,performanceMetric,performanceTheme:'night',pass:true})));
 fc.assert(fc.property(fc.integer({min:0,max:checks.length-1}),omit=>assert.equal(phoneLagCoverage({theme:'night',executed:names,checks:checks.filter((_,i)=>i!==omit)}).status,'INCOMPLETE_OR_FAIL')),{seed:131026,numRuns:36});
});
test('Night coverage cannot pass on appearance, only Day timing, a skipped fling or a crash',()=>{
 assert.equal(phoneLagCoverage({theme:'night',executed:['night and reduced motion']}).status,'NOT_RUN');
 assert.equal(phoneLagCoverage({theme:'night',executed:['frames xs x4','fling']}).status,'NOT_RUN');
 const names=['night frames xs x4','night frames xs x6','night frames p402 x4','night fling'];
 const checks=names.flatMap(journey=>(journey.endsWith('fling')?['painted','frame','slow4g']:['frame','burst']).map(performanceMetric=>({journey,performanceMetric,performanceTheme:'night',pass:true})));
 assert.equal(phoneLagCoverage({theme:'night',executed:names,checks}).status,'PASS');
 for(const args of [{executed:names.slice(0,-1),checks},{executed:names,checks:checks.slice(0,-1)},{executed:names,checks:checks.map((c,i)=>({...c,pass:i!==0}))},{executed:names,checks,failures:['crashed']},{executed:names,checks,browserErrors:[{kind:'pageerror'}]}])assert.equal(phoneLagCoverage({...args,theme:'night'}).status,'INCOMPLETE_OR_FAIL');
 assert.equal(phoneLagCoverage({theme:'night',executed:names,checks:checks.concat(checks[0])}).status,'INCOMPLETE_OR_FAIL');
 assert.equal(phoneLagCoverage({theme:'night',executed:names,checks:names.map(journey=>({journey,performanceTheme:'night',pass:true}))}).status,'INCOMPLETE_OR_FAIL');
});
