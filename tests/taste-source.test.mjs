import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {prepareTaste,scopeNightRules} from '../source/taste/index.mjs';
import {faithfulLeafSource,installLeafLayers} from '../source/taste/leaf-rendering.mjs';
const root=resolve(import.meta.dirname,'..');
const inputs=Promise.all(['source/heartwood-site.html','source/css/heartwood-site.css'].map(p=>readFile(resolve(root,p),'utf8'))).then(([html,css])=>({html,css}));
const derivative=Promise.all([inputs,readFile(resolve(root,'source/assets/grain/grain-provenance.json'),'utf8')]).then(([i,p])=>prepareTaste({...i,nightTiles:Object.values(JSON.parse(p).night.tiles).map(r=>r.file)}));

test('combined taste contains every supported feature with authored icons and four daytime bees',async()=>{
 const t=await derivative;
 assert.equal(t.contract.treeLeaves,149);assert.equal((t.html.match(/class="hw-leaf-layer"/g)||[]).length,149);
 assert.equal((t.html.match(/class="bee"/g)||[]).length,4);assert.equal((t.html.match(/class="bee hw-firefly-extra"/g)||[]).length,5);
 assert.equal((t.html.match(/class="bird__face[^"\n]*hw-nface/g)||[]).length,9);
 assert(t.js.includes('function runTree')&&t.js.includes('pointerdown'));
 assert.match(t.html,/data-hw-experience="taste"/);assert.match(t.html,/data-hw-theme="night"/,'Taste remains Night when scripting is unavailable');
 assert(t.html.includes('href="../desktop-day.html?view=desktop&amp;theme=light" data-hw-mode>Day</a>'),'No-JS Day link opens the real Day scene');
 for(const icon of ['favicon.18b614f14a69.svg','favicon-32.b4dfb5536bae.png','apple-touch-icon.e41752ee7a82.png'])assert(t.html.includes(icon));
 new vm.Script(t.js);new vm.Script(t.headJs);
});

test('authored bird motion and day geometry survive the uncompiled source adapter',async()=>{
 const {html}=await inputs,t=await derivative;
 for(const m of html.matchAll(/<div class="bird bird--\w+" style="([^"]+)"/g))assert(t.html.includes('style="'+m[1]+'"'),'Authored flight/flap custom properties preserved');
 for(const m of html.matchAll(/<span class="bird__bob" style="top:([^;]+);width:([^;]+);aspect-ratio:([^"]+)"/g))assert(t.html.includes('top:'+m[1]+';width:var(--hw-night-w,'+m[2]+');aspect-ratio:var(--hw-night-ar,'+m[3]+')'),'Day box dimensions stay exact fallbacks');
 assert(t.css.includes('--hw-night-w: 2.1%'),'Night moth size overrides authored inline width through variables');
});

test('night rules are scoped, nested selector commas survive, and keyframes remain definitions',async()=>{
 const t=await derivative;assert.match(t.css,/html\[data-hw-theme="night"\] \.hw-night/);assert.match(t.headJs,/dataset\.hwTheme==='night'/);
 const reset=/html\[data-hw-theme="night"\] \.cut\s*>\s*i\.trim\s*\{[^{}]*\bbackground\s*:\s*none\s*;?[^{}]*\}/.exec(t.css);assert(reset,'The authored transparent mycelium trim wrapper must survive the higher-specificity night fill');
 const fill=/html\[data-hw-theme="night"\] \.cut\s*>\s*i\s*\{[^{}]*\bbackground\s*:/.exec(t.css);assert(fill&&reset.index>fill.index,'Authored reset must follow generic night paper fill in original rule order');
 const css=scopeNightRules('@supports (color:red){:root{--c:red}.a,:is(.b,.c){color:red}@media(hover:hover){.d:hover{opacity:1}}@keyframes pulse{0%{opacity:0}100%{opacity:1}}}');
 assert(css.includes('html[data-hw-theme="night"] :is(.b,.c)'));assert(css.includes('@keyframes pulse{0%{opacity:0}100%{opacity:1}}'));assert(!css.includes('html[data-hw-theme="night"] 0%'));
 const roots=[...t.css.matchAll(/html\[data-hw-theme="night"\]\{([^}]*)\}/g)].map(m=>m[1]).join('\n');assert(!/--grain:[^;]*var\(--grain-tile\)/.test(roots));assert(roots.includes('rgb(255 255 255 / 0.039)')&&roots.includes('rgb(0 0 0 / 0.078)'));assert(roots.includes('var(--grain-tile-night)'),'the night grain references the dedicated night tile');assert(roots.includes('--grain-tile-night: url(../assets/grain/grain-fine-night-'),'the night tile declarations ship');
});

test('faithful fast layers preserve authored delivery HTML and original button styles',async()=>{
 const {html,css}=await inputs,f=faithfulLeafSource({html,css});assert.equal(f.html,html);new vm.Script(f.js);
 const leaves=Array.from({length:149},(_,i)=>({attrs:{style:'--x:'+i+';--y:20;--r:3;--s:2'},getAttribute(k){return this.attrs[k]??null;},before(layer){this.layer=layer;}}));
 const before=leaves.map(l=>({...l.attrs})),layers=[];
 const doc={querySelector:()=>({querySelectorAll:()=>leaves}),createElement:()=>{const l={attrs:{},setAttribute(k,v){this.attrs[k]=v;},append(button){this.button=button;}};layers.push(l);return l;}};
 const context={window:{CSS:{supports:()=>true}},CSS:{supports:()=>true},document:doc,console};vm.runInNewContext('('+installLeafLayers+')()',context);
 assert.equal(layers.length,149);assert.deepEqual(leaves.map(l=>l.attrs),before);for(const[i,l]of layers.entries()){assert.equal(l.attrs.style,before[i].style);assert.equal(l.button,leaves[i]);}
 let warnings=0,touched=false;
 const wrappedDoc=count=>({querySelector:()=>({querySelectorAll:s=>s===':scope > button.leaf'?[]:Array.from({length:count})}),createElement(){touched=true;throw Error('Already wrapped tree must stay intact');}});
 const wrappedContext=count=>({window:{CSS:{supports:()=>true}},CSS:{supports:()=>true},document:wrappedDoc(count),console:{warn(){warnings++;}}});
 vm.runInNewContext('('+installLeafLayers+')()',wrappedContext(149));assert.equal(warnings,0);assert.equal(touched,false);
 vm.runInNewContext('('+installLeafLayers+')()',wrappedContext(148));assert.equal(warnings,1,'Wrong existing wrapper count must still report source drift');assert.equal(touched,false);
});

test('unsupported leaf layering keeps the original tree intact',()=>{
 let read=false;vm.runInNewContext('('+installLeafLayers+')()',{window:{CSS:{supports:()=>false}},CSS:{supports:()=>false},document:{querySelector(){read=true;}},console});assert.equal(read,false);
});
