// Raster cost per compositor layer, measured by replaying each layer's recorded paint (LayerTree.profileSnapshot, CPU replay
// inside the renderer: a proxy for GPU raster cost and display-list size, not the GPU time itself) at the given scroll position.
// Use it to compare CSS candidates (--css) or builds (HW_SITE_ROOT) on the same view; replay ms are the minimum of --repeat runs.
// Not a gate; independent session (timing is affected by machine load, op counts are not).
//   node tools/diagnostics/raster-cost-probe.mjs [--route optimized] [--width 1424 --height 820 --dpr 2 | --device "Pixel 7"]
//        [--at '<selector>' | --y <scrollY>] [--css '<rules>'] [--top 8] [--repeat 5] [--ops] [--rect]
//   --rect   replay only the part of each layer inside the viewport (layer offsets from LayerTree; scrolling-contents layers)
//   --ops    print the paint-op histogram of each profiled layer
import {browserFixture,browserToolCLI} from '../browser-test-lib.mjs';
import {devices} from '../browser-deps.mjs';
import {validateRasterOptions,profilePaintSnapshot} from './raster-diagnostic-input.mjs';
const o=browserToolCLI({route:{type:'string',default:'optimized'},width:{type:'string',default:'1424'},height:{type:'string',default:'820'},dpr:{type:'string',default:'2'},device:{type:'string'},at:{type:'string'},y:{type:'string'},css:{type:'string'},top:{type:'string',default:'8'},repeat:{type:'string',default:'5'},ops:{type:'boolean'},rect:{type:'boolean'}});
const config=validateRasterOptions(o,devices),{dpr}=config;
if(process.env.HW_BROWSER!==undefined&&process.env.HW_BROWSER!=='chromium')throw Error('Raster snapshots require chromium');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fx=await browserFixture({runTimeoutMs:240000});
try{
  const dev=o.device?devices[o.device]:null;
  const ctx=await fx.browser.newContext({...(dev||{viewport:{width:+o.width,height:+o.height},deviceScaleFactor:dpr}),bypassCSP:!!o.css}),page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
  await page.goto(`${fx.base}/${o.route}/`,{waitUntil:'load'});await page.waitForFunction(()=>window.leafLift,null,{timeout:15000});
  if(o.css)await page.addStyleTag({content:o.css});
  await sleep(3500);
  if(o.at)await page.locator(o.at).first().evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
  else if(o.y!==undefined)await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),+o.y);
  await sleep(1500);
  const view=await page.evaluate(()=>({scrollY,w:innerWidth,h:innerHeight}));
  if(![view.scrollY,view.w,view.h].every(Number.isFinite)||view.w<=0||view.h<=0)throw Error('Invalid raster viewport');
  let latest=[],version=0;cdp.on('LayerTree.layerTreeDidChange',e=>{if(e.layers){latest=e.layers;version++;}});
  await cdp.send('DOM.getDocument',{depth:0});await cdp.send('LayerTree.enable');
  for(const t=Date.now();!version&&Date.now()-t<3000;)await sleep(25);
  if(!latest.length)throw Error('UNSUPPORTED: no LayerTree feed');
  const label=async id=>{const n=(await cdp.send('DOM.describeNode',{backendNodeId:id}).catch(()=>null))?.node;if(!n)return '(gone)';const at=n.attributes||[],g=k=>{const i=at.findIndex((x,j)=>j%2===0&&x===k);return i<0?'':at[i+1];};return n.nodeName.toLowerCase()+(g('id')?'#'+g('id'):'')+g('class').split(/\s+/).filter(c=>c&&!/^hw-s-/.test(c)).map(c=>'.'+c).join('');};
  const byId=new Map(latest.map(l=>[l.layerId,l]));
  // Document-space origin: sum offsets up the parent chain (scrolling-contents layers carry the scroll as a negative offset on an ancestor in some versions; reported as-is).
  const origin=l=>{let x=0,y=0;const visited=new Set();for(let p=l;p;p=byId.get(p.parentLayerId)){if(visited.has(p.layerId))throw Error('Invalid cyclic layer tree');visited.add(p.layerId);if(![p.offsetX,p.offsetY].every(Number.isFinite))throw Error('Invalid layer origin');x+=p.offsetX;y+=p.offsetY;if(p.transform){if(![p.transform[12],p.transform[13]].every(Number.isFinite))throw Error('Invalid layer transform');x+=p.transform[12];y+=p.transform[13];}}if(![x,y].every(Number.isFinite))throw Error('Nonfinite layer origin');return {x,y};};
  const rows=[];
  for(const l of latest.filter(l=>l.drawsContent&&l.width*l.height>0)){
    if(![l.width,l.height,l.width*l.height].every(Number.isFinite))throw Error('Invalid drawing layer dimensions');
    const org=origin(l),visible=!(org.y+l.height<=0||org.y>=view.h||org.x+l.width<=0||org.x>=view.w);
    rows.push({l,org,visible,area:l.width*l.height});
  }
  const picked=rows.filter(r=>r.visible).sort((a,b)=>b.area-a.area).slice(0,+o.top);
  if(!picked.length)throw Error('UNSUPPORTED: no visible drawing layers to profile');
  const out=[];
  for(const r of picked){
    const l=r.l;
    const clip=o.rect?{x:Math.max(0,-r.org.x),y:Math.max(0,-r.org.y),width:Math.min(l.width+r.org.x,view.w)-Math.max(0,r.org.x),height:Math.min(l.height+r.org.y,view.h)-Math.max(0,r.org.y)}:undefined;
    const profile=await profilePaintSnapshot(cdp,l.layerId,{repeat:config.repeat,clip,ops:!!o.ops});
    const row={layer:l.layerId,label:l.backendNodeId?await label(l.backendNodeId):'(no node)',size:l.width+'x'+l.height,origin:[Math.round(r.org.x),Math.round(r.org.y)],paintCount:l.paintCount,clip:clip?[clip.x,clip.y,clip.width,clip.height].map(Math.round).join(','):'whole',...profile,reasons:(await cdp.send('LayerTree.compositingReasons',{layerId:l.layerId}).catch(()=>null))?.compositingReasonIds?.join('+')||''};
    out.push(row);
  }
  const totalReplayMs=out.reduce((s,r)=>s+r.replayMs,0);if(!Number.isFinite(totalReplayMs)||totalReplayMs<=0)throw Error('UNSUPPORTED: no finite total replay cost');
  console.log(JSON.stringify({route:o.route,css:o.css||null,viewport:dev?o.device:`${o.width}x${o.height}@${dpr}`,scrollY:view.scrollY,layers:latest.length,drawing:rows.length,visible:rows.filter(r=>r.visible).length,totalReplayMs:totalReplayMs,profiled:out},null,1));
  await ctx.close();
}finally{await fx.close();}
