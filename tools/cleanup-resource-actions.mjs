// Typed external-resource cleanup. Importing is inert; only exact run-owned
// device IDs/endpoints are actionable. Unknown state is a failure, never a guess.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_.:@/-]+$/.test(value);
export function parseADBMappings(text){return String(text).trim().split(/\r?\n/).filter(Boolean).map(line=>{const cells=line.trim().split(/\s+/);if(cells.length!==3)throw Error('Unrecognised ADB mapping response');const [serial,local,remote]=cells;return {serial,local,remote};});}
export function flattenSimulators(list){if(!list||!list.devices||Array.isArray(list.devices))throw Error('Unrecognised simulator inventory');return Object.entries(list.devices).flatMap(([runtime,devices])=>{if(!Array.isArray(devices))throw Error('Unrecognised simulator inventory');return devices.map(d=>({...d,runtime}));});}
function owner(resource,run){if(!resource||!run||!run.token||resource.token!==run.token)throw Error('Resource ownership belongs to a different run');if(resource.preexisting!==false)throw Error('Refusing preexisting or unknown resource ownership');}
export function planResourceCleanup(resource,state,{run}={}){
 owner(resource,run);
 if(['android-forward','android-reverse'].includes(resource.kind)){
  if(!safe(resource.serial)||!safe(resource.local)||!safe(resource.remote)||!resource.bootId||!Array.isArray(state.mappings))throw Error('Incomplete Android resource ownership');
  const matches=state.mappings.filter(m=>m.serial===resource.serial&&m.local===resource.local);if(!matches.length)return [];
  if(matches.length!==1||matches[0].remote!==resource.remote)throw Error('Android mapping changed; refusing deletion');
  if(state.bootId!==resource.bootId)throw Error('Android reboot/ownership changed; refusing deletion');
  return [{command:'adb',args:['-s',resource.serial,resource.kind==='android-forward'?'forward':'reverse','--remove',resource.local]}];
 }
 if(resource.kind==='ios-device'){
  if(resource.createdByRun!==true||typeof resource.name!=='string'||resource.name!=='heartwood-'+run.token||!Array.isArray(state.devices))throw Error('Incomplete simulator ownership');
  const matches=state.devices.filter(d=>resource.udid?d.udid===resource.udid:d.name===resource.name);if(!matches.length)return [];
  if(matches.length!==1)throw Error('Simulator identity/ownership changed');const d=matches[0];
  if(d.name!==resource.name||d.deviceTypeIdentifier!==resource.deviceType||d.runtime!==resource.runtime||!safe(d.udid))throw Error('Simulator identity/ownership changed');
  if(!['Booted','Shutdown'].includes(d.state))throw Error('Simulator state changed; refusing destructive cleanup');
  return [...(d.state==='Booted'?[{command:'xcrun',args:['simctl','shutdown',d.udid]}]:[]),{command:'xcrun',args:['simctl','delete',d.udid]}];
 }
 if(resource.kind==='android-emulator'){
  // The native process ledger owns termination. No adb-wide emulator stop,
  // force-stop of Chrome, shared settings restore or borrowed-device cleanup.
  if(resource.createdByRun!==true||!safe(resource.serial)||!resource.processBirth)throw Error('Incomplete emulator ownership');return [];
 }
 throw Error('Unsupported typed resource cleanup '+resource.kind);
}
export async function cleanupOwnedResource(resource,{run,signal,deadlineAt,remainingMs,command}={}){
 const remaining=()=>typeof remainingMs==='function'?remainingMs():Number.isFinite(deadlineAt)?deadlineAt-Date.now():5000;
 const call=async(cmd,args)=>{if(signal?.aborted)throw signal.reason||Error('Cleanup cancelled');const left=remaining();if(!Number.isFinite(left)||left<=0)throw Error('Aggregate cleanup deadline expired');const options={timeoutMs:Math.max(1,Math.min(5000,left)),signal};if(command)return command(cmd,args,options);const expanded=cmd==='adb'?['-H','127.0.0.1','-P',String(resource.serverPort||5037),...args]:args;const result=await execute(cmd,expanded,{timeout:options.timeoutMs,signal,killSignal:'SIGKILL',env:{...process.env,HW_TOOL_RUN_TOKEN:run.token,HW_TOOL_SCOPE_TOKEN:resource.scopeToken||run.token},maxBuffer:4*1024*1024,encoding:'utf8'});return result.stdout;};
 owner(resource,run);let state={};
 if(['android-forward','android-reverse'].includes(resource.kind)&&(!safe(resource.serial)||!safe(resource.local)||!safe(resource.remote)||!resource.bootId))throw Error('Incomplete Android resource ownership; no command executed');
 if(['android-forward','android-reverse'].includes(resource.kind)){
  const direction=resource.kind==='android-forward'?'forward':'reverse';
  state.mappings=parseADBMappings(await call('adb',['-s',resource.serial,direction,'--list']));
  if(direction==='reverse')state.mappings=state.mappings.map(m=>({...m,transport:m.serial,serial:resource.serial}));
  // adb reverse --list returns transport serial (not a global device listing).
  if(state.mappings.some(m=>m.serial===resource.serial&&m.local===resource.local))state.bootId=String(await call('adb',['-s',resource.serial,'shell','cat','/proc/sys/kernel/random/boot_id'])).trim();
 }else if(resource.kind==='ios-device')state.devices=flattenSimulators(JSON.parse(await call('xcrun',['simctl','list','devices','--json'])));
 const actions=planResourceCleanup(resource,state,{run});for(const action of actions)await call(action.command,action.args);return {actions,resourceId:resource.resourceId||null};
}
