import test from 'node:test';
import assert from 'node:assert/strict';
import {flingFrameEvidence,referenceFrameAdmission,settleReferenceFrame} from '../tools/fling-evidence.mjs';
test('first and last rAF stalls count under the unchanged25/50ms absolute gates',()=>{
 assert.equal(flingFrameEvidence({startMs:0,endMs:80,frames:[16,32,48,64]}).passed,true);
 const first=flingFrameEvidence({startMs:0,endMs:140,frames:[60,76,92,108,124]}),last=flingFrameEvidence({startMs:0,endMs:140,frames:[16,32,48,64,80]});
 assert.equal(first.supported,true);assert.equal(first.passed,false);assert.equal(first.max,60);
 assert.equal(last.supported,true);assert.equal(last.passed,false);assert.equal(last.max,60);
});
test('empty, nonfinite, unordered, outside or too-short streams are unsupported',()=>{
 for(const row of [{},{startMs:0,endMs:80,frames:[]},{startMs:0,endMs:80,frames:[16,NaN]},{startMs:0,endMs:80,frames:[32,16]},{startMs:0,endMs:80,frames:[16,90]},{startMs:0,endMs:20,frames:[5,10]}]){const p=flingFrameEvidence(row);assert.equal(p.supported,false);assert.equal(p.passed,false);}
});
test('reference requires adjacent stable frames and a non-checkerboard viewport',()=>{
 assert.equal(referenceFrameAdmission({hasPrevious:false,difference:null,flatShare:0}),false);
 assert.equal(referenceFrameAdmission({hasPrevious:true,difference:.599,flatShare:.00199}),true);
 assert.equal(referenceFrameAdmission({hasPrevious:true,difference:.6,flatShare:0}),false);
 assert.equal(referenceFrameAdmission({hasPrevious:true,difference:0,flatShare:.002}),false);
 for(const row of [{hasPrevious:true,difference:NaN,flatShare:0},{hasPrevious:true,difference:0,flatShare:NaN},{hasPrevious:true,difference:-1,flatShare:0},{hasPrevious:true,difference:0,flatShare:1.1}])assert.throws(()=>referenceFrameAdmission(row),/invalid finite/);
});
test('a stable blank reference exhausts a finite sample count and cannot become a complete oracle',async()=>{
 let reads=0;const waits=[];await assert.rejects(settleReferenceFrame({attempts:3,readFrame:async()=>({frame:++reads}),meanDifference:()=>0,flatShare:()=>.1,wait:async ms=>waits.push(ms)}),e=>e.code==='HW_FLING_REFERENCE_UNSUPPORTED'&&e.proof.converged===false&&e.proof.attempts===3&&e.proof.observations.length===3);
 assert.equal(reads,3);assert.deepEqual(waits,[150,400,400]);
});
test('an unstable nonblank reference also fails; converged reference retains its positive proof',async()=>{
 await assert.rejects(settleReferenceFrame({attempts:2,readFrame:async()=>({}),meanDifference:()=>2,flatShare:()=>0,wait:async()=>{}}),/never converged/);
 let reads=0;const r=await settleReferenceFrame({attempts:3,readFrame:async()=>({frame:++reads}),meanDifference:()=>.2,flatShare:()=>0,wait:async()=>{}});assert.equal(r.frame.frame,2);assert.equal(r.proof.converged,true);assert.equal(r.proof.attempts,2);
 await assert.rejects(settleReferenceFrame({attempts:2,readFrame:async()=>({}),meanDifference:()=>0,flatShare:()=>NaN,wait:async()=>{}}),/invalid finite/);
});
