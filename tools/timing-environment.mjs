/** Inert on import. Owned idle-sleep prevention and honest host timing observations. */
import {opendir,lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {loadavg,cpus} from 'node:os';
import {setTimeout as pause} from 'node:timers/promises';
import {inspectProcess,ownedProcesses,signalOwnedProcess} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {commandCleanupProblems} from './command-acceptance.mjs';

export function idleSleepAssertion(output,pid){
 if(typeof output!=='string'||!Number.isSafeInteger(pid)||pid<=1)throw Error('invalid idle-sleep assertion observation');
 return output.split('\n').find(line=>new RegExp('^\\s*pid '+pid+'\\(caffeinate\\): \\[0x[0-9a-f]+\\] \\S+ PreventUserIdleSystemSleep\\b').test(line))?.trim()||null;
}
export function timingEnvironment({traced=false,loadAvg,activeTokens=[],activeScopes=[],issues=[],observedAt=new Date().toISOString()}={}){
 if(typeof traced!=='boolean'||!Array.isArray(loadAvg)||loadAvg.length!==3||!loadAvg.every(n=>Number.isFinite(n)&&n>=0)||![activeTokens,activeScopes,issues].every(Array.isArray))throw Error('invalid timing environment observation');
 return {status:issues.length?'PARTIAL':'OBSERVED',mode:traced?'traced-attribution':'untraced-measurement',contention:issues.length?'UNKNOWN':activeTokens.length||activeScopes.length?'SUPERVISED_PEERS_OBSERVED':'NO_SUPERVISED_PEERS_OBSERVED',observedAt,loadAvg,logicalCpuCount:cpus().length,activeTokens,activeScopes,issues,timingIsolation:'NOT_ESTABLISHED',physicalPhone:false,physicalPresentation:false,scope:'Actual local supervised run/scopes and host load only; unregistered work, GPU contention and physical presentation are not inspected'};
}
async function directoryEntries(runtime,path,limit){
 const directory=await opendir(path,{bufferSize:16});let closing,unregister=()=>{};const close=()=>closing??=directory.close();
 try{unregister=runtime.onCleanup('close timing observation directory '+path,close);const entries=[];while(true){if(runtime.signal.aborted)throw runtime.signal.reason;const entry=await directory.read();if(runtime.signal.aborted)throw runtime.signal.reason;if(!entry)break;if(entries.length>=limit)throw Error('timing directory inventory exceeds '+limit+' entries');entries.push(entry);}return entries;}
 finally{try{await close();}finally{unregister();}}
}
export async function observeTimingEnvironment(runtime,{traced=false}={}){
 if(typeof traced!=='boolean')throw Error('traced timing selection must be boolean');
 await runtime.ready;
 return runtime.deadline('observe actual host timing load and supervised peers',async()=>{
  const activeTokens=[],activeScopes=[],issues=[],binary=runtime.ownerRecord.helper.binary;
  const read=async path=>JSON.parse(await readRegularInput(path,{runtime,maxBytes:65536,timeoutMs:1500}));
  const pinned=record=>{const actual=record&&inspectProcess(binary,record.pid);return actual&&actual.birth===record.birth?actual:null;};
  try{for(const entry of await directoryEntries(runtime,dirname(runtime.runDir),2048)){
   if(!entry.name.startsWith('heartwood-run-'))continue;const path=join(dirname(runtime.runDir),entry.name);
   try{
    const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('registry is not a regular directory');
    const meta=await read(join(path,'run.json'));if(meta.schema!==1||typeof meta.token!=='string'||!meta.token||meta.rootIdentity?.dev!==info.dev||meta.rootIdentity?.ino!==info.ino)throw Error('registry identity is unsupported');
    if(meta.token===runtime.runId)continue;const members=ownedProcesses(binary,meta.token),worker=pinned(meta.worker),supervisor=pinned(meta.supervisor);
    if(!members.length&&!worker&&!supervisor)continue;
    if(!supervisor||!members.length)throw Error('active registry has incomplete native ownership');
    activeTokens.push({token:meta.token,name:meta.name,worker:worker?{pid:worker.pid,birth:worker.birth}:null,supervisor:{pid:supervisor.pid,birth:supervisor.birth},ownedProcesses:members.length});
   }catch(error){issues.push({path,error:error.message});}
  }}catch(error){if(runtime.signal.aborted)throw error;issues.push({path:dirname(runtime.runDir),error:error.message});}
  try{const members=ownedProcesses(binary,runtime.runId);for(const entry of await directoryEntries(runtime,join(runtime.runDir,'scopes'),128)){
   if(!entry.name.endsWith('.json'))continue;const scope=await read(join(runtime.runDir,'scopes',entry.name));
   if(scope.token!==runtime.runId||typeof scope.scopeToken!=='string')throw Error('unsupported same-run scope');
   if(scope.scopeOwner?.pid===process.pid||scope.scopeToken===runtime.scopeToken||runtime.scopeToken.startsWith(scope.scopeToken+'/'))continue;
   const actual=members.find(p=>p.pid===scope.scopeOwner?.pid&&p.birth===scope.scopeOwner?.birth);if(actual)activeScopes.push({token:runtime.runId,scopeToken:scope.scopeToken,pid:actual.pid,birth:actual.birth});
  }}catch(error){if(runtime.signal.aborted)throw error;issues.push({path:join(runtime.runDir,'scopes'),error:error.message});}
  return timingEnvironment({traced,loadAvg:loadavg(),activeTokens:activeTokens.sort((a,b)=>a.token.localeCompare(b.token)),activeScopes:activeScopes.sort((a,b)=>a.scopeToken.localeCompare(b.scopeToken)),issues});
 },{timeoutMs:8000});
}
export async function holdMacTimingAwake(runtime){
 await runtime.ready;if(process.platform!=='darwin')return {report:{status:'UNSUPPORTED',reason:'Mac idle-sleep assertion only; no global state changed'},check:()=>{},release:async()=>{}};
 const binary=runtime.ownerRecord.helper.binary,child=await runtime.spawn('/usr/bin/caffeinate',['-i','-w',String(process.pid)],{stdio:'ignore',label:'owned Mac timing idle-sleep assertion'});
 // System executables can lack readable inherited tokens. The shared runtime
 // also admits exact caller descendants via its native PID/birth/parent handshake.
 const record=await runtime.registerProcess(child,{label:'owned Mac timing idle-sleep assertion',scopeToken:child.toolScopeToken});
 const actual=inspectProcess(binary,record.pid);if(!actual||actual.birth!==record.birth||!['token-owned','caller-owned'].includes(record.role))throw Error('sleep assertion child has no exact registered native incarnation');
 const report={status:'STARTING',pid:record.pid,birth:record.birth,authentication:record.role,scopeToken:child.toolScopeToken,ownerToken:runtime.runId,supervisor:runtime.ownerRecord.supervisor,args:['-i','-w',String(process.pid)],displayAssertion:false};let releasing,unregister=()=>{};
 child.toolClosed.then(result=>{if(!releasing&&report.status==='HELD'){report.status='LOST';report.loss={result,at:new Date().toISOString()};process.exitCode=process.exitCode||1;}});
 const check=()=>{const now=inspectProcess(binary,record.pid);if(report.status!=='HELD'||!now||now.birth!==record.birth){if(report.status==='HELD'){report.status='LOST';report.loss={reason:'native assertion incarnation ended',at:new Date().toISOString()};process.exitCode=process.exitCode||1;}throw Error('owned idle-sleep assertion is not held');}};
 const release=()=>releasing??=(async()=>{
  signalOwnedProcess(binary,record,runtime.runId,'SIGTERM');await runtime.deadline('owned idle-sleep assertion exit',()=>child.toolClosed,{timeoutMs:2500,cleanup:true});
  const still=inspectProcess(binary,record.pid);if(still?.birth===record.birth)throw Error('owned idle-sleep assertion remains alive');report.status='RELEASED';report.releasedAt=new Date().toISOString();unregister();
 })();
 unregister=runtime.onCleanup('release owned Mac timing idle-sleep assertion',release);
 try{await runtime.deadline('observe exact owned Mac idle-sleep assertion',async signal=>{
  while(true){if(signal.aborted)throw signal.reason;
   const observed=await runtime.runCommand('/usr/bin/pmset',['-g','assertions'],{timeoutMs:1200,maxBuffer:131072,label:'read owned Mac assertion readiness'});
   const problems=commandCleanupProblems(observed);if(observed.status!==0||problems.length)throw Error('sleep assertion observation failed: '+observed.status+' '+problems.join('; '));
   const assertion=idleSleepAssertion(observed.stdout,record.pid);if(assertion){report.status='HELD';report.heldAt=new Date().toISOString();report.assertion=assertion;return;}
   if(!inspectProcess(binary,record.pid))throw Error('owned caffeinate exited before holding an assertion');await pause(20,undefined,{signal});
  }
 },{timeoutMs:3000});check();return {report,check,release};}
 catch(error){try{await release();}catch(cleanupError){throw new AggregateError([error,cleanupError],'idle-sleep assertion startup/cleanup failed');}throw error;}
}
export async function beginTimingRun(runtime,{traced=false}={}){
 if(typeof traced!=='boolean')throw Error('traced timing selection must be boolean');
 const sleep=await holdMacTimingAwake(runtime);
 try{const snapshot=async()=>{sleep.check();const environment=await observeTimingEnvironment(runtime,{traced});sleep.check();return environment;};return {sleepPrevention:sleep.report,environment:await snapshot(),snapshot,release:sleep.release};}
 catch(error){await sleep.release();throw error;}
}
