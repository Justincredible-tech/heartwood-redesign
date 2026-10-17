/** Serial browser check of the opt-in "Taste you didn't ask for" Network hover against a served artifact.
 * npm run build && node tools/verify-taste.mjs
 * HW_SITE_ROOT=/tmp/hw-taste-XXXX/site HW_OUT=output/playwright/review-taste node tools/verify-taste.mjs
 * Writes report.json and screenshots (taste beside the /local/ equivalent) to HW_OUT. One browser, one page at a time.
 * The "one route at a time" invariant walks run under plain Chrome, Dark Reader (the open-source library injected like the extension) and Chrome's forced dark mode.
 * Dark Reader: set HW_DARKREADER=/path/to/darkreader.js; HW_NO_DARKREADER=1 skips it, loudly.
 * HW_WALK_STEPS=300 sets the walk length; HW_ONLY=<part of a case name> runs matching cases.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {extractNetwork,pick,tasteSource,withSporeAt} from './taste-network.mjs';
import {compareRasterEdges} from './fidelity-acceptance.mjs';
import {loadSharp} from './sharp-deps.mjs';

browserToolCLI({});
const siteRoot=resolve(process.env.HW_SITE_ROOT||new URL('../publish',import.meta.url).pathname);
const out=resolve(process.env.HW_OUT||new URL('../output/playwright/review-taste',import.meta.url).pathname);
const runtime=ensureToolRuntime({name:'taste Network verification',runTimeoutMs:60*60*1000});await runtime.ready;
await runtime.deadline('prepare verification output',()=>mkdir(out,{recursive:true}),{timeoutMs:5000});
const sha=b=>createHash('sha256').update(b).digest('hex');
const tasteHtml=await readRegularInput(resolve(siteRoot,'optimized-taste/index.html'),{runtime});
const N=extractNetwork(await readRegularInput(resolve(siteRoot,'local/index.html'),{runtime}));
const DEAD=N.dead;   // derived from the markup; the pinned list below makes a Network edit fail loudly
assert.deepEqual(DEAD,[1,5,9,11,21,27,31,35,41],'dead-end strips changed. If the Network was deliberately edited, update the expected counts in tools/taste-network.mjs, DEAD/hub/fade in tests/taste-network.test.mjs, and DEAD in tools/verify-taste.mjs.');
const report={generatedAt:new Date().toISOString(),siteRoot,htmlSha256:sha(tasteHtml),viewport:{width:1365,height:768},cases:[],resources:{}};
const fx=await browserFixture({siteRoot,runtime,runTimeoutMs:60*60*1000});   // the full case list (three 300-step walks) takes 20 to 30 minutes
const {browser,base}=fx;
const requireDarkReaderPath=()=>{const value=process.env.HW_DARKREADER;if(!value||!value.trim())throw Error('UNSUPPORTED: Dark Reader is not available; set HW_DARKREADER to a darkreader.js path or set HW_NO_DARKREADER=1 to skip it explicitly (see docs/TESTING.md)');return value.trim();};
const DARKREADER=()=>resolve(requireDarkReaderPath());
let forcedBrowser=null;
const TASTE='/optimized-taste/',FAITHFUL='/optimized/',LOCAL='/local/';
const unit=(i)=>[N.spores[2*i],N.spores[2*i+1]];
const polar=(r,deg)=>[N.cx+r*Math.cos(deg*Math.PI/180),N.cy+r*Math.sin(deg*Math.PI/180)];
const away=(i,d)=>{const [x,y]=unit(i),r=Math.hypot(x-N.cx,y-N.cy);return [x+d*(x-N.cx)/r,y+d*(y-N.cy)/r];};
const firsts=N.paths.map((k,i)=>i).filter(i=>!N.paths.some(o=>o!==N.paths[i]&&N.paths[i].startsWith(o+' ')));
const pathIds=i=>N.paths[i].split(' ').map(Number);
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));

async function open(route,{touch=false,tablet=false,scheme='light',mode='plain',setup,bypass=false,dpr=1}={}){
  if(mode==='forced')forcedBrowser||=await fx.launch(['--force-dark-mode','--enable-features=WebContentsForceDark']);   // Chrome's own forced dark
  const context=await (mode==='forced'?forcedBrowser:browser).newContext({colorScheme:mode==='forced'?'dark':scheme,bypassCSP:mode==='dr'||bypass,deviceScaleFactor:dpr,viewport:touch?(tablet?{width:1100,height:820}:{width:390,height:844}):report.viewport,...(touch&&{hasTouch:true,isMobile:true})});
  const page=await context.newPage(),errors=[];
  if(setup)await setup(context);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__raf={taste:0,all:0,moves:0,csp:[],picks:[],frames:[],framesTotal:[],listeners:0};
    let disp=0,depth=0;const dispatch=EventTarget.prototype.dispatchEvent;EventTarget.prototype.dispatchEvent=function(e){if(depth++)try{return dispatch.call(this,e);}finally{depth--;}const s=performance.now();try{return dispatch.call(this,e);}finally{depth--;disp+=performance.now()-s;}};
    const orig=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>{window.__raf.all++;if(/\/assets\/taste\./.test(new Error().stack)){window.__raf.taste++;const f=cb;cb=t=>{const s=performance.now();disp=0;try{f(t);}finally{const d=performance.now()-s;window.__raf.frames.push(d-disp);window.__raf.framesTotal.push(d);}};}return orig(cb);};   // frames: taste's own frame callback (pick + DOM updates) minus time inside the synthetic pointerenter/leave dispatch, i.e. the site's own hover handlers (identical to a real hover); framesTotal includes them
    const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(...a){if(/\/assets\/taste\./.test(new Error().stack))window.__raf.listeners++;return add.apply(this,a);};
    document.addEventListener('pointermove',()=>window.__raf.moves++,true);
    document.addEventListener('securitypolicyviolation',e=>window.__raf.csp.push(e.violatedDirective));
    document.addEventListener('leaf:pick',e=>window.__raf.picks.push({id:e.detail.id,title:e.detail.item&&e.detail.item.title}));
  });
  if(mode==='dr'){
    assert(existsSync(DARKREADER()),'Dark Reader library not found at '+DARKREADER()+' (see the header of tools/verify-taste.mjs)');
    await page.addInitScript({content:await readRegularInput(DARKREADER(),{runtime,syntax:'script'})+';document.addEventListener("DOMContentLoaded",()=>DarkReader.enable({brightness:100,contrast:100,sepia:0}));'});
  }
  await page.goto(base+route,{waitUntil:'load'});
  await page.waitForFunction(()=>window.leafLift&&document.querySelectorAll('#net .spore').length>0);
  await page.waitForTimeout(3500);                                   // canopy entrance finishes before a real pointer hit
  await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForTimeout(300);
  if(mode==='dr')assert(await page.evaluate(()=>document.querySelectorAll('style.darkreader').length>0),'Dark Reader is active');
  return {context,page,errors};
}
const rect=page=>page.evaluate(()=>{const b=document.querySelector('#net .net__stage').getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height};});
async function move(page,pt,steps=1){const b=await rect(page);await page.mouse.move(b.left+pt[0]*b.width/N.w,b.top+pt[1]*b.height/N.h,{steps});await settle(page);}
const clientOf=async(page,pt)=>{const b=await rect(page);return [b.left+pt[0]*b.width/N.w,b.top+pt[1]*b.height/N.h];};
const snapshot=page=>page.evaluate(()=>{
  const net=document.getElementById('net'),hub=net.querySelector('.net__hub'),stage=net.querySelector('.net__stage'),tag=document.getElementById('leaftag'),ov=net.querySelector('.hw-taste-ov');
  const id=i=>+(i.dataset.of||i.id).slice(3);
  return {paper:hub.classList.contains('hw-taste-glow')?'glow':'',
    painted:ov?[...ov.querySelectorAll(':scope > i.on:not(.occ),:scope > i.tip')].map(i=>({id:id(i),tip:i.classList.contains('tip'),a:ov.style.getPropertyValue('--hw-a'),stop:ov.style.getPropertyValue('--hw-stop')})):[],   // lit twins on the overlay (the painted route)
    lit:[...net.querySelectorAll('.net__hyphae:not(.hw-taste-ov) > i.is-lit')].map(id).sort((a,b)=>a-b),   // the site's own lit strips on the base
    snapped:[...net.querySelectorAll('.spore.hw-taste-snap')].map(s=>s.dataset.item),
    cursor:stage.classList.contains('hw-taste-pointer')?'pointer':'',tag:tag.classList.contains('is-on')?tag.textContent:'',
    inlineColour:[...net.querySelectorAll('[style]')].filter(e=>/background|color|--c\b|--paper|scale|z-index|cursor|darkreader/.test(e.getAttribute('style'))).length};
});
const clean=s=>!s.paper&&!s.painted.length&&!s.snapped.length&&!s.cursor&&!s.inlineColour;
const sorted=a=>[...a].sort((x,y)=>x-y);
const hover=page=>page.evaluate(()=>{
  const s=[...document.querySelectorAll('#net .spore')].find(x=>x.matches(':hover'));if(!s)return null;const c=getComputedStyle(s);
  return {item:s.dataset.item,scale:c.scale,z:c.zIndex,c:c.getPropertyValue('--c').trim()};});
const computedOf=(page,item)=>page.evaluate(i=>{const s=document.querySelector(`#net .spore[data-item="${i}"]`),c=getComputedStyle(s);return {item:i,scale:c.scale,z:c.zIndex,c:c.getPropertyValue('--c').trim()};},item);
const itemOf=(page,i)=>page.evaluate(k=>document.querySelectorAll('#net .spore')[k].dataset.item,i);
const labelOf=(page,i)=>page.evaluate(k=>document.querySelectorAll('#net .spore')[k].getAttribute('aria-label'),i);
async function shot(page,name){const b=await rect(page);const buf=await page.screenshot({clip:{x:Math.max(0,b.left),y:Math.max(0,b.top),width:b.width,height:Math.min(b.height,768-Math.max(0,b.top))}});await writeFile(resolve(out,name+'.png'),buf);return buf;}
async function sideBySide(context,name,left,right){
  const p=await context.newPage();
  const img=(b,l)=>`<figure style="margin:0"><img style="display:block" src="data:image/png;base64,${b.toString('base64')}"><figcaption style="font:14px sans-serif;color:#fff;padding:4px">${l}</figcaption></figure>`;
  await p.setContent(`<body style="margin:0;background:#222;display:flex;gap:12px;align-items:flex-start">${img(left[0],left[1])}${img(right[0],right[1])}</body>`);
  await p.waitForLoadState('load');await writeFile(resolve(out,name+'.png'),await p.screenshot({fullPage:true}));await p.close();
}
// Computed look of every Network element as comparable strings (backgrounds hashed, incl. the ::before layers; spore scale / z-index / --c; every attribute a script or extension could add).
const look=()=>{
  const net=document.getElementById('net'),h=t=>{let x=5381;for(let i=0;i<t.length;i++)x=(x*33^t.charCodeAt(i))>>>0;return x.toString(36);};
  const at=e=>[...e.attributes].filter(a=>a.name!=='class'&&a.name!=='id'&&!(a.name==='style'&&!a.value)&&!/^(data-(open|item|path)|type|tabindex|aria-label|aria-hidden)$/.test(a.name)).map(a=>a.name+'='+a.value).join(';');
  const bg=(e,p)=>{const c=getComputedStyle(e,p);return h(c.backgroundImage)+'.'+c.backgroundColor;};
  const o={strips:{},spores:{}};
  for(const i of net.querySelectorAll('.net__hyphae:not(.hw-taste-ov) > i'))o.strips[i.id]=bg(i)+'|'+at(i)+'|'+i.className;
  for(const i of net.querySelectorAll('.hw-taste-ov > i'))o.strips[(i.dataset.of?'ov:'+i.dataset.of:'occ:'+i.dataset.occ)]=i.className+'|'+getComputedStyle(i).visibility+'|'+at(i);   // a twin is lit only while visible
  for(const s of net.querySelectorAll('.spore')){const c=getComputedStyle(s);o.spores[s.dataset.item]=[c.scale,c.zIndex,c.getPropertyValue('--c'),bg(s,'::before'),at(s),s.className,document.activeElement===s].join('|');}
  const hub=net.querySelector('.net__hub'),stage=net.querySelector('.net__stage');
  o.hub=bg(hub,'::before')+'|'+getComputedStyle(hub).getPropertyValue('--paper')+'|'+at(hub)+'|'+hub.className;
  o.stage=at(stage)+'|'+getComputedStyle(stage).cursor+'|'+stage.className;
  const ov=net.querySelector('.hw-taste-ov');o.stage+='|'+(ov?ov.className+'|'+(ov.getAttribute('style')||'')+'|'+getComputedStyle(ov).willChange:'');   // the overlay container: class, inline style (tip cut, placement), promotion
  return o;
};
const differences=async(page,base)=>{const s=await page.evaluate(look),d=(a,b)=>Object.keys(a).filter(k=>a[k]!==b[k]);return {strips:d(s.strips,base.strips),sp:d(s.spores,base.spores),hub:s.hub!==base.hub,stage:s.stage!==base.stage,s};};
let matched=0;
async function check(name,route,run,opts){
  if(process.env.HW_ONLY&&!name.includes(process.env.HW_ONLY))return;
  matched++;
  const {context,page,errors}=await open(route,opts),result={name};
  try{
    await run(page,context,result);
    const raf=await page.evaluate(()=>window.__raf);
    assert.deepEqual(raf.csp,[],'no CSP violations');assert.deepEqual(errors,[],'no page errors');
    result.passed=true;
  }catch(e){result.passed=false;result.error=e.stack.split('\n').slice(0,4).join(' | ');}
  report.cases.push(result);console.log((result.passed?'PASS ':'FAIL ')+name+(result.error?': '+result.error.split(' | ')[0]:''));
  await context.close();
}
const opened=page=>page.waitForFunction(()=>!document.getElementById('dialog').hidden&&document.activeElement.id==='dialog-close',null,{timeout:6500});
const idle=page=>page.waitForFunction(()=>!window.leafLift.busy(),null,{timeout:8000});
// Zone-3 target: the outermost spore, 28 units out; zone-2 ray: a deep first spore.
const outer=N.paths.map((k,i)=>i).sort((a,b)=>Math.hypot(...unit(b).map((v,j)=>v-[N.cx,N.cy][j]))-Math.hypot(...unit(a).map((v,j)=>v-[N.cx,N.cy][j])))[0];
const snapPt=away(outer,28),snapPick=pick(N,...snapPt);   // clear of the spore's own box (about 11 units, 19 scaled)
const rinAt=deg=>N.rin[Math.round(((deg%360)+360)%360*2)%N.n];   // zone 2 ends here along a ray
const deep=firsts.filter(i=>pathIds(i).length>=3).sort((a,b)=>rinAt(Math.atan2(unit(b)[1]-N.cy,unit(b)[0]-N.cx)*180/Math.PI)-rinAt(Math.atan2(unit(a)[1]-N.cy,unit(a)[0]-N.cx)*180/Math.PI))[0],deepDeg=Math.atan2(unit(deep)[1]-N.cy,unit(deep)[0]-N.cx)*180/Math.PI,deepR=Math.hypot(unit(deep)[0]-N.cx,unit(deep)[1]-N.cy),deepIn=rinAt(deepDeg),z2pt=polar(N.hub+(deepIn-N.hub)*.5,deepDeg);   // z2pt: a point well inside zone 2
assert.equal(snapPick.zone,3,'zone-3 test point');assert.equal(pick(N,...z2pt).zone,2,'zone-2 test point');

try{
  await check('identity: taste page is the faithful page plus the taste stylesheet and script tags',TASTE,async()=>{
    const faithful=await readRegularInput(resolve(siteRoot,'optimized/index.html'),{runtime});
    const tag=/<link rel="stylesheet" href="\.\/assets\/taste\.[0-9a-f]{16}\.css">\n<script defer src="\.\/assets\/taste\.[0-9a-f]{16}\.js"><\/script>\n/g;
    assert.equal((tasteHtml.match(tag)||[]).length,1);
    // the one taste build also carries the designed dark mode: its two head tags and its night markup (night faces beside the birds, the ground walkers), as the dark-mode fixtures assert
    const darkTags=/<script src="\.\/assets\/taste-dark\.[0-9a-f]{16}\.js"><\/script>\n|<link rel="stylesheet" href="\.\/assets\/taste-dark\.[0-9a-f]{16}\.css">\n/g;
    assert.equal((tasteHtml.match(darkTags)||[]).length,2,'the taste build ships the dark mode script and stylesheet');
    const night=h=>h.replace(/ hw-night hw-n-[\w-]+ hw-n-[\w-]+/g,'').replace(/<span class="bird__face hw-nface[\s\S]*?<\/span>(?=<\/span><\/div>)/g,'').replace(/<div class="bugs hw-nx-walkers">[\s\S]*?<\/div><\/div>\n      /,'');
    assert.equal(night(tasteHtml.replace(tag,'').replace(darkTags,'')),faithful,'taste HTML minus its stylesheet and script tags and the dark mode\'s night markup must equal site/optimized/index.html; rebuild both (npm run build)');
    assert.deepEqual(await readRegularInput(resolve(siteRoot,'optimized-taste/headers.json'),{runtime,encoding:null}),await readRegularInput(resolve(siteRoot,'optimized/headers.json'),{runtime,encoding:null}));
    report.faithfulHtmlSha256=sha(faithful);
  });

  await check('zone 1: hub glow, no thread, no tag',TASTE,async(page,context,result)=>{
    await move(page,[N.cx,N.cy],4);
    const s=await snapshot(page);
    result.state=s;
    const glowed=await page.evaluate(()=>getComputedStyle(document.querySelector('#net .net__hub')).getPropertyValue('--paper'));
    assert.equal(s.paper,'glow');assert(/color-mix/.test(glowed),'hub --paper is the glow: '+glowed);
    assert.deepEqual([s.painted,s.lit,s.snapped,s.tag],[[],[],[],'']);
    const a=await shot(page,'hub-glow-taste');
    const l=await open(LOCAL);await move(l.page,[N.cx,N.cy],4);const b=await shot(l.page,'hub-glow-local');await l.context.close();
    await sideBySide(context,'hub-glow-side-by-side',[a,'taste (hub glow)'],[b,'/local/ (no hover)']);
    await move(page,[5,5],3);assert(clean(await snapshot(page)),'leaving the hub clears the glow');
  });

  await check('zone 2: partial root grows along the ray, matches pick, no tag, no .is-lit',TASTE,async(page,context,result)=>{
    let prev=-1,counts=[];
    for(let r=N.hub+8;r<deepIn-4;r+=14){
      const pt=polar(r,deepDeg),expect=pick(N,...pt,prev);
      await move(page,pt);
      const s=await snapshot(page);
      if(expect.zone!==2){prev=-1;continue;}
      const chain=[N.segs[expect.seg].id];for(let p=N.segs[expect.seg].parent;p>=0;p=N.segs[p].parent)chain.push(N.segs[p].id);
      assert.deepEqual(sorted(s.painted.map(p=>p.id)),sorted(chain),'painted strips = ancestors + tip at r='+r);
      const tip=s.painted.find(p=>p.id===N.segs[expect.seg].id);
      assert(tip.tip&&tip.stop===expect.stop+'%'&&tip.a===N.segs[expect.seg].a+'deg',"tip's gradient is at stop "+expect.stop+': '+JSON.stringify(tip));
      assert.equal(s.painted.filter(p=>p.tip).length,1,'exactly one tip');
      assert.deepEqual([s.lit,s.tag,s.paper,s.snapped],[[],'','',[]]);
      assert(!DEAD.some(d=>chain.includes(d)));
      counts.push(chain.length);prev=expect.seg;
    }
    result.chainLengths=counts;assert(counts.length>=3&&counts.at(-1)>=counts[0],'the light reaches further as the pointer moves out');
    // a partial-root screenshot: pointer between the first two junctions of a deep ray
    const pt=polar(N.hub+(deepIn-N.hub)*.55,deepDeg);await move(page,pt,3);
    const a=await shot(page,'zone2-partial-root-taste');
    const l=await open(LOCAL);await move(l.page,pt,3);const b=await shot(l.page,'zone2-partial-root-local');await l.context.close();
    await sideBySide(context,'zone2-side-by-side',[a,'taste (light stops on pointer circle)'],[b,'/local/ (same pointer, nothing)']);
    await move(page,[5,5],3);assert(clean(await snapshot(page)));
  });

  await check('zone 3: snap matches a real hover (thread, tag, look, cursor); click opens it once',TASTE,async(page,context,result)=>{
    await move(page,snapPt,4);await page.waitForTimeout(500);
    const s=await snapshot(page),item=await itemOf(page,snapPick.spore);
    assert.deepEqual(sorted(s.painted.map(p=>p.id)),sorted(pathIds(snapPick.spore)),'the overlay shows the spore path');assert(s.painted.every(p=>!p.tip),'whole strips, no tip');assert.deepEqual(s.lit,[],'nothing lit on the base: it is not repainted');
    assert(s.tag.includes((await labelOf(page,snapPick.spore))),'tag names the spore: '+s.tag);
    assert.deepEqual(s.snapped,[item]);assert.equal(s.cursor,'pointer');
    const snapped=await computedOf(page,item);result.snapped=snapped;
    const a=await shot(page,'zone3-snap-taste');
    // the same spore by a real hover, for comparison
    await move(page,[5,5],3);assert(clean(await snapshot(page)));
    await move(page,unit(snapPick.spore),4);await page.waitForTimeout(500);
    const real=await hover(page);result.real=real;
    assert.deepEqual(real,snapped,'computed scale / z-index / --c match a real hover');
    const l=await open(LOCAL);await move(l.page,unit(snapPick.spore),4);await l.page.waitForTimeout(500);const b=await shot(l.page,'zone3-snap-local-real-hover');await l.context.close();
    await sideBySide(context,'zone3-side-by-side',[a,'taste (pointer 28 units away, snapped)'],[b,'/local/ (real hover on the spore)']);
    // click through the site's own delegation: exactly one open, for this item
    await move(page,[5,5],3);await move(page,snapPt,4);
    await page.mouse.down();await page.mouse.up();
    await opened(page);
    const picks=await page.evaluate(()=>window.__raf.picks);result.picks=picks;
    assert.equal(picks.length,1);assert.equal(picks[0].title,await labelOf(page,snapPick.spore));
    assert(clean(await snapshot(page)),'modal open releases taste');
  });

  await check('corner and outside the network: nothing',TASTE,async(page)=>{
    for(const pt of [[3,3],[1197,757],[N.cx,5],[5,N.cy],[1195,N.cy]].filter(p=>pick(N,...p).zone===0)){await move(page,pt,2);const s=await snapshot(page);assert(clean(s)&&!s.tag&&!s.lit.length,'nothing at '+pt);}
  });

  await check('grid sweep: DOM state equals pick() at every step, dead ends never lit, rAF <= pointermoves',TASTE,async(page,context,result)=>{
    let prev=-1,bad=[],steps=0;
    await page.evaluate(()=>{window.__raf.taste=0;window.__raf.moves=0;window.__raf.frames=[];window.__raf.framesTotal=[];});
    for(let y=20;y<760;y+=60)for(let x=(((y-20)/60)%2?1180:20);x>0&&x<1200;x+=(((y-20)/60)%2?-60:60)){
      const pt=[x,y],[cx,cy]=await clientOf(page,pt);
      const e=pick(N,x,y,prev);await page.mouse.move(cx,cy);await settle(page);steps++;if(e.zone===3)await page.waitForTimeout(250);
      const overSpore=await page.evaluate(([a,b])=>!!document.elementFromPoint(a,b)?.closest('.spore'),[cx,cy]);
      const s=await snapshot(page);
      if(overSpore){prev=-1;if((s.paper||s.painted.some(p=>p.tip)||s.lit.length||s.inlineColour)&&!(e.zone===3&&s.snapped.length===1))bad.push(['real spore not left alone',pt,s]);continue;}
      if(e.zone===2){
        const chain=[N.segs[e.seg].id];for(let p=N.segs[e.seg].parent;p>=0;p=N.segs[p].parent)chain.push(N.segs[p].id);
        if(JSON.stringify(sorted(s.painted.map(p=>p.id)))!==JSON.stringify(sorted(chain))||s.lit.length)bad.push(['zone2',pt,s.painted.map(p=>p.id),chain]);
      }else if(e.zone===3){
        if(JSON.stringify(sorted(s.painted.map(p=>p.id)))!==JSON.stringify(sorted(pathIds(e.spore)))||s.painted.some(p=>p.tip)||s.lit.length||s.snapped.length!==1)bad.push(['zone3',pt,s.painted.map(p=>p.id),s.lit]);
      }else if(e.zone===1){if(!s.paper||s.painted.length||s.snapped.length)bad.push(['zone1',pt]);}
      else if(!clean(s)||s.lit.length)bad.push(['zone0',pt,s]);
      if(s.painted.some(p=>DEAD.includes(p.id))||s.lit.some(i=>DEAD.includes(i)))bad.push(['dead end lit',pt]);
      prev=e.zone===2?e.seg:-1;
    }
    const raf=await page.evaluate(()=>window.__raf);
    const srt=a=>[...a].sort((x,y)=>x-y),pc=(a,p)=>Math.round(a[Math.min(a.length-1,Math.floor(p*a.length))]*1000)/1000,fr=srt(raf.frames),tot=srt(raf.framesTotal),q=p=>pc(fr,p);
    result.sweep={steps,tasteRaf:raf.taste,pointermoves:raf.moves,mismatches:bad.length,first:bad.slice(0,4),frameMs:{n:fr.length,median:q(.5),p95:q(.95),max:q(1),withSiteHandlers:{median:pc(tot,.5),p95:pc(tot,.95),max:pc(tot,1)}}};
    assert(fr.length>=10&&q(.95)<1,'taste work per frame (pick + DOM updates) p95 under 1 ms: '+JSON.stringify(result.sweep.frameMs));
    assert.deepEqual(bad.slice(0,5),[],'DOM matches pick');assert(raf.taste<=raf.moves,'rAF '+raf.taste+' <= moves '+raf.moves);
  });

  await check('a real spore hover lights exactly its path (on the overlay, in the same task) and taste writes nothing else',TASTE,async(page)=>{
    const i=outer;await move(page,unit(i),4);await page.waitForTimeout(300);
    const s=await snapshot(page);
    assert.deepEqual(sorted(s.painted.map(p=>p.id)),sorted(pathIds(i)),'the overlay shows the hovered path');assert(s.painted.every(p=>!p.tip));
    assert.deepEqual(s.lit,[],'the base is not repainted: its lit class is gone again within the hover task');
    assert(!s.paper&&!s.snapped.length&&!s.cursor&&!s.inlineColour,'no taste class or inline style besides the overlay');
    assert(s.tag.includes(await labelOf(page,i)),'the site\'s own tag shows');
    assert(await hover(page),'the spore is :hover (the site\'s own scale and colour)');
    await move(page,[5,5],3);const e=await snapshot(page);assert(clean(e)&&!e.lit.length&&!e.tag);
  });


  await check('typing in the finder stands taste down; clearing resumes',TASTE,async(page)=>{
    await move(page,snapPt,3);assert((await snapshot(page)).snapped.length===1);
    await page.focus('#group-find');await page.keyboard.type('a');await page.waitForTimeout(100);
    assert(clean(await snapshot(page)),'search clears taste state');
    await move(page,away(outer,12),3);await move(page,polar(N.hub+50,deepDeg),3);
    assert(clean(await snapshot(page)),'no taste writes while searching');
    await page.fill('#group-find','');await page.waitForTimeout(100);
    await move(page,snapPt,3);assert((await snapshot(page)).snapped.length===1,'resumes after clearing');
  });


  // The overlay is promoted while the stage is in or near the viewport (IntersectionObserver, half a viewport of margin) and demoted when it leaves: never promoted while the Network is off-screen, never promoted or demoted while the pointer works it.
  await check('leaving the stage leaves no taste class or style under #net (bar the overlay container: promoted and placed while on screen, clean off-screen) and no stray .is-lit',TASTE,async(page,context,result)=>{
    const state=()=>page.evaluate(()=>{const o=document.querySelector('#net .hw-taste-ov');return {styled:document.querySelectorAll('#net [style]:not(.hw-taste-ov),#net [class*="hw-taste"]:not(.hw-taste-ov),#net [data-darkreader-inline-bg]').length,
      ov:o&&{cls:o.className,style:o.getAttribute('style'),lit:o.querySelectorAll('.on,.tip').length,twinsStyled:o.querySelectorAll('[style]').length,wc:getComputedStyle(o).willChange},baseLit:document.querySelectorAll('#net .net__hyphae:not(.hw-taste-ov) > i.is-lit').length};});
    const clean0={styled:0,ov:{cls:'net__hyphae hw-taste-ov',style:null,lit:0,twinsStyled:0,wc:'auto'},baseLit:0};
    const offScreen=async()=>{await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(400);},onScreen=async()=>{await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(400);};
    await offScreen();assert.deepEqual(await state(),clean0,'Network off-screen: overlay built but not promoted, no style, showing nothing');
    await onScreen();const near0=await state();result.onScreen=near0;
    assert.deepEqual({...near0,ov:{...near0.ov,style:null}},{...clean0,ov:{...clean0.ov,cls:'net__hyphae hw-taste-ov hw-taste-wc',wc:'transform'}},'Network on screen, before any light: promoted, showing nothing');
    assert.match(near0.ov.style,/^--hw-dx: -?[\d.e-]+px; --hw-dy: -?[\d.e-]+px;$/,'the only container style on screen at rest is the placement');
    for(const pt of [snapPt,z2pt,[N.cx,N.cy]]){await move(page,pt,3);await move(page,[5,5],3);const s=await snapshot(page);assert(clean(s)&&!s.lit.length&&!s.tag);}
    assert.deepEqual(await state(),near0,'after leaving: no .on, no tip cut, the same promotion and placement as before any light');
    await offScreen();assert.deepEqual(await state(),clean0,'scrolled away: demoted, no container style (not even an empty attribute)');
  });

  await check('idle identity: the Network with the pointer outside the stage is byte-identical to /optimized/, before any hover and after hover cycles',TASTE,async(page,context,result)=>{
    const calm='*,*::before,*::after{animation:none!important;transition:none!important}.leaftag{display:none!important}';
    const stageShot=async p=>{await p.addStyleTag({content:calm});await p.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await p.mouse.move(2,2);await p.waitForTimeout(500);const b=await rect(p);return p.screenshot({clip:{x:Math.max(0,b.left),y:Math.max(0,b.top),width:b.width,height:Math.min(b.height,768-Math.max(0,b.top))}});};
    // At load the Network is far below the fold: no promoted overlay, and every Network element's computed look equals the faithful page's (DOM-level identity).
    const baseLook=async p=>{await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(400);const l=await p.evaluate(look);return {strips:Object.fromEntries(Object.entries(l.strips).filter(([k])=>k.startsWith('hy-'))),spores:l.spores,hub:l.hub,stage:l.stage.split('|').slice(0,3).join('|'),overlay:l.stage.split('|').slice(3).join('|')};};
    const f=await open(FAITHFUL,{bypass:true});let faithful,fLook;try{fLook=await baseLook(f.page);faithful=await stageShot(f.page);}finally{await f.context.close();}
    const tLook=await baseLook(page);result.offScreenOverlay=tLook.overlay;
    assert.deepEqual({...tLook,overlay:undefined},{...fLook,overlay:undefined},'at load, Network off-screen: every strip, circle, the hub and the stage look exactly as on the faithful page');
    assert.equal(tLook.overlay,'net__hyphae hw-taste-ov||auto','at load, Network off-screen: the overlay is not promoted and has no style');
    const fresh=await stageShot(page);
    // On screen the overlay is promoted (D7 restated 2026-10-12: promoted while the Network is in or near the viewport). That moves the hub and the circles over it into a composited layer whose
    // raster differs by a few levels on anti-aliased edges (measured: 258 pixels at most 2 levels at DPR 1, 10,980 at most 3 at DPR 2; output/review-taste-round/idle-diff-probe.mjs); nothing differs beyond that.
    const sharp=loadSharp(),[A,B]=await Promise.all([faithful,fresh].map(b=>sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true})));
    const dpr=await page.evaluate(()=>devicePixelRatio);
    result.onScreen=compareRasterEdges({width:A.info.width,height:A.info.height,data:A.data},{width:B.info.width,height:B.info.height,data:B.data},{cssWidth:A.info.width/dpr,cssHeight:A.info.height/dpr});
    assert(result.onScreen.passed,'on screen, before any hover, raw differences occur only on original raster edges, at most3 levels; background/interiors stay exact: '+JSON.stringify(result.onScreen));
    for(const pt of [snapPt,z2pt,[N.cx,N.cy],unit(outer),snapPt]){await move(page,pt,3);await page.waitForTimeout(150);}
    await move(page,[5,5],3);await page.mouse.move(2,2);await page.waitForTimeout(600);
    const after=await stageShot(page);result.bytes=faithful.length;
    assert(after.equals(fresh),'after hovering every zone and a real circle, and leaving, it is byte-identical to before any hover (no leftover)');
  },{bypass:true});

  // Perceptual fidelity (memory perceptual-fidelity-standard): the overlay's lit look vs the site's own lit strip (base .is-lit), CIEDE2000, pixels the site's lit changes. The remaining edge difference is the base strip's cream anti-aliasing under the twin's own; a half-pixel shift of a promoted layer (which put a cream line on one side of every strip) is cancelled by --hw-dx/--hw-dy.
  const lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
  const lab=(r,g,b)=>{const R=lin(r),G=lin(g),B=lin(b),X=(.4124564*R+.3575761*G+.1804375*B)/.95047,Y=.2126729*R+.7151522*G+.072175*B,Z=(.0193339*R+.119192*G+.9503041*B)/1.08883,f=t=>t>216/24389?Math.cbrt(t):(24389/27*t+16)/116;return [116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))];};
  const de00=(a,b)=>{const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI,[L1,a1,b1]=a,[L2,a2,b2]=b,C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cb=(C1+C2)/2,G=.5*(1-Math.sqrt(Cb**7/(Cb**7+25**7))),ap1=(1+G)*a1,ap2=(1+G)*a2,Cp1=Math.hypot(ap1,b1),Cp2=Math.hypot(ap2,b2);
    const hp=(x,y)=>x===0&&y===0?0:(deg(Math.atan2(y,x))+360)%360,h1=hp(ap1,b1),h2=hp(ap2,b2),dL=L2-L1,dC=Cp2-Cp1;let dh=0;if(Cp1*Cp2){dh=h2-h1;if(dh>180)dh-=360;else if(dh<-180)dh+=360;}
    const dH=2*Math.sqrt(Cp1*Cp2)*Math.sin(rad(dh/2)),Lb=(L1+L2)/2,Cpb=(Cp1+Cp2)/2;let hb=h1+h2;if(Cp1*Cp2){hb=Math.abs(h1-h2)<=180?(h1+h2)/2:(h1+h2<360?(h1+h2+360)/2:(h1+h2-360)/2);}
    const T=1-.17*Math.cos(rad(hb-30))+.24*Math.cos(rad(2*hb))+.32*Math.cos(rad(3*hb+6))-.2*Math.cos(rad(4*hb-63)),dt=30*Math.exp(-(((hb-275)/25)**2)),Rc=2*Math.sqrt(Cpb**7/(Cpb**7+25**7)),Sl=1+.015*(Lb-50)**2/Math.sqrt(20+(Lb-50)**2),Sc=1+.045*Cpb,Sh=1+.015*Cpb*T,Rt=-Math.sin(rad(2*dt))*Rc;
    return Math.sqrt((dL/Sl)**2+(dC/Sc)**2+(dH/Sh)**2+Rt*(dC/Sc)*(dH/Sh));};
  for(const dpr of [1,2])await check('lit look parity: overlay twin vs the site\'s own .is-lit strip, CIEDE2000, 6 routes (DPR '+dpr+')',TASTE,async(page,context,result)=>{
    const sharp=loadSharp();
    await page.addStyleTag({content:'.leaftag{display:none!important}*:not(.spore),*::before,*::after{animation-play-state:paused!important;transition:none!important}'});
    const routes=firsts.filter(i=>pathIds(i).length>=3&&pick(N,...away(i,28)).spore===i).sort((a,b)=>pathIds(b).length-pathIds(a).length).slice(0,6);
    assert(routes.length>=4,'enough routes to compare');
    const all=[],inner=[],edge=[],per=[];
    for(const i of routes){
      const ids=pathIds(i).map(k=>'hy-'+k),item=await itemOf(page,i);
      const clip=await page.evaluate(ids=>{const rs=ids.map(k=>document.getElementById(k).getBoundingClientRect()),l=Math.min(...rs.map(r=>r.left))-8,t=Math.min(...rs.map(r=>r.top))-8;return {x:Math.max(0,Math.floor(l)),y:Math.max(0,Math.floor(t)),width:Math.ceil(Math.max(...rs.map(r=>r.right))-l+16),height:Math.ceil(Math.max(...rs.map(r=>r.bottom))-t+16)};},ids);
      const shot=async()=>{await page.waitForTimeout(350);return sharp(await page.screenshot({clip})).removeAlpha().raw().toBuffer({resolveWithObject:true});};
      await move(page,[5,5],2);const idle=await shot();
      await page.evaluate(([ids,item])=>{for(const k of ids)document.getElementById(k).classList.add('is-lit');document.querySelector(`#net .spore[data-item="${item}"]`).classList.add('hw-taste-snap');},[ids,item]);const ref=await shot();   // the site's lit strips + the snapped spore look, nothing else
      await page.evaluate(([ids,item])=>{for(const k of ids)document.getElementById(k).classList.remove('is-lit');document.querySelector(`#net .spore[data-item="${item}"]`).classList.remove('hw-taste-snap');},[ids,item]);
      await move(page,away(i,28),4);const taste=await shot();
      assert.equal((await snapshot(page)).snapped[0],item,'snapped the intended circle');
      const w=idle.info.width,h=idle.info.height,gold=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&idle.data[3*(y*w+x)+2]>170&&ref.data[3*(y*w+x)+2]<115;let n=0;
      for(let p=0;p<w*h;p++){const o=3*p;if(Math.max(Math.abs(idle.data[o]-ref.data[o]),Math.abs(idle.data[o+1]-ref.data[o+1]),Math.abs(idle.data[o+2]-ref.data[o+2]))<2)continue;
        const x=p%w,y=Math.floor(p/w),e=de00(lab(ref.data[o],ref.data[o+1],ref.data[o+2]),lab(taste.data[o],taste.data[o+1],taste.data[o+2]));all.push(e);n++;
        (gold(x,y)&&gold(x-1,y)&&gold(x+1,y)&&gold(x,y-1)&&gold(x,y+1)?inner:edge).push(e);}
      per.push(n);
      if(i===routes[0])await writeFile(resolve(out,'lit-parity-crop-dpr'+dpr+'.png'),await sharp({create:{width:w*2+8,height:h,channels:3,background:'#000'}}).composite([{input:await sharp(ref.data,{raw:{width:w,height:h,channels:3}}).png().toBuffer(),left:0,top:0},{input:await sharp(taste.data,{raw:{width:w,height:h,channels:3}}).png().toBuffer(),left:w+8,top:0}]).png().toBuffer());
    }
    const srt=a=>[...a].sort((x,y)=>x-y),q=(a,p)=>{const s=srt(a);return s.length?+s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(2):0;},mean=a=>+(a.reduce((x,y)=>x+y,0)/Math.max(1,a.length)).toFixed(3);
    result.parity={dpr,routes:routes.length,litPixels:all.length,all:{max:q(all,1),p99:q(all,.99),mean:mean(all)},interior:{n:inner.length,max:q(inner,1),p999:q(inner,.999),mean:mean(inner),over2_3:inner.filter(e=>e>2.3).length},edge:{n:edge.length,p99:q(edge,.99),max:q(edge,1),mean:mean(edge),over2_3:edge.filter(e=>e>2.3).length}};
    report.parity=report.parity||{};report.parity['dpr'+dpr]=result.parity;
    assert(result.parity.interior.mean<.3&&result.parity.interior.p999<2.3,'interior of a lit strip is imperceptibly different: '+JSON.stringify(result.parity.interior));
    assert(result.parity.all.mean<2.3,'mean dE2000 over every pixel the lit state changes is under one JND: '+JSON.stringify(result.parity.all));
    assert(result.parity.edge.max<30&&result.parity.edge.p99<20,'anti-aliased edge pixels stay bounded (a shifted layer would show 50+): '+JSON.stringify(result.parity.edge));
  },{bypass:true,dpr});

  await check('focus is a one-shot release; scroll releases; resume on next move',TASTE,async(page)=>{
    await move(page,snapPt,3);assert((await snapshot(page)).snapped.length===1);
    await page.evaluate(()=>window.scrollBy({top:30,behavior:'instant'}));await settle(page);await settle(page);
    assert(clean(await snapshot(page)),'scroll releases');
    await page.evaluate(()=>window.scrollBy({top:-30,behavior:'instant'}));await settle(page);
    await move(page,snapPt,3);assert((await snapshot(page)).snapped.length===1,'resumes');
    await page.evaluate(()=>document.querySelector('#net .spore').focus());await settle(page);const f=await snapshot(page);
    assert(clean(f),'focus on a spore releases taste');
  });

  await check('modifier and touch clicks are not forwarded; plain click after closing resumes taste',TASTE,async(page,context,result)=>{
    await move(page,snapPt,3);
    for(const key of ['Alt','Shift','Meta']){await page.keyboard.down(key);await page.mouse.down();await page.mouse.up();await page.keyboard.up(key);}
    await page.evaluate(()=>document.querySelector('#net .net__stage').dispatchEvent(new PointerEvent('click',{bubbles:true,button:0,pointerType:'touch'})));
    await settle(page);
    assert.equal((await page.evaluate(()=>window.__raf.picks)).length,0,'nothing forwarded');
    await page.mouse.click(...await clientOf(page,snapPt));
    await opened(page);assert.equal((await page.evaluate(()=>window.__raf.picks)).length,1);
    await page.click('#dialog-close');await idle(page);
    await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await settle(page);
    await move(page,[5,5],2);await move(page,snapPt,3);
    result.after=await snapshot(page);assert(result.after.snapped.length===1,'taste is active again after the modal closed');
  });

  await check('modal close hands focus back to a spore: its lit path is cleared as soon as the pointer works the network',TASTE,async(page,context,result)=>{
    await move(page,snapPt,3);await page.mouse.click(...await clientOf(page,snapPt));await opened(page);
    await page.click('#dialog-close');await idle(page);await settle(page);await settle(page);
    const a=await page.evaluate(()=>({focus:document.activeElement.classList.contains('spore')&&document.activeElement.dataset.item}));
    const s=await snapshot(page);result.afterClose={...a,...s};
    assert(a.focus,'focus returned to a spore');assert(clean(s),'no taste inline state after close');
    result.lit=s.lit;                                    // the site's own focus light, until the pointer acts
    await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await settle(page);
    await move(page,[5,5],2);await move(page,z2pt,3);
    const w=await snapshot(page);result.zone2=w;
    assert.deepEqual(w.lit,[],'the focus light is gone: one route only');assert(w.painted.some(p=>p.tip),'the pointer route has its partial tip');
  });

  // The user's rule: no more than one root route lit at a time, ever, and leaving puts everything back. Judged on computed looks, not just classes,
  // so a colour-rewriting extension's leftover (data-darkreader-inline-* attributes, --darkreader-* overrides) counts exactly like a stuck class.
  for(const mode of ['plain','dr','forced']){
    if(mode==='dr'&&process.env.HW_NO_DARKREADER){console.warn('SKIPPED (HW_NO_DARKREADER set): the Dark Reader walk');continue;}
    await check('one route at a time: seeded random walk, '+(process.env.HW_WALK_STEPS||300)+' steps incl. clicks, modals, scrolls, focus and search ('+mode+')',TASTE,async(page,context,result)=>{
    const steps=+(process.env.HW_WALK_STEPS||300),base=await page.evaluate(look),keys=Object.keys(base.spores);
    const paths=N.paths.map(p=>p.split(' ').map(v=>'hy-'+v));
    let seed=11;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
    const bad=[];let max=0,maxSpores=0,pt=[N.cx,N.cy];
    const verdict=(j,pt)=>{
      const lit=[...new Set(j.strips.filter(k=>!k.startsWith('occ:')).map(k=>k.replace(/^ov:/,'')))];   // base strips the site lit, and twins the overlay shows
      if(j.sp.length>1)return 'two spores lit';
      if(j.sp.length===1&&!lit.every(v=>paths[keys.indexOf(j.sp[0])].includes(v)))return 'a spore and a path of another route';
      if(!j.sp.length&&lit.length&&!paths.some(p=>lit.every(v=>p.includes(v))))return 'strips of more than one route';
      if(j.hub&&(lit.length||j.sp.length))return 'hub glows while a route is lit';
      if(j.hub&&pick(N,...pt,-1).zone!==1)return 'hub glows away from the hub';
      if(lit.some(v=>DEAD.includes(+v.slice(3))))return 'a dead end is lit';
      return null;
    };
    const judge=async(tag)=>{
      const j=await differences(page,base);max=Math.max(max,j.strips.length);maxSpores=Math.max(maxSpores,j.sp.length);
      const why=verdict(j,pt);if(why)bad.push({tag,why,strips:j.strips.length,spores:j.sp.map(k=>k.slice(6,30)),first:j.strips.slice(0,4)});
      return j;
    };
    // a tour of every zone, then away: the page must look exactly as it did at load
    for(const p of [[N.cx,N.cy],z2pt,snapPt]){await move(page,p,4);await page.waitForTimeout(300);pt=p;await judge('tour');}
    await move(page,[5,N.cy],3);await page.mouse.move(2,2,{steps:4});await page.waitForTimeout(500);
    let back=await differences(page,base);
    assert.deepEqual([back.strips,back.sp,back.hub,back.stage],[[],[],false,false],'after the tour and leaving the stage the page equals its load-time look');
    for(let i=0;i<steps;i++){
      const q=Math.floor(rnd()*N.paths.length),to=i%3?[rnd()*1200,rnd()*760]:[N.spores[2*q]+(rnd()-.5)*70,N.spores[2*q+1]+(rnd()-.5)*70];
      const [cx,cy]=await clientOf(page,to);await page.mouse.move(cx,cy,{steps:1+Math.floor(rnd()*30)});await page.waitForTimeout(rnd()<.6?30:90);await settle(page);pt=to;
      const a=rnd();let tag='move';
      if(a<.07){
        tag='click';const n=(await page.evaluate(()=>window.__raf.picks)).length;await page.mouse.down();await page.mouse.up();await page.waitForTimeout(80);
        if((await page.evaluate(()=>window.__raf.picks)).length>n){tag='click+modal';await opened(page);await page.keyboard.press('Escape');await idle(page);await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(200);}
      }else if(a<.13){tag='scroll';await page.mouse.wheel(0,rnd()<.5?50:-50);await page.waitForTimeout(120);await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await settle(page);}
      else if(a<.17){tag='focus';await page.mouse.move(2,2,{steps:3});pt=[-9999,-9999];await settle(page);await page.evaluate(k=>document.querySelectorAll('#net .spore')[k].focus(),q);await settle(page);}
      else if(a<.21){tag='search';await page.fill('#group-find',['a','ma'][Math.floor(rnd()*2)]);await page.waitForTimeout(150);await page.mouse.move(cx+3,cy+3);await page.waitForTimeout(150);await page.fill('#group-find','');await page.waitForTimeout(150);}
      await page.waitForTimeout(260);
      await judge(tag+'@'+i+' '+Math.round(pt[0])+','+Math.round(pt[1]));
    }
    await move(page,[5,N.cy],3);await page.mouse.move(2,2,{steps:4});await page.waitForTimeout(600);
    back=await differences(page,base);
    result.walk={mode,steps,maxLitStrips:max,maxLitSpores:maxSpores,violations:bad.length,first:bad.slice(0,3),endDifferences:{strips:back.strips.length,spores:back.sp.length,hub:back.hub,stage:back.stage,...((back.strips.length||back.sp.length)&&{now:[...back.strips.slice(0,2).map(k=>[k,back.s.strips[k],base.strips[k]]),...back.sp.slice(0,2).map(k=>[k,back.s.spores[k],base.spores[k]])]})}};
    const b=await rect(page);await page.screenshot({path:resolve(out,'walk-end-'+mode+'.png'),clip:{x:Math.max(0,b.left),y:Math.max(0,b.top),width:b.width,height:Math.min(b.height,768-Math.max(0,b.top))}});
    assert.deepEqual(bad.slice(0,3),[],'never more than one route lit');
    assert.deepEqual([back.strips,back.sp,back.hub,back.stage],[[],[],false,false],'pointer away: every strip, spore and the hub look exactly as at load');
  },{mode,scheme:mode==='forced'?'dark':'light'});   // Dark Reader under the light scheme, where it acts (under the dark preference the taste build's designed dark mode locks it out); forced dark shows the designed dark page
  }

  await check('real spore edge next to a close neighbour: one click, one open',TASTE,async(page,context,result)=>{
    let best=[1e9,0,0];
    for(let i=0;i<N.paths.length;i++)for(let j=0;j<N.paths.length;j++)if(i!==j){const d=Math.hypot(...unit(i).map((v,k)=>v-unit(j)[k]));if(d<best[0])best=[d,i,j];}
    const [d,a,b]=best;result.pair={distance:d,a,b};
    let target=null;
    for(const off of [10,8,6,4,0]){
      const ua=unit(a),ub=unit(b),pt=[ua[0]+off*(ub[0]-ua[0])/d,ua[1]+off*(ub[1]-ua[1])/d],[cx,cy]=await clientOf(page,pt);
      const hit=await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('.spore')?.getAttribute('aria-label'),[cx,cy]);
      if(hit===await labelOf(page,a)){target=pt;break;}
    }
    assert(target,'a point on the near edge of the first spore');
    await move(page,snapPt,2);await move(page,target,4);
    await page.mouse.down();await page.mouse.up();await opened(page);
    const picks=await page.evaluate(()=>window.__raf.picks);result.picks=picks;
    assert.equal(picks.length,1);assert.equal(picks[0].title,await labelOf(page,a));
  });

  await check('resources: idle and outside cost nothing; no extra layers; sweep cost vs faithful',TASTE,async(page,context,result)=>{
    await page.evaluate(()=>{for(const e of document.querySelectorAll('.hw-nx-walkers'))e.style.setProperty('display','none','important');});   // the dark mode's ground walkers (the cottontail by day) are layers of their own, far above the Network; counted out so the comparison is the Network's
    const cdp=await context.newCDPSession(page);let layers=0,events=0;
    cdp.on('LayerTree.layerTreeDidChange',e=>{events++;if(e.layers)layers=e.layers.length;});
    await cdp.send('LayerTree.enable');
    // Re-enabling the domain makes Chrome report the current tree, so every count is observed after the state it describes (a stale count would make the comparisons vacuous).
    const layerCount=async()=>{await page.waitForTimeout(700);const seen=events;await cdp.send('LayerTree.disable');await cdp.send('LayerTree.enable');await page.waitForFunction(()=>new Promise(r=>requestAnimationFrame(()=>r(true))));await page.waitForTimeout(300);assert(events>seen,'no fresh layerTreeDidChange after the state');return layers;};
    await move(page,[5,5],2);const idleLayers=await layerCount();
    await page.evaluate(()=>{window.__raf.taste=0;});
    for(const pt of [[2,2],[600,2],[1198,2]])await page.mouse.move(...await clientOf(page,pt));       // outside the network
    await page.mouse.move(2,2);await page.mouse.move(40,40);await page.waitForTimeout(1000);
    const outside=await page.evaluate(()=>window.__raf.taste);
    await move(page,z2pt,3);await page.waitForTimeout(100);
    await page.evaluate(()=>{window.__raf.taste=0;});await page.waitForTimeout(1000);
    const idleInside=await page.evaluate(()=>window.__raf.taste);
    const zone2Layers=await layerCount();
    await move(page,snapPt,3);const snapLayers=await layerCount();
    await move(page,[5,5],2);await move(page,unit(snapPick.spore),4);const realLayers=await layerCount();
    await move(page,[5,5],2);await page.mouse.move(2,2);const leftLayers=await layerCount();
    await page.evaluate(()=>scrollTo(0,0));const offLayers=await layerCount();   // the Network off-screen: no promoted overlay
    // the faithful page at the same two scroll positions (its own session, the same counting)
    const f=await context.newPage();await f.goto(base+FAITHFUL,{waitUntil:'load'});await f.waitForFunction(()=>window.leafLift&&document.querySelectorAll('#net .spore').length>0);await f.waitForTimeout(3500);
    const fc=await context.newCDPSession(f);let fl=0,fe=0;fc.on('LayerTree.layerTreeDidChange',e=>{fe++;if(e.layers)fl=e.layers.length;});await fc.send('LayerTree.enable');
    const fCount=async()=>{await f.waitForTimeout(700);const seen=fe;await fc.send('LayerTree.disable');await fc.send('LayerTree.enable');await f.waitForFunction(()=>new Promise(r=>requestAnimationFrame(()=>r(true))));await f.waitForTimeout(300);assert(fe>seen,'no fresh layerTreeDidChange (faithful)');return fl;};
    await f.mouse.move(2,2);const faithfulOff=await fCount();
    await f.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));const faithfulOn=await fCount();await f.close();
    Object.assign(result,{layerEvents:events,idleLayers,zone2Layers,snapLayers,realLayers,leftLayers,offLayers,faithfulOff,faithfulOn,rafOutside:outside,rafIdleInside:idleInside});
    report.resources={...result};
    assert.equal(outside,0,'0 rAF outside the stage');assert.equal(idleInside,0,'0 rAF idle inside the stage');
    assert.equal(offLayers,faithfulOff,'the Network off-screen: the layers of the faithful page (no promoted overlay): '+offLayers+' vs faithful '+faithfulOff);
    assert(idleLayers<=faithfulOn+20,'on screen the promoted overlay adds its own layer plus the hub and the circles overlapping it (about 16), not more: '+idleLayers+' vs faithful '+faithfulOn);
    assert(zone2Layers<=idleLayers+4&&snapLayers<=idleLayers+4,'lighting adds no promotion of its own (it was made when the Network came on screen): zone 2 '+zone2Layers+', snap '+snapLayers+' vs on-screen idle '+idleLayers);assert.equal(leftLayers,idleLayers,'leaving the stage changes no layer: '+leftLayers+' vs idle '+idleLayers);
    assert(snapLayers<=realLayers+4&&realLayers<=snapLayers+4,'snap and a real hover (also on the overlay now) cost the same layers: '+snapLayers+' vs '+realLayers);
  });

  for(const [label,route] of [['faithful',FAITHFUL],['taste',TASTE]]){
    await check('report-only: ScriptDuration over a 60-step sweep ('+label+')',route,async(page,context,result)=>{
      const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
      const get=async()=>(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='ScriptDuration').value;
      const b=await rect(page),before=await get();
      for(let i=0;i<60;i++){await page.mouse.move(b.left+(i%10+.5)*b.width/10,b.top+(Math.floor(i/10)+.5)*b.height/6);await settle(page);}
      result.scriptDurationMs=Math.round(((await get())-before)*1000);report.resources['scriptDurationMs_'+label]=result.scriptDurationMs;
    });
  }

  // Dormant: the build input has a circle inside the hub's buffer, so the shipped script is inert and the page is the original.
  await check('dormant: a layout with a circle moved inside the hub buffer ships an inert script: no listeners, no taste classes after a walk',TASTE,async(page,context,result)=>{
    const src=tasteSource(withSporeAt(await readRegularInput(resolve(siteRoot,'local/index.html'),{runtime}),3,N.cx+100,N.cy));
    assert(/^\/\* Taste[^\n]*\n\/\* dormant: /.test(src),'dormant script');
    const dormantCtx=await browser.newContext({viewport:report.viewport}),p2=await dormantCtx.newPage(),errs=[];
    p2.on('pageerror',e=>errs.push(e.message));
    await p2.addInitScript(()=>{window.__raf={listeners:0,taste:0};const orig=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{if(/\/assets\/taste\./.test(new Error().stack))window.__raf.taste++;return orig(cb);};const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(...a){if(/\/assets\/taste\./.test(new Error().stack))window.__raf.listeners++;return add.apply(this,a);};});
    await p2.route(/\/assets\/taste\.[0-9a-f]{16}\.js$/,r=>r.fulfill({status:200,contentType:'text/javascript',body:src}));
    await p2.goto(base+TASTE,{waitUntil:'load'});await p2.waitForFunction(()=>window.leafLift&&document.querySelectorAll('#net .spore').length>0);await p2.waitForTimeout(3500);
    await p2.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await p2.waitForTimeout(300);
    const base0=await p2.evaluate(look);
    for(const pt of [[N.cx,N.cy],z2pt,snapPt,away(outer,12),polar(N.hub+20,45),[5,5]]){await move(p2,pt,4);await p2.waitForTimeout(150);}
    const s=await snapshot(p2),d=await differences(p2,base0);
    result.dormant={listeners:await p2.evaluate(()=>window.__raf.listeners),taste:await p2.evaluate(()=>window.__raf.taste),classes:await p2.evaluate(()=>document.querySelectorAll('#net [class*="hw-taste"],#net [style]').length)};
    assert.equal(result.dormant.listeners,0,'no listeners from the taste script');assert.equal(result.dormant.taste,0,'no animation frames from the taste script');assert.equal(result.dormant.classes,0,'no taste classes or inline styles');
    assert(clean(s)&&!s.lit.length,'page untouched');assert.deepEqual([d.strips,d.sp,d.hub,d.stage],[[],[],false,false],'page looks exactly as at load');assert.deepEqual(errs,[]);
    await dormantCtx.close();
    assert((await page.evaluate(()=>window.__raf.listeners))>0,'control: the normal taste script does register listeners');
  });

  // Touch (hasTouch + isMobile; a 1100x820 tablet, and a 390x844 phone for the invariants): taste adds nearest-neighbour in zone 3 only.
  // Tap in empty space = preview, second tap in the same snap area = open, tap elsewhere = clear/move, a tap ON a circle opens at once (the site's own), no zone-2 root, scrolling never previews.
  const T={touch:true,tablet:true},PHONE={touch:true};   // a phone browser adjusts a tap within about 25 px to the nearest circle (the pointer events already target it), so empty zone-3 space exists on tablets and larger touch screens
  const tapPt=async(page,pt)=>{const [x,y]=await clientOf(page,pt);await page.touchscreen.tap(x,y);await page.waitForTimeout(220);return [x,y];};
  const inView=async(page,pt)=>{const [x,y]=await clientOf(page,pt);return x>14&&x<376&&y>14&&y<830;};
  async function targets(page){   // circles with an empty zone-3 point and the circle itself on screen; a visible zone-2 point; the hub
    const circles=[];
    for(let i=0;i<N.paths.length&&circles.length<12;i++){
      if(!await inView(page,unit(i)))continue;
      for(const d of [40,34,46,28]){const pt=away(i,d),z=pick(N,...pt,-1),[x,y]=await clientOf(page,pt),hit=await page.evaluate(([a,b])=>!!document.elementFromPoint(a,b)?.closest('.spore,[data-open]'),[x,y]);
        if(z.zone===3&&z.spore===i&&!hit&&await inView(page,pt)){circles.push({i,pt});break;}}
    }
    let z2=null;for(let deg=0;deg<360&&!z2;deg+=5)for(let r=N.hub+6;r<260&&!z2;r+=6){const pt=polar(r,deg);if(pick(N,...pt,-1).zone===2&&await inView(page,pt))z2=pt;}
    assert(circles.length>=3&&z2,'touch targets in view: '+circles.length+' circles, zone-2 point '+z2);
    const far=circles.find(c=>c.i!==circles[0].i&&Math.hypot(...unit(c.i).map((v,k)=>v-unit(circles[0].i)[k]))>120)||circles[1];
    return {a:circles[0],b:far,z2,hubPt:[N.cx,N.cy]};
  }
  const oneRoute=s=>!s.painted.length||N.paths.some(p=>s.painted.every(q=>p.split(' ').includes(String(q.id))));
  await check('touch: a tap in empty zone-3 space previews (path, tag, snapped look); a second tap in the same snap area opens it once',TASTE,async(page,context,result)=>{
    await page.evaluate(()=>window.__raf.taste=0);
    const {a}=await targets(page),item=await itemOf(page,a.i);
    await tapPt(page,a.pt);const s=await snapshot(page);result.preview=s;
    assert.deepEqual(sorted(s.painted.map(p=>p.id)),sorted(pathIds(a.i)),'the previewed circle\'s path is lit on the overlay');assert(s.painted.every(p=>!p.tip));assert.deepEqual(s.lit,[],'nothing lit on the base');
    assert.deepEqual(s.snapped,[item]);assert(s.tag.includes(await labelOf(page,a.i)),'the site\'s tag names it: '+s.tag);assert(!s.paper);
    assert.equal((await page.evaluate(()=>window.__raf.picks)).length,0,'a first tap does not open');
    await tapPt(page,a.pt);await opened(page);
    const picks=await page.evaluate(()=>window.__raf.picks);result.picks=picks;assert.equal(picks.length,1,'one open');assert.equal(picks[0].title,await labelOf(page,a.i));
    assert(clean(await snapshot(page)),'opening clears the preview');assert.equal(await page.evaluate(()=>window.__raf.taste),0,'no animation frames on touch');
  },T);
  await check('touch: tapping elsewhere clears the preview; tapping another circle\'s snap area moves it; one route, no tracks',TASTE,async(page,context,result)=>{
    const {a,b,z2,hubPt}=await targets(page);await tapPt(page,a.pt);await tapPt(page,hubPt);const base=await page.evaluate(look);   // the overlay is built on the first preview on a touch-only device: the baseline is taken once it exists
    await tapPt(page,a.pt);let s=await snapshot(page);assert.deepEqual(s.snapped,[await itemOf(page,a.i)]);
    await tapPt(page,b.pt);s=await snapshot(page);assert.deepEqual(s.snapped,[await itemOf(page,b.i)],'the preview moved');assert.deepEqual(sorted(s.painted.map(p=>p.id)),sorted(pathIds(b.i)));assert(oneRoute(s));
    assert.equal((await page.evaluate(()=>window.__raf.picks)).length,0,'moving the preview never opens');
    await tapPt(page,hubPt);assert(clean(await snapshot(page)),'a tap off the circles clears');
    await tapPt(page,a.pt);await tapPt(page,z2);let c=await snapshot(page);assert(clean(c)&&!c.lit.length&&!c.tag,'a zone-2 tap clears and grows no root');
    await tapPt(page,b.pt);await tapPt(page,hubPt);c=await snapshot(page);assert(clean(c)&&!c.paper,'a hub tap clears; no glow on touch');
    const back=await differences(page,base);result.back={strips:back.strips,sp:back.sp,hub:back.hub,stage:back.stage};
    assert.deepEqual([back.strips,back.sp,back.hub,back.stage],[[],[],false,false],'no tracks: every strip, circle and the overlay look as at load');
  },T);
  await check('touch: a tap directly on a circle opens it immediately (the site\'s own behaviour, untouched)',TASTE,async(page,context,result)=>{
    const {a}=await targets(page);
    await tapPt(page,unit(a.i));await opened(page);
    const picks=await page.evaluate(()=>window.__raf.picks);result.picks=picks;assert.equal(picks.length,1);assert.equal(picks[0].title,await labelOf(page,a.i));
  },T);
  await check('touch: a preview, then a tap directly on another circle: that one opens at once (not the preview)',TASTE,async(page,context,result)=>{
    const {a,b}=await targets(page);
    await tapPt(page,a.pt);await tapPt(page,unit(b.i));await opened(page);
    const picks=await page.evaluate(()=>window.__raf.picks);assert.equal(picks.length,1);assert.equal(picks[0].title,await labelOf(page,b.i));
  },T);
  await check('touch: scroll gestures never trigger previews',TASTE,async(page,context,result)=>{
    const {a}=await targets(page),[x,y]=await clientOf(page,a.pt),cdp=await context.newCDPSession(page),y0=await page.evaluate(()=>scrollY);
    await cdp.send('Input.synthesizeScrollGesture',{x,y,yDistance:-90,speed:800,gestureSourceType:'touch'});await page.waitForTimeout(500);
    assert((await page.evaluate(()=>scrollY))!==y0,'the swipe scrolled the page');
    assert(clean(await snapshot(page)),'a vertical swipe that starts on empty zone-3 space previews nothing');
    const [x2,y2]=await clientOf(page,(await targets(page)).a.pt);
    await cdp.send('Input.synthesizeScrollGesture',{x:x2,y:y2,xDistance:-60,speed:800,gestureSourceType:'touch'});await page.waitForTimeout(400);
    assert(clean(await snapshot(page)),'nor a horizontal drag');
    assert.equal((await page.evaluate(()=>window.__raf.picks)).length,0);
  },T);
  await check('touch: seeded random taps keep at most one route, leave no tracks when cleared; nothing calls preventDefault (scrolling stays native)',TASTE,async(page,context,result)=>{
    await page.evaluate(()=>{window.__pd=0;const o=Event.prototype.preventDefault;Event.prototype.preventDefault=function(){if(/^(pointer|touch)/.test(this.type))window.__pd++;return o.call(this);};});
    const {a,hubPt}=await targets(page);await tapPt(page,a.pt);await tapPt(page,hubPt);const base=await page.evaluate(look);let seed=5;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647,bad=[];let previews=0,opens=0;
    for(let k=0;k<30;k++){
      let pt;for(let t=0;t<40;t++){const q=Math.floor(rnd()*N.paths.length);pt=k%3?[40+rnd()*1120,40+rnd()*680]:[N.spores[2*q]+(rnd()-.5)*90,N.spores[2*q+1]+(rnd()-.5)*90];if(await inView(page,pt))break;}
      if(!await inView(page,pt))continue;
      const n=(await page.evaluate(()=>window.__raf.picks)).length;await tapPt(page,pt);
      if((await page.evaluate(()=>window.__raf.picks)).length>n){opens++;await opened(page);await page.keyboard.press('Escape');await idle(page);await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(250);continue;}
      const s=await snapshot(page);if(s.snapped.length)previews++;
      if(!oneRoute(s)||s.snapped.length>1||s.paper||s.painted.some(p=>p.tip)||(s.painted.length&&s.snapped.length!==1))bad.push([k,pt,s.painted.map(p=>p.id),s.snapped]);
    }
    await tapPt(page,hubPt);await page.waitForTimeout(200);
    const back=await differences(page,base);
    result.touchWalk={previews,opens,violations:bad.length,first:bad.slice(0,3),preventedPointerEvents:await page.evaluate(()=>window.__pd),end:{strips:back.strips.length,sp:back.sp.length,hub:back.hub,stage:back.stage}};
    assert.deepEqual(bad.slice(0,3),[],'one route, one snapped circle');assert(previews>=(page.viewportSize().width>=800?3:0),'the walk previewed circles ('+previews+')');
    assert.equal(result.touchWalk.preventedPointerEvents,0,'no preventDefault on pointer or touch events');
    assert.deepEqual([back.strips,back.sp,back.hub,back.stage],[[],[],false,false],'tap elsewhere: no tracks');
  },T);
  // review round 4: a tap outside the stage clears a preview (circle, label, lit strips, promoted layer) without cancelling the tapped control or the scroll. Promotion follows the Network's visibility (D7 restated 2026-10-12: no promoted overlay while the Network is off-screen; it stays promoted while on screen so the next light costs no promotion frame).
  const promoted=page=>page.evaluate(()=>{const o=document.querySelector('#net .hw-taste-ov');return !!o&&(o.classList.contains('hw-taste-wc')||o.getAttribute('style')!==null||getComputedStyle(o).willChange!=='auto');});
  await check('touch: a tap outside the stage clears the preview (background, a link, a button, a swipe, a second finger, a scroll) and scrolling the Network away drops the promoted layer; the control still gets its click, nothing is preventDefault-ed',TASTE,async(page,context,result)=>{
    await page.evaluate(()=>{window.__pd=0;const o=Event.prototype.preventDefault;Event.prototype.preventDefault=function(){if(/^(pointer|touch)/.test(this.type))window.__pd++;return o.call(this);};
      const mk=(tag,id,css)=>{const e=document.createElement(tag);e.id=id;e.textContent=id;e.style.cssText='position:fixed;z-index:50;padding:6px;background:#fff;'+css;window.__out=window.__out||{};window.__out[id]=[];e.addEventListener('click',ev=>{window.__out[id].push(ev.defaultPrevented);if(tag==='a')ev.preventDefault();});document.body.append(e);};
      mk('a','hw-out-link','left:8px;top:8px');mk('button','hw-out-btn','right:8px;top:8px');document.getElementById('hw-out-link').href='/optimized-taste/#hw-nowhere';});
    const {a}=await targets(page),cdp=await context.newCDPSession(page),steps={};
    const bg=await page.evaluate(()=>{const st=document.querySelector('#net .net__stage'),b=st.getBoundingClientRect();
      for(const [x,y] of [[b.left+b.width/2,b.top-24],[b.left+b.width/2,b.bottom+24],[b.left-24,b.top+b.height/2],[b.right+24,b.top+b.height/2],[innerWidth/2,innerHeight-12],[innerWidth/2,60]]){const e=document.elementFromPoint(x,y);if(e&&!st.contains(e)&&!e.closest('a,button,summary,input,[data-open],[tabindex]'))return [x,y,e.nodeName+'.'+e.className];}return null;});
    assert(bg,'a plain background point outside the stage is on screen');
    const center=async id=>page.evaluate(id=>{const r=document.getElementById(id).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];},id);
    const after=async name=>{await page.waitForTimeout(250);const sn=await snapshot(page),pr=await promoted(page);steps[name]={clean:clean(sn)&&!sn.tag,promoted:pr};assert(clean(sn)&&!sn.tag,name+': the preview (circle, label, lit strips) is cleared');};   // the overlay stays promoted while the Network is on screen (no promotion frame at the next preview)
    const preview=async()=>{await tapPt(page,a.pt);const sn=await snapshot(page);assert(sn.snapped.length===1&&sn.painted.length&&await promoted(page),'previewed and promoted');};
    await preview();await page.touchscreen.tap(bg[0],bg[1]);await after('tap on the background ('+bg[2]+')');
    await preview();await page.touchscreen.tap(...await center('hw-out-link'));await after('tap on a link');
    await preview();await page.touchscreen.tap(...await center('hw-out-btn'));await after('tap on a button');
    const clicks=await page.evaluate(()=>window.__out);assert.deepEqual(clicks,{'hw-out-link':[false],'hw-out-btn':[false]},'each control got exactly its own click, not cancelled');
    const y0=await page.evaluate(()=>scrollY);
    await preview();await cdp.send('Input.synthesizeScrollGesture',{x:Math.round(bg[0]),y:Math.round(bg[1]),yDistance:-60,speed:800,gestureSourceType:'touch'});await after('a swipe that starts outside the stage');
    assert.notEqual(await page.evaluate(()=>scrollY),y0,'the swipe scrolled the page (native scrolling)');
    await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(250);
    const [ax,ay]=await clientOf(page,a.pt);
    await preview();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.round(ax),y:Math.round(ay),id:1},{x:Math.round(bg[0]),y:Math.round(bg[1]),id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await after('a two-finger touch, one finger outside the stage');
    await preview();await page.evaluate(()=>window.scrollBy({top:40,behavior:'instant'}));await after('a scroll (no tap)');
    await preview();await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(400);
    const gone=await snapshot(page);steps['the Network scrolled off-screen']={clean:clean(gone)&&!gone.tag,promoted:await promoted(page)};
    assert(clean(gone)&&!gone.tag,'scrolling the Network away clears the preview');assert(!await promoted(page),'no promoted overlay while the Network is off-screen');
    result.steps=steps;result.background=bg[2];
    assert.equal(await page.evaluate(()=>window.__pd),0,'no preventDefault on pointer or touch events');
  },T);

  // The verifier: place() ran only at promotion, so a resize while promoted left the overlay half a pixel off the site's strips (a cream fringe). It now re-places whenever the stage's device-pixel box changes.
  for(const dpr of [1,2])await check('resize mid-hover: the overlay is re-placed on resize and DPR change, and looks exactly like a fresh hover there (DPR '+dpr+')',TASTE,async(page,context,result)=>{
    const calm='*,*::before,*::after{animation:none!important;transition:none!important}.leaftag{display:none!important}';await page.addStyleTag({content:calm});
    const place=()=>page.evaluate(()=>{const hy=document.querySelector('#net .net__hyphae:not(.hw-taste-ov)'),o=document.querySelector('#net .hw-taste-ov'),R=hy.getBoundingClientRect(),X=R.left+scrollX,Y=R.top+scrollY;
      return {want:[X-Math.round(X),Y-Math.round(Y)].map(v=>Math.round(v*1e4)/1e4),have:['--hw-dx','--hw-dy'].map(k=>Math.round((parseFloat(o.style.getPropertyValue(k))||0)*1e4)/1e4),wc:o.classList.contains('hw-taste-wc')};});
    const stageShot=async()=>{const b=await rect(page);return page.screenshot({clip:{x:Math.max(0,b.left),y:Math.max(0,b.top),width:Math.min(b.width,page.viewportSize().width-Math.max(0,b.left)),height:Math.min(b.height,page.viewportSize().height-Math.max(0,b.top))}});};
    await move(page,z2pt,3);await page.waitForTimeout(100);let p=await place();assert(p.wc,'promoted');assert.deepEqual(p.have,p.want,'placed at promotion');
    const rows=[];
    // a resize may move the scroll position (scroll anchoring), which releases taste like any scroll; the pointer then works the network again at the same stage point
    for(const width of [1366,1367,1371,1290]){await page.setViewportSize({width,height:768});await page.waitForTimeout(200);const kept=(await place()).wc;await move(page,z2pt,1);await page.waitForTimeout(100);p=await place();rows.push({width,keptPromotion:kept,...p});
      assert(p.wc,'lit and promoted at '+width);assert.deepEqual(p.have,p.want,'placement right after the resize to '+width);}
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1290,height:768,deviceScaleFactor:dpr===1?2:1,mobile:false});await page.waitForTimeout(250);
    const kept=(await place()).wc;await move(page,z2pt,1);await page.waitForTimeout(100);
    p=await place();rows.push({dpr:dpr===1?2:1,keptPromotion:kept,...p});assert(p.wc);assert.deepEqual(p.have,p.want,'placement right after the DPR change');
    assert(rows.some(r=>r.keptPromotion),'at least one change kept the layer promoted (so the ResizeObserver path is exercised): '+JSON.stringify(rows));
    const stale=await stageShot();
    await move(page,[5,5],3);await page.mouse.move(2,2);await page.waitForTimeout(150);await move(page,z2pt,3);await page.waitForTimeout(150);
    const fresh=await stageShot();result.rows=rows;
    await writeFile(resolve(out,'resize-after-dpr'+dpr+'.png'),stale);await writeFile(resolve(out,'resize-fresh-dpr'+dpr+'.png'),fresh);
    // a DPR flip re-rasters the whole page (grain and AA move by a few levels everywhere); a stale overlay leaves a cream fringe along every lit strip (up to 141 levels)
    const sharp=loadSharp();
    const [A,Bf]=await Promise.all([stale,fresh].map(b=>sharp(b).removeAlpha().raw().toBuffer({resolveWithObject:true})));let worst=0,diff=0;
    for(let i=0;i<A.data.length;i++){const d=Math.abs(A.data[i]-Bf.data[i]);if(d){diff++;if(d>worst)worst=d;}}
    result.vsFresh={identical:stale.equals(fresh),channelsDiffering:diff,maxLevels:worst};
    assert(A.info.width===Bf.info.width&&worst<=12,'after resizing and changing DPR mid-hover the lit route looks like a fresh hover at the same size (max '+worst+' levels apart)');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  },{dpr,bypass:true});   // bypass: the calm style tag (no animation) needs it, as in the idle identity check

  // The verifier's notch: points between two buffers that open to the outside are nothing (zone 3 is the buffers plus enclosed pockets only); a pocket point still snaps.
  await check('zones: an outward notch between buffers does nothing; an enclosed pocket point snaps',TASTE,async(page,context,result)=>{
    const notch=[288.5,669.5];assert.deepEqual(pick(N,...notch),{zone:0});
    await move(page,[5,5],2);await move(page,notch,3);await page.waitForTimeout(100);
    const sn=await snapshot(page);assert(clean(sn)&&!sn.tag&&!sn.lit.length,'nothing at the notch: '+JSON.stringify(sn));
    const pk=N.holes.find(h=>!h.hub&&h.v.length>8).v;let pt=null;
    for(let y=Math.min(...pk.filter((_,k)=>k%2));y<Math.max(...pk.filter((_,k)=>k%2))&&!pt;y++)for(let x=Math.min(...pk.filter((_,k)=>!(k%2)));x<Math.max(...pk.filter((_,k)=>!(k%2)))&&!pt;x++){const z=pick(N,x,y,-1);if(z.zone===3&&Math.hypot(N.spores[2*z.spore]-x,N.spores[2*z.spore+1]-y)>N.fade+3)pt=[x,y,z.spore];}
    assert(pt,'a pocket point outside every buffer');
    await move(page,pt,3);await page.waitForTimeout(100);const p2=await snapshot(page);
    assert.deepEqual(p2.snapped,[await itemOf(page,pt[2])],'the pocket snaps to its nearest circle');result.pocketPoint=pt;
  });

  await check('touch (phone, 390 wide): seeded random taps keep at most one route, leave no tracks when cleared; nothing calls preventDefault (scrolling stays native)',TASTE,async(page,context,result)=>{
    await page.evaluate(()=>{window.__pd=0;const o=Event.prototype.preventDefault;Event.prototype.preventDefault=function(){if(/^(pointer|touch)/.test(this.type))window.__pd++;return o.call(this);};});
    const {a,hubPt}=await targets(page);await tapPt(page,a.pt);await tapPt(page,hubPt);const base=await page.evaluate(look);let seed=5;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647,bad=[];let previews=0,opens=0;
    for(let k=0;k<30;k++){
      let pt;for(let t=0;t<40;t++){const q=Math.floor(rnd()*N.paths.length);pt=k%3?[40+rnd()*1120,40+rnd()*680]:[N.spores[2*q]+(rnd()-.5)*90,N.spores[2*q+1]+(rnd()-.5)*90];if(await inView(page,pt))break;}
      if(!await inView(page,pt))continue;
      const n=(await page.evaluate(()=>window.__raf.picks)).length;await tapPt(page,pt);
      if((await page.evaluate(()=>window.__raf.picks)).length>n){opens++;await opened(page);await page.keyboard.press('Escape');await idle(page);await page.evaluate(()=>document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(250);continue;}
      const s=await snapshot(page);if(s.snapped.length)previews++;
      if(!oneRoute(s)||s.snapped.length>1||s.paper||s.painted.some(p=>p.tip)||(s.painted.length&&s.snapped.length!==1))bad.push([k,pt,s.painted.map(p=>p.id),s.snapped]);
    }
    await tapPt(page,hubPt);await page.waitForTimeout(200);
    const back=await differences(page,base);
    result.touchWalk={previews,opens,violations:bad.length,first:bad.slice(0,3),preventedPointerEvents:await page.evaluate(()=>window.__pd),end:{strips:back.strips.length,sp:back.sp.length,hub:back.hub,stage:back.stage}};
    assert.deepEqual(bad.slice(0,3),[],'one route, one snapped circle');assert(previews>=(page.viewportSize().width>=800?3:0),'the walk previewed circles ('+previews+')');
    assert.equal(result.touchWalk.preventedPointerEvents,0,'no preventDefault on pointer or touch events');
    assert.deepEqual([back.strips,back.sp,back.hub,back.stage],[[],[],false,false],'tap elsewhere: no tracks');
  },PHONE);
}finally{
  if(forcedBrowser)await forcedBrowser.close();
  if(process.env.HW_ONLY&&!matched)console.error('HW_ONLY='+process.env.HW_ONLY+' matched no case');
  report.passed=report.cases.every(c=>c.passed)&&!(process.env.HW_ONLY&&!matched);
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
  await fx.close();
}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failed:report.cases.filter(c=>!c.passed).map(c=>c.name),report:resolve(out,'report.json')}));
process.exit(report.passed?0:1);
