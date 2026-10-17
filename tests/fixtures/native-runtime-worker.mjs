import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {createToolRuntime,inspectProcess} from '../../tools/tool-runtime.mjs';

const [mode,receiptPath]=process.argv.slice(2);
const runtime=createToolRuntime({name:'optional native runtime control',runTimeoutMs:10000,stepTimeoutMs:400,shutdownMs:6000,heartbeatMs:9000});
await runtime.ready;
process.once('exit',code=>writeFileSync(receiptPath+'.exit.json',JSON.stringify({code,watch:runtime.independentDeadlineWatch})+'\n'));
const temp=await runtime.tempDir('native-runtime-control-');
const server=createServer((_,response)=>response.end('owned local control'));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
runtime.onCleanup('owned listener',()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),{kind:'listener',details:{host:'127.0.0.1',port}});
const child=await runtime.spawn(process.execPath,[fileURLToPath(new URL('./native-runtime-idle.mjs',import.meta.url))],{detached:true,stdio:'ignore',label:'owned idle child'});
await writeFile(receiptPath,JSON.stringify({mode,worker:runtime.ownerRecord.worker,supervisor:runtime.ownerRecord.supervisor,child:inspectProcess(runtime.ownerRecord.helper.binary,child.pid),helper:runtime.ownerRecord.helper,runId:runtime.runId,runDir:runtime.runDir,scratch:runtime.scratchDir,temp,port,auditPath:fileURLToPath(new URL('../../output/review-tooling/cleanup/run-reports/'+runtime.runId+'.json',import.meta.url))})+'\n');

if(mode==='stop'){
  try{await runtime.deadline('stop control',()=>new Promise(()=>{}),{timeoutMs:5000});}
  catch(error){if(error!==runtime.signal.reason)throw error;await runtime.shutdown('stop control awaited cleanup');}
}else if(mode==='pending'){
  const external=new AbortController();
  const pending=runtime.deadline('unfinished custom-signal operation',()=>new Promise(()=>{}),{timeoutMs:5000,signal:external.signal});
  pending.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,30));
  const result=await runtime.shutdown('unfinished operation control');
  assert(result.errors.some(error=>/unfinished operations/.test(error)));
  assert.equal(runtime.independentDeadlineWatch.retired,false);
  process.exitCode=1;
}else{
  assert(['blocked','normal'].includes(mode),'Unknown native runtime control');
  await runtime.deadline(mode==='blocked'?'blocked main control':'completed control',()=>{
    if(mode==='blocked'){const until=performance.now()+1200;while(performance.now()<until){Math.sqrt(17);}}
    return 'complete';
  },{timeoutMs:400});
  // Idle external resources must not prevent beforeExit-triggered shutdown.
  server.unref();child.unref();
}
