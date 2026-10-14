// One normal, owned Chrome startup/local-page/close observation; never dialog-absence proof.
// Hostile force-kill/parent-death coverage belongs to shared supervisor/lifecycle tests.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {opendir,lstat,writeFile,realpath} from 'node:fs/promises';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export function crashDiagnosticOptions(args=process.argv.slice(2)){
 return parseArgs({args,strict:true,allowPositionals:false,options:{help:{type:'boolean',short:'h'}}}).values;
}
function launchMicros(value){
 const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{1,6}) ([+-])(\d{2})(\d{2})$/.exec(value);if(!m)return null;
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),ms=Date.UTC(year,month-1,day,hour,minute,second),d=new Date(ms);
 if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day||d.getUTCHours()!==hour||d.getUTCMinutes()!==minute||d.getUTCSeconds()!==second||Number(m[9])>23||Number(m[10])>59)return null;
 const offset=(Number(m[9])*60+Number(m[10]))*60000*(m[8]==='+'?1:-1);return BigInt(ms-offset)*1000n+BigInt(m[7].padEnd(6,'0'));
}
export function classifyOwnedCrashReport(text,owner){
 let body;try{body=JSON.parse(text);}catch{try{body=JSON.parse(text.slice(text.indexOf('\n')+1));}catch{return {status:'UNREADABLE'};}}
 if(!body||body.pid!==owner.pid)return {status:'UNRELATED'};
 if(body.procPath!==owner.executable)return typeof body.procPath==='string'?{status:'UNRELATED'}:{status:'UNRESOLVED_SAME_PID'};
 const launch=launchMicros(body.procLaunch),birth=/^(\d+):(\d{1,6})$/.exec(owner.birth||'');if(launch===null||!birth||Number(birth[2])>=1000000)return {status:'UNRESOLVED_SAME_PID'};
 const native=BigInt(birth[1])*1000000n+BigInt(birth[2]),delta=launch>native?launch-native:native-launch;
 // Native birth is microsecond exact; .ips macOS launch timestamps are printed to100us.
 if(delta>100n)return {status:'UNRELATED'};
 return {status:'MATCHED_OWNED_INCARNATION',pid:body.pid,procLaunch:body.procLaunch,exception:{type:body.exception?.type,signal:body.exception?.signal}};
}
export function startupObservationStatus(row){
 if(row?.startup!==true||row.localPage!==true||row.closed!==true||row.retired!==true||row.browserExit?.code!==0||row.browserExit?.signal!==null||!Array.isArray(row.ownedScopeRemaining)||row.ownedScopeRemaining.length||!Array.isArray(row.cleanupErrors)||row.cleanupErrors.length||!Array.isArray(row.matches)||row.matches.length||!Array.isArray(row.events)||row.events.length)return 'FAIL';
 if(!Array.isArray(row.unresolved)||row.unresolved.length)return 'UNSUPPORTED';return 'OBSERVED';
}
async function observeCrashRecords(runtime,owner,readRegularInput){
 return runtime.deadline('snapshot only current-incarnation Chrome crash records',async signal=>{
  const folder=join(homedir(),'Library/Logs/DiagnosticReports'),directory=await opendir(folder,{bufferSize:16}),matches=[],unresolved=[],issues=[];let closing,count=0,readCount=0;const close=()=>closing??=directory.close(),unregister=runtime.onCleanup('close diagnostic report inventory',close);
  try{for(;;){if(signal.aborted)throw signal.reason;const entry=await directory.read();if(!entry)break;assert(++count<=4096,'Diagnostic report entry ceiling exceeded');if(!entry.name.startsWith('Google Chrome-')||!entry.name.endsWith('.ips'))continue;const path=join(folder,entry.name),info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink(),'Chrome diagnostic report must be regular');if(info.mtimeMs<Number(owner.birth.split(':')[0])*1000-1000)continue;assert(++readCount<=32,'Recent Chrome report ceiling exceeded');
   try{const text=await readRegularInput(path,{runtime,maxBytes:2*1024*1024,timeoutMs:2000}),row=classifyOwnedCrashReport(text,owner);if(row.status==='MATCHED_OWNED_INCARNATION')matches.push({name:entry.name,...row});else if(row.status==='UNRESOLVED_SAME_PID')unresolved.push({name:entry.name,...row});else if(row.status==='UNREADABLE')issues.push({name:entry.name,status:'UNREADABLE; attribution unavailable'});}catch(error){issues.push({name:entry.name,error:error.message});}
  }}finally{try{await close();}finally{unregister();}}
  return {matches,unresolved,issues,snapshot:'IMMEDIATE_AFTER_CLOSE',absence:'NOT_ESTABLISHED; delayed ReportCrash output and visible dialogs are not measured'};
 },{timeoutMs:8000});
}
export async function main(args=process.argv.slice(2)){
 const options=crashDiagnosticOptions(args);if(options.help){console.log('Usage: node tools/diagnostics/chrome-crash-dialog-check.mjs [--help]\nOne owned headless Chrome startup/local-page/normal-close observation. No forced kills, sandbox provocation, screenshot, visual-dialog-absence or page/performance acceptance. Native reports are immediate and exact-incarnation only.');return 0;}
 if(process.platform!=='darwin'){console.log(JSON.stringify({schema:1,status:'UNSUPPORTED',passed:false,reason:'macOS installed Chrome startup observation only'}));return 64;}
 const lib=await import('../browser-test-lib.mjs');lib.assertBrowserAllocationAllowed();
 const {createToolRuntime,ownedProcesses,inspectProcess}=await import('../tool-runtime.mjs'),{readRegularInput}=await import('../tool-operations.mjs');
 const runtime=createToolRuntime({name:'owned Chrome startup-close observation',runTimeoutMs:60000,stepTimeoutMs:10000,shutdownMs:8000});await runtime.ready;
 const row={startup:false,localPage:false,closed:false,retired:false,browserExit:null,ownedScopeRemaining:null,cleanupErrors:[],matches:[],unresolved:[],events:[]},handles=new Map();let fixture,session,owner,failure,intentionalClose=false;
 const register=runtime.registerProcess.bind(runtime);runtime.registerProcess=async(child,opts)=>{const record=await register(child,opts);if(opts?.label==='Playwright chromium'){assert(child?.pid===record.pid&&typeof child.once==='function','Owned browser must expose registered process handle');let resolveExit;const exit=new Promise(r=>{resolveExit=r;}),listener=(code,signal)=>resolveExit({code,signal});child.once('exit',listener);if(child.exitCode!==null||child.signalCode!==null)resolveExit({code:child.exitCode,signal:child.signalCode});handles.set(record.pid,{record,child,exit,listener});}return record;};
 try{
  const site=await runtime.tempDir('chrome-local-startup-'),title='Owned Chrome startup observation';await runtime.deadline('write owned local observation page',()=>writeFile(join(site,'index.html'),'<!doctype html><meta charset="utf-8"><title>'+title+'</title><p id="owned">Owned local page</p>'),{timeoutMs:3000});
  fixture=await lib.browserFixture({siteRoot:site,engine:'chromium',runtime,env:{...process.env,HW_HEADLESS:'1',HW_BROWSER_EXECUTABLE:CHROME}});session=await fixture.browser.newBrowserCDPSession();const info=await runtime.deadline('read owned browser native identity',()=>session.send('SystemInfo.getProcessInfo'),{timeoutMs:5000}),pid=info.processInfo?.find(p=>p.type==='browser')?.id;
  assert(Number.isSafeInteger(pid)&&pid>1&&handles.size===1&&handles.has(pid),'No unique owned browser process was recorded');owner=ownedProcesses(runtime.ownerRecord.helper.binary,runtime.runId,runtime.scopeToken).find(p=>p.pid===pid&&p.birth===handles.get(pid).record.birth);assert(owner?.tokenMatched===true,'Browser incarnation lacks native inherited run-token ownership');owner={...owner,executable:await runtime.deadline('bind installed Chrome executable',()=>realpath(CHROME),{timeoutMs:3000})};row.startup=true;
  fixture.browser.on('disconnected',()=>{if(!intentionalClose)row.events.push('browser disconnected before requested normal close');});const context=await fixture.browser.newContext(),page=await context.newPage();page.on('crash',()=>row.events.push('owned page crashed'));page.on('pageerror',e=>row.events.push('owned local-page error: '+e.message));
  await runtime.deadline('load own guarded local page',()=>page.goto(fixture.base+'/index.html',{waitUntil:'load',timeout:10000}),{timeoutMs:11000});await runtime.deadline('assert exact own local-page content',async()=>{assert.equal(await page.title(),title);assert.equal(await page.locator('#owned').textContent({timeout:5000}),'Owned local page');},{timeoutMs:6000});row.localPage=true;
 }catch(error){failure=String(error.stack||error);process.exitCode=error.code===124?124:1;}
 finally{
  if(session)try{await runtime.deadline('detach owned browser CDP observation',()=>session.detach(),{timeoutMs:3000,cleanup:true});}catch(error){row.cleanupErrors.push(error.message);}
  intentionalClose=true;if(fixture)try{await fixture.close();row.closed=true;}catch(error){row.cleanupErrors.push(error.message);}
  if(owner){try{row.browserExit=await runtime.deadline('confirm normal registered browser exit',()=>handles.get(owner.pid).exit,{timeoutMs:3000,cleanup:true});const actual=inspectProcess(runtime.ownerRecord.helper.binary,owner.pid);row.retired=!actual||actual.birth!==owner.birth;const observed=await observeCrashRecords(runtime,owner,readRegularInput);Object.assign(row,observed);}catch(error){row.cleanupErrors.push(error.message);}}
  runtime.registerProcess=register;for(const {child,listener}of handles.values())child.removeListener('exit',listener);
  try{row.ownedScopeRemaining=ownedProcesses(runtime.ownerRecord.helper.binary,runtime.runId,runtime.scopeToken).filter(p=>p.pid!==process.pid&&!(p.pid===runtime.ownerRecord.supervisor?.pid&&p.birth===runtime.ownerRecord.supervisor.birth)).map(({pid,birth})=>({pid,birth}));}catch(error){row.cleanupErrors.push('Native owned-scope retirement unavailable: '+error.message);}
  const provisional=failure?'FAIL':startupObservationStatus(row);if(provisional!=='OBSERVED')process.exitCode=process.exitCode||(provisional==='UNSUPPORTED'?64:1);const cleanup=await runtime.shutdown('Chrome startup observation complete');row.cleanupErrors.push(...cleanup.errors);
 }
 const status=failure?'FAIL':startupObservationStatus(row),report={schema:1,kind:'owned-chrome-startup-close-observation',status,passed:status==='OBSERVED',scope:'One guarded owned startup/local-page/normal-close only; no site/performance/visual-dialog acceptance',owner:owner?{pid:owner.pid,birth:owner.birth,token:runtime.runId}:null,observation:row,failure,visualDialogAbsence:'NOT_ESTABLISHED',delayedCrashAbsence:'NOT_ESTABLISHED'};console.log(JSON.stringify(report,null,2));return status==='OBSERVED'?0:status==='UNSUPPORTED'?64:process.exitCode||1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)try{process.exitCode=await main();}catch(error){console.error(error.stack||error.message);process.exitCode=1;}
