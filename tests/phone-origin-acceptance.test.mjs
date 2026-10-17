import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fc} from './property-lib.mjs';
import * as admission from '../tools/phone-target-admission.mjs';
const sha=text=>createHash('sha256').update(text).digest('hex');
const composers=["tools/build-mobile.mjs","source/build-features.mjs","tools/feature-output.mjs","tools/mobile-feature-source.mjs","tools/supervised-build-options.mjs","tools/mobile-origin.mjs","tools/mobile-art-encoding.mjs","tools/mobile-theme.mjs","tools/build-mobile-inputs.mjs","tools/mobile-source-inputs.mjs","tools/build-output.mjs","tools/build-cli.mjs","source/mobile/content.mjs","source/mobile/art.mjs","source/mobile/night.mjs","source/mobile/page.mjs","source/mobile/state.mjs","source/mobile/app.js","source/js/live-photos.js","source/mobile/mobile.css","source/taste/taste-dark.mjs"];   // fixture: the current public composer list at migration time
const inputDigest=inputs=>sha(inputs.map(r=>r.origin+':'+r.path+':'+r.role+':'+r.bytes+':'+r.sha256).sort().join('\n'));
function fixture(){
 const inputs=composers.map(path=>({path,origin:'project',role:path.startsWith('tools/')?'composer':'behavior-or-layout',bytes:4,sha256:sha(path)})).concat({path:'source/heartwood-site.html',origin:'project',role:'content',bytes:20,sha256:sha('markup')}),files=['index.html','day.html','night.html'].map(path=>({path,bytes:20,sha256:sha(path)}));
 return {built:'tools/build-mobile.mjs',artifact:sha(files.map(r=>r.path+':'+r.sha256).sort().join('\n')),files,source:{path:'source/heartwood-site.html',sha256:sha('markup'),inputs},records:3,groups:1,groupLeaves:1,art:{tree:{w:375,h:900}},photos:{},origin:{schema:1,kind:'public-phone-composition',inputDigest:inputDigest(inputs),inputs,art:[{name:'tree',documentSha256:sha('recipe'),master:{sha256:sha('master')},encodings:[{sourcePath:'source/mobile/art/encoded/tree.webp',publishedPath:'assets/tree.webp',sha256:sha('webp')}]}],photos:[],composition:{sourceEpochUnchanged:true}}};
}
test('current composition gate requires bound origin and a complete fresh current-source reference',()=>{
 assert.equal(typeof admission.assertCurrentPhoneComposition,'function','implement the explicit fresh-composition acceptance gate');const reference=fixture();
 assert.equal(admission.assertCurrentPhoneComposition(reference,structuredClone(reference),{composers}).status,'CURRENT_RECOMPOSITION_MATCH');
 for(const bad of [undefined,{}, {...reference,origin:undefined},{...reference,origin:{...reference.origin,schema:0}},{...reference,origin:{...reference.origin,composition:{sourceEpochUnchanged:false}}}])assert.throws(()=>admission.assertCurrentPhoneComposition(bad,reference,{composers}));
 assert.throws(()=>admission.assertCurrentPhoneComposition(reference,undefined,{composers}));
});
test('omitted composer with honestly recalculated partial digest cannot pass against fresh full closure',()=>{
 assert.equal(typeof admission.assertCurrentPhoneComposition,'function');
 const reference=fixture();fc.assert(fc.property(fc.integer({min:0,max:composers.length-1}),index=>{
  const bad=structuredClone(reference);bad.origin.inputs.splice(index,1);bad.source.inputs=bad.origin.inputs;bad.origin.inputDigest=inputDigest(bad.origin.inputs);assert.throws(()=>admission.assertCurrentPhoneComposition(bad,reference,{composers}));
 }),{seed:13102026,numRuns:200});
});
test('stale source/output/recipe/settings and semantic counts cannot pass through a self-consistent artifact',()=>{
 assert.equal(typeof admission.assertCurrentPhoneComposition,'function');
 const reference=fixture();
 const changed=[r=>{r.origin.art[0].documentSha256=sha('other');},r=>{r.origin.art[0].encodings[0].sha256=sha('other');},r=>{r.art.tree.w=999;},r=>{r.groups++;},r=>{r.records++;},r=>{r.source.sha256=sha('other');},r=>{r.origin.inputs[0].role='content';r.source.inputs=r.origin.inputs;r.origin.inputDigest=inputDigest(r.origin.inputs);},r=>{r.files[0].sha256=sha('other');r.artifact=sha(r.files.map(f=>f.path+':'+f.sha256).sort().join('\n'));}];
 for(const change of changed){const bad=structuredClone(reference);change(bad);assert.throws(()=>admission.assertCurrentPhoneComposition(bad,reference,{composers}));}
 const reordered=structuredClone(reference);reordered.files.reverse();reordered.origin.inputs.reverse();reordered.source.inputs=reordered.origin.inputs;assert.equal(admission.assertCurrentPhoneComposition(reordered,reference,{composers}).status,'CURRENT_RECOMPOSITION_MATCH');
});
