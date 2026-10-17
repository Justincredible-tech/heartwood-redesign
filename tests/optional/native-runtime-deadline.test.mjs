// Explicit optional native regression: POSIX and the actual CC/cc prerequisite.
// Required compiler-free tests never discover tests/optional/ automatically.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConnection} from 'node:net';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

assert(['darwin','linux'].includes(process.platform),'UNSUPPORTED: native runtime controls require POSIX process custody and a CC/cc compiler');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function absent(path){try{await lstat(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
function processPresent(helper,record){
  try{const actual=JSON.parse(execFileSync(helper.binary,[String(record.pid)],{timeout:1000,maxBuffer:8192,encoding:'utf8',stdio:['ignore','pipe','pipe']}));return actual.birth===record.birth;}
  catch(error){if(error.status===1)return false;throw error;}
}
async function portClosed(port){
  return new Promise((resolve,reject)=>{
    const socket=createConnection({host:'127.0.0.1',port});
    const timer=setTimeout(()=>{socket.destroy();reject(Error('Owned port probe exceeded500ms'));},500);
    socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve(false);});
    socket.once('error',error=>{clearTimeout(timer);error.code==='ECONNREFUSED'?resolve(true):reject(error);});
  });
}

async function control(mode){
  const folder=await mkdtemp(join(tmpdir(),'heartwood-native-regression-'));
  const folderPin=await lstat(folder),token=randomUUID(),marker=join(folder,'.test-owner'),receipt=join(folder,'resources.json');
  await writeFile(marker,token,{flag:'wx',mode:0o600});
  const env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('HW_TOOL_')||['TMPDIR','TMP','TEMP'].includes(key))delete env[key];
  let worker,exited,emergency,result,resources,stderr='',bytes=0,forced=false;
  const started=performance.now();
  try{
    worker=spawn(process.execPath,[fileURLToPath(new URL('../fixtures/native-runtime-worker.mjs',import.meta.url)),mode,receipt],{detached:true,stdio:['ignore','pipe','pipe'],env});
    exited=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('close',(code,signal)=>resolve({code,signal}));});
    exited.catch(()=>{});
    for(const stream of [worker.stdout,worker.stderr])stream.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>65536){forced=true;worker.kill('SIGKILL');return;}
      if(stream===worker.stderr)stderr+=chunk;
    });
    emergency=setTimeout(()=>{forced=true;worker.kill('SIGKILL');},9000);
    for(const until=performance.now()+7000;performance.now()<until;){
      try{resources=JSON.parse(await readFile(receipt,'utf8'));break;}catch{}
      if(worker.exitCode!==null||worker.signalCode!==null)break;
      await pause(20);
    }
    if(!resources){await exited;throw Error('Native control admission failed; POSIX compiler/custody prerequisite: '+stderr.slice(-4096));}
    if(mode==='stop')worker.kill('SIGTERM');
    result=await exited;clearTimeout(emergency);
    const cleanupStarted=performance.now();
    let processesAbsent=false;
    do{
      processesAbsent=[resources.worker,resources.child,resources.supervisor].every(record=>!processPresent(resources.helper,record));
      if(processesAbsent)break;
      await pause(40);
    }while(performance.now()-cleanupStarted<8000);
    assert(!forced,'Native control exceeded independent harness bounds');
    assert(processesAbsent,'Owned worker, child or guardian incarnation remains');
    for(const path of [resources.scratch,resources.temp,resources.runDir])assert(await absent(path),'Owned native control resource remains');
    assert(await portClosed(resources.port),'Owned listener remains open');
    const audit=JSON.parse(await readFile(resources.auditPath,'utf8'));
    assert.equal(audit.cleanup.remaining.length,0);assert.equal(audit.unsupported.length,0);
    if(mode==='pending'){
      assert(result.code!==0||result.signal,'Unfinished operation cannot pass');
      assert(audit.errors.some(error=>/unfinished operations/.test(error)),'Completion must record the unfinished operation');
    }else{
      assert.equal(audit.errors.length,0,'Native cleanup failed');
      if(mode==='normal'){
        assert.equal(result.code,0);assert.equal(audit.status,0);
        const proof=JSON.parse(await readFile(receipt+'.exit.json','utf8'));
        assert.equal(proof.watch.retired,true);assert.equal(proof.watch.pendingSteps,0);
      }else if(mode==='stop'){
        assert.equal(result.code,143);assert.equal(audit.status,143);
      }else{
        assert(result.code!==0||result.signal,'Blocked main loop returned a false pass');
        assert.match(stderr,/stuck at blocked main control/);
      }
    }
  }finally{
    clearTimeout(emergency);
    if(worker&&worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');
    if(exited){
      let timer;
      try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned control transport retirement exceeded8000ms')),8000);})]);}
      finally{clearTimeout(timer);}
    }
    if(resources){
      const until=performance.now()+8000;
      while([resources.worker,resources.child,resources.supervisor].some(record=>processPresent(resources.helper,record))&&performance.now()<until)await pause(40);
      assert([resources.worker,resources.child,resources.supervisor].every(record=>!processPresent(resources.helper,record)),'Error cleanup left an owned process incarnation');
    }
    const now=await lstat(folder);
    assert(now.isDirectory()&&!now.isSymbolicLink()&&now.dev===folderPin.dev&&now.ino===folderPin.ino&&(await readFile(marker,'utf8'))===token,'Test scratch ownership changed; preserving it');
    await rm(folder,{recursive:true,force:false});
  }
}

for(const mode of ['blocked','normal','stop','pending']){
  test('actual native runtime '+mode+' step and exact resource retirement',{timeout:20000,concurrency:false},()=>control(mode));
}
