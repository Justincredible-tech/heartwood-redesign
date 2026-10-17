// Sequential cold-load, fixed-time pixels, and load-film evidence.
// --reference <pristine project> --candidate <isolated directory> --out <evidence>
// --mode timing|pixels|film|loading|loading-state --runs 3 --engine chromium|firefox|webkit
// Uses the archived preview implementation for every route, so its actual
// Brotli-q4 delivery is held constant while testing stylesheet placement.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {ensureToolRuntime} from '../tool-runtime.mjs';
import {chromium, firefox, webkit} from '../browser-deps.mjs';
import {guardBrowser, guardLaunchOptions, managedLaunch, listenServer, closeServer, browserToolCLI} from '../browser-test-lib.mjs';   // network guard: no traffic beyond loopback
import {PNG} from '../fidelity-deps.mjs';
import pixelmatch from '../fidelity-deps.mjs';

const args = browserToolCLI(Object.fromEntries(['reference','candidate','out','mode','runs','engine','film-tail-ms','baseline','javascript'].map(k=>[k,{type:'string'}])));
assert(['chromium','firefox','webkit'].includes(args.engine||'chromium'),'Unknown engine');
assert(['timing','pixels','film','loading','loading-state'].includes(args.mode||'timing'),'Unknown mode');
assert((args.runs===undefined||args.runs.trim())&&Number.isInteger(Number(args.runs??3))&&Number(args.runs??3)>0,'--runs must be a finite positive integer');
assert(args.javascript===undefined||['true','false'].includes(args.javascript),'--javascript must be true or false');
const filmTailMs=Number(args['film-tail-ms']??1000);
assert((args['film-tail-ms']===undefined||args['film-tail-ms'].trim())&&Number.isFinite(filmTailMs)&&filmTailMs>=0&&filmTailMs<=30000,'Film tail must be between 0 and 30000 milliseconds');
assert(args.reference && args.candidate && args.out, 'Provide --reference, --candidate and --out');
const runtime=ensureToolRuntime();await runtime.ready;
const reference = resolve(args.reference), candidate = resolve(args.candidate), out = resolve(args.out);
await mkdir(out,{recursive:true});
const {createPreviewServer} = await import(pathToFileURL(resolve(reference,'tools/serve.mjs')).href);
const servers = [];
async function serve(siteRoot) {
  const server = await createPreviewServer({siteRoot});
  servers.push(server);await listenServer(server,{runtime});
  return `http://127.0.0.1:${server.address().port}`;
}
const baselineUrl = await serve(resolve(reference,'publish')), candidateUrl = await serve(candidate);
const comparison = args.baseline ? resolve(args.baseline) : resolve(reference,'publish/optimized');
const comparisonUrl = args.baseline ? await serve(comparison) : baselineUrl+'/optimized';
const cases = [
  {name:'original',url:baselineUrl+'/local/',file:resolve(reference,'publish/local/index.html')},
  {name:'archived',url:comparisonUrl+'/',file:resolve(comparison,'index.html')},
  {name:'candidate',url:candidateUrl+'/',file:resolve(candidate,'index.html')},
];
for (const entry of cases) entry.htmlSha256 = createHash('sha256').update(await readFile(entry.file)).digest('hex');
const engine = args.engine || 'chromium', mode = args.mode || 'timing';

// Loading-frame captures must not wait for document.fonts.ready: WebKit keeps
// that promise pending while the deliberately held stylesheet is outstanding.
// This switch belongs to the locked Playwright screenshotter, not to the page.
if(mode==='loading')process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const executablePath = process.env.HW_BROWSER_EXECUTABLE || (engine==='chromium' && process.platform==='darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
let browser, guard;
try { browser = await managedLaunch(({chromium,firefox,webkit}[engine]),{headless:true,executablePath,...guardLaunchOptions(engine)},{runtime}); guard = guardBrowser(browser,{route:engine!=='chromium'}); }
catch(error) {
  for(const server of servers)await closeServer(server);
  await writeFile(resolve(out,'report.json'),JSON.stringify({mode,engine,reference,candidate,available:false,error:String(error),recordedAt:new Date().toISOString()},null,2));
  throw error;
}
const report = {mode,engine,browser:browser.version(),javaScriptEnabled:args.javascript!=='false',recordedAt:new Date().toISOString(),reference,candidate,delivery:'Archived preview; Brotli quality 4 / gzip 6 negotiated identically for all routes',cases,results:[]};
if(mode==='timing'||mode==='film')report.throttling={latencyMs:150,downloadBitsPerSecond:1.6e6,uploadBitsPerSecond:.75e6,cpuRate:4,coldContext:true};
if(mode==='film')report.filmTailMs=filmTailMs;
if(mode==='pixels')report.comparison={fixedAnimationTimeMs:4000,pixelmatchThreshold:.1,rawChannelDifferencesAlsoRecorded:true};
if(mode==='loading')report.limitation='This is a deliberately held-CSS challenge, not a timing measurement. Playwright WebKit screenshots inject a temporary body style and force layout; compare before/after state and independent native-screen evidence.';
const throttle = {offline:false,latency:150,downloadThroughput:1.6e6/8,uploadThroughput:0.75e6/8};
async function context(viewport={width:1366,height:768}, extras={}) {
  const ctx = await browser.newContext({viewport,deviceScaleFactor:1,javaScriptEnabled:args.javascript!=='false',...extras});
  await ctx.addInitScript(()=>{
    window.__startup={paints:[],shifts:[],longtasks:[]};
    for (const [type,key] of [['paint','paints'],['layout-shift','shifts'],['longtask','longtasks']]) {
      try { new PerformanceObserver(list=>window.__startup[key].push(...list.getEntries().map(e=>e.toJSON()))).observe({type,buffered:true}); } catch {}
    }
  });
  return ctx;
}
async function cold(entry,run,film=false) {
  assert.equal(engine,'chromium','CDP throttling/film requires Chromium');
  const ctx = await context();
  try {
    const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), resources = [], frames = [];
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',throttle);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    cdp.on('Network.responseReceived',e=>resources.push({url:e.response.url,status:e.response.status,type:e.type,encoding:e.response.headers['content-encoding'],contentLength:e.response.headers['content-length']}));
    if (film) {
      cdp.on('Page.screencastFrame',frame=>{frames.push(frame);cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});});
      await cdp.send('Page.startScreencast',{format:'png',maxWidth:683,maxHeight:384,everyNthFrame:1});
    }
    await page.goto(entry.url,{waitUntil:'load',timeout:120000});
    await page.evaluate(()=>document.fonts.ready);
    // A busy compositor can paint after the load event. Never silently record
    // an absent FCP as if this were a completed cold-start sample.
    await page.waitForFunction(()=>performance.getEntriesByName('first-contentful-paint').length>0,null,{timeout:30000});
    await page.waitForTimeout(film?filmTailMs:300);
    const measured = await page.evaluate(()=>({observed:window.__startup,nav:performance.getEntriesByType('navigation')[0].toJSON(),resources:performance.getEntriesByType('resource').map(e=>e.toJSON())}));
    const record = {name:entry.name,run,fcp:measured.observed.paints.find(e=>e.name==='first-contentful-paint')?.startTime,cls:measured.observed.shifts.filter(e=>!e.hadRecentInput).reduce((sum,e)=>sum+e.value,0),...measured,http:resources};
    assert(Number.isFinite(record.fcp),'Missing first-contentful-paint measurement');
    if(film) {
      await cdp.send('Page.stopScreencast');
      const dir = resolve(out,entry.name); await mkdir(dir,{recursive:true});
      const timeOrigin = measured.nav.startTime + await page.evaluate(()=>performance.timeOrigin);
      record.frames=[];
      let last = -Infinity;
      for (const frame of frames) {
        const ms = Math.round(frame.metadata.timestamp*1000-timeOrigin);
        if(ms < 0 || ms-last < 100) continue;
        const file = `${String(ms).padStart(6,'0')}.png`;
        await writeFile(resolve(dir,file),Buffer.from(frame.data,'base64'));
        record.frames.push({ms,file});last=ms;
      }
    }
    report.results.push(record);console.log(JSON.stringify({name:entry.name,run,fcp:record.fcp,cls:record.cls,frames:record.frames?.length}));
  } finally {await ctx.close();}
}
async function capture(entry,width,target,label) {
  const ctx=await context({width,height:width===390?844:768},{reducedMotion:'reduce'});
  try {
    const page=await ctx.newPage();await page.goto(entry.url,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(async()=>{
      await Promise.all([...document.images].map(img=>{img.loading='eager';return img.decode().catch(()=>{});}));
      await Promise.all(document.getAnimations().map(async a=>{a.pause();await a.ready;a.currentTime=4000;}));
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(200);
    await page.evaluate(async target=>{
      document.documentElement.style.scrollBehavior='auto';
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const y=target==='top'?0:document.getElementById(target).getBoundingClientRect().top+scrollY-218;
      scrollTo({top:y,behavior:'instant'});
    },target);
    await page.waitForTimeout(500);
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(async a=>{a.pause();await a.ready;a.currentTime=4000;}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    const bytes=await page.screenshot();await writeFile(resolve(out,`${width}-${target}-${label}.png`),bytes);
    return PNG.sync.read(bytes);
  } finally {await ctx.close();}
}
function compare(a,b) {
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  const diff=new PNG({width:a.width,height:a.height});let rawPixels=0,max=0;
  for(let i=0;i<a.data.length;i+=4){let change=0;for(let c=0;c<3;c++)change=Math.max(change,Math.abs(a.data[i+c]-b.data[i+c]));if(change)rawPixels++;max=Math.max(max,change);}
  const pixels=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:0.1});
  return {pixels,rawPixels,max,diff};
}
async function loading() {
  // Deliberately hold the second sheet. This probes each engine's behavior
  // before that sheet is usable; it is not a network performance measurement.
  for(const width of [1366,390]) {
    const ctx=await context({width,height:width===390?844:768});
    let release;
    const hold=new Promise(r=>{release=r;});
    try {
      const page=await ctx.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(String(e)));
      let requested;
      const arrived=new Promise(r=>{requested=r;});
      await page.route('**/heartwood-artwork.*.css',async route=>{requested();await hold;await route.continue();});
      await page.goto(cases[2].url,{waitUntil:'commit',timeout:30000});
      await Promise.race([arrived,page.waitForTimeout(10000).then(()=>{throw Error('Artwork request not observed');})]);
      await page.waitForTimeout(600);
      const frames=[];
      const readState=()=>page.evaluate(()=>({
          ms:performance.now(),readyState:document.readyState,timeline:document.timeline.currentTime,
          stylesheets:[...document.styleSheets].map(sheet=>({href:sheet.href,rules:sheet.cssRules.length})),
          states:['.scrim','.nav','.stage'].map(selector=>{const node=document.querySelector(selector);if(!node)return {selector,absent:true};const s=getComputedStyle(node);return {selector,opacity:s.opacity,visibility:s.visibility,display:s.display,transition:s.transition,animations:node.getAnimations().map(a=>({type:a.constructor.name,currentTime:a.currentTime,startTime:a.startTime,playState:a.playState}))};}),
      }));
      const snap=async label=>{
        const beforeScreenshot=await readState();
        const file=`${width}-${label}.png`;await page.screenshot({path:resolve(out,file),timeout:10000,caret:'initial'});
        frames.push({label,file,beforeScreenshot,...await readState()});
      };
      await snap('artwork-held');release();
      await snap('artwork-released');await page.waitForLoadState('load');await page.evaluate(()=>document.fonts.ready);
      await snap('loaded');
      const record={width,heldArtworkMs:600,frames,errors};report.results.push(record);console.log(JSON.stringify(record));
      assert.equal(errors.length,0,'Page errors during delayed CSS load');
    } finally {release();await ctx.close();}
  }
}
async function loadingState() {
  // No screenshot is requested while CSS is held. WebKit's screenshot helper
  // temporarily injects styles, making it unsuitable as evidence of native
  // render-blocking behavior. Compare the same pending state in an ordinary
  // one-sheet head layout and the split no-script fallback.
  for(const entry of cases.slice(1))for(const width of [1366,390]){
    const ctx=await context({width,height:width===390?844:768});
    let release;const hold=new Promise(r=>{release=r;});
    try{
      const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
      let requested;const arrived=new Promise(r=>{requested=r;});
      const pattern=entry.name==='candidate'?'**/heartwood-artwork.*.css':'**/heartwood.*.css';
      await page.route(pattern,async route=>{requested();await hold;await route.continue();});
      await page.goto(entry.url,{waitUntil:'commit'});
      await Promise.race([arrived,page.waitForTimeout(10000).then(()=>{throw Error('Held stylesheet request not observed');})]);
      await page.waitForTimeout(600);
      const state=()=>page.evaluate(()=>({readyState:document.readyState,stylesheets:[...document.styleSheets].map(s=>({href:s.href,rules:s.cssRules.length})),states:['.scrim','.nav','.stage','.scene'].map(selector=>{const e=document.querySelector(selector);if(!e)return {selector,absent:true};const s=getComputedStyle(e);return {selector,opacity:s.opacity,visibility:s.visibility,display:s.display};})}));
      const held=await state();release();await page.waitForLoadState('load');await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
      const loaded=await state();const record={name:entry.name,width,held,loaded,errors};report.results.push(record);console.log(JSON.stringify(record));
      assert.equal(errors.length,0);
      assert.equal(loaded.states[0].visibility,'hidden','Closed scrim must remain hidden without JavaScript');
      if(width===390)assert.equal(loaded.states[1].visibility,'hidden','Closed mobile navigation must remain hidden without JavaScript');
    }finally{release();await ctx.close();}
  }
}
try {
  if(mode==='timing') for(let run=0;run<Number(args.runs||3);run++) for(const entry of run%2?[...cases].reverse():cases) await cold(entry,run);
  else if(mode==='film') for(const entry of cases) await cold(entry,0,true);
  else if(mode==='loading-state') await loadingState();
  else if(mode==='pixels') {
    for(const width of [1366,390]) for(const target of ['top','gatherings','work','network']) {
      const a=await capture(cases[1],width,target,'archived'),control=await capture(cases[1],width,target,'control'),b=await capture(cases[2],width,target,'candidate');
      const same=compare(a,control),changed=compare(a,b);
      await writeFile(resolve(out,`${width}-${target}-diff.png`),PNG.sync.write(changed.diff));
      const record={width,target,control:{pixels:same.pixels,rawPixels:same.rawPixels,max:same.max},candidate:{pixels:changed.pixels,rawPixels:changed.rawPixels,max:changed.max}};
      report.results.push(record);console.log(JSON.stringify(record));
    }
  } else if(mode==='loading') await loading();
  else throw Error('Unknown mode '+mode);
} finally {
  await Promise.all([browser.close(),...servers.map(server=>closeServer(server))]);
  try{guard.assert();}catch(error){console.error(error.message);process.exitCode=1;}
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
}
if(mode==='pixels') assert(report.results.every(r=>r.control.pixels===0&&r.candidate.pixels===0),'Pixel mismatch; inspect saved PNG evidence and control');
