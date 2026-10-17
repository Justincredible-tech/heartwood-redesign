// Hold only the real newsletter image response; compare geometry before/after
// releasing those exact bytes. Candidate CSS is diagnostic, never acceptance.
// HW_NEWS_WIDTHS=1365,390,320 HW_NEWS_MODES=jump,anchor
// HW_NEWS_VARIANTS=original,original-repeat,shipped,candidate
// HW_NEWS_CSS='.issue__cover{min-width:min(100%,17rem)}' HW_OUT=output/playwright/newsletter
// --report-only writes all evidence without asserting shipped acceptance.
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {PNG} from './fidelity-deps.mjs';
import pixelmatch from './fidelity-deps.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

browserToolCLI({"report-only":{"type":"boolean"}});
const root=resolve(import.meta.dirname,'..'),siteRoot=resolve(process.env.HW_SITE_ROOT||resolve(root,'publish'));
const out=resolve(process.env.HW_OUT||resolve(root,'output/playwright/newsletter'));
const widths=(process.env.HW_NEWS_WIDTHS||'1365,390,320').split(',').map(Number);
const modes=(process.env.HW_NEWS_MODES||'jump,anchor').split(',');
const variants=(process.env.HW_NEWS_VARIANTS||'original,original-repeat,shipped,candidate').split(',');
const override=process.env.HW_NEWS_CSS||'.issue__cover{min-width:min(100%,17rem)}';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert(widths.every(width=>Number.isInteger(width)&&width>=300));
assert(modes.every(mode=>['jump','anchor'].includes(mode)));
assert(variants.every(variant=>['original','original-repeat','shipped','candidate'].includes(variant)));
await mkdir(out,{recursive:true});
const imageManifest=JSON.parse(await readFile(resolve(siteRoot,'_optimized/images/manifest.json')));
const newsletter=imageManifest.images.find(image=>image.id==='fall-2026');assert(newsletter);
const manifest=JSON.parse(await readFile(resolve(siteRoot,'optimized/manifest.json')));
const newsletterPaths=new Map([[newsletter.original.path,newsletter.original.sha256]]);
for(const asset of manifest.assets.filter(asset=>/^fall-2026[.-]/i.test(asset.file)))newsletterPaths.set('/optimized/assets/'+asset.file,asset.sha256);
const fixture=await browserFixture({siteRoot});
const report={engine:fixture.engine,browser:fixture.browser.version(),siteRoot,override,
  htmlSha256:{original:hash(await readFile(resolve(siteRoot,'local/index.html'))),shipped:hash(await readFile(resolve(siteRoot,'optimized/index.html')))},
  conditions:{deviceScaleFactor:1,reducedMotion:'reduce',imageDelivery:'Only newsletter image held; exact local response released',externalRequests:'blocked and recorded',pixelTimeMs:4000,pixelThreshold:0.1,allowedPixelDifferences:0},cases:[],pixels:[]};
const settledImages=new Map();

async function metrics(page){
  return page.evaluate(()=>{
    const rect=selector=>{
      const element=document.querySelector(selector),box=element.getBoundingClientRect(),style=getComputedStyle(element);
      return {x:box.x,y:box.y,top:box.top+scrollY,width:box.width,height:box.height,offsetWidth:element.offsetWidth,offsetHeight:element.offsetHeight,cssWidth:style.width,cssHeight:style.height,aspectRatio:style.aspectRatio};
    };
    const image=document.querySelector('.issue__cover img');
    return {ms:performance.now(),scrollY,documentHeight:document.documentElement.scrollHeight,cover:rect('.issue__cover'),card:rect('#news-issue'),news:rect('#news'),network:rect('#network'),image:{complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,currentSrc:image.currentSrc}};
  });
}
async function frames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function freeze(page){
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(async animation=>{animation.pause();await animation.ready;animation.currentTime=4000;}));});
}
async function capture(width,mode,variant){
  const route=variant.startsWith('original')?'local':'optimized',candidate=variant==='candidate';
  const ctx=await fixture.browser.newContext({viewport:{width,height:width===1365?768:844},deviceScaleFactor:1,reducedMotion:'reduce',bypassCSP:candidate});
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  const requests=[],errors=[],external=[];
  let arrived;
  const arrival=new Promise(resolve=>{arrived=resolve;});
  try{
    await ctx.addInitScript(({css})=>{
      window.__newsletterShifts=[];
      try{
        new PerformanceObserver(list=>window.__newsletterShifts.push(...list.getEntries().map(entry=>({value:entry.value,startTime:entry.startTime,hadRecentInput:entry.hadRecentInput,sources:entry.sources.map(source=>({node:source.node?.id||source.node?.className||source.node?.tagName,previousRect:source.previousRect.toJSON(),currentRect:source.currentRect.toJSON()}))})))).observe({type:'layout-shift',buffered:true});
      }catch{}
      if(css){
        const install=()=>{
          const parent=document.head||document.documentElement;if(!parent)return false;
          const style=document.createElement('style');style.textContent=css;style.dataset.newsletterDiagnostic='true';parent.append(style);return true;
        };
        if(!install()){const observer=new MutationObserver(()=>{if(install())observer.disconnect();});observer.observe(document,{childList:true,subtree:true});}
      }
    },{css:candidate?override:''});
    const page=await ctx.newPage();
    page.on('pageerror',error=>errors.push(String(error)));
    await page.route('**/*',async intercepted=>{
      const url=new URL(intercepted.request().url());
      if(url.origin!==fixture.base){external.push(url.href);await intercepted.abort();return;}
      const expected=newsletterPaths.get(url.pathname);
      if(!expected){await intercepted.continue();return;}
      const response=await intercepted.fetch({timeout:30000}),bytes=await response.body();
      const record={url:url.href,status:response.status(),bytes:bytes.length,sha256:hash(bytes)};requests.push(record);
      assert.equal(record.status,200);assert.equal(record.sha256,expected,'Held response is not the captured newsletter image');
      arrived();await held;
      await intercepted.fulfill({response});
    });
    await page.goto(`${fixture.base}/${route}/${mode==='anchor'?'#news':''}`,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>document.fonts.ready);
    // Load other lazy media so their later sizing cannot contaminate this test.
    // Leave the newsletter request naturally triggered by the section visit.
    await page.evaluate(async()=>{
      await Promise.all([...document.images].filter(image=>!image.closest('.issue__cover')).map(image=>{image.loading='eager';return image.decode().catch(()=>{});}));
      document.documentElement.style.scrollBehavior='auto';
    });
    await freeze(page);
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(200); // Original collision pass has a 150ms debounce.
    if(mode==='jump')await page.evaluate(()=>document.querySelector('.nav a[href="#news"]').click());
    await Promise.race([arrival,page.waitForTimeout(10000).then(()=>{throw Error('Newsletter image request was not observed after visiting news');})]);
    await page.waitForTimeout(300);await frames(page);
    const before=await metrics(page),tag=`${width}-${mode}-${variant}`;
    assert(!before.image.complete&&before.image.naturalWidth===0,'Newsletter must still be held during pre-image geometry');
    await page.screenshot({path:resolve(out,tag+'-held.png')});
    const releaseStart=await page.evaluate(()=>performance.now());
    release();
    await page.locator('.issue__cover img').evaluate(image=>image.decode());
    await frames(page);
    const immediate=await metrics(page);
    await page.waitForTimeout(350);await frames(page);
    const after=await metrics(page);
    const shifts=await page.evaluate(start=>window.__newsletterShifts.filter(entry=>entry.startTime>=start),releaseStart);
    await page.screenshot({path:resolve(out,tag+'-released.png')});
    const included=shifts.filter(entry=>!entry.hadRecentInput);
    let cls=0,session=0,start=0,last=-Infinity;
    for(const entry of included){
      if(entry.startTime-last>1000||entry.startTime-start>5000){session=0;start=entry.startTime;}
      session+=entry.value;cls=Math.max(cls,session);last=entry.startTime;
    }
    const delta={coverWidth:after.cover.offsetWidth-before.cover.offsetWidth,coverHeight:after.cover.offsetHeight-before.cover.offsetHeight,cardWidth:after.card.offsetWidth-before.card.offsetWidth,cardHeight:after.card.offsetHeight-before.card.offsetHeight,networkTop:after.network.top-before.network.top,documentHeight:after.documentHeight-before.documentHeight,scrollY:after.scrollY-before.scrollY};
    const stable=Object.entries(delta).filter(([name])=>name!=='scrollY').every(([,value])=>Math.abs(value)<=0.5);
    // Separate settled artwork proof from the image-release geometry check.
    // Align every variant identically and rerun the original resize-only pass.
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.waitForTimeout(200);
    await page.evaluate(()=>scrollTo({top:document.querySelector('#news').getBoundingClientRect().top+scrollY-218,behavior:'instant'}));
    await page.waitForTimeout(200);await freeze(page);await frames(page);
    const bytes=await page.screenshot();await writeFile(resolve(out,tag+'-settled-news.png'),bytes);
    settledImages.set(tag,PNG.sync.read(bytes));
    const row={width,mode,variant,candidateCss:candidate?override:null,before,immediate,after,delta,stable,releaseStart,cls,imageReleaseShiftSum:included.reduce((sum,entry)=>sum+entry.value,0),shifts,requests,errors,external,settled:await metrics(page)};
    report.cases.push(row);console.log(JSON.stringify({width,mode,variant,delta,stable,cls,requests:requests.length,errors}));
    assert.equal(errors.length,0,'Browser errors during newsletter test');assert.equal(external.length,0,'Unexpected external request');
  }finally{release();await ctx.close();}
}
async function compare(width,mode,a,b){
  const first=settledImages.get(`${width}-${mode}-${a}`),second=settledImages.get(`${width}-${mode}-${b}`);
  if(!first||!second)return;
  assert.equal(first.width,second.width);assert.equal(first.height,second.height);
  const diff=new PNG({width:first.width,height:first.height});
  const pixels=pixelmatch(first.data,second.data,diff.data,diff.width,diff.height,{threshold:0.1});
  let rawPixels=0,maxChannelDelta=0;
  for(let index=0;index<first.data.length;index+=4){let delta=0;for(let channel=0;channel<4;channel++)delta=Math.max(delta,Math.abs(first.data[index+channel]-second.data[index+channel]));if(delta)rawPixels++;maxChannelDelta=Math.max(maxChannelDelta,delta);}
  const file=`${width}-${mode}-${a}-vs-${b}-diff.png`;await writeFile(resolve(out,file),PNG.sync.write(diff));
  const row={width,mode,a,b,pixels,rawPixels,maxChannelDelta,file};report.pixels.push(row);console.log(JSON.stringify(row));
}
try{
  for(const width of widths)for(const mode of modes){
    for(const variant of variants)await capture(width,mode,variant);
    for(const [a,b]of [['original','original-repeat'],['original','shipped'],['shipped','candidate'],['original','candidate']])await compare(width,mode,a,b);
  }
}finally{await fixture.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
if(!process.argv.includes('--report-only')){
  const shipped=report.cases.filter(row=>row.variant==='shipped');assert(shipped.length,'Shipped cases are required for acceptance');
  assert(shipped.every(row=>row.stable&&row.cls===0),'Shipped newsletter layout changes when its image arrives; see held/released geometry');
  assert(report.pixels.filter(row=>row.a==='original'&&row.b==='original-repeat').every(row=>row.pixels===0),'Original repeat control is unstable');
  assert(report.pixels.filter(row=>row.a==='shipped'&&row.b==='candidate').every(row=>row.pixels===0),'Diagnostic candidate changes settled shipped artwork');
  // Original versus shipped differences remain visible in the report. The
  // existing resized newsletter image is a separate fidelity limitation; this
  // layout test must not silently approve a different crop or image encoder.
}
