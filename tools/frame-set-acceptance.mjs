import assert from 'node:assert/strict';

export function assertFrameSet(actual,references,label='sampled frames'){
  const samples=[...actual],allowed=new Set(references);
  assert(samples.length>0,`${label}: no frames sampled`);
  assert(allowed.size>0,`${label}: no reference frames sampled`);
  const unmatched=samples.filter(h=>!allowed.has(h));
  assert.equal(unmatched.length,0,`${label}: ${unmatched.length}/${samples.length} frames outside the reference set: ${unmatched.join(', ')}`);
}

export function assertSelectedCases(count,label='case selection'){
  assert(Number.isSafeInteger(count)&&count>0,`${label}: no cases matched; no acceptance checks ran`);
}
