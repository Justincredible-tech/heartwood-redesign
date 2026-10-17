// Pure data-fixture regression: the current public phone composer closure must be admitted, and a
// stale, truncated or omitted composer closure must fail admission. No browser, no build, no artifact.
// The composer list is never duplicated in this file: every case derives it from the actual current
// public tools/mobile-origin.mjs through loadCurrentPhoneComposers(). When that module is unavailable
// the live-dependent cases fail closed with UNSUPPORTED - there is no fixture substitute and no fake
// pass. At integration the module resolves next to tools/phone-target-admission.mjs; draft-time replay
// happens in an owned copied (merged-layout) checkout or via the loader's explicit {root} option —
// never by substituting arbitrary module bytes through an environment variable.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertCurrentPhoneComposition,loadCurrentPhoneComposers} from '../tools/phone-target-admission.mjs';

// Stale entries the reviewed admission must refuse to require (older bounded-build producers).
const STALE=['tools/bounded-build.mjs','tools/bounded-build-worker.mjs','tools/bounded-build-result.mjs','tools/bounded-build-guard.mjs','tools/mobile-art-runtime.mjs'];
const sha=text=>createHash('sha256').update(text).digest('hex');
const inputDigest=inputs=>sha(inputs.map(row=>row.origin+':'+row.path+':'+row.role+':'+row.bytes+':'+row.sha256).sort().join('\n'));
const role=path=>path.startsWith('tools/')||path.startsWith('source/')?'composer':/.(mjs|js)$/.test(path)?'behavior-or-layout':path.endsWith('.css')?'style':'content';
function fixture(composers){
  const inputs=composers.map(path=>({path,origin:'project',role:role(path),bytes:4,sha256:sha(path)})).concat({path:'source/heartwood-site.html',origin:'project',role:'content',bytes:20,sha256:sha('markup')});
  const files=['index.html','day.html','night.html'].map(path=>({path,bytes:20,sha256:sha(path)}));
  return {built:'tools/build-mobile.mjs',artifact:sha(files.map(row=>row.path+':'+row.sha256).sort().join('\n')),files,
    source:{path:'source/heartwood-site.html',sha256:sha('markup'),inputs},records:3,groups:1,groupLeaves:1,
    art:{tree:{w:375,h:900}},photos:{},
    origin:{schema:1,kind:'public-phone-composition',inputDigest:inputDigest(inputs),inputs,
      art:[{name:'tree',documentSha256:sha('recipe'),master:{sha256:sha('master')},encodings:[{sourcePath:'source/mobile/art/encoded/tree.webp',publishedPath:'assets/tree.webp',sha256:sha('webp')}]}],
      photos:[],composition:{sourceEpochUnchanged:true}}};
}
const ownedTemps=[];
after(async()=>{
  for(const path of ownedTemps)await rm(path,{recursive:true,force:true});
  for(const path of ownedTemps)await assert.rejects(lstat(path),error=>error.code==='ENOENT','owned composer-fixture temp was not removed');
});

test('a current fresh-build closure built from the live public composer list is admitted',async()=>{
  const live=await loadCurrentPhoneComposers();
  const reference=fixture(live);
  const admitted=assertCurrentPhoneComposition(reference,structuredClone(reference),{composers:live});
  assert.equal(admitted.status,'CURRENT_RECOMPOSITION_MATCH');
  assert.equal(admitted.inputs,live.length+1);
});
test('a stale bounded-build-era closure fails admission even when self-consistent',async()=>{
  const live=await loadCurrentPhoneComposers();
  const reference=fixture(live),stale=fixture([...STALE,...live.filter(path=>!STALE.includes(path))]);
  assert.throws(()=>assertCurrentPhoneComposition(reference,stale,{composers:live}),/differ from fresh current composition/);
  assert.throws(()=>assertCurrentPhoneComposition(stale,reference,{composers:live}),/differ from fresh current composition/);
});
test('an old-era closure that omits the current modules fails admission',async()=>{
  const live=await loadCurrentPhoneComposers();
  assert.throws(()=>assertCurrentPhoneComposition(fixture(STALE),fixture(live),{composers:live}),/omitted composer/);
});
test('an omitted composer fails admission even with a recomputed digest',async()=>{
  const live=await loadCurrentPhoneComposers();
  const reference=fixture(live);
  for(const index of [0,Math.floor(live.length/2),live.length-1]){
    const bad=structuredClone(reference);
    bad.origin.inputs.splice(index,1);bad.source.inputs=bad.origin.inputs;bad.origin.inputDigest=inputDigest(bad.origin.inputs);
    assert.throws(()=>assertCurrentPhoneComposition(bad,reference,{composers:live}),/omitted composer/,live[index]);
    assert.throws(()=>assertCurrentPhoneComposition(reference,bad,{composers:live}),/omitted composer/,live[index]);
  }
});
test('the same truncation applied consistently to both selected and reference sides still fails',async()=>{
  const live=await loadCurrentPhoneComposers();
  for(const path of [live[0],live[Math.floor(live.length/2)],live[live.length-1]]){
    const truncated=live.filter(value=>value!==path),selected=fixture(truncated),reference=fixture(truncated);
    assert.throws(()=>assertCurrentPhoneComposition(selected,structuredClone(reference),{composers:live}),/omitted composer/,path);
    assert.throws(()=>assertCurrentPhoneComposition(structuredClone(reference),selected,{composers:live}),/omitted composer/,path);
  }
});
test('missing explicit composers is refused, never defaulted to a stale list',async()=>{
  const live=await loadCurrentPhoneComposers();
  const reference=fixture(live);
  assert.throws(()=>assertCurrentPhoneComposition(reference,structuredClone(reference)),/current public composer list/);
});
test('an unavailable current public module fails closed with UNSUPPORTED, never a fixture substitute',async()=>{
  const empty=await mkdtemp(join(await realpath(tmpdir()),'heartwood-composer-'));
  ownedTemps.push(empty);
  await assert.rejects(loadCurrentPhoneComposers({root:empty}),error=>error instanceof Error&&error.message.startsWith('UNSUPPORTED: ')&&/PHONE_COMPOSERS/.test(error.message));
});
