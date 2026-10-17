/** Optional explicit mobile-art jobs. Ordinary composition never imports this. */
import assert from 'node:assert/strict';
import {access,lstat,realpath,open,writeFile,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createToolRuntime,validateTimerBudget,deadline} from './mobile-art/lifecycle/tool-runtime.mjs';
import {readRegularInput} from './mobile-art/lifecycle/tool-operations.mjs';
import {ART_PINS,artHash,hashToolFile,admitArtPackage,recordArtPackages,verifyArtToolchainEpoch} from './mobile-art/lifecycle/art-toolchain.mjs';
import {validateArtDescriptor,verifyPreparedArt,recoverArtTransaction} from './mobile-art/lifecycle/art-transaction.mjs';

const ROOT=resolve(import.meta.dirname,'..'),PACKAGE=join(import.meta.dirname,'mobile-art');
const ENV_KEYS=['HW_TOOL_RUN_TOKEN','HW_TOOL_RUN_DIR','HW_TOOL_SCOPE_TOKEN','HW_TOOL_SUPERVISED','HW_TOOL_SERIAL_LEASE','HW_TOOL_IDENTITY_BINARY','HW_TOOL_ORIGINAL_TMPDIR','TMPDIR','TMP','TEMP','SHARP_IGNORE_GLOBAL_LIBVIPS'];
let activeJob=false;
const pathOption=(name,value)=>{assert(typeof value==='string'&&value.trim()&&value.length<=4096,name+' must be a nonempty local path');return resolve(value);};
export function artJobOptions(options,operation,{platform=process.platform,transaction=false}={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options),'art job options must be an object');
 const allowed=transaction?['timeoutMs','shutdownMs','output','projectRoot','sourcePath']:['timeoutMs','shutdownMs','output','browserExecutable','sharpModule','playwrightModule'];
 for(const key of Object.keys(options))assert(allowed.includes(key),'unknown art job option '+key);
 assert(typeof operation==='function','art job operation must be a function');
 const timeoutMs=validateTimerBudget('art job timeoutMs',options.timeoutMs??(transaction?60000:600000)),shutdownMs=validateTimerBudget('art job shutdownMs',options.shutdownMs??8000);assert(shutdownMs<=8000,'art shutdownMs exceeds8000');
 const output=pathOption('output',options.output);let plan;
 if(transaction){const projectRoot=pathOption('projectRoot',options.projectRoot),sourcePath=pathOption('sourcePath',options.sourcePath),parent=join(projectRoot,'source/mobile');assert(sourcePath===join(parent,'art')&&/^\.art-stage-[a-f0-9-]{36}$/.test(basename(output))&&dirname(output)===parent,'transaction must bind the selected project art and unique sibling stage');plan={projectRoot,sourcePath};}
 else{assert(output!==ROOT&&!['source','tools','.git','.audit','site','evidence'].some(p=>output===join(ROOT,p)||output.startsWith(join(ROOT,p)+'/')),'art output must not overwrite source/tools/site/evidence');plan={browserExecutable:pathOption('browserExecutable',options.browserExecutable),modules:{sharp:options.sharpModule===undefined?join(PACKAGE,'node_modules/sharp/dist/index.mjs'):pathOption('sharpModule',options.sharpModule),'playwright-core':options.playwrightModule===undefined?join(PACKAGE,'node_modules/playwright-core/index.mjs'):pathOption('playwrightModule',options.playwrightModule)},overrides:{sharp:options.sharpModule!==undefined,'playwright-core':options.playwrightModule!==undefined}};}
 if(platform!=='darwin'){const error=Error('UNSUPPORTED: optional art native ownership currently supports macOS; Windows Job Object ownership is not implemented');error.code='HW_ART_PLATFORM_UNSUPPORTED';error.exitCode=64;throw error;}
 return {timeoutMs,shutdownMs,output,transaction,...plan};
}
export const artNetworkAllowed=url=>typeof url==='string'&&/^(?:data:|blob:|about:)/.test(url);
export function publicToolchainReceipt(fields={}){
 return {schema:1,kind:'optional-public-mobile-art-toolchain',...fields,scope:['Disk byte hashes and file incarnations of recorded Node, public tools and installed packages/native files; successful jobs require an unchanged final disk epoch','Pre-entry module caches and complete executed dependency/OS closure are not certified','No physical phone or visual fidelity acceptance','OS system libraries, GPU driver and complete compiler SDK are not attested']};
}
const DENY_PROXY={server:'http://127.0.0.1:1',bypass:'<-loopback>'};
async function outputOwnership(runtime,path){
 const info=await lstat(path),marker=JSON.parse(await readRegularInput(join(path,'.hw-tool-owner'),{runtime,maxBytes:4096}));
 assert(info.isDirectory()&&!info.isSymbolicLink()&&marker.token===runtime.runId,'Output ownership changed');return {path,dev:info.dev,ino:info.ino,token:marker.token,resourceId:marker.resourceId};
}
export async function readBoundedArtDescriptor(handle,size){
 assert(Number.isSafeInteger(size)&&size>0&&size<=1024*1024,'Registry must be bounded regular data');
 const bytes=Buffer.alloc(size+1);let offset=0;
 while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,null);assert(Number.isSafeInteger(bytesRead)&&bytesRead>=0&&bytesRead<=bytes.length-offset,'Invalid registry read length');if(!bytesRead)break;offset+=bytesRead;}
 assert(offset===size,'Art registry changed while reading');return bytes.subarray(0,offset);
}
async function readRegistry(path){
 const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW||0));try{const before=await handle.stat();assert(before.isFile(),'Registry must be bounded regular data');const bytes=await readBoundedArtDescriptor(handle,before.size),after=await handle.stat();assert(after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'Art registry changed while reading');return bytes;}finally{await handle.close();}
}
async function updateRecord(runtime,record,change,{cleanup=false}={}){
 return runtime.deadline('update exact owned art transaction registry',async()=>{
 const path=join(runtime.runDir,'resources',record.resourceId+'.json'),bytes=await readRegistry(path);assert(bytes.toString()===JSON.stringify(record)&&record.token===runtime.runId&&!record.released,'Art transaction registry changed');
 const next={...record,...change},staged=path+'.art-'+randomUUID()+'.new';await writeFile(staged,JSON.stringify(next),{flag:'wx',mode:0o600});
 try{assert((await readRegistry(path)).equals(bytes),'Art registry changed before update');await rename(staged,path);return next;}finally{try{await unlink(staged);}catch(e){if(e.code!=='ENOENT')throw e;}}
 },{timeoutMs:2000,cleanup});
}
function transactionAPI(runtime,plan,ownedOutputs){
 const transactions=new Map();
 return {
  async registerArtTransaction(descriptor){
   assert(transactions.size===0,'one art directory transaction per owned job');const ownership=ownedOutputs.get(descriptor?.stagePath);validateArtDescriptor(descriptor,{projectRoot:plan.projectRoot,ownership});assert(descriptor.sourcePath===plan.sourcePath,'Transaction source binding changed');
   const details={...structuredClone(descriptor),ownership,projectRoot:plan.projectRoot,phase:'PREPARED'};await runtime.deadline('verify complete art transaction before registration',()=>verifyPreparedArt(details,{signal:runtime.signal,deadlineAt:Date.now()+10000}),{timeoutMs:10000});
   const record=runtime.registerResource('mobile-art-directory',details),handle=Object.freeze({resourceId:record.resourceId});const entry={record,unregister:null};transactions.set(handle,entry);
   entry.unregister=runtime.onCleanup('recover owned art directory transaction',async()=>{const outcome=await recoverArtTransaction(entry.record,{run:runtime.ownerRecord,deadlineAt:Date.now()+Math.max(1,runtime.policy.shutdownMs-1000)});entry.record=await updateRecord(runtime,entry.record,{released:true,recovery:outcome},{cleanup:true});});return handle;
  },
  async updateArtTransaction(handle,{phase}={}){
   const entry=transactions.get(handle);assert(entry,'Unknown art transaction handle');const phases=['PREPARED','OLD_BACKED_UP','NEW_PROMOTED','COMMITTED'];assert(phases.indexOf(phase)===phases.indexOf(entry.record.phase)+1,'Art transaction phase must advance exactly once');if(phase==='COMMITTED')await verifyArtToolchainEpoch(runtime);entry.record=await updateRecord(runtime,entry.record,{phase});
  },
  async moveArtTransaction(handle,{phase}={}){
   const entry=transactions.get(handle);assert(entry&&!entry.record.released,'Unknown or released art transaction handle');const record=entry.record;
   assert(phase==='OLD_BACKED_UP'&&record.phase==='PREPARED'||phase==='NEW_PROMOTED'&&record.phase==='OLD_BACKED_UP','Art directory move must advance the exact registered phase');
   const source=phase==='OLD_BACKED_UP'?record.sourcePath:record.stagePath,target=phase==='OLD_BACKED_UP'?record.backupPath:record.sourcePath,expected=phase==='OLD_BACKED_UP'?record.old:record.new;
   await runtime.deadline('move exact art directory without replacing foreign target',async()=>{
    const info=await lstat(source),parent=await lstat(record.parent.path);assert(info.isDirectory()&&!info.isSymbolicLink()&&info.dev===expected.dev&&info.ino===expected.ino&&parent.isDirectory()&&!parent.isSymbolicLink()&&parent.dev===record.parent.dev&&parent.ino===record.parent.ino&&await realpath(record.parent.path)===record.parent.path,'Art move source/parent incarnation changed');
    const result=await runtime.runCommand(runtime.ownerRecord.helper.binary,['--move-directory-no-replace',source,target,String(expected.dev),String(expected.ino),String(parent.dev),String(parent.ino),runtime.runId],{timeoutMs:3000,label:'atomic typed art directory move'});assert(result.status===0,result.stderr||'Owned typed art move failed with '+result.status);
    const moved=await lstat(target),parentAfter=await lstat(record.parent.path);assert(moved.isDirectory()&&!moved.isSymbolicLink()&&moved.dev===expected.dev&&moved.ino===expected.ino&&parentAfter.isDirectory()&&!parentAfter.isSymbolicLink()&&parentAfter.dev===record.parent.dev&&parentAfter.ino===record.parent.ino,'Art move incarnation changed at publication; preserved for recovery');try{await lstat(source);throw Error('Unexpected directory appeared at vacated art path; preserved');}catch(error){if(error.code!=='ENOENT')throw error;}
   },{timeoutMs:5000});entry.record=await updateRecord(runtime,entry.record,{phase});
  },
  async finishArtTransaction(handle){
   const entry=transactions.get(handle);assert(entry&&entry.record.phase==='COMMITTED','Art transaction must be committed before release');const outcome=await runtime.deadline('finish committed art directory transaction',()=>recoverArtTransaction(entry.record,{run:runtime.ownerRecord,signal:runtime.signal,deadlineAt:Date.now()+6000}),{timeoutMs:6000});assert(outcome.state==='NEW_ART_PRESERVED','Committed transaction did not retain complete new art');entry.record=await updateRecord(runtime,entry.record,{released:true,recovery:outcome});entry.unregister();transactions.delete(handle);return outcome;
  }
 };
}
async function installBrowserAPI(runtime,api,plan,selected,setReceipt){
 const blocked=[];let playwright,sharp;
 api.loadSharp=async()=>{if(!sharp){process.env.SHARP_IGNORE_GLOBAL_LIBVIPS='1';const module=await runtime.deadline('load pinned local Sharp',()=>import(pathToFileURL(selected.sharp.entry).href),{timeoutMs:10000});sharp=module.default||module;assert(sharp.versions?.sharp===ART_PINS.sharp,'Loaded Sharp version changed');setReceipt('encoder',{version:sharp.versions.sharp,versions:sharp.versions,selection:'recorded installed native package; global libvips disabled'});}return sharp;};
 api.assertNoOutbound=()=>{assert(blocked.length===0,'Art renderer attempted outbound requests: '+JSON.stringify(blocked));};
 api.launchChromium=async()=>{
  if(!playwright){playwright=await runtime.deadline('load pinned local Playwright',()=>import(pathToFileURL(selected['playwright-core'].entry).href),{timeoutMs:10000});assert(playwright.chromium,'Pinned Playwright has no Chromium launcher');}
  // Playwright creates profile/artifacts under os.tmpdir. Its dedicated runtime
  // scratch is marker-owned; the owned launcher and child inherit that root.
  let server,browser,rawBrowserClose,closing;const contexts=new Set();
  const close=()=>closing??=(async()=>{const errors=[];for(const context of [...contexts])try{await context.close();}catch(e){errors.push(e);}try{if(rawBrowserClose)await runtime.deadline('close owned browser transport',rawBrowserClose,{timeoutMs:2000,cleanup:true});}catch(e){errors.push(e);}finally{try{if(server)await runtime.deadline('close owned browser server',()=>server.close(),{timeoutMs:2000,cleanup:true});}catch(e){errors.push(e);}}if(errors.length)throw new AggregateError(errors,'Owned art browser close failed');})();
  const unregister=runtime.onCleanup('close owned art browser and contexts',close);
  try{
   server=await runtime.deadline('launch installed owned Chromium',()=>playwright.chromium.launchServer({headless:true,host:'127.0.0.1',port:0,executablePath:plan.browserExecutable,proxy:DENY_PROXY,args:['--disable-background-networking','--disable-component-update'],env:{...process.env,PWDEBUG:'0'},timeout:15000}),{timeoutMs:16000});await runtime.registerProcess(server.process(),{label:'owned art Chromium'});
   const endpoint=new URL(server.wsEndpoint());assert(['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname),'Art browser RPC must be loopback-only');
   browser=await runtime.deadline('connect owned browser RPC',()=>playwright.chromium.connect(server.wsEndpoint(),{timeout:10000}),{timeoutMs:11000});rawBrowserClose=browser.close.bind(browser);setReceipt('browser',{version:browser.version(),executable:await hashToolFile(runtime,plan.browserExecutable),network:'dead proxy including loopback + offline contexts + deny-all routes'});
   const newContext=browser.newContext.bind(browser);browser.close=async()=>{await close();unregister();};browser.newPage=()=>{throw Error('Use guarded browser.newContext().newPage() for optional art');};
   browser.newContext=async options=>{
    assert(contexts.size===0,'Close the preceding art context before opening the next; one active context per browser keeps cleanup bounded');
    const context=await runtime.deadline('create guarded art context',()=>newContext({...options,proxy:DENY_PROXY,offline:true,serviceWorkers:'block',acceptDownloads:false}),{timeoutMs:10000});contexts.add(context);let contextClosing;const rawClose=context.close.bind(context);
    context.close=()=>contextClosing??=runtime.deadline('close owned art context',()=>rawClose(),{timeoutMs:3000,cleanup:true}).then(()=>contexts.delete(context));context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(15000);
    await runtime.deadline('deny art context network',()=>context.route('**/*',route=>{const url=route.request().url();if(artNetworkAllowed(url))return route.continue();blocked.push({url,resourceType:route.request().resourceType()});return route.abort('blockedbyclient');}),{timeoutMs:5000});
    const newPage=context.newPage.bind(context);context.newPage=async()=>{const page=await runtime.deadline('create owned art page',()=>newPage(),{timeoutMs:10000});for(const name of ['setContent','screenshot','evaluate']){const original=page[name].bind(page);page[name]=(...args)=>runtime.deadline('art page '+name,()=>original(...args),{timeoutMs:20000});}return page;};return context;
   };return browser;
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Art browser launch and cleanup failed');}throw error;}
 };
}
async function ownedJob(plan,operation){
 assert(!activeJob,'one art callback per Node worker; launch separate CLI workers for independent parallel jobs');activeJob=true;
 const savedEnv=Object.fromEntries(ENV_KEYS.map(k=>[k,process.env[k]])),priorExitCode=process.exitCode;let runtime,result,error;
 for(const key of ENV_KEYS.filter(k=>k.startsWith('HW_')))delete process.env[key];
 try{
  runtime=createToolRuntime({name:'optional public mobile-art '+(plan.transaction?'transaction':'job'),runTimeoutMs:plan.timeoutMs,stepTimeoutMs:30000,shutdownMs:plan.shutdownMs});await runtime.ready;
  await runtime.deadline('validate fresh canonical art output parent',async()=>{assert(await realpath(dirname(plan.output))===dirname(plan.output),'Output parent must be canonical');try{await lstat(plan.output);throw Error('Art output must be fresh');}catch(e){if(e.code!=='ENOENT')throw e;}},{timeoutMs:5000});
  const ownedOutputs=new Map(),api={deadline:(label,fn,opts)=>runtime.deadline(label,fn,opts),withPhaseDeadline:(label,fn,opts)=>runtime.withPhaseDeadline(label,fn,opts),tempDir:label=>runtime.deadline('create owned art scratch directory',()=>runtime.tempDir(label),{timeoutMs:5000}),
   async ensureOutputDirectory(path,{reason}={}){path=resolve(path);assert(path===plan.output&&typeof reason==='string'&&reason.trim(),'Output creation must bind the selected fresh directory and reason');assert(!ownedOutputs.has(path),'Output already created');const record=await runtime.deadline('create and atomically publish exact owned art output',async()=>{const source=await runtime.tempDir('art-output-',{reason});await runtime.publishTempNoReplace(source,path);return outputOwnership(runtime,path);},{timeoutMs:5000});ownedOutputs.set(path,record);return record;},
   async registerOutput(path,{keep=false,reason}={}){path=resolve(path);assert(path===plan.output&&keep===false&&typeof reason==='string'&&reason.trim()&&ownedOutputs.has(path),'Create output via ensureOutputDirectory before registering; ad hoc mkdir cannot prove parent-death ownership');const record=await outputOwnership(runtime,path);assert(JSON.stringify(record)===JSON.stringify(ownedOutputs.get(path)),'Output ownership changed');return record;},
   async preserveOutput(path,reason){assert(!plan.transaction&&resolve(path)===plan.output&&ownedOutputs.has(resolve(path))&&typeof reason==='string'&&reason.trim(),'Only a registered complete render bundle can be retained');return runtime.retainTemp(path,{owner:'optional public mobile-art job',reason,requireSuccessfulCompletion:true,evidence:{kind:'complete-art-bundle',toolchainSha256:artHash(JSON.stringify(api.toolchainReceipt()))}});}
  };
  const fields=await runtime.withPhaseDeadline('optional art toolchain admission',async()=>{
  const core=[];
  for(const name of ['mobile-art-runtime.mjs','mobile-art-integrity.mjs',...['tool-runtime.mjs','run-supervised.mjs','process-identity.c','tool-operations.mjs','command-acceptance.mjs','cleanup-resource-actions.mjs','art-transaction.mjs','art-toolchain.mjs','temp-allocation.mjs','bootstrap-lease.mjs','phase-deadline.mjs'].map(n=>'mobile-art/lifecycle/'+n)])core.push({path:'tools/'+name,...await hashToolFile(runtime,join(import.meta.dirname,name))});
  const fields={node:{version:process.version,platform:process.platform,arch:process.arch,versions:process.versions,executable:await hashToolFile(runtime,process.execPath)},core,native:{sourceSha256:runtime.ownerRecord.helper.sourceSha256,binarySha256:(await hashToolFile(runtime,runtime.ownerRecord.helper.binary)).sha256,platform:process.platform,arch:process.arch,compilerRecipe:'installed cc -O2 -Wall -Wextra; bounded compiler guardian'},packages:[],browser:{status:'NOT_LOADED'},encoder:{status:'NOT_LOADED'},inputEpoch:{status:'OBSERVED_START',successfulCompletionRequires:'MATCHED_AFTER_OPERATION'}};
  assert(fields.native.binarySha256===runtime.ownerRecord.helper.binarySha256,'Native helper changed before art admission');
  api.toolchainReceipt=()=>publicToolchainReceipt(structuredClone(fields));api.verifyToolchainUnchanged=async()=>{fields.inputEpoch=await verifyArtToolchainEpoch(runtime);return structuredClone(fields.inputEpoch);};
  if(plan.transaction)Object.assign(api,transactionAPI(runtime,plan,ownedOutputs));
  else{
   plan.browserExecutable=await runtime.deadline('validate installed browser executable',async()=>{const path=await realpath(plan.browserExecutable);assert((await lstat(path)).isFile(),'Browser executable must be regular');await access(path,constants.X_OK);return path;},{timeoutMs:5000});
   const selected={};for(const [name,path]of Object.entries(plan.modules))selected[name]=await runtime.deadline('admit pinned installed '+name,()=>admitArtPackage(runtime,name,path),{timeoutMs:10000});
   fields.packages=await recordArtPackages(runtime,selected,{lockPath:join(PACKAGE,'package-lock.json'),overrides:plan.overrides});fields.browser.executable=await hashToolFile(runtime,plan.browserExecutable);
   await installBrowserAPI(runtime,api,plan,selected,(key,value)=>{fields[key]=value;});
  }
  return fields;
  },{timeoutMs:60000});
  api.admitProducerInputs=async scope=>{
   assert(scope==='regenerate'||scope==='apply','Unknown optional producer scope');
   const {PHONE_COMPOSERS}=await runtime.deadline('load public producer closure',()=>import('./mobile-origin.mjs'),{timeoutMs:10000}),paths=[...new Set([...PHONE_COMPOSERS,'tools/regenerate-mobile-art.mjs','tools/apply-mobile-art-bundle.mjs','tools/mobile-art-plan.mjs','tools/mobile-art-integrity.mjs','tools/mobile-art-project.mjs'])];assert(paths.length<=64,'Optional producer closure exceeds64files');
   const records=[];for(const path of paths){assert(/^((tools|source)\/)[A-Za-z0-9@._/-]+$/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe optional producer input');records.push({path,...await hashToolFile(runtime,join(ROOT,path))});}
   fields.producers??={};fields.producers[scope]={files:records,scope:'Recorded disk bytes/incarnations of actual optional caller and direct public composer/planning modules; pre-entry parsed module cache is not certified'};return structuredClone(fields.producers[scope]);
  };
  result=await operation(api);api.assertNoOutbound?.();fields.inputEpoch=await runtime.withPhaseDeadline('verify successful optional art input epoch',()=>verifyArtToolchainEpoch(runtime),{timeoutMs:60000});
 }catch(caught){error=caught;console.error('[art job] '+caught.message);process.exitCode=process.exitCode||(caught.code===124?124:1);}
 finally{
  try{if(runtime){const cleanup=await runtime.shutdown(error?'art job failed':'art job complete');if(cleanup.errors.length)error=new AggregateError([...(error?[error]:[]),...cleanup.errors.map(e=>Error(e))],'Art job cleanup failed');
   if(runtime.supervisorClosed){const guard=await deadline('independent art guardian cleanup completion',runtime.supervisorClosed,{timeoutMs:Math.max(1,runtime.shutdownDeadlineAt-Date.now())});assert(guard.code===0||error,'Independent art guardian failed: '+JSON.stringify(guard));if(guard.code!==0&&!error)throw Error('Art guardian did not complete successfully');}
  }}catch(cleanup){error=new AggregateError([...(error?[error]:[]),cleanup],'Art job cleanup failed');}
  for(const [key,value]of Object.entries(savedEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;process.exitCode=priorExitCode;activeJob=false;
 }
 if(error)throw error;return result;
}
export async function runOwnedArtJob(options,operation){return ownedJob(artJobOptions(options,operation),operation);}
export async function runOwnedArtTransaction(options,operation){return ownedJob(artJobOptions(options,operation,{transaction:true}),operation);}
