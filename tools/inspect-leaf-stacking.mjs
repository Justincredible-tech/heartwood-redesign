// Natural hover-and-hold diagnostics plus an every-leaf topmost ("stuck in canopy") check;
// never forces CSS transition progress except where a mode pauses/seeks transitions identically in both routes.
// HW_CANDIDATE_ROUTE (default optimized) is compared to /local/. While probing, every painted `.tree` descendant
// (except the pointer-less leaf wrappers) is made hit-testable via CSSOM inline style so elementFromPoint sees the
// pointer-events:none art (fill leaves, is-plain, .cut sheets); the IDENTITY of the topmost element is compared per grid point.
// Env: HW_SITE_ROOT, HW_OUT, HW_STACK_HOLD=1 (opt-in hover-and-hold section, off by default: the topmost check supersedes it), HW_STACK_SIZES=1365x768@1,1424x820@2,
// HW_STACK_MODES=hover,focus,focus-hover,lit,trans (all but hover sample HW_STACK_SAMPLE=20 leaves), HW_STACK_LIMIT=N (first N leaves),
// HW_STACK_SELFTEST=hover|lit injects a z-index mirror removal into the candidate only; the run must then report mismatches.
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
browserToolCLI({});
const out=resolve(process.env.HW_OUT||'output/playwright/leaf-stacking');await mkdir(out,{recursive:true});
const siteRoot=resolve(process.env.HW_SITE_ROOT||'publish');
const candidate=process.env.HW_CANDIDATE_ROUTE||'optimized',routes=['local',candidate];
const sizes=(process.env.HW_STACK_SIZES||'1365x768@1').split(',').map(s=>{const [w,h,d]=s.split(/[x@]/).map(Number);return{width:w,height:h,dpr:d};});
const modes=(process.env.HW_STACK_MODES||'hover,focus,focus-hover,lit,trans').split(','),sample=Number(process.env.HW_STACK_SAMPLE||20),limit=Number(process.env.HW_STACK_LIMIT||0);
const SELF={hover:'.tree .hw-leaf-layer:has(>button.leaf:hover){z-index:auto!important}',lit:'.tree.is-filtered .hw-leaf-layer:has(>.leaf.is-lit){z-index:auto!important}'},selftest=process.env.HW_STACK_SELFTEST||'';
if(selftest&&!SELF[selftest])throw Error('HW_STACK_SELFTEST must be hover or lit');
for(const size of sizes)if(![size.width,size.height,size.dpr].every(v=>Number.isFinite(v)&&v>0))throw Error('HW_STACK_SIZES dimensions must be finite and positive');
for(const mode of modes)if(!['hover','focus','focus-hover','lit','trans'].includes(mode))throw Error('Unknown HW_STACK_MODES entry '+JSON.stringify(mode));
if(!Number.isInteger(sample)||sample<=0||!Number.isInteger(limit)||limit<0)throw Error('HW_STACK_SAMPLE must be a positive integer and HW_STACK_LIMIT a nonnegative integer');
const fixture=await browserFixture();
const report={selftest,candidate,siteRoot,browser:fixture.browser.version(),htmlSha256:createHash('sha256').update(await readFile(resolve(siteRoot,candidate,'index.html'))).digest('hex'),errors:[],holdFailures:[],hold:[],topmost:[]};
async function open(size,route,probing){
 const context=await fixture.browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr}),page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(route+': '+e.message));
 await page.goto(`${fixture.base}/${route}/`,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(2000);
 await page.evaluate(()=>{for(const a of document.getAnimations())if(a instanceof CSSAnimation){a.pause();a.currentTime=4000;}});
 if(probing)await page.evaluate(css=>{
  if(css){const sheet=new CSSStyleSheet();sheet.replaceSync(css);document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];}
  const t=document.querySelector('.tree');for(const e of t.querySelectorAll('*'))if(!e.classList.contains('hw-leaf-layer'))e.style.setProperty('pointer-events','auto','important');
  // Stable identity of the topmost element: tag+sibling-index path inside .tree, the candidate's leaf wrappers transparent.
  window.__d=e=>{if(!e)return'null';if(!t.contains(e))return'out:'+e.localName+'.'+(typeof e.className==='string'?e.className.trim().split(/\s+/).join('.'):'');const p=[];for(let n=e;n&&n!==t;n=n.parentElement){if(n.classList.contains('hw-leaf-layer'))continue;const s=n.parentElement.classList.contains('hw-leaf-layer')?n.parentElement:n;p.push(n.localName+[...s.parentElement.children].indexOf(s));}return p.reverse().join('/');};
  window.__leaf=id=>document.querySelector(`button.leaf[data-leaf="${id}"]`);
  window.__snap=(id,n)=>{const r=__leaf(id).getBoundingClientRect(),o=[];for(let i=0;i<n;i++)for(let j=0;j<n;j++)o.push(__d(document.elementFromPoint(r.x+r.width*(i+.5)/n,r.y+r.height*(j+.5)/n)));return o;};
 },route===candidate?SELF[selftest]||'':'');
 return{context,page};
}
// Wait for every CSS transition (the 280ms lift) to finish, then two frames.
const settle=page=>page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a instanceof CSSTransition).map(a=>a.finished.catch(()=>0)));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
// Pause and seek every CSS transition to t ms, then two frames; fin completes them again.
const seek=(page,t)=>page.evaluate(async t=>{await new Promise(r=>requestAnimationFrame(r));await Promise.all(document.getAnimations().filter(a=>a instanceof CSSTransition).map(async a=>{a.pause();await a.ready;a.currentTime=t;}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},t);
const fin=page=>page.evaluate(()=>{for(const a of document.getAnimations())if(a instanceof CSSTransition)a.finish();});
// Per leaf, per mode: labelled 9x9 identity snapshots. `ref` absent = original (also picks scroll and an exposed hover point), present = candidate at the same scroll/point.
async function probe(page,mode,ids,ref){
 const res={},focusing=mode.startsWith('focus'),hovering=['hover','focus-hover','trans'].includes(mode);if(focusing)await page.keyboard.press('Tab');
 for(const id of ids){
  if(ref&&!ref[id])continue;
  await page.mouse.move(2,2);
  const base=await page.evaluate(({id,y,pick})=>{
   const tree=document.querySelector('.tree');tree.classList.remove('is-filtered');for(const l of tree.querySelectorAll('.is-lit'))l.classList.remove('is-lit');document.activeElement?.blur?.();
   const leaf=__leaf(id);
   if(y==null){const r=leaf.getBoundingClientRect();if(r.top<60||r.bottom>innerHeight-20)leaf.scrollIntoView({block:'center',behavior:'instant'});}else scrollTo({top:y,behavior:'instant'});
   const r=leaf.getBoundingClientRect(),c=[];if(pick)for(let i=0;i<7;i++)for(let j=0;j<7;j++){const x=r.x+r.width*(i+.5)/7,y=r.y+r.height*(j+.5)/7;if(document.elementFromPoint(x,y)?.closest('button.leaf')===leaf)c.push({x,y});}
   if(!c.length)return{scrollY,hover:null};const cx=c.reduce((s,p)=>s+p.x,0)/c.length,cy=c.reduce((s,p)=>s+p.y,0)/c.length;
   return{scrollY,hover:c.sort((a,b)=>Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy))[0]};
  },{id,y:ref?ref[id].scrollY:null,pick:!ref&&hovering});
  const hover=ref?ref[id].hover:base.hover;
  if(hovering&&!hover){res[id]=null;continue;}
  await settle(page);
  if(mode==='lit'&&!await page.evaluate(id=>{const c=document.querySelector(`#key-chips .chip[data-filter="${__leaf(id).dataset.kind}"]`);if(c)c.click();return!!c;},id)){res[id]=null;continue;}
  if(focusing)await page.evaluate(id=>__leaf(id).focus({preventScroll:true}),id);
  if(hovering)await page.mouse.move(hover.x,hover.y);
  const snaps={},meta={},S=async label=>{[snaps[label],meta[label]]=await page.evaluate(id=>[__snap(id,9),{hovered:document.querySelector('button.leaf:hover')?.dataset.leaf??null,fv:__leaf(id).matches(':focus-visible'),lit:__leaf(id).classList.contains('is-lit')}],id);};
  if(mode==='trans'){await seek(page,0);await S('hover-0');await seek(page,140);await S('hover-140');await fin(page);await settle(page);await S('hover-settled');await page.mouse.move(2,2);await seek(page,140);await S('leave-140');await fin(page);await settle(page);await S('leave-settled');}
  else{await settle(page);await S(mode);}
  if(mode==='lit')await page.evaluate(()=>document.querySelector('#key-chips .chip[data-filter="all"]').click());
  res[id]={scrollY:base.scrollY,hover,snaps,meta};
 }
 await page.mouse.move(2,2);
 return res;
}
const compare=(r,c)=>{const bad=[];for(const k of Object.keys(r.snaps)){if(JSON.stringify(r.meta[k])!==JSON.stringify(c.meta[k]))bad.push({label:k,meta:[r.meta[k],c.meta[k]]});r.snaps[k].forEach((o,i)=>{if(o!==c.snaps[k][i])bad.push({label:k,point:i,original:o,candidate:c.snaps[k][i]});});}return bad;};
try{
 if(process.env.HW_STACK_HOLD==='1')for(const route of routes){
  const {context,page}=await open({width:1424,height:820,dpr:2},route);
  try{
   const points=await page.evaluate(()=>{const points=[],seen=new Set();for(let y=130;y<370;y+=20)for(let x=450;x<970;x+=20){const leaf=document.elementFromPoint(x,y)?.closest('button.leaf[data-item]');if(leaf&&!seen.has(leaf)){seen.add(leaf);points.push({x,y,id:leaf.dataset.leaf});}}return points.filter((_,i)=>i%8===0).slice(0,8);});
   for(const point of points){
    await page.mouse.move(2,2);await page.waitForTimeout(400);
    const state=()=>page.evaluate(point=>{
      const leaf=document.querySelector(`button.leaf[data-leaf="${point.id}"]`),layer=leaf.parentElement?.classList.contains('hw-leaf-layer')?leaf.parentElement:null,face=leaf.querySelector('.leaf__face');
      const info=el=>{if(!el)return null;const s=getComputedStyle(el),r=el.getBoundingClientRect();return{rect:r.toJSON(),transform:s.transform,scale:s.scale,translate:s.translate,filter:s.filter,overflow:s.overflow,clipPath:s.clipPath,zIndex:s.zIndex,contain:s.contain,willChange:s.willChange,pointerEvents:s.pointerEvents,opacity:s.opacity};};
      const r=face.getBoundingClientRect();return{pointHit:document.elementFromPoint(point.x,point.y)?.closest('.leaf')?.dataset.leaf,centerHit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.leaf')?.dataset.leaf,hovered:document.querySelector('button.leaf:hover')?.dataset.leaf,leaf:info(leaf),layer:info(layer),face:info(face)};
    },point);
    const before=await state();await page.mouse.move(point.x,point.y);await page.waitForTimeout(350);const held=await state();await page.waitForTimeout(650);const later=await state();
    await page.screenshot({path:resolve(out,`${route}-${point.id}-held.png`)});
    // Hold expectations (both routes): the hit leaf is the hovered one, lifted to z5 with visible overflow, a real transform and no clip.
    const want={hovered:point.id,pointHit:point.id,zIndex:'5',overflow:'visible'};
    for(const [k,v] of Object.entries({hovered:later.hovered,pointHit:later.pointHit,zIndex:later.leaf.zIndex,overflow:later.leaf.overflow}))if(v!==want[k])report.holdFailures.push({route,id:point.id,field:k,expected:want[k],actual:v});
    if(later.leaf.transform==='none'||later.leaf.clipPath!=='none')report.holdFailures.push({route,id:point.id,field:'transform/clipPath',actual:[later.leaf.transform,later.leaf.clipPath]});
    report.hold.push({route,point,before,held,later});console.log(JSON.stringify({route,id:point.id,beforeHit:before.pointHit,heldHit:held.pointHit,laterHit:later.pointHit,hovered:later.hovered,centerHit:later.centerHit,transform:later.leaf.transform,z:later.leaf.zIndex,overflow:later.leaf.overflow,layerZ:later.layer?.zIndex,layerWillChange:later.layer?.willChange}));
   }
  }finally{await context.close();}
 }
 for(const [i,r] of report.hold.entries()){const m=report.hold.find((x,j)=>j!==i&&x.route!==r.route&&x.point.id===r.point.id);if(m&&r.route==='local')for(const k of ['transform','filter','zIndex','overflow'])if(r.later.leaf[k]!==m.later.leaf[k])report.holdFailures.push({id:r.point.id,field:k,original:r.later.leaf[k],candidate:m.later.leaf[k]});}
 if(report.holdFailures.length){console.log('HOLD FAILURES',JSON.stringify(report.holdFailures.slice(0,10)));process.exitCode=1;}
 for(const size of sizes){
  const o=await open(size,'local',true),c=await open(size,candidate,true);
  try{
   let ids=await o.page.evaluate(()=>[...document.querySelectorAll('.tree > button.leaf[data-leaf], .tree > .hw-leaf-layer > button.leaf[data-leaf]')].map(l=>l.dataset.leaf));
   if(limit)ids=ids.slice(0,limit);
   for(const mode of modes){
    const sub=mode==='hover'?ids:ids.filter((_,i)=>i%Math.max(1,Math.ceil(ids.length/sample))===0),t0=Date.now();
    const ref=await probe(o.page,mode,sub),res=await probe(c.page,mode,sub,ref);
    const skipped=sub.filter(id=>!ref[id]),mismatches=sub.filter(id=>ref[id]&&res[id]).map(id=>({leaf:id,bad:compare(ref[id],res[id])})).filter(m=>m.bad.length);
    const row={size,mode,selftest,leaves:sub.length,skippedNoExposedPoint:skipped.length,checkedLeaves:sub.length-skipped.length,points:sub.reduce((n,id)=>n+(ref[id]?Object.values(ref[id].snaps).reduce((m,a)=>m+a.length,0):0),0),mismatchedLeaves:mismatches.length,mismatchedPoints:mismatches.reduce((n,m)=>n+m.bad.length,0),seconds:(Date.now()-t0)/1000};
    report.topmost.push({...row,mismatches});console.log(JSON.stringify(row));for(const m of mismatches.slice(0,10))console.log('MISMATCH',mode,JSON.stringify({leaf:m.leaf,n:m.bad.length,first:m.bad.slice(0,3)}));
    if(mismatches.length||skipped.length)process.exitCode=1;
   }
  }finally{await o.context.close();await c.context.close();}
 }
}finally{await fixture.close();if(report.errors.length){console.log('PAGE ERRORS',JSON.stringify(report.errors.slice(0,5)));process.exitCode=1;}await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
