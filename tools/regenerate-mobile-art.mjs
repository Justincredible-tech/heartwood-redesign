// Explicit selected-art regeneration into a new complete review bundle. No source publication here.
// Ordinary builds do not import this command, Sharp, Playwright or the optional lifecycle.
import {resolve,join,basename} from 'node:path';
import {realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {runBoundedBuild} from './bounded-build.mjs';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createBuildOrigin,sha256,withDeadline} from './mobile-origin.mjs';
import {loadMobileSources} from './mobile-source-inputs.mjs';
import {encodeFor} from './mobile-art-encoding.mjs';
import {imageDimensions} from './build-mobile-inputs.mjs';
import {artRegenerationPlan,recordArtToolchain} from './mobile-art-plan.mjs';
import {writeOutput} from './build-output.mjs';
import {validateNativeArtOrigins} from './mobile-art-integrity.mjs';
import {requireCoLocatedArtProject} from './mobile-art-project.mjs';

const root=resolve(import.meta.dirname,'..'),ART='source/mobile/art';
const safe=name=>typeof name==='string'&&name.length<384&&/^[a-zA-Z0-9@.-]+\.(avif|webp)$/.test(name);
const list=value=>value===undefined?undefined:value.split(',').map(v=>v.trim());
export async function prepareArtRegeneration({projectRoot=root,only,photos=[],metadataOnly=false}={}){
 await requireCoLocatedArtProject(projectRoot,{executingRoot:root});
 const [{readContent},{artDocs},{loadNight}]=await Promise.all([import('../source/mobile/content.mjs'),import('../source/mobile/art.mjs'),import('../source/mobile/night.mjs')]);
 const origin=await createBuildOrigin({root});await origin.captureComposers();await origin.read(join(root,'tools/mobile-art-plan.mjs'));await origin.read(join(root,'tools/regenerate-mobile-art.mjs'));await origin.read(join(root,'tools/mobile-art-integrity.mjs'));await origin.read(join(root,'tools/mobile-art-project.mjs'));
 const inputs=await loadMobileSources({root,readInput:origin.read,inspectInput:origin.inspect,releaseInput:origin.release}),content=readContent(inputs.markup,{scriptSource:inputs.scriptSource}),night=await loadNight(root,{siteCss:inputs.artCss}),docs=artDocs(inputs.artSource,content.counts.groups,night);
 const mastersBytes=await origin.read(join(root,ART,'masters/masters.json')),encodedBytes=await origin.read(join(root,ART,'encoded/manifest.json')),masters=JSON.parse(mastersBytes),encoded=JSON.parse(encodedBytes);
 assert(encoded.schema===1&&encoded.files&&Object.keys(encoded.files).length<=2048,'Invalid bounded encoded source index');
 const plan=artRegenerationPlan({docs,masters,selected:only}),all=artRegenerationPlan({docs,masters});
 const excluded=all.filter(row=>row.action==='render'&&!plan.some(selected=>selected.name===row.name));assert(!excluded.length,'Selection excludes stale documents needed for a consistent bundle: '+excluded.map(row=>row.name).join(', '));
 assert(Array.isArray(photos)&&new Set(photos).size===photos.length&&photos.every(name=>inputs.photos.some(p=>p.name===name)),'Unknown or duplicate photo selection');
 const preserved=new Map();
 for(const doc of docs){const file='masters/'+doc.name+'@3x.png';let value;try{value=metadataOnly?await origin.inspect(join(root,ART,file),'png'):await origin.read(join(root,ART,file));}catch(error){if(error.code==='ENOENT'&&plan.some(row=>row.name===doc.name&&row.action==='render'))continue;throw error;}const digest=metadataOnly?value.row.sha256:sha256(value);assert.equal(digest,masters[doc.name]?.png,'Pinned master changed without a corresponding reviewed index: '+doc.name);const dimensions=metadataOnly?value.dimensions:imageDimensions(value,'png');assert(dimensions.width===masters[doc.name].w*3&&dimensions.height===masters[doc.name].h*3,'Pinned master header dimensions changed');preserved.set(file,value);}
 for(const [name,row]of Object.entries(encoded.files)){assert(safe(name)&&row&&Number.isInteger(row.bytes)&&row.bytes>0&&row.bytes<=8*1024*1024&&/^[a-f0-9]{64}$/.test(row.sha256||''),'Invalid encoded source row');const file=join(root,ART,'encoded',name),bytes=await origin.read(file);assert(bytes.length===row.bytes&&sha256(bytes)===row.sha256,'Encoded source changed: '+name);preserved.set('encoded/'+name,metadataOnly?{row}:bytes);if(metadataOnly)origin.release(file);}
 for(const doc of docs.filter(doc=>!doc.mask&&!plan.some(row=>row.name===doc.name))){const master=preserved.get('masters/'+doc.name+'@3x.png'),q=encodeFor(doc.name),key=(metadataOnly?master.row.sha256:sha256(master)).slice(0,12)+'-'+q.avif+'-'+q.webp;for(const dpr of [2,3])for(const format of ['avif','webp'])assert(preserved.has('encoded/'+doc.name+'@'+dpr+'x.'+key+'.'+format),'Unselected art needs encoding; include '+doc.name+' explicitly');}
 for(const p of inputs.photos.filter(p=>!photos.includes(p.name))){const key=p.sha256.slice(0,12);for(const width of p.widths)for(const format of ['avif','webp'])assert(preserved.has('encoded/'+p.name+'-'+width+'.'+key+'.'+format),'Photo needs derivatives; include --photos '+p.name+' explicitly');}
 return {origin,inputs,docs,plan,photos,masters,encoded,mastersBytes,encodedBytes,preserved};
}

export async function regenerateMobileArt({projectRoot=root,out,only,photos=[],browserExecutable,sharpModule,playwrightModule}={}){
 projectRoot=await requireCoLocatedArtProject(projectRoot,{executingRoot:root});
 assert(typeof out==='string'&&out.trim(),'Regeneration requires explicit --out NEW_DIRECTORY');out=resolve(out);
 // This public support module must be concretely packaged and independently reviewed before native use.
 const {runOwnedArtJob}=await import('./mobile-art-runtime.mjs');
 return runOwnedArtJob({timeoutMs:660000,shutdownMs:8000,output:out,browserExecutable,sharpModule,playwrightModule},async runtime=>{
  assert(typeof runtime.withPhaseDeadline==='function'&&typeof runtime.verifyToolchainUnchanged==='function','Owned art runtime lacks independent phase/epoch admission');
  const prepared=await runtime.withPhaseDeadline('phone art source admission',async()=>{assert(typeof runtime.admitProducerInputs==='function','Owned runtime lacks optional producer disk epoch');await runtime.admitProducerInputs('regenerate');return prepareArtRegeneration({projectRoot,only,photos});},{timeoutMs:60000});
  return runtime.withPhaseDeadline('selected phone art generation',async()=>{
  const {origin,inputs,docs,plan,masters,encoded,preserved}=prepared,newMasters={...masters},newEncoded={...encoded,files:{...encoded.files}},changed=[],errors=[];let browser=null,sharp=null,rendererReceipt,encoderReceipt;
  const rendererRef=async()=>recordArtToolchain(newMasters._toolchains??={...(masters._toolchains||{})},rendererReceipt??=await runtime.toolchainReceipt()),encoderRef=async()=>recordArtToolchain(newEncoded.toolchains??={...(encoded.toolchains||{})},encoderReceipt??=await runtime.toolchainReceipt());
  await runtime.ensureOutputDirectory(out,{reason:'in-progress selected art bundle'});
  const written=new Set(),emit=async(path,bytes)=>{assert(bytes.length>0&&bytes.length<=8*1024*1024,'Generated bundle file exceeds8MiB bound: '+path);if(written.has(path)){assert.equal(sha256(preserved.get(path)),sha256(bytes),'Conflicting bundle write');return;}await runtime.deadline('write bundle '+path,()=>writeOutput(out,path,bytes),{timeoutMs:10000});preserved.set(path,bytes);written.add(path);};
  const encoder=async()=>{if(!sharp){sharp=await runtime.loadSharp();assert.equal(sharp.versions.sharp,'0.35.5','Unreviewed Sharp version');sharp.concurrency(1);}return sharp;};
  try{
   for(const row of plan.filter(row=>row.action==='render')){
    const doc=docs.find(doc=>doc.name===row.name);browser??=await runtime.launchChromium();const ctx=await runtime.deadline('context '+doc.name,()=>browser.newContext({viewport:{width:doc.w,height:doc.h},deviceScaleFactor:3}),{timeoutMs:10000});let png;
    try{const page=await runtime.deadline('page '+doc.name,()=>ctx.newPage(),{timeoutMs:10000});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await runtime.deadline('render source '+doc.name,()=>page.setContent(doc.html,{waitUntil:'load',timeout:15000}),{timeoutMs:16000});png=await runtime.deadline('capture transparent3x '+doc.name,()=>page.screenshot({omitBackground:true,clip:{x:0,y:0,width:doc.w,height:doc.h},animations:'disabled',timeout:15000}),{timeoutMs:16000});}
    finally{await runtime.deadline('close '+doc.name+' context',()=>ctx.close(),{timeoutMs:5000,cleanup:true});}
    assert(!errors.length,'Art renderer page/console error: '+errors.join('; '));const dims=imageDimensions(png,'png');assert(dims.width===doc.w*3&&dims.height===doc.h*3,'Wrong transparent3x master dimensions');
    newMasters[doc.name]={doc:row.documentSha256,png:sha256(png),w:doc.w,h:doc.h,origin:{kind:'rendered',recipeSha256:row.documentSha256,toolchainSha256:await rendererRef()}};await emit('masters/'+doc.name+'@3x.png',png);changed.push(doc.name);
   }
   // Prefer every matching reviewed derivative. An unchanged cache hit never loads Sharp or requantizes pixels.
   for(const doc of docs.filter(doc=>!doc.mask&&plan.some(row=>row.name===doc.name))){
    const png=preserved.get('masters/'+doc.name+'@3x.png'),q=encodeFor(doc.name),key=sha256(png).slice(0,12)+'-'+q.avif+'-'+q.webp,dims=imageDimensions(png,'png');
    for(const dpr of [2,3]){let base=null;for(const format of ['avif','webp']){const name=doc.name+'@'+dpr+'x.'+key+'.'+format;if(preserved.has('encoded/'+name))continue;const s=await encoder();base??=dpr===3?png:await runtime.deadline('resize '+doc.name+'@2x',()=>s(png).resize(Math.round(dims.width*2/3),Math.round(dims.height*2/3),{kernel:'lanczos3'}).png().toBuffer(),{timeoutMs:30000});const settings=format==='avif'?{quality:q.avif,effort:7,chromaSubsampling:'4:2:0'}:{quality:q.webp,alphaQuality:90,effort:6,smartSubsample:true},bytes=await runtime.deadline('encode '+name,()=>s(base)[format](settings).toBuffer(),{timeoutMs:30000});await emit('encoded/'+name,bytes);newEncoded.files[name]={bytes:bytes.length,sha256:sha256(bytes),origin:{kind:'encoded-art',masterSha256:sha256(png),dpr,format,settings,resize:dpr===2?'lanczos3':'original',toolchainSha256:await encoderRef()}};}}
   }
   for(const name of photos){const p=inputs.photos.find(p=>p.name===name),key=p.sha256.slice(0,12);let input;for(const width of p.widths)for(const format of ['avif','webp']){const file=p.name+'-'+width+'.'+key+'.'+format;if(preserved.has('encoded/'+file))continue;input??=await origin.read(join(root,p.src));const s=await encoder(),settings=format==='avif'?{quality:52,effort:7}:{quality:78,effort:6},bytes=await runtime.deadline('encode photo '+file,()=>s(input).resize(width)[format](settings).toBuffer(),{timeoutMs:30000});await emit('encoded/'+file,bytes);newEncoded.files[file]={bytes:bytes.length,sha256:sha256(bytes),origin:{kind:'encoded-photo',sourcePath:p.src,sourceSha256:p.sha256,width,format,settings,toolchainSha256:await encoderRef()}};}origin.release(join(root,p.src));}
   for(const [path,bytes]of preserved)await emit(path,bytes);
   const nativeOriginAdmission=validateNativeArtOrigins({masters:newMasters,encoded:newEncoded,oldMasters:masters,oldEncoded:encoded,canonicalToolchain:await runtime.toolchainReceipt()});
   const mastersBytes=changed.length?Buffer.from(JSON.stringify(newMasters,null,1)+'\n'):prepared.mastersBytes,encodedChanged=Object.keys(newEncoded.files).some(name=>!encoded.files[name]),encodedBytes=encodedChanged?Buffer.from(JSON.stringify(newEncoded,null,2)+'\n'):prepared.encodedBytes;
   await emit('masters/masters.json',mastersBytes);await emit('encoded/manifest.json',encodedBytes);await origin.verify();await runtime.assertNoOutbound();await runtime.verifyToolchainUnchanged();
   const files=[...preserved].map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),receipt={schema:1,kind:'selected-public-phone-art-bundle',artifact:sha256(files.map(row=>row.path+':'+row.sha256).join('\n')),sourceInputs:origin.rows,selected:plan.map(row=>row.name),rendered:changed,files,sourceApplication:'NOT_APPLIED',nativeVisualFidelity:'NOT_ACCEPTED',nativeOriginAdmission,toolchain:await runtime.toolchainReceipt()};
   await runtime.deadline('publish complete bundle receipt',()=>writeOutput(out,'manifest.json',JSON.stringify(receipt,null,2)+'\n'),{timeoutMs:10000});await runtime.preserveOutput(out,'complete reviewable public art bundle; source application pending');return {out,manifest:receipt};
  }finally{if(browser)await runtime.deadline('close owned art browser',()=>browser.close(),{timeoutMs:5000,cleanup:true});}
  },{timeoutMs:600000});
 });
}
// Only plain planning data crosses the portable worker boundary. Origins/functions stay local.
export async function describeArtRegeneration(options={}){const prepared=await prepareArtRegeneration({...options,metadataOnly:true});await prepared.origin.verify();return {plan:prepared.plan,photos:prepared.photos,browserRequired:prepared.plan.some(row=>row.action==='render'),inputReadStats:prepared.origin.stats,scope:'recipe/source planning only; no renderer, encoder or source update'};}
if(import.meta.main??(process.argv[1]&&import.meta.url===pathToFileURL(await withDeadline('canonical regeneration CLI entry',()=>realpath(resolve(process.argv[1])))).href)){
 const {values}=parseArgs({options:{help:{type:'boolean'},plan:{type:'boolean'},only:{type:'string'},photos:{type:'string'},out:{type:'string'},root:{type:'string'},browser:{type:'string'},'sharp-module':{type:'string'},'playwright-module':{type:'string'}}});
 if(values.help)console.log('Usage: node tools/regenerate-mobile-art.mjs --plan [--only roots,roots-night] [--photos cover,poster]\nExplicit regeneration: --out NEW_DIRECTORY --browser INSTALLED_EXECUTABLE; --root must resolve to this tools project. Optional public dependencies must already be installed. No source application is implicit.');
 else if(values.plan){const projectRoot=await requireCoLocatedArtProject(values.root??root,{executingRoot:root});const result=await runBoundedBuild({entry:import.meta.url,method:'describeArtRegeneration',args:[{projectRoot,only:list(values.only),photos:list(values.photos)||[]}],out:join(await withDeadline('canonical plan scratch parent',()=>realpath(tmpdir())),'heartwood-plan-'+randomUUID()),projectRoot,useWriter:false,timeoutMs:60000,onStep:step=>console.error('[art plan] '+step)});console.log(JSON.stringify(result,null,2));}
 else{const result=await regenerateMobileArt({projectRoot:values.root??root,out:values.out,only:list(values.only),photos:list(values.photos)||[],browserExecutable:values.browser,sharpModule:values['sharp-module'],playwrightModule:values['playwright-module']});console.log(JSON.stringify({out:result.out,artifact:result.manifest.artifact,rendered:result.manifest.rendered,sourceApplication:result.manifest.sourceApplication}));}
}
