import {Worker} from 'node:worker_threads';
import {mkdtemp,open,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import assert from 'node:assert/strict';
import {writeOutput} from './build-output.mjs';
import {bound,canonicalDirectory,cleanupScratch,identity,markerName} from './whole-build-ownership.mjs';
let init,worker,record,wholeTimer,phaseTimer,forceTimer,setupPromise,stopping,step='guardian admission',workerExit,result,received=false,marked=false;
const controller=new AbortController(),writes=new Set();
const send=message=>{if(process.connected)process.send(message,error=>{if(error&&!stopping)void stop(125,'guardian IPC failed: '+error.message);});};
const fail=error=>void stop(error.exitCode||1,error.message);
// Self-only emergency retirement cannot address a foreign/recycled process:
// process.pid is this still executing guardian, and no external PID/group is used.
function fatalExit(code,message){console.error('[build guardian] '+message);process.exitCode=code;process.kill(process.pid,'SIGKILL');}
async function stop(code,message){if(stopping)return stopping;stopping=(async()=>{
 clearTimeout(wholeTimer);clearTimeout(phaseTimer);controller.abort(Error(message));
 forceTimer=setTimeout(()=>fatalExit(125,'shutdown exceeded8s; last step '+step),8000);
 const errors=[];if(setupPromise)try{await bound('guardian setup retirement',()=>setupPromise.catch(()=>{}),1500);}catch(error){errors.push(error.message);}
 if(worker)try{await bound('worker retirement',()=>worker.terminate(),2000);}catch(error){errors.push(error.message);}
 try{await bound('atomic write retirement',()=>Promise.allSettled([...writes]),2000);}catch(error){errors.push(error.message);}
 try{await bound('owned scratch cleanup',()=>cleanupScratch(record,{partial:!marked}),1500);}catch(error){errors.push(error.message);}
 if(errors.length){code=125;message+='; cleanup: '+errors.join('; ');}
 send({type:'closed',token:init?.token,code,message,result:code===0?result:undefined,cleanup:{status:errors.length?'FAILED':'CLEAN',errors}});
 clearTimeout(forceTimer);if(process.connected)process.disconnect();
 // A native Worker operation may ignore termination until it returns. Once
 // guardian-owned writes/scratch are retired, kill this exact guardian if needed.
 if(errors.some(error=>error.startsWith('stuck at worker retirement')))fatalExit(code,message);
 process.exitCode=code;
 })();return stopping;
}
for(const [signal,code]of[['SIGINT',130],['SIGTERM',143],['SIGHUP',129]])process.once(signal,()=>void stop(code,'stopped by '+signal+' at '+step));
process.once('disconnect',()=>void stop(143,'launcher disconnected at '+step));
const admissionTimer=setTimeout(()=>void stop(124,'guardian admission deadline exceeded'),3000);
process.once('message',message=>{
 clearTimeout(admissionTimer);setupPromise=(async()=>{
  assert(message?.type==='init'&&typeof message.token==='string'&&/^[0-9a-f-]{36}$/.test(message.token),'Invalid guardian admission');init=message;
  assert(typeof init.entry==='string'&&init.entry.startsWith('file:')&&typeof init.method==='string'&&init.method.length<=128&&Number.isInteger(init.timeoutMs)&&init.timeoutMs>0&&init.timeoutMs<=300000&&Number.isInteger(init.phaseMs)&&init.phaseMs>0&&init.phaseMs<=120000,'Invalid build deadlines/operation');
  const parent=resolve(init.parent),parentIdentity=await canonicalDirectory(parent);
  const scratch=await mkdtemp(join(parent,'.heartwood-whole-build-'));record={schema:1,token:init.token,path:scratch,parent,parentIdentity,...await canonicalDirectory(scratch)};
  await chmod(scratch,0o700);const handle=await open(join(scratch,markerName),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(JSON.stringify(record)+'\n');}finally{await handle.close();}marked=true;
  // `admitted` is process-local state, never a change to the pinned marker.
  send({type:'ready',record});if(stopping)return;
  const output=resolve(init.out),projectRoot=resolve(init.projectRoot),tools=join(projectRoot,'tools');
  assert(output!==projectRoot&&!['source','tools','.git','.audit','site','evidence'].some(name=>output===join(projectRoot,name)||output.startsWith(join(projectRoot,name)+sep)),'Build output overlaps inputs');
  wholeTimer=setTimeout(()=>void stop(124,'stuck at '+step+'; whole build exceeded '+init.timeoutMs+'ms'),init.timeoutMs);
  worker=new Worker(new URL('./whole-build-worker.mjs',import.meta.url),{workerData:{entry:init.entry,method:init.method,options:init.options}});
  workerExit=new Promise(resolveExit=>worker.once('exit',resolveExit));
  worker.on('message',message=>{
   if(stopping)return;
   if(message?.type==='step'){assert(typeof message.step==='string'&&message.step.length<=512,'Invalid build step');step=message.step;send({type:'step',token:init.token,step});if(step==='compress public text assets'&&!phaseTimer){phaseTimer=setTimeout(()=>void stop(124,'stuck at compression; phase exceeded '+init.phaseMs+'ms'),init.phaseMs);}return;}
   if(message?.type==='failure'){fail(Error(message.message));return;}
   if(message?.type==='result'){assert(!received&&message.result&&typeof message.result==='object','Missing/duplicate whole build result');received=true;result=message.result;void(async()=>{try{const code=await bound('normal build worker exit',()=>workerExit,1500);assert(code===0,'Build Worker crashed after result');await stop(0,'build completed at '+step);}catch(error){fail(error);}})();return;}
   if(message?.type!=='write')return;
   const task=(async()=>{assert(writes.size<8&&Number.isSafeInteger(message.id)&&message.id>0&&typeof message.out==='string'&&typeof message.path==='string'&&(message.bytes instanceof Uint8Array||typeof message.bytes==='string'),'Invalid whole build write');assert(Buffer.byteLength(message.bytes)<=8*1024*1024,'Whole build write exceeds8MiB');const requested=resolve(message.out),destination=resolve(requested,message.path);assert(requested===output||requested.startsWith(output+sep)||requested===tools&&['build-manifest.json','compression-report.json'].includes(message.path),'Worker write outside selected output/metadata');assert(destination.startsWith(requested+sep),'Whole build path escaped');await writeOutput(requested,message.path,message.bytes,{temporaryRoot:record.path,signal:controller.signal});if(!stopping)worker.postMessage({id:message.id});})().catch(error=>{if(!stopping)worker.postMessage({id:message.id,error:error.message});fail(error);}).finally(()=>writes.delete(task));writes.add(task);
  });worker.once('error',fail);worker.once('exit',code=>{if(!received&&!stopping)fail(Error('Build Worker exited without a result: '+code));});
 })();setupPromise.catch(fail);
});
