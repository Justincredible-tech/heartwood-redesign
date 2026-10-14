// Experiment: render each TILED layer of the paper grain (--grain in source/mobile/reference-paper.css: the radial-gradient layers with a
// background-size) once per device-pixel ratio in Chrome, exactly as the browser rasterizes that tile, and write a CSS override
// that draws the same tiles as images (image-set per DPR) instead of per-element gradient tiles. Untiled layers stay as written.
//   node tools/diagnostics/grain-tiles.mjs --out DIR [--dprs 1,2,3]     writes DIR/grain-<i>@<d>x.png and DIR/grain.css
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {browserFixture,browserToolCLI} from '../browser-test-lib.mjs';
import {ensureToolRuntime} from '../tool-runtime.mjs';
import {readRegularInput} from '../tool-operations.mjs';
import {grainLayers,parseDprs} from './raster-diagnostic-input.mjs';
const o=browserToolCLI({out:{type:'string'},dprs:{type:'string',default:'1,2,3'}});
if(!o.out)throw Error('--out DIR is required');
const dprs=parseDprs(o.dprs);
const root=resolve(import.meta.dirname,'../..');
const runtime=ensureToolRuntime({name:'paper grain tile diagnostic',runTimeoutMs:120000});await runtime.ready;
const layers=grainLayers(await readRegularInput(resolve(root,'source/mobile/reference-paper.css'),{runtime}));
await runtime.deadline('create grain output',()=>mkdir(o.out,{recursive:true}),{timeoutMs:10000});
const fx=await browserFixture({runtime,runTimeoutMs:120000});
const parts=[];
try{
  const tiles={};
  for(const d of dprs){
    const ctx=await fx.browser.newContext({viewport:{width:400,height:300},deviceScaleFactor:d}),page=await ctx.newPage();
    for(const [i,l] of layers.entries()){if(!l.w)continue;
      await page.setContent(`<!doctype html><body style="margin:0;background:transparent"><div style="width:${l.w}px;height:${l.h}px;background:${l.image}"></div></body>`);
      const png=await page.screenshot({omitBackground:true,clip:{x:0,y:0,width:l.w,height:l.h},animations:'disabled'});
      const f=join(o.out,`grain-${i}@${d}x.png`);await runtime.deadline('write grain tile '+f,()=>writeFile(f,png),{timeoutMs:10000});(tiles[i]??=[]).push([d,png]);}
    await ctx.close();}
  for(const [i,l] of layers.entries())parts.push(l.w?`image-set(${tiles[i].map(([d,png])=>`url("data:image/png;base64,${png.toString('base64')}") ${d}x`).join(', ')}) ${l.x} ${l.y} / ${l.w}px ${l.h}px`:l.text);
  await runtime.deadline('write grain artifacts',async()=>{
    await writeFile(join(o.out,'grain-orig.txt'),layers.map(l=>l.text).join(',\n'));
    await writeFile(join(o.out,'grain.css'),`:root{--grain:${parts.join(',\n')};}\n`);
  },{timeoutMs:10000});
}finally{await fx.close();}
console.log(JSON.stringify({out:o.out,layers:layers.length,tiled:layers.filter(l=>l.w).length,dprs}));
