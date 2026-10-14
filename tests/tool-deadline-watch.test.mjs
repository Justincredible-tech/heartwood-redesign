import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {deadlineBudget,createDeadlineWatch} from '../tools/testing/deadline-watch.mjs';

function run(mode,{drainStderr=true}={}){
  return new Promise((yes,no)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/deadline-watch-worker.mjs',import.meta.url)),mode],
      {stdio:['ignore','pipe','pipe'],windowsHide:true});
    const started=performance.now();let text='',count=0,expired=false,armedAt;
    const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL')},5000);
    for(const stream of [child.stdout,...(drainStderr?[child.stderr]:[])])stream.on('data',bytes=>{
      count+=bytes.length;if(count>16384){expired=true;child.kill('SIGKILL');return}text+=bytes;if(text.includes('FULL_PIPE_ARMED')&&armedAt===undefined)armedAt=performance.now();
    });
    child.once('error',error=>{clearTimeout(timer);no(error)});
    child.once('close',(code,signal)=>{
      clearTimeout(timer);
      if(expired){no(Error('Deadline fixture exceeded its independent outer bound'));return}
      yes({code,signal,text,durationMs:performance.now()-started,afterArmedMs:armedAt===undefined?null:performance.now()-armedAt});
    });
  });
}
test('invalid timer budgets are refused before a watcher is allocated',()=>{
  for(const value of [0,-1,NaN,Infinity,1.5,'100',undefined,3600001])assert.throws(()=>deadlineBudget(value));
  assert.equal(deadlineBudget(1),1);assert.equal(deadlineBudget(3600000),3600000);
});
test('completed steps and repeated retirement leave no worker keeping the process alive',async()=>{
  const result=await run('complete');assert.equal(result.code,0);assert.equal(result.signal,null);
  assert.match(result.text,/COMPLETE/);assert(result.durationMs<5000);
});
for(const [mode,label]of [['blocked','blocked main loop'],['pending','unsettled callback'],['overall','overall run'],['nested','inner step']]){
  test('independent deadline retires '+mode+' work',async()=>{
    const result=await run(mode);
    assert(result.code!==0||result.signal,'A blocked/empty run must never pass');
    assert.match(result.text,new RegExp('stuck at '+label));
    assert(result.durationMs<5000);
  });
}

test('a full diagnostic pipe cannot prevent independent retirement',async()=>{
  const result=await run('full-stderr',{drainStderr:false});
  assert.match(result.text,/FULL_PIPE_ARMED/,'The full-pipe step must really begin');
  if(process.platform==='win32')assert.equal(result.code,1,'Only self-SIGKILL is expected; fixture/owner errors have distinct codes');
  else assert.equal(result.signal,'SIGKILL','A fixture exception must not masquerade as a watchdog timeout');
  assert(result.afterArmedMs>=80&&result.afterArmedMs<1500,'The120ms step timer, not the2000ms overall or outer timer, must retire it');
});


test('step-only cannot start without authenticated independent native owner',()=>{
  assert.throws(()=>createDeadlineWatch({timeoutMs:null}),/native|owner|authenticated/i);
  assert.throws(()=>createDeadlineWatch({timeoutMs:null,nativeOwner:{token:'forged'}}),/native|owner|authenticated/i);
  assert.throws(()=>deadlineBudget(3600001));assert.equal(deadlineBudget(3600000),3600000);
});
test('idle watcher can unref; unfinished steps can ref and must close only after end',async()=>{
  const watch=createDeadlineWatch({timeoutMs:2000});await watch.ready;
  try{assert.equal(typeof watch.ref,'function');assert.equal(typeof watch.unref,'function');watch.unref();
    assert.throws(()=>watch.beginOwned('unauthenticated large step',3600001),/authenticated/);
    assert.throws(()=>watch.begin('unauthenticated recovery',1000,{recoverable:true}),/authenticated/,'Recovery grace must not become an unauthenticated watcher bypass');
    const end=watch.begin('owned finite test step',1000);watch.ref();assert.throws(()=>watch.close(),/unfinished/);end();watch.unref();
  }finally{await watch.close();}
});
