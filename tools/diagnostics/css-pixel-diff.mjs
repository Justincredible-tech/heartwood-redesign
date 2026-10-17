// Pixel effect of a CSS candidate on the SAME page: screenshot each position (animations disabled, so every run sees the same
// frame), inject the candidate rules, wait for their images, screenshot again, and compare. Reports per position how many
// pixels changed and by how much (max channel delta histogram) and writes amplified diff images. Not a gate; the gates are
// test-rendered-output / test-leaf-rendering / inspect-leaf-stacking on a built candidate.
//   node tools/diagnostics/css-pixel-diff.mjs --css-file FILE [--route optimized] [--width 1424 --height 820 --dpr 2 | --device "Pixel 7"]
//        [--ys 0,800,2400 | --ats '#net,#about'] [--out DIR]
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {browserFixture,browserToolCLI} from '../browser-test-lib.mjs';
import {rgbLab,deltaE2000} from '../fidelity-acceptance.mjs';
import {devices} from '../browser-deps.mjs';
import {ensureToolRuntime} from '../tool-runtime.mjs';
import {readRegularInput} from '../tool-operations.mjs';
import {validateRasterOptions} from './raster-diagnostic-input.mjs';
const o=browserToolCLI({route:{type:'string',default:'optimized'},width:{type:'string',default:'1424'},height:{type:'string',default:'820'},dpr:{type:'string',default:'2'},device:{type:'string'},'css-file':{type:'string'},ys:{type:'string'},ats:{type:'string'},out:{type:'string'}});
if(!o['css-file'])throw Error('--css-file is required');
const config=validateRasterOptions(o,devices),{spots}=config,out=o.out??process.env.HW_OUT;
const runtime=ensureToolRuntime({name:'CSS pixel diagnostic',runTimeoutMs:240000});await runtime.ready;
const css=await readRegularInput(o['css-file'],{runtime});
await runtime.deadline('create CSS diff output',()=>mkdir(out,{recursive:true}),{timeoutMs:10000});
const {loadSharp}=await import('../sharp-deps.mjs'),sharp=loadSharp();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fx=await browserFixture({runtime,runTimeoutMs:240000});
try{
  const dev=o.device?devices[o.device]:null;
  const ctx=await fx.browser.newContext({...(dev||{viewport:{width:+o.width,height:+o.height},deviceScaleFactor:+o.dpr}),bypassCSP:true}),page=await ctx.newPage();
  await page.goto(`${fx.base}/${o.route}/`,{waitUntil:'load'});await page.waitForFunction(()=>window.leafLift,null,{timeout:15000});await sleep(3500);
  const go=async s=>{if(s.at)await page.locator(s.at).first().evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));else await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),s.y);await sleep(700);return page.evaluate(()=>scrollY);};
  const shots=async()=>{const r=[];for(const s of spots){const y=await go(s);r.push({y,png:await page.screenshot({animations:'disabled'})});}return r;};
  const before=await shots();
  await page.addStyleTag({content:css});await sleep(300);
  await page.evaluate(async()=>{const urls=new Set();for(const sh of document.styleSheets)for(const r of sh.cssRules||[])for(const m of (r.cssText||'').matchAll(/url\("([^"]+)"\)/g))urls.add(m[1]);await Promise.all([...urls].map(u=>{const i=new Image();i.src=u;return i.decode().catch(()=>{});}));});
  await sleep(500);
  const after=await shots(),rows=[];
  for(const [k,s] of spots.entries()){
    const a=await sharp(before[k].png).removeAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(after[k].png).removeAlpha().raw().toBuffer({resolveWithObject:true});
    if(a.info.width!==b.info.width||a.info.height!==b.info.height)throw Error('size changed');
    const hist={'1':0,'2-3':0,'4-8':0,'9-16':0,'17+':0},diff=Buffer.alloc(a.data.length);let changed=0,max=0,jnd=0,maxDE=0;const jndAt=[];const big=[];
    for(let i=0;i<a.data.length;i+=3){let m=0;for(let c=0;c<3;c++)m=Math.max(m,Math.abs(a.data[i+c]-b.data[i+c]));if(!m)continue;changed++;{const de=deltaE2000(rgbLab(a.data[i],a.data[i+1],a.data[i+2]),rgbLab(b.data[i],b.data[i+1],b.data[i+2]));if(de>maxDE)maxDE=de;if(de>2.3){jnd++;if(jndAt.length<30)jndAt.push([(i/3)%a.info.width,Math.floor(i/3/a.info.width)]);}}if(m>=4&&big.length<4000)big.push([(i/3)%a.info.width,Math.floor(i/3/a.info.width)]);max=Math.max(max,m);hist[m===1?'1':m<=3?'2-3':m<=8?'4-8':m<=16?'9-16':'17+']++;diff[i]=Math.min(255,m*16);diff[i+1]=diff[i+2]=0;}
    const name=`pos${k}-y${before[k].y}`;await writeFile(join(out,name+'-before.png'),before[k].png);await writeFile(join(out,name+'-after.png'),after[k].png);
    await sharp(diff,{raw:{width:a.info.width,height:a.info.height,channels:3}}).png().toFile(join(out,name+'-diff.png'));
    rows.push({spot:s.at||s.y,scrollY:before[k].y,pixels:a.data.length/3,changed,changedFraction:+(changed/(a.data.length/3)).toFixed(5),maxChannelDelta:max,maxDeltaE:+maxDE.toFixed(2),jndPixels:jnd,jndAt:await page.evaluate(({pts,y,dpr})=>{scrollTo({top:y,behavior:"instant"});return pts.map(([px,py])=>{const x=px/dpr,yy=py/dpr;const hit=[...document.querySelectorAll(".stage *, .deep *")].filter(e=>{const r=e.getBoundingClientRect();return r.width&&x>=r.left&&x<r.right&&yy>=r.top&&yy<r.bottom&&getComputedStyle(e).backgroundImage!=="none";}).pop();return [px,py,hit?hit.tagName+"."+[...hit.classList].join(".")+"<"+(hit.parentElement?.className||"")+"> "+hit.getBoundingClientRect().width.toFixed(2)+"x"+hit.getBoundingClientRect().height.toFixed(2):null];});},{pts:jndAt,y:before[k].y,dpr:await page.evaluate(()=>devicePixelRatio)}),hist,over3Box:big.length?[Math.min(...big.map(p=>p[0])),Math.min(...big.map(p=>p[1])),Math.max(...big.map(p=>p[0])),Math.max(...big.map(p=>p[1]))]:null,over3Sample:big.filter((_,j)=>j%Math.max(1,Math.floor(big.length/12))===0).slice(0,12)});
  }
  console.log(JSON.stringify({route:o.route,viewport:dev?o.device:`${o.width}x${o.height}@${o.dpr}`,cssFile:o['css-file'],out,rows},null,1));
  await ctx.close();
}finally{await fx.close();}
