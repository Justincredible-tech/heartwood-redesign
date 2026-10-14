import {mkdir,writeFile,lstat,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runOwnedArtTransaction} from '../../tools/mobile-art-runtime.mjs';
import {censusArtTree} from '../../tools/mobile-art/lifecycle/art-transaction.mjs';

const [root,mode]=process.argv.slice(2),parent=join(root,'source/mobile'),source=join(parent,'art');
const emit=value=>console.log('@@artFixture '+JSON.stringify(value));
async function job(mode){
 const id=randomUUID(),stage=join(parent,'.art-stage-'+id),backup=join(parent,'.art-backup-'+id);
 return runOwnedArtTransaction({timeoutMs:mode==='timeout'?700:15000,shutdownMs:8000,output:stage,projectRoot:root,sourcePath:source},async runtime=>{
  const ownership=await runtime.ensureOutputDirectory(stage,{reason:'focused owned transaction regression'});await writeFile(join(stage,'art.txt'),'NEW');await writeFile(join(stage,'empty note é.txt'),'');await mkdir(join(stage,'author empty folder'));
  const old=await censusArtTree(source),next=await censusArtTree(stage,{ownership}),info=await lstat(parent);
  const descriptor={schema:1,type:'mobile-art-directory',parent:{path:parent,dev:info.dev,ino:info.ino},sourcePath:source,stagePath:stage,backupPath:backup,old,new:next,sourceInputRows:[{origin:'project',path:'source/mobile/art/art.txt',bytes:3,sha256:old.files.find(r=>r.path==='art.txt').sha256}]};
  const transaction=await runtime.registerArtTransaction(descriptor);
  if(mode==='commit'){
   await runtime.moveArtTransaction(transaction,{phase:'OLD_BACKED_UP'});await runtime.moveArtTransaction(transaction,{phase:'NEW_PROMOTED'});await runtime.updateArtTransaction(transaction,{phase:'COMMITTED'});await runtime.finishArtTransaction(transaction);return 'COMMITTED';
  }
  if(mode==='foreign-backup'){await mkdir(backup);await writeFile(join(backup,'foreign.txt'),'KEEP');const meta=JSON.parse(await readFile(join(process.env.HW_TOOL_RUN_DIR,'run.json'),'utf8'));emit({mode,stage,backup,source,runDir:process.env.HW_TOOL_RUN_DIR,scratch:process.env.TMPDIR,token:meta.token,worker:meta.worker,helper:meta.helper,supervisor:meta.supervisor});await runtime.moveArtTransaction(transaction,{phase:'OLD_BACKED_UP'});throw Error('Foreign backup unexpectedly replaced');}
  if(!['prepared','sequential'].includes(mode))await rename(source,backup);
  if(['new-gap','commit','backup-changed','backup-directory-changed','sequential-commit'].includes(mode)){await runtime.updateArtTransaction(transaction,{phase:'OLD_BACKED_UP'});await rename(stage,source);}
  if(mode==='backup-changed')await writeFile(join(backup,'art.txt'),'AUTHOR EDIT');
  if(mode==='backup-directory-changed')await mkdir(join(backup,'additional author empty directory'));
  if(mode==='sequential-commit'){await runtime.updateArtTransaction(transaction,{phase:'NEW_PROMOTED'});await runtime.updateArtTransaction(transaction,{phase:'COMMITTED'});await runtime.finishArtTransaction(transaction);return 'COMMITTED';}
  if(mode==='sequential')return 'ORIGINAL';
  const meta=JSON.parse(await readFile(join(process.env.HW_TOOL_RUN_DIR,'run.json'),'utf8'));
  emit({mode,stage,backup,source,runDir:process.env.HW_TOOL_RUN_DIR,scratch:process.env.TMPDIR,token:meta.token,worker:meta.worker,helper:meta.helper,supervisor:meta.supervisor});
  if(mode==='error')throw Error('exact deliberate transaction error');
  // A synchronous blocked worker is purposeful: the external guardian, rather
  // than JavaScript finally/timers, must recover the exact rename window.
  if(mode==='timeout')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);
  else await new Promise(resolve=>setTimeout(resolve,60000));
 });
}
if(mode==='sequential'){
 const before=['SIGTERM','SIGINT','SIGHUP','beforeExit'].map(e=>[e,process.listenerCount(e)]),env={...process.env};
 const first=await job('sequential'),second=await job('sequential');
 const after=before.map(([event])=>[event,process.listenerCount(event)]);
 emit({mode,first,second,before,after,envRestored:['HW_TOOL_RUN_TOKEN','HW_TOOL_RUN_DIR','HW_TOOL_SCOPE_TOKEN','TMPDIR','TMP','TEMP'].every(k=>env[k]===process.env[k]),callerSurvived:true});
}else try{const result=await job(mode);emit({mode,result,callerSurvived:true});}catch(e){console.error(e.stack);process.exitCode=1;}
