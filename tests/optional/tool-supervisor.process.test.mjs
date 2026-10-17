// Deliberately stuck OWNED process fixtures are authorized by the reviewed cleanup plan.
// No browser/device/network. Every fixture has a supervisor deadline and exact
// PID-incarnation cleanup; run separately from install-free pure npm tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,mkdirSync as fsMkdir} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {prepareIdentity,inspectProcess,ownedProcesses,signalOwnedProcess,deadline} from '../../tools/tool-runtime.mjs';
import {playwrightCorePath} from '../../tools/browser-deps.mjs';
const ROOT=resolve(import.meta.dirname,'..','..'),ENTRY=join(ROOT,'tools/run-supervised.mjs'),API=pathToFileURL(join(ROOT,'tools/tool-runtime.mjs')).href,helper=prepareIdentity();
const D=mkdtempSync(join(tmpdir(),'supervisor-fixture-'));
const env=()=>({...process.env,HW_BROWSER_SERIAL:'0',HW_TOOL_RUN_TOKEN:'',HW_TOOL_RUN_DIR:'',HW_TOOL_SCOPE_TOKEN:'',HW_TOOL_SUPERVISED:'',HW_TOOL_SERIAL_LEASE:'',TMPDIR:process.env.HW_TOOL_ORIGINAL_TMPDIR||tmpdir()});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=8000){return deadline(label,async signal=>{for(;;){if(signal.aborted)throw signal.reason;const r=fn();if(r)return r;await pause(10);}},{timeoutMs:ms});}
const activeFixtures=new Set();
function trackFixture(child){
 const owner=child.pid?inspectProcess(helper.binary,child.pid):null,ownedToken=randomUUID();
 let stdout='',stderr='',payload,exited=false,exitStatus,exitSignal,spawnError,fixture;
 child.stdout?.on('data',data=>{stdout+=data;for(const line of stdout.split('\n'))if(line.startsWith('@@fixture '))try{payload=JSON.parse(line.slice(10));}catch{}});
 child.stderr?.on('data',data=>{stderr+=data;});
 child.once('error',error=>{spawnError=error;});
 child.once('exit',(status,signal)=>{exited=true;exitStatus=status;exitSignal=signal;});
 const done=new Promise(resolve=>child.once('close',(status,signal)=>{activeFixtures.delete(fixture);resolve({status,signal,stdout,stderr});}));
 fixture={child,owner,ownedToken,done,ready:()=>until(()=>{
   if(payload)return payload;
   if(spawnError||exited)throw Error('fixture exited before ready: status='+exitStatus+' signal='+exitSignal+' error='+(spawnError?.message||'none')+'; stderr:\n'+stderr);
 },'fixture ready')};
 activeFixtures.add(fixture);return fixture;
}
async function disposeFixture(fixture){
 const {child,owner,ownedToken}=fixture;
 const stop=signal=>{if(owner){const current=inspectProcess(helper.binary,owner.pid);if(current?.birth===owner.birth)signalOwnedProcess(helper.binary,{...owner,token:ownedToken,role:'caller-owned'},ownedToken,signal);}};
 stop('SIGTERM');
 try{await deadline('owned fixture exit and pipe cleanup',fixture.done,{timeoutMs:8000});}
 catch(error){stop('SIGKILL');await deadline('owned fixture final pipe cleanup',fixture.done,{timeoutMs:1500});throw error;}
}
test.afterEach(async()=>{await Promise.all([...activeFixtures].map(disposeFixture));});
function start(code,timeoutMs=4000,{serialRoot,queueTimeoutMs=30000}={}){const wrapper=process.env.HW_BROWSER_LOCK_UNDER_TEST;const child=wrapper?spawn('bash',[wrapper,process.execPath,'--input-type=module','-e',code],{env:{...env(),HW_TOOL_TIMEOUT_MS:String(timeoutMs),HW_BROWSER_SERIAL:serialRoot?'1':'0',HW_LOCK_DIR:serialRoot||'/tmp/unused-fixture-lock',HW_LOCK_QUEUE_TIMEOUT_MS:String(queueTimeoutMs)},stdio:['ignore','pipe','pipe']}):spawn(process.execPath,[ENTRY,'--timeout-ms',String(timeoutMs),...(serialRoot?['--serial','--serial-root',serialRoot,'--queue-timeout-ms',String(queueTimeoutMs)]:[]),'--',process.execPath,'--input-type=module','-e',code],{env:env(),stdio:['ignore','pipe','pipe']});return trackFixture(child);}

const preamble=`import {ensureToolRuntime,inspectProcess} from ${JSON.stringify(API)};import fs from 'node:fs';import {spawn} from 'node:child_process';const rt=ensureToolRuntime({name:'owned cleanup fixture',runTimeoutMs:5000,heartbeatMs:60000});await rt.ready;`;
const emit=`console.log('@@fixture '+JSON.stringify({pid:process.pid,birth:inspectProcess(rt.ownerRecord.helper.binary,process.pid).birth,token:rt.runId,scopeToken:rt.scopeToken,runDir:rt.runDir,scratchDir:rt.scratchDir}));`;
// The kernel retains the initial inherited command scope, while runtime scopes are unique descendants.
// Authenticate this exact fixture incarnation in its random native run token, then pass that actual proof.
const record=p=>{const actual=ownedProcesses(helper.binary,p.token).find(row=>row.pid===p.pid&&row.birth===p.birth);assert(actual,'exact fixture native run-token ownership is unavailable');return actual;};
const gone=p=>!inspectProcess(helper.binary,p.pid)&&!existsSync(p.runDir)&&!existsSync(p.scratchDir);
test.after(()=>rmSync(D,{recursive:true,force:true}));

test('native empty token scope is visible and genuinely empty',()=>assert.deepEqual(ownedProcesses(helper.binary,randomUUID(),randomUUID()),[]));
test('normal completion releases registry and opaque scratch; status7 propagates',async()=>{
 const a=start(preamble+emit+'fs.writeFileSync(rt.scratchDir+"/opaque-profile", "fixture");');const p=await a.ready();const r=await a.done;assert.equal(r.status,0,r.stderr);await until(()=>gone(p),'normal registry cleanup');
 const b=start('process.exit(7);');assert.equal((await b.done).status,7);
});
test('default independent runs start together without a queue',async()=>{
 const release=join(D,'release'),aReady=join(D,'a-ready'),bReady=join(D,'b-ready');
 const code=path=>preamble+emit+`fs.writeFileSync(${JSON.stringify(path)},'ready');await new Promise(res=>{const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);res();}},10);});`;
 const a=start(code(aReady)),b=start(code(bReady));const pa=await a.ready(),pb=await b.ready();await until(()=>existsSync(aReady)&&existsSync(bReady),'both parallel workers started');writeFileSync(release,'go');assert.equal((await a.done).status,0);assert.equal((await b.done).status,0);
 await until(()=>gone(pa)&&gone(pb),'parallel registry cleanup');
});
test('blocked tool and detached grandchild are reaped by an independent deadline',async()=>{
 const a=start(preamble+`spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',env:process.env}).unref();`+emit+'while(true){}',600);const p=await a.ready();const r=await a.done;assert.equal(r.status,124,r.stderr);await until(()=>gone(p)&&ownedProcesses(helper.binary,p.token,p.scopeToken).length===0,'blocked descendant cleanup');
});
for(const [signal,status] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]])test(signal+' awaits cleanup:true after abort and leaves no owned process/temp',async()=>{
 const mark=join(D,signal);const a=start(preamble+`rt.onCleanup('fake protocol close',()=>rt.deadline('close callback',async()=>{await new Promise(r=>setTimeout(r,1));fs.writeFileSync(${JSON.stringify(mark)},'closed');},{cleanup:true,timeoutMs:1000}));`+emit+'setInterval(()=>{},1000);');const p=await a.ready();assert(signalOwnedProcess(helper.binary,record(p),p.token,signal));const r=await a.done;assert.equal(r.status,status,r.stderr);assert.equal(readFileSync(mark,'utf8'),'closed');await until(()=>gone(p),'signal registry cleanup');
});
test('subcommand timeout reaps its scope without killing concurrent same-run sibling; binary capture survives',async()=>{
 const code=preamble+`const [a,b]=await Promise.all([rt.runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:200}),rt.runCommand(process.execPath,['-e','setTimeout(()=>process.stdout.write(Buffer.from([0,255,128])),400)'],{timeoutMs:2000,encoding:null})]);console.log('@@fixture '+JSON.stringify({a:{status:a.status,remaining:a.cleanup.remaining.length,scopeToken:a.scopeToken},b:{status:b.status,bytes:[...b.stdout],scopeToken:b.scopeToken}}));process.exitCode=0;`;
 const a=start(code);const p=await a.ready(),r=await a.done;assert.equal(r.status,0,r.stderr);assert.equal(p.a.status,124);assert.equal(p.a.remaining,0);assert.equal(p.b.status,0);assert.deepEqual(p.b.bytes,[0,255,128]);assert.notEqual(p.a.scopeToken,p.b.scopeToken);
});
test('caller death reaps the run and its opaque scratch without an ancestor name allow-list',async()=>{
 const worker=preamble+emit+'setInterval(()=>{},1000);';const parentCode=`const {spawn}=require('node:child_process');spawn(process.execPath,${JSON.stringify([ENTRY,'--timeout-ms','5000','--',process.execPath,'--input-type=module','-e',worker])},{stdio:['ignore','inherit','inherit'],env:process.env});setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['-e',parentCode],{env:env(),stdio:['ignore','pipe','pipe']});trackFixture(parent);let out='',p;parent.stdout.on('data',d=>{out+=d;for(const l of out.split('\n'))if(l.startsWith('@@fixture '))try{p=JSON.parse(l.slice(10));}catch{}});parent.stderr.on('data',()=>{});await until(()=>p,'orphan worker ready');
 const owner=inspectProcess(helper.binary,parent.pid);assert(signalOwnedProcess(helper.binary,{...owner,token:p.token,role:'caller-owned'},p.token,'SIGKILL'));await until(()=>gone(p)&&ownedProcesses(helper.binary,p.token).length===0,'true caller-death cleanup');
});
test('compiler guardian deadline survives original parent death and reaps reserved group',async()=>{
 const pidfile=join(D,'compiler.json'),artifact=join(D,'never-published'),source=join(ROOT,'tools/process-identity.c'),hash=createHash('sha256').update(readFileSync(source)).digest('hex'),nonce=randomUUID();
 const fake=`const fs=require('node:fs'),{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',env:process.env});fs.writeFileSync(${JSON.stringify(pidfile)},JSON.stringify({compiler:process.pid,child:c.pid}));setInterval(()=>{},1000);`;
 const args=[ENTRY,'--compile-identity',source,artifact,hash,nonce,process.execPath,'-e',fake];const parentCode=`require('node:child_process').execFileSync(process.execPath,${JSON.stringify(args)},{detached:true,timeout:10000,env:{...process.env,HW_IDENTITY_GUARD_TOKEN:${JSON.stringify(nonce)}},stdio:'ignore'});`;
 const parent=spawn(process.execPath,['-e',parentCode],{env:env(),stdio:'ignore'});trackFixture(parent);await until(()=>existsSync(pidfile),'compiler fixture started');const p=JSON.parse(readFileSync(pidfile)),owner=inspectProcess(helper.binary,parent.pid),compiler=inspectProcess(helper.binary,p.compiler),grandchild=inspectProcess(helper.binary,p.child);assert(signalOwnedProcess(helper.binary,{...owner,token:nonce,role:'caller-owned'},nonce,'SIGKILL'));
 await until(()=>!inspectProcess(helper.binary,compiler.pid)&&!inspectProcess(helper.binary,grandchild.pid),'compiler independent guardian reap');assert.equal(existsSync(artifact),false);
});
test('installed Playwright TERM handler can leave an idle gate alive; supervisor still bounds it',async()=>{
 const src=(()=>{const coreBundle=playwrightCorePath('lib','coreBundle.js');if(!existsSync(coreBundle))throw Error('UNSUPPORTED: playwright-core lib sources are not available; install the optional dependency (see docs/TESTING.md)');return readFileSync(coreBundle,'utf8');})(),handler=/function sigtermHandler\(\) \{\n[^}]*\}/.exec(src)?.[0];assert(handler,'installed primary handler unavailable');const mark=join(D,'pw-term-observed');
 const code=`import fs from 'node:fs';import {inspectProcess} from ${JSON.stringify(API)};const m=JSON.parse(fs.readFileSync(process.env.HW_TOOL_RUN_DIR+'/run.json'));function gracefullyCloseAll(){fs.writeFileSync(${JSON.stringify(mark)},'close requested');return Promise.resolve();}${handler};process.on('SIGTERM',sigtermHandler);console.log('@@fixture '+JSON.stringify({pid:process.pid,birth:inspectProcess(m.helper.binary,process.pid).birth,token:m.token,scopeToken:process.env.HW_TOOL_SCOPE_TOKEN}));setInterval(()=>{},1000);`;
 const a=start(code,1200),p=await a.ready();assert(signalOwnedProcess(helper.binary,record(p),p.token,'SIGTERM'));await until(()=>existsSync(mark),'actual primary TERM handler executed');assert(inspectProcess(helper.binary,p.pid),'handler requested close but did not exit Node');const r=await a.done;assert.equal(r.status,124,r.stderr);assert.equal(inspectProcess(helper.binary,p.pid),null);
});

test('optional serial scope reuses its authenticated parent lease; unknown ownerless lock wait is bounded',async()=>{
 const root=join(D,'serial'),code=preamble+`const r=await rt.runCommand(process.execPath,[${JSON.stringify(ENTRY)},'--serial','--serial-root',${JSON.stringify(root)},'--queue-timeout-ms','300','--timeout-ms','1500','--',process.execPath,'-e','process.stdout.write("nested ok")'],{timeoutMs:2000});console.log('@@fixture '+JSON.stringify({status:r.status,text:r.stdout,token:rt.runId,runDir:rt.runDir,scratchDir:rt.scratchDir,pid:process.pid}));`;
 const a=start(code,4000,{serialRoot:root}),p=await a.ready(),r=await a.done;assert.equal(r.status,0,r.stderr);assert.equal(p.status,0);assert.equal(p.text,'nested ok');await until(()=>!existsSync(p.runDir)&&!existsSync(p.scratchDir),'serial registry cleanup');assert.equal(existsSync(root+'.lock'),false);assert.equal(existsSync(root+'.queue'),false,'no coordinator directory is created');
 const unknown=join(D,'unknown-lock');fsMkdir(unknown+'.lock');const b=start('process.exit(0)',1000,{serialRoot:unknown,queueTimeoutMs:120}),br=await b.done;assert.equal(br.status,124,br.stderr);assert(existsSync(unknown+'.lock'),'ownerless directory is never taken over');assert.equal(existsSync(unknown+'.queue'),false);
 const stale=join(D,'stale-lock'),birth=inspectProcess(helper.binary,process.pid).birth;writeFileSync(stale+'.lock',JSON.stringify({schema:1,kind:'serial-file',token:randomUUID(),resourceId:randomUUID(),owner:{pid:process.pid,birth:'expired-incarnation:'+birth}}));
 const c=start('process.exit(0)',1500,{serialRoot:stale,queueTimeoutMs:500}),cr=await c.done;assert.equal(cr.status,0,cr.stderr);assert.equal(existsSync(stale+'.lock'),false);assert.equal(existsSync(stale+'.queue'),false);
});

test('a hung shutdown callback uses the shared deadline and cannot start a second full cleanup budget',async()=>{
 const code=preamble.replace('heartbeatMs:60000','heartbeatMs:60000,shutdownMs:1200')+`rt.onCleanup('deliberately hung owned close',()=>new Promise(()=>{}));`+emit+'setInterval(()=>{},1000);';
 const a=start(code,5000),p=await a.ready(),at=Date.now();assert(signalOwnedProcess(helper.binary,record(p),p.token,'SIGTERM'));const r=await a.done;assert.equal(r.status,143,r.stderr);assert.match(r.stderr,/deliberately hung owned close/);
 await until(()=>gone(p)&&ownedProcesses(helper.binary,p.token,p.scopeToken).length===0,'bounded hung callback cleanup');assert(Date.now()-at<5000,'signal cleanup exceeded focused owned fixture ceiling');
});

test('an already aborted command starts no process; explicit cleanup command survives overall abort',async()=>{
 const mark=join(D,'must-never-start');const code=preamble+`const c=new AbortController();c.abort(Error('cancelled before spawn'));let rejected=false;try{await rt.runCommand(process.execPath,['-e',${JSON.stringify('require("node:fs").writeFileSync('+JSON.stringify(mark)+',"bad")')}],{signal:c.signal,timeoutMs:500});}catch(e){rejected=/cancelled before spawn/.test(e.message);}rt.onCleanup('explicit cleanup command',async()=>{const r=await rt.runCommand(process.execPath,['-e','process.stdout.write("cleanup ok")'],{cleanup:true,timeoutMs:500});if(r.status!==0||r.stdout!=='cleanup ok')throw Error('cleanup command failed');});console.log('@@fixture '+JSON.stringify({rejected,pid:process.pid,token:rt.runId,runDir:rt.runDir,scratchDir:rt.scratchDir}));`;
 const a=start(code),p=await a.ready(),r=await a.done;assert.equal(r.status,0,r.stderr);assert.equal(p.rejected,true);assert.equal(existsSync(mark),false);await until(()=>gone(p),'cancelled acquisition cleanup');
});

test('fast exited commands retain complete text and binary pipes before registration returns',async()=>{
 const code=preamble+`const samples=[];for(const [command,args,encoding] of [['/bin/echo',['fast stdout'],undefined],['/usr/bin/printf',['abc'],null],[process.execPath,['-e','process.stdout.write(Buffer.alloc(262144,90));process.stderr.write("done")'],null]]){const r=await rt.runCommand(command,args,{timeoutMs:2000,encoding});samples.push({status:r.status,stdout:encoding===null?[r.stdout.length,r.stdout[0],r.stdout.at(-1)]:r.stdout,stderr:encoding===null?r.stderr.toString():r.stderr,bytes:r.outputBytes,remaining:r.cleanup.remaining.length,error:r.error});}console.log('@@fixture '+JSON.stringify({samples}));`;
 const a=start(code,7000),p=await a.ready(),r=await a.done;assert.equal(r.status,0,r.stderr);assert.deepEqual(p.samples,[{status:0,stdout:'fast stdout\n',stderr:'',bytes:12,remaining:0,error:null},{status:0,stdout:[3,97,99],stderr:'',bytes:3,remaining:0,error:null},{status:0,stdout:[262144,90,90],stderr:'done',bytes:262148,remaining:0,error:null}]);
});

test('runtime scopes isolate sibling workers born with one inherited command environment',async()=>{
 const aReady=join(D,'sibling-a.json'),bReady=join(D,'sibling-b.json'),aStop=join(D,'sibling-a.stop'),bStop=join(D,'sibling-b.stop'),aDone=join(D,'sibling-a.done');
 const sibling=(ready,stop)=>`import {ensureToolRuntime,inspectProcess} from ${JSON.stringify(API)};import fs from 'node:fs';const rt=ensureToolRuntime({name:'sibling runtime',runTimeoutMs:4000,heartbeatMs:60000});await rt.ready;fs.writeFileSync(rt.scratchDir+'/sentinel','owned');fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,birth:inspectProcess(rt.ownerRecord.helper.binary,process.pid).birth,scopeToken:rt.scopeToken,scratch:rt.scratchDir}));await new Promise(res=>{const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)})){clearInterval(timer);res();}},10);});`;
 const code=preamble+`const a=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(sibling(aReady,aStop))}],{env:process.env,stdio:'inherit'}),b=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(sibling(bReady,bStop))}],{env:process.env,stdio:'inherit'});const aExit=new Promise(r=>a.once('close',(status,signal)=>r({status,signal}))),bExit=new Promise(r=>b.once('close',(status,signal)=>r({status,signal})));`+emit+`fs.writeFileSync(${JSON.stringify(aDone)},JSON.stringify(await aExit));await bExit;`;
 const main=start(code,7000),parent=await main.ready();let a,b,kept;try{await until(()=>existsSync(aReady)&&existsSync(bReady),'both inherited siblings ready');a=JSON.parse(readFileSync(aReady));b=JSON.parse(readFileSync(bReady));writeFileSync(aStop,'stop');await until(()=>existsSync(aDone),'first sibling complete');await pause(550);kept=!!inspectProcess(helper.binary,b.pid)&&existsSync(b.scratch+'/sentinel');}finally{writeFileSync(aStop,'stop');writeFileSync(bStop,'stop');}
 const result=await main.done;assert.equal(result.status,0,result.stderr);assert.equal(kept,true,'ending one inherited sibling must retain the other incarnation and owned temp');assert.notEqual(a.scopeToken,b.scopeToken);assert.equal(JSON.parse(readFileSync(aDone)).status,0);await until(()=>gone(parent)&&!existsSync(a.scratch)&&!existsSync(b.scratch),'sibling runtimes release their own resources');
});

test('failed inherited command releases registered scratch before runCommand returns',async()=>{
 const child=`import {ensureToolRuntime} from ${JSON.stringify(API)};const rt=ensureToolRuntime({name:'throw after temp acquisition',runTimeoutMs:3000});await rt.ready;const fs=await import('node:fs');fs.writeFileSync(rt.scratchDir+'/sentinel','owned');console.log(JSON.stringify({scratch:rt.scratchDir}));throw Error('intentional owned failure');`;
 const code=preamble+`const r=await rt.runCommand(process.execPath,['--input-type=module','-e',${JSON.stringify(child)}],{timeoutMs:3000});const info=JSON.parse(r.stdout.trim());console.log('@@fixture '+JSON.stringify({status:r.status,scratchExists:fs.existsSync(info.scratch),cleanup:r.cleanup}));`;
 const a=start(code,7000),p=await a.ready(),result=await a.done;assert.equal(result.status,0,result.stderr);assert.equal(p.status,1);assert.equal(p.scratchExists,false,'the exceptional command must drain its registered temps before returning');assert.deepEqual(p.cleanup.errors,[]);assert.deepEqual(p.cleanup.remaining,[]);
});

test('an unsupported child cleanup resource cannot retain a zero command status',async()=>{
 const child=`import {ensureToolRuntime} from ${JSON.stringify(API)};const rt=ensureToolRuntime({name:'owned unsupported cleanup fixture',runTimeoutMs:3000});await rt.ready;rt.registerResource('focused-unsupported-fixture',{target:'no external resource exists'});`;
 const code=preamble+`const r=await rt.runCommand(process.execPath,['--input-type=module','-e',${JSON.stringify(child)}],{timeoutMs:3000});console.log('@@fixture '+JSON.stringify({status:r.status,errors:r.cleanup.errors,unsupported:r.cleanup.resourceCleanup.unsupported.map(x=>x.kind)}));`;
 const a=start(code,7000),p=await a.ready();await a.done;assert.notEqual(p.status,0);assert(p.errors.some(message=>message.includes('unsupported owned resource')));assert.deepEqual(p.unsupported,['focused-unsupported-fixture']);
});

test('an inherited child keeps its shorter whole-run deadline inside a longer command',async()=>{
 const child=`import {ensureToolRuntime} from ${JSON.stringify(API)};const rt=ensureToolRuntime({name:'short inherited deadline fixture',runTimeoutMs:150,heartbeatMs:60000});await rt.ready;while(true){}`;
 const code=preamble+`const r=await rt.runCommand(process.execPath,['--input-type=module','-e',${JSON.stringify(child)}],{timeoutMs:2000});console.log('@@fixture '+JSON.stringify({status:r.status,durationMs:r.durationMs,cleanup:r.cleanup}));process.exitCode=0;`;
 const a=start(code,7000),p=await a.ready(),r=await a.done;assert.equal(r.status,0,r.stderr);assert.equal(p.status,124);assert(p.durationMs<1500,'short inherited deadline was suppressed until the outer command deadline');assert.deepEqual(p.cleanup.remaining,[]);assert.deepEqual(p.cleanup.errors,[]);
});


test("completed child scopes are retired before stale deadlines; normal failure says last step",async()=>{
 const child=`import {ensureToolRuntime} from ${JSON.stringify(API)};const rt=ensureToolRuntime({name:"short completed child",runTimeoutMs:200,shutdownMs:1000});await rt.ready;console.log(JSON.stringify({pid:process.pid,scope:rt.scopeToken}));`;
 const code=preamble+`const result=await rt.runCommand(process.execPath,["--input-type=module","-e",${JSON.stringify(child)}],{timeoutMs:2000});const child=JSON.parse(result.stdout.trim());await new Promise(r=>setTimeout(r,650));const scope=JSON.parse(fs.readFileSync(rt.runDir+"/scopes/"+child.pid+".json"));console.log("@@fixture "+JSON.stringify({status:result.status,retired:scope.retired,closed:scope.commandCleanupClosed,lateTimeout:fs.existsSync(rt.runDir+"/timeout-"+child.pid+".json")}));`;
 const a=start(code),p=await a.ready(),result=await a.done;assert.equal(result.status,0,result.stderr);assert.equal(p.status,0);assert.equal(p.retired,true);assert.equal(p.closed,true);assert.equal(p.lateTimeout,false);
 const b=start(preamble+emit+"process.exitCode=1;"),bp=await b.ready(),failed=await b.done;assert.equal(failed.status,1);await until(()=>gone(bp),"normal failure registry cleanup");assert.match(failed.stderr,/last step/);assert.doesNotMatch(failed.stderr,/stuck at/);
});


test('an inherited managed STEP records native timeout before caller classification',async()=>{
 const child=`import {ensureToolRuntime} from ${JSON.stringify(API)};const rt=ensureToolRuntime({name:'inherited managed step fixture',runTimeoutMs:3000,heartbeatMs:60000});await rt.ready;await rt.deadline('owned blocked inherited step',()=>{const until=performance.now()+1200;while(performance.now()<until){};return 'must not pass';},{timeoutMs:80});`;
 const code=preamble+`const r=await rt.runCommand(process.execPath,['--input-type=module','-e',${JSON.stringify(child)}],{timeoutMs:2000});console.log('@@fixture '+JSON.stringify({status:r.status,durationMs:r.durationMs,cleanup:r.cleanup}));process.exitCode=0;`;
 const a=start(code,7000),p=await a.ready(),r=await a.done;assert.equal(r.status,0,r.stderr);assert.equal(p.status,124);assert(p.durationMs<1500,'managed step waited for the longer command/whole-run deadline');assert.deepEqual(p.cleanup.remaining,[]);assert.deepEqual(p.cleanup.errors,[]);
});


test('fixture readiness rejects genuine startup exit with captured stderr',async()=>{
 const fixture=start('process.stderr.write("intentional fixture startup failure\\n");process.exit(7);');
 await assert.rejects(fixture.ready(),/status=7[\s\S]*intentional fixture startup failure/);assert.equal((await fixture.done).status,7);
});

test('fixture error cleanup releases exact native caller, guardian and scratch',async()=>{
 const fixture=start(preamble+emit+'setInterval(()=>{},1000);'),proof=await fixture.ready();
 await disposeFixture(fixture);await until(()=>gone(proof)&&ownedProcesses(helper.binary,proof.token).length===0,'fixture error exact cleanup');
});


test('a synchronous managed step cannot win after its absolute deadline',async()=>{
 const child=`import {ensureToolRuntime} from ${JSON.stringify(API)};const rt=ensureToolRuntime({name:'short synchronous deadline fixture',runTimeoutMs:3000,heartbeatMs:60000});await rt.ready;await rt.deadline('short synchronous overrun',()=>{const until=performance.now()+70;while(performance.now()<until){};return 'must not pass';},{timeoutMs:40});`;
 const code=preamble+`const r=await rt.runCommand(process.execPath,['--input-type=module','-e',${JSON.stringify(child)}],{timeoutMs:2000});console.log('@@fixture '+JSON.stringify({status:r.status,cleanup:r.cleanup}));process.exitCode=0;`;
 const a=start(code,7000),p=await a.ready(),r=await a.done;assert.equal(r.status,0,r.stderr);assert.equal(p.status,124);assert.deepEqual(p.cleanup.remaining,[]);assert.deepEqual(p.cleanup.errors,[]);
});
