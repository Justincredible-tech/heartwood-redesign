// PRIVATE audit tool. Short functional journeys; no performance or physical-device claim.
// Install beside .audit/tools/browser-test-lib.mjs, or pass --private-tools .audit/tools.
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {functionalVerdict} from './public-functional-report.mjs';

const {values}=parseArgs({options:{site:{type:'string'},out:{type:'string'},'private-tools':{type:'string'},help:{type:'boolean'}}});
if(values.help){console.log('PRIVATE: node verify-public-functional.mjs --site PUBLISH_DIR [--out REPORT_DIR] [--private-tools .audit/tools]\nOwned loopback Chrome only; 180s overall, 8s per outside step, 8s cleanup. No physical/performance claim.');process.exit(0);}
for(const k of ['site','out','private-tools'])if(values[k]!==undefined&&!values[k].trim())throw Error('--'+k+' must not be empty');
if(process.env.HW_OUT!==undefined&&!process.env.HW_OUT.trim())throw Error('HW_OUT must not be empty');
if(!values.site)throw Error('--site must name the complete staged public artifact');
const tools=resolve(values['private-tools']||import.meta.dirname),site=resolve(values.site),out=resolve(values.out||process.env.HW_OUT||join(tools,'../output/public-functional',Date.now()+'-'+randomUUID()));
assert.ok(out!==site&&!out.startsWith(site+'/'),'Private report output must stay outside the public artifact');
if(process.env.HW_FORBID_BROWSER_ALLOCATION==='1')throw Error('HW_FORBID_BROWSER_ALLOCATION: real browser run forbidden by early-CLI test');
const {ensureToolRuntime,deadline}=await import(pathToFileURL(join(tools,'tool-runtime.mjs')));
const {browserFixture}=await import(pathToFileURL(join(tools,'browser-test-lib.mjs')));
const {readRegularInput}=await import(pathToFileURL(join(tools,'tool-operations.mjs')));
const runtime=ensureToolRuntime({name:'public functional verification',runTimeoutMs:180000,stepTimeoutMs:8000,shutdownMs:8000});await runtime.ready;
const expected=['desktop day','desktop OS-dark night','direct taste default night','explicit taste day','desktop reduced motion','desktop mode navigation','taste navigation and finder','phone auto day','phone auto night','phone direct taste auto day','phone explicit night','phone explicit night reduced motion','phone hero day','phone hero night','phone journey','phone 200% text'];
const report={passed:false,started:new Date().toISOString(),site,scope:'Owned Chromium functional journeys on host; not physical phone or performance acceptance',checks:[],failures:[],inputs:{},requests:{}};
const sha=b=>createHash('sha256').update(b).digest('hex');
let fx,cleanup,dayLook;
await runtime.deadline('create private functional output',()=>mkdir(out,{recursive:true}));
report.harnessSha256=sha(await readRegularInput(fileURLToPath(import.meta.url),{runtime,maxBytes:128*1024,encoding:null,timeoutMs:8000}));
await runtime.deadline('write incomplete functional receipt',()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n'));
const pinned=['index.html','desktop-day.html','taste/index.html','taste/scene.html','mobile/day.html','mobile/night.html','mobile/manifest.json'];
const phoneOptions={viewport:{width:375,height:812},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'};
async function settle(page){await page.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));}
function exactURL(page,path,hash='',search){const u=new URL(page.url());assert.equal(u.origin,fx.base);assert.equal(u.pathname,path);assert.equal(u.hash,hash);if(search!==undefined)assert.equal(u.search,search);return u;}
async function ready(page,phone){await page.waitForFunction(phone?()=>document.documentElement.classList.contains('js')&&document.querySelector('.climb .tier__art')&&document.querySelector('#hw-records')&&document.querySelector('#sheet'):()=>document.querySelector('.stage .tree')&&document.querySelectorAll('button.leaf[data-leaf]').length>0,null,{timeout:8000});await settle(page);if(!phone)await page.waitForFunction(()=>!document.querySelector('.stage').getAnimations({subtree:true}).some(a=>a.animationName==='leaf-out'&&a.playState!=='finished'),null,{timeout:8000});}
async function metadata(page,ctx){
  const result=await page.evaluate(()=>({fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replaceAll('"','')),icons:[...document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')].map(x=>({href:x.href,rel:x.rel,type:x.type,sizes:x.getAttribute('sizes')})),links:document.querySelectorAll('a[href]').length,art:[...document.querySelectorAll('picture img')].map(i=>i.currentSrc).filter(Boolean)}));
  for(const family of ['Young Serif','Instrument Sans'])assert.ok(result.fonts.includes(family),'actual upstream font not loaded: '+family);
  assert.equal(result.icons.length,3);
  for(const icon of result.icons){
    const url=new URL(icon.href);assert.equal(url.origin,fx.base);assert.ok(url.pathname.includes('/assets/'));
    const response=await runtime.deadline('GET actual icon '+url.pathname,()=>ctx.request.get(url.href,{timeout:4000,maxRedirects:0}));
    try{
      assert.equal(response.status(),200,'icon GET did not succeed');
      const bytes=await runtime.deadline('read actual icon body',()=>response.body()),type=response.headers()['content-type']?.split(';')[0];
      assert.ok(bytes.length>0,'empty icon body');const digest=sha(bytes);assert.ok(url.pathname.includes(digest.slice(0,12)),'icon filename does not identify fetched bytes');
      if(type==='image/png'){assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const size=icon.rel==='apple-touch-icon'?180:32;assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);icon.dimensions=[size,size];}
      else{assert.equal(type,'image/svg+xml');assert.match(bytes.toString('utf8'),/<svg(?:\s|>)/);}
      Object.assign(icon,{status:response.status(),type,bytes:bytes.length,sha256:digest});
    }finally{await runtime.deadline('dispose actual icon response',()=>response.dispose(),{timeoutMs:3000,cleanup:true});}
  }
  assert.ok(result.links>0,'no real navigation links');
  if(new URL(page.url()).pathname.startsWith('/mobile/')){const night=new URL(page.url()).pathname.endsWith('/night.html'),pieces=result.art.map(u=>decodeURIComponent(new URL(u).pathname.split('/').at(-1))).filter(n=>/^(?:tree|tier-l|tier-r|trunk|roots|ground|ridges)(?:-night)?@/.test(n));assert.ok(pieces.length>0,'phone composition art selection not observed');assert.ok(pieces.every(n=>n.includes('-night@')===night),'phone selected opposite-mode art');}
  return result;
}
async function desktopAnimals(page,night){
  const trim=await page.locator('.stage .cut > i.trim').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return {image:s.backgroundImage,color:s.backgroundColor};}));
  assert.ok(trim.length>0,'Actual mycelium clipping wrapper required');
  assert.ok(trim.every(s=>s.image==='none'&&s.color==='rgba(0, 0, 0, 0)'),'Authored clipping wrapper paints an opaque sheet over the scene');
  const result=await page.evaluate(()=>{
    const visible=el=>getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0;
    const families=Object.fromEntries(['barred','screech','moth','bat'].map(n=>[n,[...document.querySelectorAll('.hw-n-'+n+' .hw-nface')].filter(visible).length]));
    const dayFaces=[...document.querySelectorAll('.bird__face:not(.hw-nface)')].filter(visible).length;
    const carriers=[...document.querySelectorAll('.stage .bee__face')].map(el=>{const face=getComputedStyle(el),after=getComputedStyle(el,'::after');return {width:el.getBoundingClientRect().width,display:face.display,animation:face.animationName,haloContent:after.content,haloDisplay:after.display,haloAnimation:after.animationName};});
    const bees=carriers.filter(b=>b.width>0&&b.display!=='none');
    return {families,dayFaces,carrierCount:carriers.length,bees};
  });
  assert.equal(result.bees.length,night?9:4,'current author meadow: four displayed day bees; taste night adds five firefly carriers');
  if(night){assert.deepEqual(result.families,{barred:2,screech:1,moth:5,bat:1},'all nine designed night faces display in their intended families');assert.equal(result.dayFaces,0,'day birds display at night');assert.ok(result.bees.every(b=>b.animation==='hw-ff-lift'&&b.haloContent!=='none'&&b.haloDisplay!=='none'&&b.haloAnimation.includes('hw-ff')),'night firefly geometry/halo not active');}
  else{assert.equal(result.dayFaces,9);assert.ok(Object.values(result.families).every(n=>n===0));assert.ok(result.bees.every(b=>!b.animation.includes('hw-ff')&&(b.haloDisplay==='none'||b.haloContent==='none')),'night firefly styles leak into day');}
  return {...result,trim};
}
async function session(name,options,fn){let ctx,pass=false,detail={};const errors=[],requests=[];runtime.step(name,'positive functional journey');try{ctx=await fx.browser.newContext(options);const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push('console.error: '+m.text());});page.on('request',r=>requests.push({url:r.url(),type:r.resourceType()}));page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});detail=await fn(page,ctx,requests)||{};detail.metadata=await metadata(page,ctx);if(!new URL(page.url()).pathname.startsWith('/mobile/'))detail.animals=await desktopAnimals(page,detail.look?.theme==='night');assert.deepEqual(errors,[],'page/network/console errors');detail.screenshot=name.replaceAll(' ','-')+'.png';await runtime.deadline('capture verified '+name,()=>page.screenshot({path:join(out,detail.screenshot),timeout:6000}));pass=true;}catch(e){report.failures.push(name+': '+e.message);detail={...detail,error:e.message};}finally{if(ctx)try{await ctx.close();}catch(e){pass=false;report.failures.push(name+' cleanup: '+e.message);}report.requests[name]=requests;report.checks.push({name,pass,...detail,errors});console.log((pass?'PASS ':'FAIL ')+name+(detail.error?' '+detail.error.split('\n')[0]:''));}}
async function reducedMotion(page){
  const detail=await desktop(page,'/','light',false);
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true,'reduced-motion context was not applied');
  const running=await page.evaluate(()=>document.querySelector('.stage').getAnimations({subtree:true}).filter(a=>a.playState==='running').length);assert.equal(running,0,'stage animations run under reduced motion');
  const point=await page.evaluate(()=>{for(const leaf of document.querySelectorAll('.stage button.leaf[data-leaf]')){const b=leaf.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;if(x<=0||x>=innerWidth||y<=0||y>=innerHeight)continue;const hit=document.elementFromPoint(x,y)?.closest('button.leaf[data-leaf]');if(hit)return {x,y,id:hit.dataset.leaf};}return null;});assert.ok(point,'no actual clickable leaf point');
  await page.mouse.move(point.x,point.y);await page.waitForFunction(id=>document.querySelector('button.leaf[data-leaf="'+id+'"]').matches(':hover'),point.id,{timeout:4000});
  await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>{const d=document.querySelector('#dialog'),t=document.querySelector('#dialog-title');return d&&!d.hidden&&t&&t.textContent.trim()&&t.textContent.trim()!=='Leaf'&&d.contains(document.activeElement);},null,{timeout:4000});
  detail.reducedMotion={running,point,title:await page.locator('#dialog-title').textContent()};
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#dialog').hidden&&!document.querySelector('main').inert,null,{timeout:4000});
  return detail;
}
async function desktop(page,path,scheme,night){await page.goto(fx.base+path,{waitUntil:'load'});await ready(page,false);const url=exactURL(page,night?'/taste/':path.split('?')[0]);const look=await page.evaluate(()=>{const vis=el=>getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0;const roots=getComputedStyle(document.documentElement);return {theme:document.documentElement.dataset.hwTheme,experience:document.documentElement.dataset.hwExperience||'',sky:roots.getPropertyValue('--sky-left').trim(),body:getComputedStyle(document.body).backgroundColor,nightFaces:[...document.querySelectorAll('.hw-nface')].filter(vis).length,dayFaces:[...document.querySelectorAll('.bird__face:not(.hw-nface)')].filter(vis).length,modeText:document.querySelector('[data-hw-mode]')?.textContent.trim(),logo:document.querySelector('.brand__logo use')?.getAttribute('href')};});assert.equal(look.theme,night?'night':'day');assert.ok(look.logo,'upstream vector logo use');assert.equal(look.modeText,night?'Day':'Night');assert.ok(look.sky,'nonempty scene sky token');if(night){assert.ok(look.nightFaces>0,'night animal faces exist and display');assert.notEqual(look.sky,dayLook.sky,'night palette differs from faithful day');}else{assert.equal(look.nightFaces,0,'no displayed night animal faces');assert.ok(look.dayFaces>0,'day bird faces display');if(dayLook){assert.equal(look.sky,dayLook.sky);assert.equal(look.body,dayLook.body);}else dayLook=look;}return {url:url.href,scheme,look};}
async function phoneArrival(page,path,night,requests){await page.goto(fx.base+path,{waitUntil:'load'});await ready(page,true);const url=exactURL(page,'/mobile/'+(night?'night':'day')+'.html','#leaf-donate');assert.equal(url.searchParams.get('open'),'work');const detail=await page.evaluate(()=>{const d=JSON.parse(document.querySelector('#hw-records').textContent),sky=document.querySelector('.sky .sky__img, .sky > picture img, .hero picture img'),pics=[...document.querySelectorAll('picture img')];return {theme:document.documentElement.dataset.hwTheme,records:d.records.length,title:document.querySelector('#sheet-title')?.textContent,expected:d.records.find(r=>r.id==='donate')?.title,open:document.querySelector('details[data-cat="work"]')?.open,images:pics.map(i=>({cls:i.className,src:i.currentSrc,complete:i.complete,width:i.naturalWidth})),font:document.fonts.check('16px "Instrument Sans"'),icons:[...document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')].map(x=>x.getAttribute('href'))};});assert.equal(detail.theme,night?'night':'day');assert.ok(detail.records>0);assert.equal(detail.title,detail.expected);assert.equal(detail.open,true);assert.equal(detail.font,true);assert.equal(detail.icons.length,3);assert.ok(detail.images.some(i=>i.src&&i.complete&&i.width>0),'decoded phone artwork');const assets=requests.filter(r=>new URL(r.url).pathname.includes('/assets/'));assert.ok(assets.length>0,'phone assets actually requested');assert.ok(assets.every(r=>new URL(r.url).pathname.startsWith('/mobile/assets/')),'automatic phone route fetched desktop assets');assert.ok(!requests.some(r=>['script','stylesheet'].includes(r.type)&&!new URL(r.url).pathname.startsWith('/mobile/')),'automatic phone route fetched desktop CSS/JS');return {url:url.href,detail};}
async function modeNavigation(page){
 await desktop(page,'/','light',false);
 await page.locator('[data-hw-mode]').click();await ready(page,false);
 exactURL(page,'/taste/');assert.equal(new URL(page.url()).searchParams.get('theme'),'dark');assert.equal(await page.evaluate(()=>document.documentElement.dataset.hwTheme),'night');
 const night=await desktopAnimals(page,true);
 await page.locator('[data-hw-mode]').click();await ready(page,false);
 exactURL(page,'/taste/');assert.equal(new URL(page.url()).searchParams.get('theme'),'light');assert.equal(await page.evaluate(()=>document.documentElement.dataset.hwTheme),'day');
 const day=await desktopAnimals(page,false);
 return {night,day,look:{theme:'day'}};
}
async function phoneHero(page,night,requests){
 await page.goto(fx.base+'/mobile/'+(night?'night':'day')+'.html',{waitUntil:'load'});await ready(page,true);
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.hwTheme),night?'night':'day');
 const treeRequests=requests.filter(r=>r.type==='image'&&/^\/mobile\/assets\/tree(?:-night)?@[23]x\./.test(new URL(r.url).pathname));assert.equal(treeRequests.length,1,'Exactly the selected tree asset must be requested');
 const image=await page.evaluate(src=>new Promise((yes,no)=>{const i=new Image();i.onload=()=>yes({src:i.currentSrc,complete:i.complete,width:i.naturalWidth});i.onerror=()=>no(Error('Selected tree failed decode'));i.src=src;}),treeRequests[0].url);
 assert.ok(image.complete&&image.width>0,'Hero tree must decode');assert.equal(image.src.includes('tree-night@'),night);
 const tags=await page.locator('.tree .tag').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};}));
 assert.ok(tags.length>=6);assert.ok(tags.every(t=>t.width>=44&&t.height>=44&&t.left>=0&&t.right<=375),'Hero tags must fit and remain tap-sized');
 return {image,tags};
}
async function finderJourney(page){
 const progress=label=>{runtime.step('finder '+label,'positive condition');console.log('[finder] '+label);};
 const detail=await desktop(page,'/taste/','light',true);
 progress('topic filter');
 await page.locator('#key-chips [data-filter="work"]').click();
 await page.waitForFunction(()=>document.querySelector('.tree').classList.contains('is-filtered')&&document.querySelectorAll('.tree .leaf.is-lit[data-kind="work"]').length>0,null,{timeout:4000});
 await page.locator('#key-chips [data-filter="all"]').click();
 await page.waitForFunction(()=>!document.querySelector('.tree').classList.contains('is-filtered'),null,{timeout:4000});
 const group=await page.locator('#groups button[data-open]').first().textContent();assert.ok(group?.trim());
 progress('Network navigation');
 await page.locator('.nav a[href="#network"]').click();
 await page.waitForFunction(()=>location.hash==='#network'&&document.querySelector('#network').getBoundingClientRect().top<innerHeight,null,{timeout:4000});
 await page.locator('#group-find').fill(group.trim());
 progress('member filter');
 await page.waitForFunction(()=>document.querySelector('#net-list').open&&document.querySelectorAll('#groups li:not([hidden])').length>0&&document.querySelectorAll('#groups li[hidden]').length>0,null,{timeout:4000});
 const matching=page.locator('#groups li:not([hidden]) button');assert.ok(await matching.count()>0);
 progress('member dialog');
 await matching.first().click();await page.waitForFunction(()=>!document.querySelector('#dialog').hidden&&document.querySelector('#dialog').contains(document.activeElement),null,{timeout:4000});
 const title=await page.locator('#dialog-title').textContent();assert.equal(title?.trim(),group.trim());
 progress('Escape closes');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#dialog').hidden&&!document.querySelector('main').inert,null,{timeout:4000});
 await page.locator('#group-find').fill('');await page.waitForFunction(()=>document.querySelectorAll('#groups li[hidden]').length===0,null,{timeout:4000});
 progress('local cover decode');
 await page.locator('#news-issue img').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const i=document.querySelector('#news-issue img');return i.complete&&i.naturalWidth===720&&new URL(i.currentSrc).pathname.startsWith('/mobile/assets/cover-720.');},null,{timeout:4000});
 progress('back to top');
 await page.locator('.brand[href="#top"]').first().click();await page.waitForFunction(()=>scrollY<100,null,{timeout:4000});
 return {...detail,finder:{group,title,allRestored:true}};
}
async function sheetState(page,id){await page.waitForFunction(id=>{const sheet=document.querySelector('#sheet');return !sheet.hidden&&sheet.classList.contains('is-open')&&document.querySelector('main').inert&&document.querySelector('#sheet-title')?.textContent===JSON.parse(document.querySelector('#hw-records').textContent).records.find(r=>r.id===id)?.title&&location.hash==='#leaf-'+id;},id,{timeout:4000});}
async function phoneReducedMotion(page,ctx,requests){
  const detail=await phoneArrival(page,'/?theme=dark&open=work#leaf-donate',true,requests);
  const motion=await page.evaluate(()=>{
    const crit=[...document.querySelectorAll('.crit')],leaves=[...document.querySelectorAll('.leaf, .leaf__rest, .leaf__up')];
    const animations=[...new Set([...crit,...leaves].flatMap(el=>el.getAnimations({subtree:true})))].filter(a=>a.playState==='running').map(a=>({name:a.animationName||'transition',target:a.effect?.target?.className}));
    return {reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,crit:crit.length,leaves:leaves.length,animations,flies:getComputedStyle(document.querySelector('.crit--flies')).transform};
  });
  assert.equal(motion.reduce,true);assert.ok(motion.crit>0&&motion.leaves>0,'actual paper critters and leaf sprite targets required');assert.deepEqual(motion.animations,[],'phone art runs under reduced motion');
  assert.equal(motion.flies,'matrix(1, 0, 0, 1, 150, 60)','fixed night lost its reduced-motion composition on an OS-light device');
  return {...detail,motion};
}
async function closed(page){await page.waitForFunction(()=>!document.querySelector('#sheet').classList.contains('is-open')&&!document.querySelector('main').inert&&!document.querySelector('.top').inert&&!location.hash.startsWith('#leaf-'),null,{timeout:4000});}
async function journey(page){await page.goto(fx.base+'/mobile/day.html',{waitUntil:'load'});await ready(page,true);exactURL(page,'/mobile/day.html');await page.tap('.top__donate');await sheetState(page,'donate');await page.keyboard.press('Escape');await closed(page);await page.tap('.top__donate');await sheetState(page,'donate');await page.goBack();await closed(page);await page.tap('.tree .tag[data-cat="work"]');await page.waitForFunction(()=>document.querySelector('details[data-cat="work"]').open&&location.hash==='#work',null,{timeout:4000});const leaves=page.locator('#work .leaf:not(.leaf--rep)');assert.ok(await leaves.count()>0,'nonrepresentative preview leaf required: the representative is already raised by its open branch');const leaf=leaves.first(),id=await leaf.getAttribute('data-peek');assert.ok(id);const before=await leaf.evaluate(el=>({up:el.classList.contains('is-up'),transform:getComputedStyle(el).transform}));assert.equal(before.up,false);await leaf.tap();await page.waitForFunction(({id,before})=>{const l=document.querySelector('.leaf[data-peek="'+id+'"]');return l.classList.contains('is-up')&&getComputedStyle(l).transform!==before&&!document.querySelector('#sheet').classList.contains('is-open')&&l.closest('.tier__art').querySelector('.slip').textContent.includes(JSON.parse(document.querySelector('#hw-records').textContent).records.find(r=>r.id===id).title);},{id,before:before.transform},{timeout:4000});const after=await leaf.evaluate(el=>({up:el.classList.contains('is-up'),transform:getComputedStyle(el).transform}));assert.notEqual(after.transform,before.transform,'first tap leaf visibly lifts');await leaf.tap();await sheetState(page,id);await page.tap('.sheet__more a[data-close]');await closed(page);await page.waitForFunction(()=>document.querySelector('details[data-cat="work"]').open&&document.querySelector('#work').getBoundingClientRect().top<innerHeight&&document.querySelector('#work').getBoundingClientRect().bottom>0,null,{timeout:4000});
// Two trusted inputs without waiting for the first asynchronous Back to finish.
await page.tap('.top__donate');await sheetState(page,'donate');const closeBox=await page.locator('.sheet__close').boundingBox(),openBox=await page.locator('.top__donate').boundingBox();assert.ok(closeBox&&openBox);await page.touchscreen.tap(closeBox.x+closeBox.width/2,closeBox.y+closeBox.height/2);await page.touchscreen.tap(openBox.x+openBox.width/2,openBox.y+openBox.height/2);await sheetState(page,'donate');await page.waitForTimeout(320);await sheetState(page,'donate');await page.tap('.sheet__close');await closed(page);
await page.tap('.top__donate');await sheetState(page,'donate');await page.tap('.sheet__close');await page.tap('.tree .tag[data-cat="news"]');await page.waitForFunction(()=>!document.querySelector('#sheet').classList.contains('is-open')&&!document.querySelector('main').inert&&document.querySelector('details[data-cat="news"]').open&&location.hash==='#t-news'&&document.querySelector('#t-news').getBoundingClientRect().top<innerHeight,null,{timeout:4000});const linkCount=await page.locator('.card[data-open][href], .groups a[data-open][href]').count();assert.ok(linkCount>0,'real original links remain');return {leaf:id,before,after,linkCount,url:page.url()};}
async function text200(page){await page.goto(fx.base+'/mobile/day.html',{waitUntil:'load'});await ready(page,true);await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await settle(page);await page.evaluate(()=>dispatchEvent(new Event('resize')));await page.waitForTimeout(400);const result=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.documentElement).fontSize),viewport:document.documentElement.clientWidth,width:document.documentElement.scrollWidth,flow:document.querySelector('.tree').classList.contains('is-flow'),tags:[...document.querySelectorAll('.tree .tag')].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};})}));assert.equal(result.font,32,'large text was actually applied');assert.ok(result.tags.length>=6);assert.ok(result.width<=result.viewport,'large text creates horizontal overflow');for(const r of result.tags){assert.ok(r.left>=0&&r.right<=result.viewport,'large text tag offscreen: '+r.text);assert.ok(r.width>=44&&r.height>=44,'large text target smaller than44px');}assert.ok(!result.tags.some((a,i)=>result.tags.some((b,j)=>j>i&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)),'large text tags overlap');return result;}
try{
for(const path of pinned){const bytes=await readRegularInput(join(site,path),{runtime,maxBytes:8*1024*1024,encoding:null,timeoutMs:8000});assert.ok(bytes.length>0,'empty required artifact '+path);report.inputs[path]=sha(bytes);}
fx=await browserFixture({runtime,siteRoot:site,runTimeoutMs:180000});
await session('desktop day',{viewport:{width:1440,height:900},colorScheme:'light'},p=>desktop(p,'/','light',false));
await session('desktop OS-dark night',{viewport:{width:1440,height:900},colorScheme:'dark'},p=>desktop(p,'/','dark',true));
await session('direct taste default night',{viewport:{width:1440,height:900},colorScheme:'light'},p=>desktop(p,'/taste/','light',true));
await session('explicit taste day',{viewport:{width:1440,height:900},colorScheme:'dark'},p=>desktop(p,'/taste/?theme=light','dark',false));
await session('desktop reduced motion',{viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'},reducedMotion);
await session('desktop mode navigation',{viewport:{width:1440,height:900},colorScheme:'light'},modeNavigation);
await session('taste navigation and finder',{viewport:{width:1440,height:900},colorScheme:'light'},finderJourney);
for(const [name,path,scheme,night]of [['phone auto day','/?open=work#leaf-donate','light',false],['phone auto night','/?open=work#leaf-donate','dark',true],['phone direct taste auto day','/taste/?open=work#leaf-donate','light',false],['phone explicit night','/?theme=dark&open=work#leaf-donate','light',true]])await session(name,{...phoneOptions,colorScheme:scheme},(p,c,r)=>phoneArrival(p,path,night,r));
await session('phone explicit night reduced motion',{...phoneOptions,colorScheme:'light',reducedMotion:'reduce'},phoneReducedMotion);
await session('phone hero day',{...phoneOptions,colorScheme:'light'},(p,c,r)=>phoneHero(p,false,r));
await session('phone hero night',{...phoneOptions,colorScheme:'light'},(p,c,r)=>phoneHero(p,true,r));
await session('phone journey',{...phoneOptions,colorScheme:'light'},journey);
await session('phone 200% text',{...phoneOptions,colorScheme:'light'},text200);
for(const path of pinned)assert.equal(sha(await readRegularInput(join(site,path),{runtime,maxBytes:8*1024*1024,encoding:null,timeoutMs:8000})),report.inputs[path],'Artifact changed during run: '+path);
}catch(e){report.failures.push('Run crashed: '+e.message);console.error(e);}finally{
if(fx)try{await fx.close();}catch(e){report.failures.push('Fixture close: '+e.message);}
try{cleanup=await runtime.shutdown('functional verification finished');}catch(e){cleanup={errors:[e.message]};}
report.cleanup=cleanup;report.blocked=fx?.blocked||[];report.finished=new Date().toISOString();
Object.assign(report,functionalVerdict(report,expected,cleanup,report.blocked));
await deadline('write final functional receipt',()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n'),{timeoutMs:5000});
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.failures,report:join(out,'report.json')}));
if(!report.passed)process.exitCode=process.exitCode||1;
}
