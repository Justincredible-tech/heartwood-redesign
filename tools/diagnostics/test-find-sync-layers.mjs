// Self-test for tools/diagnostics/find-sync-layers.mjs on generated fixture routes (needs Chrome; not part of npm test).
// node tools/diagnostics/test-find-sync-layers.mjs
import {ensureToolRuntime} from '../tool-runtime.mjs';
import {browserToolCLI} from '../browser-test-lib.mjs';
browserToolCLI();
const runtime=ensureToolRuntime({runTimeoutMs:300000});await runtime.ready;
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),dir=await runtime.tempDir('hw-sync-'),json=join(dir,'report.json');
const page=(css,body)=>`<!doctype html><meta charset=utf-8><style>i,b{position:absolute;display:block;top:0;width:20px;height:20px}i{background:#c33}@keyframes spin{to{rotate:1turn}}@keyframes flap{to{scale:1 .5}}@keyframes grow{to{width:80px}}@keyframes slide{to{translate:var(--to) 0}}${css}</style>${body}`;
const fixture=page('.spin{animation:spin 1s linear infinite}.late{animation-delay:-250ms}.pair{position:absolute;top:60px;width:40px;height:40px}.pair i{left:0;top:0;width:40px;height:40px;transform-origin:50% 100%;animation:flap .3s linear infinite alternate}.pair i.sl{animation:slide 1s linear infinite}.clip{clip-path:ellipse(50% 30%)}.cover{position:absolute;left:0;top:0;width:100px;height:30px;background:#3c3}.grow{top:200px;animation:grow 1s linear infinite alternate}',
 '<i class=spin style=left:0></i><i class=spin style=left:30px></i><i class="spin late" style=left:60px></i><div class=pair style=left:200px><i></i><i class=clip></i></div><div class=pair style=left:300px><i></i><i></i></div>'
 +'<div class=pair style=left:400px><i class=sl style=--to:40px></i><i class=sl style=--to:80px></i></div><div class=pair style=left:500px><i></i><i style=animation-timing-function:ease-in></i></div><div class=pair style=left:600px><i></i><i style=rotate:20deg></i></div><div class=cover></div><i class=grow></i>');
// Bird-wing replica: animated <b> paints nothing, its <i> child paints, and it overlaps another animated layer. Must not be flagged.
const clean=page('.spin{animation:spin 1s linear infinite}.wing{left:10px;width:40px;height:40px;animation:flap .3s linear infinite alternate}.wing i{left:0;width:40px;height:40px}','<i class=spin></i><b class=wing><i></i></b>');
// One adjacent same-pivot lockstep pair per block reason (each also a flap/fade pair, so only the named reason differs from an OK merge).
const pairs=[['plain',''],['box','<i style=width:30px></i>'],['z','<i style=z-index:2></i>'],['other','<i style="animation:flap .3s linear infinite alternate,spin 1s linear infinite"></i>'],['blend','<i style=mix-blend-mode:multiply></i>']];
const blocks=page('.pair{position:absolute;top:60px;width:40px;height:40px}.pair i,.pair b{left:0;top:0;width:40px;height:40px;transform-origin:50% 100%;animation:flap .3s linear infinite alternate}.pair b{background:#36c}@keyframes fade{to{opacity:.5}}.fade i{animation:fade .5s linear infinite alternate}.ps::before{content:"";position:absolute;width:20px;height:20px;background:#c33;animation:flap .3s linear infinite alternate}.ps{width:20px;height:20px}',
 pairs.map(([n,x],k)=>`<div class=pair style=left:${k*60}px><i></i>${x||'<i></i>'}</div>`).join('')
 +'<div class=pair style=left:320px><i></i><b style=animation:none></b><i></i></div><div class="pair fade" style=left:380px><i></i><i></i></div><div class=pair style=left:440px><i class=ps></i><i class=ps></i></div>');
// Filtered ancestor of an animated element; ticking-only page (rAF loop, no animation at all).
const around=page('.spin{animation:spin 1s linear infinite}','<div style="filter:blur(.5px);will-change:transform;width:30px;height:30px"><i class=spin></i></div>');
const tick='<!doctype html><meta charset=utf-8><i id=t style="position:absolute;width:20px;height:20px;background:#c33"></i><script>let x=0;(function f(){t.style.left=(x++%50)+"px";requestAnimationFrame(f)})()</script>';
const run=async(args,env={})=>{const r=await runtime.runCommand(process.execPath,['tools/diagnostics/find-sync-layers.mjs',...args],{label:'find-sync-layers fixture',timeoutMs:120000,cwd:root,env:{...process.env,HW_SITE_ROOT:dir,HW_SECONDS:'2',...env}});process.stdout.write(r.stdout+r.stderr);return r;};
try{
 for(const [route,html] of [['fixture',fixture],['clean',clean],['blocks',blocks],['around',around],['tick',tick]]){await mkdir(join(dir,route));await writeFile(join(dir,route,'index.html'),html);}
 assert.equal((await run(['--route','clean','--strict'])).status,0,'clean route (incl. paint-less bird-wing replica) must pass --strict');
 assert.equal((await run(['--route','tick','--strict','--json',json+'.tick'])).status,1,'--strict must fail on a page that only ticks the main thread');
 const tk=JSON.parse(await readFile(json+'.tick','utf8')).routes.tick;assert(tk.flags.mainThreadTicking);assert.equal(tk.flags.nonComposited.length,0);
 assert.equal((await run(['--route','fixture,clean,blocks,around','--strict','--json',json])).status,1,'--strict must fail on the width animation');
 const {routes:{fixture:f,clean:c,blocks:b,around:a}}=JSON.parse(await readFile(json,'utf8'));
 assert.equal(f.totals.animations,14);
 assert.deepEqual(f.groups.filter(g=>g.name==='spin').map(g=>g.count).sort(),[1,2],'the -250ms delay puts one spin in its own phase group');
 const flap=f.groups.find(g=>g.name==='flap'&&g.count>1);assert.equal(flap.count,7);assert.equal(flap.parents,4);
 assert(!f.groups.some(g=>g.name==='slide'&&g.count>1),'var()-driven keyframes with different values are not lockstep');
 assert(!f.merges.some(m=>m.name==='slide'&&m.ok),'no OK merge for different --to values');
 assert(f.groups.filter(g=>g.name==='flap').length===2,'an ease-in sibling has different keyframes, so it is not grouped');
 assert(f.merges.some(m=>m.name==='flap'&&m.ok&&m.members.join()==='i,i.clip'),'adjacent same-pivot flap siblings are an OK merge');
 assert(f.merges.some(m=>m.name==='flap'&&!m.ok&&m.why.some(w=>/static transform/.test(w))),'a static rotate beside an animated scale blocks the merge');
 assert(f.merges.some(m=>m.name==='spin'&&!m.ok&&m.why.some(w=>/pivot/.test(w))),'spin siblings at different positions are blocked by pivot');
 assert(f.merges.some(m=>m.name==='spin'&&!m.ok&&m.why.some(w=>/out of phase/.test(w))),'late spin is an out-of-phase near miss');
 assert.deepEqual(f.flags.nonComposited.map(x=>[x.name,x.props.join()]),[['grow','width']]);
 assert(f.idle.recalcs>1,'a width animation ticks style recalcs while idle');
 assert(f.flags.layerEffects.some(e=>e.kind==='clip-path'&&e.label==='i.clip'),'clip-path on an animated layer is flagged');
 assert(f.totals.maskLayers>=1,'clip-path on a composited element makes a mask layer');
 assert(f.totals.overlapLayers>=1,'.cover paints over animated layers');
 assert.equal(c.flags.nonComposited.length,0);assert(c.idle.recalcs<=1,'compositor-only animations do not tick the main thread');assert(!c.flags.mainThreadTicking);
 assert(f.flags.mainThreadTicking,'a width animation ticks the main thread');
 const blocked=(name,re)=>assert(b.merges.some(m=>m.name===name&&!m.ok&&m.why.some(w=>re.test(w))),`${name} merge must be blocked by ${re}`);
 assert(b.merges.some(m=>m.name==='flap'&&m.ok&&m.members.length===2),'the plain adjacent pair is an OK merge');
 blocked('flap',/not adjacent/);blocked('flap',/box size/);blocked('flap',/z-index/);blocked('flap',/other animations/);blocked('flap',/blend/);blocked('flap',/pseudo-element/);
 blocked('fade',/opacity on a wrapper/);
 assert(a.flags.aroundAnimated.some(x=>x.kind==='filter'),'filtered ancestor is listed');assert(a.flags.layerEffects.some(x=>x.kind==='filter'),'filter layer is listed as an effect');
 console.log('find-sync-layers self-test passed');
}finally{await runtime.shutdown('find-sync-layers self-test complete');}
