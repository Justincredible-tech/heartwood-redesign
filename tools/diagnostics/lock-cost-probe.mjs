// Cost of the modal page lock's pieces on the live page (Pixel 7 emulation, CPU throttle): inert on the lockPage targets, the
// non-inert fallback (tabindex on every control), aria-hidden on the page roots, body.focus(), each followed by a forced style
// update, plus element counts per target. Undone after each sample. Not a gate; independent session.
//   node tools/diagnostics/lock-cost-probe.mjs [--route optimized] [--device "Pixel 7"] [--cpu 4] [--repeat 5] [--css '<rules>']
import {browserFixture,browserToolCLI} from '../browser-test-lib.mjs';
import {devices} from '../browser-deps.mjs';
import {validateInteractionOptions,reversibleDomSample} from './reversible-dom-sample.mjs';
const o=browserToolCLI({route:{type:'string',default:'optimized'},device:{type:'string',default:'Pixel 7'},cpu:{type:'string',default:'4'},repeat:{type:'string',default:'5'},css:{type:'string'},only:{type:'string'}});   // --only 'NAME PREFIX': run just that configuration (first sample = cold, on a fresh page)
const {cpu,repeat}=validateInteractionOptions(o,devices);
if(process.env.HW_BROWSER!==undefined&&process.env.HW_BROWSER!=='chromium')throw Error('Modal CDP diagnostics require chromium');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fx=await browserFixture({runTimeoutMs:180000});
try{
  const ctx=await fx.browser.newContext({...devices[o.device],bypassCSP:!!o.css}),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
  await page.addInitScript({content:'window.__hwReversibleSample = ('+reversibleDomSample.toString()+');'});
  await page.goto(`${fx.base}/${o.route}/`,{waitUntil:'load'});await page.waitForFunction(()=>window.leafLift,null,{timeout:15000});
  if(o.css)await page.addStyleTag({content:o.css});
  await sleep(3000);
  if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  const result=await page.evaluate(async ({repeat,only})=>{
    const page=[...document.querySelectorAll('[data-page], .skip')];
    const interactive='a[href], area[href], button, input, select, textarea, iframe, object, embed, summary, [tabindex], [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls]';
    const preferred='.top, .hero, .tree, .layer, .skip';const targets=[];
    page.forEach(el=>{const c=el.matches(preferred)?[el]:[...el.querySelectorAll(preferred)];const controls=[...el.querySelectorAll(interactive)];if(el.matches(interactive))controls.unshift(el);controls.forEach(n=>{if(!c.some(r=>r.contains(n)))c.push(n);});c.forEach(n=>{if(!targets.some(r=>r.contains(n)))targets.push(n);});});
    const count=el=>el.getElementsByTagName('*').length+1;
    const counts=targets.map(t=>[t.tagName.toLowerCase()+(t.id?'#'+t.id:'')+'.'+[...t.classList].join('.'),count(t)]);
    const flush=()=>getComputedStyle(document.body).color;
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,30)));
    const time=async(name,apply,elements=[],attributes=[],restoreFocus=true)=>{if(only&&!name.startsWith(only))return null;const values=[];for(let i=0;i<repeat;i++)values.push(await window.__hwReversibleSample(apply,{elements,attributes,restoreFocus,flush,frame}));const first=values[0];values.sort((a,b)=>a-b);return[name,'median',values[values.length>>1],'first',first];};
    const controls=[...new Set(page.flatMap(el=>[...(el.matches(interactive)?[el]:[]),...el.querySelectorAll(interactive)]))];
    const rows=[];
    rows.push(await time('select targets (script only)',()=>{const t=[];page.forEach(el=>{const c=el.matches(preferred)?[el]:[...el.querySelectorAll(preferred)];const cs=[...el.querySelectorAll(interactive)];cs.forEach(n=>{if(!c.some(r=>r.contains(n)))c.push(n);});c.forEach(n=>{if(!t.some(r=>r.contains(n)))t.push(n);});});}));
    rows.push(await time('inert on targets',()=>targets.forEach(t=>t.inert=true),targets,['inert']));
    for(const t of targets)rows.push(await time('inert on '+t.tagName.toLowerCase()+'.'+[...t.classList].join('.'),()=>t.inert=true,[t],['inert']));
    {const tree=targets.filter(t=>t.matches('.tree')),rest=targets.filter(t=>!t.matches('.tree')),treeControls=tree.flatMap(t=>[...t.querySelectorAll(interactive)]);rows.push(await time('inert on targets except tree, tabindex on tree controls',()=>{rest.forEach(t=>t.inert=true);treeControls.forEach(c=>c.setAttribute('tabindex','-1'));},[...rest,...treeControls],['inert','tabindex']));}
    rows.push(await time('inert on page roots',()=>page.forEach(t=>t.inert=true),page,['inert']));
    rows.push(await time('tabindex=-1 on '+controls.length+' controls',()=>controls.forEach(c=>c.setAttribute('tabindex','-1')),controls,['tabindex']));
    rows.push(await time('aria-hidden on page roots',()=>page.forEach(e=>e.setAttribute('aria-hidden','true')),page,['aria-hidden']));
    rows.push(await time('body.focus() (tabindex juggle)',()=>{document.body.setAttribute('tabindex','-1');document.body.focus({preventScroll:true});document.body.removeAttribute('tabindex');},[document.body],['tabindex'],true));
    rows.push(await time('body.is-lifted',()=>document.body.classList.add('is-lifted'),[document.body],['class']));
    for(let i=rows.length-1;i>=0;i--)if(!rows[i])rows.splice(i,1);
    return {elements:document.getElementsByTagName('*').length,targets:counts,controls:controls.length,rows};
  },{repeat,only:o.only||null});
  if(!Number.isSafeInteger(result.elements)||result.elements<1||!result.targets.length||!result.rows.length||result.rows.some(r=>r.length!==5||typeof r[0]!=='string'||r[1]!=='median'||r[3]!=='first'||![r[2],r[4]].every(n=>Number.isFinite(n)&&n>=0))||!result.rows.some(r=>r[2]>0||r[4]>0))throw Error('UNSUPPORTED: no complete measured modal-lock evidence');
  console.log(JSON.stringify({route:o.route,device:o.device,cpu,css:o.css||null,...result},null,1));
  await ctx.close();
}finally{await fx.close();}
