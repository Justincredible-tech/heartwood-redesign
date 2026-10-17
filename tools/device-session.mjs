// Supervised exact-device acquisition. No devices/processes are touched on import.
import {writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {connect} from 'node:net';
import {readRegularInput} from './tool-operations.mjs';
import {ensureToolRuntime,inspectProcess,ownedProcesses} from './tool-runtime.mjs';
import {cleanupOwnedResource,parseADBMappings,flattenSimulators} from './cleanup-resource-actions.mjs';
import {normalizeAndroidPlan,requireIOSCaptureOracle} from './device-route-plan.mjs';
import {mobileScrollEvidence} from './mobile-acceptance.mjs';
const safeSerial=s=>typeof s==='string'&&/^emulator-\d+$/.test(s);
function requireAndroidLeaseFields(lease,token){
 if(!lease||lease.token!==token||lease.createdByRun!==true||lease.preexisting!==false||!safeSerial(lease.serial)||!lease.bootId)throw Error('A fresh run-owned Android emulator lease is required');
}
export function assertOwnedAndroidIdentity(lease,{token,process,owned,resource}={}){
 requireAndroidLeaseFields(lease,token);
 if(!process||process.pid!==lease.pid||process.birth!==lease.processBirth||!owned?.some(p=>p.pid===lease.pid&&p.birth===lease.processBirth))throw Error('Android emulator process ownership changed');
 if(!resource||resource.kind!=='android-emulator'||resource.token!==token||resource.serial!==lease.serial||resource.pid!==lease.pid||resource.processBirth!==lease.processBirth||resource.createdByRun!==true||resource.preexisting!==false)throw Error('No exact registered owned emulator resource');
 return lease;
}
export function assertOwnedAndroidLease(lease,state={}){
 assertOwnedAndroidIdentity(lease,state);if(state.bootId!==lease.bootId)throw Error('Android emulator reboot/ownership changed');return lease;
}
export function androidFrameStats(window){
 if(!window||!Array.isArray(window.frames)||window.frames.length<2||!Array.isArray(window.err)||!Array.isArray(window.loaf))throw Error('Missing Android frame/error/LoAF samples; unsupported evidence cannot pass');
 const evidence=mobileScrollEvidence(window);if(!evidence.supported)throw Error('Invalid Android frame samples: '+evidence.issues.join('; '));
 return {intervals:evidence.intervals.filter(i=>i.gapMs>0).map(i=>i.gapMs),passed:!window.err.length&&evidence.p95<25&&evidence.max<=50,evidence};
}
export class DeviceSession{
 constructor(runtime,{command,serverPort=5037}={}){this.runtime=runtime;this.serverPort=serverPort;this.command=command||((cmd,args,options)=>runtime.runCommand(cmd,args,options));this.cleanups=[];this.adbVerified=!!command;}
 async call(command,args,{timeoutMs=5000,encoding,...more}={}){
  const r=await this.command(command,args,{label:command+' '+args.join(' '),timeoutMs,encoding,...more});
  if(r.status!==0)throw Error(command+' failed ('+r.status+'): '+String(r.stderr||r.stdout).slice(0,500));return r.stdout;
 }
 async verifyADB(){
  if(this.adbVerified)return;
  const version=String(await this.call('adb',['version'])).match(/Android Debug Bridge version 1\.0\.(\d+)/);if(!version)throw Error('Cannot establish ADB client protocol');
  const server=await this.runtime.deadline('existing compatible loopback ADB server',signal=>new Promise((resolve,reject)=>{
   const socket=connect({host:'127.0.0.1',port:this.serverPort});let bytes=Buffer.alloc(0);const close=()=>socket.destroy();
   const fail=e=>{close();reject(e);};signal.addEventListener('abort',()=>fail(signal.reason),{once:true});socket.once('error',fail);
   socket.once('connect',()=>socket.write('000chost:version'));socket.on('data',part=>{bytes=Buffer.concat([bytes,part]);if(bytes.length<8)return;if(bytes.subarray(0,4).toString()!=='OKAY')return fail(Error('ADB server rejected version probe'));const length=parseInt(bytes.subarray(4,8).toString(),16);if(!Number.isFinite(length)||length>128)return fail(Error('Unknown ADB server protocol'));if(bytes.length<8+length)return;close();resolve(parseInt(bytes.subarray(8,8+length).toString(),16));});
   socket.once('close',()=>{if(bytes.length<8)reject(Error('ADB server is absent or unverified; not starting/replacing a shared daemon'));});
  }),{timeoutMs:3000});
  if(server!==+version[1])throw Error('ADB protocol mismatch; refusing to restart a borrowed daemon');this.adbVerified=true;
 }
 async adb(serial,...args){await this.verifyADB();if(!safeSerial(serial))throw Error('Use an exact emulator serial, not an AVD name');return this.call('adb',['-H','127.0.0.1','-P',String(this.serverPort),'-s',serial,...args]);}
 async bootId(serial){return String(await this.adb(serial,'shell','cat','/proc/sys/kernel/random/boot_id')).trim();}
 async ownedAndroid(leasePath){
  const lease=JSON.parse(await readRegularInput(resolve(leasePath),{runtime:this.runtime}));requireAndroidLeaseFields(lease,this.runtime.runId);
  if(typeof lease.resourceId!=='string'||!/^[-0-9a-f]{36}$/i.test(lease.resourceId))throw Error('Invalid registered emulator resource identity');
  const resource=JSON.parse(await readRegularInput(join(this.runtime.runDir,'resources',lease.resourceId+'.json'),{runtime:this.runtime})),meta=this.runtime.ownerRecord;
  const state={token:this.runtime.runId,process:inspectProcess(meta.helper.binary,lease.pid),owned:ownedProcesses(meta.helper.binary,this.runtime.runId),resource};assertOwnedAndroidIdentity(lease,state);
  return assertOwnedAndroidLease(lease,{...state,bootId:await this.bootId(lease.serial)});
 }
 async acquireMapping(lease,{direction,local,remote}){
  if(!['forward','reverse'].includes(direction)||!/^tcp:\d+$/.test(local)||!/^([a-z]+:)[A-Za-z0-9_./-]+$/.test(remote))throw Error('Invalid owned Android mapping');
  const existing=parseADBMappings(await this.adb(lease.serial,direction,'--list'));if(existing.some(m=>m.local===local&&(direction==='reverse'||m.serial===lease.serial)))throw Error('Refusing to replace a preexisting Android mapping');
  const record={token:this.runtime.runId,serverPort:this.serverPort,kind:'android-'+direction,serial:lease.serial,local,remote,bootId:lease.bootId,preexisting:false};
  const cleanup=(_reason,signal)=>cleanupOwnedResource(record,{run:{token:this.runtime.runId},signal,command:async(cmd,args,options)=>{
   const expanded=cmd==='adb'?['-H','127.0.0.1','-P',String(this.serverPort),...args]:args;return this.call(cmd,expanded,{...options,timeoutMs:Math.min(3000,options.timeoutMs),cleanup:true});}});
  const unregister=this.runtime.onCleanup('owned '+direction+' '+local,cleanup,{kind:record.kind,details:record});
  try{await this.adb(lease.serial,direction,'--no-rebind',local,remote);}catch(error){unregister();throw error;}
  this.cleanups.push(async signal=>{await cleanup('normal',signal);unregister();});return record;
 }
 async androidStart({avd,port=5560,out}){
  if(!/^[A-Za-z0-9_.-]+$/.test(avd||'')||!Number.isInteger(port)||port<5554||port>5682||port%2)throw Error('Provide an AVD name and unused even emulator port 5554..5682');
  await this.verifyADB();const serial='emulator-'+port;
  const devices=String(await this.call('adb',['-H','127.0.0.1','-P',String(this.serverPort),'devices']));if(devices.split(/\r?\n/).some(line=>line.split(/\s+/)[0]===serial))throw Error('Emulator serial already exists; never taking over a borrowed device');
  const child=await this.runtime.spawn('emulator',['-avd',avd,'-port',String(port),'-read-only','-no-snapshot','-no-snapshot-save','-no-audio','-no-boot-anim','-gpu','host','-wifi-user-mode-options','restrict=on','-network-user-mode-options','restrict=on','-dns-server','127.0.0.1'],{label:'fresh isolated emulator '+serial,env:{ANDROID_ADB_SERVER_PORT:String(this.serverPort)},stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();const actual=inspectProcess(this.runtime.ownerRecord.helper.binary,child.pid);
  if(!actual)throw Error('Emulator exited before acquiring identity');
  const lease={token:this.runtime.runId,serial,pid:child.pid,processBirth:actual.birth,createdByRun:true,preexisting:false,avd};const registered=this.runtime.registerResource('android-emulator',lease);lease.resourceId=registered.resourceId;
  await this.runtime.deadline('Android boot '+serial,async signal=>{for(;;){if(child.exitCode!==null||child.signalCode!==null)throw Error('Owned emulator exited while booting');try{if(String(await this.adb(serial,'shell','getprop','sys.boot_completed')).trim()==='1')return;}catch(error){if(signal.aborted)throw error;}await new Promise(r=>setTimeout(r,200));}},{timeoutMs:120000});
  lease.bootId=await this.bootId(serial);if(!lease.bootId)throw Error('Missing owned emulator boot ID');
  // Changes occur only in a freshly started -read-only emulator, never hw_pixel.
  for(const args of [['shell','svc','wifi','disable'],['shell','svc','data','disable'],['shell','svc','power','stayon','true'],['shell','settings','put','system','accelerometer_rotation','0']])await this.adb(serial,...args);
  await this.adb(serial,'shell','echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
  await this.adb(serial,'shell','am','set-debug-app','--persistent','com.android.chrome');
  const path=resolve(out||join(this.runtime.runDir,'android-device-lease.json'));await writeFile(path,JSON.stringify(lease,null,2),{flag:'wx'});return {...lease,leasePath:path};
 }
 async simulator({template}){
  const devices=flattenSimulators(JSON.parse(await this.call('xcrun',['simctl','list','devices','--json']))),original=devices.find(d=>d.udid===template);
  if(!original||!original.deviceTypeIdentifier||!original.runtime)throw Error('Cannot establish exact simulator template type/runtime');
  const name='heartwood-'+this.runtime.runId;if(devices.some(d=>d.name===name))throw Error('Run simulator name already exists');
  const record={token:this.runtime.runId,kind:'ios-device',name,deviceType:original.deviceTypeIdentifier,runtime:original.runtime,createdByRun:true,preexisting:false};
  const cleanup=(_reason,signal)=>cleanupOwnedResource(record,{run:{token:this.runtime.runId},signal,command:(cmd,args,options)=>this.call(cmd,args,{...options,cleanup:true})});
  const unregister=this.runtime.onCleanup('owned isolated simulator',cleanup,{kind:'ios-device',details:record});
  const createdUdid=String(await this.call('xcrun',['simctl','create',name,record.deviceType,record.runtime])).trim();if(!/^[A-Fa-f0-9-]{36}$/.test(createdUdid))throw Error('Simulator create returned an invalid UDID');record.udid=createdUdid;
  this.runtime.registerResource('ios-device',record);this.cleanups.push(async signal=>{await cleanup('normal',signal);unregister();});
  await this.call('xcrun',['simctl','boot',record.udid]);await this.call('xcrun',['simctl','bootstatus',record.udid,'-b'],{timeoutMs:120000});return record;
 }
 async close(){if(this.runtime.closed)return this.runtime.shutdown('device close');return this.runtime.deadline('close owned device session',async signal=>{const errors=[];for(const fn of this.cleanups.reverse())try{await fn(signal);}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,errors.map(e=>e.message).join('; '));},{cleanup:true,timeoutMs:this.runtime.policy?.shutdownMs||8000});}
}
export async function deviceMain(args=process.argv.slice(2)){
 const {values:o,positionals}=parseArgs({args,allowPositionals:true,options:{help:{type:'boolean',short:'h'},avd:{type:'string'},port:{type:'string'},out:{type:'string'},template:{type:'string'},base:{type:'string'},lease:{type:'string'},cdp:{type:'string'},'wait-ms':{type:'string',default:'6000'},routes:{type:'string'},parts:{type:'string'},tool:{type:'string',default:'android-check'},serial:{type:'string'},url:{type:'string'},expression:{type:'string'},seconds:{type:'string',default:'0'},interval:{type:'string',default:'5'},input:{type:'string'}}});
 if(o.help){console.log('Usage: node tools/device-session.mjs android-run --avd NAME [--port EVEN] --base LOOPBACK --out DIR | targets --cdp LOOPBACK | probe --lease FILE --serial emulator-N --cdp LOOPBACK --url LOOPBACK [--expression JS --seconds N --interval N] | sheet --input CAPTURES --out DIR\nAndroid-run starts a fresh read-only emulator; existing devices/tabs/settings are never taken over. Phone interact/abuse is unsupported; request shots/fling explicitly for diagnostics. ios-capture is unsupported until an owned positive Safari URL/content oracle is implemented; it allocates nothing.');return;}
 if(positionals.length!==1||!['android-run','ios-capture','targets','probe','sheet'].includes(positionals[0]))throw Error('Unknown device command; see --help');
 const mode=positionals[0];
 if(mode==='ios-capture')requireIOSCaptureOracle();
 const androidPlan=mode==='android-run'?normalizeAndroidPlan(o):null;
 if(androidPlan){o.base=androidPlan.origin;o.routes=androidPlan.routes.join(',');o.parts=androidPlan.parts.join(',');console.log('[device plan] '+JSON.stringify(androidPlan));}
 const {isLocalUrl}=await import('./browser-test-lib.mjs');
 if(mode==='targets'&&(!o.cdp||!isLocalUrl(o.cdp)))throw Error('targets requires --cdp');
 if(['android-run','ios-capture'].includes(mode)&&(!o.base||!/^https?:$/.test(new URL(o.base).protocol)||!isLocalUrl(o.base)||!o.out))throw Error('Provide loopback HTTP --base and --out');
 if(mode==='android-run'&&(!o.avd||!['android-check','abuse'].includes(o.tool)))throw Error('android-run needs --avd and --tool android-check|abuse');
 if(mode==='ios-capture'&&(!o.template||!Number.isFinite(Number(o['wait-ms']))||Number(o['wait-ms'])<0||Number(o['wait-ms'])>30000))throw Error('ios-capture needs --template and finite --wait-ms0..30000');
 if(mode==='probe'&&(!o.lease||!safeSerial(o.serial)||!o.cdp||!isLocalUrl(o.cdp)||!o.url||!isLocalUrl(o.url)||!Number.isFinite(Number(o.seconds))||Number(o.seconds)<0||!Number.isFinite(Number(o.interval))||Number(o.interval)<=0))throw Error('probe needs owned --lease, exact --serial, loopback --cdp/--url and finite duration/interval');
 if(mode==='sheet'&&(!o.input||!o.out))throw Error('sheet requires --input capture-directory and --out');
 const runtime=ensureToolRuntime({name:'device '+mode,runTimeoutMs:30*60000});await runtime.ready;const session=new DeviceSession(runtime);
 try{
  if(mode==='targets'){
   const {managedConnectOverCDP}=await import('./browser-test-lib.mjs');if(!o.cdp)throw Error('targets requires --cdp');const browser=await managedConnectOverCDP(o.cdp,{runtime});try{const cdp=await browser.newBrowserCDPSession();console.log(JSON.stringify(await cdp.send('Target.getTargets'),null,2));}finally{await browser.close();}return;
  }
  if(mode==='probe'){
   const lease=await session.ownedAndroid(o.lease);if(lease.serial!==o.serial)throw Error('Requested serial differs from owned lease');
   const {managedConnectOverCDP,createGuard}=await import('./browser-test-lib.mjs'),browser=await managedConnectOverCDP(o.cdp,{runtime}),guard=createGuard({route:true});
   try{const context=await browser.newContext({viewport:null});await guard.guardContext(context);const page=await context.newPage();await page.goto(o.url,{waitUntil:'load'});const start=Date.now(),seconds=Number(o.seconds),interval=Number(o.interval)*1000;
    do{console.log(JSON.stringify({pageOwnership:'new isolated diagnostic context',elapsedMs:Date.now()-start,value:await page.evaluate(o.expression||'JSON.stringify({sy:scrollY,visibility:document.visibilityState,url:location.href})')}));if(!seconds||Date.now()-start>=seconds*1000)break;await runtime.deadline('probe sampling interval',()=>new Promise(r=>setTimeout(r,interval)),{timeoutMs:interval+1000});}while(Date.now()-start<seconds*1000);
   }finally{await browser.close();}guard.assert();return;
  }
  if(mode==='sheet'){
   const input=resolve(o.input),out=resolve(o.out);await mkdir(out,{recursive:true});let total=0;
   for(const route of ['local','optimized','optimized-taste']){const args=[],filters=[];let count=0;for(const fragment of ['top','about','work','gatherings','news','network','support']){const file=join(input,route,fragment+'.png');if(!await stat(file).then(s=>s.isFile(),()=>false))continue;args.push('-i',file);filters.push('['+count+':v]scale=360:-1,pad=iw+12:ih:6:0:white[v'+count+']');count++;}if(!count)continue;const stack=Array.from({length:count},(_,k)=>'[v'+k+']').join('')+'hstack=inputs='+count;await session.call('ffmpeg',['-loglevel','error','-y',...args,'-filter_complex',filters.join(';')+';'+stack,'-frames:v','1',join(out,'sheet-'+route+'.png')],{timeoutMs:60000});total+=count;}
   if(!total)throw Error('No source screenshots found; no sheet generated');console.log(JSON.stringify({sourceScreenshots:total,out}));return;
  }
  const out=resolve(o.out);await mkdir(out,{recursive:true});
  if(mode==='android-run'){
   const device=await session.androidStart({avd:o.avd,port:Number(o.port||5560)});await session.acquireMapping(device,{direction:'reverse',local:'tcp:'+(new URL(o.base).port||80),remote:'tcp:'+(new URL(o.base).port||80)});
   // A fresh host forward avoids the deliberate existing 9222 binding.
   const {createServer}=await import('node:net'),{listenServer,closeServer}=await import('./server-lifecycle.mjs');const reservation=createServer();await listenServer(reservation,{runtime});const port=reservation.address().port;await closeServer(reservation);await session.acquireMapping(device,{direction:'forward',local:'tcp:'+port,remote:'localabstract:chrome_devtools_remote'});
   await session.adb(device.serial,'shell','am','start','-n','com.android.chrome/com.google.android.apps.chrome.Main');
   await runtime.deadline('owned Android Chrome DevTools readiness',async signal=>{for(;;){try{const response=await fetch('http://127.0.0.1:'+port+'/json/version',{signal,redirect:'error'});if(response.ok&&(await response.json()).webSocketDebuggerUrl)return;}catch(error){if(signal.aborted)throw error;}await new Promise(r=>setTimeout(r,100));}},{timeoutMs:15000});
   const argv=o.tool==='abuse'?['tools/test-abuse.mjs','--cdp','http://127.0.0.1:'+port,'--base',o.base,'--configs','m','--route',o.routes,'--out',out]:['tools/android-check.mjs','--serial',device.serial,'--lease',device.leasePath,'--cdp','http://127.0.0.1:'+port,'--base',o.base,'--out',out,'--routes',o.routes,'--parts',o.parts];
   const result=await runtime.runCommand(process.execPath,argv,{label:'owned Android scenarios',timeoutMs:25*60000,stdio:'inherit'});if(result.status!==0)process.exitCode=result.status;
  }else throw Error('Unsupported device acquisition mode');
 }finally{await session.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{await deviceMain();}catch(error){if(error.code!=='HW_DEVICE_EVIDENCE_UNSUPPORTED')throw error;console.error(error.message);process.exitCode=error.exitCode;}}
