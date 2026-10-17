import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {treeData,treeCss,treeSource,runTree,leafGeometry} from '../../tools/taste-tree.mjs';

const html=await readFile(new URL('../../source/heartwood-site.html',import.meta.url),'utf8');
const css=await readFile(new URL('../../source/css/heartwood-site.css',import.meta.url),'utf8');
const page=html+'\n<style>\n'+css+'\n</style>\n';   // the maintained composition keeps markup and stylesheet in separate files; the tools parse one page source
const HINT='tools/taste-tree.mjs';
// Pinned from output/playwright/review-taste-tree/occlusion.json (cover at the hover pose, %) and slide-table.json (slide, % of the leaf box), made with occlusion.py
// (2026-10-12: the leaf shape is the stemmed lens that wins the cascade and --leaf-ar is read from the page, as the site paints them).
// 94 and 105 are only in the wood's drop shadow: they swap above the wood but do not slide.
const PIN={68:[2.1,18.4,-2.8],149:[25.5,20,0],120:[7.8,-7.7,-9.2],69:[.9,-3.7,-3.9],2:[38.1,-7.7,-9.2],4:[27.8,20,0],9:[1.3,6.3,1.9],13:[52.5,-18.5,3.8],15:[35.2,18.5,-3.8],16:[5,-19.7,1.8],17:[4.9,-7.1,-4.2],22:[41.3,-14.1,-7.1],33:[9,7.7,-9.2],39:[3.8,-7.6,-9.2],43:[5.1,7.6,-9.2],50:[29.9,-18.5,3.8],65:[2.4,7.2,8.7],75:[10.5,14.1,-7.1],127:[34.5,-19.9,1.2],94:[0,0,0],105:[0,0,0]};
const AR=+[...css.matchAll(/--leaf-ar:\s*([\d.]+)\s*;/g)].at(-1)[1];   // the page's own width / length, read here independently of the code under test
const D=treeData(page),rowOf=id=>D.rows.find(r=>r.id===id);

test('table is deterministic and has the pinned leaves only',()=>{
  assert.deepEqual(treeData(page).T,D.T);
  assert.deepEqual(Object.keys(D.T).map(Number).sort((a,b)=>a-b),Object.keys(PIN).map(Number).sort((a,b)=>a-b),'leaves in the table.'+' If the art changed on purpose, re-pin PIN from occlusion.py output. '+HINT);
  assert.equal(D.rows.length,149);
});

test('matches occlusion.json and slide-table.json within one raster pixel (0.5 stage units)',()=>{
  for(const [id,[pct,px,py]] of Object.entries(PIN)){
    const r=rowOf(+id),v=D.T[id];
    if(r.shadow){assert.deepEqual(v,[0,0]);continue;}
    assert(Math.abs(r.hover*100-pct)<.15,'leaf '+id+' cover '+(r.hover*100).toFixed(2)+' vs '+pct);
    const h=r.len,w=h*AR;   // leaf box in stage units
    assert(Math.abs(v[0]-px)*w/100<=.5&&Math.abs(v[1]-py)*h/100<=.5,'leaf '+id+' slide '+v+' vs '+[px,py]);
  }
});

test('slide is at most 10% of the leaf length, and never uncovers less than it started with',()=>{
  for(const r of D.rows){
    if(!r.v)continue;
    const h=r.len||0;
    if(!r.shadow)assert(Math.hypot(r.v[0]*h*AR/100,r.v[1]*h/100)<=.1*h+.06*h/50,'leaf '+r.id+' slides '+r.v);
    assert(r.switch<=r.hover+1e-9,'leaf '+r.id+': cover at the switch '+r.switch+' > at hover '+r.hover);
  }
});

test('unoccluded leaves are absent',()=>{
  const out=D.rows.filter(r=>!(r.id in D.T));
  assert.equal(out.length,149-Object.keys(PIN).length);
  for(const r of out)assert(!r.shadow&&r.hover<.005,'leaf '+r.id+' is covered '+r.hover);
});

test('resolution does not change the result (K=3 vs K=2): same leaves, same cover, within a raster pixel',()=>{
  const E=treeData(page,{K:3});
  assert.deepEqual(Object.keys(E.T),Object.keys(D.T));
  for(const r of E.rows){const q=rowOf(r.id);
    assert(Math.abs(r.hover-q.hover)<.01,'leaf '+r.id+' hover cover '+r.hover+' vs '+q.hover);
    if(r.v&&q.v)assert(Math.abs(r.switch-q.switch)<.02,'leaf '+r.id+' cover at switch '+r.switch+' vs '+q.switch);}   // near-tied directions may differ; the outcome may not
});

test('leaf proportions and the hover pose come from the page: other values change the table, unsupported forms fail loudly',()=>{
  assert.deepEqual(leafGeometry(page),{W:1508,H:1047,AR:.5,LEAF:leafGeometry(page).LEAF,TILT:3,GROW:1.14});
  assert.equal(leafGeometry(page).LEAF.length,43,'the stemmed lens (declared last, wins the cascade) is the shape the site paints');
  const wide=page.replace('--leaf-ar: .5;','--leaf-ar: .7;'),W7=treeData(wide).T;
  assert.equal(leafGeometry(wide).AR,.7);
  for(const id of [72,99,119])assert(id in W7&&!(id in D.T),'wider leaves (--leaf-ar .7) newly reach under the wood: leaf '+id);
  const tilt=page.replace('rotate(calc(var(--angle) + 3deg)) scale(1.14)','rotate(calc(var(--angle) + 12deg)) scale(1.3)');
  assert.deepEqual([leafGeometry(tilt).TILT,leafGeometry(tilt).GROW],[12,1.3]);assert.notDeepEqual(treeData(tilt).T,D.T,'the hover pose drives the table');
  assert.throws(()=>treeData(page.replace('--leaf-ar: .5;','--leaf-ar: calc(1 / 2);')),/--leaf-ar is "calc\(1 \/ 2\)".*supports a plain positive number/);
  assert.throws(()=>treeData(page.replace('@media (hover: hover) {','@media (hover: hover) { :root { --leaf-ar: .6; }')),/--leaf-ar is set outside a top-level :root rule/);
  assert.throws(()=>treeData(page.replace('rotate(calc(var(--angle) + 3deg)) scale(1.14)','scale(1.14) rotate(calc(var(--angle) + 3deg))')),/leaf hover transform is .*supports translate/);
  assert.throws(()=>treeData(page.replace('transform-origin: 50% 100%;','transform-origin: 50% 50%;')),/\.leaf transform-origin changed/);
  assert.throws(()=>treeData(page.replace('aspect-ratio: 1508 / 1047;','aspect-ratio: 3 / 2 auto;')),/\.stage aspect-ratio is not/);
});

test('drift asserts name what to update',()=>{
  const first=html.match(/<button class="leaf [^"]*" type="button" data-leaf="\d+"/)[0];
  assert.throws(()=>treeData(page.replace(first,first.replace('data-leaf','data-leaf-x'))),/expected 149 tree leaves.*update the expected counts and markers in tools\/taste-tree\.mjs/);
  assert.throws(()=>treeData(page.replace('<div class="scene bigtree" aria-hidden="true" style="z-index:4">','<div class="scene bigtree" aria-hidden="true">')),/front wood sheet marker.*tools\/taste-tree\.mjs/);
  assert.throws(()=>treeData(page.replace(/--leaf-shape:\s*polygon/g,'--leaf-shapes: polygon')),/--leaf-shape is not set on :root.*tools\/taste-tree\.mjs/);
  const at=page.indexOf('<div class="scene bigtree" aria-hidden="true" style="z-index:4">');   // a wood piece in the front sheet
  assert.throws(()=>treeData(page.slice(0,at)+page.slice(at).replace(/<i style="left:([\d.]+)%;top/,'<i style="left:$1%;tops')),/do not parse.*tools\/taste-tree\.mjs/);
  assert.throws(()=>treeCss(css.replace('button.leaf:hover {','button.leaf:hover-x {')),/hover.*is gone.*tools\/taste-tree\.mjs/);
  assert.throws(()=>treeCss(css.replace(/(button\.leaf:hover\s*\{[^}]*)transform:/,'$1translate:')),/no longer sets transform and --lift/);
  assert.throws(()=>treeCss(css.replace('.leaf { transition: transform .28s cubic-bezier(.3, 1.4, .5, 1)','.leaf { transition: transform .3s cubic-bezier(.3, 1.4, .5, 1)')),/transition changed/);
});

test('css: the site hover declarations minus z-index, no colour values; the focus ring is the site\'s own .leaf:focus-visible declarations verbatim, before the hover rule',()=>{
  const out=treeCss(css);
  const site=/\.leaf:focus-visible\s*\{([^}]*)\}/.exec(css)[1].split(';').map(d=>d.trim().replace(/\s+/g,' ')).filter(d=>d&&!d.startsWith('z-index')).join('; ');
  const fv=/^:where\(\.tree \.hw-taste-clone\) > button\.leaf\.hw-taste-fv \{ (.*); \}$/m.exec(out);
  assert(fv,'a focus-ring rule for the copies');assert.equal(fv[1],site,'the site\'s own focus-visible declarations, minus z-index');
  assert(/filter: drop-shadow\(var\(--ring\) 0 0 var\(--card\)\)/.test(fv[1])&&out.indexOf('hw-taste-fv {')<out.indexOf('hw-taste-up {'),'ring filter present; hover rule comes later (hover wins the transform, as on the real leaf)');
  assert.throws(()=>treeCss(css.replace('.leaf:focus-visible {','.leaf:focus-within {')),/focus-visible.*is gone/);
  assert(out.includes(':where(.tree .hw-taste-clone) > button.leaf.hw-taste-up'));
  assert(/--lift: 1\.9; transform: translate\(-50%, -100%\) rotate\(calc\(var\(--angle\) \+ 3deg\)\) scale\(1\.14\);/.test(out),out);
  const hover=/hw-taste-up \{([^}]*)\}/.exec(out)[1];
  assert(!/z-index/.test(hover));
  assert(!/#[0-9a-f]{3,8}\b|rgb|hsl|color|background|var\(--(?:gold|paper|ink|card|a|focus)\b/i.test(out.replace(/\/\*[\s\S]*?\*\//g,'').replace(fv[0],'')),'no colour in the tree taste css outside the copied focus ring');
  assert(out.includes('.tree.hw-taste-over { z-index: 4; }')&&out.includes('.hw-taste-hidden { opacity: 0; }'));
});

test('shipped source is valid, carries the table and the browser function',()=>{
  const src=treeSource(page);
  new vm.Script(src);
  assert(src.includes(JSON.stringify(D.T))&&src.includes(runTree.toString())&&!/console\.log|debugger/.test(src));
});
