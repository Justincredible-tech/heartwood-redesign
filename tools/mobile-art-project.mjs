// Inert standard-library project alignment; no source parsing, allocation or native imports.
import assert from 'node:assert/strict';
import {realpath,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
const bounded=async(label,operation)=>{let timer;try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded5000ms')),5000);})]);}finally{clearTimeout(timer);}};
export async function requireCoLocatedArtProject(selectedRoot,{executingRoot}={}){
 for(const [name,value]of [['selected project root',selectedRoot],['executing project root',executingRoot]])assert(typeof value==='string'&&value.trim()&&value.length<=4096,name+' must be a nonempty local path');
 const [selected,executing]=await bounded('canonical optional art project admission',()=>Promise.all([realpath(resolve(selectedRoot)),realpath(resolve(executingRoot))]));
 if(selected!==executing){const error=Error('DIFFERENT_ART_PROJECT: optional art must run from the selected project’s own public tools; --root must resolve to the executing tools project until target-module loading is implemented');error.code='HW_ART_DIFFERENT_PROJECT';throw error;}
 const info=await bounded('validate canonical optional art project',()=>lstat(executing));assert(info.isDirectory()&&!info.isSymbolicLink(),'Executing optional art project must be a canonical directory');return executing;
}
