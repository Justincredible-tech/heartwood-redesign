// Colour and one-route check of the taste Network overlay, judged on every screencast frame (what is actually painted).
// node tools/verify-taste-colour.mjs   (serial browser; needs the taste build and Dark Reader as for verify-taste.mjs)
// Monitored pixels: interior centreline points of every live strip, away from circles and the hub. Every frame each must be its idle colour or its colour when the SITE lights the strip (.is-lit), within TOL levels (default 8); anything else is a wrong colour
// (e.g. untransformed gold under a dark-mode tool). One odd pixel in a frame is the tip's single hard-stop blend pixel and is tolerated and counted. Strips showing lit pixels in a frame must lie on one circle's path.
// Environments HW_ENVS=plain,dark,dr,dr-b120c90s10,dr-b80c110s30,forced (plain Chrome, light; the designed dark mode under prefers-color-scheme: dark; Dark Reader at 3 settings, light scheme, where it acts; Chrome forced dark, where the designed page stands in). Scenarios: slow trace out, trace back, fast trace, back-and-forth on one root, alternating neighbour roots,
// zone 2/3 crossing, zigzag across forks, hub in/out spam, ring sweep. HW_PHASE_S seconds per timed scenario (2). Settled colour: real hover vs ancestors (whole twins) vs tip gold, same pixels.
import {writeFile,mkdir} from 'node:fs/promises';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {readRegularInput} from './tool-operations.mjs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {loadSharp} from './sharp-deps.mjs';
const sharp=(...args)=>loadSharp()(...args);   // lazy seam: the optional dependency is demanded only at first use
browserToolCLI({});
const siteRoot=resolve(process.env.HW_SITE_ROOT||new URL('../publish',import.meta.url).pathname);
const out=resolve(process.env.HW_OUT||new URL('../output/playwright/review-taste-colour',import.meta.url).pathname);
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
const envs=(process.env.HW_ENVS??'plain,dark,dr,dr-b120c90s10,dr-b80c110s30,forced').split(','),variants=['taste'];
const PS=Number(process.env.HW_PHASE_S??2)*1000;
if(!Number.isFinite(PS)||PS<=0)throw Error('HW_PHASE_S must be finite and positive');
for(const env of envs)if(!['plain','dark','forced'].includes(env)&&!/^dr(?:-b\d+c\d+s\d+)?$/.test(env))throw Error('Unknown HW_ENVS entry '+JSON.stringify(env));
const drOpts=e=>{const m=e.match(/^dr(?:-b(\d+)c(\d+)s(\d+))?$/);return m&&{brightness:+(m[1]||100),contrast:+(m[2]||100),sepia:+(m[3]||0)};};
const TOL=Number(process.env.HW_TOL??8);if(!Number.isFinite(TOL)||TOL<0||TOL>8)throw Error('HW_TOL must be finite from0 to8; the original colour ceiling cannot be loosened');
const runtime=ensureToolRuntime({name:'taste colour verification',runTimeoutMs:60*60*1000});await runtime.ready;
await runtime.deadline('prepare colour output',()=>mkdir(out,{recursive:true}),{timeoutMs:5000});
const requireDarkReaderPath=()=>{const value=process.env.HW_DARKREADER;if(!value||!value.trim())throw Error('UNSUPPORTED: Dark Reader is not available; set HW_DARKREADER to a darkreader.js path or set HW_NO_DARKREADER=1 to skip it explicitly (see docs/TESTING.md)');return value.trim();};
const DRPATH=()=>resolve(requireDarkReaderPath()),DR=envs.some(e=>e.startsWith('dr'))?await readRegularInput(DRPATH(),{runtime,syntax:'script'}):'';
const VW=1365,VH=768;
const fx=await browserFixture({siteRoot,runtime,runTimeoutMs:60*60*1000});let forced=null;
const report={viewport:[VW,VH],cases:[]};
const decode=async b64=>(await sharp(Buffer.from(b64,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true}));
const px=(img,x,y)=>{const i=(y*img.info.width+x)*3;return [img.data[i],img.data[i+1],img.data[i+2]];};
const eq=(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2];
// Re-rasterised tiles differ from earlier rasters of the same pixels by 1-2 levels (filter/tile bounds), even on the faithful page,
// so "is the idle colour / is the site-lit colour" allows TOL per channel. Raw vs Dark-Reader gold differ by ~100+ levels.
const near=(a,b)=>Math.abs(a[0]-b[0])<=TOL&&Math.abs(a[1]-b[1])<=TOL&&Math.abs(a[2]-b[2])<=TOL;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
for(const env of envs)for(const variant of variants){
  const b=env==='forced'?(forced||=await fx.launch(['--force-dark-mode','--enable-features=WebContentsForceDark'])):fx.browser;
  const context=await b.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:1,bypassCSP:true,colorScheme:env==='dark'||env==='forced'?'dark':'light'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
  const o=drOpts(env);if(o)await page.addInitScript({content:DR+`;document.addEventListener("DOMContentLoaded",()=>DarkReader.enable(${JSON.stringify(o)}));`});
  await page.goto(fx.base+'/optimized-taste/',{waitUntil:'load'});
  await page.waitForFunction(()=>window.leafLift&&document.querySelectorAll('#net .spore').length>0);await page.waitForTimeout(3500);
  // the tag and everything animating elsewhere are not part of this check; a 1px corner element lets us force fresh frames
  await page.addStyleTag({content:'.leaftag{display:none!important}*:not(.spore),*::before,*::after{animation-play-state:paused!important}#hw-tick{position:fixed;left:0;top:0;width:1px;height:1px;z-index:99;background:#010101}#hw-tick.b{background:#020202}'});
  await page.evaluate(()=>{const t=document.createElement('div');t.id='hw-tick';document.body.append(t);document.querySelector('#net .net__stage').scrollIntoView({block:'center',behavior:'instant'});});await page.waitForTimeout(500);
  if(o&&!await page.evaluate(()=>document.querySelectorAll('style.darkreader').length>0))throw Error('Dark Reader inactive');
  const G=await page.evaluate(()=>{
    const stage=document.querySelector('#net .net__stage'),hy=stage.querySelector('.net__hyphae');
    const spores=[...stage.querySelectorAll('.spore')].map(s=>{const r=s.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,s.dataset.path];});
    const hub=stage.querySelector('.net__hub').getBoundingClientRect();
    const strips=[...hy.children].map(el=>{const r=el.getBoundingClientRect(),poly=getComputedStyle(el).clipPath.match(/polygon\((.*)\)/);if(!poly)return null;
      const P=poly[1].split(',').map(s=>s.trim().split(/\s+/).map(parseFloat)).map(([x,y])=>[r.left+r.width*x/100,r.top+r.height*y/100]);
      return {id:el.id,c:[0,1,2,3,4,5,6].map(i=>[(P[i][0]+P[13-i][0])/2,(P[i][1]+P[13-i][1])/2])};}).filter(Boolean);
    return {spores,hub:{cx:hub.left+hub.width/2,cy:hub.top+hub.height/2,r:hub.width/2},strips};});
  const paths=G.spores.map(s=>new Set(s[2].split(' ').map(k=>'hy-'+k))),live=new Set(paths.flatMap(p=>[...p]));
  const mon=[];for(const s of G.strips){if(!live.has(s.id))continue;for(const k of [2,3,4]){const [x,y]=s.c[k].map(Math.round);
    if(x<2||y<2||x>VW-3||y>VH-3)continue;if(G.spores.some(([sx,sy])=>Math.hypot(sx-x,sy-y)<28))continue;if(Math.hypot(G.hub.cx-x,G.hub.cy-y)<G.hub.r+8)continue;mon.push({id:s.id,k,x,y});}}
  const cdp=await context.newCDPSession(page);let frames=[],rec=false;
  cdp.on('Page.screencastFrame',f=>{if(rec)frames.push({t:performance.now(),data:f.data});cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});});
  await cdp.send('Page.startScreencast',{format:'png',everyNthFrame:1,maxWidth:VW,maxHeight:VH});
  const still=async()=>{await page.waitForTimeout(450);frames=[];rec=true;const t0=performance.now();while(frames.length<2&&performance.now()-t0<3000){await page.evaluate(()=>document.getElementById('hw-tick').classList.toggle('b'));await page.waitForTimeout(50);}rec=false;if(frames.length)return decode(frames.at(-1).data);return decode((await cdp.send('Page.captureScreenshot',{format:'png'})).data);};   // fallback when the screencast stalls
  await page.mouse.move(1,1);
  const idle=await still();
  await page.evaluate(ids=>{for(const id of ids)document.getElementById(id).classList.add('is-lit');},[...live]);
  const allLit=await still();
  await page.evaluate(()=>{for(const e of document.querySelectorAll('#net .net__hyphae:not(.hw-taste-ov) > i.is-lit'))e.classList.remove('is-lit');});
  const M=mon.filter(m=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(eq(px(idle,m.x+dx,m.y+dy),px(allLit,m.x+dx,m.y+dy)))return false;return true;});
  const refIdle=M.map(m=>px(idle,m.x,m.y)),refLit=M.map(m=>px(allLit,m.x,m.y));
  const judge=img=>{let bad=0;const litIds=new Set(),ex=[];M.forEach((m,i)=>{const p=px(img,m.x,m.y);if(near(p,refLit[i]))litIds.add(m.id);else if(!near(p,refIdle[i])){bad++;if(ex.length<3)ex.push({id:m.id,k:m.k,got:p,siteLit:refLit[i],idle:refIdle[i]});}});
    const oneRoute=!litIds.size||paths.some(p=>[...litIds].every(id=>p.has(id)));return {bad,lit:litIds.size,oneRoute,litIds:[...litIds],ex};};
  // the route to trace: longest path whose strips all have monitored pixels
  const byLen=G.spores.map((s,i)=>[i,s[2].split(' ').length]).sort((a,b)=>b[1]-a[1]);
  const [ri]=byLen.find(([i])=>G.spores[i][2].split(' ').every(k=>M.some(m=>m.id==='hy-'+k)))||byLen[0];
  const route=G.spores[ri][2].split(' ').map(k=>'hy-'+k),rs=route.map(id=>G.strips.find(s=>s.id===id));
  const along=(s,f)=>{const seg=Math.min(5,Math.floor(f*6)),u=f*6-seg;return [s.c[seg][0]+u*(s.c[seg+1][0]-s.c[seg][0]),s.c[seg][1]+u*(s.c[seg+1][1]-s.c[seg][1])];};
  const routePts=[];for(const s of rs)for(const f of [.1,.3,.5,.7,.9])routePts.push(along(s,f));
  const [sx,sy]=G.spores[ri],{cx,cy}=G.hub,sr=Math.hypot(sx-cx,sy-cy),snapPt=[sx+30*(sx-cx)/sr,sy+30*(sy-cy)/sr];
  // a neighbouring root: the spore whose first strip differs and whose direction is closest
  const ang=([x,y])=>Math.atan2(y-cy,x-cx),a0=ang([sx,sy]);
  const nb=G.spores.map((s,i)=>[i,Math.abs(((ang(s)-a0+3*Math.PI)%(2*Math.PI))-Math.PI)]).filter(([i])=>G.spores[i][2].split(' ')[0]!==G.spores[ri][2].split(' ')[0]).sort((a,b)=>a[1]-b[1])[0][0];
  const nbS=G.strips.find(s=>s.id==='hy-'+G.spores[nb][2].split(' ')[0]),nbPt=along(nbS,.6),myPt=along(rs[0],.6);
  const stateOf=()=>page.evaluate(r=>r.map(id=>{const e=document.getElementById(id),c=document.querySelector(`.hw-taste-ov > i[data-of="${id}"]`);
    return e.classList.contains('is-lit')?'site':c&&c.classList.contains('tip')?'tip':c&&c.classList.contains('on')?'anc':'-';}),route);
  // (a) the site's own lit path: real hover on the route's spore
  await page.mouse.move(sx,sy,{steps:3});const realHover=await still();
  await page.mouse.move(1,1,{steps:2});await page.waitForTimeout(250);
  // (b)/(c) settled samples while tracing outward slowly, segment by segment
  const anc=[],tip=[],stepLog=[];
  for(let q=0;q<rs.length;q++)for(const f of [.3,.6,.9]){
    const [x,y]=along(rs[q],f);await page.mouse.move(x,y,{steps:2});const img=await still(),st=await stateOf();stepLog.push(rs[q].id+'@'+f+':'+st.join(' '));
    M.forEach((m,i)=>{const r=route.indexOf(m.id);if(r<0)return;const s={id:m.id,k:m.k,got:px(img,m.x,m.y),site:refLit[i],hover:px(realHover,m.x,m.y)};   // site = the base strip with the site's own .is-lit
      if(st[r]==='anc')anc.push(s);else if(st[r]==='tip'&&m.k/6<f-.15)tip.push(s);});
  }
  const cmp=l=>({n:l.length,identicalToSiteLit:l.filter(s=>eq(s.got,s.site)).length,withinTol:l.filter(s=>near(s.got,s.site)).length,realHoverWithinTolOfSite:l.filter(s=>near(s.hover,s.site)).length,maxChannelDiff:Math.max(0,...l.map(s=>Math.max(...s.got.map((v,c)=>Math.abs(v-s.site[c]))))),example:l.find(s=>!eq(s.got,s.site))||l[0]||null});
  // timed phases, every frame judged
  const phase=async(name,drive)=>{await page.mouse.move(1,1);await page.waitForTimeout(250);frames=[];rec=true;const t0=performance.now();await drive(t0);await page.waitForTimeout(120);rec=false;const list=frames;frames=[];
    let badF=0,badPx=0,multi=0,litF=0,blend=0;const ex=[];for(const f of list){const j=judge(await decode(f.data));if(j.lit)litF++;if(j.bad===1)blend++;else if(j.bad){badF++;badPx+=j.bad;if(ex.length<2)ex.push(j.ex[0]);}   /* one odd pixel in a frame = the tip's single hard-stop blend pixel (gold meets the idle strip on one pixel); two or more is a wrong colour */if(!j.oneRoute){multi++;if(ex.length<4)ex.push({multiRoute:j.litIds.slice(0,8)});}}
    return {name,frames:list.length,framesWithLit:litF,framesWrongColour:badF,wrongPixels:badPx,tipBlendOnlyFrames:blend,framesMultiRoute:multi,examples:ex};};
  const until=(t0,ms)=>performance.now()-t0<ms;
  const phases=[];
  phases.push(await phase('trace-out-slow',async()=>{for(const p of routePts){await page.mouse.move(...p,{steps:3});await sleep(60);}await page.mouse.move(...snapPt,{steps:4});await sleep(200);}));
  phases.push(await phase('trace-back-in',async()=>{await page.mouse.move(...snapPt,{steps:2});await sleep(250);for(const p of [...routePts].reverse()){await page.mouse.move(...p,{steps:3});await sleep(60);}await page.mouse.move(cx,cy,{steps:4});await sleep(200);await page.mouse.move(1,1,{steps:4});}));
  phases.push(await phase('trace-out-fast',async t0=>{while(until(t0,PS)){for(const p of routePts)await page.mouse.move(...p);await page.mouse.move(...snapPt);}}));
  phases.push(await phase('back-and-forth-one-root',async t0=>{while(until(t0,PS)){const t=(performance.now()-t0)/1000,u=.5+.5*Math.sin(t*14),i=Math.min(routePts.length-1,Math.floor(u*routePts.length));await page.mouse.move(...routePts[i]);await sleep(4);}}));
  phases.push(await phase('alternate-neighbour-roots',async t0=>{let k=0;while(until(t0,PS)){await page.mouse.move(...(k++%2?nbPt:myPt));await sleep(4);}}));
  phases.push(await phase('cross-zone2-zone3-boundary',async t0=>{const last=routePts.at(-1);while(until(t0,PS)){const t=(performance.now()-t0)/1000,u=.5+.5*Math.sin(t*16);await page.mouse.move(last[0]+u*(snapPt[0]-last[0]),last[1]+u*(snapPt[1]-last[1]));await sleep(4);}}));
  phases.push(await phase('zigzag-forks',async t0=>{while(until(t0,PS)){const t=(performance.now()-t0)/1000,a=a0+.6*Math.sin(t*12),r=G.hub.r+40+50*(.5+.5*Math.sin(t*5));await page.mouse.move(cx+r*Math.cos(a),cy+r*Math.sin(a));await sleep(4);}}));
  phases.push(await phase('hub-in-out-spam',async t0=>{while(until(t0,PS)){const t=(performance.now()-t0)/1000,r=G.hub.r*(.6+.8*(.5+.5*Math.sin(t*18)));await page.mouse.move(cx+r*Math.cos(a0),cy+r*Math.sin(a0));await sleep(4);}}));
  phases.push(await phase('ring-sweep-root-switching',async t0=>{while(until(t0,PS)){const t=(performance.now()-t0)/1000,a=t*Math.PI*2*1.4,r=G.hub.r+30+60*(.5+.5*Math.sin(t*11));await page.mouse.move(cx+r*Math.cos(a),cy+r*Math.sin(a));await sleep(4);}}));
  await cdp.send('Page.stopScreencast');
  await page.mouse.move(1,1,{steps:3});await page.waitForTimeout(500);   // the pointer leaves the stage: nothing may stay lit (no tip cut on the container); the overlay stays promoted only while the Network is on screen
  let endState=await page.evaluate(()=>document.querySelectorAll('#net .net__hyphae:not(.hw-taste-ov) > i.is-lit, .hw-taste-ov > i.on, .hw-taste-ov > i.tip, .hw-taste-ov[style*="--hw-a"], .hw-taste-ov[style*="--hw-stop"]').length);
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(500);   // the Network off-screen: nothing promoted, no container style at all
  endState+=await page.evaluate(()=>document.querySelectorAll('.hw-taste-ov[style], .hw-taste-ov.hw-taste-wc').length);
  const row={env,variant,monitoredPixels:M.length,route:route.join(' '),ancestorsVsSiteLit:cmp(anc),tipGoldVsSiteLit:cmp(tip),phases,endStateLitElements:endState,
    computed:await page.evaluate(()=>{const e=document.createElement('i');document.querySelector('#net .net__hyphae:not(.hw-taste-ov)').append(e);e.className='is-lit';const a=getComputedStyle(e).backgroundColor;e.remove();return {siteIsLit:a,twin:getComputedStyle(document.querySelector('.hw-taste-ov > i')).backgroundColor};}),
    traceSteps:stepLog,errors};
  report.cases.push(row);
  console.log(JSON.stringify({env,variant,mon:M.length,anc:[row.ancestorsVsSiteLit.n,row.ancestorsVsSiteLit.identicalToSiteLit,row.ancestorsVsSiteLit.maxChannelDiff],tip:[row.tipGoldVsSiteLit.n,row.tipGoldVsSiteLit.identicalToSiteLit,row.tipGoldVsSiteLit.maxChannelDiff],computed:row.computed,phases:phases.map(p=>[p.name,p.frames,p.framesWithLit,p.framesWrongColour,p.framesMultiRoute].join(':')),end:endState,err:errors.length}));
  await writeFile(resolve(out,`${env}-${variant}-realhover.png`),await sharp(realHover.data,{raw:{width:VW,height:VH,channels:3}}).png().toBuffer());
  }catch(e){console.error('ERROR',env,variant,e.stack);report.cases.push({env,variant,error:e.message});}
  finally{await context.close();}
}
}finally{if(forced)await forced.close();await fx.close();}
// Verdict: every frame of every scenario, in every environment.
const fails=[];
for(const c of report.cases){
  if(c.error){fails.push(c.env+': '+c.error);continue;}
  const a=c.ancestorsVsSiteLit,t=c.tipGoldVsSiteLit;
  if(c.computed.siteIsLit!==c.computed.twin)fails.push(c.env+': the twin\'s colour differs from the site\'s own .is-lit: '+JSON.stringify(c.computed));
  if(a.withinTol!==a.n||t.withinTol!==t.n||!a.n||!t.n)fails.push(c.env+': settled gold differs from the site\'s own lit strip beyond +-'+TOL+': ancestors '+a.withinTol+'/'+a.n+', tip '+t.withinTol+'/'+t.n);
  if(c.endStateLitElements)fails.push(c.env+': '+c.endStateLitElements+' lit/promoted elements left after the walk');
  for(const p of c.phases){
    if(p.framesWrongColour)fails.push(c.env+' '+p.name+': '+p.framesWrongColour+' frames with a wrong-coloured pixel '+JSON.stringify(p.examples[0]));
    if(p.framesMultiRoute)fails.push(c.env+' '+p.name+': '+p.framesMultiRoute+' frames with lit strips on more than one route');
    if(!p.framesWithLit)fails.push(c.env+' '+p.name+': never lit (the scenario did not exercise anything)');
  }
}
report.passed=!fails.length&&report.cases.length>0;report.failures=fails;
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,environments:report.cases.length,failures:fails.slice(0,8),report:resolve(out,'report.json')}));
process.exit(report.passed?0:1);
