// Which script line forces each style/layout update during one interaction: traces a leaf tap (open) or Escape (close) and prints
// every UpdateLayoutTree / Layout / Paint inside long main-thread tasks with its element count and the JS frame that forced it.
// Not a gate; independent session.
//   node tools/diagnostics/forced-style-probe.mjs [--route optimized] [--device "Pixel 7"] [--cpu 4] [--phase open|close] [--css '<rules>']
import {browserFixture,browserToolCLI,finishCDPTrace} from '../browser-test-lib.mjs';
import {devices} from '../browser-deps.mjs';
import {validateInteractionOptions,requireStyleTrace} from './reversible-dom-sample.mjs';
const o=browserToolCLI({route:{type:'string',default:'optimized'},device:{type:'string',default:'Pixel 7'},cpu:{type:'string',default:'4'},phase:{type:'string',default:'open'},css:{type:'string'},leaf:{type:'string',default:'20'}});
const {cpu,leaf:leafIndex}=validateInteractionOptions(o,devices);
if(process.env.HW_BROWSER!==undefined&&process.env.HW_BROWSER!=='chromium')throw Error('Modal CDP diagnostics require chromium');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fx=await browserFixture({runTimeoutMs:180000});
try{
  const dev=devices[o.device],ctx=await fx.browser.newContext({...dev,bypassCSP:!!o.css}),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
  await page.goto(`${fx.base}/${o.route}/`,{waitUntil:'load'});await page.waitForFunction(()=>window.leafLift,null,{timeout:15000});
  if(o.css)await page.addStyleTag({content:o.css});
  await sleep(3500);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await sleep(300);
  if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  const leaves=page.locator('.tree button.leaf[data-item]');if(leafIndex>=await leaves.count())throw Error('--leaf is outside the current tree');
  const leaf=leaves.nth(leafIndex),b=await leaf.boundingBox();if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)throw Error('UNSUPPORTED: leaf target is not visible');
  const tap=()=>dev.hasTouch?page.touchscreen.tap(b.x+b.width/2,b.y+b.height*.6):leaf.click();
  if(o.phase==='close'){await tap();await sleep(3500);}
  await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing,toplevel',transferMode:'ReturnAsStream'});
  await sleep(300);
  if(o.phase==='open')await tap();else await page.keyboard.press('Escape');
  await sleep(1500+(cpu>1?1500:0));
  const {main,tasks,t0}=requireStyleTrace(JSON.parse(await finishCDPTrace(cdp)).traceEvents);
  console.log('Measured '+main.length+' main-thread slices; '+tasks.length+' tasks over15ms');
  for(const t of tasks){
    console.log(`task ${(t.dur/1000).toFixed(1)} ms @${((t.ts-t0)/1000).toFixed(0)}`);
    for(const e of main.filter(e=>e!==t&&e.ts>=t.ts&&e.ts+e.dur<=t.ts+t.dur&&['UpdateLayoutTree','Layout','Paint','FunctionCall','EventDispatch','HitTest','Layerize','PrePaint'].includes(e.name)&&e.dur>1000)){
      const st=e.args?.beginData?.stackTrace||e.args?.data?.stackTrace,f=st?.[0];
      console.log(`  ${e.name.padEnd(16)} ${(e.dur/1000).toFixed(1).padStart(6)} ms`+(e.args?.elementCount!=null?` elements ${e.args.elementCount}`:'')+(e.args?.data?.type?' '+e.args.data.type:'')+(e.args?.data?.url?' '+String(e.args.data.url).split('/').pop()+':'+e.args.data.lineNumber:'')+(f?` forced by ${f.functionName||'(anon)'} ${String(f.url).split('/').pop()}:${f.lineNumber}:${f.columnNumber}`:''));
    }
  }
  await ctx.close();
}finally{await fx.close();}
