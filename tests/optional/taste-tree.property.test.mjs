// Properties of the Tree taste table (tools/taste-tree.mjs) over perturbed canopies: leaves nudged around the wood, the real art otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fc,check,numRuns} from '../property-lib.mjs';
import {treeData} from '../../tools/taste-tree.mjs';

const html=await readFile(new URL('../../source/heartwood-site.html',import.meta.url),'utf8');
const css=await readFile(new URL('../../source/css/heartwood-site.css',import.meta.url),'utf8');
const page=html+'\n<style>\n'+css+'\n</style>\n';   // the maintained composition keeps markup and stylesheet in separate files; the tools parse one page source
const runs={numRuns:Math.min(numRuns,25)};   // each run rasters the canopy (about 0.3 s)
// The oracle reads the page's own inputs itself (never the code under test): the artwork box, --leaf-ar and --leaf-shape (last :root value wins), the hover tilt and grow.
const geom=src=>{const css=src.replace(/\/\*[\s\S]*?\*\//g,''),last=re=>[...css.matchAll(re)].at(-1);
  const st=last(/\.stage\s*\{[^}]*aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/g),ar=last(/--leaf-ar:\s*([\d.]+)\s*;/g),sh=last(/--leaf-shape:\s*polygon\(([^)]*)\)/g),hv=last(/button\.leaf:hover\s*\{[^}]*rotate\(calc\(var\(--angle\) \+ ([\d.]+)deg\)\) scale\(([\d.]+)\)/g);
  return {W:+st[1],H:+st[2],AR:+ar[1],TILT:+hv[1],GROW:+hv[2],shape:sh[1].split(',').map(p=>p.trim().split(/\s+/).map(t=>parseFloat(t)/100))};};
const {W,H}=geom(css);
const ids=[...html.slice(html.indexOf('<div class="tree bigtree"'),html.indexOf('<div class="scene bigtree"')).matchAll(/data-leaf="(\d+)"/g)].map(m=>+m[1]);
const nudge=(src,moves)=>{let out=src;
  for(const [id,dx,dy] of moves)out=out.replace(new RegExp('(data-leaf="'+id+'"[^>]*style="--x:)([-\\d.]+)(;--y:)([-\\d.]+)'),(m,a,x,b,y)=>a+(+x+dx).toFixed(2)+b+(+y+dy).toFixed(2));
  return out;};
const moves=fc.array(fc.tuple(fc.constantFrom(...ids),fc.double({min:-4,max:4,noNaN:true}),fc.double({min:-4,max:4,noNaN:true})),{minLength:1,maxLength:8});

// Independent oracle: sample points inside the hover-pose leaf and ask the wood polygons (point in polygon, even-odd per sheet, XOR within a sheet).
const a=html.indexOf('<div class="scene bigtree" aria-hidden="true" style="z-index:4">'),front=html.slice(a,html.indexOf('<!-- ===== end generated',a));
const sheets=[...front.matchAll(/<div class="cut ([^"]+)">(.*?)<\/div>/g)].map(s=>[...s[2].matchAll(/<i style="left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%;clip-path:polygon\(((?:evenodd,)?[^)]*)\)"/g)].map(m=>{
  const [l,t,w,h]=[1,2,3,4].map(i=>parseFloat(m[i])),P=m[5].replace('evenodd,','').split(',').map(p=>{const [x,y]=p.trim().split(/\s+/);return [(l+w*parseFloat(x)/100)*W/100,(t+h*parseFloat(y)/100)*H/100];});
  return {P,x0:Math.min(...P.map(p=>p[0])),x1:Math.max(...P.map(p=>p[0])),y0:Math.min(...P.map(p=>p[1])),y1:Math.max(...P.map(p=>p[1]))};
}));
const inside=(P,x,y)=>{let c=false;for(let i=0,j=P.length-1;i<P.length;j=i++)if((P[i][1]>y)!==(P[j][1]>y)&&x<(P[j][0]-P[i][0])*(y-P[i][1])/(P[j][1]-P[i][1])+P[i][0])c=!c;return c;};
const wooded=(x,y)=>sheets.some(s=>s.reduce((odd,p)=>odd!==(x>=p.x0&&x<=p.x1&&y>=p.y0&&y<=p.y1&&inside(p.P,x,y)),false));
const leafAt=(src,id)=>{const m=new RegExp('data-leaf="'+id+'"[^>]*style="--x:([-\\d.]+);--y:([-\\d.]+);--r:([-\\d.]+);--s:([-\\d.]+)').exec(src);return {x:+m[1],y:+m[2],r:+m[3],s:+m[4]};};
const sampleCover=(src,id)=>{
  const {AR,TILT,GROW,shape}=geom(src),L=leafAt(src,id),w=L.s*AR/100*W,h=w/AR,ang=(L.r+TILT)*Math.PI/180,c=Math.cos(ang),s=Math.sin(ang);
  const P=shape.map(([px,py])=>{const vx=(px-.5)*w*GROW,vy=(py-1)*h*GROW;return [L.x/100*W+vx*c-vy*s,L.y/100*H+vx*s+vy*c];});
  const x0=Math.min(...P.map(p=>p[0])),x1=Math.max(...P.map(p=>p[0])),y0=Math.min(...P.map(p=>p[1])),y1=Math.max(...P.map(p=>p[1]));
  let n=0,hit=0;for(let y=y0+.5;y<y1;y++)for(let x=x0+.5;x<x1;x++)if(inside(P,x,y)){n++;if(wooded(x,y))hit++;}
  return n?hit/n:0;
};

test('same canopy, same table',()=>check(fc.property(moves,m=>{const h=nudge(page,m);assert.deepEqual(treeData(h).T,treeData(h).T);}),runs));

test('slide <= 10% of the leaf length; cover at the switch <= cover at hover; unoccluded leaves absent',()=>check(fc.property(moves,m=>{
  const h=nudge(page,m),{T,rows}=treeData(h);
  for(const r of rows){
    assert(r.switch<=r.hover+1e-9,'leaf '+r.id+' gets more covered by sliding');
    if(r.v&&!r.shadow)assert(Math.hypot(r.v[0]*r.len*geom(h).AR/100,r.v[1]*r.len/100)<=.1*r.len*1.01+.1,'leaf '+r.id+' slides '+r.v);
    if(!(r.id in T))assert(r.hover<.005&&!r.shadow,'leaf '+r.id+' is covered but absent');
  }
}),runs));

test('a leaf an independent point-in-polygon sampling finds well under the wood is in the table; one it finds clear of it is not (the page\'s own leaf proportions and hover pose, varied)',()=>check(fc.property(moves,fc.array(fc.constantFrom(...ids),{minLength:4,maxLength:4}),fc.constantFrom('.5','.42','.6','.7'),fc.constantFrom([3,1.14],[0,1.14],[6,1.25]),(m,pick,ar,[tilt,grow])=>{
  const h=nudge(page,m).replace('--leaf-ar: .5;','--leaf-ar: '+ar+';').replace('rotate(calc(var(--angle) + 3deg)) scale(1.14)','rotate(calc(var(--angle) + '+tilt+'deg)) scale('+grow+')'),{T}=treeData(h);
  for(const id of [...new Set([...pick,...m.map(x=>x[0])])]){
    const f=sampleCover(h,id);
    if(f>=.03)assert(id in T,'leaf '+id+' is '+(f*100).toFixed(1)+'% under the wood but absent');
    if(f<.001&&id in T)assert.deepEqual(T[id],[0,0],'leaf '+id+' is clear of the wood but slides '+T[id]);
  }
}),{...runs,numRuns:Math.min(runs.numRuns,12)}));
