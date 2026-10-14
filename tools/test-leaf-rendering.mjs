// Fixed animation-time fidelity for the small canopy leaf, including the
// shadow, focus ring and category filtering. This reads the actual artifact.
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {PNG} from './fidelity-deps.mjs';
import pixelmatch from './fidelity-deps.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {artworkMasks,compareFidelity,assertFidelity,FIDELITY_POLICY} from './fidelity-acceptance.mjs';
browserToolCLI({"pixels":{"type":"boolean"},"report-only":{"type":"boolean"}});
const out=resolve(process.env.HW_OUT||'output/playwright/leaf-rendering');await mkdir(out,{recursive:true});
const fixture=await browserFixture();
const report={browser:fixture.browser.version(),override:process.env.HW_LEAF_OVERRIDE||null,reducedMotion:process.env.HW_REDUCED_MOTION==='1',htmlSha256:createHash('sha256').update(await readFile(resolve(process.env.HW_SITE_ROOT||'publish','optimized/index.html'))).digest('hex'),pixelPolicy:{threshold:.1,includeAA:false,...FIDELITY_POLICY,referenceMasksOnly:true,ceilingUnits:'CSS pixels'},cases:[]};
const states=(process.env.HW_LEAF_STATES||'rest,hover-0,hover-140,hover-280,leave-140,focus,focus-hover,filtered,filtered-lit,filtered-lit-hover').split(',');
const sizes=process.env.HW_WIDTH?[{width:Number(process.env.HW_WIDTH),height:820,dpr:Number(process.env.HW_DPR||1)}]:[{width:1365,height:768,dpr:1},{width:1424,height:820,dpr:2},{width:390,height:844,dpr:1}];
async function capture(route,size,state,point,second=false){
 const debug=message=>{if(process.env.HW_DEBUG)console.log(`${route} ${state}: ${message}`);};
 const context=await fixture.browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr,...(process.env.HW_REDUCED_MOTION==='1'?{reducedMotion:'reduce'}:{}),bypassCSP:!!report.override});
 try{
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Animation.enable');await cdp.send('Animation.setPlaybackRate',{playbackRate:0});
  await page.goto(`${fixture.base}/${route}/`,{waitUntil:'load'});debug('loaded');await page.evaluate(()=>document.fonts.ready);debug('fonts');
  if(process.env.HW_LEAF_OVERRIDE&&(process.env.HW_LEAF_OVERRIDE_BOTH==='1'||second))await page.addStyleTag({content:process.env.HW_LEAF_OVERRIDE});debug('override');
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(async a=>{a.pause();await a.ready;a.currentTime=4000;}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  debug('animations frozen');if(!point)point=await page.evaluate(()=>{
    // Find an exposed, seated leaf through real hit-testing, away from header.
    for(let y=innerHeight*.35;y>100;y-=8)for(let x=innerWidth*.5;x<innerWidth*.68;x+=8){const leaf=document.elementFromPoint(x,y)?.closest('button.leaf[data-item]');if(leaf)return{x,y,id:leaf.dataset.leaf};}
    // Narrow layouts: the canopy is not in the desktop band, so scan the whole viewport below the header.
    for(let y=innerHeight*.7;y<innerHeight-20;y+=6)for(let x=innerWidth*.25;x<innerWidth*.75;x+=6){const leaf=document.elementFromPoint(x,y)?.closest('button.leaf[data-item]');if(leaf)return{x,y,id:leaf.dataset.leaf};}
    throw Error('No exposed seated leaf');
  });
  debug('selected '+point.id);const selected=`button.leaf[data-leaf="${point.id}"]`;
  async function freezeTransitions(time){await page.evaluate(async time=>{await Promise.all(document.getAnimations().filter(a=>a instanceof CSSTransition).map(async a=>{a.pause();await a.ready;a.currentTime=time;}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},time);}
  if(state==='focus'){await page.keyboard.press('Tab');await page.locator(selected).focus();await freezeTransitions(280);assert(await page.locator(selected).evaluate(el=>el.matches(':focus-visible')));}
  else if(state==='focus-hover'){await page.keyboard.press('Tab');await page.locator(selected).focus();await page.mouse.move(point.x,point.y);assert.equal(await page.evaluate(()=>document.querySelector('button.leaf:hover')?.dataset.leaf),point.id,'Same leaf must be hit in both captures');await freezeTransitions(280);assert(await page.locator(selected).evaluate(el=>el.matches(':focus-visible')));}
  else if(state!=='rest'){
    // filtered-lit drives the real chip (lights every leaf of the kind, no hover); filtered-lit-hover lights only the target and hovers it.
    if(state==='filtered-lit')await page.evaluate(selected=>document.querySelector(`#key-chips .chip[data-filter="${document.querySelector(selected).dataset.kind}"]`).click(),selected);
    else if(state.startsWith('filtered'))await page.evaluate(({selected,state})=>{const leaf=document.querySelector(selected);document.querySelector('.tree').classList.add('is-filtered');leaf.classList.toggle('is-lit',state==='filtered-lit-hover');},{selected,state});
    if(!['filtered','filtered-lit'].includes(state)){
    await page.mouse.move(point.x,point.y);assert.equal(await page.evaluate(()=>document.querySelector('button.leaf:hover')?.dataset.leaf),point.id,'Same leaf must be hit in both captures');
    await freezeTransitions(state==='hover-0'?0:state==='hover-140'?140:280);
    if(state==='leave-140'){await page.mouse.move(2,2);await freezeTransitions(140);}
    }else await freezeTransitions(280);
  }
  debug('state applied');
  // Tooltip timing is unrelated to canopy art; freeze its own fade identically.
  await page.evaluate(()=>{for(const a of document.querySelector('#leaftag').getAnimations())a.currentTime=200;});
  const geometry=await page.locator(selected).evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),layer=el.parentElement?.classList.contains('hw-leaf-layer')?el.parentElement:null;return{box:{x:r.x,y:r.y,width:r.width,height:r.height},transform:s.transform,opacity:s.opacity,filter:s.filter,overflow:s.overflow,clipPath:s.clipPath,zIndex:s.zIndex,layerZIndex:layer?getComputedStyle(layer).zIndex:null,layerWillChange:layer?getComputedStyle(layer).willChange:null,focus:el.matches(':focus-visible')};});
  const maskInputs=await page.evaluate(()=>{
    const box=e=>{const r=e.getBoundingClientRect();return r.width&&r.height?[r.left,r.top,r.right,r.bottom]:null;},all=s=>[...document.querySelectorAll(s)].map(box).filter(Boolean),text=[];
    const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let n;n=walk.nextNode();){if(!n.textContent.trim()||n.parentElement.closest('.tree,script,style,noscript'))continue;const r=document.createRange();r.selectNodeContents(n);for(const k of r.getClientRects())if(k.width&&k.height)text.push([k.left,k.top,k.right,k.bottom]);}
    return{cssWidth:innerWidth,cssHeight:innerHeight,leafRects:all('.tree button.leaf, .tree span.leaf'),protectedRects:[...all('a, button:not(.tree *):not(.trunk), #key-chips .chip, input, select, textarea'),...text]};
  });
  const png=PNG.sync.read(await page.screenshot());
  // This second capture supplies original tree paint for the same interactive
  // state. Tooltip/focus/UI remain protected by their correctly scaled rects.
  await page.evaluate(()=>{const s=new CSSStyleSheet();s.replaceSync('html,body{background:#f0f!important}body *{visibility:hidden!important}.tree,.tree *,button.trunk,button.trunk *{visibility:visible!important}');document.adoptedStyleSheets=[...document.adoptedStyleSheets,s];return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const only=PNG.sync.read(await page.screenshot()),treePaint=new Uint8Array(only.width*only.height);
  for(let p=0;p<treePaint.length;p++){const i=p*4;treePaint[p]=only.data[i]!==255||only.data[i+1]!==0||only.data[i+2]!==255?1:0;}
  return{point,geometry,png,maskInputs:{...maskInputs,treePaint},errors};
 }finally{await context.close();}
}
try{
 for(const size of sizes)for(const state of states){
  if(state==='rest'&&size.dpr===1&&!process.env.HW_LEAF_STATES&&!process.env.HW_WIDTH)continue;   // default matrix: rest runs at dpr2 only (the dpr1 rest cases were redundant); LEAF_CEILING keeps their entries for explicit HW_LEAF_STATES/HW_WIDTH runs
  const a=await capture('local',size,state);const b=await capture(process.env.HW_LEAF_REPEAT==='1'?'local':'optimized',size,state,a.point,true);
  const diff=new PNG({width:a.png.width,height:a.png.height});const pixels=pixelmatch(a.png.data,b.png.data,diff.data,diff.width,diff.height,{threshold:.1});
  const measured=compareFidelity(a.png,b.png,diff.data,artworkMasks({png:a.png,...a.maskInputs}));assert.equal(measured.pixels,pixels);
  let above10=0;for(let i=0;i<a.png.data.length;i+=4){let d=0;for(let c=0;c<4;c++)d=Math.max(d,Math.abs(a.png.data[i+c]-b.png.data[i+c]));if(d>10)above10++;}
  const key=`${size.width}-dpr${size.dpr}-${state}${report.reducedMotion?'-rm':''}`;for(const [label,png]of[['original',a.png],['optimized',b.png],['diff',diff]])await writeFile(resolve(out,`${key}-${label}.png`),PNG.sync.write(png));
  const row={...size,state,point:a.point,...measured,above10,maxDelta:measured.maxChannelDelta,reducedMotion:report.reducedMotion,original:a.geometry,optimized:b.geometry,errors:[...a.errors,...b.errors]};report.cases.push(row);console.log(JSON.stringify(row));
 }
}finally{await fixture.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
// Geometry, location, edge and perceptual gates always run, including
// --report-only. --pixels additionally requires strict-zero threshold counts.
// LEAF_CEILING[`${width}-dpr${dpr}-${state}`] = most threshold-diff pixels allowed per case: the user-accepted sub-pixel raster-edge deviation of the leaf layers
// (measured max over output/playwright/review-t8-leaf-rendering*, review-verify-leaf-rm, review-t9-leaf-rendering*, + ~10%; 0 = states that measured identical; 1424-dpr2-hover-0 measured 5 once in 5 runs, a capture-timing flake). It must NEVER be raised to
// hide a regression. Physical counts are normalized by DPR squared; the
// ceiling itself is unchanged. Both ceilings and maxChannelDelta <= LEAF_MAX_DELTA are asserted always, also with --report-only. `--pixels` = strict-zero mode, only for
// builds without leaf layers (--cache-leaves off) where the shipped output must equal the original exactly.
const LEAF_MAX_DELTA=90,LEAF_CEILING={
 '1365-dpr1-rest':321,'1365-dpr1-hover-0':0,'1365-dpr1-hover-140':9,'1365-dpr1-hover-280':313,'1365-dpr1-leave-140':2,'1365-dpr1-focus':313,'1365-dpr1-focus-hover':323,'1365-dpr1-filtered':268,'1365-dpr1-filtered-lit':307,'1365-dpr1-filtered-lit-hover':270,
 '1424-dpr2-rest':893,'1424-dpr2-hover-0':6,'1424-dpr2-hover-140':0,'1424-dpr2-hover-280':873,'1424-dpr2-leave-140':0,'1424-dpr2-focus':916,'1424-dpr2-focus-hover':915,'1424-dpr2-filtered':756,'1424-dpr2-filtered-lit':762,'1424-dpr2-filtered-lit-hover':756,
 '390-dpr1-rest':77,'390-dpr1-hover-0':0,'390-dpr1-hover-140':0,'390-dpr1-hover-280':68,'390-dpr1-leave-140':11,'390-dpr1-focus':73,'390-dpr1-focus-hover':72,'390-dpr1-filtered':76,'390-dpr1-filtered-lit':77,'390-dpr1-filtered-lit-hover':66};
if(!report.override){
 const expectZ={'focus-hover':'5','filtered-lit':'4'},near=(a,b)=>Math.abs(a-b)<=.01;
 assert(report.cases.every(c=>c.errors.length===0),'Page errors');
 for(const c of report.cases){const key=`${c.width}-dpr${c.dpr}-${c.state}`,ceiling=process.env.HW_LEAF_REPEAT==='1'?0:LEAF_CEILING[key];
  assert(ceiling!==undefined,`No LEAF_CEILING for ${key}: measure it on a known-good build and add it to tools/test-leaf-rendering.mjs`);
  // Keep the measured physical-pixel limits and normalize by the known DPR
  // before comparing to the helper's CSS-pixel count; no Infinity escape.
  assertFidelity(c,{ceilingCSSPixels:ceiling/(c.dpr*c.dpr),strictZero:process.argv.includes('--pixels')||process.env.HW_LEAF_REPEAT==='1'});
  assert(c.maxChannelDelta<=LEAF_MAX_DELTA,`${key}: a channel differs by ${c.maxChannelDelta} (> ${LEAF_MAX_DELTA})`);}
 assert(report.cases.every(c=>c.original.zIndex===c.optimized.zIndex&&(c.optimized.layerZIndex==null||c.optimized.layerZIndex===c.optimized.zIndex)),'Leaf z-index/layer mismatch');
 assert(report.cases.every(c=>!expectZ[c.state]||(c.original.zIndex===expectZ[c.state]&&c.optimized.zIndex===expectZ[c.state])),'Unexpected z-index for focus-hover (5) / filtered-lit (4)');
 assert(report.cases.every(c=>['x','y','width','height'].every(k=>near(c.original.box[k],c.optimized.box[k]))&&['transform','filter','opacity','overflow','clipPath','focus'].every(k=>c.original[k]===c.optimized[k])),'Leaf geometry/filter/transform mismatch');
}
if(!process.argv.includes('--report-only')||process.argv.includes('--pixels'))assert(!report.override,'Injected CSS is diagnostic only');
if(process.argv.includes('--pixels'))assert(report.cases.every(c=>c.pixels===0),'Leaf rendering changed; inspect saved diffs');   // strict-zero only on request (see header comment above); the default gate is the ceilings
else if(report.override)console.log('Diagnostic override active: equality gates skipped');
