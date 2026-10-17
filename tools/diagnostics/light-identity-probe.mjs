// Diagnostic: compare the combined taste build under light preference with the faithful reference (verify-taste-dark light case).
// Same page prep as the light case (scroll through, hide walkers, freeze all animations at 4 s, full-page shot), plus a control
// (taste vs taste) and ablations of the walker layers. Serial: HW_BROWSER_SERIAL=1 tools/diagnostics/browser-lock.sh node tools/diagnostics/light-identity-probe.mjs
// HW_VARIANTS=a,b selects variants; HW_LAYERS=1 also dumps CDP LayerTree layers around the diff box. Output: output/playwright/review-taste-dark/light-probe/
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadSharp} from '../sharp-deps.mjs';
const sharp=(...args)=>loadSharp()(...args);   // lazy seam: the optional dependency is demanded only at first use
import {browserFixture,browserToolCLI,waitForCDPEvent} from '../browser-test-lib.mjs';

browserToolCLI({});
const siteRoot=resolve(process.env.HW_SITE_ROOT||new URL('../../publish',import.meta.url).pathname);
const out=resolve(process.env.HW_OUT||new URL('../../output/playwright/review-taste-dark/light-probe',import.meta.url).pathname);await mkdir(out,{recursive:true});
const TASTE=process.env.HW_TASTE_ROUTE||'/optimized/',ROUTE=process.env.HW_ROUTE||'/optimized-taste/';
const hide=css=>async page=>page.addStyleTag({content:css});
const drop=sel=>async page=>page.evaluate(s=>document.querySelectorAll(s).forEach(e=>e.remove()),sel);
const VARIANTS={
  'taste-again':[TASTE,null],                                                   // control: plain taste twice
  'dark-verify':[ROUTE,hide('.hw-nx-walkers{visibility:hidden!important}')],    // exactly what the light case does
  'dark-asis':[ROUTE,null],                                                     // nothing hidden
  'dark-walkers-none':[ROUTE,hide('.hw-nx-walkers{display:none!important}')],
  'dark-walkers-removed':[ROUTE,drop('.hw-nx-walkers')],
  'dark-rabbit-removed':[ROUTE,drop('.hw-nw-rabbit')],
  'dark-raccoon-removed':[ROUTE,drop('.hw-nw-raccoon')],
  'dark-rabbit-anim-none':[ROUTE,hide('.hw-nw-rabbit,.hw-nw-rabbit *{animation:none!important;visibility:hidden!important}')],
};
const pick=process.env.HW_VARIANTS===undefined?Object.keys(VARIANTS):process.env.HW_VARIANTS.split(',').map(v=>v.trim());
if(!pick.length||pick.some(v=>!v||!Object.hasOwn(VARIANTS,v))||new Set(pick).size!==pick.length)throw Error('Empty, duplicate or unknown HW_VARIANTS selection');
const fx=await browserFixture({siteRoot,runTimeoutMs:+(process.env.HW_RUN_TIMEOUT_MS||30*60000)});
const freeze=async(page,t=4000)=>{if(!process.env.HW_OLD_FREEZE)await page.addStyleTag({content:'*,*::before,*::after{animation-play-state:paused!important}'});for(let k=0;k<2;k++){await page.evaluate(t=>{for(const a of document.getAnimations()){a.pause();a.currentTime=t;}},t);await page.waitForTimeout(300);}};
const decode=async buf=>{const {data,info}=await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject:true});return {data,w:info.width,h:info.height};};
async function shot(route,prep,tag){
  const ctx=await fx.browser.newContext({viewport:{width:1365,height:900},deviceScaleFactor:1,colorScheme:'light',bypassCSP:true});
  const page=await ctx.newPage();await page.goto(fx.base+route,{waitUntil:'load'});
  await page.waitForFunction(()=>window.leafLift&&document.querySelectorAll('#net .spore').length>0);await page.waitForTimeout(1500);
  const H=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<H;y+=700){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(60);}await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(500);
  if(prep)await prep(page);
  await freeze(page);await page.waitForTimeout(200);
  const animState=()=>page.evaluate(()=>[...document.querySelectorAll('.bug--beside,.bug--ant.hw-s-1by')].map(b=>({cls:b.className.split(' ').pop(),tr:getComputedStyle(b).translate,
    anims:b.getAnimations().map(a=>({name:a.animationName,state:a.playState,t:a.currentTime,start:a.startTime}))})));
  const before=await animState();
  // record every width the page lays out at during the capture, and the (max-width: 800px) query that hides .bug--beside
  await page.evaluate(()=>{window.__hwW=[innerWidth];const q=matchMedia('(max-width: 800px)');q.addEventListener('change',()=>__hwW.push('mq800:'+q.matches+'@'+innerWidth));
    new ResizeObserver(e=>__hwW.push('ro:'+Math.round(e[0].contentRect.width)+'x'+Math.round(e[0].contentRect.height))).observe(document.documentElement);
    for(const b of document.querySelectorAll('.bug--beside'))b.addEventListener('animationstart',()=>__hwW.push('animationstart@'+innerWidth),{once:true});});
  const img=await decode(await page.screenshot({fullPage:true}));
  const after=await animState();const widths=await page.evaluate(()=>window.__hwW);if(process.env.HW_ANIM)console.log(tag,JSON.stringify({before,after,widths}));
  let layers=null;
  if(process.env.HW_LAYERS){const cdp=await ctx.newCDPSession(page);await cdp.send('DOM.enable');
    // Subscribe before enabling: its initial event may arrive during send. No-feed is a bounded failure.
    const [ev]=await Promise.all([waitForCDPEvent(cdp,'LayerTree.layerTreeDidChange',{timeoutMs:5000}),cdp.send('LayerTree.enable')]);
    layers=[];for(const l of ev.layers||[]){let node=null;if(l.backendNodeId){try{const d=await cdp.send('DOM.describeNode',{backendNodeId:l.backendNodeId});node=d.node.localName+'.'+(d.node.attributes||[]).reduce((a,v,i,arr)=>arr[i-1]==='class'?v:a,'');}catch{}}
      layers.push({id:l.layerId,parent:l.parentLayerId,x:l.offsetX,y:l.offsetY,w:l.width,h:l.height,draws:l.drawsContent,t:l.transform,node});}
    await writeFile(out+'/layers-'+tag+'.json',JSON.stringify(layers,null,1));}
  // per-bug geometry in the soil band (document coordinates), to see sub-pixel offsets directly
  const geo=await page.evaluate(()=>[...document.querySelectorAll('.bug')].map(b=>{const f=b.querySelector('.bug__face');const r=f.getBoundingClientRect();return {cls:b.className,x:+(r.x+scrollX).toFixed(3),y:+(r.y+scrollY).toFixed(3),w:+r.width.toFixed(3),h:+r.height.toFixed(3),tr:getComputedStyle(b).translate};}));
  await ctx.close();return {img,geo,layers};
}
function diff(A,B){let n=0,x0=1e9,y0=1e9,x1=-1,y1=-1,mx=0;if(A.w!==B.w||A.h!==B.h)return {size:[A.w,A.h,B.w,B.h]};
  for(let y=0;y<A.h;y++)for(let x=0;x<A.w;x++){const i=(y*A.w+x)*3,d=Math.max(Math.abs(A.data[i]-B.data[i]),Math.abs(A.data[i+1]-B.data[i+1]),Math.abs(A.data[i+2]-B.data[i+2]));
    if(d>8){n++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);mx=Math.max(mx,d);}}
  return {n,frac:n/(A.w*A.h),box:x1>=0?{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1}:null,maxDelta:mx};}
const crop=async(img,box,n)=>{const pad=30,l=Math.max(0,box.x-pad),t=Math.max(0,box.y-pad),w=Math.min(img.w-l,box.w+2*pad),h=Math.min(img.h-t,box.h+2*pad);
  await sharp(img.data,{raw:{width:img.w,height:img.h,channels:3}}).extract({left:l,top:t,width:w,height:h}).resize({width:w*2,kernel:'nearest'}).png().toFile(out+'/crop2x-'+n+'.png');};
const report={};
try{
  const base=await shot(TASTE,null,'taste');
  for(const v of pick){const [route,prep]=VARIANTS[v];const s=await shot(route,prep,v);const d=diff(base.img,s.img);
    const moved=[];for(const g of s.geo){const b=base.geo.find(x=>x.cls===g.cls);if(b&&(b.x!==g.x||b.y!==g.y||b.w!==g.w))moved.push({cls:g.cls,taste:[b.x,b.y,b.w],other:[g.x,g.y,g.w],tr:[b.tr,g.tr]});}
    const rb=s.geo.find(g=>/hw-nw-rabbit/.test(g.cls));let outside=null;
    if(rb){const p=4,A=base.img,B=s.img;outside=0;for(let y=0;y<A.h;y++)for(let x=0;x<A.w;x++){if(x>=rb.x-p&&x<=rb.x+rb.w+p&&y>=rb.y-p&&y<=rb.y+rb.h+p)continue;const i=(y*A.w+x)*3;
      if(Math.max(Math.abs(A.data[i]-B.data[i]),Math.abs(A.data[i+1]-B.data[i+1]),Math.abs(A.data[i+2]-B.data[i+2]))>8)outside++;}}
    report[v]={route,...d,rabbitBox:rb&&[rb.x,rb.y,rb.w,rb.h],diffOutsideRabbit:outside,movedBugs:moved};console.log(v,JSON.stringify(report[v]).slice(0,1200));
    if(d.box){await crop(base.img,d.box,v+'-taste');await crop(s.img,d.box,v+'-other');}}
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,1));await fx.close();}
