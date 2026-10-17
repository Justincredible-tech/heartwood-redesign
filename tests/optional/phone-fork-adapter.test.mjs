import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {readContent} from '../../source/mobile/content.mjs';
import {artDocs} from '../../source/mobile/art.mjs';
import {loadNight} from '../../source/mobile/night.mjs';
import {buildMobile} from '../../tools/build-mobile.mjs';
import {loadMobileSources,metaInputs,FONT_INPUTS,PHOTO_INPUTS,ORIGINAL_PAPER_SHA256} from '../../tools/mobile-source-inputs.mjs';
import {forkInputRoot} from '../../tools/mobile-source-inputs.mjs';
import {ensureToolRuntime} from '../../tools/tool-runtime.mjs';

const root=resolve(import.meta.dirname,'..','..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtime=ensureToolRuntime({name:'phone fork adapter regression',runTimeoutMs:120000});
await runtime.ready;
const sources=loadMobileSources({root,sourceRoot:root});
after(async()=>{await runtime.shutdown('phone adapter tests complete');});

test('source root has no implicit legacy workspace fallback',()=>{
 assert.equal(forkInputRoot('/not/audit'),'/not/audit');
 assert.equal(forkInputRoot('/work/fork/.audit'),'/work/fork/.audit');
 assert.equal(forkInputRoot('/work/fork/.audit',''),'/work/fork/.audit');
 assert.equal(forkInputRoot('/unused','/explicit/fork'),'/explicit/fork');
});
test('upstream external JS content is complete and never executes its DOM IIFE',async()=>{
 const s=await sources,content=readContent(s.markup,{scriptSource:s.scriptSource});
 assert(s.scriptSource.startsWith('\n/*')&&s.scriptSource.includes("const stage = document.getElementById('stage');"));
 assert.equal(content.counts.records,136);assert.equal(content.counts.groups,106);assert.equal(content.counts.groupLeaves,105);
 assert.deepEqual(Object.fromEntries(['act','work','gather','news','about','group'].map(k=>[k,content.records.filter(r=>r.kind===k).length])),{act:5,work:7,gather:2,news:11,about:5,group:106});
 assert.equal(content.records.find(r=>r.id==='forest-watch').title,'Forest Watch');
 assert(content.page.logo.includes('viewBox="0 0 2706 905"'));
 assert(content.records.some(r=>r.img?.src===PHOTO_INPUTS[0].url));assert(content.records.some(r=>r.img?.src===PHOTO_INPUTS[1].url));
});
test('wrong or mixed upstream script contracts fail visibly',async()=>{
 const s=await sources;
 assert.throws(()=>readContent(s.markup),/Expected the original two inline scripts/);
 assert.throws(()=>readContent(s.markup,{scriptSource:''}),/Expected one boundary/);
 assert.throws(()=>readContent(s.markup.replace('js/heartwood-site.js','js/other.js'),{scriptSource:s.scriptSource}),/upstream single external script/);
 assert.throws(()=>metaInputs('<head></head>'),/Expected one upstream favicon/);
});
test('fonts are the exact reviewed upstream bytes; originals and licenses have provenance',async()=>{
 const s=await sources;
 for(const f of s.fonts)assert.equal(sha(f.bytes),FONT_INPUTS.find(x=>x.logical===f.logical).sha256);
 assert.equal(s.provenance.find(p=>p.origin==='original-paper-reference').sha256,ORIGINAL_PAPER_SHA256);
 assert.equal(s.provenance.filter(p=>p.origin==='upstream-font-license').length,2);
 for(const p of s.photos)assert.equal(sha(p.bytes),PHOTO_INPUTS.find(x=>x.name===p.name).sha256);
 assert(!s.provenance.some(p=>p.path.startsWith('site/')||p.path.startsWith('/')));
});
test('every generated day/night master document still matches approved original paper art',async()=>{
 const s=await sources,night=await loadNight(root,{siteCss:s.artCss}),content=readContent(s.markup,{scriptSource:s.scriptSource});
 const docs=artDocs(s.artSource,content.counts.groups,night),index=JSON.parse(await readFile(join(root,'source/mobile/art/masters/masters.json'),'utf8'));
 assert.equal(docs.length,25);
 for(const d of docs){assert.equal(sha(d.html),index[d.name].doc,d.name+' would require an independently reviewed rebake');assert.equal(sha(await readFile(join(root,'source/mobile/art/masters',d.name+'@3x.png'))),index[d.name].png,d.name+' PNG identity');}
 await assert.rejects(loadNight(root),/explicit reviewed original paper CSS/);
});
test('portable build uses all three new icons, final logo geometry and exact input identities',async()=>{
 const s=await sources,out=await realpath(await runtime.tempDir('heartwood-current-phone-adapter-')),b=await runtime.deadline('compose current public phone once',()=>buildMobile({sourceRoot:s.fork,out}),{timeoutMs:30000});
 assert.equal(b.manifest.source.path,'source/heartwood-site.html');assert.equal(b.manifest.source.sha256,sha(s.markup));for(const row of s.provenance){const hit=b.manifest.source.inputs.find(input=>input.path===row.path&&input.sha256===row.sha256&&input.bytes===row.bytes);assert(hit,'declared input identity missing from the build manifest: '+row.path);}
 assert(!b.html.includes('.ico'));assert(!b.html.includes('/_external/'));
 assert.equal(b.out,out);for(const path of ['index.html','day.html','night.html'])assert(b.manifest.files.some(f=>f.path===path),path+' must be declared');
 for(const path of ['day.html','night.html']){const html=await readFile(join(out,path),'utf8');
  for(const icon of s.icons){const f=b.manifest.files.find(f=>f.sha256===sha(icon.bytes));assert(f,'new '+icon.name+' is shipped');assert(html.includes('href="'+f.path+'"'));}
  assert.match(html,/<link rel="icon" href="assets\/favicon\.[a-f0-9]+\.svg" type="image\/svg\+xml">/);
  assert.match(html,/<link rel="icon" href="assets\/favicon-32\.[a-f0-9]+\.png" type="image\/png" sizes="32x32">/);
  assert.match(html,/<link rel="apple-touch-icon" href="assets\/apple-touch-icon\.[a-f0-9]+\.png">/);
 }
 for(const file of b.manifest.files.filter(f=>f.path.endsWith('.css'))){const css=await readFile(join(out,file.path),'utf8');assert(css.includes('--logo-ratio: 2706 / 905'));assert(css.includes('--logo: #20241f'));}
 for(const f of b.manifest.files)assert.equal(sha(await readFile(join(b.out,f.path))),f.sha256);
 for(const sfx of ['', '-night'])assert(['tree','ridges','clouds','sky'].reduce((n,k)=>n+b.manifest.files.find(f=>f.path===b.manifest.art[k+sfx]['3x.avif']).bytes,0)<=150*1024);
});
