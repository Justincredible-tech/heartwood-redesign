import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {lstat} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {ensureToolRuntime,inspectProcess} from '../../tools/tool-runtime.mjs';
import {beginTimingRun} from '../../tools/timing-environment.mjs';
test('Mac timing owns only its idle assertion, records a real independent peer and releases everything',async()=>{
 assert.equal(process.platform,'darwin','this explicit Mac lifecycle proof is unsupported elsewhere, never a skipped PASS');
 const runtime=ensureToolRuntime({name:'owned Mac timing lifecycle fixture',runTimeoutMs:30000});await runtime.ready;
 let timing,peer,peerReady,concurrentObservation;
 try{
  timing=await beginTimingRun(runtime);assert.equal(timing.sleepPrevention.status,'HELD');assert.equal(timing.sleepPrevention.displayAssertion,false);assert.deepEqual(timing.sleepPrevention.args,['-i','-w',String(process.pid)]);
  const record=inspectProcess(runtime.ownerRecord.helper.binary,timing.sleepPrevention.pid);assert.equal(record.birth,timing.sleepPrevention.birth);
  peer=await runtime.spawn(process.execPath,[resolve(import.meta.dirname,'..','fixtures/timing-peer.mjs')],{stdio:['pipe','pipe','pipe'],label:'short independent timing peer'});
  peerReady=await runtime.deadline('exact independent timing peer ready',()=>new Promise((resolve,reject)=>{let output='';peer.stdout.on('data',chunk=>{output+=chunk;for(const line of output.split('\n'))if(line.startsWith('@@timing-peer '))resolve(JSON.parse(line.slice(14)));});peer.once('exit',code=>reject(Error('peer exited before ready: '+code)));}),{timeoutMs:5000});
  const observed=concurrentObservation=await timing.snapshot();assert(observed.activeTokens.some(row=>row.token===peerReady.token&&row.worker?.pid===peerReady.pid),'actual authenticated peer token/PID must be recorded');assert.equal(observed.contention,observed.issues.length?'UNKNOWN':'SUPERVISED_PEERS_OBSERVED');assert.equal(observed.timingIsolation,'NOT_ESTABLISHED');assert.equal(observed.physicalPresentation,false);
  peer.stdin.end();const ended=await runtime.deadline('independent peer exit',()=>peer.toolClosed,{timeoutMs:3000});assert.equal(ended.code,0);
  await runtime.deadline('independent peer registry cleanup',async signal=>{while(true){try{await lstat(peerReady.runDir);}catch(error){if(error.code==='ENOENT')return;throw error;}await pause(10,undefined,{signal});}},{timeoutMs:3000});
  await timing.release();assert.equal(timing.sleepPrevention.status,'RELEASED');assert.equal(inspectProcess(runtime.ownerRecord.helper.binary,timing.sleepPrevention.pid),null);
 }finally{
  peer?.stdin?.end();if(timing)await timing.release();const cleanup=await runtime.shutdown('Mac timing lifecycle fixture complete');assert.deepEqual(cleanup.errors,[]);
  console.log('@@timing-owner '+JSON.stringify({token:runtime.runId,runDir:runtime.runDir,scratchDir:runtime.scratchDir,helper:runtime.ownerRecord.helper.binary,assertion:timing?.sleepPrevention,environmentStart:timing?.environment,concurrentObservation,peer:peerReady}));
 }
});
