// Independent deadlines for a tool whose main event loop may stop responding.
// This watcher signals only its own process; resource owners must independently
// retire their children when this process's IPC channels disconnect.
import assert from 'node:assert/strict';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {write as writeFD} from 'node:fs';
import {lstatSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat,readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const MAX_MS=60*60*1000;
export function deadlineBudget(value,label='deadline'){
  assert(Number.isSafeInteger(value)&&value>0&&value<=MAX_MS,label+' must be an integer from1 to3600000ms');
  return value;
}
function stepLabel(value){
  assert(typeof value==='string'&&value.trim()&&value.length<=256,'Step label must be nonempty and bounded');
  return value;
}

function authenticateNativeOwner(proof){
  assert(proof&&typeof proof==='object'&&typeof proof.runDir==='string'&&typeof proof.token==='string'&&typeof proof.scopeToken==='string'&&proof.owner?.pid===process.pid&&typeof proof.owner.birth==='string','Step-only watch requires authenticated native owner');
  const read=(path,max)=>{const before=lstatSync(path);assert(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=max,'Native owner input is not bounded regular data');const bytes=readFileSync(path),after=lstatSync(path);assert(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&bytes.length===before.size,'Native owner input changed');return bytes;};
  const meta=JSON.parse(read(join(proof.runDir,'run.json'),8*1024*1024)),scope=JSON.parse(read(join(proof.runDir,'scopes',process.pid+'.json'),8192));
  assert(meta.token===proof.token&&meta.allocationProtocol===1&&scope.token===proof.token&&scope.scopeToken===proof.scopeToken&&scope.scopeOwner?.pid===process.pid&&scope.scopeOwner.birth===proof.owner.birth&&Number.isInteger(meta.supervisor?.pid)&&meta.supervisor.pid!==process.pid&&typeof meta.supervisor.birth==='string','Native independent owner lease not authenticated');
  const helper=meta.helper;assert(typeof helper?.binary==='string'&&/^[a-f0-9]{64}$/.test(helper.binarySha256||'')&&/^[a-f0-9]{64}$/.test(helper.sourceSha256||''),'Native helper pin absent');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert(hash(read(new URL('../process-identity.c',import.meta.url),1024*1024))===helper.sourceSha256&&hash(read(helper.binary,2*1024*1024))===helper.binarySha256,'Native helper source/binary pin changed');
  const manifest=JSON.parse(read(join(dirname(helper.binary),'manifest.json'),8192));assert(manifest.platform===process.platform&&manifest.arch===process.arch&&manifest.sourceSha256===helper.sourceSha256&&manifest.binarySha256===helper.binarySha256,'Native helper manifest changed');
  const inspect=pid=>JSON.parse(execFileSync(helper.binary,[String(pid)],{timeout:1000,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8192}));
  assert(inspect(process.pid).birth===proof.owner.birth&&inspect(meta.supervisor.pid).birth===meta.supervisor.birth,'Native worker/guardian incarnation is absent or changed');
  const root=lstatSync(proof.runDir);assert(root.isDirectory()&&!root.isSymbolicLink()&&root.dev===meta.rootIdentity?.dev&&root.ino===meta.rootIdentity?.ino,'Native registry root changed');
  assert(Number.isSafeInteger(scope.shutdownMs)&&scope.shutdownMs>0&&scope.shutdownMs<=10000,'Native cleanup budget invalid');
  return {...proof,rootIdentity:{dev:root.dev,ino:root.ino},shutdownMs:scope.shutdownMs};
}
export function createDeadlineWatch({timeoutMs,nativeOwner}={}){
  const nativeLease=timeoutMs===null||nativeOwner!==undefined?authenticateNativeOwner(nativeOwner):undefined;
  if(timeoutMs!==null)deadlineBudget(timeoutMs,'overall deadline');
  const authenticated=nativeOwner!==undefined;
  const worker=new Worker(new URL(import.meta.url),{
    execArgv:[],workerData:{kind:'tool-deadline-watch',deadline:timeoutMs===null?null:performance.now()+timeoutMs,nativeOwnerAuthenticated:authenticated,nativeLease}
  });
  const steps=new Map();
  const fatal=error=>{
    process.stderr.write('[deadline] independent watcher failed: '+error.message+'\n');
    // Never leave a live tool unprotected after its independent watcher fails.
    // External resource owners observe IPC disconnect and retire their children.
    process.exit(125);
  };
  let next=0,closed=false,closing,failure;
  let readyYes,readyNo,exitYes;
  const ready=new Promise((yes,no)=>{readyYes=yes;readyNo=no});
  const exited=new Promise(yes=>{exitYes=yes});
  const startup=setTimeout(()=>{
    const error=Error('Deadline watcher did not initialize within1000ms');
    failure=error;readyNo(error);void worker.terminate();fatal(error);
  },1000);
  worker.on('message',message=>{
    if(message?.kind==='ready'){clearTimeout(startup);readyYes();}
  });
  worker.once('error',error=>{
    clearTimeout(startup);failure=error;readyNo(error);fatal(error);
  });
  worker.once('exit',code=>{
    clearTimeout(startup);exitYes(code);
    if(!closing){
      failure??=Error('Deadline watcher exited unexpectedly: '+code);
      readyNo(failure);fatal(failure);
    }
  });
  const begin=(label,timeoutMs,nativeBudget=false,{recoverable=false}={})=>{
      assert(typeof recoverable==='boolean'&&(!recoverable||authenticated),'Recoverable deadline requires authenticated native owner');
      stepLabel(label);
      if(nativeBudget)assert(authenticated&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=2147483647,'Owned finite step requires authenticated native owner and supported timer budget');
      else deadlineBudget(timeoutMs,'step deadline');
      assert(!closed&&!closing&&!failure,'Deadline watcher is closed or failed');
      assert(steps.size<128,'Too many concurrent tool steps');
      const id=++next;steps.set(id,label);
      worker.postMessage({kind:'begin',id,label,deadline:performance.now()+timeoutMs,nativeBudget,recoverable});
      let ended=false;
      return ()=>{if(ended)return;ended=true;steps.delete(id);if(!closed&&!closing&&!failure)worker.postMessage({kind:'end',id});};
  };
  return {
    ready,
    ref(){worker.ref();},
    unref(){worker.unref();},
    nativeOwnerAuthenticated:authenticated,
    begin(label,timeoutMs,options){return begin(label,timeoutMs,false,options);},
    beginOwned(label,timeoutMs,options){return begin(label,timeoutMs,true,options);},
    close(){
      if(closing)return closing;
      assert.equal(steps.size,0,'Cannot retire the watcher with unfinished tool steps');
      closing=(async()=>{
        await ready;
        worker.postMessage({kind:'close'});
        let timer;
        try{
          const code=await Promise.race([
            exited,
            new Promise((_,no)=>{timer=setTimeout(()=>{
              void worker.terminate();no(Error('Deadline watcher retirement exceeded1000ms'));
            },1000)})
          ]);
          assert.equal(code,0,'Deadline watcher failed while retiring');
          if(failure)throw failure;
          closed=true;
        }finally{clearTimeout(timer)}
      })();
      return closing;
    }
  };
}

if(!isMainThread){
  assert.equal(workerData?.kind,'tool-deadline-watch');
  assert(workerData.deadline===null||(Number.isFinite(workerData.deadline)&&workerData.deadline>0),'Invalid independent overall deadline');
  const steps=new Map();
  let timer,closed=false,retirement,responseFuse,publicationFuse;
  let expiring=false,expiredId;
  async function publishNativeTimeout(label){
    const lease=workerData.nativeLease,root=await lstat(lease.runDir);
    assert(root.isDirectory()&&!root.isSymbolicLink()&&root.dev===lease.rootIdentity.dev&&root.ino===lease.rootIdentity.ino,'Native timeout registry identity changed');
    const scope=JSON.parse(await readFile(join(lease.runDir,'scopes',process.pid+'.json'),'utf8'));
    assert(scope.token===lease.token&&scope.scopeToken===lease.scopeToken&&scope.scopeOwner?.pid===lease.owner.pid&&scope.scopeOwner.birth===lease.owner.birth,'Native timeout scope changed');
    const target=join(lease.runDir,'timeout-'+process.pid+'.json');
    try{const old=JSON.parse(await readFile(target,'utf8'));assert(old.token===lease.token&&old.owner?.pid===lease.owner.pid&&old.owner.birth===lease.owner.birth,'Existing timeout evidence has another owner');}catch(error){if(error.code!=='ENOENT')throw error;}
    const next=target+'.watch-'+randomUUID()+'.new';
    await writeFile(next,JSON.stringify({token:lease.token,owner:lease.owner,scopeToken:lease.scopeToken,label,at:Date.now(),independentWatch:true}),{flag:'wx',mode:0o600});
    const final=await lstat(lease.runDir);assert(final.dev===root.dev&&final.ino===root.ino&&!final.isSymbolicLink(),'Native timeout registry changed before publication');
    await rename(next,target);
  }
  function nativeExpire(label){
    const retire=()=>process.kill(process.pid,'SIGKILL');
    // Marker publication itself may not hang behind a saturated filesystem pool.
    const expirationStarted=performance.now();publicationFuse=setTimeout(retire,100);
    void publishNativeTimeout(label).then(()=>{
      clearTimeout(publicationFuse);if(closed)return;
      retirement=setTimeout(retire,Math.max(1,workerData.nativeLease.shutdownMs-(performance.now()-expirationStarted)));
      // The native guardian is the sole TERM sender. Sending another TERM
      // here can trigger default termination after the owner's once-handler.
      // Its bounded poll reads this authenticated marker and reaps the owner.
    },()=>{clearTimeout(publicationFuse);if(!closed)retire();});
  }
  const expire=(label,id,recoverable=false)=>{
    if(expiring)return;expiring=true;expiredId=id;
    const retire=()=>process.kill(process.pid,'SIGKILL');
    if(workerData.nativeLease){
      try{writeFD(2,Buffer.from('[deadline] stuck at '+label+', waiting on tool progress\n'),()=>{});}catch{}
      // A command timeout is recoverable: only an unresponsive caller becomes
      // fatal. The work deadline is unchanged; its response fuse is not work time.
      if(recoverable)responseFuse=setTimeout(()=>nativeExpire(label),250);
      else nativeExpire(label);
      return;
    }
    // Worker stderr normally forwards through the caller's main event loop.
    // Write directly to its inherited OS descriptor instead, with a20ms fuse:
    // a full pipe or blocked filesystem pool cannot prevent self-retirement.
    const fuse=setTimeout(retire,20);
    try{writeFD(2,Buffer.from('[deadline] stuck at '+label+', waiting on tool progress\n'),()=>{
      clearTimeout(fuse);retire();
    })}catch{clearTimeout(fuse);retire()}
  };
  function arm(){
    clearTimeout(timer);
    if(expiring)return;
    let at=workerData.deadline??Infinity,label='overall run',id=null,recoverable=false;
    for(const [stepId,step] of steps)if(step.deadline<at){at=step.deadline;label=step.label;id=stepId;recoverable=step.recoverable}
    if(!Number.isFinite(at))return;
    if(performance.now()>=at){expire(label,id,recoverable);return}
    timer=setTimeout(()=>expire(label,id,recoverable),Math.max(1,at-performance.now()));
  }
  parentPort.on('message',message=>{
    if(closed)return;
    if(message?.kind==='close'){
      assert.equal(steps.size,0,'Watcher still has unfinished steps');
      closed=true;clearTimeout(timer);clearTimeout(responseFuse);clearTimeout(retirement);clearTimeout(publicationFuse);parentPort.close();return;
    }
    assert(Number.isSafeInteger(message?.id)&&message.id>0,'Invalid watcher step identity');
    if(message.kind==='begin'){
      assert(steps.size<128&&!steps.has(message.id),'Duplicate or excessive watcher step');
      stepLabel(message.label);
      assert(Number.isFinite(message.deadline)&&message.deadline>0,'Invalid independent step deadline');
      assert(!message.nativeBudget||workerData.nativeOwnerAuthenticated===true,'Unadmitted native step budget');
      assert(typeof message.recoverable==='boolean'&&(!message.recoverable||workerData.nativeOwnerAuthenticated===true),'Unadmitted recoverable watch');
      steps.set(message.id,{label:message.label,deadline:message.deadline,recoverable:message.recoverable});
    }else{
      assert.equal(message.kind,'end');assert(steps.delete(message.id),'Unknown watcher step');
      if(message.id===expiredId&&responseFuse){clearTimeout(responseFuse);responseFuse=undefined;expiring=false;expiredId=undefined;}
    }
    arm();
  });
  arm();parentPort.postMessage({kind:'ready'});
}
