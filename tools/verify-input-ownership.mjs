// Ordinary touch-preview and keyboard/hover ownership acceptance; no fault injection.
// HW_SITE_ROOT, HW_ROUTE (default optimized-taste), HW_OUT; independent guarded browser.
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {extractNetwork,pick} from './taste-network.mjs';
import {treeData} from './taste-tree.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
browserToolCLI({});
const root=resolve(import.meta.dirname,'..'),siteRoot=resolve(process.env.HW_SITE_ROOT||resolve(root,'publish')),route=process.env.HW_ROUTE||'optimized-taste';
const out=resolve(process.env.HW_OUT||resolve(root,'output/playwright/input-ownership'));
if(!/^[a-z0-9-]+$/.test(route))throw Error('Invalid HW_ROUTE');
await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const html=await readFile(resolve(siteRoot,route,'index.html'));
const local=await readFile(resolve(siteRoot,'local/index.html'),'utf8');
const N=extractNetwork(local),D=treeData(local);
const report={generatedAt:new Date().toISOString(),artifactSha256:sha(html),treeSourceSha256:sha(await readFile(resolve(root,'tools/taste-tree.mjs'))),networkSourceSha256:sha(await readFile(resolve(root,'tools/taste-network.mjs'))),siteRoot,route,mode:'ordinary touch, keyboard and pointer actions; no mutations',cases:[]};
const fx=await browserFixture({siteRoot});
const open=async options=>{
  const context=await fx.browser.newContext(options),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fx.base+'/'+route+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>window.leafLift&&document.querySelectorAll('button.leaf[data-leaf]').length>100);
  await page.waitForTimeout(3600);
  return {context,page,errors};
};
try{
  report.browserVersion=fx.browser.version();
  {
    const {context,page,errors}=await open({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,colorScheme:'light'});
    try{
      await page.locator('#net .net__stage').evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
      await page.waitForTimeout(300);
      const bounds=await page.locator('#net .net__stage').boundingBox();
      const candidates=[];
      for(let y=5;y<N.h;y+=3)for(let x=5;x<N.w;x+=3){
        const z=pick(N,x,y);if(z.zone!==3)continue;
        const dist=Math.min(...Array.from({length:N.spores.length/2},(_,i)=>Math.hypot(x-N.spores[2*i],y-N.spores[2*i+1])));
        const cx=bounds.x+x*bounds.width/N.w,cy=bounds.y+y*bounds.height/N.h;
        if(dist>25&&dist<35&&cx>10&&cx<380&&cy>20&&cy<820)candidates.push({x,y,cx,cy,spore:z.spore});
      }
      let target;
      for(const c of candidates){const valid=await page.evaluate(({cx,cy})=>{const e=document.elementFromPoint(cx,cy);return !!e&&!!e.closest('#net .net__stage')&&!e.closest('.spore,[data-open],a,button,input');},c);if(valid){target=c;break;}}
      if(!target)throw Error('No empty, visible zone-3 point found');
      const state=()=>page.evaluate(()=>({snapped:[...document.querySelectorAll('.spore.hw-taste-snap')].map(e=>e.dataset.item),tag:document.querySelector('#leaftag').classList.contains('is-on')?document.querySelector('#leaftag').textContent:'',lit:document.querySelectorAll('.hw-taste-ov > i.on,.hw-taste-ov > i.tip').length,dialogOpen:!document.querySelector('#dialog').hidden,scrollY}));
      await page.touchscreen.tap(target.cx,target.cy);await page.waitForTimeout(400);
      const preview=await state();
      const outside=await page.evaluate(()=>{for(let y=20;y<innerHeight-20;y+=7)for(let x=12;x<innerWidth-12;x+=7){const e=document.elementFromPoint(x,y);if(e&&!e.closest('#net .net__stage,a,button,input,[data-open],#dialog')&&e.closest('section'))return {x,y,tag:e.tagName,section:e.closest('section').id};}return null;});
      if(!outside)throw Error('No outside plain background point visible');
      await page.screenshot({path:resolve(out,'touch-preview.png')});
      await page.touchscreen.tap(outside.x,outside.y);await page.waitForTimeout(400);
      const after=await state();
      await page.screenshot({path:resolve(out,'touch-after-outside.png')});
      const passed=preview.snapped.length===1&&!!preview.tag&&preview.lit>0&&!after.snapped.length&&!after.tag&&!after.lit&&!after.dialogOpen&&errors.length===0;
      report.cases.push({name:'touch preview then outside-stage background tap',passed,failure:passed?null:'A valid preview must clear its snap, label and route after an outside background tap',viewport:{width:390,height:844,dpr:3},target,outside,preview,after,errors});
    }finally{await context.close();}
  }
  {
    const {context,page,errors}=await open({viewport:{width:1424,height:820},colorScheme:'light'});
    try{
      await page.mouse.move(2,2);
      let id=null,tabCount=0;
      for(;tabCount<190;tabCount++){
        await page.keyboard.press('Tab');
        id=await page.evaluate(()=>{const e=document.activeElement;return e.matches('button.leaf[data-leaf]')?+e.dataset.leaf:null;});
        if(id&&D.T[id])break;
      }
      if(!id||!D.T[id])throw Error('No covered leaf reached by keyboard');
      const focusState=()=>page.evaluate(id=>{
        const b=document.querySelector(`button.leaf[data-leaf="${id}"]`);
        const info=e=>({filter:getComputedStyle(e).filter,outline:getComputedStyle(e).outline,opacity:getComputedStyle(e).opacity,wrapperOpacity:Number(getComputedStyle(e.parentElement).opacity),focusVisible:e.matches(':focus-visible')});
        return {id,activeId:document.activeElement.dataset.leaf||null,original:info(b),wrapperOpacity:getComputedStyle(b.parentElement).opacity,clones:[...document.querySelectorAll('.hw-taste-clone > button.leaf')].map(info)};
      },id);
      await page.waitForTimeout(600);const before=await focusState();
      const point=await page.evaluate(id=>{const b=document.querySelector(`button.leaf[data-leaf="${id}"]`),r=b.getBoundingClientRect(),pts=[];for(let y=r.top+1;y<r.bottom;y+=2)for(let x=r.left+1;x<r.right;x+=2){const e=document.elementFromPoint(x,y);if(e&&e.closest('button.leaf')===b)pts.push({x,y});}if(!pts.length)return null;const cx=pts.reduce((n,p)=>n+p.x,0)/pts.length,cy=pts.reduce((n,p)=>n+p.y,0)/pts.length;return pts.sort((p,q)=>Math.hypot(p.x-cx,p.y-cy)-Math.hypot(q.x-cx,q.y-cy))[0];},id);
      if(!point)throw Error('Focused covered leaf has no visible pointer hit');
      await page.screenshot({path:resolve(out,'keyboard-before-hover.png')});
      await page.mouse.move(point.x,point.y);await page.waitForTimeout(600);
      const hovered=await focusState();
      await page.screenshot({path:resolve(out,'keyboard-during-hover.png')});
      await page.mouse.move(2,2);await page.waitForTimeout(600);
      const released=await focusState();
      const painted=hovered.clones.filter(c=>c.wrapperOpacity>.01);
      const visibleRing=hovered.wrapperOpacity==='0'?painted.length>0&&painted.every(c=>c.filter===hovered.original.filter):hovered.original.filter===before.original.filter;
      const passed=before.original.focusVisible&&hovered.activeId===String(id)&&hovered.original.focusVisible&&visibleRing&&released.activeId===String(id)&&released.wrapperOpacity==='1'&&!released.clones.length&&errors.length===0;
      report.cases.push({name:'keyboard-focused occluded leaf then mouse hover',passed,failure:passed?null:'The visible painted leaf must preserve the real keyboard focus ring throughout hover and restore ownership on release',id,tabCount:tabCount+1,point,before,hovered,released,errors});
    }finally{await context.close();}
  }
  report.blocked=fx.blocked;report.passed=report.cases.length===2&&report.cases.every(c=>c.passed);
  if(!report.passed)process.exitCode=1;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{await fx.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
