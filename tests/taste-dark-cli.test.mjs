import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const guardOnlyEnv={...process.env,HW_FORBID_BROWSER_ALLOCATION:'1'};
const root=resolve(import.meta.dirname,'..'),path=resolve(root,'tools/taste-dark.mjs'),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function alias(child){
 const source=readFileSync(path,'utf8'),start=source.indexOf('// ============================================================ CLI:');assert(start>=0);
 const body=source.slice(start).replaceAll('import.meta.filename',JSON.stringify(path)).replaceAll('import.meta.url',JSON.stringify(new URL('../tools/taste-dark.mjs',import.meta.url).href)).replaceAll('await import(','await load(');
 const calls=[],load=async name=>name==='node:path'?{resolve}:name==='node:url'?{fileURLToPath}:name==='./tool-cli.mjs'?{parseToolArgs:()=>({values:{},positionals:[]}),showToolHelp:()=>false}:name==='./tool-operations.mjs'?{runChecked:async(...args)=>{calls.push(args);return child?.(...args);}}:name==='node:child_process'?{execFileSync:()=>{throw Error('unowned synchronous child');}}:(()=>{throw Error('unexpected import '+name);})();
 await new AsyncFunction('process','load',body)({argv:[process.execPath,path],execPath:process.execPath},load);return calls;
}
test('dark build alias uses one managed bounded child while preserving the published builder',async()=>{
 const calls=await alias();assert.equal(calls.length,1);assert.equal(calls[0][0],process.execPath);assert.deepEqual(calls[0][1],[resolve(root,'tools/build-site.mjs')]);assert.equal(calls[0][2].timeoutMs,300000);assert.equal(calls[0][2].stdio,'inherit');
});
test('dark build alias retains its managed child failure',async()=>{await assert.rejects(alias(()=>{throw Error('owned child failure');}),/owned child failure/);});
test('dark alias help and bad flags exit before lifecycle acquisition',()=>{
 for(const [args,status,pattern]of [[['--help'],0,/Usage:/],[['--unknown-option'],1,/Unknown option/]]){const r=spawnSync(process.execPath,[path,...args],{timeout:5000,killSignal:'SIGKILL',encoding:'utf8',maxBuffer:1048576,env:guardOnlyEnv});assert.equal(r.error,undefined);assert.equal(r.status,status);assert.match(r.stdout+r.stderr,pattern);assert.doesNotMatch(r.stdout+r.stderr,/HW_FORBID_BROWSER_ALLOCATION|\[runtime|\[supervisor/);}
});
