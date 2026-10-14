/** Pure configuration and snapshot evidence for paper-grain/raster diagnostics. */
export function parseDprs(value){
 if(typeof value!=='string'||!value.trim())throw Error('--dprs must list finite ratios in 1..4');
 const values=value.split(',').map(s=>{if(!s.trim())throw Error('--dprs must not contain empty ratios');return Number(s);});
 if(values.some(d=>!Number.isFinite(d)||d<1||d>4)||new Set(values).size!==values.length)throw Error('--dprs must list distinct finite ratios in 1..4');return values;
}
export function validateRasterOptions(o,devices){
 const int=(key,min,max)=>{if(typeof o[key]!=='string'||!o[key].trim())throw Error('--'+key+' must be a nonempty integer');const n=Number(o[key]);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('--'+key+' must be an integer in '+min+'..'+max);return n;};
 const width=int('width',240,4096),height=int('height',240,4096),dpr=Number(o.dpr);
 if(typeof o.dpr!=='string'||!o.dpr.trim()||!Number.isFinite(dpr)||dpr<.25||dpr>4)throw Error('--dpr must be finite in .25..4');
 if(typeof o.route!=='string'||!o.route.split('/').every(p=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)))throw Error('--route must name a local site route');
 if(o.device!==undefined&&!devices[o.device])throw Error('Unknown --device '+o.device);
 for(const key of ['at','css','ats','ys','css-file'])if(o[key]!==undefined&&(typeof o[key]!=='string'||!o[key].trim()))throw Error('--'+key+' must be nonempty');
 if(o.at!==undefined&&o.y!==undefined)throw Error('choose --at or --y');
 if(o.ats!==undefined&&o.ys!==undefined)throw Error('choose --ats or --ys');
 const y=o.y===undefined?undefined:int('y',0,200000),top=o.top===undefined?undefined:int('top',1,100),repeat=o.repeat===undefined?undefined:int('repeat',1,50);
 const spots=o.ats!==undefined?o.ats.split(',').map(at=>{if(!at.trim())throw Error('--ats must list nonempty selectors');return{at:at.trim()};}):(o.ys??'0').split(',').map(s=>{const n=Number(s);if(!s.trim()||!Number.isSafeInteger(n)||n<0)throw Error('--ys must list nonnegative safe integer scroll offsets');return{y:n};});
 return{width,height,dpr,y,top,repeat,spots};
}
export function grainLayers(css){
 const root=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/(?:^|\})\s*:root\s*\{([^{}]*)\}/g)].map(m=>m[1]).join('\n');
 const g=(/--grain:([\s\S]*?);/.exec(root)||[])[1];if(!g)throw Error('no --grain in :root');
 const layers=[];let depth=0,cur='';for(const ch of g){if(ch==='(')depth++;if(ch===')')depth--;if(depth<0)throw Error('invalid --grain parentheses');if(ch===','&&!depth){layers.push(cur.trim());cur='';}else cur+=ch;}if(depth)throw Error('invalid --grain parentheses');layers.push(cur.trim());
 const result=layers.map(l=>{if(!l)throw Error('empty --grain layer');const m=/^(.*\))\s+(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)\s*\/\s*([\d.]+)px\s+([\d.]+)px$/.exec(l);if(!m)return{text:l};const w=Number(m[4]),h=Number(m[5]);if(![w,h].every(n=>Number.isFinite(n)&&n>0&&n<=4096)||![m[2],m[3]].every(s=>Number.isFinite(Number(s.replace(/px$/,'')))))throw Error('--grain tile dimensions/offsets must be finite and positive in 0..4096px');return{text:l,image:m[1],x:m[2],y:m[3],w,h};});
 if(!result.some(l=>l.w))throw Error('no tiled --grain layers to render');return result;
}
/** Every acquired snapshot is released, including malformed/unsupported profile responses. */
export async function profilePaintSnapshot(cdp,layer,{repeat,clip,ops=false}={}){
 if(!Number.isSafeInteger(repeat)||repeat<1||repeat>50)throw Error('profile repeat must be in1..50');
 if(clip&&(!['x','y','width','height'].every(k=>Number.isFinite(clip[k]))||clip.x<0||clip.y<0||clip.width<=0||clip.height<=0))throw Error('invalid snapshot clip');
 const snapshotId=(await cdp.send('LayerTree.makeSnapshot',{layerId:layer})).snapshotId;
 if(typeof snapshotId!=='string'||!snapshotId.trim())throw Error('UNSUPPORTED: missing layer snapshot');
 let result,error;
 try{
  const timings=(await cdp.send('LayerTree.profileSnapshot',{snapshotId,minRepeatCount:repeat,...(clip?{clipRect:clip}:{})})).timings;
  if(!Array.isArray(timings)||!timings.length||timings.some(t=>!Array.isArray(t)||!t.length||t.some(v=>!Number.isFinite(v)||v<0)))throw Error('UNSUPPORTED: empty or nonfinite snapshot timings');
  const sums=timings.map(t=>t.reduce((s,v)=>s+v,0));if(sums.some(s=>!Number.isFinite(s)||s<=0)||!Number.isFinite(Math.min(...sums)*1000))throw Error('UNSUPPORTED: no finite measured replay timings');
  result={replayMs:Math.min(...sums)*1000};
  if(ops){const log=(await cdp.send('LayerTree.snapshotCommandLog',{snapshotId})).commandLog;if(!Array.isArray(log)||!log.length||log.some(c=>typeof c?.method!=='string'||!c.method))throw Error('UNSUPPORTED: empty snapshot command log');const h={};for(const c of log){const k=c.method+(c.params?.paint?.imageFilter||c.params?.imageFilter?' +filter':'');h[k]=(h[k]||0)+1;}Object.assign(result,{ops:log.length,opHistogram:Object.entries(h).sort((a,b)=>b[1]-a[1]).slice(0,14)});}
 }catch(e){error=e;}
 try{await cdp.send('LayerTree.releaseSnapshot',{snapshotId});}catch(e){error=error?new AggregateError([error,e],'Snapshot profiling and release failed'):e;}
 if(error)throw error;return result;
}
