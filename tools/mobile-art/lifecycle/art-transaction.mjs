// Narrow mobile-art directory transaction. Every action is inode/marker bound;
// filesystem state, rather than the last journal phase, closes rename windows.
import assert from 'node:assert/strict';
import {lstat,realpath,opendir,open,rm,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';

import {permissionMode,permissionDigest,assertSupportedArtPermissions} from '../../mobile-art-integrity.mjs';

export const artDigest=rows=>createHash('sha256').update(rows.map(r=>r.path+':'+r.sha256).sort().join('\n')).digest('hex');
const own=(info,identity)=>!!info&&info.isDirectory()&&!info.isSymbolicLink()&&info.dev===identity.dev&&info.ino===identity.ino;
const safePath=p=>typeof p==='string'&&p.length>0&&p.length<1024&&!/[\\\x00-\x1f\x7f]/.test(p)&&p.split('/').every(v=>v&&v!=='.'&&v!=='..');
const assertActive=({signal,deadlineAt}={})=>{if(signal?.aborted)throw signal.reason||Error('art recovery cancelled');if(Number.isFinite(deadlineAt)&&Date.now()>=deadlineAt)throw Error('art recovery deadline expired');};
const stat=async path=>{try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const identity=i=>i&&({dev:i.dev,ino:i.ino});
const execute=promisify(execFile);
export function validateArtDescriptor(d,{projectRoot,ownership}={}){
 assert(d&&d.schema===1&&d.type==='mobile-art-directory','Invalid art transaction schema');
 const parent=resolve(projectRoot,'source/mobile');assert(d.parent?.path===parent&&d.sourcePath===join(parent,'art'),'Art transaction source must bind the selected project');
 const suffix=d.stagePath?.slice((parent+'/.art-stage-').length);
 assert(typeof suffix==='string'&&/^[a-f0-9-]{36}$/.test(suffix)&&d.stagePath===join(parent,'.art-stage-'+suffix)&&d.backupPath===join(parent,'.art-backup-'+suffix),'Art transaction paths must be exact unique siblings');
 for(const record of [d.parent,d.old,d.new])assert(Number.isSafeInteger(record?.dev)&&Number.isSafeInteger(record?.ino)&&record.dev>=0&&record.ino>0,'Art transaction lacks directory identity');
 for(const record of [d.old,d.new]){
  assert(Array.isArray(record.files)&&record.files.length>0&&record.files.length<=2048,'Art transaction lacks bounded file census');let bytes=0;const names=new Set();
  for(const row of record.files){assert(safePath(row.path)&&row.path!=='.hw-tool-owner'&&!names.has(row.path)&&Number.isInteger(row.bytes)&&row.bytes>=0&&row.bytes<=8*1024*1024&&/^[a-f0-9]{64}$/.test(row.sha256||''),'Invalid art transaction file row');names.add(row.path);bytes+=row.bytes;}
  assert(bytes<=64*1024*1024&&record.digest===artDigest(record.files),'Art transaction file digest changed');
  assert(record.permissionDigest===permissionDigest(record),'Art transaction permission digest changed');assertSupportedArtPermissions(record);
  assert(Array.isArray(record.directories)&&record.directories.length<=2048,'Art transaction lacks bounded complete directory census');const directories=new Set();for(const path of record.directories){assert(safePath(path)&&!directories.has(path),'Invalid/duplicate art directory row');directories.add(path);}
 }
 assert(d.old.dev!==d.new.dev||d.old.ino!==d.new.ino,'Original and new art must be distinct directories');
 assert(ownership?.path===d.stagePath&&ownership.dev===d.new.dev&&ownership.ino===d.new.ino&&typeof ownership.token==='string'&&typeof ownership.resourceId==='string','Art transaction lacks authenticated stage ownership');
 assert(Array.isArray(d.sourceInputRows)&&d.sourceInputRows.length>0&&d.sourceInputRows.length<=2048,'Art transaction lacks source receipt');const sourceNames=new Set();
 for(const row of d.sourceInputRows){assert(row.origin==='project'&&safePath(row.path)&&!sourceNames.has(row.path)&&Number.isInteger(row.bytes)&&row.bytes>0&&row.bytes<=8*1024*1024&&/^[a-f0-9]{64}$/.test(row.sha256||''),'Invalid art source receipt row');sourceNames.add(row.path);}
 return d;
}
async function markerAt(path,ownership,options){
 assertActive(options);const file=join(path,'.hw-tool-owner'),info=await lstat(file);assert(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=4096,'Invalid art ownership marker');
 const handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW||0));try{const before=await handle.stat();assert(before.isFile()&&before.dev===info.dev&&before.ino===info.ino&&before.size===info.size,'Art marker changed before open');const bytes=Buffer.alloc(before.size+1);let offset=0;while(offset<bytes.length){assertActive(options);const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}const after=await handle.stat();assert(offset===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'Art marker changed while reading');const m=JSON.parse(bytes.subarray(0,offset));assert(m.token===ownership.token&&m.resourceId===ownership.resourceId,'Art stage ownership changed');return {path:file,...identity(before)};}finally{await handle.close();}
}
export async function censusArtTree(path,{ownership,...options}={}){
 assertActive(options);const first=await lstat(path);assert(first.isDirectory()&&!first.isSymbolicLink()&&await realpath(path)===path,'Art directory must be canonical and real');
 const rows=[],directories=[],directoryModes=[],visited=[];let bytes=0,entries=0;
 const walk=async(folder,depth)=>{
  assertActive(options);assert(depth<=4,'Art census depth exceeds4');const before=await lstat(folder);assert(before.isDirectory()&&!before.isSymbolicLink(),'Art census ancestor changed to non-directory');visited.push({path:folder,dev:before.dev,ino:before.ino,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs});const directory=await opendir(folder,{bufferSize:16});
  try{for(;;){assertActive(options);const entry=await directory.read();if(!entry)break;assert(++entries<=4096,'Art census entry ceiling exceeded');const file=join(folder,entry.name),logical=relative(path,file).split(sep).join('/'),info=await lstat(file);assert(safePath(logical)&&!info.isSymbolicLink(),'Art census has unsafe path or symlink');
   if(info.isDirectory()){assert(directories.length<2048,'Art directory ceiling exceeded');directories.push(logical);directoryModes.push({path:logical,mode:permissionMode(info.mode),dev:info.dev,ino:info.ino});await walk(file,depth+1);continue;}assert(info.isFile()&&info.size>=0&&info.size<=8*1024*1024,'Art census file is not bounded regular data');
   if(logical==='.hw-tool-owner'&&ownership){assert(own(first,ownership),'Art stage inode changed');await markerAt(path,ownership,options);continue;}
   assert(logical!=='.hw-tool-owner','Unexpected ownership marker in author art');assert(rows.length<2048&&bytes+info.size<=64*1024*1024,'Art census file/byte ceiling exceeded');
   const handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW||0));try{const before=await handle.stat();assert(before.isFile()&&before.dev===info.dev&&before.ino===info.ino&&before.size===info.size,'Art input changed before open');const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let total=0;
    for(;;){assertActive(options);const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;assert(total<=before.size,'Art input grew while reading');hash.update(buffer.subarray(0,bytesRead));}
    const after=await handle.stat(),now=await lstat(file);assert(total===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&now.dev===before.dev&&now.ino===before.ino,'Art input changed while reading');bytes+=total;rows.push({path:logical,bytes:total,sha256:hash.digest('hex'),mode:permissionMode(before.mode),dev:before.dev,ino:before.ino});
   }finally{await handle.close();}
  }}finally{await directory.close();}
 };
 await walk(path,0);for(const record of visited){assertActive(options);const current=await lstat(record.path);assert(own(current,record)&&current.mtimeMs===record.mtimeMs&&current.ctimeMs===record.ctimeMs,'Art census ancestor changed during read');}const last=await lstat(path);assert(rows.length>0&&own(last,first),'Art census directory changed');rows.sort((a,b)=>a.path.localeCompare(b.path));directories.sort();directoryModes.sort((a,b)=>a.path.localeCompare(b.path));const record={...identity(last),rootMode:permissionMode(last.mode),files:rows,directories,directoryModes,digest:artDigest(rows)};return {...record,permissionDigest:permissionDigest(record)};
}
const fullMatch=(census,expected)=>{const rows=new Map(expected.files.map(row=>[row.path,row])),directories=new Set(expected.directories);return census.permissionDigest===expected.permissionDigest&&census.rootMode===expected.rootMode&&census.digest===expected.digest&&census.files.length===expected.files.length&&census.files.every(row=>rows.get(row.path)?.bytes===row.bytes&&rows.get(row.path)?.sha256===row.sha256)&&census.directories.length===directories.size&&census.directories.every(path=>directories.has(path));};
async function checkParent(d,options){assertActive(options);const p=await lstat(d.parent.path);assert(own(p,d.parent)&&await realpath(d.parent.path)===d.parent.path,'Art parent ownership changed; preserved');}
async function removeStage(path,d,options){const info=await stat(path);if(!info)return;assert(own(info,d.new),'Art stage inode changed; preserved');await markerAt(path,d.ownership,options);await checkParent(d,options);assert(own(await lstat(path),d.new),'Art stage changed before removal');await rm(path,{recursive:true,force:false});}
export async function verifyPreparedArt(d,options){
 await checkParent(d,options);assert(await stat(d.backupPath)===null,'Art backup path already exists');
 assert(own(await lstat(d.sourcePath),d.old)&&own(await lstat(d.stagePath),d.new),'Art source/stage inode changed before registration');
 assert(fullMatch(await censusArtTree(d.sourcePath,options),d.old),'Author art bytes changed before registration');
 assert(fullMatch(await censusArtTree(d.stagePath,{...options,ownership:d.ownership}),d.new),'Prepared art bytes changed before registration');
}
export async function restoreArtDirectory(d,{run,...options}={}){
 assertActive(options);assert(typeof run?.helper?.binary==='string'&&run.helper.binary.startsWith('/')&&typeof run.token==='string','Art restore requires the authenticated native owner helper');await checkParent(d,options);assert(own(await lstat(d.backupPath),d.old),'Art restore backup incarnation changed; preserved');
 const remaining=Number.isFinite(options.deadlineAt)?options.deadlineAt-Date.now():3000;assert(remaining>0,'Art restore deadline expired');
 await execute(run.helper.binary,['--move-directory-no-replace',d.backupPath,d.sourcePath,String(d.old.dev),String(d.old.ino),String(d.parent.dev),String(d.parent.ino),run.token],{timeout:Math.max(1,Math.min(3000,remaining)),signal:options.signal,killSignal:'SIGKILL',maxBuffer:65536,encoding:'utf8',env:{...process.env,HW_TOOL_RUN_TOKEN:run.token,HW_TOOL_SCOPE_TOKEN:run.token+'/art-recovery'}});
 assertActive(options);await checkParent(d,options);assert(own(await lstat(d.sourcePath),d.old)&&await stat(d.backupPath)===null,'Art restore locations changed; all directories preserved');
}
export async function recoverArtTransaction(d,{run,...options}={}){
 assert(d?.token===run?.token&&d.ownership?.token===run.token&&d.kind==='mobile-art-directory','Art recovery ownership mismatch');
 validateArtDescriptor(d,{projectRoot:d.projectRoot,ownership:d.ownership});await checkParent(d,options);
 const source=await stat(d.sourcePath),stage=await stat(d.stagePath),backup=await stat(d.backupPath);
 // A crash may follow either rename but precede its phase update. Inodes are
 // authoritative; changed author bytes are never deleted to repair a journal.
 if(own(source,d.old)&&!backup){assert(!stage||own(stage,d.new),'Unexpected art stage preserved');await removeStage(d.stagePath,d,options);return {state:'ORIGINAL_PRESERVED'};}
 if(!source&&own(backup,d.old)){
  assert(!stage||own(stage,d.new),'Unexpected art stage preserved');await checkParent(d,options);assert(await stat(d.sourcePath)===null&&own(await lstat(d.backupPath),d.old),'Art restore locations changed; preserved');
  await restoreArtDirectory(d,{run,...options});await removeStage(d.stagePath,d,options);return {state:'ORIGINAL_RESTORED',authorEditsPreserved:true};
 }
 if(own(source,d.new)&&!stage){
  assert(fullMatch(await censusArtTree(d.sourcePath,{...options,ownership:d.ownership}),d.new),'Promoted art changed; all directories preserved');
  if(backup){assert(own(backup,d.old),'Author backup inode changed; preserved');assert(fullMatch(await censusArtTree(d.backupPath,options),d.old),'Author backup bytes changed; preserved');await checkParent(d,options);assert(own(await lstat(d.sourcePath),d.new)&&own(await lstat(d.backupPath),d.old),'Art locations changed before backup cleanup');await rm(d.backupPath,{recursive:true,force:false});}
  // Completion is coherent before removing the marker. Already absent marker
  // after a guardian's completed commit is handled by the released record.
  const markerInfo=await stat(join(d.sourcePath,'.hw-tool-owner'));
  if(markerInfo){const marker=await markerAt(d.sourcePath,d.ownership,options);await checkParent(d,options);const now=await lstat(marker.path);assert(now.dev===marker.dev&&now.ino===marker.ino&&own(await lstat(d.sourcePath),d.new),'Promoted marker changed; preserved');await unlink(marker.path);}
  return {state:'NEW_ART_PRESERVED'};
 }
 throw Error('Art transaction locations changed or incoherent; all author/foreign directories preserved');
}
