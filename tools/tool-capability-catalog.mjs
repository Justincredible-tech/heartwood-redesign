/** Inert exact capability accounting. A complete catalog is never runtime acceptance. */
const SHA=/^[a-f0-9]{64}$/,MAX_ROWS=4096;
const relative=path=>typeof path==='string'&&path.length>0&&path.length<2048&&!path.startsWith('/')&&!path.includes('\\')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');
const validRow=row=>row&&relative(row.path)&&SHA.test(row.sourceSha256||'');
const maintained=path=>path.startsWith('tools/')||path.startsWith('tests/');
const kinds=new Set(['maintained-source','maintained-test','retired-source','historical-source','generated-browser-copy']);
const states=new Set(['source-registered','helper-source','manual-not-executed','unregistered','retired-preserved','browser-artifact-not-cli','historical-not-executed']);
const actorEvidence=rows=>Array.isArray(rows)&&rows.length>0&&rows.length<=32&&rows.every(row=>validRow(row)&&Object.keys(row).length===2);
function actorInvocations(rows,path){
 if(!Array.isArray(rows)||rows.length<1||rows.length>2)return false;
 if(path==='tests/fixtures/retain-temp-worker.mjs')return rows.length===2&&rows.every((r,i)=>r&&Object.keys(r).length===4&&r.mode===['ownership','stdout'][i]&&r.stdin==='unused'&&r.timeoutMs===6000&&Array.isArray(r.argv)&&r.argv.length===[2,3][i]&&r.argv[0]===path&&r.argv[1]===r.mode&&(i===0||r.argv[2]?.kind==='owned-parent-receipt'&&r.argv[2]?.binding==='receiptPath'&&Object.keys(r.argv[2]).length===2));
 return path==='tests/fixtures/timing-peer.mjs'&&rows.length===1&&rows[0]&&Object.keys(rows[0]).length===5&&rows[0].mode==='stdin-peer'&&rows[0].stdin==='parent-end-after-ready'&&rows[0].readinessTimeoutMs===5000&&rows[0].exitTimeoutMs===3000&&Array.isArray(rows[0].argv)&&rows[0].argv.length===1&&rows[0].argv[0]===path;
}
function actorProofMatches(r,f,row,reviewFacts){
 if(r.actorSourceSha256!==row.sourceSha256||f.actorSourceSha256!==row.sourceSha256||r.scope!=='source-only-not-runtime-acceptance'||f.scope!==r.scope||!actorInvocations(r.sourceInvocations,row.path)||!actorInvocations(f.sourceInvocations,row.path))return false;
 const reviews=role=>reviewFacts.filter(review=>validRow(review)&&review.path===(role==='test-actor'?row.path:r.path)&&review.sourceSha256===(role==='test-actor'?row.sourceSha256:r.sourceSha256)&&review.role===role),actor=reviews('test-actor'),caller=reviews('test');
 if(actor.length!==1||caller.length!==1||!actorEvidence(actor[0].evidence)||!actorEvidence(caller[0].evidence)||!actorEvidence(r.reviewEvidence?.actor)||!actorEvidence(r.reviewEvidence?.caller)||!actorEvidence(f.reviewEvidence?.actor)||!actorEvidence(f.reviewEvidence?.caller))return false;
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);return equal(r.sourceInvocations,f.sourceInvocations)&&equal(r.reviewEvidence.actor,f.reviewEvidence.actor)&&equal(r.reviewEvidence.caller,f.reviewEvidence.caller)&&equal(r.reviewEvidence.actor,actor[0].evidence)&&equal(r.reviewEvidence.caller,caller[0].evidence);
}
export function assessCapabilityCatalog(catalog,inventory,{evidenceFacts=[],registrationFacts=[],retirementFacts=[],reviewFacts=[]}={}){
 const failures=[],inventoryFailures=[],coverageFailures=[];
 const issue=(kind,path,reason,coverage=false)=>{const row={kind,path,reason};failures.push(row);(coverage?coverageFailures:inventoryFailures).push(row);};
 if(catalog?.schema!==1||catalog.claim!=='inventory and source registration only; no runtime acceptance'||!Array.isArray(catalog.entries)||!catalog.entries.length||catalog.entries.length>MAX_ROWS)issue('invalid-catalog','catalog','nonempty bounded exact catalog and honest claim required');
 if(!Array.isArray(inventory)||!inventory.length||inventory.length>MAX_ROWS)issue('invalid-inventory','inventory','nonempty bounded source census required');
 const expected=new Map(),seen=new Set(),capabilities=new Set();
 for(const row of Array.isArray(inventory)?inventory.slice(0,MAX_ROWS+1):[]){if(!validRow(row)){issue('invalid-inventory-row',String(row?.path),'regular relative path/current SHA required');continue;}if(expected.has(row.path))issue('duplicate-inventory-row',row.path,'one required source identity per path');expected.set(row.path,row);}
 for(const row of Array.isArray(catalog?.entries)?catalog.entries.slice(0,MAX_ROWS+1):[]){
  if(!validRow(row)){issue('invalid-catalog-row',String(row?.path),'regular relative path/current SHA required');continue;}
  if(seen.has(row.path))issue('duplicate-catalog-row',row.path,'one exact source disposition per path');seen.add(row.path);
  if(!expected.has(row.path))issue('uncensused-source',row.path,'catalog cannot add a source absent from supplied census');else if(expected.get(row.path).sourceSha256!==row.sourceSha256)issue('changed-source',row.path,'catalog and census source hashes differ');
  if(typeof row.capabilityId!=='string'||!row.capabilityId||capabilities.has(row.capabilityId))issue('missing-or-collapsed-capability',row.path,'every source retains a distinct nonempty capability identity');capabilities.add(row.capabilityId);
  const scope=maintained(row.path)?'maintained':'historical';if(row.scope!==scope)issue('wrong-source-scope',row.path,'maintained source cannot be classified away');
  if(!kinds.has(row.disposition)||scope==='maintained'&&['historical-source','generated-browser-copy'].includes(row.disposition)||scope==='historical'&&['maintained-source','maintained-test'].includes(row.disposition))issue('invalid-disposition',row.path,'source scope and disposition disagree');
  if(scope==='maintained'&&row.path.startsWith('tests/')&&!['maintained-test','retired-source'].includes(row.disposition)&&expected.get(row.path)?.supportOnly!==true)issue('unproved-test-helper',row.path,'a required test cannot hide as a library without observed support-only identity');
  if(!['reviewed','unreviewed'].includes(row.reviewStatus))issue('invalid-review-state',row.path,'catalog does not invent policy admission');
  if(row.reviewStatus==='reviewed'&&!reviewFacts.some(f=>validRow(f)&&f.path===row.path&&f.sourceSha256===row.sourceSha256))issue('unproved-source-review',row.path,'reviewed claim requires independently observed current policy/evidence identity');
  const coverage=row.coverage;
  if(!coverage||!states.has(coverage.status)||!Array.isArray(coverage.proofs)||!Array.isArray(coverage.registration))issue('invalid-coverage',row.path,'explicit source-only status/registration/proofs required',true);
  else{
   const reviewedActor=reviewFacts.some(review=>validRow(review)&&review.path===row.path&&review.sourceSha256===row.sourceSha256&&review.role==='test-actor');
   if(reviewedActor&&(row.runtimeAcceptance!=='NOT_RUN_BY_CATALOG'||Object.hasOwn(row,'safeCleanup')||coverage.status!=='source-registered'||!coverage.registration.some(r=>r.kind==='test-actor-caller')))issue('unproved-test-actor-coverage',row.path,'reviewed actor requires actual caller facts; source accounting cannot carry runtime or cleanup approval',true);
   if(row.disposition==='maintained-source'&&!['source-registered','helper-source','manual-not-executed','unregistered'].includes(coverage.status))issue('wrong-coverage-disposition',row.path,'maintained capability cannot borrow a historical, generated or retired state',true);
   if(row.disposition==='historical-source'&&!['source-registered','historical-not-executed'].includes(coverage.status))issue('wrong-coverage-disposition',row.path,'historical source preserves its own honest execution boundary',true);
   for(const proof of coverage.proofs)if(!validRow(proof)||typeof proof.scope!=='string'||!proof.scope||proof.status==='PASS')issue('invalid-proof',row.path,'proof identity/scope required; execution verdicts are outside this catalog',true);
   if(coverage.status==='source-registered'){
    if(!coverage.registration.length||coverage.registration.some(r=>!validRow(r)||r.member!==row.path||!['literal-path','dynamic-property-selector','browser-stage-args','imported-test-helper','delegated-test-command','test-actor-caller'].includes(r.kind)||!registrationFacts.some(f=>validRow(f)&&f.path===r.path&&f.sourceSha256===r.sourceSha256&&f.kind===r.kind&&Array.isArray(f.members)&&f.members.includes(row.path)&&(r.kind!=='test-actor-caller'||actorProofMatches(r,f,row,reviewFacts)))))issue('invalid-registration',row.path,'registration must name this exact source and externally observed registered source identity/mechanism',true);
   }
   if(row.disposition==='maintained-test'&&coverage.status!=='source-registered')issue('unregistered-maintained-test',row.path,'required test lacks explicit source registration',true);
   if(row.disposition==='generated-browser-copy'){
    if(coverage.status!=='browser-artifact-not-cli'||!Array.isArray(row.provenance)||!row.provenance.length||row.provenance.some(p=>!validRow(p)||!relative(p.member)||p.memberSha256!==row.sourceSha256||!evidenceFacts.some(f=>validRow(f)&&f.path===p.path&&f.sourceSha256===p.sourceSha256&&Array.isArray(f.members)&&f.members.some(m=>m.path===p.member&&m.sourceSha256===p.memberSha256))))issue('unproved-generated-copy',row.path,'exact externally observed manifest/HTML/known artifact membership required; never CLI acceptance');
   }
   if(row.disposition==='retired-source'&&(coverage.status!=='retired-preserved'||!row.retirement?.reason||!Array.isArray(row.retirement.evidence)||!row.retirement.evidence.length||!retirementFacts.some(f=>validRow(f)&&f.path===row.path&&f.sourceSha256===row.sourceSha256&&typeof f.reason==='string'&&f.reason&&Array.isArray(f.evidence)&&f.evidence.length)))issue('unproved-retirement',row.path,'retirement preserves code and externally observed concrete evidence, never activates it');
  }
 }
 for(const path of expected.keys())if(!seen.has(path))issue('missing-source',path,'required source silently omitted');
 return {scope:'exact catalog and source-registration accounting only',inventoryComplete:inventoryFailures.length===0,coverageComplete:coverageFailures.length===0,runtimeAcceptance:false,passed:failures.length===0,files:seen.size,maintained:[...seen].filter(maintained).length,historical:[...seen].filter(p=>!maintained(p)).length,failures};
}
