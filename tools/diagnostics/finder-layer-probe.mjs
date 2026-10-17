// Names the compositor layer behind test-abuse leak-finder's "+1 layer": runs leak-finder's cycle (type "forest" into #group-find,
// select-all + Backspace) 4 warm + N times and diffs the LayerTree (label, size, compositing reasons) before and after. Chrome; serial (browser-lock.sh). Not a gate.
//   node tools/diagnostics/finder-layer-probe.mjs      HW_SITE_ROOT, HW_ROUTE (default optimized), HW_CYCLES (default 60)
import {browserFixture,browserToolCLI} from '../browser-test-lib.mjs';
browserToolCLI({});
const route=process.env.HW_ROUTE||'optimized',N=Number(process.env.HW_CYCLES??60),sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(!Number.isInteger(N)||N<1||N>10000)throw Error('HW_CYCLES must be an integer in1..10000');
if(!['optimized','optimized-taste','optimized-next'].includes(route))throw Error('Unknown finder probe route');
const fx=await browserFixture({runTimeoutMs:Math.max(60000,N*300+30000)});
try{
  const ctx=await fx.browser.newContext({viewport:{width:1365,height:768}}),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
  await page.goto(`${fx.base}/${route}/`,{waitUntil:'load'});await page.waitForFunction(()=>window.leafLift,null,{timeout:15000});await sleep(3000);
  await page.evaluate(()=>{const r=document.getElementById('group-find').getBoundingClientRect();scrollTo({top:Math.max(0,scrollY+r.top+r.height/2-innerHeight/2),behavior:'instant'});});await sleep(300);
  const cycle=async()=>{await page.focus('#group-find');await page.keyboard.type('forest',{delay:15});await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.press('Backspace');};
  const label=async id=>{const n=(await cdp.send('DOM.describeNode',{backendNodeId:id}).catch(()=>null))?.node;if(!n)return '(gone)';const at=n.attributes||[],g=k=>{const i=at.findIndex((x,j)=>j%2===0&&x===k);return i<0?'':at[i+1];};return n.nodeName.toLowerCase()+(g('id')?'#'+g('id'):'')+g('class').split(/\s+/).filter(c=>c&&!/^hw-s-/.test(c)).map(c=>'.'+c).join('');};
  let latest=[],version=0;cdp.on('LayerTree.layerTreeDidChange',e=>{if(e.layers){latest=e.layers;version++;}});await cdp.send('DOM.getDocument',{depth:0});
  const snap=async()=>{await sleep(600);const before=version;await cdp.send('LayerTree.enable');
    const start=Date.now();while(version===before&&Date.now()-start<2000)await sleep(25);
    if(version===before||!latest.length)throw Error('UNSUPPORTED: no fresh LayerTree feed for finder snapshot');
    const L=latest;const rows=[];
    for(const l of L){const lab=l.backendNodeId?await label(l.backendNodeId):'(no node)';if(lab==='i#probe-nudge')continue;const r=(await cdp.send('LayerTree.compositingReasons',{layerId:l.layerId}).catch(()=>null))?.compositingReasonIds?.join('+')||'';rows.push(lab+' '+l.width+'x'+l.height+' ['+r+']');}
    await cdp.send('LayerTree.disable');return rows;};
  for(let i=0;i<4;i++)await cycle();
  const a=await snap();for(let i=0;i<N;i++)await cycle();const b=await snap();
  const count=x=>x.reduce((m,k)=>(m[k]=(m[k]||0)+1,m),{}),ca=count(a),cb=count(b);
  const diff=[...new Set([...a,...b])].map(k=>[k,(cb[k]||0)-(ca[k]||0)]).filter(([,d])=>d);
  console.log(JSON.stringify({route,cycles:N,layersBefore:a.length,layersAfter:b.length,activeElement:await page.evaluate(()=>document.activeElement?.id||document.activeElement?.tagName),diff},null,1));
  await ctx.close();
}finally{await fx.close();}
