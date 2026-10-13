import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {realpath} from 'node:fs/promises';
import {ensureOutputDirectory,writeOutput,ownedFingerprint,removeRecordedFingerprint} from './build-output.mjs';
import {forceColourScheme} from './mobile-theme.mjs';
import {svgFromSymbol} from './build-mobile-inputs.mjs';

test('phone output rejects symlink ancestors, asset folders and file targets without modifying their referents',async()=>{
 const base=await mkdtemp(join(await realpath(tmpdir()),'heartwood-output-'));
 try{
  const source=join(base,'source'),out=join(base,'publish/mobile');await mkdir(source);await mkdir(join(base,'publish'));await writeFile(join(source,'keep.txt'),'author');
  await symlink(source,out,'dir');await assert.rejects(ensureOutputDirectory(out,{root:base,protectedPaths:[source]}),/real directory/);assert.equal(await readFile(join(source,'keep.txt'),'utf8'),'author');await rm(out);
  await ensureOutputDirectory(out);await symlink(source,join(out,'assets'),'dir');await assert.rejects(writeOutput(out,'assets/new.txt','build'),/real directory/);assert.deepEqual(await readdir(source),['keep.txt']);await rm(join(out,'assets'));
  await symlink(join(source,'keep.txt'),join(out,'day.html'));await assert.rejects(writeOutput(out,'day.html','build'),/regular file/);assert.equal(await readFile(join(source,'keep.txt'),'utf8'),'author');await rm(join(out,'day.html'));
  await writeOutput(out,'day.html','one');await writeOutput(out,'day.html','two');assert.equal(await readFile(join(out,'day.html'),'utf8'),'two');assert(! (await readdir(out)).some(name=>name.startsWith('.heartwood-build-')));
  await assert.rejects(ensureOutputDirectory(source,{root:base,protectedPaths:[source]}),/protected input/);
 }finally{await rm(base,{recursive:true,force:true});}
});
test('cleanup recognizes recorded taste and phone fingerprints but preserves other names',async()=>{
 const base=await mkdtemp(join(await realpath(tmpdir()),'heartwood-cleanup-'));
 try{
  for(const path of['css/heartwood-taste.0123456789ab.css','js/heartwood-taste-head.0123456789ab.js','mobile/assets/mobile.0123456789abcdef.js']){
   assert(ownedFingerprint(path));await writeOutput(base,path,'old');await writeOutput(base,path+'.gz','sidecar');await removeRecordedFingerprint(base,path);await assert.rejects(readFile(join(base,path)),/ENOENT/);await assert.rejects(readFile(join(base,path+'.gz')),/ENOENT/);
  }
  for(const path of['mobile/day.html','mobile/manifest.json','mobile/assets/user.css','../source/file.0123456789abcdef.js','mobile/assets/custom.0123456789abcdef.exe'])assert(!ownedFingerprint(path));
  await writeOutput(base,'mobile/assets/user.css','keep');assert.equal(await removeRecordedFingerprint(base,'mobile/assets/user.css'),false);assert.equal(await readFile(join(base,'mobile/assets/user.css'),'utf8'),'keep');
 }finally{await rm(base,{recursive:true,force:true});}
});
test('fixed phone night keeps the actual combined reduced-motion rule independent of OS theme',async()=>{
 const night=await readFile(resolve(import.meta.dirname,'../source/mobile/night.mjs'),'utf8');
 const block=/@media \(prefers-color-scheme: dark\) and \(prefers-reduced-motion: reduce\) \{[^}]+\}\s*\}/.exec(night)?.[0];assert(block,'Expected actual night reduced-motion source rule');
 assert(!forceColourScheme(block,'light').includes('.crit--flies'));const fixed=forceColourScheme(block,'dark');assert(fixed.includes('@media (prefers-reduced-motion: reduce)'));assert(fixed.includes('animation: none'));assert(!fixed.includes('prefers-color-scheme'));
 assert.throws(()=>forceColourScheme('@media (prefers-color-scheme: dark), (min-width: 1px) {.x{color:red}}','dark'),/Unsupported/);
});
test('standalone phone logo preserves the complete current author symbol geometry',async()=>{
 const html=await readFile(resolve(import.meta.dirname,'../source/heartwood-site.html'),'utf8');const symbol=/<symbol id="hw-logo"[\s\S]*?<\/symbol>/.exec(html)?.[0];assert(symbol,'Expected approved author logo');assert(symbol.includes('scale(0.568527919)'),'Approved logo transform fixture drifted');
 const converted=svgFromSymbol(symbol,'#000'),body=symbol.replace(/^<symbol[^>]*>/,'').replace(/<\/symbol>$/,'').replace(/currentColor/g,'#000');assert(converted.includes(body));assert(converted.includes('scale(0.568527919)'));
});
