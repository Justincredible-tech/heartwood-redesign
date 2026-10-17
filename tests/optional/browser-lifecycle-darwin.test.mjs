// macOS-only browser-lifecycle case (root-owned LaunchServices behavior): the app-bundle Chrome must never
// be spawned when LaunchServices is unreachable. Explicit optional native-group case; off macOS it fails
// explicitly rather than skipping, and it can never report PASS without running the real behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as lib from '../../tools/browser-test-lib.mjs';
if(process.platform!=='darwin')throw Error('UNSUPPORTED: the app-bundle LaunchServices case is macOS-only (see docs/TESTING.md)');
const runtime=()=>({runId:'pure-fixture',probeOutput:'ASN:0x0-0x1:\n',probes:[],async runCommand(command,args){this.probes.push([command,...args]);return {status:0,stdout:this.probeOutput};},stepTimeoutMs:30,cleanups:[],processes:[],step(){},onCleanup(label,fn,options={}){const row={label,fn,...options};this.cleanups.push(row);return()=>this.cleanups.splice(this.cleanups.indexOf(row),1);},async registerProcess(child,options){this.processes.push({child,options});},async deadline(label,operation,{timeoutMs=30}={}){let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' deadline')),timeoutMs);})]);}finally{clearTimeout(timer);}}});
const types=(rt,{failConnect=false,failClose=false}={})=>{const servers=[];const browsers=[];return {servers,browsers,types:{chromium:{async launchServer(options){const s={options,closed:0,process:()=>({pid:43210}),wsEndpoint:()=> 'ws://127.0.0.1:123/ws',async close(){this.closed++;}};servers.push(s);return s;},async connect(){if(failConnect)throw Error('connect failure');const b=new EventEmitter();b.newContext=async()=>{const c=new EventEmitter();c.exposeFunction=async()=>{};c.addInitScript=async()=>{};c.setDefaultTimeout=v=>c.defaultTimeout=v;c.setDefaultNavigationTimeout=v=>c.navigationTimeout=v;c.close=async()=>{};c.newPage=async()=>{const p=new EventEmitter();p.context=()=>c;p.evaluate=async()=>{};return p;};return c;};b.newPage=async()=>{const c=await b.newContext();return c.newPage();};b.closed=0;b.close=async()=>{b.closed++;if(failClose)throw Error('browser close failure');b.emit('disconnected');};browsers.push(b);return b;}}}};};
test('macOS app-bundle Chrome is never spawned when LaunchServices is unreachable (sandboxed shell -> crash dialog)',async()=>{
 const rt=runtime(),fake=types(rt),executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 rt.probeOutput='[ NULL ] \n';await assert.rejects(lib.managedLaunch(fake.types.chromium,{executablePath},{runtime:rt}),/LaunchServices is unreachable/);
 assert.equal(fake.servers.length,0);assert.deepEqual(rt.probes,[['/usr/bin/lsappinfo','front']]);
 rt.probeOutput='ASN:0x0-0x1054053:\n';const browser=await lib.managedLaunch(fake.types.chromium,{executablePath},{runtime:rt});assert.equal(fake.servers.length,1);await browser.close();
});
