import assert from 'node:assert/strict';
import {lstat,realpath,opendir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,basename,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {readRegularInput} from './tool-operations.mjs';
export const ART_PINS={sharp:'0.35.5','playwright-core':'1.64.0'};
export const artHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const epochs=new WeakMap(),incarnation=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
function registry(runtime){let state=epochs.get(runtime);if(!state){state={files:new Map(),directories:new Map(),ancestors:new Map()};epochs.set(runtime,state);}return state;}
async function recordAncestors(runtime,path){
 const state=registry(runtime);let cursor=dirname(path);
 for(let depth=0;depth<128;depth++){if(state.ancestors.has(cursor))return;const info=await lstat(cursor,{bigint:true});assert(info.isDirectory()&&!info.isSymbolicLink(),'Toolchain ancestor must be a real directory');state.ancestors.set(cursor,{dev:info.dev,ino:info.ino});const next=dirname(cursor);if(next===cursor)return;cursor=next;}
 throw Error('Toolchain ancestor depth exceeds128');
}
export async function recordArtDirectoryEpoch(runtime,path,names){
 assert(Array.isArray(names)&&names.length<=16000&&names.every(n=>typeof n==='string'&&!n.includes('/')),'Bounded package entry names required');
 const info=await lstat(path,{bigint:true});assert(info.isDirectory()&&!info.isSymbolicLink(),'Package directory must be real');const state=registry(runtime),value={identity:incarnation(info),names:[...names].sort()};
 const prior=state.directories.get(path);assert(!prior||JSON.stringify(prior)===JSON.stringify(value),'Package directory epoch changed during admission');state.directories.set(path,value);
}
export async function hashToolFile(runtime,path,{maxBytes=512*1024*1024}={}){
 return fingerprint(runtime,path,{maxBytes,record:true});
}
async function fingerprint(runtime,path,{maxBytes,record}){
 if(record)await recordAncestors(runtime,path);
 return runtime.deadline('fingerprint local toolchain '+basename(path),async signal=>{
  const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW||0));let closing,unregister=()=>{};const close=()=>closing??=handle.close();
  try{unregister=runtime.onCleanup('close toolchain input '+basename(path),close);const before=await handle.stat({bigint:true});assert(before.isFile()&&before.size<=BigInt(maxBytes),'Toolchain input must be bounded regular data');
   const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let total=0;for(;;){if(signal.aborted)throw signal.reason;const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;assert(total<=maxBytes,'Toolchain file exceeds ceiling');hash.update(buffer.subarray(0,bytesRead));}
   const after=await handle.stat({bigint:true}),pathInfo=await lstat(path,{bigint:true});assert(BigInt(total)===before.size&&incarnation(after)===incarnation(before)&&pathInfo.isFile()&&!pathInfo.isSymbolicLink()&&incarnation(pathInfo)===incarnation(before),'Toolchain input changed while fingerprinting');const value={bytes:total,sha256:hash.digest('hex')},state=registry(runtime),observed={identity:incarnation(before),...value,maxBytes},prior=state.files.get(path);assert(!prior||prior.identity===observed.identity&&prior.bytes===observed.bytes&&prior.sha256===observed.sha256,'Toolchain file epoch changed: '+basename(path));if(record)state.files.set(path,observed);return value;
  }finally{try{await close();}finally{unregister();}}
 },{timeoutMs:10000});
}
export async function verifyArtToolchainEpoch(runtime){
 const state=registry(runtime);assert(state.files.size>0,'No recorded toolchain file epochs');
 return runtime.deadline('verify final recorded art toolchain disk epoch',async signal=>{
  const ancestors=async()=>{for(const [path,before]of state.ancestors){if(signal.aborted)throw signal.reason;const now=await lstat(path,{bigint:true});assert(now.isDirectory()&&!now.isSymbolicLink()&&now.dev===before.dev&&now.ino===before.ino,'Toolchain ancestor epoch changed');}};
  const directories=async(census)=>{for(const [path,before]of state.directories){if(signal.aborted)throw signal.reason;const now=await lstat(path,{bigint:true});assert(now.isDirectory()&&!now.isSymbolicLink()&&incarnation(now)===before.identity,'Toolchain directory epoch changed');if(!census)continue;const directory=await opendir(path,{bufferSize:16}),names=[];let closing;const close=()=>closing??=directory.close(),unregister=runtime.onCleanup('close final package epoch census',close);try{for(;;){if(signal.aborted)throw signal.reason;const entry=await directory.read();if(!entry)break;assert(names.length<16000,'Package directory entry ceiling exceeded');names.push(entry.name);}}finally{try{await close();}finally{unregister();}}assert(JSON.stringify(names.sort())===JSON.stringify(before.names),'Toolchain directory entry epoch changed');}};
  await ancestors();await directories(true);
  for(const [path,before]of state.files){if(signal.aborted)throw signal.reason;const now=await lstat(path,{bigint:true});assert(now.isFile()&&!now.isSymbolicLink()&&incarnation(now)===before.identity,'Toolchain file epoch changed: '+basename(path));await fingerprint(runtime,path,{maxBytes:before.maxBytes,record:false});}
  // File streaming can be the longest part: re-pin paths after it. Unchanged
  // directory incarnation lets us reuse its already checked finite name census.
  for(const [path,before]of state.files){if(signal.aborted)throw signal.reason;const now=await lstat(path,{bigint:true});assert(now.isFile()&&!now.isSymbolicLink()&&incarnation(now)===before.identity,'Toolchain file epoch changed after hash pass: '+basename(path));}
  await directories(false);await ancestors();
  return {status:'MATCHED_AFTER_OPERATION',files:state.files.size,packageDirectories:state.directories.size,scope:'Recorded disk files, incarnations, hashes and package entry census only; pre-entry module/OS/GPU execution closure unproved'};
 },{timeoutMs:30000});
}
async function metadataAt(runtime,root,name){
 const path=join(root,'package.json'),bytes=await readRegularInput(path,{runtime,maxBytes:65536}),observed=await hashToolFile(runtime,path,{maxBytes:65536}),metadata=JSON.parse(bytes);assert(observed.sha256===artHash(bytes),'Package metadata changed during admission');assert(metadata.name===name&&typeof metadata.version==='string','Optional package metadata does not match '+name);return {name,version:metadata.version,root,metadata,metadataSha256:artHash(bytes)};
}
export async function admitArtPackage(runtime,name,path){
 const entry=await realpath(path);assert((await lstat(entry)).isFile(),'Optional module entry must be a regular file');let cursor=dirname(entry);
 for(let depth=0;depth<12;depth++){try{const bytes=await readRegularInput(join(cursor,'package.json'),{runtime,maxBytes:65536}),metadata=JSON.parse(bytes);if(metadata.name===name){assert(metadata.version===ART_PINS[name],'Unreviewed optional package version');return {...await metadataAt(runtime,cursor,name),entry,entryRelative:relative(cursor,entry)};}}catch(e){if(e.code!=='ENOENT')throw e;}const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;}
 throw Error('Optional module does not belong to pinned '+name);
}
async function dependency(runtime,input,name,optional){
 assert(/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(name),'Invalid installed dependency name');let cursor=input.root;
 for(let depth=0;depth<16;depth++){
  const path=join(cursor,'node_modules',name);try{const info=await lstat(path);assert(info.isDirectory()&&!info.isSymbolicLink(),'Installed dependency must be a real directory');return await metadataAt(runtime,path,name);}catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;
 }
 if(!optional)throw Error('Missing required installed dependency '+name);return null;
}
export async function recordArtPackages(runtime,selected,{lockPath,overrides}){
 const lockBytes=await readRegularInput(lockPath,{runtime}),lock=JSON.parse(lockBytes),observedLock=await hashToolFile(runtime,lockPath,{maxBytes:8*1024*1024});assert(observedLock.sha256===artHash(lockBytes),'Optional lock changed during admission');assert(lock.lockfileVersion===3&&lock.packages,'Optional tool lock is incomplete');
 const locked=Object.values(lock.packages),seen=new Set(),receipts=[];let count=0,bytes=0;
 const visit=async(input,selection)=>{
  if(seen.has(input.root))return;assert(seen.size<64,'Optional dependency closure exceeds64packages');seen.add(input.root);
  assert(locked.some(row=>row.version===input.version&&(row.resolved||'').includes('/'+input.name.split('/').at(-1)+'-')),'Installed dependency version has no exact reviewed lock record: '+input.name+'@'+input.version);
  const files=[];
  const walk=async(path,prefix='',depth=0)=>{
   assert(depth<=24,'Optional package directory depth exceeds24');const directory=await opendir(path,{bufferSize:16});let closing,unregister=()=>{};const close=()=>closing??=directory.close();
   const names=[];try{unregister=runtime.onCleanup('close package inventory '+input.name,close);for(;;){if(runtime.signal.aborted)throw runtime.signal.reason;const entry=await directory.read();if(!entry)break;names.push(entry.name);assert(++count<=16000,'Optional package entry ceiling exceeded');const logical=prefix+entry.name,absolute=join(path,entry.name),info=await lstat(absolute);assert(!info.isSymbolicLink(),'Optional package has unrecorded symlink '+logical);
    if(info.isDirectory()){if(entry.name!=='node_modules')await walk(absolute,logical+'/',depth+1);}
    else{assert(info.isFile(),'Optional package contains a special file');assert(bytes+info.size<=512*1024*1024,'Optional package byte ceiling exceeded');const digest=await hashToolFile(runtime,absolute);bytes+=digest.bytes;files.push({path:logical,...digest});}
   }await recordArtDirectoryEpoch(runtime,path,names);}finally{try{await close();}finally{unregister();}}
  };
  await runtime.deadline('record exact package '+input.name,()=>walk(input.root),{timeoutMs:30000});
  receipts.push({name:input.name,version:input.version,selection,metadataSha256:input.metadataSha256,files:files.sort((a,b)=>a.path.localeCompare(b.path))});
  for(const [name]of Object.entries(input.metadata.dependencies||{}))await visit(await dependency(runtime,input,name,false),'installed-transitive');
  for(const [name]of Object.entries(input.metadata.optionalDependencies||{})){const found=await dependency(runtime,input,name,true);if(found)await visit(found,'installed-optional-native');}
 };
 for(const input of Object.values(selected))await visit(input,overrides[input.name]?'explicit-override':'public-optional-package');return receipts.sort((a,b)=>a.name.localeCompare(b.name));
}
