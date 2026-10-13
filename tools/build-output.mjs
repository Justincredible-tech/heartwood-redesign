import {lstat,mkdir,open,rename,rm,realpath} from 'node:fs/promises';
import {constants,unlinkSync,lstatSync} from 'node:fs';
import {resolve,join,dirname,parse,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

const maybeStat=async path=>{try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const identity=stat=>stat&&[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
const within=(path,root)=>path===root||path.startsWith(root+sep);
const activeTemporary=new Map();
const removeOwnTemporary=path=>{const owned=activeTemporary.get(path);if(!owned)return;try{const stat=lstatSync(path);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===owned.dev&&stat.ino===owned.ino)unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}finally{activeTemporary.delete(path);}};
process.once('exit',()=>{for(const path of activeTemporary.keys())try{removeOwnTemporary(path);}catch{}});

// An output directory is a real directory at every level. Symlink aliases are rejected,
// including aliases to source; callers may use the canonical path explicitly instead.
export async function ensureOutputDirectory(out,{root,protectedPaths=[]}={}){
 const absolute=resolve(out),canonicalRoot=root?await realpath(root):null;
 const forbidden=protectedPaths.map(path=>resolve(path));
 if(canonicalRoot&&absolute===canonicalRoot||forbidden.some(path=>within(absolute,path)))throw Error('Output would overwrite protected input: '+absolute);
 const volume=parse(absolute).root,parts=absolute.slice(volume.length).split(sep).filter(Boolean);let cursor=volume;
 for(const part of parts){cursor=join(cursor,part);let stat=await maybeStat(cursor);if(!stat){await mkdir(cursor);stat=await lstat(cursor);}if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Output directory is not a real directory: '+cursor);}
 const canonical=await realpath(absolute);
 if(canonicalRoot&&canonical===canonicalRoot||forbidden.some(path=>within(canonical,path)))throw Error('Output resolves to protected input: '+canonical);
 return canonical;
}

export async function writeOutput(out,relative,bytes){
 const target=resolve(out,relative);if(!within(target,resolve(out))||target===resolve(out))throw Error('Output path escaped its directory');
 const parent=dirname(target);await ensureOutputDirectory(parent);
 const parentBefore=await lstat(parent),before=await maybeStat(target);
 if(before&&(!before.isFile()||before.isSymbolicLink()))throw Error('Output target is not a regular file: '+target);
 const temporary=join(parent,'.heartwood-build-'+randomUUID()+'.tmp');let handle;
 try{
  handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o644);const owned=lstatSync(temporary);activeTemporary.set(temporary,{dev:owned.dev,ino:owned.ino});await handle.writeFile(bytes);await handle.close();handle=null;
  await ensureOutputDirectory(parent);
  const parentAfter=await lstat(parent),after=await maybeStat(target);
  if(parentBefore.dev!==parentAfter.dev||parentBefore.ino!==parentAfter.ino||identity(before)!==identity(after))throw Error('Output changed during build: '+target);
  await rename(temporary,target);
 }finally{await handle?.close();removeOwnTemporary(temporary);}
}

// Cleanup is restricted both by the previous manifest and these exact generated names.
export function ownedFingerprint(relative){return /^(?:(?:css\/heartwood-(?:site|taste)\.[0-9a-f]{12}\.css|js\/heartwood-(?:site|taste|taste-head)\.[0-9a-f]{12}\.js)|assets\/logos\/heartwood-logos\.[0-9a-f]{12}\.svg|assets\/grain\/grain-fine-\d+@[\d.]+x\.[0-9a-f]{12}\.webp|assets\/meta\/[a-z0-9-]+\.[0-9a-f]{12}\.(?:svg|png|jpg)|mobile\/assets\/[a-zA-Z0-9@.-]+\.[0-9a-f]{16}\.(?:avif|webp|woff2|svg|png|css|js|txt))$/.test(relative);}

export async function removeRecordedFingerprint(out,relative){
 if(!ownedFingerprint(relative))return false;
 const target=resolve(out,relative);if(!within(target,resolve(out)))throw Error('Cleanup escaped output');
 if(!await maybeStat(dirname(target)))return true;await ensureOutputDirectory(dirname(target));
 for(const suffix of['','.gz','.br']){const path=target+suffix,stat=await maybeStat(path);if(!stat)continue;if(!stat.isFile()||stat.isSymbolicLink())throw Error('Cleanup target is not a regular file: '+path);await rm(path);}
 return true;
}
