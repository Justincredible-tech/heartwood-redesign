/** Serial browser check of the opt-in "Taste you didn't ask for" Tree hover against a served artifact.
 * npm run build && node tools/verify-taste-tree.mjs
 * HW_SITE_ROOT=/tmp/hw-ttree-XXXX/site HW_OUT=output/playwright/review-taste-tree/verify-impl node tools/verify-taste-tree.mjs
 * Writes report.json to HW_OUT and, unless HW_NO_FRAMES=1, side-by-side raise/release frame sheets (faithful above, taste below) to HW_FRAMES.
 * Dark Reader: set HW_DARKREADER=/path/to/darkreader.js; HW_NO_DARKREADER=1 skips it, loudly.
 * HW_ONLY=<part of a case name>[|<another>] runs matching cases. One browser, one page at a time.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {treeData} from './taste-tree.mjs';
import {assertFrameSet,assertSelectedCases} from './frame-set-acceptance.mjs';
import {compareFidelity,assertFidelity} from './fidelity-acceptance.mjs';
import {PNG} from './fidelity-deps.mjs';
import pixelmatch from './fidelity-deps.mjs';

browserToolCLI({});
const siteRoot=resolve(process.env.HW_SITE_ROOT||new URL('../publish',import.meta.url).pathname);
const out=resolve(process.env.HW_OUT||new URL('../output/playwright/review-taste-tree/verify',import.meta.url).pathname);
const framesOut=resolve(process.env.HW_FRAMES||resolve(out,'frames'));
const runtime=ensureToolRuntime({name:'taste tree verification',runTimeoutMs:60*60*1000});await runtime.ready;
await runtime.deadline('prepare verification output',()=>mkdir(out,{recursive:true}),{timeoutMs:5000});
const sha=b=>createHash('sha256').update(b).digest('hex');
const D=treeData(await readRegularInput(resolve(siteRoot,'local/index.html'),{runtime})),TABLE=Object.keys(D.T).map(Number),SLIDING=TABLE.filter(id=>!D.rows.find(r=>r.id===id).shadow);
const PLAIN=111;   // a leaf nothing covers
const report={generatedAt:new Date().toISOString(),siteRoot,faithfulHtmlSha256:sha(await readRegularInput(resolve(siteRoot,'optimized/index.html'),{runtime,encoding:null})),tasteHtmlSha256:sha(await readRegularInput(resolve(siteRoot,'optimized-taste/index.html'),{runtime,encoding:null})),table:D.T,cases:[],budgets:{}};
const fx=await browserFixture({siteRoot,runtime,runTimeoutMs:60*60*1000}),{browser,base}=fx;
const requireDarkReaderPath=()=>{const value=process.env.HW_DARKREADER;if(!value||!value.trim())throw Error('UNSUPPORTED: Dark Reader is not available; set HW_DARKREADER to a darkreader.js path or set HW_NO_DARKREADER=1 to skip it explicitly (see docs/TESTING.md)');return value.trim();};
const DARKREADER=()=>resolve(requireDarkReaderPath());
let forced=null;
const TASTE='/optimized-taste/',FAITHFUL='/optimized/';
const frame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
const clones=page=>page.evaluate(()=>document.querySelectorAll('.hw-taste-clone').length);

async function open(route,{width=1424,height=820,dpr=1,mode='plain',touch=false,reduced=false,bypass=false}={}){
  if(mode==='forced')forced||=await fx.launch(['--force-dark-mode','--enable-features=WebContentsForceDark']);
  const context=await (mode==='forced'?forced:browser).newContext({viewport:{width,height},deviceScaleFactor:dpr,colorScheme:mode==='forced'?'dark':'light',bypassCSP:mode==='dr'||bypass,reducedMotion:reduced?'reduce':'no-preference',...(touch&&{hasTouch:true,isMobile:true})});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/taste/i.test(m.text())&&['warning','error'].includes(m.type()))errors.push(m.text());});
  await page.addInitScript(()=>{
    window.__picks=[];window.__csp=[];window.__clonesSeen=0;
    // A microtask runs after every leaf:pick listener, so it sees the DOM at the end of the same task.
    document.addEventListener('leaf:pick',e=>{const d={id:e.detail.id,item:e.detail.leaf&&e.detail.leaf.dataset.item};queueMicrotask(()=>{d.clones=document.querySelectorAll('.hw-taste-clone').length;window.__picks.push(d);});});
    document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));
    new MutationObserver(m=>{for(const r of m)for(const n of r.addedNodes)if(n.classList&&n.classList.contains('hw-taste-clone'))window.__clonesSeen++;}).observe(document,{subtree:true,childList:true});
  });
  if(mode==='dr'){
    assert(existsSync(DARKREADER()),'Dark Reader library not found at '+DARKREADER()+' (see the header of tools/verify-taste-tree.mjs)');
    await page.addInitScript({content:await readRegularInput(DARKREADER(),{runtime,syntax:'script'})+';document.addEventListener("DOMContentLoaded",()=>DarkReader.enable({brightness:100,contrast:100,sepia:0}));'});
  }
  await page.goto(base+route,{waitUntil:'load'});
  await page.waitForFunction(()=>window.leafLift&&document.querySelectorAll('button.leaf[data-leaf]').length>100);
  await page.waitForTimeout(3500);   // canopy entrance finishes before a real pointer hit
  if(mode==='dr')assert(await page.evaluate(()=>document.querySelectorAll('style.darkreader').length>0),'Dark Reader is active');
  await page.mouse.move(2,2);await frame(page);
  return {context,page,errors};
}
// A client point on the leaf's real face (a pointer hit), nearest the centroid of its hit area.
const pointOf=(page,id)=>page.evaluate(id=>{
  const b=document.querySelector(`button.leaf[data-leaf="${id}"]`),r=b.getBoundingClientRect(),pts=[];
  for(let y=r.top;y<r.bottom;y+=2)for(let x=r.left;x<r.right;x+=2){const e=document.elementFromPoint(x,y);if(e&&e.closest('button.leaf')===b)pts.push([x,y]);}
  if(!pts.length)return null;
  const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;
  return pts.sort((p,q)=>Math.hypot(p[0]-cx,p[1]-cy)-Math.hypot(q[0]-cx,q[1]-cy))[0];
},id);
const hoverLeaf=async(page,id,wait=500)=>{const p=await pointOf(page,id);assert(p,'a hit point on leaf '+id);await page.mouse.move(p[0],p[1]);await page.waitForTimeout(wait);return p;};
const leave=async(page,wait=500)=>{await page.mouse.move(2,2);await page.waitForTimeout(wait);};
const stageHtml=page=>page.evaluate(()=>document.getElementById('stage').outerHTML);

// Topmost node at a point ignoring pointer-events:none (what is painted there), via CDP.
async function topAt(cdp,x,y){
  const {backendNodeId}=await cdp.send('DOM.getNodeForLocation',{x:Math.round(x),y:Math.round(y),ignorePointerEventsNone:true});
  const {object}=await cdp.send('DOM.resolveNode',{backendNodeId});
  const {result}=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,returnByValue:true,functionDeclaration:'function(){return {clone:!!this.closest(".hw-taste-clone"),over:!!this.closest(".hw-taste-over"),wood:!!this.closest(".scene.bigtree"),face:this.classList.contains("leaf__face"),leaf:(this.closest("button.leaf")||{dataset:{}}).dataset.leaf||null};}'});
  return result.value;
}

let matched=0;
async function check(name,route,run,opts){
  if(process.env.HW_ONLY&&!process.env.HW_ONLY.split('|').some(k=>name.includes(k)))return;
  matched++;
  const {context,page,errors}=await open(route,opts),result={name};
  try{
    await run(page,context,result);
    assert.deepEqual(await page.evaluate(()=>window.__csp),[],'no CSP violations');assert.deepEqual(errors,[],'no page errors or taste warnings');
    result.passed=true;
  }catch(e){result.passed=false;result.error=e.stack.split('\n').slice(0,4).join(' | ');}
  report.cases.push(result);console.log((result.passed?'PASS ':'FAIL ')+name+(result.error?': '+result.error.split(' | ')[0]:''));
  await context.close();
}
const percentile=(v,q)=>[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor(v.length*q))]??0;

try{
  await check('identity: the page ships the tree taste in the same two assets',TASTE,async()=>{
    const html=await readRegularInput(resolve(siteRoot,'optimized-taste/index.html'),{runtime}),faithful=await readRegularInput(resolve(siteRoot,'optimized/index.html'),{runtime});
    const tag=/<link rel="stylesheet" href="\.\/assets\/taste\.[0-9a-f]{16}\.css">\n<script defer src="\.\/assets\/taste\.[0-9a-f]{16}\.js"><\/script>\n/g;
    // the one taste build also carries the designed dark mode (two head tags, night faces, ground walkers), stripped as the dark-mode fixtures assert
    const darkTags=/<script src="\.\/assets\/taste-dark\.[0-9a-f]{16}\.js"><\/script>\n|<link rel="stylesheet" href="\.\/assets\/taste-dark\.[0-9a-f]{16}\.css">\n/g;
    const night=h=>h.replace(/ hw-night hw-n-[\w-]+ hw-n-[\w-]+/g,'').replace(/<span class="bird__face hw-nface[\s\S]*?<\/span>(?=<\/span><\/div>)/g,'').replace(/<div class="bugs hw-nx-walkers">[\s\S]*?<\/div><\/div>\n      /,'');
    assert.equal(night(html.replace(tag,'').replace(darkTags,'')),faithful,'taste HTML minus its two tags and the dark mode\'s tags and night markup equals the faithful HTML');
    report.faithfulHtmlSha256=sha(faithful);report.tasteHtmlSha256=sha(html);
  });

  // 1 + 2: rest pixels and DOM, before and after a sweep over the whole table.
  for(const width of [1424,1920,1000])await check('rest identity at '+width+': pixels equal the faithful page before and after a sweep; .stage markup unchanged',TASTE,async(page,context,result)=>{
    // The faithful page itself is not pixel-stable at the wider layouts: a few dozen pixels of the composited canopy flip between two rasters from one screenshot to the next.
    // Photograph multiple faithful rasters. Every taste frame must match one:
    // exact hashes are a fast path; an unseen hash uses the established strict
    // reference control (zero threshold pixels, max DeltaE <=2.3).
    const opts={width,height:width===1000?900:820,reduced:true};
    result.frameArtifacts=[];
    const rasters=new Map();result.frameComparisons=[];
    const shots=async(p,n,label)=>{const h=new Set();for(let i=0;i<n;i++){
      const bytes=await p.locator('#stage').screenshot({animations:'disabled'}),hash=sha(bytes),file='rest-'+width+'-'+label+'-'+i+'-'+hash.slice(0,12)+'.png';
      await writeFile(resolve(out,file),bytes);result.frameArtifacts.push({label,index:i,sha256:hash,file});rasters.set(hash,PNG.sync.read(bytes));h.add(hash);await p.waitForTimeout(400);
    }return h;};
    const checkFrames=(samples,references,label)=>{
      const accepted=[];
      for(const hash of samples){
        if(references.has(hash)){accepted.push(hash);result.frameComparisons.push({label,sha256:hash,reference:hash,mode:'exact'});continue;}
        const candidate=rasters.get(hash),comparisons=[];let matched=null;
        for(const reference of references){
          const original=rasters.get(reference),diff=new Uint8Array(original.data.length);
          if(original.width!==candidate.width||original.height!==candidate.height)continue;
          pixelmatch(original.data,candidate.data,diff,original.width,original.height,{threshold:.1});
          const count=original.width*original.height,metrics=compareFidelity(original,candidate,diff,{bits:new Uint8Array(count),edges:new Uint8Array(count),scale:{x:1,y:1,area:1}});
          let passed=false;try{assertFidelity(metrics,{ceilingCSSPixels:0,strictZero:true});passed=true;}catch{}
          comparisons.push({reference,passed,...metrics});if(passed){matched=reference;break;}
        }
        result.frameComparisons.push({label,sha256:hash,reference:matched,mode:'every-frame existing strict raster control: zero threshold pixels and max DeltaE <=2.3',comparisons});accepted.push(matched||hash);
      }
      assertFrameSet(accepted,references,label);
    };
    const f=await open(FAITHFUL,opts);let faithful;
    try{faithful=await shots(f.page,6,'faithful');}finally{await f.context.close();}
    const t=await open(TASTE,opts);
    try{
      await t.page.evaluate(()=>{for(const e of document.querySelectorAll('.hw-nx-walkers'))e.style.setProperty('visibility','hidden','important');});   // the one taste build's light mode adds the cottontail on the ground line (verify-taste-dark's light case judges it); the tree is judged without it
      const before=await stageHtml(t.page),first=await shots(t.page,3,'taste-before');
      checkFrames(first,faithful,'before the sweep: every taste frame matches a faithful raster');
      for(const id of [...TABLE,PLAIN,...TABLE.slice().reverse()]){const p=await pointOf(t.page,id);if(p){await t.page.mouse.move(p[0],p[1]);await t.page.waitForTimeout(70);}}
      await leave(t.page,700);
      assert.equal(await clones(t.page),0,'clones are gone');
      assert.equal(await stageHtml(t.page),before,'.stage outerHTML is unchanged after teardown');
      const after=await shots(t.page,3,'taste-after');
      checkFrames(after,faithful,'after the sweep: every taste frame matches a faithful raster');
      assert.deepEqual(t.errors,[]);
      result.frames={faithful:[...faithful],before:[...first],after:[...after]};
    }finally{await t.context.close();}
  });

  await check('unoccluded hover: no DOM change at all',TASTE,async(page)=>{
    const before=await stageHtml(page);
    await hoverLeaf(page,PLAIN);
    assert.equal(await stageHtml(page),before,'hovering a leaf nothing covers changes no markup');
    assert.equal(await page.evaluate(()=>window.__clonesSeen),0);
    await leave(page);assert.equal(await stageHtml(page),before);
  });

  await check('raised leaf is on top: U wins where the wood covers it; the real face still takes the hit',TASTE,async(page,context,result)=>{
    const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('DOM.getDocument',{depth:0});
    await page.evaluate(()=>{for(const e of document.querySelectorAll('body *'))if(getComputedStyle(e).position==='fixed')e.style.visibility='hidden';});   // the modal's full-page pointer-events:none overlays would be the "topmost" node everywhere
    result.leaves={};
    for(const id of [149,13,43,2,127,15]){
      const b=await page.evaluate(id=>{const r=document.querySelector(`button.leaf[data-leaf="${id}"]`).getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];},id);
      const grid=[];for(let y=b[1];y<b[3];y+=3)for(let x=b[0];x<b[2];x+=3)grid.push([x,y]);
      const faceAt=p=>page.evaluate(([x,y,id])=>{const e=document.elementFromPoint(x,y);return !!e&&e.closest('button.leaf')===document.querySelector(`button.leaf[data-leaf="${id}"]`);},[...p,id]);
      await hoverLeaf(page,id,500);
      const real=[];for(const p of grid)if(await faceAt(p))real.push(p);   // the hover-pose hit region of the real (hidden) leaf
      assert(real.length>20,'leaf '+id+' hit region');
      let covered=0,wrong=[];
      for(const p of real.filter((_,i)=>i%3===0)){const top=await topAt(cdp,...p);if(!(top.clone&&top.over))wrong.push([p,top]);else covered++;}
      assert.equal(wrong.length,0,'leaf '+id+': '+wrong.length+' hit points are not painted by the raised copy: '+JSON.stringify(wrong[0]));
      await leave(page,600);
      let underWood=0;for(const p of real.filter((_,i)=>i%3===0)){const top=await topAt(cdp,...p);if(top.wood)underWood++;}
      assert(underWood>0,'leaf '+id+': at rest the wood does cover part of its hit region (otherwise this check proves nothing)');
      result.leaves[id]={hitPoints:real.length,paintedByCopy:covered,underWoodAtRest:underWood};
    }
  });

  await check('browser occluded set equals the build table',FAITHFUL,async(page,context,result)=>{
    // Faithful page, every leaf forced into the hover pose, the wood made hit-testable: a leaf is covered where its face and a wood piece share a point.
    await page.addStyleTag({content:'.scene.bigtree,.scene.bigtree *{pointer-events:auto!important} button.leaf{transition:none!important;transform:translate(-50%,-100%) rotate(calc(var(--angle) + 3deg)) scale(1.14)!important}'});
    await frame(page);
    // only leaves whose box meets a wood piece's box can be covered; one evaluate per such leaf (the whole scan in one call outlasts the runtime's 30 s step deadline under load)
    const cover=await page.evaluate(()=>{const pieces=[...document.querySelectorAll('.scene.bigtree i')].map(i=>i.getBoundingClientRect());
      return Object.fromEntries([...document.querySelectorAll('.tree button.leaf[data-leaf]')].map(b=>{const r=b.getBoundingClientRect();return [b.dataset.leaf,pieces.some(p=>p.left<r.right&&p.right>r.left&&p.top<r.bottom&&p.bottom>r.top)?null:0];}));});
    for(const id of Object.keys(cover).filter(k=>cover[k]===null))cover[id]=await page.evaluate(id=>{
      const b=document.querySelector(`.tree button.leaf[data-leaf="${id}"]`),r=b.getBoundingClientRect(),face=b.querySelector('.leaf__face');let n=0,hit=0;
      for(let y=r.top+.5;y<r.bottom;y+=2)for(let x=r.left+.5;x<r.right;x+=2){
        const st=document.elementsFromPoint(x,y);if(!st.includes(face))continue;n++;
        if(st.some(e=>e.matches('.scene.bigtree i')))hit++;   // the wood pieces only: their .cut / scene boxes span the whole stage
      }
      return n?hit/n:0;
    },id);
    const covered=Object.entries(cover).filter(([,f])=>f>=.02).map(([id])=>+id),table=SLIDING;
    result.coverFraction=Object.fromEntries(Object.entries(cover).filter(([,f])=>f>0));
    for(const id of covered)assert(table.includes(id),'leaf '+id+' is '+(cover[id]*100).toFixed(1)+'% under the wood in the browser but not in the table');
    for(const id of table)assert(cover[id]>0||D.rows.find(r=>r.id===id).hover<.015,'leaf '+id+' is in the table but nothing covers it in the browser');
    for(const id of Object.keys(cover).map(Number))if(!table.includes(id)&&!TABLE.includes(id))assert(cover[id]<.01,'leaf '+id+' is '+(cover[id]*100).toFixed(2)+'% covered in the browser and absent');
  },{reduced:true,bypass:true});

  await check('invariants every frame while sweeping the cluster; clone cap; no leaf flashes missing',TASTE,async(page,context,result)=>{
    const ids=[];for(const id of TABLE){const p=await pointOf(page,id);if(p)ids.push([id,p]);}
    await page.evaluate(()=>{
      const S=window.__inv={frames:0,bad:[],maxClones:0,maxVisibleU:0,maxUp:0};
      const key=e=>[...e.classList].filter(c=>/^hw-s-/.test(c)).join();
      const tick=()=>{
        S.frames++;
        const L=[...document.querySelectorAll('.tree:not(.hw-taste-over) > .hw-taste-clone')],U=[...document.querySelectorAll('.hw-taste-over > .hw-taste-clone')];
        S.maxClones=Math.max(S.maxClones,L.length+U.length);
        const vis=e=>parseFloat(getComputedStyle(e).opacity)>.001,uv=U.filter(vis);
        S.maxVisibleU=Math.max(S.maxVisibleU,uv.length);
        S.maxUp=Math.max(S.maxUp,U.filter(u=>u.firstElementChild.classList.contains('hw-taste-up')).length);
        for(const u of U){const l=L.find(x=>key(x)===key(u));if(!l){S.bad.push('no L for '+key(u));continue;}
          const a=vis(l),b=vis(u);if(a&&b)S.bad.push('L and U both visible '+key(u));if(!a&&!b)S.bad.push('neither visible '+key(u));}
        for(const e of document.querySelectorAll('.hw-leaf-layer.hw-taste-hidden:not(.hw-taste-clone)'))if(getComputedStyle(e).opacity!=='0')S.bad.push('original not hidden');
        requestAnimationFrame(tick);
      };requestAnimationFrame(tick);
    });
    const end=Date.now()+8000;let i=0;
    while(Date.now()<end){const [,p]=ids[i++%ids.length];await page.mouse.move(p[0],p[1]);await page.waitForTimeout(i%5===0?160:45);if(i%11===0)await page.waitForTimeout(350);}
    await leave(page,700);
    const inv=await page.evaluate(()=>window.__inv);result.inv={frames:inv.frames,maxClones:inv.maxClones,maxVisibleU:inv.maxVisibleU,maxUp:inv.maxUp,bad:inv.bad.slice(0,5)};
    assert.deepEqual(inv.bad,[],'frame invariants');
    assert(inv.maxClones<=6,'at most 6 clones: '+inv.maxClones);assert(inv.maxUp<=1,'one leaf up at a time: '+inv.maxUp);
    assert.equal(await clones(page),0);
  });

  await check('timing: switch at 112 ms (40% of 280), teardown when the reversed animation ends',TASTE,async(page)=>{
    const p=await pointOf(page,149);
    await page.mouse.move(p[0],p[1]);
    const t=await page.evaluate(()=>{
      const as=document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.classList&&a.effect.target.classList.contains('hw-leaf-layer')&&a.effect.target.classList.contains('hw-taste-clone'));
      for(const a of as)a.pause();
      const L=as.find(a=>!a.effect.target.parentNode.classList.contains('hw-taste-over')),U=as.find(a=>a.effect.target.parentNode.classList.contains('hw-taste-over'));
      const op=a=>parseFloat(getComputedStyle(a.effect.target).opacity),seek=ms=>{L.currentTime=ms;U.currentTime=ms;return [op(L),op(U)];};
      return {count:as.length,duration:L.effect.getTiming().duration,at100:seek(100),at111:seek(111),at113:seek(113),at280:seek(280)};
    });
    assert.equal(t.count,2);assert.equal(t.duration,280);
    assert.deepEqual(t.at100,[1,0]);assert.deepEqual(t.at111,[1,0]);assert.deepEqual(t.at113,[0,1]);assert.deepEqual(t.at280,[0,1]);
    // leave: the reversed animation runs 280 ms back to 0; clones exist until it ends, then vanish
    await page.evaluate(()=>{for(const a of document.getAnimations())a.play();});
    await page.waitForTimeout(400);
    await page.mouse.move(2,2);await frame(page);   // a finished animation is not in getAnimations() (and a pending playback rate not yet applied) until the next frame
    const mid=await page.evaluate(()=>{
      const as=document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.classList&&a.effect.target.classList.contains('hw-taste-clone')&&a.effect.target.classList.contains('hw-leaf-layer'));
      for(const a of as)a.pause();for(const a of as)a.currentTime=279;
      return {n:as.length,rates:as.map(a=>a.playbackRate),clones:document.querySelectorAll('.hw-taste-clone').length};
    });
    assert.equal(mid.n,2);assert(mid.rates.every(r=>r<0),'release plays reversed');assert.equal(mid.clones,2);
    await page.evaluate(()=>{for(const a of document.getAnimations())if(a.playbackRate<0){a.currentTime=1;a.play();}});
    await page.waitForFunction(()=>!document.querySelector('.hw-taste-clone'),null,{timeout:2000});
    assert.equal(await page.evaluate(()=>!!document.querySelector('.hw-taste-over')),false,'overlay removed when empty');
  });

  await check('click opens the same item as the faithful page; clones gone in the same task',TASTE,async(page,context,result)=>{
    const id=149,p=await hoverLeaf(page,id,500);
    assert(await clones(page)>0);
    await page.mouse.down();await page.mouse.up();
    await page.waitForFunction(()=>!document.getElementById('dialog').hidden&&document.activeElement.id==='dialog-close',null,{timeout:6500});
    const picks=await page.evaluate(()=>window.__picks);
    assert.equal(picks.length,1);assert.equal(picks[0].id,String(id));assert.equal(picks[0].clones,0,'no clones at the end of the leaf:pick task');
    const own=await page.evaluate(id=>document.querySelector(`button.leaf[data-leaf="${id}"]`).dataset.item,id);assert.equal(picks[0].item,own);
    const title=await page.evaluate(()=>document.querySelector('#dialog h1,#dialog h2,#dialog .dialog__title')?.textContent.trim());
    result.title=title;result.pick=picks[0];
    // the same click on the faithful page
    const f=await open(FAITHFUL);
    try{
      const q=await pointOf(f.page,id);await f.page.mouse.move(q[0],q[1]);await f.page.waitForTimeout(500);await f.page.mouse.down();await f.page.mouse.up();
      await f.page.waitForFunction(()=>!document.getElementById('dialog').hidden&&document.activeElement.id==='dialog-close',null,{timeout:6500});
      const ft=await f.page.evaluate(()=>document.querySelector('#dialog h1,#dialog h2,#dialog .dialog__title')?.textContent.trim());
      assert.equal(title,ft,'same dialog title as the faithful page');assert.equal((await f.page.evaluate(()=>window.__picks))[0].item,own);
    }finally{await f.context.close();}
  });

  await check('tag text equals the faithful page for every sliding leaf',TASTE,async(page,context,result)=>{
    const f=await open(FAITHFUL);const rows={};
    try{
      for(const id of TABLE){
        const tag=async p=>{await leave(p,150);const q=await pointOf(p,id);await p.mouse.move(q[0],q[1]);await p.waitForTimeout(250);return p.evaluate(()=>{const t=document.getElementById('leaftag');return t.classList.contains('is-on')?t.textContent:'';});};
        const a=await tag(page),b=await tag(f.page);
        assert.equal(a,b,'leaf '+id+' tag');rows[id]=a;
      }
    }finally{await f.context.close();}
    result.tags=rows;assert(Object.values(rows).some(Boolean),'at least one leaf has a tag');
  });

  await check('filtered mode: the raised copy keeps the lit leaf lift (--lift 1.5) and the filtered look',TASTE,async(page,context,result)=>{
    const kinds=await page.evaluate(ids=>ids.map(id=>[id,document.querySelector(`button.leaf[data-leaf="${id}"]`).dataset.kind]),SLIDING);
    const [id,kind]=kinds.find(([,k])=>k&&k!=='undefined')||[];assert(id,'a sliding leaf with a kind');
    const chip=await page.evaluate(k=>{const c=document.querySelector(`#key-chips .chip[data-filter="${k}"]`);if(!c)return false;c.click();return true;},kind);assert(chip,'chip for '+kind);
    await frame(page);await page.waitForTimeout(400);
    assert.equal(await page.evaluate(id=>document.querySelector(`button.leaf[data-leaf="${id}"]`).classList.contains('is-lit'),id),true);
    const p=await pointOf(page,id);assert(p,'hit point for lit leaf');await page.mouse.move(p[0],p[1]);await page.waitForTimeout(500);
    const s=await page.evaluate(()=>{const U=document.querySelector('.hw-taste-over > .hw-taste-clone'),L=document.querySelector('.tree:not(.hw-taste-over) > .hw-taste-clone'),o=U&&U.firstElementChild;
      return U&&{lift:getComputedStyle(o).getPropertyValue('--lift').trim(),filtered:U.parentNode.classList.contains('is-filtered'),lz:getComputedStyle(L).zIndex,transform:getComputedStyle(o).transform,real:getComputedStyle(document.querySelector('button.leaf:hover')).transform};});
    assert(s,'raised in filtered mode');assert.equal(s.lift,'1.5');assert(s.filtered);assert.equal(s.lz,'4');assert.equal(s.transform,s.real,'same hover pose as the real leaf');
    result.filtered={id,kind,...s};
  });

  // Keyboard focus on a raised leaf (review round 5): the copies are inert and never match :focus-visible, so the site's own ring is mirrored onto them (hw-taste-fv); focus and semantics stay on the real button.
  // Every focus x hover x filter x found combination, focus arriving before and during the raise, blur mid-raise, release, and interruption by a click (leaf:pick); ring pixels against the faithful page.
  const leafState=(page,id)=>page.evaluate(id=>{const b=document.querySelector(`button.leaf[data-leaf="${id}"]`),U=document.querySelector('.hw-taste-over > .hw-taste-clone > button.leaf'),L=document.querySelector('.tree:not(.hw-taste-over) > .hw-taste-clone > button.leaf'),f=e=>e&&getComputedStyle(e).filter;
    return {fv:b.matches(':focus-visible'),active:document.activeElement===b,raised:!!U,real:f(b),U:f(U),L:f(L),Ufv:!!U&&U.classList.contains('hw-taste-fv'),inert:!!U&&!!U.closest('[inert]')&&U.tabIndex===-1&&!U.hasAttribute('data-leaf'),clones:document.querySelectorAll('.hw-taste-clone').length};},id);
  const kbFocus=async(page,id)=>{await page.keyboard.press('Shift');await page.evaluate(id=>document.querySelector(`button.leaf[data-leaf="${id}"]`).focus({focusVisible:true}),id);await frame(page);};
  const ringPixels=async(page,id)=>{   // pixels of the site's --focus colour around the leaf (the outer ring), DPR 1
    const [box,rgb]=await page.evaluate(id=>{const r=document.querySelector(`button.leaf[data-leaf="${id}"]`).getBoundingClientRect(),c=document.createElement('i');c.style.color=getComputedStyle(document.documentElement).getPropertyValue('--focus');document.body.append(c);const v=getComputedStyle(c).color.match(/\d+/g).map(Number);c.remove();return [{x:Math.max(0,r.left-30),y:Math.max(0,r.top-30),width:r.width+60,height:r.height+60},v];},id);
    const png=PNG.sync.read(await page.screenshot({clip:box}));let n=0;for(let i=0;i<png.data.length;i+=4)if(Math.abs(png.data[i]-rgb[0])+Math.abs(png.data[i+1]-rgb[1])+Math.abs(png.data[i+2]-rgb[2])<60)n++;return n;};
  for(const id of [69,13])for(const filtered of [false,true])await check('focus: a keyboard-focused raised leaf keeps its focus ring on the visible copy (leaf '+id+(filtered?', filtered':'')+'; focus x hover x found, blur, release, interruption)',TASTE,async(page,context,result)=>{
    const calm='*,*::before,*::after{transition:none!important}.leaftag{display:none!important}';
    if(filtered){const kind=await page.evaluate(id=>document.querySelector(`button.leaf[data-leaf="${id}"]`).dataset.kind,id);
      assert(await page.evaluate(k=>{const c=document.querySelector(`#key-chips .chip[data-filter="${k}"]`);if(!c)return false;c.click();return true;},kind),'chip for '+kind);await frame(page);await page.waitForTimeout(400);
      assert(await page.evaluate(id=>document.querySelector(`button.leaf[data-leaf="${id}"]`).classList.contains('is-lit'),id),'the leaf is lit by its own filter');}
    const steps={};
    // focus, then hover: the ring is on both copies, exactly the real button's computed filter
    await kbFocus(page,id);let s=await leafState(page,id);assert(s.fv&&s.active&&!s.raised,'keyboard focus, not raised yet');
    await hoverLeaf(page,id,500);s=steps.focusThenHover=await leafState(page,id);
    assert(s.raised&&s.fv&&s.active&&s.Ufv&&s.inert,'raised, focus stays on the real button, the copies carry the ring and stay inert: '+JSON.stringify(s));
    assert(/drop-shadow/.test(s.real)&&s.U===s.real&&s.L===s.real,'copies show the real leaf\'s focus filter: '+JSON.stringify(s));
    await page.addStyleTag({content:calm});await page.waitForTimeout(50);const tasteRing=await ringPixels(page,id);
    // blur mid-raise: the ring goes with it; focus again mid-raise: it comes back
    await page.evaluate(()=>document.activeElement.blur());await frame(page);s=steps.blurMidRaise=await leafState(page,id);
    assert(s.raised&&!s.fv&&!s.Ufv&&s.U===s.real,'blur mid-raise: no ring on the copies either');
    await kbFocus(page,id);s=steps.focusMidRaise=await leafState(page,id);assert(s.raised&&s.Ufv&&s.U===s.real,'focus mid-raise: ring back on the copies');
    // release: the copies go, the real leaf (visible again) has its own ring
    await leave(page,600);s=steps.released=await leafState(page,id);assert(!s.raised&&s.clones===0&&s.fv&&s.active,'released: copies gone, focus and ring on the real leaf');
    // hover, then focus
    await page.evaluate(()=>document.activeElement.blur());await hoverLeaf(page,id,500);await kbFocus(page,id);s=steps.hoverThenFocus=await leafState(page,id);
    assert(s.raised&&s.Ufv&&s.U===s.real,'focus arriving while raised reaches the copies');
    // interruption: a click opens it; the copies are gone in the same task (the existing click case checks the pick)
    await page.mouse.down();await page.mouse.up();
    await page.waitForFunction(()=>!document.getElementById('dialog').hidden,null,{timeout:6500});
    s=steps.clicked=await leafState(page,id);assert.equal(s.clones,0,'clicked: no copies');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.leafLift.busy(),null,{timeout:8000});await leave(page,300);
    // found: a found leaf keeps the site's own look (never raised), focused or not
    await page.evaluate(id=>document.querySelector(`button.leaf[data-leaf="${id}"]`).classList.add('is-found'),id);await kbFocus(page,id);await hoverLeaf(page,id,500);
    s=steps.found=await leafState(page,id);assert(!s.raised&&s.clones===0,'found: the site\'s own hover, no copies');
    // the faithful page, focused and hovered: the ring is there too (partly under the wood); taste shows at least as much of it
    const fp=await open(FAITHFUL,{bypass:true});let faithfulRing;
    try{if(filtered){const kind=await fp.page.evaluate(id=>document.querySelector(`button.leaf[data-leaf="${id}"]`).dataset.kind,id);await fp.page.evaluate(k=>document.querySelector(`#key-chips .chip[data-filter="${k}"]`).click(),kind);await frame(fp.page);await fp.page.waitForTimeout(400);}
      await kbFocus(fp.page,id);await hoverLeaf(fp.page,id,500);await fp.page.addStyleTag({content:calm});await fp.page.waitForTimeout(50);faithfulRing=await ringPixels(fp.page,id);}finally{await fp.context.close();}
    Object.assign(result,{id,filtered,steps,ringPixels:{taste:tasteRing,faithful:faithfulRing}});
    assert(faithfulRing>20&&tasteRing>=faithfulRing*.9,'focus ring pixels while raised: taste '+tasteRing+' vs faithful '+faithfulRing);
  },{bypass:true});   // bypass: the calm style tag (no transitions) for the ring pixel count

  await check('touch: nothing happens, no clones ever',TASTE,async(page,context,result)=>{
    assert.equal(await page.evaluate(()=>matchMedia('(hover: hover)').matches),false);
    for(const id of SLIDING.slice(0,4)){const p=await pointOf(page,id);if(!p)continue;await page.touchscreen.tap(p[0],p[1]);await page.waitForTimeout(150);}
    assert.equal(await page.evaluate(()=>window.__clonesSeen),0);
  },{touch:true,width:390,height:844});

  for(const mode of ['plain','dr','forced'])await check('colour parity ('+mode+'): raised copies look exactly like the real leaf',TASTE,async(page,context,result)=>{
    if(mode==='dr')assert(existsSync(DARKREADER()));
    const take=id=>page.evaluate(id=>{
      const real=document.querySelector(`button.leaf[data-leaf="${id}"]`),h=t=>{let x=5381;for(let i=0;i<t.length;i++)x=(x*33^t.charCodeAt(i))>>>0;return x.toString(36);};
      const look=b=>{const top=b.querySelector('.leaf__top'),cb=getComputedStyle(b),ct=getComputedStyle(top);
        return {bg:ct.backgroundColor,img:h(ct.backgroundImage),a:ct.getPropertyValue('--a').trim(),filter:cb.filter,btnFilter:cb.getPropertyValue('filter'),transform:cb.transform,lift:cb.getPropertyValue('--lift').trim(),color:ct.color};};
      const L=document.querySelector('.tree:not(.hw-taste-over) > .hw-taste-clone > button'),U=document.querySelector('.hw-taste-over > .hw-taste-clone > button');
      return {real:look(real),L:L&&look(L),U:U&&look(U)};},id);
    const res={};
    for(const id of [149,13,43]){
      await hoverLeaf(page,id,600);const v=await take(id);
      assert(v.L&&v.U,'clones for '+id);assert.deepEqual(v.L,v.real,'L equals the real leaf ('+id+')');assert.deepEqual(v.U,v.real,'U equals the real leaf ('+id+')');
      res[id]=v.real;await leave(page,500);
    }
    result.looks=res;
  },{mode,dpr:1});

  // Frame budgets and layers on the occluded cluster at about 20 leaves/s, 1424x820 @2.
  const budget={};
  for(const [label,route] of [['faithful',FAITHFUL],['taste',TASTE]])await check('sweep budgets: '+label+' (occluded cluster, ~20 leaves/s, 1424x820@2)',route,async(page,context,result)=>{
    const cdp=await context.newCDPSession(page);let layers=0,events=0;
    cdp.on('LayerTree.layerTreeDidChange',e=>{events++;if(e.layers)layers=e.layers.length;});
    await cdp.send('LayerTree.enable');
    const layerCount=async()=>{await page.waitForTimeout(700);const seen=events;await cdp.send('LayerTree.disable');await cdp.send('LayerTree.enable');await frame(page);await page.waitForTimeout(300);assert(events>seen,'a fresh layerTreeDidChange');return layers;};
    const ids=[];for(const id of SLIDING){const p=await pointOf(page,id);if(p)ids.push(p);}
    assert(ids.length>=15,'cluster points');
    // the one taste build's light mode adds the cottontail (its own layers, on the ground line): the tree's layers are compared without it, the sweep runs with it
    const walkers=v=>page.evaluate(v=>{for(const e of document.querySelectorAll('.hw-nx-walkers'))if(v)e.style.removeProperty('display');else e.style.setProperty('display','none','important');},v);
    await walkers(false);const restTree=await layerCount();await walkers(true);
    const rest=await layerCount();
    const q=await pointOf(page,149);await page.mouse.move(q[0],q[1]);const raised=await layerCount();await leave(page,600);
    await page.evaluate(()=>{
      const P=window.__p={frames:[],lag:[],pend:[]};let last=0;
      document.addEventListener('pointermove',e=>P.pend.push(e.timeStamp),true);
      const tick=t=>{if(last)P.frames.push(t-last);last=t;for(const s of P.pend)P.lag.push(t-s);P.pend.length=0;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    });
    const start=Date.now();let n=0;
    while(Date.now()-start<6000){const p=ids[(n*7)%ids.length];n++;await page.mouse.move(p[0],p[1]);await page.waitForTimeout(Math.max(0,50-((Date.now()-start)-(n-1)*50)));}
    await leave(page,700);
    const P=await page.evaluate(()=>window.__p),fr=P.frames.slice(5);
    await page.evaluate(()=>{window.__p.frames.length=0;});   // dwell: hover long enough for the raise to finish and the clones to settle, then leave until they are gone
    for(const p of ids.slice(0,8)){await page.mouse.move(p[0],p[1]);await page.waitForTimeout(450);await page.mouse.move(2,2);await page.waitForTimeout(400);}
    const dw=(await page.evaluate(()=>window.__p.frames)).slice(5);
    const r={layersAtRest:rest,layersAtRestWithoutWalkers:restTree,layersRaised:raised,leavesPerSecond:+(n/6).toFixed(1),frames:fr.length,p50:+percentile(fr,.5).toFixed(1),p95:+percentile(fr,.95).toFixed(1),max:+Math.max(...fr).toFixed(1),over50:fr.filter(x=>x>50).length,lagP95Ms:+percentile(P.lag,.95).toFixed(1),lagMaxMs:+Math.max(...P.lag).toFixed(1),lagP95Frames:+(percentile(P.lag,.95)/16.7).toFixed(2),dwellP95:+percentile(dw,.95).toFixed(1),dwellMax:+Math.max(...dw).toFixed(1)};
    Object.assign(result,r);budget[label]=r;report.budgets=budget;
    if(label==='taste'){
      assert(r.p95<25,'frame p95 < 25 ms: '+r.p95);assert.equal(r.over50,0,'no frame over 50 ms: max '+r.max);assert(r.dwellMax<50&&r.dwellP95<25,'dwell frames: p95 '+r.dwellP95+' max '+r.dwellMax);assert(r.lagP95Frames<=2,'input lag <= 2 frames: '+r.lagP95Frames);
      assert.equal(r.layersAtRestWithoutWalkers,budget.faithful?.layersAtRest,'layers at rest equal the faithful page (the dark mode\'s ground walkers counted out)');assert(r.layersRaised<=r.layersAtRest+3,'raised adds at most 3 layers: '+r.layersRaised+' vs '+r.layersAtRest);
    }
  },{width:1424,height:820,dpr:2});

  // Frame sheets for review: faithful above, taste below, at fixed times through the 280 ms.
  if(!process.env.HW_NO_FRAMES&&(!process.env.HW_ONLY||process.env.HW_ONLY.split('|').includes('frames'))){
    await mkdir(framesOut,{recursive:true});
    const times=[0,40,80,112,140,200,280];
    for(const id of [149,13,43])for(const phase of ['raise','release']){
      const shots={};
      for(const [label,route] of [['faithful',FAITHFUL],['taste',TASTE]]){
        const {context,page}=await open(route,{width:1424,height:820,dpr:2});
        try{
          const p=await pointOf(page,id),box=await page.evaluate(id=>{const r=document.querySelector(`button.leaf[data-leaf="${id}"]`).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];},id);
          const clip={x:Math.max(0,box[0]-130),y:Math.max(0,box[1]-130),width:260,height:260};
          if(phase==='release'){await page.mouse.move(p[0],p[1]);await page.waitForTimeout(700);await page.mouse.move(2,2);}
          else await page.mouse.move(p[0],p[1]);
          await page.evaluate(()=>{for(const a of document.getAnimations())a.pause();document.getElementById('leaftag').style.visibility='hidden';});   // the tag would cover the leaf in the sheet
          shots[label]=[];
          for(const t of times){
            await page.evaluate(([t,rel])=>{for(const a of document.getAnimations())a.currentTime=a.playbackRate<0?280-t:t;},[t,phase==='release']);
            await frame(page);shots[label].push(await page.screenshot({clip}));
          }
        }finally{await context.close();}
      }
      const sheet=await browser.newContext({viewport:{width:times.length*270,height:560}}),sp=await sheet.newPage();
      const img=(b,l)=>`<figure style="margin:0"><img style="display:block;width:260px" src="data:image/png;base64,${b.toString('base64')}"><figcaption style="font:12px sans-serif;color:#fff;padding:2px">${l}</figcaption></figure>`;
      await sp.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${times.length},270px);gap:4px 10px">${['faithful','taste'].map(l=>shots[l].map((b,i)=>img(b,l+' '+times[i]+' ms ('+phase+')')).join('')).join('')}</body>`);
      await sp.waitForLoadState('load');await sp.screenshot({path:resolve(framesOut,`leaf-${id}-${phase}.png`),fullPage:true});await sheet.close();
      console.log('FRAMES leaf '+id+' '+phase);
    }
  }
}finally{
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
  if(forced)await forced.close();
  await fx.close();
}
const failed=report.cases.filter(c=>!c.passed);
assertSelectedCases(matched,'HW_ONLY='+String(process.env.HW_ONLY||'(all)'));
console.log(`${report.cases.length-failed.length}/${report.cases.length} cases passed`);
process.exit(failed.length?1:0);
