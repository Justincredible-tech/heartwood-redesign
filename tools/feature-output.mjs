import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,open,rm,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,sep} from 'node:path';
import {ownedFingerprint} from './build-output.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const routes=new Set(['heartwood-site.html','desktop-day.html','experience-entry.html',
  'taste/index.html','taste/scene.html','mobile/index.html','mobile/day.html','mobile/night.html','mobile/manifest.json']);
const safe=path=>typeof path==='string'&&path.length<1024&&path.split('/').every(part=>
  /^[A-Za-z0-9@._-]+$/.test(part)&&part!=='.'&&part!=='..');
export function isOwnedBuildPath(path,{phone=false}={}){
  const publicPath=phone?'mobile/'+path:path;
  return safe(path)&&(routes.has(publicPath)||ownedFingerprint(publicPath)
    ||/^assets\/fonts\/[A-Za-z0-9._-]+\.(?:woff2|txt)$/.test(publicPath)
    ||/^assets\/grain\/[A-Za-z0-9@._-]+\.[0-9a-f]{12,16}\.webp$/.test(publicPath));
}
async function readOwned(root,path){
  assert(safe(path),'Unsafe owned build path');
  const base=await realpath(root),target=resolve(base,path);
  assert(target.startsWith(base+sep),'Owned output escaped root');
  let cursor=base;
  for(const part of path.split('/').slice(0,-1)){
    cursor=resolve(cursor,part);
    let info;try{info=await lstat(cursor)}catch(error){if(error.code==='ENOENT')return null;throw error}
    assert(info.isDirectory()&&!info.isSymbolicLink(),'Owned output ancestor changed');
  }
  let before;try{before=await lstat(target)}catch(error){if(error.code==='ENOENT')return null;throw error}
  assert(before.isFile()&&!before.isSymbolicLink()&&before.size<=8*1024*1024,'Invalid owned output');
  const handle=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  let bytes,after;
  try{
    const opened=await handle.stat();
    assert(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino,'Owned output changed while opened');
    bytes=await handle.readFile();after=await lstat(target);
  }finally{await handle.close()}
  assert(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size
    &&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'Owned output changed while read');
  return {path,sha256:sha(bytes),bytes:bytes.length,dev:after.dev,ino:after.ino,mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs};
}
export async function capturePreviousOutputs(root,manifest,{phone=false}={}){
  if(!manifest)return [];
  const generated=phone?manifest.files?.map(row=>row.path):manifest.generated;
  assert(Array.isArray(generated)&&generated.length<=2048&&new Set(generated).size===generated.length,
    'Invalid previous generated output roster');
  const recorded=new Map((phone?manifest.files:manifest.outputs||[]).map(row=>[row.path,row]));
  const snapshot=[];
  for(const path of generated){
    assert(isOwnedBuildPath(path,{phone}),'Previous manifest claims an unowned output: '+path);
    for(const suffix of ['', '.gz','.br']){
      const row=await readOwned(root,path+suffix);
      if(!row)continue;
      const prior=recorded.get(path+suffix);
      if(prior)assert(prior.sha256===row.sha256&&prior.bytes===row.bytes,'Recorded output was edited: '+row.path);
      snapshot.push(row);
    }
  }
  // Older manifests record names only. Bootstrap those exact recognized names
  // before any writes; this never authorizes arbitrary publish-directory deletion.
  return snapshot;
}
export async function retireStaleOutputs(root,previous,current){
  const keep=new Set(current.flatMap(path=>[path,path+'.gz',path+'.br']));
  const removed=[];
  for(const pinned of previous){
    if(keep.has(pinned.path))continue;
    const now=await readOwned(root,pinned.path);
    if(!now)continue; // The nested phone builder may have retired the same owned path.
    assert(now.sha256===pinned.sha256&&now.bytes===pinned.bytes&&now.dev===pinned.dev&&now.ino===pinned.ino,
      'Stale output changed; refusing removal: '+pinned.path);
    const last=await lstat(resolve(root,pinned.path));
    assert(last.isFile()&&!last.isSymbolicLink()&&last.dev===now.dev&&last.ino===now.ino
      &&last.size===now.bytes&&last.mtimeMs===now.mtimeMs&&last.ctimeMs===now.ctimeMs,
      'Stale output changed before removal: '+pinned.path);
    await rm(resolve(root,pinned.path));removed.push(pinned.path);
  }
  return removed;
}
export async function captureGeneratedOutputs(root,paths){
  assert(Array.isArray(paths)&&paths.length>0&&paths.length<=2048&&new Set(paths).size===paths.length,
    'Invalid generated output roster');
  const rows=[];
  for(const path of paths){
    assert(isOwnedBuildPath(path),'Build claims an unowned output: '+path);
    const row=await readOwned(root,path);assert(row,'Generated output missing: '+path);
    rows.push({path,bytes:row.bytes,sha256:row.sha256});
  }
  return rows;
}
export function verifyFeatureClosure(manifest){
  const {features,generated}=manifest;
  assert(features&&Array.isArray(generated),'Feature manifest missing');
  assert(['night','phone','treeEffects','networkEffects'].every(key=>typeof features[key]==='boolean'),
    'Invalid feature policy');
  if(!features.phone)assert(!generated.some(path=>path.startsWith('mobile/')),'Excluded phone output emitted');
  if(!features.night)assert(!generated.includes('mobile/night.html')
    &&!generated.some(path=>/mobile\/assets\/[^/]*-night(?:@|\.)/.test(path)),'Excluded night output emitted');
  for(const route of ['heartwood-site.html','desktop-day.html','experience-entry.html','taste/index.html','taste/scene.html'])
    assert(generated.includes(route),'Required route omitted: '+route);
  if(features.phone){for(const route of ['mobile/index.html','mobile/day.html','mobile/manifest.json'])
    assert(generated.includes(route),'Phone route omitted: '+route)}
  if(features.phone&&features.night)assert(generated.includes('mobile/night.html'),'Night phone route omitted');
  return true;
}
