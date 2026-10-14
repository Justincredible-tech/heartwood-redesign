// Read-only inventory of authenticated supervised registries; cleanup needs one exact dead registry.
import {lstat,readdir,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {parseToolArgs,showToolHelp} from './tool-cli.mjs';
import {inspectProcess,ownedProcesses,ensureToolRuntime,deadline} from './tool-runtime.mjs';
import {tmpdir} from 'node:os';
import {assessOrphanRecovery} from './recovery-proof.mjs';
import {readRegularInput} from "./tool-operations.mjs";
let lastReadStep="validate exact registry metadata";
async function readBoundedRegular(path,encoding=null,until=Date.now()+2000){
 const remaining=until-Date.now();if(remaining<=0)throw Error("registry inventory deadline expired; no recovery attempted");lastReadStep="read regular input "+path;
 // This facade owns only the descriptor closures; it never compiles, starts a
 // managed runtime, writes a lease, or signals another process.
 const closures=new Set(),reader={ready:Promise.resolve(),deadline:(label,operation,options)=>deadline(label,operation,options),onCleanup(_label,close){closures.add(close);return ()=>closures.delete(close);}};
 try{return await readRegularInput(path,{runtime:reader,encoding,timeoutMs:Math.min(2000,remaining)});}
 finally{for(const close of closures)await deadline("close read-only registry input",()=>close(),{timeoutMs:200});}
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ORIGINAL_TEMP_ROOT=process.env.HW_TOOL_ORIGINAL_TMPDIR||tmpdir();
export async function stableRegistryRoots(){return [...new Set(await Promise.all(['/tmp',ORIGINAL_TEMP_ROOT].map(path=>realpath(path))))];}
const validIdentity=r=>Number.isInteger(r?.pid)&&r.pid>1&&typeof r.birth==='string'&&r.birth.length>0;
export async function inspectRegistry(requested,{parents,until=Date.now()+8000}={}){
 parents??=await stableRegistryRoots();
 const assertBudget=()=>{if(Date.now()>=until)throw Error('registry inventory deadline expired; no recovery attempted');};assertBudget();
 const original=await lstat(requested);if(original.isSymbolicLink()||!original.isDirectory())throw Error('run registry must be a real directory');const dir=await realpath(requested);
 if(!parents.includes(dirname(dir))||!/^heartwood-run-[^/]+$/.test(basename(dir)))throw Error('expected an exact supervised registry in a stable tool temp root');
 const meta=JSON.parse(await readBoundedRegular(join(dir,'run.json'),'utf8',until));
 if(meta.schema!==1||typeof meta.token!=='string'||!meta.token||original.dev!==meta.rootIdentity?.dev||original.ino!==meta.rootIdentity?.ino||!validIdentity(meta.worker)||!validIdentity(meta.supervisor))throw Error('run registry identity is unsupported or changed');
 // Reuse only an already published, byte-authenticated helper. Inventory never compiles or starts a runtime.
 const helper=meta.helper;if(typeof helper?.binary!=='string'||!helper.binarySha256||!helper.sourceSha256)throw Error('stored native helper provenance is unsupported');
 const manifest=JSON.parse(await readBoundedRegular(join(dirname(helper.binary),'manifest.json'),'utf8',until));
 const sourceSha=hash(await readBoundedRegular(resolve(import.meta.dirname,'process-identity.c'),null,until));
 if(helper.sourceSha256!==sourceSha||manifest.sourceSha256!==sourceSha||manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.binarySha256!==helper.binarySha256||hash(await readBoundedRegular(helper.binary,null,until))!==helper.binarySha256)throw Error('stored native identity helper provenance changed or is unsupported');
 assertBudget();const worker=inspectProcess(helper.binary,meta.worker.pid);assertBudget();const supervisor=inspectProcess(helper.binary,meta.supervisor.pid);assertBudget();const owned=ownedProcesses(helper.binary,meta.token);
 const final=await lstat(dir),now=JSON.parse(await readBoundedRegular(join(dir,'run.json'),'utf8',until));
 if(final.isSymbolicLink()||final.dev!==original.dev||final.ino!==original.ino||now.token!==meta.token||now.worker?.birth!==meta.worker.birth||now.supervisor?.birth!==meta.supervisor.birth)throw Error('run registry changed during inventory');
 const workerLive=worker?.birth===meta.worker.birth,supervisorLive=supervisor?.birth===meta.supervisor.birth;
 return {dir,owner:meta.name,runId:meta.token,state:workerLive||supervisorLive?'live':'orphan',workerLive,supervisorLive,preserved:true,owned,registryIdentity:{dev:final.dev,ino:final.ino},meta};
}
export async function inventoryOwnedRuns(){
 const roots=await stableRegistryRoots(),until=Date.now()+8000,runs=[],unsupported=[];
 for(const root of roots)for(const name of (await readdir(root)).filter(n=>/^heartwood-run-[^/]+$/.test(n)).sort()){
  const path=join(root,name);try{const {meta,...row}=await inspectRegistry(path,{parents:roots,until});runs.push(row);}catch(error){if(error.code==='ENOENT')unsupported.push({path,state:'disappeared',reason:'registry ended during read-only inventory'});else unsupported.push({path,state:'unsupported',reason:error.message,preserved:true});}
 }
 return {mode:'dry-run-inventory',scope:'Supervised heartwood-run registries in stable tool temp roots; no process-name or workspace guess',roots,runs,unsupported,cleanupPerformed:false};
}
export async function main(args=process.argv.slice(2)){
 const parsed=parseToolArgs({args,booleans:['kill','dry-run'],minPositionals:0,maxPositionals:1});
 if(showToolHelp(parsed,'Usage: node tools/reap-owned.mjs [--dry-run] [EXACT_REGISTRY] | --kill EXACT_REGISTRY\nNo arguments: read-only authenticated registry inventory. Live owners and unsupported legacy directories are preserved. --kill requires one exact dead supervised registry.'))return 0;
 if(parsed.values.kill&&parsed.values['dry-run'])throw Error('--kill and --dry-run conflict');
 if(parsed.values.kill&&!parsed.positionals.length)throw Error('--kill requires one exact dead registry; broad cleanup is never inferred');
 const watchdog=setTimeout(()=>{console.error("stuck at standalone reaper; waiting on "+lastReadStep);process.exit(124);},parsed.values.kill?35000:10000);
 try{
 if(!parsed.positionals.length){console.log(JSON.stringify(await inventoryOwnedRuns(),null,2));return 0;}
 const row=await inspectRegistry(resolve(parsed.positionals[0])),{meta,...display}=row;
 if(row.state==='live'&&parsed.values.kill)throw Error('run still has a live supervisor or worker; its owner must stop it');
 console.log(JSON.stringify({...display,mode:parsed.values.kill?'cleanup':'dry-run',cleanupPerformed:false},null,2));if(!parsed.values.kill)return 0;
 const recoveryStarted=Date.now(),rt=ensureToolRuntime({name:'reap-owned',runTimeoutMs:15000});await rt.ready;
 try{
  const current=await inspectRegistry(row.dir);if(current.runId!==row.runId||current.state!=='orphan'||current.registryIdentity.dev!==row.registryIdentity.dev||current.registryIdentity.ino!==row.registryIdentity.ino)throw Error('exact orphan registry changed before recovery');
  const result=await rt.runCommand(process.execPath,[resolve(import.meta.dirname,'run-supervised.mjs'),'--recover',row.dir],{timeoutMs:10000,label:'recover orphaned exact run registry',stdio:'inherit'});
  const report=JSON.parse(await readBoundedRegular(resolve(import.meta.dirname,'../output/review-tooling/cleanup/run-reports',meta.token+'.json'),'utf8'));
  const records=await Promise.all((await readdir(join(rt.runDir,'resources'))).map(async name=>JSON.parse(await readBoundedRegular(join(rt.runDir,'resources',name),'utf8'))));
  const child=records.find(x=>x.kind==='process'&&x.pid===result.pid&&x.scopeToken===result.scopeToken);let registryRemoved=false;try{await lstat(row.dir);}catch(error){if(error.code==='ENOENT')registryRemoved=true;else throw error;}
  const {fresh,clean}=assessOrphanRecovery({meta,result,report,child,registryRemoved,startedAt:recoveryStarted});
  if(!clean){console.error('Orphan recovery is unverified or incomplete: '+JSON.stringify({fresh,registryRemoved,childStatus:result.status,reportStatus:report.status}));return result.status||1;}
  console.log('Recovered exact orphan registry; original job status '+report.status+' is retained in its fresh cleanup report.');return 0;
 }finally{await rt.shutdown('orphan recovery complete');}
 }finally{clearTimeout(watchdog);}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))main().then(status=>{process.exitCode=status;}).catch(error=>{console.error(error.stack||error.message);process.exitCode=125;});
