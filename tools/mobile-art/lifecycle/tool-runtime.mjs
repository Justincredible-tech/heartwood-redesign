// Shared lazy lifecycle policy. No resources or watchers start merely on import.
// Parallel runs are the default. An independent watchdog survives a blocked or
// dead worker; cleanup authorizes exact PID birth + random run/resource tokens.
import {spawn as spawnChild,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,renameSync,statSync,lstatSync,realpathSync,openSync,fstatSync,closeSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {tmpdir,constants as osConstants} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {makeAllocationRequest,requestTempAllocation} from './temp-allocation.mjs';
import {readBootstrapBytes,readBootstrapJSON} from './bootstrap-lease.mjs';
import {makePhaseDeadline,readPhaseDeadline} from './phase-deadline.mjs';

const ROOT=resolve(import.meta.dirname,'..');
const SUPERVISOR=resolve(import.meta.dirname,'run-supervised.mjs');
export const TOKEN_ENV='HW_TOOL_RUN_TOKEN';
const ORIGINAL_TMPDIR=process.env.HW_TOOL_ORIGINAL_TMPDIR||tmpdir();
const hash=b=>createHash('sha256').update(b).digest('hex');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const CHILD_CAPTURE=Symbol('command capture installed before registration');
const assertNotAborted=signal=>{if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new Error('operation cancelled before resource acquisition');};
const positive=(name,v)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0)throw Error(name+' must be finite and positive');};
export function validateTimerBudget(name,value){positive(name,value);if(!Number.isInteger(value)||value>2147483647)throw Error(name+' exceeds supported timer range (1..2147483647 ms)');return value;}
export class DeadlineError extends Error{constructor(label,timeoutMs){super(`stuck at ${label} after ${timeoutMs} ms`);this.name='DeadlineError';this.code=124;this.timeoutMs=timeoutMs;}}
export function validateRuntimeOptions(options={}){
 const o={name:process.argv[1]||'tool',runTimeoutMs:900000,stepTimeoutMs:30000,shutdownMs:8000,heartbeatMs:15000,serial:false,persistent:false,...options};
 if(o.runTimeoutMs===null){if(!o.persistent||!o.reason)throw Error('unbounded foreground service requires persistent:true and an owner reason');}else validateTimerBudget('runTimeoutMs',o.runTimeoutMs);
 for(const k of ['stepTimeoutMs','shutdownMs','heartbeatMs'])validateTimerBudget(k,o[k]);if(o.shutdownMs>10000)throw Error('shutdownMs must not exceed 10000');return o;
}
export function canSignalProcess(record,actual,token){
 if(!record||!actual||record.pid<=1||record.pid!==actual.pid||!record.birth||record.birth!==actual.birth||record.token!==token)return false;
 return record.role==='worker'||record.role==='caller-owned'||actual.token===token||actual.tokenMatched===true;
}
export function canRemoveTemp(record,actual,marker,token){return !!record&&!!actual&&!!marker&&record.token===token&&marker.token===token&&marker.resourceId===record.resourceId&&record.dev===actual.dev&&record.ino===actual.ino;}
export async function deadline(label,operation,{timeoutMs=30000,signal}={}){
 validateTimerBudget('timeoutMs',timeoutMs);if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new Error('aborted: '+label);const controller=new AbortController();let timer,onAbort;
 const cancel=new Promise((_,reject)=>{onAbort=()=>{controller.abort(signal?.reason);reject(signal?.reason instanceof Error?signal.reason:new Error('aborted: '+label));};if(signal?.aborted)return onAbort();signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>{const e=new DeadlineError(label,timeoutMs);controller.abort(e);reject(e);},timeoutMs);});
 try{return await Promise.race([cancel,Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason||new Error('aborted: '+label);return typeof operation==='function'?operation(controller.signal):operation;})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
const atomicJSON=(path,obj)=>{const t=path+'.'+randomUUID()+'.new';writeFileSync(t,JSON.stringify(obj),{mode:0o600});renameSync(t,path);};

// Verified project-local helper artifact; no global cache or package installation.
export function prepareIdentity(){
 const source=resolve(import.meta.dirname,'process-identity.c'),sourceSha=hash(readBootstrapBytes(source,1024*1024)),key=hash(sourceSha+process.platform+process.arch).slice(0,24);
 const artifact=resolve(ROOT,'.cache/native-'+key),manifest=join(artifact,'manifest.json'),binary=join(artifact,'process-identity');
 if(existsSync(manifest)){const m=readBootstrapJSON(manifest,8192);if(m.sourceSha256!==sourceSha||m.binarySha256!==hash(readBootstrapBytes(binary,2*1024*1024)))throw Error('identity helper provenance mismatch');return {binary,...m};}
 mkdirSync(dirname(artifact),{recursive:true});const guardToken=randomUUID();
 try{execFileSync(process.execPath,[SUPERVISOR,'--compile-identity',source,artifact,sourceSha,guardToken],{timeout:10000,killSignal:'SIGKILL',detached:true,stdio:'pipe',env:{...process.env,HW_IDENTITY_GUARD_TOKEN:guardToken}});
  const m=readBootstrapJSON(manifest,8192);if(m.sourceSha256!==sourceSha||m.binarySha256!==hash(readBootstrapBytes(binary,2*1024*1024)))throw Error('identity helper publication differs');return {binary,...m};
 }catch(e){throw new Error('process identity unavailable; no managed work launched: '+e.message);}

}
function inheritedIdentity(dir,token){
 const meta=readBootstrapJSON(join(dir,"run.json"),8*1024*1024),stored=meta.helper;
 if(meta.schema!==1||meta.token!==token||typeof stored?.binary!=="string"||!stored.binarySha256)throw Error("invalid inherited native-helper lease");
 const sourceSha=hash(readBootstrapBytes(resolve(import.meta.dirname,"process-identity.c"),1024*1024)),manifest=readBootstrapJSON(join(dirname(stored.binary),"manifest.json"),8192);
 if(stored.sourceSha256!==sourceSha||manifest.sourceSha256!==sourceSha||manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.binarySha256!==stored.binarySha256||hash(readBootstrapBytes(stored.binary,2*1024*1024))!==stored.binarySha256)throw Error("inherited native-helper provenance changed");
 return stored;
}
export function inspectProcess(binary,pid){
 if(!Number.isInteger(pid)||pid<=1)return null;
 const until=Date.now()+1500;for(let attempt=0;;attempt++){try{return JSON.parse(execFileSync(binary,[String(pid)],{timeout:Math.max(1,until-Date.now()),stdio:['ignore','pipe','pipe'],encoding:'utf8'}));}catch(e){if(e.status===1)return null;if(e.status===6&&attempt<2&&Date.now()<until)continue;throw new Error('process identity unavailable: '+e.message);}}
}
export function ownedProcesses(binary,token,scopeToken){
 const until=Date.now()+2000;for(let attempt=0;;attempt++){try{const raw=execFileSync(binary,['--owned',token,...(scopeToken?[scopeToken]:[])],{timeout:Math.max(1,until-Date.now()),encoding:'utf8',env:{...process.env,[TOKEN_ENV]:token,...(scopeToken?{HW_TOOL_SCOPE_TOKEN:scopeToken}:{})},stdio:['ignore','pipe','pipe']});const rows=JSON.parse(raw);return rows.map(r=>({...r,token,scopeToken,role:'token-owned'}));}catch(error){if(error.status===6&&attempt<2&&Date.now()<until)continue;throw error;}}
}
export function signalOwnedProcess(binary,record,token,signal='SIGTERM'){
 const actual=inspectProcess(binary,record.pid);if(!actual)return false;
 // Registered workers are pinned from a spawn/boot handshake; all other
 // processes must independently prove inherited token ownership on each call.
 const explicit=['worker','caller-owned'].includes(record.role),verified=explicit?actual:ownedProcesses(binary,token,record.scopeToken).find(p=>p.pid===record.pid);
 if(!canSignalProcess(record,verified,token))return false;
 const sig=osConstants.signals[signal];if(!sig)throw Error('unsupported signal '+signal);
 try{execFileSync(binary,['--signal',String(record.pid),record.birth,String(sig),explicit?'--registered':token,...(record.scopeToken&&!explicit?[record.scopeToken]:[])],{timeout:1500,stdio:'pipe'});return true;}catch(e){if([3,4].includes(e.status))return false;throw e;}
}
export async function reapOwnedScope(binary,token,scopeToken,{exclude=[],graceMs=200,maxMs=7000,records=[]}={}){
 const started=Date.now(),errors=[],attempted=[],blocked=new Set(exclude),live=()=>{
  const scanned=ownedProcesses(binary,token,scopeToken).filter(p=>!blocked.has(p.pid));
  for(const r of records)if(!blocked.has(r.pid)){const p=inspectProcess(binary,r.pid);if(p&&p.birth===r.birth&&!scanned.some(x=>x.pid===r.pid))scanned.push(r);}
  return scanned;
 };
 let observedLeftovers;try{observedLeftovers=live();}catch(e){return {observedLeftovers:[],attempted,remaining:[],errors:[e.message],unsupported:true};}
 for(const r of observedLeftovers){if(Date.now()-started>=maxMs){errors.push('cleanup authorization deadline expired');break;}try{if(signalOwnedProcess(binary,r,token,'SIGTERM'))attempted.push({pid:r.pid,birth:r.birth,signal:'SIGTERM'});}catch(e){errors.push(e.message);}}
 let remaining=[];if(observedLeftovers.length){const gracefulDeadline=Date.now()+Math.min(graceMs,Math.max(0,maxMs-(Date.now()-started)));while(Date.now()<gracefulDeadline){try{remaining=live();}catch(e){errors.push(e.message);break;}if(!remaining.length)break;await wait(Math.min(50,Math.max(1,gracefulDeadline-Date.now())));}}
 do{try{remaining=live();}catch(e){errors.push(e.message);break;}if(!remaining.length)break;
  for(const r of remaining){if(Date.now()-started>=maxMs)break;try{if(signalOwnedProcess(binary,r,token,'SIGKILL'))attempted.push({pid:r.pid,birth:r.birth,signal:'SIGKILL'});}catch(e){errors.push(e.message);}}
  if(Date.now()-started>=maxMs)break;await wait(50);
 }while(Date.now()-started<maxMs);
 return {observedLeftovers,attempted,remaining,errors,durationMs:Date.now()-started};
}
export function readLease(dir,token,binary){
 if(!dir||!token)return null;const m=readBootstrapJSON(join(dir,'run.json'),8*1024*1024);if(m.token!==token||m.schema!==1)throw Error('invalid inherited run lease');
 const current=inspectProcess(binary,process.pid),supervisor=inspectProcess(binary,m.supervisor.pid);if(!current||!supervisor||supervisor.birth!==m.supervisor.birth)throw Error('inherited supervisor incarnation expired');
 if(!ownedProcesses(binary,token).some(p=>p.pid===process.pid))throw Error('inherited run token does not belong to current process');return m;
}
export async function removeOwnedTemp(record,token){
 let actual;try{actual=lstatSync(record.path);}catch(error){if(error.code==='ENOENT')return false;throw error;}if(actual.isSymbolicLink())throw Error('temp path became a symlink');
 let marker;try{marker=readBootstrapJSON(join(record.path,'.hw-tool-owner'),4096);}catch(error){if(error.code==='ENOENT')throw Object.assign(Error('temp ownership marker unavailable for existing directory: '+record.path),{code:'HW_TEMP_OWNER_MISSING',cause:error});throw error;}
 if(!canRemoveTemp(record,actual,marker,token))throw Error('temp ownership changed: '+record.path);if(record.keep){console.error('[runtime] kept temp '+record.path);return false;}await rm(record.path,{recursive:true,force:false});return true;
}
let singleton;
export function getToolRuntime(){return singleton;}
export function ensureToolRuntime(options={}){return singleton??=createToolRuntime(options);}
export function createToolRuntime(options={}){
 const policy=validateRuntimeOptions(options),token=process.env[TOKEN_ENV]||randomUUID(),callbacks=new Map(),processes=new Map(),temps=new Map(),abortController=new AbortController(),handlers=[];let closed=false,closing=null,termination=null,state={step:'bootstrap',waitingOn:'process identity'},meta,dir,helper,watchdog,watchdogClosed,shutdownDeadlineAt,heartbeat,scopeOwner,scratchDir,scopeDeadlineAt,activePhase;
 const inheritedScopeToken=process.env.HW_TOOL_SCOPE_TOKEN||token;
 // Node test workers and manually spawned siblings can inherit one command
 // scope. Each runtime authenticates that inherited lease, then owns a unique
 // descendant scope; initial native env remains the ancestor proof.
 const scopeToken=process.env.HW_TOOL_RUN_DIR?inheritedScopeToken+'/runtime-'+process.pid+'-'+randomUUID():inheritedScopeToken;
 const persistResource=(kind,details)=>{if(!dir)throw Error('await runtime.ready before registering resources');const r={...details,kind,token,scopeToken,scopeOwner,runtimeScopeToken:scopeToken,scopePid:process.pid,resourceId:randomUUID()};atomicJSON(join(dir,'resources',r.resourceId+'.json'),r);return r;};
 const runtime={runId:token,scopeToken,policy,signal:abortController.signal,get runDir(){return dir;},get scratchDir(){return scratchDir;},get ownerRecord(){return meta;},get closed(){return closed;},get supervisorClosed(){return watchdogClosed;},get shutdownDeadlineAt(){return shutdownDeadlineAt;},ready:null,
  step(label,waitingOn=label){state={...state,step:label,waitingOn,updatedAt:Date.now()};if(dir)atomicJSON(join(dir,'state-'+process.pid+'.json'),state);return runtime;},
  registerResource(kind,details={}){assertNotAborted(abortController.signal);return persistResource(kind,details);},
  onCleanup(label,fn,{kind='cleanup',details={}}={}){if(closed)throw Error('cannot register cleanup after shutdown');const id=randomUUID();const resource=dir?persistResource(kind,{label,...details}):null;callbacks.set(id,{label,fn,resource});return ()=>{callbacks.delete(id);if(resource)atomicJSON(join(dir,'resources',resource.resourceId+'.json'),{...resource,released:true});};},
  async deadline(label,operation,opts={}){await runtime.ready;runtime.step(label,opts.waitingOn||label);try{return await deadline(label,operation,{timeoutMs:opts.timeoutMs??policy.stepTimeoutMs,signal:opts.signal||(opts.cleanup?undefined:abortController.signal)});}catch(e){if(e instanceof DeadlineError&&!opts.cleanup){process.exitCode=124;atomicJSON(join(dir,'timeout-'+process.pid+'.json'),{label,message:e.message,at:Date.now(),token,owner:scopeOwner,scopeToken});if(options.installHandlers!==false)void terminate('timeout',124);}throw e;}},
  async withPhaseDeadline(label,operation,{timeoutMs}={}){
   await runtime.ready;assertNotAborted(abortController.signal);if(closed||activePhase)throw Error('A phase requires an open runtime and no other active phase');if(typeof operation!=='function')throw Error('Phase operation must be a function');
   const startedAt=Date.now(),deadlineAt=Math.min(meta.deadlineAt??Infinity,scopeDeadlineAt??Infinity),record=makePhaseDeadline({token,scopeToken,scopeOwner,deadlineAt:Number.isFinite(deadlineAt)?deadlineAt:null,label,timeoutMs,startedAt,nonce:randomUUID()}),path=join(dir,'phase-'+process.pid+'.json');
   if(existsSync(path))throw Error('Unreconciled phase record already exists');activePhase=record;atomicJSON(path,record);runtime.step(label,'guardian-enforced phase '+record.nonce+' until '+record.deadlineAt);
   try{return await runtime.deadline(label,operation,{timeoutMs:record.deadlineAt-startedAt});}
   finally{const before=lstatSync(path),current=readPhaseDeadline(path),after=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||after.dev!==before.dev||after.ino!==before.ino||JSON.stringify(current)!==JSON.stringify(record))throw Error('Phase record changed; refusing to clear it');rmSync(path);activePhase=null;}
  },
  async registerProcess(childOrPid,{label='child process',group=false,scopeToken:childScope,cleanup=false}={}){await runtime.ready;if(!cleanup)assertNotAborted(abortController.signal);const pid=typeof childOrPid==='number'?childOrPid:childOrPid.pid,record=inspectProcess(helper.binary,pid);if(!record)throw Error('cannot establish spawned process incarnation: '+pid);
   const inherited=ownedProcesses(helper.binary,token).some(p=>p.pid===pid&&p.birth===record.birth);let descendant=false;
   if(!inherited){for(let p=record,seen=new Set();p&&p.ppid>1&&!seen.has(p.pid);p=inspectProcess(helper.binary,p.ppid)){seen.add(p.pid);if(p.ppid===process.pid){descendant=true;break;}}}
   if(!inherited&&!descendant)throw Error('refusing unrelated process registration: '+pid);const r={...record,token,role:inherited?'token-owned':'caller-owned',group:!!group,label,scopeToken:childScope||scopeToken,scopeOwner,runtimeScopeToken:scopeToken,scopePid:process.pid,resourceId:randomUUID()};processes.set(pid,r);atomicJSON(join(dir,'resources',r.resourceId+'.json'),{kind:'process',...r});return r;},
  async registerTemp(path,{keep=false,reason,owner,evidence}={}){await runtime.ready;assertNotAborted(abortController.signal);const p=resolve(path),s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('owned temp must be a real directory');const markerPath=join(p,'.hw-tool-owner');if(existsSync(markerPath))throw Error('temp already has an owner: '+p);const r={path:p,keep,reason:reason||(keep?'explicit keep requested by '+policy.name:null),evidence,owner:owner||{pid:process.pid,name:policy.name},token,scopeToken,scopeOwner,runtimeScopeToken:scopeToken,dev:s.dev,ino:s.ino,resourceId:randomUUID(),scopePid:process.pid};writeFileSync(markerPath,JSON.stringify({token,resourceId:r.resourceId}),{flag:'wx',mode:0o600});temps.set(p,r);atomicJSON(join(dir,'resources',r.resourceId+'.json'),{kind:'temp',...r});return p;},
  async retainTemp(path,{owner,reason,evidence,requireSuccessfulCompletion=false}={}){await runtime.ready;assertNotAborted(abortController.signal);if(closed)throw Error("cannot retain temp after shutdown");if(typeof requireSuccessfulCompletion!=="boolean")throw Error("retained temp completion policy must be boolean");
   const validOwner=typeof owner==="string"?!!owner.trim():owner&&typeof owner==="object"&&!Array.isArray(owner)&&typeof owner.name==="string"&&!!owner.name.trim();const validEvidence=typeof evidence==="string"?!!evidence.trim():evidence&&typeof evidence==="object"&&!Array.isArray(evidence)&&Object.keys(evidence).length>0;if(!validOwner||typeof reason!=="string"||!reason.trim()||!validEvidence)throw Error("retained temp requires explicit owner, reason and evidence");
   const p=resolve(path),r=temps.get(p);if(!r)throw Error("cannot retain an untracked temp: "+p);const actual=lstatSync(p),markerPath=join(p,".hw-tool-owner"),recordPath=join(dir,"resources",r.resourceId+".json");if(actual.isSymbolicLink()||!actual.isDirectory())throw Error("retained temp ownership changed: "+p);
   const canonical=realpathSync(p);if(p===scratchDir)throw Error("opaque runtime scratch cannot be retained");for(const parent of temps.values())if(parent.path!==p&&!parent.keep){let root;try{root=realpathSync(parent.path);}catch(error){if(error.code==="ENOENT")continue;throw error;}if(canonical.startsWith(root+"/"))throw Error("cannot retain temp inside an unretained owned parent: "+parent.path);}
   const markerStat=lstatSync(markerPath),recordStat=lstatSync(recordPath),{readRegularInput}=await import("./tool-operations.mjs");const marker=JSON.parse(await readRegularInput(markerPath,{runtime,timeoutMs:2000})),before=await readRegularInput(recordPath,{runtime,timeoutMs:2000,encoding:null});assertNotAborted(abortController.signal);const current=JSON.parse(before.toString("utf8"));
   if(!canRemoveTemp(r,actual,marker,token)||r.scopeToken!==scopeToken||r.runtimeScopeToken!==scopeToken||r.scopeOwner?.pid!==scopeOwner.pid||r.scopeOwner?.birth!==scopeOwner.birth||before.toString("utf8")!==JSON.stringify({kind:"temp",...r})||current.released)throw Error("retained temp ownership or current registry changed: "+p);
   const serialized=JSON.stringify({...current,keep:true,owner,reason,evidence,requireSuccessfulCompletion}),next=JSON.parse(serialized),journal=recordPath+".retain-"+randomUUID()+".new";let staged;
   const unchanged=(path,info)=>{const now=lstatSync(path);return now.isFile()&&!now.isSymbolicLink()&&now.dev===info.dev&&now.ino===info.ino&&now.size===info.size&&now.mtimeMs===info.mtimeMs&&now.ctimeMs===info.ctimeMs;};
   try{const fd=openSync(journal,"wx",0o600);try{staged=fstatSync(fd);writeFileSync(fd,serialized);}finally{closeSync(fd);}const journalNow=lstatSync(journal);if(journalNow.dev!==staged.dev||journalNow.ino!==staged.ino||!journalNow.isFile()||journalNow.isSymbolicLink())throw Error("retention journal ownership changed before commit");const final=lstatSync(p);if(final.isSymbolicLink()||!final.isDirectory()||final.dev!==r.dev||final.ino!==r.ino||!unchanged(markerPath,markerStat)||!unchanged(recordPath,recordStat))throw Error("retained temp ownership changed before atomic commit: "+p);assertNotAborted(abortController.signal);renameSync(journal,recordPath);temps.set(p,next);return p;}
   catch(error){if(staged&&existsSync(journal)){const now=lstatSync(journal);if(now.dev!==staged.dev||now.ino!==staged.ino)throw Error("retention journal ownership changed; refusing removal");rmSync(journal);}throw error;}
  },
  async tempDir(prefix='heartwood-tool-',opts={}){if(typeof prefix==='object'){opts=prefix;prefix=opts.prefix||'heartwood-tool-';}await runtime.ready;assertNotAborted(abortController.signal);const timeoutMs=Math.min(policy.stepTimeoutMs,3000),request=makeAllocationRequest({...opts,parent:opts.parent||(opts.keep?(process.platform==='darwin'?'/private/tmp':ORIGINAL_TMPDIR):scratchDir||tmpdir()),prefix,token,scopeToken,scopeOwner,name:policy.name,timeoutMs});const r=await runtime.deadline('guardian temp allocation',signal=>requestTempAllocation(dir,request,{signal}),{timeoutMs});temps.set(r.path,r);return r.path;},
  async publishTempNoReplace(source,target){await runtime.ready;assertNotAborted(abortController.signal);if(process.platform!=='darwin')throw Error('no-replace owned directory publication unsupported on this platform');
   const original=resolve(source),destination=resolve(target),record=temps.get(original);if(!record||record.keep||!original.startsWith(scratchDir+'/'))throw Error('publication source must be an unretained opaque-scratch directory');
   const info=lstatSync(original),marker=readBootstrapJSON(join(original,'.hw-tool-owner'),4096),parent=lstatSync(dirname(destination));if(!canRemoveTemp(record,info,marker,token)||!parent.isDirectory()||parent.isSymbolicLink()||realpathSync(dirname(destination))!==dirname(destination))throw Error('publication source/parent ownership changed');
   if(info.dev!==parent.dev){const error=Error('UNSUPPORTED: output parent and owned scratch must share a filesystem');error.exitCode=64;throw error;}
   const next={...record,path:destination},recordPath=join(dir,'resources',record.resourceId+'.json');atomicJSON(recordPath,{kind:'temp',...next});temps.delete(original);temps.set(destination,next);
   try{const result=await runtime.runCommand(helper.binary,['--move-directory-no-replace',original,destination,String(record.dev),String(record.ino),String(parent.dev),String(parent.ino),token],{timeoutMs:3000,label:'atomic owned output publication'});if(result.status!==0)throw Error(result.stderr||'owned output publication failed with '+result.status);return destination;}
   catch(error){if(existsSync(original)){const now=lstatSync(original),current=readBootstrapJSON(join(original,'.hw-tool-owner'),4096);if(canRemoveTemp(record,now,current,token)){atomicJSON(recordPath,{kind:'temp',...record});temps.delete(destination);temps.set(original,record);}}throw error;}
  },
  async spawn(command,args=[],opts={}){await runtime.ready;assertNotAborted(opts.signal||(!opts.cleanup?abortController.signal:undefined));runtime.step(opts.label||command,'spawn');const childScope=scopeToken+'/'+randomUUID();const {[CHILD_CAPTURE]:capture,...spawnOptions}=opts;const child=spawnChild(command,args,{...spawnOptions,env:{...process.env,...opts.env,[TOKEN_ENV]:token,HW_TOOL_RUN_DIR:dir,HW_TOOL_IDENTITY_BINARY:helper.binary,HW_TOOL_SCOPE_TOKEN:childScope,HW_TOOL_SUPERVISED:token}});if(!child.pid)throw await new Promise(r=>child.once('error',r));
   const done=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.toolDone=done;child.toolScopeToken=childScope;child.toolClosed=new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({code:125,signal:null,error:error.message}));});capture?.(child);
   try{await runtime.registerProcess(child,{label:opts.label||command,group:!!opts.detached,scopeToken:childScope,cleanup:!!opts.cleanup});}catch(e){try{await deadline('fast child exit delivery',done,{timeoutMs:100});child.toolExitedBeforeRegistration=true;return child;}catch{throw e;}}return child;},
  async runCommand(command,args=[],opts={}){const timeoutMs=opts.timeoutMs??policy.stepTimeoutMs;validateTimerBudget('timeoutMs',timeoutMs);positive('maxBuffer',opts.maxBuffer??10485760);assertNotAborted(opts.signal||(!opts.cleanup?abortController.signal:undefined));const start=Date.now();let stdout='',stderr='',timedOut=false,outputError=null;const binaryOutput=opts.encoding===null||opts.encoding==='buffer',chunks={stdout:[],stderr:[]};const maxBuffer=opts.maxBuffer??10485760;positive('maxBuffer',maxBuffer);let bytes=0,rejectOutput;const outputFailure=new Promise((_,rej)=>{rejectOutput=rej;});outputFailure.catch(()=>{});
   const collect=(kind,d)=>{bytes+=d.length;if(bytes>maxBuffer){if(!outputError){outputError=Error('captured output exceeds '+maxBuffer+' bytes');rejectOutput(outputError);}return;}if(binaryOutput)chunks[kind].push(Buffer.from(d));else if(kind==='stdout')stdout+=d;else stderr+=d;};const child=await runtime.spawn(command,args,{...opts,stdio:opts.stdio||['ignore','pipe','pipe'],detached:process.platform!=='win32',[CHILD_CAPTURE]:child=>{child.toolCleanupClaim=join(dir,'command-claim-'+randomUUID()+'.json');atomicJSON(child.toolCleanupClaim,{token,scopeToken:child.toolScopeToken,owner:{...scopeOwner,token,role:'worker'},deadlineAt:start+timeoutMs+policy.shutdownMs,createdAt:start});child.stdout?.on('data',d=>collect('stdout',d));child.stderr?.on('data',d=>collect('stderr',d));}});runtime.step(opts.label||command,'child exit and pipe drain '+child.pid);
   // Own stop signals abort this wait during shutdown. Preserve that exact cause;
   // unrelated cancellation stays125 and all cleanup evidence is still audited.
   let result;try{result=await deadline(opts.label||command,Promise.race([child.toolClosed,outputFailure]),{timeoutMs,signal:opts.signal||(opts.cleanup?undefined:abortController.signal)});}catch(e){const stopped=e===abortController.signal.reason?termination:null;timedOut=e instanceof DeadlineError||stopped?.status===124;result={code:timedOut?124:stopped?.status??125,signal:stopped&&['SIGINT','SIGTERM','SIGHUP'].includes(stopped.reason)?stopped.reason:'SIGKILL'};if(timedOut)process.exitCode=124;}
   try{const m=readBootstrapJSON(join(dir,'timeout-'+child.pid+'.json'),8192);if(m.token===token&&m.owner?.birth===processes.get(child.pid)?.birth){result.code=124;timedOut=true;}}catch{}
   let cleanup;try{const {drainCommandScope}=await import('./run-supervised.mjs');cleanup=await deadline('command typed/process/filesystem cleanup',()=>drainCommandScope(dir,meta,child.toolScopeToken,{exclude:[process.pid],maxMs:Math.max(1,policy.shutdownMs-500)}),{timeoutMs:policy.shutdownMs});}catch(error){cleanup={observedLeftovers:[],attempted:[],remaining:[],errors:[error.message],unsupported:true};if(!timedOut)result.code=125;}finally{if(child.toolCleanupClaim)try{rmSync(child.toolCleanupClaim);}catch(error){if(error.code!=='ENOENT')cleanup?.errors.push('command cleanup claim release: '+error.message);}}
   // After cancellation reap, allow a short bounded close delivery to retain
   // already-written diagnostics; never turn an undrained command into success.
   try{await deadline('captured child pipe closure',child.toolClosed,{timeoutMs:250});}catch(e){outputError??=Error('child pipes did not close after cleanup: '+e.message);if(!timedOut)result.code=125;}
   if(result.error)outputError??=Error(result.error);
   if(result.code===0&&(outputError||cleanup.errors.length||cleanup.remaining.length||cleanup.observedLeftovers.length))result.code=125;
   return {scopeToken:child.toolScopeToken,cleanup,error:outputError?.message||null,outputBytes:bytes,maxBuffer,status:result.code??(result.signal?128+(osConstants.signals[result.signal]||0):1),signal:result.signal,stdout:binaryOutput?Buffer.concat(chunks.stdout):stdout,stderr:binaryOutput?Buffer.concat(chunks.stderr):stderr,timedOut,durationMs:Date.now()-start,pid:child.pid};},
  async shutdown(reason='normal'){if(closing)return closing;closing=(async()=>{closed=true;const cleanupDeadline=Date.now()+policy.shutdownMs;shutdownDeadlineAt=cleanupDeadline;if(dir)atomicJSON(join(dir,'shutdown-'+process.pid+'.json'),{token,owner:scopeOwner,scopeToken,reason,status:process.exitCode||0,deadlineAt:cleanupDeadline,at:Date.now()});abortController.abort(new Error('shutdown: '+reason));clearInterval(heartbeat);for(const [event,handler]of handlers)process.off(event,handler);handlers.length=0;runtime.step('shutdown',reason);const errors=[];
   await Promise.all([...callbacks.values()].reverse().map(async c=>{try{await deadline('cleanup '+c.label,signal=>c.fn(reason,signal),{timeoutMs:Math.max(1,cleanupDeadline-Date.now()-750)});if(c.resource)atomicJSON(join(dir,'resources',c.resource.resourceId+'.json'),{...c.resource,released:true});}catch(e){errors.push(c.label+': '+e.message);}}));callbacks.clear();
   for(const r of processes.values()){if(Date.now()>=cleanupDeadline-250){errors.push('aggregate shutdown deadline reached before process TERM');break;}try{signalOwnedProcess(helper.binary,r,token,'SIGTERM');}catch(e){errors.push(e.message);}}
   if(processes.size)await wait(100);
   for(const r of processes.values()){if(Date.now()>=cleanupDeadline-100){errors.push('aggregate shutdown deadline reached before process KILL');break;}try{signalOwnedProcess(helper.binary,r,token,'SIGKILL');}catch(e){errors.push(e.message);}}
   for(const r of temps.values())try{await deadline('owned runtime temp removal',()=>removeOwnedTemp(r,token),{timeoutMs:Math.max(1,cleanupDeadline-Date.now())});}catch(e){errors.push(e.message);}
   if(dir)atomicJSON(join(dir,'done-'+process.pid+'.json'),{token,pid:process.pid,reason,status:process.exitCode||0,errors,at:Date.now()});if(errors.length){process.exitCode=process.exitCode||1;console.error('[runtime] cleanup failed: '+errors.join('; '));}return {errors};})();return closing;}
 };
 async function terminate(reason,status){termination??={reason,status};process.exitCode=termination.status;const force=setTimeout(()=>process.exit(termination.status),policy.shutdownMs);force.unref();try{await runtime.shutdown(termination.reason);}finally{clearTimeout(force);process.exit(process.exitCode||termination.status);}}
 runtime.ready=(async()=>{const inheritedDir=process.env.HW_TOOL_RUN_DIR;helper=inheritedDir?inheritedIdentity(inheritedDir,token):prepareIdentity();scopeOwner=inspectProcess(helper.binary,process.pid);
  if(inheritedDir){meta=readLease(inheritedDir,token,helper.binary);dir=inheritedDir;process.env.HW_TOOL_SCOPE_TOKEN=scopeToken;process.env.HW_TOOL_IDENTITY_BINARY=helper.binary;}
  else{const worker=inspectProcess(helper.binary,process.pid),caller=inspectProcess(helper.binary,process.ppid);if(!worker||!caller)throw Error('process/caller identity unavailable; refusing unsupervised launch');
   const createdAt=Date.now(),bootstrap={schema:1,token,name:policy.name,reason:policy.reason||null,persistent:policy.persistent,worker:{...worker,token,role:'worker'},caller,supervisor:null,helper,createdAt,deadlineAt:policy.runTimeoutMs===null?null:createdAt+policy.runTimeoutMs,shutdownMs:policy.shutdownMs,bootstrapNonce:randomUUID()};if(Buffer.byteLength(JSON.stringify(bootstrap))>1048576)throw Error('bootstrap metadata exceeds1MiB');
   watchdog=spawnChild(process.execPath,[SUPERVISOR,'--bootstrap-watchdog'],{detached:true,stdio:['ignore','inherit','inherit','ipc'],env:{...process.env,[TOKEN_ENV]:token,HW_TOOL_SCOPE_TOKEN:scopeToken+'/watchdog-'+randomUUID(),HW_TOOL_RUN_DIR:'',HW_TOOL_IDENTITY_BINARY:helper.binary}});
   watchdogClosed=new Promise(res=>{watchdog.once('exit',(code,signal)=>res({code,signal}));watchdog.once('error',error=>res({code:125,error:error.message}));});
   let reply;try{reply=await deadline('watchdog bootstrap handshake',()=>new Promise((res,rej)=>{const failed=error=>{cleanup();rej(error);},message=body=>{cleanup();body?.ready&&body.token===token&&body.bootstrapNonce===bootstrap.bootstrapNonce?res(body):rej(Error('bad watchdog bootstrap handshake'));},exited=code=>failed(Error('watchdog exited '+code)),cleanup=()=>{watchdog.removeListener('message',message);watchdog.removeListener('error',failed);watchdog.removeListener('exit',exited);};watchdog.once('message',message);watchdog.once('error',failed);watchdog.once('exit',exited);watchdog.send({bootstrap},error=>{if(error)failed(error);});}),{timeoutMs:3000});}catch(error){try{if(watchdog.connected)watchdog.disconnect();}catch{}throw error;}
   const guardian=inspectProcess(helper.binary,watchdog.pid);if(!guardian||guardian.birth!==reply.guardian?.birth||reply.guardian.pid!==watchdog.pid||typeof reply.dir!=='string')throw Error('watchdog bootstrap native identity changed');const actual=lstatSync(reply.dir),admitted=readBootstrapJSON(join(reply.dir,'run.json'),8*1024*1024);if(actual.isSymbolicLink()||!actual.isDirectory()||admitted.token!==token||admitted.bootstrapNonce!==bootstrap.bootstrapNonce||admitted.bootstrapProtocol!==1||admitted.rootIdentity?.dev!==actual.dev||admitted.rootIdentity.ino!==actual.ino||admitted.worker?.pid!==worker.pid||admitted.worker.birth!==worker.birth||admitted.supervisor?.pid!==guardian.pid||admitted.supervisor.birth!==guardian.birth)throw Error('watchdog bootstrap registry admission changed');dir=reply.dir;meta=admitted;watchdog.unref();watchdog.channel?.unref();
   process.env[TOKEN_ENV]=token;process.env.HW_TOOL_RUN_DIR=dir;process.env.HW_TOOL_IDENTITY_BINARY=helper.binary;process.env.HW_TOOL_SCOPE_TOKEN=scopeToken;process.env.HW_TOOL_SUPERVISED=token;
  }
  if(meta.allocationProtocol!==1)throw Error('inherited guardian lacks temp allocation protocol; install runtime and supervisor together');
  scopeDeadlineAt=policy.runTimeoutMs===null?null:Date.now()+policy.runTimeoutMs;mkdirSync(join(dir,'scopes'),{recursive:true,mode:0o700});atomicJSON(join(dir,'scopes',process.pid+'.json'),{token,scopeOwner:{...scopeOwner,token,role:'worker'},scopeToken,inheritedScopeToken,deadlineAt:scopeDeadlineAt,shutdownMs:policy.shutdownMs});
  const scratchRequest=makeAllocationRequest({token,scopeToken,scopeOwner,parent:process.platform==='darwin'?'/private/tmp':tmpdir(),prefix:'heartwood-scratch-',keep:false,name:policy.name,reason:'owned opaque tool/browser temp root',timeoutMs:3000}),scratch=await deadline('guardian initial scratch allocation',signal=>requestTempAllocation(dir,scratchRequest,{signal}),{timeoutMs:3000});scratchDir=scratch.path;temps.set(scratchDir,scratch);
  process.env.HW_TOOL_ORIGINAL_TMPDIR=ORIGINAL_TMPDIR;meta.originalTmpdir??=ORIGINAL_TMPDIR;
  process.env.TMPDIR=scratchDir;process.env.TMP=scratchDir;process.env.TEMP=scratchDir;
  state.startedAt=Date.now();runtime.step('ready',policy.name);heartbeat=setInterval(()=>console.log(`[runtime ${token.slice(0,8)}] ${state.step}: waiting on ${state.waitingOn}; elapsed ${Date.now()-state.startedAt} ms`),policy.heartbeatMs);heartbeat.unref();
  if(options.installHandlers!==false){for(const [s,code] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]]){const handler=()=>{let exitCode=code;try{const m=readBootstrapJSON(join(dir,'timeout-'+process.pid+'.json'),8192);if(m.token===token&&m.owner?.birth===scopeOwner?.birth)exitCode=124;}catch{}void terminate(s,exitCode);};handlers.push([s,handler]);process.once(s,handler);}const beforeExit=()=>void runtime.shutdown('normal');handlers.push(['beforeExit',beforeExit]);process.once('beforeExit',beforeExit);}
  return runtime;
 })().catch(e=>{throw e;});
 return runtime;
}
export async function runCommand(command,args=[],options={}){const rt=ensureToolRuntime();return rt.runCommand(command,args,options);}
