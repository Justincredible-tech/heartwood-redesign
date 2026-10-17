/** Explicit phone artifact admission. Importing is inert; no build, browser or native lifecycle. */
import {lstat,realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {grainRows,verifyGrainTileBytes,grainRecipeSha256} from './grain-inputs.mjs';

const SHA=/^[a-f0-9]{64}$/,MAX_FILES=2048,MAX_FILE_BYTES=8*1024*1024,MAX_TOTAL_BYTES=64*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=files=>hash(files.map(row=>row.path+':'+row.sha256).sort().join('\n'));
const regularPath=value=>typeof value==='string'&&value.length>0&&value.length<1024&&/^[A-Za-z0-9@._/-]+$/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const fail=message=>{throw Error('Phone target admission: '+message);};
// The current public phone composer set is owned by the public source tree
// (tools/mobile-origin.mjs PHONE_COMPOSERS); this inert reducer never hardcodes it.
// Callers load it explicitly with loadCurrentPhoneComposers() and pass it in. An explicit project
// root (the directory whose tools/ tree owns the composer list) may be supplied by owned-checkout
// callers and tests; otherwise the module resolves adjacent to this reducer, exactly the public layout.
export async function loadCurrentPhoneComposers({root}={}){
 if(root!==undefined&&(typeof root!=='string'||!root.trim()))throw Error('Phone target admission: composer project root must be a nonempty directory path');
 const url=root!==undefined?pathToFileURL(resolve(root,'tools','mobile-origin.mjs')).href:new URL('./mobile-origin.mjs',import.meta.url).href;
 let mod;try{mod=await import(url);}catch{throw Error('UNSUPPORTED: the current public composer list (tools/mobile-origin.mjs PHONE_COMPOSERS) is not available; integrate with the public tools/ tree (see docs/TESTING.md)');}
 const list=mod.PHONE_COMPOSERS;
 if(!Array.isArray(list)||!list.length||list.length>64)throw Error('Phone target admission: PHONE_COMPOSERS must declare 1..64 paths');
 const seen=new Set();
 for(const path of list){if(!regularPath(path))throw Error('Phone target admission: unsafe composer path '+String(path));if(seen.has(path))throw Error('Phone target admission: duplicate composer '+path);seen.add(path);}
 return [...list];
}
/** Compare selected bytes/recipes against an owned fresh public composition.
 * The caller supplies the actual public builder; this inert reducer never builds
 * or trusts a target's self-declared partial closure as its own reference.
 */
export function assertCurrentPhoneComposition(manifest,reference,{composers}={}){
 const composerList=composers;
 if(!Array.isArray(composerList)||!composerList.length||composerList.length>64||composerList.some(path=>!regularPath(path)))fail('current phone composition admission requires the explicit current public composer list (loadCurrentPhoneComposers; see docs/TESTING.md)');
 const normalizeInputs=(inputs,label)=>rows(inputs,label).map(row=>{
  if(!['project','content'].includes(row.origin)||!/^[-a-z0-9]{1,64}$/.test(row.role||''))fail('invalid composition input root/role in '+label);
  return {path:row.path,role:row.role,bytes:row.bytes,sha256:row.sha256};
 }).sort((a,b)=>a.path.localeCompare(b.path));
 const snapshot=(value,label)=>{
  const origin=value?.origin;
  if(value?.built!=='tools/build-mobile.mjs'||origin?.schema!==1||origin?.kind!=='public-phone-composition'||origin?.composition?.sourceEpochUnchanged!==true)fail(label+' lacks complete current composition origin');
  const inputRows=normalizeInputs(origin.inputs,label+' origin');
  const actual=hash(origin.inputs.map(row=>row.origin+':'+row.path+':'+row.role+':'+row.bytes+':'+row.sha256).sort().join('\n'));
  if(!SHA.test(origin.inputDigest||'')||actual!==origin.inputDigest)fail(label+' origin digest is inconsistent');
  for(const path of composerList)if(!inputRows.some(row=>row.path===path))fail(label+' omitted composer '+path);
  if(!isDeepStrictEqual(normalizeInputs(value.source?.inputs,label+' public inputs'),inputRows))fail(label+' public inputs differ from origin closure');
  if(value.source?.path!=='source/heartwood-site.html'||!inputRows.some(row=>row.path===value.source.path&&row.sha256===value.source.sha256))fail(label+' markup is absent from full origin closure');
  const files=rows(value.files,label+' files').map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
  if(!SHA.test(value.artifact||'')||digest(files)!==value.artifact)fail(label+' artifact does not bind its complete files');
  if(!Array.isArray(origin.art)||!origin.art.length||!Array.isArray(origin.photos))fail(label+' lacks per-asset recipe mappings');
  return {artifact:value.artifact,files,inputs:inputRows,source:{path:value.source.path,sha256:value.source.sha256},records:value.records,groups:value.groups,groupLeaves:value.groupLeaves,art:value.art,photos:value.photos,artOrigin:origin.art,photoOrigin:origin.photos};
 };
 const selected=snapshot(manifest,'selected phone'),fresh=snapshot(reference,'fresh current-source reference');
 if(!isDeepStrictEqual(selected,fresh))fail('selected phone bytes, complete source closure or recipes differ from fresh current composition');
 return {status:'CURRENT_RECOMPOSITION_MATCH',artifact:manifest.artifact,inputDigest:manifest.origin.inputDigest,freshInputDigest:reference.origin.inputDigest,inputs:selected.inputs.length,files:selected.files.length,scope:'Exact served file identities, semantic mappings and complete declared inputs match an owned fresh composition of the supplied current source; historical renderer/encoder and physical fidelity remain separate.'};
}

export function phoneTargetOptions({auditRoot,site,legacyCapture=false,sourceRoot}={}){
 if(typeof auditRoot!=='string'||!auditRoot.trim())fail('audit root must be nonempty');
 for(const [name,value]of Object.entries({site,sourceRoot}))if(value!==undefined&&(typeof value!=='string'||!value.trim()))fail('--'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+' must be nonempty');
 if(typeof legacyCapture!=='boolean')fail('historical mode must be explicit boolean');
 if(!site&&!legacyCapture)fail('current phone verification requires --site DIR (a current public phone directory or stage-fork candidate package). Build/stage current public source separately; the archived .audit/mobile build is never selected implicitly. Use --legacy-capture only for historical comparison.');
 return {mode:legacyCapture?'historical':'current',site:site?resolve(site):null,sourceRoot:resolve(sourceRoot||(legacyCapture?auditRoot:resolve(auditRoot)))   // public layout: the current tools/ tree lives under the repository root
};
}

function rows(files,label){
 if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)fail(label+' must declare1..'+MAX_FILES+' files');
 const names=new Set();let total=0;
 for(const row of files){
  if(!row||!regularPath(row.path)||!SHA.test(row.sha256||'')||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>MAX_FILE_BYTES)fail('invalid bounded regular manifest row in '+label);
  const name=row.path.toLowerCase();if(names.has(name))fail('duplicate manifest path '+row.path);names.add(name);total+=row.bytes;
 }
 if(total>MAX_TOTAL_BYTES)fail(label+' exceeds bounded total input bytes');
 return files;
}

async function canonicalRoot(path){
 const requested=resolve(path),info=await lstat(requested);if(!info.isDirectory()||info.isSymbolicLink())fail('input root must be a real directory: '+requested);
 return realpath(requested);
}

async function readFileRow(root,path,readInput,expected){
 if(!regularPath(path))fail('unsafe input path '+path);
 const rootInfo=await lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())fail('input root changed or became a symlink: '+root);
 let target=root;
 const parts=path.split('/');
 for(const [i,part]of parts.entries()){
  target=join(target,part);const info=await lstat(target);
  if(info.isSymbolicLink()||(i<parts.length-1?!info.isDirectory():!info.isFile()))fail('input must use regular files and real directories, never a symlink: '+path);
 }
 const before=await lstat(target);
 if(before.size<1||before.size>MAX_FILE_BYTES)fail('input size is outside the bounded regular range: '+path);
 const bytes=Buffer.from(await readInput(target)),after=await lstat(target);
 if(!after.isFile()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||bytes.length!==before.size)fail('input changed while reading: '+path);
 const row={path,bytes:bytes.length,sha256:hash(bytes),identity:{dev:before.dev,ino:before.ino,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs}};
 if(expected&&(row.bytes!==expected.bytes||row.sha256!==expected.sha256))fail('size/hash changed for '+path);
 if(expected?.identity&&Object.keys(row.identity).some(key=>row.identity[key]!==expected.identity[key]))fail('input identity changed for '+path);
 return {row,bytes};
}

async function snapshotManifest(root,readInput,label){
 const manifestFile=await readFileRow(root,'manifest.json',readInput);let manifest;
 try{manifest=JSON.parse(manifestFile.bytes.toString('utf8'));}catch{fail('invalid JSON manifest in '+label);}
 const files=rows(manifest?.files,label);
 if(!SHA.test(manifest.artifact||'')||digest(files)!==manifest.artifact)fail('artifact digest does not match complete declared files in '+label);
 const observed=[];for(const row of files)observed.push((await readFileRow(root,row.path,readInput,row)).row);
 return {root,manifest,files:[...observed,manifestFile.row]};
}

/** Verify every body from a completed owned build, not only its manifest claims. */
export async function readPhoneArtifactManifest({site,readInput}={}){
 if(typeof readInput!=='function')fail('a bounded regular-file reader is required');
 const result=await snapshotManifest(await canonicalRoot(site),readInput,'fresh owned phone composition');
 return result.manifest;
}

export async function admitPhoneTarget({site,mode='current',sourceRoot,readInput,composeReference,composers}={}){
 if(!['current','historical'].includes(mode))fail('unknown verification mode');
 if(typeof readInput!=='function')fail('a bounded regular-file reader is required');
 if(typeof site!=='string'||!site.trim())fail('--site must explicitly identify an artifact directory');
 const root=await canonicalRoot(site),outer=await snapshotManifest(root,readInput,'selected artifact');
 let phone=outer,phonePrefix='';const manifests=[outer];
 if(mode==='current'&&!outer.manifest.built){
  const entry=outer.manifest.files.find(row=>row.path==='index.html');
  if(outer.manifest.schema!==1||!/^[a-f0-9]{40}$/.test(outer.manifest.upstream?.commit||'')||!entry||outer.manifest.htmlSha256!==entry.sha256||!outer.manifest.files.some(row=>row.path==='mobile/manifest.json'))fail('selected stage is not a current candidate package containing a bound index.html and mobile/manifest.json. A desktop-only upstream baseline is not a phone; use --site CURRENT_CANDIDATE/mobile or a current complete stage.');
  phonePrefix='/mobile';phone=await snapshotManifest(await canonicalRoot(join(root,'mobile')),readInput,'current phone');manifests.push(phone);
 }
 const manifest=phone.manifest;
 if(mode==='current'){
  if(typeof composeReference!=='function')fail('current phone admission requires an owned fresh public composition reference');
  if(manifest.built!=='tools/build-mobile.mjs'||manifest.source?.path!=='source/heartwood-site.html')fail('not a current public phone build; historical captures require --legacy-capture');
  if(manifest.origin?.schema!==1||manifest.origin?.kind!=='public-phone-composition'||manifest.origin?.composition?.sourceEpochUnchanged!==true)fail('current phone artifact lacks bound complete composition origin; build the current public source first');
  for(const entry of ['index.html','day.html','night.html'])if(!manifest.files.some(row=>row.path===entry))fail('current phone requires '+entry+'; selector-only legacy captures require --legacy-capture');
 }
 const sourceFiles=[],canonicalSource=await canonicalRoot(sourceRoot),sourceRead=async(path,expected)=>{
  const item=await readFileRow(canonicalSource,path,readInput,expected);
  const known=sourceFiles.find(row=>row.path===path);if(known&&(known.bytes!==item.row.bytes||known.sha256!==item.row.sha256||Object.keys(known.identity).some(key=>known.identity[key]!==item.row.identity[key])))fail('source input changed during admission: '+path);
  if(!known)sourceFiles.push(item.row);return item.bytes;
 };
 const sourcePrefix=mode==='current'?'source/mobile':'mobile';
 if(mode==='current'){
  const inputs=rows(manifest.source?.inputs,'public source provenance');
  if(!inputs.some(row=>row.path==='source/heartwood-site.html'&&row.sha256===manifest.source.sha256))fail('public markup provenance is incomplete');
  for(const row of inputs)await sourceRead(row.path,row);
  if(outer!==phone&&outer.manifest.sourceFiles!==undefined)for(const row of rows(outer.manifest.sourceFiles,'stage source claims'))await sourceRead(row.path,row);
  // Required compositor bytes must be bound by the manifest and fresh composition.
  if(mode==='current'){if(!Array.isArray(composers)||!composers.length)fail('current phone admission requires the explicit current public composer list (loadCurrentPhoneComposers)');for(const path of composers)await sourceRead(path);}
 }
 const statePath=sourcePrefix+'/state.mjs',appPath=sourcePrefix+'/app.js';
 const state=await sourceRead(statePath),app=await sourceRead(appPath);
 const mastersPath=sourcePrefix+'/art/masters/masters.json',maskPath=sourcePrefix+'/art/masters/tree-crown@3x.png';
 const masters=JSON.parse((await sourceRead(mastersPath)).toString('utf8')),mask=await sourceRead(maskPath);
 if(!SHA.test(masters['tree-crown']?.png||'')||hash(mask)!==masters['tree-crown'].png)fail('the source crown mask does not match its reviewed master index');
 if(mode==='current'){
  const scripts=manifest.files.filter(row=>/^assets\/mobile\.[a-f0-9]{16}\.js$/.test(row.path));
  // Current epoch bundle: the shared live-photo controller ships ahead of the page script
  // (source/js/live-photos.js), then the page source follows the recorded full-default features where the
  // feature transform (tools/mobile-feature-source.mjs) is an identity; an excluded build carries surgery
  // this reducer does not reproduce, so it fails closed instead of guessing.
  const features=manifest.features;
  if(!features||[features.night,features.phone,features.treeEffects,features.networkEffects].some(value=>typeof value!=='boolean')||!Array.isArray(features.excluded))fail('current phone artifact lacks its recorded build features');
  if(!(features.night&&features.networkEffects))fail('current phone admission verifies the full default feature build; rebuild without exclusions for current phone verification');
  const shared=(await sourceRead('source/js/live-photos.js')).toString('utf8');
  const expected=Buffer.from("(()=>{'use strict';\n"+shared+'\n'+state.toString('utf8').replace(/^export /gm,'')+'\n'+app.toString('utf8')+'\n})();\n');
  if(scripts.length!==1||scripts[0].sha256!==hash(expected)||scripts[0].bytes!==expected.length)fail('served phone behavior is not the supplied current public state/app/live-photo source bundle');
  const encoded=JSON.parse((await sourceRead(sourcePrefix+'/art/encoded/manifest.json')).toString('utf8'));
  const approved=Object.values(encoded.files||{});
  // Current grain tiles: verified against the same canonical recipe/intrinsic-dimension
  // admission the builder uses (tools/grain-inputs.mjs). The provenance record pins the recipe and the
  // byte/fingerprint/dimension checks below reject unknown or altered served images fail-closed. Absent
  // provenance (non-grain source trees) is not a silent pass: any served grain tile then matches neither
  // set and is rejected.
  const grain=[];
  let provenanceBytes=null;
  try{provenanceBytes=await sourceRead('source/assets/grain/grain-provenance.json');}
  catch(error){if(error?.code!=='ENOENT')throw error;}
  if(provenanceBytes){
    try{
      const provenance=JSON.parse(provenanceBytes.toString('utf8'));
      const cssText=(await sourceRead('source/css/heartwood-site.css')).toString('utf8');
      for(const flavor of ['day','night']){
        const section=flavor==='day'?provenance:provenance.night;
        if(!section)continue;
        for(const row of grainRows(section,{flavor,expectedRecipeSha256:grainRecipeSha256(cssText,flavor)})){
          const bytes=await sourceRead('source/assets/grain/'+row.file);
          verifyGrainTileBytes(row,bytes);
          grain.push({sha256:hash(bytes),bytes:bytes.length});
        }
      }
    }catch(error){fail('current grain provenance is invalid: '+String(error?.message||error).split('\n')[0]);}
  }
  for(const row of manifest.files.filter(row=>/\.(?:avif|webp)$/.test(row.path)))if(!approved.some(known=>known.sha256===row.sha256&&known.bytes===row.bytes)&&!grain.some(known=>known.sha256===row.sha256&&known.bytes===row.bytes))fail('served image is absent from the current reviewed encoded source index and current verified grain provenance: '+row.path);
 }
 let composition;
 if(mode==='current'){
  composition=assertCurrentPhoneComposition(manifest,await composeReference({sourceRoot:canonicalSource}),{composers});
  for(const row of sourceFiles)await readFileRow(canonicalSource,row.path,readInput,row);
  for(const {root,files}of manifests)for(const row of files)await readFileRow(root,row.path,readInput,row);
 }
 return {mode,site:root,phoneRoot:phone.root,phonePrefix,manifest,manifests:manifests.map(({root,manifest,files})=>({root,artifact:manifest.artifact,files})),files:outer.files,sourceRoot:canonicalSource,sourceFiles,sourceOrigin:{...composition,declaredPublicInputs:manifest.source?.inputs?.map(row=>row.path)||[],stageDeclaredInputs:outer!==phone?outer.manifest.sourceFiles?.map(row=>row.path)||[]:[],observedCurrentComposers:mode==='current'?composers:[],limitations:['Exact current composition equality does not certify historical asset renderer/encoder, pre-entry module cache, OS/GPU dependencies, perceptual fidelity or physical phone performance.']},statePath:join(canonicalSource,statePath),maskPath:join(canonicalSource,maskPath),performanceAcceptance:mode==='historical'?'historical capture only':'current public source composition equality; fidelity and phone performance require their separate checks'};
}

export async function verifyPhoneTargetUnchanged(admission,{readInput}={}){
 if(typeof readInput!=='function')fail('a bounded regular-file reader is required');
 for(const {root,files}of admission.manifests)for(const row of files)await readFileRow(root,row.path,readInput,row);
 for(const row of admission.sourceFiles)await readFileRow(admission.sourceRoot,row.path,readInput,row);
 return {verified:true,artifacts:admission.manifests.map(item=>item.artifact),declaredFiles:admission.manifests.reduce((n,item)=>n+item.files.length,0),sourceInputs:admission.sourceFiles.length};
}

export function judgePhoneResource(admission,value,{origin}={}){
 if(admission.mode==='historical')return [];
 const prefix=admission.phonePrefix||'',allowed=new Set(admission.manifest.files.map(row=>prefix+'/'+row.path));let resource;
 try{resource=new URL(value);}catch{return ['invalid observed phone resource'];}
 const path=resource.pathname===prefix+'/'?prefix+'/index.html':resource.pathname;
 return resource.origin===origin&&allowed.has(path)?[]:['resource is outside the declared phone artifact: '+value];
}

export function judgePhoneObservation(admission,observation,{origin,expectedTheme='day'}={}){
 if(admission.mode==='historical')return [];
 const issues=[],prefix=admission.phonePrefix||'';
 if(!['day','night'].includes(expectedTheme))issues.push('unknown intended phone theme');
 let url;try{url=new URL(observation?.url);}catch{issues.push('invalid observed phone URL');}
 if(url&&(url.origin!==origin||url.pathname!==prefix+'/'+(expectedTheme==='night'?'night':'day')+'.html'))issues.push('observed route is not the intended fixed phone theme');
 if(observation?.theme!==expectedTheme||observation?.phone!==true||observation?.desktop!==false||observation?.ready!=='complete'||observation?.visibility!=='visible')issues.push('positive ready phone/theme/content marker missing');
 if(!Array.isArray(observation?.resources)||!observation.resources.length)issues.push('positive phone resource observations missing');
 for(const value of observation?.resources||[])issues.push(...judgePhoneResource(admission,value,{origin}));
 return issues;
}

/** Per-journey lifecycle shared by the real verifier and nonbrowser fake-context regression. */
export function createPhoneJourneyScope({browser,runtime,report,selected=null,loads=()=>[]}={}){
 if(typeof browser?.contexts!=='function'||typeof runtime?.deadline!=='function'||!report||!Array.isArray(report.failures))fail('journey lifecycle requires an owned browser/runtime/report');
 let active=null,unsafe=false;const errors=new Set();report.journeyCleanup??=[];report.browserErrors??=[];
 return {
  captureContext(context){active?.contexts.add(context);return active?.name||'outside a journey';},
  noteBrowserError({journey,kind,message,url=''}){const key=journey+' '+kind+': '+message;if(errors.has(key))return;errors.add(key);report.browserErrors.push({journey,kind,message,url});report.failures.push(key);},
  get cleanupUnsafe(){return unsafe;},
  async block(name,fn){
   if(selected&&!selected.some(prefix=>name.startsWith(prefix)))return;
   if(unsafe){report.notExecutedJourneys??=[];report.notExecutedJourneys.push({name,reason:'prior journey cleanup failed'});report.failures.push(name+' not run: prior journey cleanup failed');return;}
   const scope={name,contexts:new Set(),before:new Set(browser.contexts()),loadStart:loads().length};active=scope;report.executedJourneys??=[];report.executedJourneys.push(name);
   try{await fn();}catch(error){report.failures.push(name+' crashed: '+String(error?.message||error).split('\n')[0]);}
   finally{
    const started=Date.now(),deadlineAt=started+8000,issues=[];
    try{for(const context of browser.contexts())if(!scope.before.has(context))scope.contexts.add(context);}catch(error){issues.push('context discovery: '+String(error?.message||error));}
    const budget=()=>Math.max(1,deadlineAt-Date.now());
    try{await runtime.deadline('finish '+name+' phone readiness observations',()=>Promise.all(loads().slice(scope.loadStart)),{timeoutMs:budget(),cleanup:true});}catch(error){issues.push('readiness observations: '+error.message);}
    try{const closed=await runtime.deadline('close '+name+' contexts and CDP',()=>Promise.allSettled([...scope.contexts].map(context=>Promise.resolve().then(()=>context.close()))),{timeoutMs:budget(),cleanup:true});for(const result of closed)if(result.status==='rejected')issues.push(result.reason?.message||String(result.reason));}catch(error){issues.push(String(error?.message||error));}
    active=null;report.journeyCleanup.push({name,contexts:scope.contexts.size,durationMs:Date.now()-started,errors:issues});
    if(issues.length){unsafe=true;report.failures.push(name+' cleanup failed: '+issues.join('; '));}
   }
  }
 };
}
