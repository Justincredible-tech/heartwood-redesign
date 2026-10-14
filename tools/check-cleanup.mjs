import {isToolMain} from './tool-cli.mjs';
/** Static resource lint plus an ownership-aware, bounded live cleanup audit. */
import {spawnSync} from 'node:child_process';
import {constants as fsConstants} from 'node:fs';
import {readFile,readdir,opendir,writeFile,mkdir,stat,lstat,realpath,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {collectCapabilityFacts,assessCatalogGate} from './tool-capability-facts.mjs';
const ROOT=resolve(import.meta.dirname,'..');
const ORIGINAL_TEMP_ROOT=process.env.HW_TOOL_ORIGINAL_TMPDIR||tmpdir();
const digest=s=>createHash('sha256').update(s).digest('hex');
// Lint is a conservative review aid, not a proof of path coverage. Exceptions pin the current source hash and name evidence.
function maskCommentsAndStrings(source){
 let result='',state='code',quote='',escaped=false,characterClass=false;
 for(let i=0;i<source.length;i++){const c=source[i],next=source[i+1];
  if(state==='line'){if(c==='\n'){state='code';result+='\n';}else result+=' ';continue;}
  if(state==='block'){if(c==='*'&&next==='/'){result+='  ';i++;state='code';}else result+=c==='\n'?'\n':' ';continue;}
  if(state==='regex'){result+=c==='\n'?'\n':' ';if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='[')characterClass=true;if(c===']')characterClass=false;if(c==='/'&&!characterClass)state='code';continue;}
  if(state==='string'){result+=c==='\n'?'\n':' ';if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c===quote)state='code';continue;}
  if(c==='/'&&next==='/'){state='line';result+='  ';i++;continue;}if(c==='/'&&next==='*'){state='block';result+='  ';i++;continue;}
  if(c==='/'&&(/[=(:,!;{\[?&|]\s*$/.test(result)||/\b(?:return|throw|case)\s*$/.test(result))){state='regex';characterClass=false;result+=' ';continue;}
  if(c==='"'||c==="'"||c==='\x60'){state='string';quote=c;result+=' ';continue;}if(c==='#'&&(i===0||source.slice(0,i).match(/\n\s*$/))){state='line';result+=' ';continue;}result+=c;
 }
 return result;
}
export function scanSource(path,source){
 const imports=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]node:child_process['"]/g)].flatMap(m=>m[1].split(',').map(n=>n.trim().split(/\s+as\s+/)));
 const aliases=names=>names.concat(imports.filter(([n])=>names.includes(n)).map(a=>a[1]||a[0])).join('|');
 const rules=[['sync-process',new RegExp('(?<![\\w.])(?:'+aliases(['spawnSync','execFileSync','execSync'])+')\\s*\\(','g')],['async-process',new RegExp('(?<![\\w.])(?:'+aliases(['spawn','execFile','exec'])+')\\s*\\(','g')],['browser',/\.(?:launch|launchServer|connectOverCDP)\s*\(/g],['listener',/\b(?:createServer|listen)\s*\(/g],['interval',/\bsetInterval\s*\(/g],['temp',/\bmkdtemp(?:Sync)?\s*\(/g],['fetch',/\bfetch\s*\(/g],['python-process',/\bsubprocess\.(?:run|Popen|check_output|check_call|call)\s*\(/g]];
 const rows=[];const masked=maskCommentsAndStrings(source);
 for(const [kind,pattern] of rules)for(const match of masked.matchAll(pattern)){
  const line=source.slice(0,match.index).split('\n').length,text=source.split('\n')[line-1].trim();
  rows.push({path,kind,line,text,fingerprint:digest(kind+'\n'+text)});
 }
 if(/\.(?:sh|ps1)$/.test(path))for(const [i,line] of source.split('\n').entries())if(!line.trim().startsWith('#')&&/(?:\bnohup\b|\bdisown\b|\bpgrep\b|\s&\s*(?:$|[;#]))/.test(line))rows.push({path,kind:'shell-detach-or-name-gate',line:i+1,text:line.trim(),fingerprint:digest('shell\n'+line.trim())});
 return rows;
}
export function assessStatic(rows,policy={}){
 return rows.map(row=>{const waiver=(policy.reviewedResources||[]).find(w=>w.path===row.path&&w.fingerprint===row.fingerprint&&w.sourceSha256===row.sourceSha256&&w.reason&&w.evidence);
  return {...row,status:waiver?'reviewed':'unreviewed',reason:waiver?.reason,evidence:waiver?.evidence};});
}
export function assessFileInventory(files,policy={}, {evidenceExists=()=>false}={}){
 return files.map(file=>{
  const review=(policy.reviewedFiles||[]).find(r=>r.path===file.path&&r.sourceSha256===file.sourceSha256&&r.role&&r.reason&&r.evidence&&evidenceExists(r.evidence));
  let failureKind=review?null:'unreviewed-file',failureReason=review?null:'Current source hash, role or concrete evidence is unreviewed';
  const maintainedShell=file.path.endsWith('.sh')&&review?.role.startsWith('maintained-');
  if(review&&((review.requiredExecutable!==undefined&&typeof review.requiredExecutable!=='boolean')||(maintainedShell&&review.requiredExecutable!==true))){failureKind='invalid-execution-policy';failureReason='Maintained direct shell CLIs require requiredExecutable:true; this field accepts only booleans';}
  else if(review?.requiredExecutable===true&&(!Number.isSafeInteger(file.mode)||file.mode<0||file.mode>0o7777||!(file.mode&0o100)||file.executable!==true)){failureKind='non-executable-cli';failureReason='Direct CLI requires owner execute bit and current-user X_OK permission; mode/access evidence must be present';}
  return {...file,status:failureKind?'unreviewed':'reviewed',role:review?.role,reason:review?.reason,evidence:review?.evidence,requiredExecutable:review?.requiredExecutable,failureKind,failureReason};
 });
}
export function classifyConcurrentRegistry({meta,registryStat,worker,supervisor,owned=[],temp,registryPath}){
 if(!meta||!temp||temp.path!==registryPath||temp.dev!==registryStat?.dev||temp.ino!==registryStat?.ino||temp.isSymbolicLink)return null;
 const resource={kind:'temp',path:registryPath,token:meta.token,scopeToken:meta.token,runtimeScopeToken:meta.token,scopeOwner:meta.worker,resourceId:'run-registry',dev:registryStat.dev,ino:registryStat.ino};
 return classifyConcurrentResource({meta,registryStat,worker,supervisor,owned,resource,resourceOwned:owned,subjectScope:'unrelated-subject',temp,marker:{token:meta.token,resourceId:'run-registry'}});
}
const incarnation=(expected,actual)=>!!expected&&!!actual&&expected.pid===actual.pid&&expected.birth===actual.birth;
export function classifyConcurrentResource({meta,registryStat,worker,supervisor,owned=[],resource,resourceOwned=[],runtimeScope,scopeOwned=[],subjectScope,temp,marker,leaseBody,port}){
 if(meta?.schema!==1||!meta.token||!registryStat||registryStat.isSymbolicLink||registryStat.dev!==meta.rootIdentity?.dev||registryStat.ino!==meta.rootIdentity?.ino||!incarnation(meta.worker,worker)||!incarnation(meta.supervisor,supervisor) )return null;
 const tokenWorker=owned.some(p=>incarnation(meta.worker,p));
 const pinnedOriginal=meta.worker.role==='worker'&&supervisor.ppid===worker.pid&&owned.some(p=>incarnation(meta.supervisor,p));
 if(!tokenWorker&&!pinnedOriginal)return null;
 if(!resource||resource.released||resource.token!==meta.token||!resource.scopeToken||!resource.scopeOwner)return null;
 const originalResourceOwner=pinnedOriginal&&incarnation(meta.worker,resource.scopeOwner)&&(resource.runtimeScopeToken||resource.scopeToken)===meta.token;
 const inheritedResourceOwner=runtimeScope?.token===meta.token&&runtimeScope.scopeToken===(resource.runtimeScopeToken||resource.scopeToken)&&incarnation(runtimeScope.scopeOwner,resource.scopeOwner)&&typeof runtimeScope.inheritedScopeToken==='string'&&runtimeScope.scopeToken.startsWith(runtimeScope.inheritedScopeToken+'/runtime-')&&scopeOwned.some(p=>incarnation(resource.scopeOwner,p));
 if(!originalResourceOwner&&!inheritedResourceOwner&&!resourceOwned.some(p=>incarnation(resource.scopeOwner,p)))return null;
 if(resource.kind==='temp'&&resource.runtimeScopeToken&&resource.scopeToken!==resource.runtimeScopeToken)return null;
 if(resource.scopeToken===subjectScope||resource.scopeToken.startsWith(subjectScope+'/'))return null;
 let key;
 if(temp&&resource.kind==='serial-file'){
  if(resource.path!==temp.path||temp.isSymbolicLink||resource.dev!==temp.dev||resource.ino!==temp.ino||leaseBody?.schema!==1||leaseBody.kind!=='serial-file'||leaseBody.token!==meta.token||leaseBody.scopeToken!==resource.scopeToken||leaseBody.resourceId!==(resource.ownershipId||resource.resourceId)||!incarnation(resource.owner,leaseBody.owner)||!incarnation(meta.supervisor,leaseBody.supervisor))return null;key=temp.key;
 }else if(temp&&resource.kind==='temp'){
  if(resource.path!==temp.path||temp.isSymbolicLink||resource.dev!==temp.dev||resource.ino!==temp.ino||marker?.token!==meta.token||marker?.resourceId!==resource.resourceId)return null;key=temp.key;
 }else if(port&&resource.kind==='process'){
  if(resource.pid!==port.pid||!owned.some(p=>incarnation(resource,p)))return null;key=port.key;
 }else if(port&&resource.kind==='listener'){
  if(port.pid!==resource.scopeOwner.pid||Number(resource.port)!==Number(port.address.match(/:(\d+)$/)?.[1]))return null;key=port.key;
 }else return null;
 return {key,owner:meta.name||meta.token,reason:'authenticated independently live scope',scopeToken:resource.scopeToken};
}
export function iosStateChanges(before,after,{required=false}={}){
 if(before?.available!==true||after?.available!==true)return required?[{key:'ios-inspection-unavailable',status:'unsupported',beforeAvailable:before?.available===true,afterAvailable:after?.available===true}]:[];
 if(![before.devices,after.devices].every(rows=>Array.isArray(rows)&&rows.every(d=>typeof d?.udid==='string'&&d.udid&&typeof d.state==='string'&&d.state)))return [{key:'ios-inventory-invalid',status:'unsupported'}];
 const changes=[];for(const d of after.devices){const previous=before.devices.find(q=>q.udid===d.udid);if(!previous||previous.state!==d.state)changes.push({key:'ios:'+d.udid,...d,beforeState:previous?.state??null,change:previous?'state-changed':'created'});}
 for(const d of before.devices)if(!after.devices.some(q=>q.udid===d.udid))changes.push({key:'ios:'+d.udid,udid:d.udid,beforeState:d.state,state:null,change:'removed'});
 return changes;
}
export function concurrentResourceCandidate(resource,{newTemps=[],newPorts=[]}={}){
 if(['temp','serial-file'].includes(resource?.kind))return newTemps.some(t=>t.path===resource.path);
 if(resource?.kind==='process')return newPorts.some(p=>p.pid===resource.pid);
 if(resource?.kind==='listener')return newPorts.some(p=>typeof p.address==='string'&&p.pid===resource.scopeOwner?.pid&&Number(p.address.match(/:(\d+)$/)?.[1])===Number(resource.port));
 return false;
}
export function classifyResidue({ownedProcesses=[],resources=[],existsPaths=[],newPorts=[],newTemps=[],newDeviceState=[],concurrent=[]}){
 const failures=[],notes=[];
 for(const p of ownedProcesses)failures.push({kind:'process',pid:p.pid,birth:p.birth});
 for(const r of resources){if(r.released){if(r.kind==='temp'&&typeof r.path==='string'&&existsPaths.includes(r.path))failures.push({kind:'released-but-present',path:r.path});continue;}if(r.keep){if(!r.owner||!r.reason)failures.push({kind:'invalid-retention',resource:r});else notes.push({kind:'explicitly-kept',resource:r});continue;}
  if(r.kind==='temp'&&existsPaths.includes(r.path))failures.push({kind:'temp',path:r.path});
  else if(!['process','temp','callback','listener','browser'].includes(r.kind))failures.push({kind:'unreleased-resource',resource:r});
 }
 for(const [kind,rows] of [['listener',newPorts],['unregistered-temp',newTemps],['device-state',newDeviceState]])for(const row of rows){if(concurrent.some(c=>c.key===row.key&&c.owner&&c.reason))notes.push({kind:'concurrent',...row});else failures.push({kind,...row});}
 return {failures,notes,clean:failures.length===0};
}
function command(cmd,args,optional=false,cwd=ROOT){const r=spawnSync(cmd,args,{timeout:4000,killSignal:'SIGKILL',encoding:'utf8',maxBuffer:8*1024*1024,cwd,env:process.env});if(r.error||![0,1].includes(r.status)||(optional&&r.status===1&&r.stderr.trim()))return {available:false,error:r.error?.message||r.stderr,status:r.status};if(r.status===1&&!optional)return {available:false,error:r.stderr,status:r.status};return {available:true,output:r.stdout};}
export async function snapshot({deviceSerial}={}){
 const ps=command('/bin/ps',['-axo','pid=,ppid=,pgid=,comm=']);if(!ps.available)throw Error('process snapshot unavailable: '+ps.error);
 const processes=ps.output.trim().split('\n').filter(Boolean).map(l=>{const m=l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);if(!m)throw Error('unparseable process row');return {pid:+m[1],ppid:+m[2],pgid:+m[3],executable:m[4]};});
 const sockets=command('/usr/sbin/lsof',['-nP','-iTCP','-sTCP:LISTEN','-Fpn'],true);if(!sockets.available)throw Error('listener snapshot unavailable: '+sockets.error);
 let pid;const ports=[];for(const l of sockets.output.split('\n')){if(l[0]==='p')pid=Number(l.slice(1));else if(l[0]==='n')ports.push({pid,address:l.slice(1),key:pid+':'+l.slice(1)});}
 const tempRoots=[...new Set(await Promise.all(['/private/tmp',ORIGINAL_TEMP_ROOT].map(p=>realpath(p))))],temps=[];
 for(const root of tempRoots)for(const name of await readdir(root)){const path=join(root,name);try{const info=await lstat(path);temps.push({path,name,root,dev:info.dev,ino:info.ino,isSymbolicLink:info.isSymbolicLink(),key:path+':'+info.dev+':'+info.ino});}catch(e){if(e.code!=='ENOENT')throw e;}}

 const device={android:{available:false,reason:'no device serial requested'},ios:{available:false}};
 // Never start an adb server just to inspect another agent's state.
 if(deviceSerial&&ports.some(p=>/:5037$/.test(p.address))){const adb=process.env.HW_ADB||'/opt/homebrew/share/android-commandlinetools/platform-tools/adb';const forward=command(adb,['-s',deviceSerial,'forward','--list']),reverse=command(adb,['-s',deviceSerial,'reverse','--list']);device.android={available:forward.available&&reverse.available,serial:deviceSerial,forward,reverse};}
 if(process.platform==='darwin'){const ios=command('/usr/bin/xcrun',['simctl','list','devices','--json']);if(ios.available){try{device.ios={available:true,devices:Object.values(JSON.parse(ios.output).devices).flat().map(d=>({udid:d.udid,state:d.state}))};}catch(e){device.ios={available:false,error:e.message};}}else device.ios={available:false,error:ios.error};}
 return {at:new Date().toISOString(),processes,ports,temps,device};
}
const SOURCE_FILE=/\.(?:mjs|js|py|sh|ps1|c)$/;
const MAINTAINED_NON_SOURCE_DIRS=new Set(['node_modules','vendor','cache','.cache','.git','.venv','__pycache__']);
/** Mandatory Node inventory: Git/global ignore rules cannot omit maintained source. */
export async function maintainedSourceInventory({root=ROOT,runtime,maxEntries=20000,maxDepth=32}={}){
 if(!runtime)throw Error('maintained inventory requires an owned runtime');
 if(!Number.isSafeInteger(maxEntries)||maxEntries<=0||maxEntries>20000||!Number.isSafeInteger(maxDepth)||maxDepth<0||maxDepth>32)throw Error('invalid maintained inventory bounds');
 return runtime.deadline('inventory mandatory tools/tests without Git exclusions',async signal=>{
  const files=[],failures=[],excluded=[],roots=[];let entries=0;
  const issue=(path,kind,reason)=>failures.push({path,line:1,kind,reason});
  const walk=async(path,depth)=>{
   if(signal.aborted)throw signal.reason;
   if(++entries>maxEntries)throw Error('maintained inventory exceeds '+maxEntries+' entries');
   if(depth>maxDepth)throw Error('maintained inventory exceeds depth '+maxDepth);
   let info;try{info=await lstat(join(root,path));}catch(error){if(error.code==='ENOENT'){issue(path,'maintained-entry-missing','mandatory entry disappeared or does not exist');return;}throw error;}
   if(info.isSymbolicLink()){issue(path,'unsupported-maintained-entry','symlink was not followed');return;}
   if(info.isDirectory()){
    if(depth&&MAINTAINED_NON_SOURCE_DIRS.has(path.split('/').at(-1))){const reason='named vendor/cache directory was not traversed; its exclusion is not reviewed';excluded.push({path,reason});issue(path,'unreviewed-maintained-exclusion',reason);return;}
    const directory=await opendir(join(root,path),{bufferSize:Math.min(32,Math.max(1,maxEntries-entries))}),names=[];let closing,unregister=()=>{};
    const close=()=>closing??=directory.close();
    try{
     unregister=runtime.onCleanup('close maintained inventory directory '+path,close);
     while(true){
      if(signal.aborted)throw signal.reason;
      const entry=await directory.read();if(signal.aborted)throw signal.reason;if(!entry)break;
      if(entries+names.length+1>maxEntries)throw Error('maintained inventory exceeds '+maxEntries+' entries');
      names.push(entry.name);
     }
    }finally{try{await close();}finally{unregister();}}
    for(const name of names.sort())await walk(path+'/'+name,depth+1);
   }else if(info.isFile()){if(depth===0)issue(path,'invalid-maintained-root','mandatory root must be a directory');else if(SOURCE_FILE.test(path))files.push(path);}
   else issue(path,'unsupported-maintained-entry','special filesystem entry was not opened');
  };
  for(const path of ['tools','tests']){const before=files.length;await walk(path,0);const count=files.length-before;roots.push({path,files:count});if(count===0)issue(path,'empty-maintained-corpus','mandatory root contains no inventoried source');}
  return {files,failures,excluded,roots,entries};
 },{timeoutMs:10000});
}
export async function staticSourceInventory({root=ROOT,runtime,policy}){
 const maintained=await maintainedSourceInventory({root,runtime}),legacy=command('rg',['--files','output/playwright'],true,root);if(!legacy.available)throw Error('legacy output inventory failed: '+legacy.error);
 // Historical output exclusions never apply to the mandatory maintained corpus.
 const legacyFiles=legacy.output.split('\n').filter(p=>SOURCE_FILE.test(p)&&!policy.exclusions.some(e=>p.startsWith(e.prefix)&&e.reason)),sourceFiles=[...new Set([...maintained.files,...legacyFiles])].sort();return {maintained,legacyFiles,sourceFiles};
}
export async function staticCheck({out,runtime,root=ROOT}){
 const policySource=await readRegularInput(join(root,'tools/cleanup-policy.json'),{runtime}),policy=JSON.parse(policySource),{maintained,legacyFiles,sourceFiles}=await staticSourceInventory({root,runtime,policy});let rows=[],inventory=[],sources=new Map();
 for(const path of sourceFiles){const absolute=join(root,path),source=await readRegularInput(absolute,{runtime,allowEmpty:true}),mode=(await stat(absolute)).mode&0o7777;let executable;
  if(path.endsWith('.sh')){try{await access(absolute,fsConstants.X_OK);executable=true;}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error;executable=false;}}
  const sourceSha256=digest(source);inventory.push({path,sourceSha256,mode,executable});if(path.startsWith('tools/')||path.startsWith('tests/'))sources.set(path,source);rows.push(...scanSource(path,source).map(r=>({...r,sourceSha256})));}
 const proofInputs=[...new Set([...(policy.reviewedFiles||[]),...(policy.reviewedResources||[])].flatMap(r=>Array.isArray(r.evidence)?r.evidence:[r.evidence]).filter(Boolean))],proofs=new Set();
 for(const proof of proofInputs){if(typeof proof!=='string')continue;const path=resolve(root,proof);if(path!==root&&!path.startsWith(root+'/'))continue;try{if((await stat(path)).isFile())proofs.add(proof);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const evidenceExists=proof=>{const paths=Array.isArray(proof)?proof:[proof];return paths.length>0&&paths.every(p=>proofs.has(p));};
 const fileReviews=assessFileInventory(inventory,policy,{evidenceExists});
 rows=assessStatic(rows,{...policy,reviewedResources:(policy.reviewedResources||[]).filter(r=>evidenceExists(r.evidence))});const existingFailures=[...maintained.failures,...rows.filter(r=>r.status==='unreviewed'),...fileReviews.filter(r=>r.status==='unreviewed').map(r=>({...r,kind:r.failureKind||'unreviewed-file',line:1}))];
 let catalog,catalogSource,catalogInputs=[],facts;try{catalogSource=await readRegularInput(join(root,'tools/tool-capability-catalog.json'),{runtime});catalog=JSON.parse(catalogSource);}catch(error){catalogInputs.push({kind:'catalog-input-unavailable',path:'tools/tool-capability-catalog.json',line:1,reason:error.message});}
 try{facts=await collectCapabilityFacts({root,inventory,sources,policy,catalog,read:path=>readRegularInput(path,{runtime,maxBytes:8*1024*1024,encoding:null,allowEmpty:true})});}catch(error){facts={failures:[{kind:'catalog-facts-unavailable',path:'catalog',reason:error.message}]};}
 // Do not publish an acceptance record for a moving maintained source epoch.
 try{for(const row of inventory.filter(r=>r.path.startsWith('tools/')||r.path.startsWith('tests/')))if(digest(await readRegularInput(join(root,row.path),{runtime,allowEmpty:true}))!==row.sourceSha256)throw Error('maintained source changed: '+row.path);
  const after=await maintainedSourceInventory({root,runtime});if(JSON.stringify(after.files)!==JSON.stringify(maintained.files)||JSON.stringify(after.failures)!==JSON.stringify(maintained.failures)||digest(await readRegularInput(join(root,'tools/cleanup-policy.json'),{runtime}))!==digest(policySource)||catalogSource!==undefined&&digest(await readRegularInput(join(root,'tools/tool-capability-catalog.json'),{runtime}))!==digest(catalogSource))throw Error('maintained membership, policy or catalog changed');
 }catch(error){catalogInputs.push({kind:'catalog-source-epoch-changed',path:'catalog',line:1,reason:error.message});}
 const capabilityCatalog=assessCatalogGate({catalog,inventory:facts.inventory||inventory,facts,existingFailures:[...existingFailures,...catalogInputs]}),failures=capabilityCatalog.failures,result={mode:'static',files:sourceFiles.length,sourceInventory:{maintainedFiles:maintained.files.length,legacyFiles:legacyFiles.length,roots:maintained.roots,visitedEntries:maintained.entries,excluded:maintained.excluded},resources:rows.length,fileReviews,reviewed:rows.filter(r=>r.status==='reviewed').length,reviewedFiles:fileReviews.filter(r=>r.status==='reviewed').length,capabilityCatalog:{...capabilityCatalog.assessment,passed:!capabilityCatalog.catalogFailures.length&&!catalogInputs.length,observationFailures:facts.failures||[],catalogInputFailures:catalogInputs},failures,rows,passed:failures.length===0};
 await writeFile(join(out,'static.json'),JSON.stringify(result,null,2));for(const r of failures.slice(0,40))console.error(r.path+':'+r.line+' unreviewed '+r.kind);console.log('cleanup static: '+rows.filter(r=>r.status==='unreviewed').length+' unreviewed acquisition(s); '+fileReviews.filter(r=>r.status==='unreviewed').length+' unreviewed source file(s), '+sourceFiles.length+' inventoried files');return result.passed?0:1;
}
export async function canonicalTempResource(resource,{resolveExisting=realpath}={}){
 if(!['temp','serial-file'].includes(resource?.kind)||typeof resource.path!=='string')return resource;
 try{const path=await resolveExisting(resource.path);return path===resource.path?resource:{...resource,recordedPath:resource.path,path};}catch(error){if(error.code==='ENOENT')return resource;throw error;}
}
async function liveCheck({out,cmd,args,timeoutMs,deviceSerial,deviceSimulator=false}){
 const {ensureToolRuntime,ownedProcesses}=await import('./tool-runtime.mjs');const rt=ensureToolRuntime({name:'check-cleanup',runTimeoutMs:timeoutMs+15000,stepTimeoutMs:5000});await rt.ready;
 const subjectTemp=await rt.tempDir('heartwood-cleanup-subject-');
 rt.step('cleanup before snapshot','bounded process, listener, temp and device observations');const before=await snapshot({deviceSerial});rt.step('cleanup command','command exit');const result=await rt.runCommand(cmd,args,{label:'cleanup subject',timeoutMs,stdio:'inherit',env:{TMPDIR:subjectTemp,TMP:subjectTemp,TEMP:subjectTemp}});
 const helper=rt.ownerRecord.helper;const owned=ownedProcesses(helper.binary,rt.runId,result.scopeToken).filter(p=>p.pid!==process.pid&&p.pid!==rt.ownerRecord.supervisor.pid);
 const resources=[];for(const name of (await readdir(join(rt.runDir,'resources'))).filter(n=>n.endsWith('.json'))){let raw;try{raw=JSON.parse(await readFile(join(rt.runDir,'resources',name),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}const r=await canonicalTempResource(raw);if(r.scopeToken===result.scopeToken||r.scopeToken?.startsWith(result.scopeToken+'/'))resources.push(r);}
 const existsPaths=[];for(const r of resources)if(r.path)try{await stat(r.path);existsPaths.push(r.path);}catch(e){if(e.code!=='ENOENT')throw e;}
 const opaqueContents=await rt.deadline('inspect dedicated subject temp contents',async()=>{const entries=[];const walk=async path=>{for(const name of await readdir(path)){if(path===subjectTemp&&name==='.hw-tool-owner')continue;const child=join(path,name),info=await lstat(child);entries.push({path:child,kind:info.isDirectory()?'directory':info.isSymbolicLink()?'symlink':'file'});if(entries.length>1000)throw Error('subject temp inventory exceeds 1000 entries');if(info.isDirectory()&&!info.isSymbolicLink())await walk(child);}};await walk(subjectTemp);return entries;},{timeoutMs:5000});
 rt.step('cleanup after snapshot','bounded process, listener, temp and device observations');const after=await snapshot({deviceSerial}),newPorts=after.ports.filter(p=>!before.ports.some(q=>q.key===p.key));
 const newTemps=after.temps.filter(p=>!before.temps.some(q=>q.key===p.key)&&!resources.some(r=>r.kind==='temp'&&r.path===p.path)&&p.path!==rt.runDir);
 const iosRequired=deviceSimulator||resources.some(r=>r.kind==='ios-device'),newDeviceState=iosStateChanges(before.device.ios,after.device.ios,{required:iosRequired});
 if(deviceSerial){if(!before.device.android.available||!after.device.android.available)newDeviceState.push({key:'android-inspection-unavailable',serial:deviceSerial});else for(const kind of ['forward','reverse']){const old=before.device.android[kind].output.split('\n');for(const line of after.device.android[kind].output.split('\n').filter(Boolean))if(!old.includes(line))newDeviceState.push({key:'android:'+kind+':'+line,kind,line});}}
 // Other active supervisors may legitimately create ports/temp resources. Only authenticated, current run records qualify.
 const concurrent=[],membership=new Map();let identityQueries=0;const members=(token,scope)=>{const key=JSON.stringify([token,scope??null]);if(!membership.has(key)){identityQueries++;membership.set(key,ownedProcesses(helper.binary,token,scope));}return membership.get(key);};
 rt.step('authenticate newly observed peer resources','exact native owner, scope, token and inode evidence');
 for(const t of (newTemps.length||newPorts.length?after.temps:[]).filter(t=>t.name.startsWith('heartwood-run-'))){try{
  const m=JSON.parse(await readFile(join(t.path,'run.json'),'utf8'));const {inspectProcess}=await import('./tool-runtime.mjs');
  const registry=await lstat(t.path),registryStat={dev:registry.dev,ino:registry.ino,isSymbolicLink:registry.isSymbolicLink()},worker=inspectProcess(helper.binary,m.worker?.pid),supervisor=inspectProcess(helper.binary,m.supervisor?.pid),owned=members(m.token);
  for(const q of newTemps){const accepted=classifyConcurrentRegistry({meta:m,registryStat,worker,supervisor,owned,temp:q,registryPath:t.path});if(accepted)concurrent.push(accepted);}
  for(const n of (await readdir(join(t.path,'resources'))).filter(n=>n.endsWith('.json'))){let raw;try{raw=JSON.parse(await readFile(join(t.path,'resources',n),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}const r=await canonicalTempResource(raw);if(!concurrentResourceCandidate(r,{newTemps,newPorts}))continue;const resourceOwned=members(m.token,r.runtimeScopeToken||r.scopeToken);let runtimeScope,scopeOwned=[];
   try{runtimeScope=JSON.parse(await readFile(join(t.path,'scopes',r.scopeOwner?.pid+'.json'),'utf8'));if(runtimeScope.inheritedScopeToken)scopeOwned=members(m.token,runtimeScope.inheritedScopeToken);}catch(error){if(error.code!=='ENOENT')throw error;}
   for(const q of newTemps){if(!['temp','serial-file'].includes(r.kind)||r.path!==q.path)continue;let marker,leaseBody;try{if(r.kind==='temp')marker=JSON.parse(await readFile(join(q.path,'.hw-tool-owner'),'utf8'));else leaseBody=JSON.parse(await readFile(q.path,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}const accepted=classifyConcurrentResource({meta:m,registryStat,worker,supervisor,owned,resource:r,resourceOwned,runtimeScope,scopeOwned,subjectScope:result.scopeToken,temp:q,marker,leaseBody});if(accepted)concurrent.push(accepted);}
   for(const q of newPorts){const accepted=classifyConcurrentResource({meta:m,registryStat,worker,supervisor,owned,resource:r,resourceOwned,runtimeScope,scopeOwned,subjectScope:result.scopeToken,port:q});if(accepted)concurrent.push(accepted);}
  }
 }catch(e){if(e.code!=='ENOENT')console.error('concurrent resource classification unavailable: '+e.message);}}

 const audit=classifyResidue({ownedProcesses:owned,resources,existsPaths,newPorts,newTemps,newDeviceState,concurrent});
 for(const entry of opaqueContents)audit.failures.push({...entry,entryKind:entry.kind,kind:'unregistered-subject-temp'});
 for(const p of result.cleanup?.observedLeftovers||[])(result.timedOut?audit.notes:audit.failures).push({kind:result.timedOut?'timeout-force-cleanup':'leftover-reaped-by-supervisor',...p});for(const e of result.cleanup?.errors||[])audit.failures.push({kind:'cleanup-error',error:e});audit.clean=audit.failures.length===0;
 const report={mode:'runtime',command:[cmd,...args],result,before,after,subjectTemp,opaqueContents,deviceEvidence:{ios:{required:iosRequired,beforeAvailable:before.device.ios.available,afterAvailable:after.device.ios.available},android:{required:!!deviceSerial}},peerObservation:{identityQueries,cachedMemberships:membership.size,semantics:'Exact native membership observations reused only within this after-snapshot classification; unknown objects remain failures'},...audit,passed:result.status===0&&audit.clean};await writeFile(join(out,'runtime.json'),JSON.stringify(report,null,2));console.log('cleanup runtime: exit '+result.status+', '+audit.failures.length+' residue issue(s); '+join(out,'runtime.json'));if(audit.failures.length)console.error(JSON.stringify(audit.failures));await rt.shutdown('cleanup audit completed');return result.status||(!audit.clean?1:0);
}
export async function main(argv=process.argv.slice(2)){
 const split=argv.indexOf('--'),head=split<0?argv:argv.slice(0,split),tail=split<0?[]:argv.slice(split+1);
 const {values:o}=parseArgs({args:head,strict:true,options:{static:{type:'boolean'},runtime:{type:'boolean'},help:{type:'boolean',short:'h'},out:{type:'string'},'timeout-ms':{type:'string'},'device-serial':{type:'string'},'device-simulator':{type:'boolean'}}});
 if(o.help){console.log('Usage: node tools/check-cleanup.mjs --static [--out DIR] | --runtime [--timeout-ms N] [--device-serial SERIAL] [--device-simulator] [--out DIR] -- COMMAND ARGS...');return 0;}
 if(!!o.static===!!o.runtime)throw Error('select exactly one of --static/--runtime');if(o.static&&tail.length)throw Error('--static accepts no command');if(o.runtime&&!tail.length)throw Error('--runtime requires a command after --');for(const key of ['device-serial','timeout-ms','out'])if(o[key]!==undefined&&!o[key].trim())throw Error(key+' must be nonempty');const timeoutMs=Number(o['timeout-ms']??120000);if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647)throw Error('timeout must be a positive safe integer <=2147483647');
 const out=resolve(o.out||join(ROOT,'output/cleanup/gate-'+Date.now()+'-'+process.pid)),runtime=ensureToolRuntime({name:o.static?'cleanup static audit':'cleanup live audit',runTimeoutMs:o.static?60000:Math.min(2147483647,timeoutMs+45000)});await runtime.ready;
 try{await runtime.deadline('create cleanup report output',()=>mkdir(out,{recursive:true}),{timeoutMs:10000});return o.static?await runtime.deadline('static inventory and source review',()=>staticCheck({out,runtime}),{timeoutMs:45000}):await liveCheck({out,cmd:tail[0],args:tail.slice(1),timeoutMs,deviceSerial:o['device-serial'],deviceSimulator:!!o['device-simulator']});}
 finally{const cleanup=await runtime.shutdown('cleanup audit complete');if(cleanup.errors.length)throw new AggregateError(cleanup.errors.map(e=>Error(String(e))),'Cleanup audit shutdown failed');}
}
if(isToolMain(import.meta.url)){try{process.exitCode=await main();}catch(e){console.error(e.stack||e.message);process.exitCode=1;}}
