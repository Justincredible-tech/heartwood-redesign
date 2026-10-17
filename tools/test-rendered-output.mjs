// Fixed-time pixel regression on the shipped folder, with optional mutation proof.
import {browserFixture,browserToolCLI} from './browser-test-lib.mjs';
import {devices} from './browser-deps.mjs';
import {PNG} from './fidelity-deps.mjs';
import pixelmatch from './fidelity-deps.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {artworkMasks,compareFidelity,assertFidelity,FIDELITY_POLICY,compareGeometry} from './fidelity-acceptance.mjs';

browserToolCLI({"mutation":{"type":"boolean"},"controls":{"type":"boolean"},"report-only":{"type":"boolean"}});
const out=resolve(process.env.HW_OUT || 'output/playwright/rendered');
await mkdir(out,{recursive:true});
const fixture=await browserFixture();
const selftest=process.env.HW_RENDER_SELFTEST==='1',SELF_CSS='#key-chips .chip{outline:1px solid red}';
const report={browser:fixture.browser.version(),engine:fixture.engine,siteRoot:process.env.HW_SITE_ROOT||resolve('publish'),override:process.env.HW_OVERRIDE||null,selftest,pixelPolicy:{threshold:0.1,includeAA:false,outsideTreeDifferingPixels:0,protectedDifferingPixels:0,...FIDELITY_POLICY,referenceMasksOnly:true,ceilingUnits:'CSS pixels'},cases:[]};
report.htmlSha256=createHash('sha256').update(await readFile(resolve(report.siteRoot,'optimized/index.html'))).digest('hex');
const mutation=process.argv.includes('--mutation');
// ACCEPTED POLICY (leaf layers): the shipped build may differ from the original only INSIDE the TREE MASK, by sub-pixel raster edges: max channel
// delta <= FIDELITY_POLICY.treeMaxChannelDelta and no more than TREE_CEILING[`${width}-${target}`] threshold-diff CSS pixels. TREE MASK = union of the individual rects of every
// `.tree button.leaf`, `.tree .hw-leaf-layer` and `.tree span.leaf` (fill leaf) plus TREE_MARGIN CSS px for shadows, UNION the pixels the tree itself paints (a second
// capture with everything except `.tree` and `button.trunk` hidden over magenta, reference-only, dilated by PAINT_DILATE CSS px). It is NOT a bounding box (the
// roots and sheets span the page); paintOnlyDiffs reports diffs on tree paint outside the leaf rects (crown/trunk/root edges).
// PROTECTED MASK = text line rects, links, buttons outside .tree, chips and form controls: zero threshold diffs there even where the tree mask overlaps.
// Outside the tree mask, threshold/JND differences are rejected. Inside it,
// tolerance is limited to original raster edges and a finite normalized count;
// a mean-DeltaE gate separately rejects broad palette drift. All threshold
// counts come from ONE unmasked pixelmatch; the candidate cannot grow the mask.
// The ceilings are the user-accepted leaf-layer raster deviation, measured values plus ~10% headroom; they must NOT be raised to hide regressions.
// --report-only still prints and records every number but skips the assertions. HW_RENDER_SELFTEST=1 injects an outline on `#key-chips .chip` into the
// shipped side only; the protected/outside assertions must then FAIL, which proves the masks can fail.
const TREE_MARGIN=20,PAINT_DILATE=2,TREE_CEILING={'1365-top':320,'1424-top':320,'390-top':77}; // finite CSS-pixel ceiling; targets without a tree on screen:0
// TOUCH CONTEXT (Pixel 7, hasTouch, hover:none): leaf layers are promoted only under (hover: hover), so a touch device must match the ORIGINAL exactly:
// zero differing pixels over the whole page, no tree mask, no ceiling. HW_DPR (default 1) sets the desktop devicePixelRatio; HW_WIDTH limits to one desktop width.
const DPR=Number(process.env.HW_DPR||1),widths=process.env.HW_WIDTH?[Number(process.env.HW_WIDTH)]:[1365,390],touchWidth=devices['Pixel 7'].viewport.width,runTouch=!process.env.HW_WIDTH&&process.env.HW_TOUCH!=='0';
async function screenshot(route,width,target,override='') {
  if(route==='optimized'&&process.env.HW_OVERRIDE)override=process.env.HW_OVERRIDE;
  const touch=width===touchWidth&&runTouch&&!widths.includes(width);
  const height=width===1365?768:844;
  const ctx=await fixture.browser.newContext({...(touch?devices['Pixel 7']:{viewport:{width,height},deviceScaleFactor:DPR}),reducedMotion:'reduce',bypassCSP:!!override||(selftest&&route==='optimized')});
  try {
    const page=await ctx.newPage();
    await page.goto(`${fixture.base}/${route}/`,{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);
    if(override)await page.addStyleTag({content:override});
    if(selftest&&route==='optimized')await page.addStyleTag({content:SELF_CSS});
    // This is a settled artwork check. Load lazy images before asking the
    // original's resize-only collision pass to run; startup is tested separately.
    await page.evaluate(async()=>{
      await Promise.all([...document.images].map(img=>{img.loading='eager';return img.decode().catch(()=>{});}));
      await Promise.all(document.getAnimations().map(async a=>{a.pause();await a.ready;a.currentTime=4000;}));
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(200); // Original clearType debounce is 150 ms.
    await page.evaluate(async target=>{
      document.documentElement.style.scrollBehavior='auto';
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const y=target==='top'?0:document.getElementById(target).getBoundingClientRect().top+scrollY-218;
      scrollTo({top:y,behavior:'instant'});
    },target);
    await page.waitForTimeout(500);
    await page.evaluate(async()=>{
      await Promise.all(document.getAnimations().map(async a=>{a.pause();await a.ready;a.currentTime=4000;}));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    });
    const info=await page.evaluate(()=>({scrollY,cutVisibility:getComputedStyle(document.querySelector('.deep .cut')).contentVisibility,clipMargin:getComputedStyle(document.querySelector('.deep .cut')).overflowClipMargin}));
    // `geo` = .tree + every button.leaf rect (2 dp) for the equality gate; `rects` = per-element viewport rects [l,t,r,b] for the masks.
    const tree=await page.evaluate(()=>{const q=e=>e.getBoundingClientRect(),f=n=>Math.round(n*100)/100,box=e=>{const k=q(e);return k.width&&k.height?[k.left,k.top,k.right,k.bottom]:null;},all=s=>[...document.querySelectorAll(s)].map(box).filter(Boolean),text=[];
      const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let n;n=walk.nextNode();){if(!n.textContent.trim()||n.parentElement.closest('.tree,script,style,noscript'))continue;const g=document.createRange();g.selectNodeContents(n);for(const k of g.getClientRects())if(k.width&&k.height)text.push([k.left,k.top,k.right,k.bottom]);}
      return{geoRaw:[document.querySelector('.tree'),...document.querySelectorAll('.tree button.leaf')].map(e=>{const k=q(e);return[k.x,k.y,k.width,k.height];}),geo:[document.querySelector('.tree'),...document.querySelectorAll('.tree button.leaf')].map(e=>{const k=q(e);return[f(k.x),f(k.y),f(k.width),f(k.height)];}),rects:{leaf:all('.tree button.leaf, .tree .hw-leaf-layer, .tree span.leaf'),prot:[...all('a, button:not(.tree *):not(.trunk), #key-chips .chip, input, select, textarea'),...text]}};});
    const png=PNG.sync.read(await page.screenshot());
    // Tree-only capture: constructable sheet (works under the page CSP) hides everything but the tree over magenta; paint = any non-magenta pixel.
    await page.evaluate(()=>{const s=new CSSStyleSheet();s.replaceSync('html,body{background:#f0f!important}body *{visibility:hidden!important}.tree,.tree *,button.trunk,button.trunk *{visibility:visible!important}');document.adoptedStyleSheets=[...document.adoptedStyleSheets,s];return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    const only=PNG.sync.read(await page.screenshot()),paint=new Uint8Array(only.width*only.height);
    for(let p=0;p<paint.length;p++){const i=p*4;paint[p]=only.data[i]!==255||only.data[i+1]!==0||only.data[i+2]!==255?1:0;}
    return {png,info,tree,paint,cssViewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight}))};
  }finally{await ctx.close();}
}
try {
  for(const width of [...widths,...runTouch?[touchWidth]:[]])for(const target of (process.env.HW_TARGETS||'gatherings,work,network,top').split(',')) {
    const original=await screenshot('local',width,target);
    const optimized=await screenshot('optimized',width,target);
    const compare=async(label,a,b)=>{
      const diff=new PNG({width:a.png.width,height:a.png.height});
      const pixels=pixelmatch(a.png.data,b.png.data,diff.data,diff.width,diff.height,{threshold:0.1});
      // CSS rectangles/margins scale to physical image pixels. The reference
      // defines paint and edges; the candidate cannot expand an allowance.
      const masks=artworkMasks({png:a.png,cssWidth:a.cssViewport.width,cssHeight:a.cssViewport.height,leafRects:a.tree.rects.leaf,protectedRects:a.tree.rects.prot,treePaint:a.paint,treeMarginCSS:TREE_MARGIN,paintDilateCSS:PAINT_DILATE});
      const measured=compareFidelity(a.png,b.png,diff.data,masks);
      assert.equal(measured.pixels,pixels,'per-pixel diff flags must equal the pixelmatch count');
      const geometryComparison=compareGeometry(a.tree.geoRaw,b.tree.geoRaw),geometryEqual=geometryComparison.equal;
      const geometryDifferences=a.tree.geo.flatMap((rect,index)=>JSON.stringify(rect)===JSON.stringify(b.tree.geo[index])?[]:[{index,original:rect,optimized:b.tree.geo[index],originalRaw:a.tree.geoRaw[index],optimizedRaw:b.tree.geoRaw[index],rawDelta:b.tree.geoRaw[index]?a.tree.geoRaw[index].map((n,j)=>b.tree.geoRaw[index][j]-n):null}]);
      const touch=width===touchWidth&&runTouch&&!widths.includes(width),tag=`${width}${touch?'-touch':DPR>1?'-dpr'+DPR:''}-${target}-${label}`;
      for(const [suffix,png]of [['original',a.png],['optimized',b.png],['diff',diff]])await writeFile(resolve(out,`${tag}-${suffix}.png`),PNG.sync.write(png));
      const row={width,touch,dpr:touch?devices['Pixel 7'].deviceScaleFactor:DPR,target,label,...measured,geometryEqual,geometryComparison,geometryDifferences,original:a.info,optimized:b.info};report.cases.push(row);console.log(JSON.stringify(row));
      return pixels;
    };
    await compare(report.override?'diagnostic-override':'shipped',original,optimized);
    if(process.argv.includes('--controls'))await compare('original-repeat',original,await screenshot('local',width,target));
    if(mutation&&target==='gatherings') {
      const visible=await screenshot('optimized',width,target,'.deep .cut{content-visibility:visible!important}');
      await compare('visible-cuts',original,visible);
    }
  }
}finally{await fixture.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
// Settled artwork gate: antialiasing tolerance above is per pixel, not a blanket count allowance.
if(!process.argv.includes('--report-only')){
  assert(!report.override,'Injected CSS is diagnostic only and cannot pass shipped acceptance');
  assert(report.cases.filter(r=>r.label==='original-repeat').every(r=>r.pixels===0),'Original repeat control differs; see report and saved diffs');
  const shipped=report.cases.filter(r=>r.label==='shipped');
  assert(shipped.filter(r=>r.touch).every(r=>r.pixels===0&&r.rawPixels===0),'Touch (Pixel 7) shipped differs from the original: touch devices must match exactly (no tree ceiling); see report and saved diffs');
  assert(shipped.every(r=>r.pixelsProtected===0),'Shipped differs from original inside protected UI (text/links/buttons/chips); see report and saved diffs');
  assert(shipped.every(r=>r.pixelsOutside===0),'Shipped differs from original outside the tree mask; see report and saved diffs');
  assert(shipped.every(r=>r.geometryEqual),'Tree/leaf geometry differs from original');
  for(const row of report.cases){
    const ceiling=row.target==='top'?TREE_CEILING[`${row.width}-${row.target}`]:0;
    if(row.label==='original-repeat')assertFidelity(row,{ceilingCSSPixels:0,strictZero:true});
    else if(row.label==='shipped')assertFidelity(row,{ceilingCSSPixels:row.touch?0:ceiling,strictZero:row.touch});
  }
}
