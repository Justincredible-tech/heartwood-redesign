#!/usr/bin/env node
// Compatibility CLI and independent watchdog. Default: parallel owned runs.
import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,mkdtempSync,readdirSync,existsSync,statSync,lstatSync,openSync,fstatSync,closeSync,constants,unlinkSync,linkSync,renameSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ensureToolRuntime,inspectProcess,ownedProcesses,signalOwnedProcess,reapOwnedScope,removeOwnedTemp,deadline,DeadlineError,validateTimerBudget} from './tool-runtime.mjs';
import {startAllocationService} from './temp-allocation.mjs';
import {validateBootstrapMetadata,authenticateBootstrapHelper,createBootstrapRoot,readBootstrapBytes,readBootstrapJSON,sendBootstrapReady,createCompilerScratch,removeCompilerScratch} from './bootstrap-lease.mjs';
import {tmpdir} from 'node:os';
import {readPhaseDeadline,validatePhaseDeadline} from './phase-deadline.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const atomic=(p,o)=>{const t=p+'.'+randomUUID()+'.new';writeFileSync(t,JSON.stringify(o),{mode:0o600});renameSync(t,p);};
// Control JSON is inert, regular and size-bounded even before any guardian exists.
const read=p=>{try{return readBootstrapJSON(p,8*1024*1024);}catch(error){if(error.message.startsWith('bootstrap input must be nonempty regular bounded file:'))throw Error('Control JSON must be a nonempty regular file <=8MiB: '+p);if(error.message.startsWith('bootstrap input changed:'))throw Error('Control JSON changed while reading: '+p);throw error;}};
const ALIVE=(binary,p)=>{const now=p&&inspectProcess(binary,p.pid);return !!now&&now.birth===p.birth;};
function scopePhase(dir,scope,meta){const record=readPhaseDeadline(join(dir,'phase-'+scope.scopeOwner.pid+'.json'));if(!record)return null;if(scope.token!==meta.token)throw Error('Phase scope lease token changed');const deadlineAt=Math.min(meta.deadlineAt??Infinity,scope.deadlineAt??Infinity);return validatePhaseDeadline(record,{lease:{token:meta.token,scopeToken:scope.scopeToken,scopeOwner:scope.scopeOwner,deadlineAt:Number.isFinite(deadlineAt)?deadlineAt:null},now:Date.now()});}
export function parseSupervisorArgs(args){
 const o={serial:false,timeoutMs:Number(process.env.HW_TOOL_TIMEOUT_MS||Number(process.env.HW_LOCK_TIMEOUT||900)*1000),queueTimeoutMs:30000,shutdownMs:8000,serialRoot:process.env.HW_LOCK_DIR||'/private/tmp/heartwood-browser'};let i=0;
 for(;i<args.length;i++){const a=args[i];if(a==='--'){i++;break;}if(a==='--help'||a==='-h')return {...o,help:true,command:[]};if(!a.startsWith('--'))break;
  if(a==='--serial'){o.serial=true;continue;}if(a==='--parallel'){o.serial=false;continue;}const key={'--timeout-ms':'timeoutMs','--queue-timeout-ms':'queueTimeoutMs','--shutdown-ms':'shutdownMs','--serial-root':'serialRoot'}[a];if(!key||args[i+1]===undefined)throw Error('unknown/incomplete option '+a);o[key]=key==='serialRoot'?args[++i]:Number(args[++i]);
 }
 for(const k of ['timeoutMs','queueTimeoutMs','shutdownMs'])validateTimerBudget(k,o[k]);if(o.shutdownMs>10000)throw Error('shutdownMs must be <=10000');o.command=args.slice(i);if(!o.command.length)throw Error('a command is required');return o;
}
function removePinnedFile(path,record){
 let s,m;try{s=lstatSync(path);m=read(path);}catch(e){if(e.code==='ENOENT')return false;throw e;}
 if(s.isSymbolicLink()||s.dev!==record.dev||s.ino!==record.ino||m.token!==record.token||m.resourceId!==(record.ownershipId||record.resourceId)||m.owner?.pid!==record.owner?.pid||m.owner?.birth!==record.owner?.birth)throw Error('serial lease ownership changed: '+path);unlinkSync(path);return true;
}
function removeSerialResource(record){
 removePinnedFile(record.path,record);
 // Publication is an atomic hardlink from staging inside the already owned
 // run registry. A crash between link and final registration remains owned.
 // Before acquisition, a foreign/legacy lock is merely observed and preserved.
 if(record.publicationPath){let st,m;try{st=lstatSync(record.publicationPath);if(!st.isFile()||st.isSymbolicLink())return;m=read(record.publicationPath);}catch(e){if(['ENOENT','EISDIR'].includes(e.code)||e instanceof SyntaxError)return;throw e;}
  if(st.dev===record.dev&&st.ino===record.ino&&m.token===record.token&&m.resourceId===(record.ownershipId||record.resourceId)&&m.owner?.pid===record.owner?.pid&&m.owner?.birth===record.owner?.birth)removePinnedFile(record.publicationPath,{...record,path:record.publicationPath});
 }
}
export async function acquireSerial(rt,{serialRoot,queueTimeoutMs}){
 await rt.ready;const binary=rt.ownerRecord.helper.binary,lock=resolve(serialRoot+'.lock');
 const inherited=process.env.HW_TOOL_SERIAL_LEASE;
 if(inherited&&resolve(inherited)===lock){
  const m=read(lock),st=lstatSync(lock),registered=readdirSync(join(rt.runDir,'resources')).filter(n=>n.endsWith('.json')).map(n=>{try{return read(join(rt.runDir,'resources',n));}catch{return null;}}).find(r=>r&&!r.released&&r.kind==='serial-file'&&r.path===lock&&r.token===rt.runId&&r.dev===st.dev&&r.ino===st.ino&&(r.ownershipId||r.resourceId)===m.resourceId&&r.owner?.pid===m.owner?.pid&&r.owner?.birth===m.owner?.birth);
  if(st.isFile()&&!st.isSymbolicLink()&&m.schema===1&&m.token===rt.runId&&typeof m.scopeToken==='string'&&(rt.scopeToken===m.scopeToken||rt.scopeToken.startsWith(m.scopeToken+'/'))&&registered&&ALIVE(binary,m.owner))return {reused:true,path:lock};
 }
 const owner=inspectProcess(binary,process.pid),resourceId=randomUUID();if(!owner)throw Error('serial owner identity unavailable');
 const staging=join(rt.runDir,'serial-lease-'+resourceId+'.json'),body={schema:1,kind:'serial-file',token:rt.runId,scopeToken:rt.scopeToken,owner,supervisor:rt.ownerRecord.supervisor,resourceId,createdAt:Date.now()};
 writeFileSync(staging,JSON.stringify(body),{flag:'wx',mode:0o600});const st=lstatSync(staging),record={...body,path:staging,dev:st.dev,ino:st.ino,publicationPath:lock,ownershipId:resourceId};rt.registerResource('serial-file',record);
 let acquired=false;const release=()=>{if(acquired)removePinnedFile(lock,{...record,path:lock});removeSerialResource(record);};rt.onCleanup('owned serial lease',release);
 try{await rt.deadline('serial lock acquisition',async signal=>{
  while(!signal.aborted){
   try{linkSync(staging,lock);acquired=true;rt.registerResource('serial-file',{...record,path:lock,publicationPath:undefined});process.env.HW_TOOL_SERIAL_LEASE=lock;rt.step('serial lease acquired',lock);return;}catch(e){if(e.code!=='EEXIST')throw e;}
   // Stale takeover also waits for its watcher and token-owned work to end. Unknown
   // legacy directories, symlinks and malformed/ownerless files remain untouched.
   try{const current=lstatSync(lock);if(current.isFile()&&!current.isSymbolicLink()){const m=read(lock);if(m.schema===1&&m.kind==='serial-file'&&typeof m.token==='string'&&m.token&&typeof m.resourceId==='string'&&m.resourceId&&Number.isInteger(m.owner?.pid)&&m.owner.pid>1&&typeof m.owner.birth==='string'&&m.owner.birth&&!ALIVE(binary,m.owner)&&(!m.supervisor||!ALIVE(binary,m.supervisor))&&ownedProcesses(binary,m.token,m.scopeToken).length===0){removePinnedFile(lock,{...m,dev:current.dev,ino:current.ino});continue;}}}catch(e){if(!['ENOENT','EISDIR','ENOTDIR'].includes(e.code)&&!(e instanceof SyntaxError))throw e;}
   await wait(50);
  }
 },{timeoutMs:queueTimeoutMs});return {path:lock,reused:false,record};
 }catch(e){release();throw e;}
}
const PROCESS_BOUND_KINDS=new Set(['process','cleanup','listener','cdp','browser-context','browser','borrowed-browser-connection']);
export function classifyResourceCleanup(kind){return ['temp','serial-file'].includes(kind)?'filesystem':PROCESS_BOUND_KINDS.has(kind)?'process-bound':'typed';}
export async function releaseResourceSet(resources,meta,{deadlineAt,runDir,phase='all',processed=new Set(),hook:providedHook}={}){
 const errors=[],kept=[],unsupported=[],releasedResourceIds=[],hookPath=resolve(import.meta.dirname,'cleanup-resource-actions.mjs');let hook=providedHook;
 const selected=resources.filter(r=>!r.released&&!processed.has(r.resourceId)&&classifyResourceCleanup(r.kind)!=='process-bound'&&(phase==='all'||(phase==='typed')===(classifyResourceCleanup(r.kind)==='typed')));
 if(hook===undefined&&selected.some(r=>classifyResourceCleanup(r.kind)==='typed')){hook=null;if(existsSync(hookPath))try{hook=await import(hookPath);}catch(e){errors.push('typed cleanup hook unavailable: '+e.message);}}
 // State restoration precedes emulator/ADB-server retirement. The process pass
 // follows every typed action, so their owned local endpoints still exist.
 selected.sort((a,b)=>(/adb.*server|emulator/.test(a.kind)?1:0)-(/adb.*server|emulator/.test(b.kind)?1:0));
 for(const r of selected){const remainingMs=()=>Math.max(0,deadlineAt-Date.now());if(remainingMs()<=0){errors.push('aggregate cleanup deadline expired');unsupported.push(...selected.filter(x=>!processed.has(x.resourceId)));break;}
  processed.add(r.resourceId);
  try{if(r.kind==='temp'){
    const done=r.requireSuccessfulCompletion&&runDir?completedScope(runDir,{scopeOwner:r.scopeOwner,scopeToken:r.scopeToken},meta.token):null;
    const keep=r.keep&&(!r.requireSuccessfulCompletion||done?.status===0&&done.errors.length===0);
    if(keep)kept.push(r.path);else await deadline('owned temp removal',()=>removeOwnedTemp({...r,keep:false},meta.token),{timeoutMs:remainingMs()});
   }
   else if(r.kind==='serial-file'){try{removeSerialResource(r);}catch(e){if(e.code!=='ENOENT')throw e;}}
   else{
    if(r.kind==='invalid-resource'||r.token!==meta.token||!hook?.cleanupOwnedResource){unsupported.push(r);continue;}
    await deadline('typed cleanup '+r.kind,signal=>hook.cleanupOwnedResource(r,{run:meta,signal,deadline,deadlineAt,remainingMs}),{timeoutMs:remainingMs()});
   }
  releasedResourceIds.push(r.resourceId);
  }catch(e){errors.push(r.kind+': '+e.message);if(classifyResourceCleanup(r.kind)==='typed')unsupported.push(r);}
 }return {errors,kept,unsupported,releasedResourceIds};
}
const readShutdown=(dir,owner,token)=>{try{const r=read(join(dir,'shutdown-'+owner.pid+'.json'));return r.token===token&&r.owner?.birth===owner.birth&&Number.isFinite(r.deadlineAt)?r:null;}catch{return null;}};
const resourcesIn=dir=>readdirSync(join(dir,'resources')).filter(n=>n.endsWith('.json')).map(n=>{const path=join(dir,'resources',n);try{const r=read(path);if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.kind!=='string'||typeof r.resourceId!=='string')throw Error('malformed resource descriptor');return r;}catch(e){return {kind:'invalid-resource',resourceId:n,path,error:e.message,released:false};}});
// A runCommand caller finalizes its descendant resources before returning.
// The native-birth-pinned claim prevents the watchdog from concurrently removing
// the same filesystem resources. Caller death/expiry releases that exclusion.
const claimWarnings=[],warnedClaims=new Set();
export function activeCommandClaim(dir,token,binary,scopeToken,io={list:readdirSync,read,inspect:inspectProcess,warn:message=>console.error('[supervisor] '+message)}){
 for(const file of io.list(dir).filter(name=>name.startsWith('command-claim-')&&name.endsWith('.json'))){let claim;try{claim=io.read(join(dir,file));}catch(error){if(error.code==='ENOENT')continue;const key=file+':'+error.message;if(!warnedClaims.has(key)){warnedClaims.add(key);const message='inactive unreadable command claim '+file+': '+error.message;claimWarnings.push(message);io.warn(message);}continue;}
  if(claim?.token!==token||typeof claim.scopeToken!=='string'||!claim.scopeToken||!Number.isInteger(claim.owner?.pid)||claim.owner.pid<=1||!claim.owner?.birth||!Number.isFinite(claim.deadlineAt))continue;
  if(!(scopeToken===claim.scopeToken||scopeToken.startsWith(claim.scopeToken+'/'))||Date.now()>=claim.deadlineAt)continue;
  const owner=io.inspect(binary,claim.owner.pid);if(owner?.birth===claim.owner.birth)return true;
 }return false;
}
const scopeCleanupPath=(dir,scopeToken)=>join(dir,'scope-cleanup-'+createHash('sha256').update(scopeToken).digest('hex')+'.json');
function publishReleased(dir,token,ids){const errors=[];for(const id of ids){if(!/^[a-f0-9-]{36}$/.test(id)){errors.push('invalid cleanup resource ID');continue;}const path=join(dir,'resources',id+'.json');try{const row=read(path);if(row.token===token&&row.resourceId===id&&!row.keep)atomic(path,{...row,released:true});}catch(error){if(error.code!=='ENOENT')errors.push('resource release publication: '+error.message);}}return errors;}
export async function drainCommandScope(dir,meta,scopeToken,{exclude=[],maxMs=7000}={}){
 const started=Date.now(),deadlineAt=started+maxMs,related=()=>resourcesIn(dir).filter(r=>r.scopeToken===scopeToken||r.scopeToken?.startsWith(scopeToken+'/')),processed=new Set();
 const scopes=readdirSync(join(dir,'scopes')).filter(file=>file.endsWith('.json')).map(file=>read(join(dir,'scopes',file))).filter(scope=>scope.token===meta.token&&(scope.scopeToken===scopeToken||scope.scopeToken?.startsWith(scopeToken+'/'))),watchdogCompletions=[];
 for(const scope of scopes){const path=scopeCleanupPath(dir,scope.scopeToken);let progress;try{progress=read(path);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(progress.token!==meta.token||progress.scopeOwner?.birth!==scope.scopeOwner?.birth||progress.scopeToken!==scope.scopeToken)throw Error('scope cleanup marker ownership changed');if(progress.state==='pending')await deadline('watchdog shorter child deadline cleanup',async()=>{for(;;){progress=read(path);if(progress.token!==meta.token||progress.scopeOwner?.birth!==scope.scopeOwner?.birth)throw Error('scope cleanup marker identity changed');if(progress.state==='complete')return;await wait(10);}},{timeoutMs:Math.max(1,deadlineAt-Date.now()-300)});if(progress.state!=='complete')throw Error('unsupported scope cleanup state');watchdogCompletions.push(progress);}
 const initial=related(),typed=await releaseResourceSet(initial,meta,{runDir:dir,deadlineAt:deadlineAt-300,phase:'typed',processed});
 const records=[...initial.filter(r=>r.kind==='process'),...scopes.map(scope=>({...scope.scopeOwner,token:meta.token,scopeToken:scope.scopeToken,role:'worker'}))];
 const cleanup=await reapOwnedScope(meta.helper.binary,meta.token,scopeToken,{exclude,records,graceMs:200,maxMs:Math.max(1,deadlineAt-Date.now()-300)});
 const final=related(),released=await releaseResourceSet(final,meta,{runDir:dir,deadlineAt,processed});
 released.errors.push(...publishReleased(dir,meta.token,[...typed.releasedResourceIds,...released.releasedResourceIds]));
 const unsupported=[...typed.unsupported,...released.unsupported],errors=[...cleanup.errors,...typed.errors,...released.errors,...watchdogCompletions.flatMap(row=>[...(row.errors||[]),...(row.cleanup?.errors||[]),...(row.cleanup?.remaining?.length?['watchdog child cleanup left live processes']:[]),...(row.unsupported||[]).map(r=>'unsupported watchdog child resource: '+r.kind)]),...unsupported.map(r=>'unsupported owned resource: '+r.kind)];
 // Finalize only after the native process pass and every registered resource succeeded.
 // Historical command scope files must not later acquire a fabricated deadline failure.
 if(!errors.length&&!cleanup.remaining.length){const by=inspectProcess(meta.helper.binary,process.pid);if(!by)errors.push('command scope retirement identity unavailable');else for(const scope of scopes){const path=join(dir,'scopes',scope.scopeOwner.pid+'.json');try{const current=read(path);if(current.token!==meta.token||current.scopeToken!==scope.scopeToken||current.scopeOwner?.birth!==scope.scopeOwner.birth)throw Error('scope identity changed before retirement');atomic(path,{...current,retired:true,commandCleanupClosed:true,closedOwner:scope.scopeOwner,retiredBy:by,retiredAt:Date.now()});}catch(error){errors.push('scope retirement: '+error.message);}}}
 return {...cleanup,errors,resourceCleanup:{watchdogCompletions,releasedResourceIds:[...typed.releasedResourceIds,...released.releasedResourceIds],kept:released.kept,unsupported},durationMs:Date.now()-started};
}
export function verifiedScopeCompletion(scope,shutdown,done,token){
 return !!scope&&shutdown?.token===token&&shutdown?.owner?.pid===scope.scopeOwner?.pid&&shutdown.owner.birth===scope.scopeOwner.birth&&shutdown.scopeToken===scope.scopeToken&&done?.token===token&&done.pid===scope.scopeOwner.pid&&Number.isInteger(done.status)&&done.status>=0&&done.status<=255&&Number.isFinite(done.at)&&Number.isFinite(shutdown.at)&&done.at>=shutdown.at&&Array.isArray(done.errors)&&done.errors.every(error=>typeof error==="string");
}
function completedScope(dir,scope,token){try{const done=read(join(dir,"done-"+scope.scopeOwner.pid+".json")),shutdown=readShutdown(dir,scope.scopeOwner,token);return verifiedScopeCompletion(scope,shutdown,done,token)?done:null;}catch{return null;}}
async function watchdog(dir,{recoveryMode=false,authenticatedMeta}={}){
 const admittedCurrent=read(join(dir,recoveryMode?'run.json':'bootstrap.json'));if(recoveryMode&&(!authenticatedMeta||JSON.stringify(admittedCurrent)!==JSON.stringify(authenticatedMeta)))throw Error('authenticated orphan registry changed before recovery');const meta=admittedCurrent,binary=meta.helper.binary,own=inspectProcess(binary,process.pid),previousSupervisor=meta.supervisor; if(!own)throw Error('watchdog identity unavailable');
 const recoveryStarted=recoveryMode?Date.now():null;if(recoveryMode){const root=lstatSync(dir);if(root.isSymbolicLink()||root.dev!==meta.rootIdentity?.dev||root.ino!==meta.rootIdentity?.ino||ALIVE(binary,meta.worker)||ALIVE(binary,previousSupervisor))throw Error('exact orphan registry/owner changed before recovery');validateTimerBudget('recovery shutdownMs',meta.shutdownMs);if(meta.shutdownMs>10000)throw Error('recovery shutdownMs must not exceed10000');}
 const recoveryDeadline=recoveryMode?recoveryStarted+meta.shutdownMs:null;meta.supervisor=own;meta.allocationProtocol=1;atomic(join(dir,'run.json'),meta);const allocator=recoveryMode?null:await startAllocationService(dir,meta,{inspectProcess}),readyError=recoveryMode?null:await sendBootstrapReady({ready:true,dir,token:meta.token,bootstrapNonce:meta.bootstrapNonce,guardian:own},{required:meta.bootstrapProtocol===1});
 let signalReason=null;for(const s of ['SIGINT','SIGTERM','SIGHUP'])process.once(s,()=>{signalReason=s;});
 let reason=readyError?'bootstrap handshake failed: '+readyError:'normal',status=readyError?125:0,done;const expiredScopes=[],handledScopes=new Set();
 if(recoveryMode){try{const scope=read(join(dir,'scopes',meta.worker.pid+'.json'));if(scope.token===meta.token&&scope.scopeOwner?.pid===meta.worker.pid&&scope.scopeOwner?.birth===meta.worker.birth)done=completedScope(dir,scope,meta.token);}catch{}
  if(done){status=done.status;reason='orphan recovery after recorded completion';}
  else{let recordedTimeout;try{const marker=read(join(dir,'timeout-'+meta.worker.pid+'.json'));recordedTimeout=marker.token===meta.token&&marker.owner?.pid===meta.worker.pid&&marker.owner?.birth===meta.worker.birth;}catch{}const expired=meta.deadlineAt!==null&&Number.isFinite(meta.deadlineAt)&&Date.now()>=meta.deadlineAt;status=recordedTimeout||expired?124:125;reason=recordedTimeout?'orphan recovery after recorded timeout':expired?'orphan recovery of expired run without completion evidence':'orphan recovery of unconfirmed worker death';}
 }
 watch:for(;!recoveryMode&&!readyError;){
  allocator.service();
  if(signalReason){reason=signalReason;status={SIGINT:130,SIGTERM:143,SIGHUP:129}[reason];break;}
  if(meta.deadlineAt!==null&&Date.now()>=meta.deadlineAt){reason='whole-run timeout';status=124;break;}
  const shutdown=readShutdown(dir,meta.worker,meta.token);if(shutdown&&Date.now()>=shutdown.deadlineAt-500){reason='shutdown cleanup deadline';status=shutdown.status||1;break;}
  if(!ALIVE(binary,meta.worker)){reason='worker incarnation ended';try{done=completedScope(dir,read(join(dir,'scopes',meta.worker.pid+'.json')),meta.token);}catch{}status=done?.status??125;break;}
  if(!ALIVE(binary,meta.caller)){reason='caller incarnation ended';status=125;break;}
  try{if(existsSync(join(dir,'phase-'+meta.worker.pid+'.json'))){const phase=scopePhase(dir,read(join(dir,'scopes',meta.worker.pid+'.json')),meta);if(phase?.expired){reason='phase timeout: '+phase.record.label;status=124;break;}}}catch(error){reason='invalid phase deadline: '+error.message;status=125;break;}
  if(existsSync(join(dir,'timeout-'+meta.worker.pid+'.json'))){reason='step timeout';status=124;break;}
  if(existsSync(join(dir,'done-'+meta.worker.pid+'.json'))){done=completedScope(dir,read(join(dir,'scopes',meta.worker.pid+'.json')),meta.token);if(done){reason=done.reason;status=done.status||0;break;}}
  // Nested tools reuse this run but retain independent owner/deadline scopes.
  for(const f of readdirSync(join(dir,'scopes')).filter(f=>f.endsWith('.json'))){const scope=read(join(dir,'scopes',f));if(scope.token!==meta.token||scope.scopeOwner?.pid===meta.worker.pid||handledScopes.has(scope.scopeToken))continue;
   if(scope.retired===true&&scope.commandCleanupClosed===true&&scope.closedOwner?.pid===scope.scopeOwner.pid&&scope.closedOwner?.birth===scope.scopeOwner.birth&&Number.isFinite(scope.retiredAt)&&!ALIVE(binary,scope.scopeOwner)){handledScopes.add(scope.scopeToken);continue;}
   let phase;try{phase=scopePhase(dir,scope,meta);}catch(error){reason='invalid nested phase deadline: '+error.message;status=125;break watch;}const expired=scope.deadlineAt!==null&&Date.now()>=scope.deadlineAt||!!phase?.expired;
   if(!expired&&activeCommandClaim(dir,meta.token,binary,scope.scopeToken))continue;
   const ownerGone=!ALIVE(binary,scope.scopeOwner);if(!expired&&!ownerGone)continue;handledScopes.add(scope.scopeToken);
   const related=resourcesIn(dir).filter(r=>r.scopeToken===scope.scopeToken||r.scopeToken?.startsWith(scope.scopeToken+'/')),at=Date.now(),cleanupDeadline=Math.min(at+Math.min(scope.shutdownMs,meta.shutdownMs),readShutdown(dir,scope.scopeOwner,meta.token)?.deadlineAt||Infinity);
   const progressPath=scopeCleanupPath(dir,scope.scopeToken);atomic(progressPath,{token:meta.token,scopeToken:scope.scopeToken,scopeOwner:scope.scopeOwner,state:'pending',startedAt:at,deadlineAt:cleanupDeadline});
   if(expired)atomic(join(dir,'timeout-'+scope.scopeOwner.pid+'.json'),{token:meta.token,label:phase?.expired?'phase timeout: '+phase.record.label:'nested scope deadline',owner:scope.scopeOwner,scopeToken:scope.scopeToken,phase:phase?.expired?phase.record:undefined,at});
   const processed=new Set(),typed=await releaseResourceSet(related,meta,{runDir:dir,deadlineAt:cleanupDeadline-750,phase:'typed',processed});
   const cleanup=await reapOwnedScope(binary,meta.token,scope.scopeToken,{exclude:[process.pid,meta.worker.pid],records:[scope.scopeOwner,...related.filter(r=>r.kind==='process')],graceMs:200,maxMs:Math.max(100,cleanupDeadline-Date.now()-300)});
   const finalRelated=resourcesIn(dir).filter(r=>r.scopeToken===scope.scopeToken||r.scopeToken?.startsWith(scope.scopeToken+'/'));
   const released=await releaseResourceSet(finalRelated,meta,{runDir:dir,deadlineAt:cleanupDeadline,processed});released.errors.push(...publishReleased(dir,meta.token,[...typed.releasedResourceIds,...released.releasedResourceIds]));const completion={scope,reason:expired?'nested scope timeout':'nested owner ended',cleanup,errors:[...typed.errors,...released.errors],kept:released.kept,unsupported:[...typed.unsupported,...released.unsupported]};expiredScopes.push(completion);atomic(progressPath,{...completion,token:meta.token,scopeToken:scope.scopeToken,scopeOwner:scope.scopeOwner,state:'complete',finishedAt:Date.now()});
  }
  await wait(250);
 }
 allocator?.close();const allocationJournals=allocator?.journals()||[],allocationErrors=allocator?.errors||[];
 const started=Date.now();let state=null;try{state=read(join(dir,'state-'+meta.worker.pid+'.json'));}catch{}
 if(status===124&&!recoveryMode)atomic(join(dir,'timeout-'+meta.worker.pid+'.json'),{token:meta.token,owner:meta.worker,label:reason,at:Date.now()});
 if(status)console.error(`[supervisor ${meta.token.slice(0,8)}] ${reason}; ${done&&!/timeout|deadline/.test(reason)?'last step':'stuck at'} ${state?.step||'unknown'}, waiting on ${state?.waitingOn||'unknown'}`);
 // Restore typed state BEFORE signalling/reaping its driver or ADB endpoint.
 // One absolute budget covers hooks, process retirement and directory cleanup.
 const originalStatus=status,cleanupDeadline=recoveryMode?recoveryDeadline:Math.min(started+meta.shutdownMs,readShutdown(dir,meta.worker,meta.token)?.deadlineAt||Infinity),processed=new Set(),resources=resourcesIn(dir);
 // A live abandoned transaction worker must not keep renaming while its guardian
 // restores directories. Exact registered birth/token authorization precedes any
 // filesystem action; a completed library caller is deliberately left alive.
 const transactionErrors=[];
 if(!done&&resources.some(r=>!r.released&&r.kind==='mobile-art-directory')){
  try{if(ALIVE(binary,meta.worker)){
    if(!signalOwnedProcess(binary,meta.worker,meta.token,'SIGKILL'))throw Error('art transaction worker retirement was not authorized');
    await deadline('exact art transaction worker incarnation ends',async()=>{while(ALIVE(binary,meta.worker))await wait(10);},{timeoutMs:Math.max(1,Math.min(1000,cleanupDeadline-Date.now()-1000))});
   }}
  catch(error){transactionErrors.push(error.message);}
 }
 if(transactionErrors.length)for(const r of resources.filter(r=>!r.released&&r.kind==='mobile-art-directory')){processed.add(r.resourceId);processed.add(r.ownership?.resourceId);}
 const typed=transactionErrors.length?{errors:transactionErrors,kept:[],unsupported:resources.filter(r=>!r.released&&r.kind==='mobile-art-directory'),releasedResourceIds:[]}:await releaseResourceSet(resources,meta,{runDir:dir,deadlineAt:cleanupDeadline-750,phase:'typed',processed});
 // reapOwnedScope is the sole TERM sender; a second TERM would remove the
 // grace of a once-handler worker and restore Node's default termination.
 // A verified completed library job may return to a live Node caller. Its
 // completion authorizes resource cleanup, not termination of that caller.
 const registered=resources.filter(r=>r.kind==='process'&&!r.released),cleanup=await reapOwnedScope(binary,meta.token,null,{exclude:[process.pid,...(done&&done.errors.length===0?[meta.worker.pid]:[])],records:[meta.worker,...registered],graceMs:1000,maxMs:Math.max(100,cleanupDeadline-Date.now()-300)});
 // Worker callbacks may have released or registered resources during shutdown.
 // Only the final, post-reap scan is authoritative for filesystem/late records.
 const finalResources=resourcesIn(dir),released=await releaseResourceSet(finalResources,meta,{runDir:dir,deadlineAt:cleanupDeadline,processed});
 const errors=[...allocationErrors,...(recoveryMode?[]:done?.errors||[]),...typed.errors,...cleanup.errors,...released.errors,...expiredScopes.flatMap(s=>[...s.errors,...s.cleanup.errors])],kept=released.kept,unsupported=[...typed.unsupported,...released.unsupported,...expiredScopes.flatMap(s=>s.unsupported)];
 // Worker completion is provisional until the independent guardian also
 // succeeds. A guardian-side failure must invalidate a retained bundle too.
 if(status||errors.length||unsupported.length||cleanup.remaining.length){
  for(const record of finalResources.filter(r=>r.kind==='temp'&&r.keep&&r.requireSuccessfulCompletion)){
   try{await deadline('failed guardian provisional output disposal',()=>removeOwnedTemp({...record,keep:false},meta.token),{timeoutMs:Math.max(1,cleanupDeadline-Date.now())});const index=kept.indexOf(record.path);if(index>=0)kept.splice(index,1);}
   catch(error){errors.push('provisional output disposal: '+error.message);}
  }
 }
 if(errors.length||unsupported.length||cleanup.remaining.length)console.error('[supervisor] cleanup failed: '+JSON.stringify({errors,unsupported:unsupported.map(r=>r.kind),remaining:cleanup.remaining}));
 if(errors.length||unsupported.length||cleanup.remaining.length)status=status||1;
 const audit={schema:1,runId:meta.token,owner:meta.worker,caller:meta.caller,supervisor:own,reason,status:recoveryMode?originalStatus:status,step:state,cleanup,expiredScopes,claimWarnings,allocationJournals,resources:finalResources,kept,unsupported,errors,cleanupMs:Date.now()-started,finishedAt:new Date().toISOString()};
 if(recoveryMode){const recoveryStatus=signalReason?{SIGINT:130,SIGTERM:143,SIGHUP:129}[signalReason]:(errors.length||unsupported.length||cleanup.remaining.length||Date.now()>recoveryDeadline?1:0);audit.recovery={mode:'exact-orphan',token:meta.token,owner:meta.worker,previousSupervisor,watchdog:own,startedAt:recoveryStarted,deadlineAt:recoveryDeadline,finishedAt:Date.now(),status:recoveryStatus,completed:false,originalStatus,originalCompletion:done||null,originalDeadlineAt:meta.deadlineAt,originalShutdownDeadlineAt:readShutdown(dir,meta.worker,meta.token)?.deadlineAt??null};
  if(!recoveryStatus){const current=lstatSync(dir),check=read(join(dir,'run.json'));if(current.isSymbolicLink()||current.dev!==meta.rootIdentity.dev||current.ino!==meta.rootIdentity.ino||check.token!==meta.token)throw Error('orphan registry ownership changed; refusing removal');rmSync(dir,{recursive:true,force:false});audit.recovery.completed=true;}
  audit.recovery.finishedAt=Date.now();audit.finishedAt=new Date(audit.recovery.finishedAt).toISOString();const reportDir=resolve(import.meta.dirname,'../.cache/run-reports');mkdirSync(reportDir,{recursive:true});atomic(join(reportDir,meta.token+'.json'),audit);process.exit(recoveryStatus);
 }
 const reportDir=resolve(import.meta.dirname,'../.cache/run-reports');mkdirSync(reportDir,{recursive:true});atomic(join(reportDir,meta.token+'.json'),audit);
 if(errors.length||unsupported.length||cleanup.remaining.length)status=status||1;
 const current=lstatSync(dir),check=read(join(dir,'run.json'));if(current.dev!==meta.rootIdentity.dev||current.ino!==meta.rootIdentity.ino||check.token!==meta.token)throw Error('run registry ownership changed; refusing removal');rmSync(dir,{recursive:true,force:false});process.exit(status);
}
// First-build bootstrap has no native inspector yet. The compiler guardian is
// born as its own POSIX group leader; its own live PID reserves the group. It
// alone may signal that group, and an independent 4s timer survives parent death.
export async function compileIdentityArtifact(source,artifact,sourceSha,guardToken,compiler=null){
 if(!guardToken||process.env.HW_IDENTITY_GUARD_TOKEN!==guardToken)throw Error('compiler guardian handshake invalid');
 if(process.platform==='win32')throw Error('precise process identity unsupported on Windows');
 const hash=b=>createHash('sha256').update(b).digest('hex');
 let scratch,build,compilerAttempted=false;const removeBuild=()=>removeCompilerScratch(scratch);
 let finished=false;const stop=(status,reason)=>{if(finished)return;finished=true;console.error('identity compiler guardian: '+reason);try{removeBuild();}catch(e){console.error(e.message);}process.exitCode=status;if(compilerAttempted)process.kill(-process.pid,'SIGKILL');else process.exit(status);};
 const timer=setTimeout(()=>stop(124,'compiler deadline4000ms'),4000);for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>stop(125,signal));
 try{if(hash(readBootstrapBytes(source))!==sourceSha)throw Error('compiler input changed');scratch=createCompilerScratch(dirname(artifact),guardToken);build=scratch.path;const cmd=compiler||['/usr/bin/cc','-O2','-Wall','-Wextra',source,'-o',join(build,'process-identity')];compilerAttempted=true;const child=spawn(cmd[0],cmd.slice(1),{stdio:['ignore','pipe','pipe'],env:{...process.env,HW_IDENTITY_GUARD_TOKEN:guardToken}});let stderr='';child.stdout.resume();child.stderr.on('data',d=>{if(stderr.length<16384)stderr+=d.toString('utf8').slice(0,16384-stderr.length);});
  const status=await new Promise((res,rej)=>{child.once('error',rej);child.once('exit',(code,signal)=>res({code,signal}));});if(status.code!==0)throw Error('compiler failed '+JSON.stringify(status)+' '+stderr);
  if(hash(readBootstrapBytes(source))!==sourceSha)throw Error('compiler input changed while building');const binary=join(build,'process-identity'),m={sourceSha256:sourceSha,binarySha256:hash(readBootstrapBytes(binary,2*1048576)),platform:process.platform,arch:process.arch,command:cmd,compilerTimeoutMs:4000,groupOwnerToken:guardToken};writeFileSync(join(build,'manifest.json'),JSON.stringify(m));
  try{renameSync(build,artifact);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;removeBuild();}finished=true;clearTimeout(timer);return 0;
 }catch(e){if(e.compilerResidue)console.error('compiler setup residue '+JSON.stringify(e.compilerResidue));stop(125,e.message);throw e;}
}
export async function bootstrapWatchdog(){
 if(!process.send||!process.connected)throw Error('bootstrap guardian requires owned IPC');const message=await deadline('bootstrap metadata admission',signal=>new Promise((res,rej)=>{const received=body=>{cleanup();res(body);},ended=()=>{cleanup();rej(Error('bootstrap caller IPC ended before admission'));},aborted=()=>{cleanup();try{if(process.connected)process.disconnect();}catch{}rej(signal.reason||Error('bootstrap metadata cancelled'));},cleanup=()=>{process.removeListener('message',received);process.removeListener('disconnect',ended);signal.removeEventListener('abort',aborted);};process.once('message',received);process.once('disconnect',ended);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();}),{timeoutMs:3000});
 if(!message?.bootstrap||Buffer.byteLength(JSON.stringify(message))>1048576)throw Error('bootstrap metadata missing/oversized');const metadata=message.bootstrap,helper=authenticateBootstrapHelper(metadata.helper,process.env.HW_TOOL_IDENTITY_BINARY),worker=inspectProcess(helper.binary,process.ppid),caller=inspectProcess(helper.binary,metadata.caller?.pid);validateBootstrapMetadata(metadata,{token:process.env.HW_TOOL_RUN_TOKEN,actualWorker:worker,actualCaller:caller,guardianParentPid:process.ppid});const own=inspectProcess(helper.binary,process.pid);if(!own)throw Error('bootstrap guardian native identity unavailable');
 let owned;try{owned=createBootstrapRoot(metadata,own,process.platform==='darwin'?'/private/tmp':tmpdir());}catch(error){if(error.bootstrapResidue)console.error('bootstrap setup residue '+JSON.stringify(error.bootstrapResidue));throw error;}console.error('[bootstrap] '+JSON.stringify({token:metadata.token,nonce:metadata.bootstrapNonce,path:owned.dir,guardian:own,rootIdentity:owned.meta.rootIdentity,phase:'created-before-worker-admission'}));try{return await watchdog(owned.dir);}catch(error){
  const started=Date.now(),deadlineAt=started+metadata.shutdownMs,errors=[error.message];try{const now=lstatSync(owned.dir),marker=readBootstrapJSON(join(owned.dir,'.hw-run-owner'),4096);if(now.isSymbolicLink()||now.dev!==owned.meta.rootIdentity.dev||now.ino!==owned.meta.rootIdentity.ino||marker.token!==metadata.token||marker.nonce!==metadata.bootstrapNonce||marker.guardian.pid!==own.pid||marker.guardian.birth!==own.birth)throw Error('bootstrap error cleanup ownership changed');const resources=resourcesIn(owned.dir),processed=new Set(),typed=await releaseResourceSet(resources,owned.meta,{runDir:owned.dir,deadlineAt:deadlineAt-750,phase:'typed',processed}),cleanup=await reapOwnedScope(helper.binary,metadata.token,null,{exclude:[process.pid],records:[owned.meta.worker,...resources.filter(r=>r.kind==='process')],graceMs:200,maxMs:Math.max(100,deadlineAt-Date.now()-300)}),released=await releaseResourceSet(resourcesIn(owned.dir),owned.meta,{runDir:owned.dir,deadlineAt,processed});errors.push(...typed.errors,...cleanup.errors,...released.errors,...typed.unsupported.map(r=>'unsupported '+r.kind),...released.unsupported.map(r=>'unsupported '+r.kind));if(cleanup.remaining.length)errors.push('bootstrap error cleanup left native processes');if(errors.length===1)rmSync(owned.dir,{recursive:true,force:false});}catch(e){errors.push(e.message);}console.error('bootstrap guardian setup failed '+JSON.stringify({token:metadata.token,path:owned.dir,errors,cleanupMs:Date.now()-started}));throw error;
 }
}
export async function supervisorMain(args=process.argv.slice(2)){
 if(args[0]==='--bootstrap-watchdog'){if(args.length!==1)throw Error('invalid bootstrap guardian arguments');return bootstrapWatchdog();}
 if(args[0]==='--compile-identity'){if(args.length<5)throw Error('invalid compiler guardian arguments');return compileIdentityArtifact(args[1],args[2],args[3],args[4],args.length>5?args.slice(5):null);}
 // Explicit orphan recovery remains a private audit command, not a public art API.
 if(args[0]==='--recover')throw Error('orphan recovery is unsupported by the optional public art package');
 if(args[0]==='--watchdog'){if(args.length!==2)throw Error('invalid watchdog arguments');return watchdog(resolve(args[1]));}
 const o=parseSupervisorArgs(args);if(o.help){console.log('Usage: node tools/run-supervised.mjs [--timeout-ms N] [--serial --queue-timeout-ms N --serial-root PATH] [--shutdown-ms N] -- command [args...]\nDefault: independent parallel owned run; signals/timeout/parent death trigger bounded cleanup.');return 0;}
 const rt=ensureToolRuntime({name:o.command.join(' '),runTimeoutMs:o.timeoutMs,shutdownMs:o.shutdownMs});await rt.ready;
 if(o.serial)await acquireSerial(rt,o);
 const result=await rt.runCommand(o.command[0],o.command.slice(1),{timeoutMs:o.timeoutMs,label:o.command[0],stdio:'inherit'});let status=result.status;
 if(result.cleanup.errors.length||result.cleanup.remaining.length||result.cleanup.observedLeftovers.length){console.error('[supervisor] command cleanup evidence '+JSON.stringify(result.cleanup));status=status||1;}
 process.exitCode=status;await rt.shutdown(result.timedOut?'timeout':'command complete');return status;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))supervisorMain().then(status=>{if(typeof status==='number')process.exitCode=status;}).catch(e=>{console.error(e.stack||e.message);process.exitCode=e instanceof DeadlineError?124:125;});
