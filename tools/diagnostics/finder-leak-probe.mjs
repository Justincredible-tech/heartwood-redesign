// Names the node behind test-abuse's leak-finder growth (+1 DOM node per type/clear cycle). Independent Chrome session; optional bounded serialization.
// Variants, 40 cycles each after 4 warm cycles, counters after two forced GCs:
//   page-keys     the shipped page, type "forest" then select-all + Backspace (exactly leak-finder's cycle)
//   page-value    the shipped page, type "forest" then clear by script (value='' + input event): no editing command
//   bare-keys     a blank document with one plain <input> (no site code), same keystrokes
//   bare-value    the blank document, cleared by script
// HW_SATURATE=<cycles> instead types into the bare field that many times (default 1400) and prints the node count every 100: a plateau means bounded browser history.
//   Measured 2026-10-12 (Chrome 154): +1 node per cycle up to cycle 1000, then flat at 1009 = Blink's 1000-step undo stack (one retained Text node per step).
// afterBlur re-counts after blurring the field (Chrome keeps its undo history across blur).
// If bare-keys grows like page-keys, the growth is Chrome's editing undo history (deleted text nodes kept for Undo), not page code.
//   HW_SITE_ROOT, HW_ROUTE (default optimized), HW_CYCLES (default 40)
import {browserFixture,browserToolCLI} from '../browser-test-lib.mjs';
browserToolCLI({});
const boundedCycles=(name,fallback,max)=>{const raw=process.env[name]??String(fallback),n=Number(raw);if(!raw.trim()||!Number.isSafeInteger(n)||n<1||n>max)throw Error(name+' must be an integer in1..'+max);return n;};
const route=process.env.HW_ROUTE??'optimized',N=boundedCycles('HW_CYCLES',40,1000);
const saturation=process.env.HW_SATURATE===undefined?null:boundedCycles('HW_SATURATE',1400,5000);
if(route.length>128||!route.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)&&p!=='.'&&p!=='..'))throw Error('HW_ROUTE must name a local site route');
if(process.env.HW_BROWSER!==undefined&&process.env.HW_BROWSER!=='chromium')throw Error('HW_BROWSER must be chromium for this CDP diagnostic');
//40x4 typed variants or1400 saturation cycles are preserved. Ceilings follow the
// selected workload; they never add a dwell. Saturation5000 exceeds the1000-step
// undo history several times; ordinary comparisons permit up to1000 cycles/variant.
const runTimeoutMs=30000+(saturation===null?4*(N+4)*400+20000:saturation*200);
const fx=await browserFixture({runTimeoutMs});
const out={route,cycles:N,variants:{}};
try{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function run(name,{bare,clear}){
    const ctx=await fx.browser.newContext({viewport:{width:1365,height:768}}),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
    if(bare)await page.setContent('<!doctype html><input id="group-find">');else{await page.goto(`${fx.base}/${route}/`,{waitUntil:'load'});await page.waitForFunction(()=>window.leafLift,null,{timeout:15000});await sleep(2500);}
    const f=page.locator('#group-find');await f.scrollIntoViewIfNeeded();
    const cycle=async()=>{await f.focus();await page.keyboard.type('forest',{delay:15});
      if(clear==='keys'){await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.press('Backspace');}
      else await page.evaluate(()=>{const e=document.getElementById('group-find');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});};
    const count=async()=>{await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage');await sleep(300);const n=(await cdp.send('Memory.getDOMCounters')).nodes;if(!Number.isSafeInteger(n)||n<1)throw Error('UNSUPPORTED: absent or invalid DOM node counter');return n;};
    for(let i=0;i<4;i++)await cycle();
    const a=await count();for(let i=0;i<N;i++)await cycle();await sleep(400);const b=await count();
    await page.evaluate(()=>document.activeElement?.blur());const c=await count();
    out.variants[name]={before:a,after:b,delta:b-a,perCycle:Math.round((b-a)/N*100)/100,afterBlur:c};
    console.log(name.padEnd(12),JSON.stringify(out.variants[name]));
    await ctx.close();
  }
  if(saturation!==null){
    // Bounded or unbounded? Blink's undo stack keeps at most 1000 steps (kMaximumUndoStackDepth); past that each new step drops the oldest and its nodes.
    const ctx=await fx.browser.newContext(),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page),total=saturation,series=[];
    await page.setContent('<!doctype html><input id="group-find">');await page.focus('#group-find');
    const count=async()=>{await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage');return (await cdp.send('Memory.getDOMCounters')).nodes;};
    for(let i=0;i<=total;i++){if(i%100===0){series.push([i,await count()]);console.log('saturate cycle',i,'nodes',series.at(-1)[1]);}
      await page.keyboard.type('forest');await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.press('Backspace');}
    out.saturation=series;await ctx.close();
  }else{
    await run('page-keys',{clear:'keys'});
    await run('page-value',{clear:'value'});
    await run('bare-keys',{bare:true,clear:'keys'});
    await run('bare-value',{bare:true,clear:'value'});
  }
}finally{await fx.close();}
console.log(JSON.stringify(out));
