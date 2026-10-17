/** Inert import. The verifier invokes one owned, bounded public CLI before any browser. */
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {readRegularInput} from './tool-operations.mjs';
import {existsSync} from 'node:fs';
import {commandCleanupProblems} from './command-acceptance.mjs';
import {readPhoneArtifactManifest} from './phone-target-admission.mjs';

export async function composeFreshPhone({sourceRoot,runtime}={}){
 assert(typeof sourceRoot==='string'&&typeof runtime?.runCommand==='function'&&typeof runtime?.tempDir==='function','Fresh composition requires the supplied source and authenticated runtime');
 const out=await runtime.tempDir('phone-current-reference-'),builder=join(resolve(sourceRoot),'tools/build-mobile.mjs');   // the current public builder; a private archived producer is never selected
 if(!existsSync(builder))throw Error('UNSUPPORTED: the current public phone builder (tools/build-mobile.mjs) is not available under the supplied source root; pass --source-root pointing at the repository root (see docs/TESTING.md)');
 const result=await runtime.runCommand(process.execPath,[builder,'--out',out],{cwd:resolve(sourceRoot),timeoutMs:20000,maxBuffer:2*1024*1024,label:'fresh stdlib current phone composition'});
 const cleanupProblems=commandCleanupProblems(result);
 assert(result.status===0&&cleanupProblems.length===0,'Fresh phone composition failed: '+JSON.stringify({status:result.status,cleanupProblems,stderr:result.stderr,error:result.error}));
 let receipt;try{receipt=JSON.parse(result.stdout);}catch{throw Error('Fresh phone composer did not produce a complete JSON result');}
 assert(receipt.out===out&&/^[a-f0-9]{64}$/.test(receipt.artifact||'')&&Number.isSafeInteger(receipt.files)&&receipt.files>0,'Fresh phone build result is empty or does not bind its owned output');
 const manifest=await readPhoneArtifactManifest({site:out,readInput:path=>readRegularInput(path,{runtime,timeoutMs:10000,maxBytes:8*1024*1024,encoding:null})});
 assert(manifest.artifact===receipt.artifact&&manifest.files.length===receipt.files,'Fresh phone manifest differs from completed CLI result');
 return manifest;
}
