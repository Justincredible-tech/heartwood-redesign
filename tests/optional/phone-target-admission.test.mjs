import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm,realpath,symlink,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {phoneTargetOptions,admitPhoneTarget,verifyPhoneTargetUnchanged,judgePhoneObservation,assertCurrentPhoneComposition} from '../../tools/phone-target-admission.mjs';
import {ensureToolRuntime} from '../../tools/tool-runtime.mjs';
// Fixture: the current public PHONE_COMPOSERS set (tools/mobile-origin.mjs), captured at migration time.
// The live list is compared by tests/phone-composition-current.test.mjs when the public tree is present.
const PHONE_COMPOSERS=["tools/build-mobile.mjs","source/build-features.mjs","tools/feature-output.mjs","tools/mobile-feature-source.mjs","tools/supervised-build-options.mjs","tools/mobile-origin.mjs","tools/mobile-art-encoding.mjs","tools/mobile-theme.mjs","tools/build-mobile-inputs.mjs","tools/mobile-source-inputs.mjs","tools/build-output.mjs","tools/build-cli.mjs","source/mobile/content.mjs","source/mobile/art.mjs","source/mobile/night.mjs","source/mobile/page.mjs","source/mobile/state.mjs","source/mobile/app.js","source/js/live-photos.js","source/mobile/mobile.css","source/taste/taste-dark.mjs"];
const originDigest=inputs=>createHash('sha256').update(inputs.map(row=>row.origin+':'+row.path+':'+row.role+':'+row.bytes+':'+row.sha256).sort().join('\n')).digest('hex');
assert.equal(PHONE_COMPOSERS.length,21,'Fixture producer epoch must match the current public encoding, shared photo controller and feature helper composition');

const sha=b=>createHash('sha256').update(b).digest('hex');
const artifact=rows=>sha(rows.map(r=>r.path+':'+r.sha256).sort().join('\n'));
const readInput=async path=>readFile(path);
const runtime=ensureToolRuntime({name:'phone target admission fixtures',runTimeoutMs:30000,shutdownMs:8000}),ownedTemps=[];
after(async()=>{
 await runtime.ready;
 const cleanup=await runtime.shutdown('phone target admission fixtures finished');assert.deepEqual(cleanup.errors,[]);
 for(const entry of ownedTemps)await assert.rejects(lstat(entry.path),error=>error.code==='ENOENT','owned fixture temp was not removed');
 console.log(JSON.stringify({scope:'phone admission fixture ownership cleanup',runDir:runtime.runDir,runId:runtime.runId,scopeToken:runtime.scopeToken,registeredTemps:ownedTemps,cleanup,allOwnedTempsAbsent:true}));
});
// This synthesizer is a tiny unit fixture, never a real public CLI/build/fidelity oracle.
const role=path=>path.includes('/art/masters/')?'master':path.includes('/art/encoded/')?'encoded':path.startsWith('tools/')?'composer':/\.(mjs|js)$/.test(path)?'behavior-or-layout':path.endsWith('.css')?'style':'content';
async function fixture(fn,{packaged=false,legacy=false,grain=false}={}){
 const base=await realpath(await runtime.tempDir('heartwood-phone-admission-')),marker=JSON.parse(await readFile(join(base,'.hw-tool-owner'),'utf8'));assert.equal(marker.token,runtime.runId);assert.equal(typeof marker.resourceId,'string');ownedTemps.push({path:base,resourceId:marker.resourceId,token:marker.token});
 const source=join(base,'fork'),site=join(base,'site'),phone=packaged?join(site,'mobile'):site;await mkdir(phone,{recursive:true});await mkdir(source);
 const sourcePrefix=legacy?'mobile':'source/mobile',state='export const CATS=[];\nexport const matches=()=>[];\n',app='document.documentElement.dataset.hwTheme="day";\n',crown=Buffer.from('owned crown UNIT fixture'),encodedBody=Buffer.from('owned encoded UNIT fixture'),encodedName='roots@2x.fixture.webp';
 const records=new Map([['source/heartwood-site.html','<html>current source UNIT fixture</html>'],[sourcePrefix+'/state.mjs',state],[sourcePrefix+'/app.js',app]]);for(const path of PHONE_COMPOSERS)if(!records.has(path))records.set(path,'observed composer UNIT fixture '+path);records.set(sourcePrefix+'/art/masters/tree-crown@3x.png',crown);records.set(sourcePrefix+'/art/masters/roots@3x.png',crown);records.set(sourcePrefix+'/art/masters/masters.json',JSON.stringify({'tree-crown':{png:sha(crown),doc:sha(records.get('source/mobile/art.mjs')),w:1,h:1},roots:{png:sha(crown),doc:sha(records.get('source/mobile/art.mjs')),w:1,h:1}}));records.set('source/mobile/art/encoded/'+encodedName,encodedBody);records.set('source/mobile/art/encoded/manifest.json',JSON.stringify({schema:1,files:{[encodedName]:{bytes:encodedBody.length,sha256:sha(encodedBody)}}}));
 let grainTiles=null;
 if(grain){
  const repo=new URL('../../',import.meta.url),provenanceBytes=await readFile(new URL('source/assets/grain/grain-provenance.json',repo)),recipeCssBytes=await readFile(new URL('source/css/heartwood-site.css',repo)),provenance=JSON.parse(provenanceBytes.toString('utf8'));
  records.set('source/assets/grain/grain-provenance.json',provenanceBytes);records.set('source/css/heartwood-site.css',recipeCssBytes);
  grainTiles=[];
  for(const [flavor,section] of [['day',provenance],['night',provenance.night]])for(const density of Object.keys(section.tiles)){const bytes=await readFile(new URL('source/assets/grain/'+section.tiles[density].file,repo));records.set('source/assets/grain/'+section.tiles[density].file,bytes);grainTiles.push({file:'assets/grain-'+flavor+'@'+density+'x.'+sha(bytes).slice(0,16)+'.webp',bytes});}
 }
 for(const [path,body]of records){await mkdir(resolve(source,path,'..'),{recursive:true});await writeFile(join(source,path),body);}
 const composeFixture=async()=>{
  const inputs=[];for(const path of records.keys()){const body=await readFile(join(source,path));inputs.push({path,origin:'project',role:role(path),bytes:body.length,sha256:sha(body)});}inputs.sort((a,b)=>a.path.localeCompare(b.path));
  const stateBytes=await readFile(join(source,sourcePrefix+'/state.mjs'),'utf8'),appBytes=await readFile(join(source,sourcePrefix+'/app.js'),'utf8'),sharedBytes=await readFile(join(source,'source/js/live-photos.js'),'utf8'),css=await readFile(join(source,'source/mobile/mobile.css'),'utf8'),artSource=await readFile(join(source,'source/mobile/art.mjs')),master=await readFile(join(source,sourcePrefix+'/art/masters/roots@3x.png')),encoding=await readFile(join(source,'source/mobile/art/encoded/'+encodedName)),script="(()=>{'use strict';\n"+sharedBytes+'\n'+stateBytes.replace(/^export /gm,'')+'\n'+appBytes+'\n})();\n',imagePath='assets/roots@2x.'+sha(encoding).slice(0,16)+'.webp',cssPath='assets/mobile-day.'+sha(css).slice(0,16)+'.css';
  const bodies={'index.html':'<script>location.replace("day.html")</script>',['assets/mobile.'+sha(script).slice(0,16)+'.js']:script,[cssPath]:css,[imagePath]:encoding};if(grainTiles)for(const tile of grainTiles)bodies[tile.file]=tile.bytes;if(!legacy){bodies['day.html']='<html><main class="climb"><script type="application/json" id="hw-records">{}</script></main></html>';bodies['night.html']=bodies['day.html'];}
  const files=Object.entries(bodies).map(([path,body])=>({path,bytes:Buffer.byteLength(body),sha256:sha(body)})),recipe={name:'roots',documentSha256:sha(artSource),width:1,height:1,mask:false,master:{path:sourcePrefix+'/art/masters/roots@3x.png',sha256:sha(master),bytes:master.length,width:3,height:3},encodings:[{sourcePath:'source/mobile/art/encoded/'+encodedName,publishedPath:imagePath,format:'webp',dpr:2,bytes:encoding.length,sha256:sha(encoding),width:2,height:2,settings:{quality:78,effort:6},resize:'lanczos3'}]},markup=inputs.find(row=>row.path==='source/heartwood-site.html'),manifest={built:'tools/build-mobile.mjs',artifact:artifact(files),files,features:{night:true,phone:true,treeEffects:true,networkEffects:true,excluded:[]},source:{path:markup.path,sha256:markup.sha256,inputs},records:1,groups:{work:1},groupLeaves:1,art:{roots:{w:1,h:1,'2x.webp':imagePath}},photos:{},origin:{schema:1,kind:'public-phone-composition',inputDigest:originDigest(inputs),inputs,art:[recipe],photos:[],composition:{sourceEpochUnchanged:true},limitations:['UNIT fixture synthesis only; no real public CLI/build/visual proof']}};return {manifest,bodies};
 };
 const built=await composeFixture(),manifest=built.manifest,rows=manifest.files;for(const [path,body]of Object.entries(built.bodies)){await mkdir(resolve(phone,path,'..'),{recursive:true});await writeFile(join(phone,path),body);}if(legacy)delete manifest.origin;
 const manifestPath=join(phone,'manifest.json');await writeFile(manifestPath,JSON.stringify(manifest));
 if(packaged){const packageRows=rows.map(r=>({...r,path:'mobile/'+r.path})),entry='<script>location.replace("mobile/")</script>';await writeFile(join(site,'index.html'),entry);packageRows.push({path:'index.html',bytes:Buffer.byteLength(entry),sha256:sha(entry)});const bytes=await readFile(manifestPath);packageRows.push({path:'mobile/manifest.json',bytes:bytes.length,sha256:sha(bytes)});await writeFile(join(site,'manifest.json'),JSON.stringify({schema:1,htmlSha256:sha(entry),upstream:{commit:'a'.repeat(40)},artifact:artifact(packageRows),files:packageRows,sourceFiles:[inputsMarkup(manifest)]}));}
 let referenceCalls=0;const composeReference=async({sourceRoot})=>{assert.equal(sourceRoot,source);referenceCalls++;return (await composeFixture()).manifest;};
 return await fn({source,site,phone,rows,manifest,manifestPath,readInput,composeReference,composers:PHONE_COMPOSERS,get referenceCalls(){return referenceCalls;}});
}
const inputsMarkup=manifest=>({...manifest.source.inputs.find(row=>row.path===manifest.source.path)});

test('current mode never implicitly selects or builds the archived private phone',()=>{
 assert.throws(()=>phoneTargetOptions({auditRoot:'/fork/.audit'}),/--site/);
 assert.throws(()=>phoneTargetOptions({auditRoot:'/fork/.audit',site:' '}),/nonempty/);
 const explicit=phoneTargetOptions({auditRoot:'/repo',site:'/stage/optimized/mobile'});assert.equal(explicit.mode,'current');assert.equal(explicit.sourceRoot,'/repo');
 assert.equal(phoneTargetOptions({auditRoot:'/archive',legacyCapture:true}).mode,'historical');
});
test('complete current phone inputs are admitted and unchanged identity is reusable',async()=>fixture(async f=>{
 const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source});assert.equal(a.phonePrefix,'');assert.equal(a.manifest.artifact,f.manifest.artifact);assert(a.files.length>=f.rows.length+1);assert(a.sourceFiles.some(r=>r.path==='source/mobile/state.mjs'));assert(a.sourceOrigin.observedCurrentComposers.includes('source/mobile/art.mjs'));assert.equal(a.sourceOrigin.status,'CURRENT_RECOMPOSITION_MATCH');assert.equal(f.referenceCalls,1);assert.equal(a.sourceOrigin.inputs,f.manifest.origin.inputs.length);assert(PHONE_COMPOSERS.every(path=>a.sourceOrigin.declaredPublicInputs.includes(path)));await verifyPhoneTargetUnchanged(a,{readInput});
}));
test('complete stage-fork package roots locate their current phone without treating desktop index as phone',async()=>fixture(async f=>{
 const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source});assert.equal(a.phonePrefix,'/mobile');assert(a.manifests.length===2);await verifyPhoneTargetUnchanged(a,{readInput});
},{packaged:true}));
test('legacy selector-only capture requires explicitly historical scope',async()=>fixture(async f=>{
 await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/bound complete composition origin/);
 const a=await admitPhoneTarget({...f,mode:'historical',sourceRoot:f.source,composeReference:()=>{throw Error('historical must never compose');}});assert.equal(a.mode,'historical');assert.equal(a.performanceAcceptance,'historical capture only');assert.equal(f.referenceCalls,0);
},{legacy:true}));
test('empty, duplicate, escaped and falsely hashed manifest rows fail before browser allocation',async()=>fixture(async f=>{
 for(const files of [[],[f.rows[0],f.rows[0]],[{...f.rows[0],path:'../escape.html'}],[{...f.rows[0],path:'assets/%2e%2e/escape'}],[{...f.rows[0],bytes:0}],[{...f.rows[0],sha256:'0'.repeat(64)}]]){
  await writeFile(f.manifestPath,JSON.stringify({...f.manifest,files,artifact:artifact(files)}));await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}));
 }
}));
test('unlisted or mismatched artifact digest and symlink input are rejected',async()=>fixture(async f=>{
 await writeFile(f.manifestPath,JSON.stringify({...f.manifest,artifact:'0'.repeat(64)}));await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/artifact digest/);
 await writeFile(f.manifestPath,JSON.stringify(f.manifest));await rm(join(f.phone,'day.html'));await symlink(join(f.phone,'night.html'),join(f.phone,'day.html'));await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/regular|symlink/);
}));
test('before/after receipt rejects changed declared bytes',async()=>fixture(async f=>{
 const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source});await writeFile(join(f.phone,'day.html'),'different');await assert.rejects(verifyPhoneTargetUnchanged(a,{readInput}),/changed|size|hash/);
}));
test('before/after receipt rejects changed manifest metadata and source fixtures',async()=>{
 await fixture(async f=>{const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source});await writeFile(f.manifestPath,JSON.stringify({...f.manifest,changed:true}));await assert.rejects(verifyPhoneTargetUnchanged(a,{readInput}),/changed|size|hash/);});
 await fixture(async f=>{const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source});await writeFile(join(f.source,'source/mobile/state.mjs'),'different state');await assert.rejects(verifyPhoneTargetUnchanged(a,{readInput}),/changed|size|hash/);});
});
test('restoring original bytes cannot erase a changed input incarnation',async()=>fixture(async f=>{
 const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),original=await readFile(join(f.phone,'day.html'));
 await writeFile(join(f.phone,'day.html'),'temporarily different');await writeFile(join(f.phone,'day.html'),original);await assert.rejects(verifyPhoneTargetUnchanged(a,{readInput}),/identity changed/);
}));
test('source provenance and emitted behavior must match the current supplied fork',async()=>fixture(async f=>{
 await writeFile(join(f.source,'source/heartwood-site.html'),'different source');await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/hash|size/);
}));
test('current app source cannot silently diverge from the served behavior script',async()=>fixture(async f=>{
 await writeFile(join(f.source,'source/mobile/app.js'),'a different valid source');await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/size\/hash changed for source\/mobile\/app.js/);
}));
test('unbound current CSS cannot pass as a mere stable composer observation',async()=>fixture(async f=>{
 const changed=f.manifest.origin.inputs.filter(row=>row.path!=='source/mobile/mobile.css'),missing={...f.manifest,origin:{...f.manifest.origin,inputs:changed,inputDigest:originDigest(changed)},source:{...f.manifest.source,inputs:changed}};await writeFile(f.manifestPath,JSON.stringify(missing));await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/omitted composer source\/mobile\/mobile.css/);
 await writeFile(f.manifestPath,JSON.stringify(f.manifest));await writeFile(join(f.source,'source/mobile/mobile.css'),'current CSS changed without a new recorded build');await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/size\/hash changed for source\/mobile\/mobile.css/);
}));

test('declared stage source claims cannot be ignored when they differ from supplied fork',async()=>fixture(async f=>{
 const path=join(f.site,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));manifest.sourceFiles[0].sha256='0'.repeat(64);await writeFile(path,JSON.stringify(manifest));await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/size\/hash changed/);
},{packaged:true}));
test('observed current phone requires exact fixed route, theme, positive markers and declared same-origin resources',()=>{
 const a={mode:'current',phonePrefix:'/mobile',manifest:{files:[{path:'day.html'},{path:'night.html'},{path:'assets/mobile.0123456789abcdef.js'}]}};
 const good={url:'http://127.0.0.1:1234/mobile/day.html?open=work',theme:'day',phone:true,desktop:false,ready:'complete',visibility:'visible',resources:['http://127.0.0.1:1234/mobile/assets/mobile.0123456789abcdef.js']};
 assert.deepEqual(judgePhoneObservation(a,good,{origin:'http://127.0.0.1:1234',expectedTheme:'day'}),[]);
 for(const row of [{...good,url:'http://127.0.0.1:1234/desktop-day.html'},{...good,theme:'night'},{...good,phone:false},{...good,resources:[]},{...good,resources:['http://127.0.0.1:1234/css/desktop.css']},{...good,resources:['https://example.invalid/resource']},{...good,resources:['http://127.0.0.1:1234/mobile/assets/unlisted.js']}])assert(judgePhoneObservation(a,row,{origin:'http://127.0.0.1:1234',expectedTheme:'day'}).length>0);
});


test('current reference is mandatory, and crashed, empty or incomplete references cannot pass',async()=>fixture(async f=>{
 await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:undefined}),/requires an owned fresh public composition reference/);
 await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>{throw Error('exact fixture reference crash');}}),/exact fixture reference crash/);
 for(const value of [undefined,null,{}, {built:'tools/build-mobile.mjs'}])await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>value}),/fresh current-source reference lacks complete current composition origin/);
 const empty=structuredClone(f.manifest);empty.files=[];await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>empty}),/fresh current-source reference files must declare/);
}));
test('equal complete reference proves only current composition identity, never visual or device acceptance',async()=>fixture(async f=>{
 assert.equal(f.manifest.origin.inputs.filter(row=>PHONE_COMPOSERS.includes(row.path)).length,21);assert.deepEqual(f.manifest.source.inputs,f.manifest.origin.inputs);assert.equal(f.manifest.origin.inputDigest,originDigest(f.manifest.origin.inputs));assert(f.manifest.origin.art[0].encodings.length);assert(f.manifest.origin.inputs.some(row=>row.role==='master'));assert(f.manifest.origin.inputs.some(row=>row.role==='encoded'));assert.equal(f.manifest.origin.composition.sourceEpochUnchanged,true);
 const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source});assert.equal(a.sourceOrigin.status,'CURRENT_RECOMPOSITION_MATCH');assert.equal(f.referenceCalls,1);assert(a.sourceOrigin.limitations.some(value=>value.includes('perceptual fidelity')));assert(!a.performanceAcceptance.includes('performance passed'));await verifyPhoneTargetUnchanged(a,{readInput});
}));
test('reference recipe, asset, output, semantic and complete source closure drift reject independently',async()=>fixture(async f=>{
 const cases=[
  ['recipe',value=>{value.origin.art[0].documentSha256='0'.repeat(64);}],
  ['master asset',value=>{value.origin.art[0].master.sha256='0'.repeat(64);}],
  ['published semantic mapping',value=>{value.art.roots['2x.webp']='assets/other.webp';}],
  ['encoding settings',value=>{value.origin.art[0].encodings[0].settings.quality++;}],
  ['counts',value=>{value.records++;}],
  ['group mapping',value=>{value.groups.work++;}],
  ['served output',value=>{value.files[0]={...value.files[0],sha256:'0'.repeat(64)};value.artifact=artifact(value.files);}],
  ['source bytes',value=>{value.origin.inputs.find(row=>row.path==='source/mobile/mobile.css').sha256='0'.repeat(64);value.origin.inputDigest=originDigest(value.origin.inputs);}],
  ['source role',value=>{value.origin.inputs.find(row=>row.path==='source/mobile/mobile.css').role='composer';value.origin.inputDigest=originDigest(value.origin.inputs);}],
 ];
 for(const [label,change]of cases){const fresh=structuredClone(f.manifest);change(fresh);await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>fresh}),/differ from fresh current composition/,label);}
 for(const path of ['tools/build-mobile.mjs','tools/mobile-art-encoding.mjs','tools/mobile-theme.mjs','tools/feature-output.mjs']){const omitted=structuredClone(f.manifest);omitted.origin.inputs=omitted.origin.inputs.filter(row=>row.path!==path);omitted.source.inputs=omitted.origin.inputs;omitted.origin.inputDigest=originDigest(omitted.origin.inputs);await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>omitted}),error=>/omitted composer /.test(error.message));}
 const incomplete=structuredClone(f.manifest);incomplete.origin.art=[];await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>incomplete}),/lacks per-asset recipe mappings/);
}));
test('a reference cannot hide source or served-file changes made while it is composing',async()=>{
 await fixture(async f=>{await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>{await writeFile(join(f.source,'source/mobile/mobile.css'),'changed during fixture reference');return structuredClone(f.manifest);}}),/size\/hash changed for source\/mobile\/mobile.css/);});
 await fixture(async f=>{await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source,composeReference:async()=>{await writeFile(join(f.phone,'day.html'),'changed during fixture reference');return structuredClone(f.manifest);}}),/size\/hash changed for day.html/);});
});
test('48 seeded reducer cases distinguish equal references from recipe/asset/source-closure drift',async()=>fixture(async f=>{
 const fc=(await import('../property-lib.mjs')).fc;
 fc.assert(fc.property(fc.constantFrom('recipe','asset','source'),fc.boolean(),(kind,change)=>{const fresh=structuredClone(f.manifest);if(change){if(kind==='recipe')fresh.origin.art[0].documentSha256='0'.repeat(64);if(kind==='asset')fresh.origin.art[0].encodings[0].sha256='0'.repeat(64);if(kind==='source'){fresh.origin.inputs.find(row=>row.path==='source/mobile/mobile.css').sha256='0'.repeat(64);fresh.origin.inputDigest=originDigest(fresh.origin.inputs);}}try{const result=assertCurrentPhoneComposition(f.manifest,fresh,{composers:PHONE_COMPOSERS});return !change&&result.status==='CURRENT_RECOMPOSITION_MATCH';}catch(error){return change&&/differ from fresh current composition/.test(error.message);}}),{seed:1261308,numRuns:48});
}));
test('actual current grain provenance is admitted and every tile stays part of the pinned source identity',async()=>fixture(async f=>{
 const a=await admitPhoneTarget({...f,mode:'current',sourceRoot:f.source});
 assert.equal(a.sourceOrigin.status,'CURRENT_RECOMPOSITION_MATCH');
 assert(a.sourceFiles.some(row=>row.path==='source/assets/grain/grain-provenance.json'),'grain provenance must be pinned');
 assert(a.sourceFiles.filter(row=>/^source\/assets\/grain\/grain-fine/.test(row.path)).length===14,'all current grain tiles must be pinned');
 await verifyPhoneTargetUnchanged(a,{readInput});
},{grain:true}));
test('an altered served grain tile is rejected even when its manifest row is self-consistent',async()=>fixture(async f=>{
 const row=f.rows.find(entry=>entry.path.includes('grain-day@')&&entry.path.endsWith('.webp'));assert(row,'fixture must serve current grain tiles');
 const bytes=await readFile(join(f.phone,row.path)),altered=Buffer.concat([bytes,Buffer.from('tampered')]);
 await writeFile(join(f.phone,row.path),altered);
 const manifest=structuredClone(f.manifest),target=manifest.files.find(entry=>entry.path===row.path);target.bytes=altered.length;target.sha256=sha(altered);manifest.artifact=artifact(manifest.files);
 await writeFile(f.manifestPath,JSON.stringify(manifest));
 await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/absent from the current reviewed encoded source index and current verified grain provenance/);
},{grain:true}));
test('a grain recipe pin that no longer matches the current stylesheet fails closed before any acceptance',async()=>fixture(async f=>{
 const provenancePath=join(f.source,'source/assets/grain/grain-provenance.json'),provenance=JSON.parse(await readFile(provenancePath,'utf8'));
 provenance.recipe_sha256='0'.repeat(64);
 const bytes=Buffer.from(JSON.stringify(provenance));
 await writeFile(provenancePath,bytes);
 const manifest=structuredClone(f.manifest);for(const holder of [manifest.origin.inputs,manifest.source.inputs]){const row=holder.find(entry=>entry.path==='source/assets/grain/grain-provenance.json');row.bytes=bytes.length;row.sha256=sha(bytes);}
 manifest.origin.inputDigest=originDigest(manifest.origin.inputs);
 await writeFile(f.manifestPath,JSON.stringify(manifest));
 await assert.rejects(admitPhoneTarget({...f,mode:'current',sourceRoot:f.source}),/current grain provenance is invalid: grain day recipe pin mismatch/);
},{grain:true}));
