// Chromium on macOS can create a process-singleton Unix socket outside TMPDIR.
// Adopt only a directory proved by the fresh owned profile and native process.
import {lstatSync,readlinkSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {inspectProcess} from './tool-runtime.mjs';

export function singletonProof(profile,read={lstat:lstatSync,readlink:readlinkSync,readdir:readdirSync}){
 const socketLink=join(profile,'SingletonSocket');let link;
 try{link=read.lstat(socketLink);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!link.isSymbolicLink())throw Error('UNSUPPORTED: profile SingletonSocket is not a symlink');
 const socket=resolve(profile,read.readlink(socketLink)),path=dirname(socket),directory=read.lstat(path),file=read.lstat(socket);
 if(!directory.isDirectory()||directory.isSymbolicLink()||!file.isSocket()||file.isSymbolicLink())throw Error('UNSUPPORTED: invalid singleton directory/socket');
 const cookie=read.lstat(join(path,'SingletonCookie')),profileCookie=read.lstat(join(profile,'SingletonCookie'));
 if(!cookie.isSymbolicLink()||!profileCookie.isSymbolicLink())throw Error('UNSUPPORTED: singleton cookie identity missing');
 const cookieValue=read.readlink(join(path,'SingletonCookie'));
 if(!cookieValue||cookieValue!==read.readlink(join(profile,'SingletonCookie')))throw Error('UNSUPPORTED: singleton cookie mismatch');
 const entries=read.readdir(path).sort();if(entries.join(',')!=='SingletonCookie,SingletonSocket')throw Error('UNSUPPORTED: singleton directory has unrelated contents');
 return {profile,socketLink,socket,path,cookieValue,dev:directory.dev,ino:directory.ino,socketDev:file.dev,socketIno:file.ino,profileLinkDev:link.dev,profileLinkIno:link.ino};
}
export function singletonListenerMatches(stdout,socket){return stdout.split('\n').some(line=>line.startsWith('n')&&line.slice(1).split(' type=')[0]===socket);}
export async function adoptBrowserSingleton(runtime,child){
 if(process.platform!=='darwin'||!child?.spawnargs)return null;
 const profile=child.spawnargs.find(arg=>arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);if(!profile)return null;
 // A caller-owned or borrowed profile is never eligible for adoption.
 if(!runtime.scratchDir||!resolve(profile).startsWith(resolve(runtime.scratchDir)+'/'))throw Error('UNSUPPORTED: browser singleton profile is outside owned scratch');
 const proof=singletonProof(profile);if(!proof)return null;
 const binary=runtime.ownerRecord.helper.binary,before=inspectProcess(binary,child.pid);if(!before)throw Error('UNSUPPORTED: singleton process ended before attribution');
 let open;
 try{open=await runtime.runCommand('lsof',['-a','-p',String(child.pid),'-U','-Fn'],{timeoutMs:3000,label:'owned browser singleton socket attribution'});}
 catch(error){if(error&&error.code==='ENOENT')throw Error('UNSUPPORTED: lsof is required for owned browser singleton socket attribution but was not found on PATH');throw error;}
 if(open.status!==0||open.stderr.trim()||!singletonListenerMatches(open.stdout,proof.socket))throw Error('UNSUPPORTED: singleton socket has no exact owned PID handle');
 const after=inspectProcess(binary,child.pid),current=singletonProof(profile);
 if(!after||after.birth!==before.birth||!current||JSON.stringify(current)!==JSON.stringify(proof))throw Error('UNSUPPORTED: singleton identity changed during attribution');
 const evidence={kind:'owned-browser-singleton',process:before,profile:proof.profile,proof,openHandleConfirmed:true};
 await runtime.registerTemp(proof.path,{reason:'owned Chrome singleton socket outside browser scratch',owner:{pid:child.pid,birth:before.birth,name:'owned Chrome singleton'},evidence});
 return evidence;
}
