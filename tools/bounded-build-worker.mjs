import {workerData,parentPort,isMainThread} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {realpath} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {admitBoundedResult} from './bounded-build-result.mjs';
export {admitBoundedResult} from './bounded-build-result.mjs';
if(!isMainThread){
 assert(parentPort&&workerData?.entry&&workerData?.method,'Bounded build worker requires parent data');
 let sequence=0;const waiting=new Map();parentPort.on('message',message=>{const item=waiting.get(message.id);if(!item)return;waiting.delete(message.id);if(message.error)item.reject(Error(message.error));else item.resolve();});
 const writer=(out,path,bytes)=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});parentPort.postMessage({type:'write',id,out,path,bytes});});
 try{parentPort.postMessage({type:'step',step:'import public composer'});const module=await import(workerData.entry);assert(typeof module[workerData.method]==='function','Missing bounded build entry');parentPort.postMessage({type:'step',step:'compose sources, art and pages'});const args=[...(workerData.args||[])];if(workerData.useWriter)args[0]={...args[0],writer};const result=await module[workerData.method](...args);parentPort.postMessage({type:'result',result:admitBoundedResult(workerData.method,result)});}
 catch(error){parentPort.postMessage({type:'failure',message:error.message,stack:error.stack});}
 finally{parentPort.close();}
}

if(isMainThread&&(import.meta.main??(process.argv[1]&&import.meta.url===pathToFileURL(await realpath(resolve(process.argv[1]))).href)))throw Error('Bounded build Worker CLI UNSUPPORTED: dedicated parent Worker data is required');
