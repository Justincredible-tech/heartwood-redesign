/** Owned Node-only subprocess/temp operations. Importing is inert. */
import {ensureToolRuntime,validateTimerBudget} from './tool-runtime.mjs';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {Script} from 'node:vm';
import {commandCleanupProblems} from './command-acceptance.mjs';
export async function ownedTemp(prefix,{runtime,...options}={}){
  const rt=runtime||ensureToolRuntime();return rt.tempDir(prefix,options);
}
export async function runChecked(command,args,{runtime,...options}={}){
  const rt=runtime||ensureToolRuntime();
  const result=await rt.runCommand(command,args,{timeoutMs:300000,...options});
  const cleanupProblems=commandCleanupProblems(result);
  if(result.status!==0||cleanupProblems.length){const error=Error(result.stderr||result.stdout||`${command} failed with exit ${result.status}; ${cleanupProblems.join('; ')}`);Object.assign(error,{code:result.status||1,stdout:result.stdout,stderr:result.stderr,timedOut:result.timedOut});throw error;}
  return result;
}

/** Bounded local text/script input; descriptor identity prevents stat/open FIFO races.
 * Default8MiB comfortably covers current1.1MiB source HTML and0.36MiB DR script.
 * Script validation compiles syntax only: it never executes the input.
 */
export async function readRegularInput(path,{runtime,timeoutMs=10000,maxBytes=8*1024*1024,syntax,encoding='utf8',allowEmpty=false}={}){
 if(typeof path!=='string'||!path.trim())throw Error('Input path must be nonempty');
 validateTimerBudget('input timeoutMs',timeoutMs);
 if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('Input maxBytes must be a positive safe integer');
 if(syntax!==undefined&&syntax!=='script')throw Error('Unknown input syntax validation');
 if(typeof allowEmpty!=='boolean')throw Error('Input allowEmpty must be boolean');
 if(encoding!==null&&encoding!=='utf8')throw Error('Input encoding must be utf8 or null');
 const rt=runtime||ensureToolRuntime();await rt.ready;
 return rt.deadline('read regular input '+path,async signal=>{
  if(signal.aborted)throw signal.reason;
  const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);let closing;
  const close=()=>closing||=(handle.close()),unregister=rt.onCleanup('close input '+path,close);
  try{
   if(signal.aborted)throw signal.reason;
   const before=await handle.stat();if(!before.isFile())throw Error('Input must be a regular file: '+path);
   if(!Number.isSafeInteger(before.size)||before.size<(allowEmpty?0:1)||before.size>maxBytes)throw Error('Input must contain'+(allowEmpty?'0':'1')+'..'+maxBytes+' bytes: '+path);
   const chunks=[];let size=0;
   while(true){if(signal.aborted)throw signal.reason;const buffer=Buffer.allocUnsafe(Math.min(65536,maxBytes-size+1)),{bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>maxBytes)throw Error('Input exceeds '+maxBytes+' bytes: '+path);chunks.push(buffer.subarray(0,bytesRead));}
   const after=await handle.stat();if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Input changed while reading: '+path);
   const bytes=Buffer.concat(chunks,size),text=bytes.toString('utf8');if(syntax==='script')new Script(text,{filename:path});return encoding===null?bytes:text;
  }finally{try{await close();}finally{unregister();}}
 },{timeoutMs});
}
