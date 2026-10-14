// Capture the first compositor frame delivered after an instant jump, and the
// following frames. Screencast delivery can skip frames; it is not a hardware
// display/weak-GPU measurement. Geometry samples also cover the jump task itself.
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {PNG} from './fidelity-deps.mjs';
import pixelmatch from './fidelity-deps.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
browserToolCLI({});
const out=resolve(process.env.HW_OUT||'output/playwright/jumps');
await mkdir(out,{recursive:true});
const fixture=await browserFixture();
const report={browser:fixture.browser.version(),cases:[],pixelPolicy:{threshold:0.1,includeAA:false,excludedHeaderPixels:100},limitations:'First delivered compositor frame; screencast can skip physical frames. Fonts/images settled to isolate rendering containment. First-frame artwork gate excludes the top 100 pixels because sticky-header/nav transitions are sampled at different times.'};
const root=process.env.HW_SITE_ROOT||resolve('publish');
report.htmlSha256=createHash('sha256').update(await readFile(resolve(root,'optimized/index.html'))).digest('hex');
try{
  for(const width of [1365,390])for(const route of ['local','optimized']){
    const height=width===1365?768:844;
    const context=await fixture.browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    try{
      const page=await context.newPage(),cdp=await context.newCDPSession(page);
      await page.goto(`${fixture.base}/${route}/`,{waitUntil:'load'});
      await page.evaluate(async()=>{
        await document.fonts.ready;
        await Promise.all([...document.images].map(img=>{img.loading='eager';return img.decode().catch(()=>{});}));
        await Promise.all(document.getAnimations().map(async a=>{a.pause();await a.ready;a.currentTime=4000;}));
        document.documentElement.style.scrollBehavior='auto';
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(200);
      for(const target of ['top','network']){
        await page.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
        await page.waitForTimeout(300);
        const frames=[];
        const listener=frame=>{frames.push(frame);void cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});};
        cdp.on('Page.screencastFrame',listener);
        await cdp.send('Page.startScreencast',{format:'png',maxWidth:width,maxHeight:height,everyNthFrame:1});
        await page.waitForTimeout(80);
        const result=await page.evaluate(async target=>{
          const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,height:r.height};};
          const y=target==='top'?0:document.getElementById(target).getBoundingClientRect().top+scrollY;
          const mark=performance.timeOrigin+performance.now();
          scrollTo({top:y,behavior:'instant'});
          const samples=[];
          const sample=()=>samples.push({scrollY,stage:box('.stage'),network:box('.net__stage'),target:target==='top'?0:document.getElementById(target).getBoundingClientRect().top,scrollHeight:document.documentElement.scrollHeight});
          sample();
          for(let i=0;i<5;i++){await new Promise(requestAnimationFrame);sample();}
          return {mark,y,samples};
        },target);
        await page.waitForTimeout(400);
        await cdp.send('Page.stopScreencast');cdp.off('Page.screencastFrame',listener);
        // A queued pre-jump surface can arrive after the JS timestamp. Require
        // compositor scroll metadata to identify the requested viewport too.
        const afterMark=frames.filter(f=>f.metadata.timestamp*1000>=result.mark);
        const delivered=afterMark.filter(f=>Math.abs(f.metadata.scrollOffsetY-result.samples[0].scrollY)<1);
        const tag=`${width}-${route}-${target}`;
        const summary=[];
        for(let i=0;i<delivered.length;i++){
          const file=`${tag}-frame-${i}.png`;
          await writeFile(resolve(out,file),Buffer.from(delivered[i].data,'base64'));
          summary.push({file,ms:delivered[i].metadata.timestamp*1000-result.mark,scrollOffsetY:delivered[i].metadata.scrollOffsetY});
        }
        const settled=PNG.sync.read(await page.screenshot());
        await writeFile(resolve(out,`${tag}-settled.png`),PNG.sync.write(settled));
        let pixels=null,artworkPixels=null,dimensionsMatch=false;
        if(delivered.length){
          const first=PNG.sync.read(Buffer.from(delivered[0].data,'base64'));
          dimensionsMatch=first.width===settled.width&&first.height===settled.height;
          if(dimensionsMatch){
            const diff=new PNG({width,height});
            pixels=pixelmatch(first.data,settled.data,diff.data,width,height,{threshold:0.1});
            const cropStart=100*width*4;
            artworkPixels=pixelmatch(first.data.subarray(cropStart),settled.data.subarray(cropStart),undefined,width,height-100,{threshold:0.1});
            await writeFile(resolve(out,`${tag}-first-diff.png`),PNG.sync.write(diff));
          }
        }
        const row={route,width,target,...result,frames:summary,excludedPriorViewportFrames:afterMark.length-delivered.length,dimensionsMatch,firstVsSettledPixels:pixels,firstVsSettledArtworkPixels:artworkPixels};
        report.cases.push(row);console.log(JSON.stringify(row));
      }
    }finally{await context.close();}
  }
}finally{await fixture.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
for(const row of report.cases.filter(r=>r.route==='optimized')){
  assert(row.frames.length>0,'No post-jump frame captured');
  assert(row.dimensionsMatch,'First delivered frame dimensions are not comparable');
  assert.equal(row.firstVsSettledArtworkPixels,0,'Artwork changes between first delivered and settled jump frame');
  const last=row.samples.at(-1);
  for(const sample of row.samples){
    assert(Math.abs(sample.scrollY-last.scrollY)<1,'Jump scroll position shifted');
    assert(Math.abs(sample.stage.height-last.stage.height)<1,'Hero intrinsic height shifted');
    assert(Math.abs(sample.network.height-last.network.height)<1,'Network intrinsic height shifted');
    assert(Math.abs(sample.target-last.target)<1,'Jump target displaced in the first frames');
    assert(Math.abs(sample.stage.top-last.stage.top)<1,'Hero displaced in the first frames');
    assert(Math.abs(sample.network.top-last.network.top)<1,'Network displaced in the first frames');
  }
  assert(Math.abs(last.scrollY-row.y)<1,'Jump did not reach requested position');
}
