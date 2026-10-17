// Spec-level properties of the taste zones and pick(): written against the project’s zone rules (zone 1 hub, zone 2 hub edge to zone 3's inner boundary, zone 3 = buffers + enclosed pockets, nothing outside), not internals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fc,check} from '../property-lib.mjs';
import {extractNetwork,pick,computeZones,tap} from '../../tools/taste-network.mjs';

const html=await readFile(new URL('../../source/heartwood-site.html',import.meta.url),'utf8');
const css=await readFile(new URL('../../source/css/heartwood-site.css',import.meta.url),'utf8');
const page=html+'\n<style>\n'+css+'\n</style>\n';   // the maintained composition keeps markup and stylesheet in separate files; the tools parse one page source
const N=extractNetwork(page);
const nSpores=N.spores.length/2,hyp=Math.hypot,TAU=2*Math.PI;
const rootOf=i=>{while(N.segs[i].parent>=0)i=N.segs[i].parent;return i;};
const rOf=(x,y)=>hyp(x-N.cx,y-N.cy);
// Independent oracle from the raw geometry (circles and B only; no shipped boundary, hole or ray code): the union of the radius-B discs is rasterised on a 0.5-unit grid
// and its complement flood-filled (4-connected). The component that reaches the grid edge is the outside, the one holding the centre is the hub's own region, any other is an
// enclosed pocket. Zone 3 = in a disc or in a pocket; a notch open to the outside is nothing. Where the discs wall the hub in, zone 2 is the whole of the hub's region; where
// gaps open it to the outside, zone 2 runs out to the exact first disc along the point's own ray (the stored half-degree samples close a ray that hits no disc), nothing beyond.
const sporeAt=(M,i)=>[M.spores[2*i],M.spores[2*i+1]];
const dSpore=(M,i,x,y)=>hyp(M.spores[2*i]-x,M.spores[2*i+1]-y);
const inDisc=(M,x,y)=>{for(let i=0;i<M.spores.length/2;i++)if(dSpore(M,i,x,y)<=M.fade)return true;return false;};
const interp=(M,a,x,y)=>{const f=((Math.atan2(y-M.cy,x-M.cx)/TAU*M.n)%M.n+M.n)%M.n,k=Math.floor(f);return a[k]+(a[(k+1)%M.n]-a[k])*(f-k);};
const firstEntry=(M,x,y)=>{const dx=x-M.cx,dy=y-M.cy,r=hyp(dx,dy),ux=dx/r,uy=dy/r;let lo=Infinity;
  for(let i=0;i<M.spores.length;i+=2){const px=M.spores[i]-M.cx,py=M.spores[i+1]-M.cy,pr=px*ux+py*uy,q=px*px+py*py-pr*pr;if(pr>0&&q<=M.fade**2)lo=Math.min(lo,pr-Math.sqrt(M.fade**2-q));}
  return lo<Infinity?lo:interp(M,M.rin,x,y);};
const FS=.5,floods=new Map();
const flood=M=>{
  if(floods.has(M))return floods.get(M);
  const B=M.fade,sp=M.spores,xs=[0,M.w],ys=[0,M.h];for(let i=0;i<sp.length;i+=2){xs.push(sp[i]-B,sp[i]+B);ys.push(sp[i+1]-B,sp[i+1]+B);}
  const x0=Math.floor(Math.min(...xs))-8,y0=Math.floor(Math.min(...ys))-8,GW=Math.ceil((Math.max(...xs)+8-x0)/FS),GH=Math.ceil((Math.max(...ys)+8-y0)/FS);
  const X=i=>x0+(i+.5)*FS,Y=j=>y0+(j+.5)*FS,inU=new Uint8Array(GW*GH),comp=new Int32Array(GW*GH).fill(-1);
  for(let k=0;k<sp.length;k+=2)for(let j=Math.max(0,Math.floor((sp[k+1]-B-y0)/FS));j<=Math.min(GH-1,Math.ceil((sp[k+1]+B-y0)/FS));j++)
    for(let i=Math.max(0,Math.floor((sp[k]-B-x0)/FS));i<=Math.min(GW-1,Math.ceil((sp[k]+B-x0)/FS));i++)if(hyp(X(i)-sp[k],Y(j)-sp[k+1])<=B)inU[j*GW+i]=1;
  let nc=0;const st=[];
  for(let s=0;s<GW*GH;s++){if(inU[s]||comp[s]>=0)continue;comp[s]=nc;st.push(s);
    while(st.length){const c=st.pop(),i=c%GW,j=(c-i)/GW;for(const n of [i>0?c-1:-1,i<GW-1?c+1:-1,j>0?c-GW:-1,j<GH-1?c+GW:-1])if(n>=0&&!inU[n]&&comp[n]<0){comp[n]=nc;st.push(n);}}
    nc++;}
  const cell=(x,y)=>Math.floor((y-y0)/FS)*GW+Math.floor((x-x0)/FS);
  const F={x0,y0,GW,GH,X,Y,inU,comp,nc,cell,ext:comp[0],hubC:comp[cell(M.cx,M.cy)]};floods.set(M,F);return F;
};
// The component of an arbitrary point outside every disc: that of a nearby grid point outside every disc that a straight segment joins to it without touching a disc (null if none: a sliver under the grid's resolution).
const segClear=(M,ax,ay,bx,by)=>{for(let k=0;k<M.spores.length;k+=2){const px=M.spores[k],py=M.spores[k+1],vx=bx-ax,vy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*vx+(py-ay)*vy)/(vx*vx+vy*vy||1)));if(hyp(ax+t*vx-px,ay+t*vy-py)<=M.fade)return false;}return true;};
const compOf=(M,F,x,y)=>{const i0=Math.floor((x-F.x0)/FS),j0=Math.floor((y-F.y0)/FS);
  if(i0<0||j0<0||i0>=F.GW||j0>=F.GH)return F.ext;                         // beyond the grid, which already rings every disc with free space: the outside
  for(const [di,dj] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const i=i0+di,j=j0+dj,s=j*F.GW+i;if(i<0||j<0||i>=F.GW||j>=F.GH||F.inU[s])continue;if(segClear(M,x,y,F.X(i),F.Y(j)))return F.comp[s];}
  return null;};
// Ground truth zone (null: the point sits in a sliver finer than the oracle grid; those samples are skipped and counted).
let skipped=0;
const zoneOfComp=(M,F,c,x,y)=>{
  if(c!==F.ext&&c!==F.hubC)return 3;                                       // an enclosed pocket
  if(F.hubC!==F.ext)return c===F.hubC?2:0;                                 // walled in with the hub: zone 2; the outside: nothing
  return hyp(x-M.cx,y-M.cy)<firstEntry(M,x,y)?2:0;                         // open to the outside: zone 2 stops at the first disc on the ray (or the closed boundary across a gap)
};
const truth=(M,x,y)=>{
  if(hyp(x-M.cx,y-M.cy)<M.hub)return 1;if(inDisc(M,x,y))return 3;
  const F=flood(M),c=compOf(M,F,x,y);if(c===null){skipped++;return null;}
  return zoneOfComp(M,F,c,x,y);
};
const hitsDisc=(M,x,y)=>{const dx=x-M.cx,dy=y-M.cy,r=hyp(dx,dy),ux=dx/r,uy=dy/r;
  for(let i=0;i<M.spores.length;i+=2){const px=M.spores[i]-M.cx,py=M.spores[i+1]-M.cy,pr=px*ux+py*uy;if(pr>0&&px*px+py*py-pr*pr<=M.fade*M.fade)return true;}return false;};
const nearest=(M,x,y)=>{let b=1e9,j=-1;for(let i=0;i<M.spores.length/2;i++){const d=dSpore(M,i,x,y);if(d<b){b=d;j=i;}}return j;};
// Any stage point, plus margins, plus polar points so the zone boundaries are well covered.
const cart=fc.record({x:fc.double({min:-150,max:N.w+150,noNaN:true}),y:fc.double({min:-150,max:N.h+150,noNaN:true})});
const polar=fc.record({r:fc.double({min:0,max:700,noNaN:true}),a:fc.double({min:0,max:TAU,noNaN:true})}).map(({r,a})=>({x:N.cx+r*Math.cos(a),y:N.cy+r*Math.sin(a)}));
const inner=fc.record({r:fc.double({min:N.hub-5,max:300,noNaN:true}),a:fc.double({min:0,max:TAU,noNaN:true})}).map(({r,a})=>({x:N.cx+r*Math.cos(a),y:N.cy+r*Math.sin(a)}));
const point=fc.oneof(cart,polar,inner);
const prevSeg=fc.integer({min:-1,max:N.segs.length-1});
// Distance from (x,y) to a segment's centreline measured on the pointer's circle; Infinity if the segment does not reach that radius.
const dist=(s,x,y)=>{const r=rOf(x,y);let d=Infinity;if(r<s.r0||r>s.r1)return d;
  for(let k=0;k<6;k++){const a=s.r[k],b=s.r[k+1];if(a===b||(a-r)*(b-r)>0)continue;const u=(r-a)/(b-a);d=Math.min(d,hyp(s.p[2*k]+u*(s.p[2*k+2]-s.p[2*k])-x,s.p[2*k+1]+u*(s.p[2*k+3]-s.p[2*k+1])-y));}
  return d;};

// A layout with real gaps between buffers: three close pairs, 120 degrees apart. One straight root along +x stands in for the live tree.
const syn=(()=>{
  const cx=600,cy=380,hub=81,sp=[];
  for(const a of [0.5,0.5+TAU/3,0.5+2*TAU/3])for(const o of [-.03,.03])sp.push(cx+300*Math.cos(a+o),cy+300*Math.sin(a+o));
  const seg={id:0,parent:-1,a:90,p:[0,1,2,3,4,5,6].flatMap(i=>[cx+i*50,cy]),r:[0,50,100,150,200,250,300],r0:0,r1:300,t:[0,17,33,50,67,83,100]};
  const z=computeZones(sp,cx,cy,hub,[seg]);
  return {w:1200,h:760,cx,cy,hub,fade:z.B,n:z.n,rin:z.rin,rout:z.rout,holes:z.holes,spores:sp,segs:[seg],dormant:z.dormant};
})();
const synPoint=fc.record({r:fc.double({min:0,max:420,noNaN:true}),a:fc.double({min:0,max:TAU,noNaN:true})}).map(({r,a})=>({x:syn.cx+r*Math.cos(a),y:syn.cy+r*Math.sin(a)}));

test('every point lands in exactly one zone, and a result names at most one segment or spore',()=>check(fc.property(point,prevSeg,({x,y},prev)=>{
  const s=pick(N,x,y,prev);
  assert([0,1,2,3].includes(s.zone),'zone '+s.zone);
  if(s.zone===2){assert(Number.isInteger(s.seg)&&s.seg>=0&&s.seg<N.segs.length);assert.equal(s.spore,undefined);}
  else if(s.zone===3){assert(Number.isInteger(s.spore)&&s.spore>=0&&s.spore<nSpores);assert.equal(s.seg,undefined);assert.equal(s.stop,undefined);}
  else assert.deepEqual(Object.keys(s),['zone']);
  const t=truth(N,x,y);if(t!==null)assert.equal(s.zone,t,'(x,y)=('+x+','+y+')');
})));
test('zone 1 is exactly the hub disc',()=>check(fc.property(point,prevSeg,({x,y},prev)=>{
  assert.equal(pick(N,x,y,prev).zone===1,rOf(x,y)<N.hub);
})));
test('any point within B of any circle is zone 3 and snaps to the nearest circle',()=>check(fc.property(fc.integer({min:0,max:nSpores-1}),fc.double({min:0,max:N.fade-1e-6,noNaN:true}),fc.double({min:0,max:TAU,noNaN:true}),prevSeg,(i,d,a,prev)=>{
  const [sx,sy]=sporeAt(N,i),x=sx+d*Math.cos(a),y=sy+d*Math.sin(a);
  if(rOf(x,y)<N.hub)return;
  const s=pick(N,x,y,prev);
  assert.equal(s.zone,3);
  assert(dSpore(N,s.spore,x,y)<=dSpore(N,nearest(N,x,y),x,y)+1e-9,'not the nearest circle');
})));
test('every zone-3 snap is the nearest circle (buffers and pockets alike)',()=>check(fc.property(point,({x,y})=>{
  const s=pick(N,x,y,-1);
  if(s.zone===3)assert(dSpore(N,s.spore,x,y)<=dSpore(N,nearest(N,x,y),x,y)+1e-9);
})));
test('hub edge to the inner boundary is zone 2 wherever it is outside the buffers, and zone 2 never touches a buffer',()=>check(fc.property(inner,prevSeg,({x,y},prev)=>{
  const r=rOf(x,y),s=pick(N,x,y,prev);
  if(r>=N.hub&&truth(N,x,y)===2)assert.equal(s.zone,2,'hole in zone 2 at ('+x+','+y+')');
  if(s.zone===2)assert(!inDisc(N,x,y),'zone 2 inside a buffer');
})));
test('gaps between buffers are closed: rays that hit no buffer still get a zone 2 that stops at the interpolated inner boundary',()=>check(fc.property(synPoint,({x,y})=>{
  assert.equal(syn.dormant,'');
  const r=hyp(x-syn.cx,y-syn.cy),s=pick(syn,x,y,-1);
  if(r<syn.hub)return assert.equal(s.zone,1);
  const rin=interp(syn,syn.rin,x,y),t=truth(syn,x,y);
  if(t!==null)assert.equal(s.zone,t,'at r='+r);
  if(s.zone===2)assert(!hitsDisc(syn,x,y)?r<rin:true,'zone 2 leaked past the closed inner boundary');
  if(!hitsDisc(syn,x,y)&&r>=rin&&!inDisc(syn,x,y))assert.equal(s.zone,0,'zone 3 extended across a gap');
})));
test('the synthetic layout really has gap rays (the test above is not vacuous)',()=>{
  let gaps=0;
  for(let k=0;k<720;k++){const ux=Math.cos(TAU*k/720),uy=Math.sin(TAU*k/720);
    if(!syn.spores.some((_,i)=>{if(i%2)return false;const px=syn.spores[i]-syn.cx,py=syn.spores[i+1]-syn.cy,pr=px*ux+py*uy;return pr>0&&px*px+py*py-pr*pr<=syn.fade**2;}))gaps++;}
  assert(gaps>300,'gap rays: '+gaps);
});
test('inner boundary samples equal the exact first buffer entry along the ray (rays that hit)',()=>{
  for(let k=0;k<N.n;k++){
    const ux=Math.cos(TAU*k/N.n),uy=Math.sin(TAU*k/N.n);let lo=Infinity;
    for(let i=0;i<nSpores;i++){const px=N.spores[2*i]-N.cx,py=N.spores[2*i+1]-N.cy,pr=px*ux+py*uy,q=px*px+py*py-pr*pr;if(pr>0&&q<=N.fade**2)lo=Math.min(lo,pr-Math.sqrt(N.fade**2-q));}
    assert(Math.abs(lo-N.rin[k])<=.1,'ray '+k+': exact '+lo+' shipped '+N.rin[k]);
  }
});
test('past the first buffer on a ray: an enclosed pocket is zone 3, a notch or anything else open to the outside is nothing (exact at the point, no sliver)',()=>check(fc.property(polar,({x,y})=>{
  const r=rOf(x,y),s=pick(N,x,y,-1);
  if(inDisc(N,x,y)||r<N.hub)return;
  const t=truth(N,x,y);if(t!==null)assert.equal(s.zone,t,'pocket / notch / outside at ('+x+','+y+')');
})));
test('the oracle skips almost nothing (a point it cannot place sits in a sliver under its 0.5-unit grid)',()=>{
  skipped=0;let n=0;for(const {x,y} of fc.sample(point,20000)){if(rOf(x,y)>=N.hub&&!inDisc(N,x,y)){n++;truth(N,x,y);}}
  assert(skipped<=n*.002,'skipped '+skipped+' of '+n);
});
// Fine-grid ground truth: every 1-unit cell centre of the stage, pick() against the raw-geometry truth, and the zone adjacency rules.
const deg=Math.PI/180,pol=(r,a)=>[600+r*Math.cos(a),380+r*Math.sin(a)],pair=(r,a,d)=>{const o=d/2/r;return [...pol(r,a-o),...pol(r,a+o)];};
const mkSyn=sp=>{const cx=600,cy=380,hub=81,seg={id:0,parent:-1,a:90,p:[0,1,2,3,4,5,6].flatMap(i=>[cx+i*120,cy]),r:[0,120,240,360,480,600,720],r0:0,r1:720,t:[0,17,33,50,67,83,100]},z=computeZones(sp,cx,cy,hub,[seg]);
  return {w:1200,h:760,cx,cy,hub,fade:z.B,n:z.n,rin:z.rin,rout:z.rout,holes:z.holes,spores:sp,segs:[seg],dormant:z.dormant};};
const ring=(r,step,d)=>{const o=[];for(let a=-180;a<180;a+=step)o.push(...pair(r,a*deg,d));return o;};
const ringN=(r,k)=>Array.from({length:k},(_,i)=>pol(r,TAU*i/k)).flat(),loop=(x,y,r,k)=>Array.from({length:k},(_,i)=>[x+r*Math.cos(TAU*i/k),y+r*Math.sin(TAU*i/k)]).flat();
const layouts={
  real:N,
  threePairs:syn,
  nonStar:mkSyn([...pair(140,0,30),...ring(320,20,30)]),   // a close pair in front of a ring: rays through the pair continue to the ring
  spike:mkSyn([...pair(200,0,40),...pair(200,90*deg,40),...pair(200,180*deg,40),...pair(200,270*deg,40),...pair(400,45*deg,40)]),
  wrap:mkSyn([...pair(250,0.2*deg,40),...pair(250,-1*deg,40),...pair(250,120*deg,40),...pair(250,240*deg,40)]),
  // walled in: a closed ring (spacing 40, so B = 40 and the discs overlap), a close pair in front of it (the hub's own region runs on behind it), and a loop of 10 circles
  // fused to the ring outside it (an enclosed pocket in the loop, outward notches where loop and ring meet)
  walled:mkSyn([...ringN(300,47),...pair(160,0,40),...loop(1015,380,40/(2*Math.sin(Math.PI/10)),10)]),
};
const lastExit=(M,x,y)=>{const dx=x-M.cx,dy=y-M.cy,r=hyp(dx,dy),ux=dx/r,uy=dy/r;let hi=-Infinity;
  for(let i=0;i<M.spores.length;i+=2){const px=M.spores[i]-M.cx,py=M.spores[i+1]-M.cy,pr=px*ux+py*uy,q=px*px+py*py-pr*pr;if(pr>0&&q<=M.fade**2)hi=Math.max(hi,pr+Math.sqrt(M.fade**2-q));}return hi;};
// Every oracle grid point inside the stage (0.5 units on the real layout, 1 unit on the synthetic ones): pick() must equal the flood-fill truth there, exactly.
// Also counted: the points a radial first-entry/last-exit rule gets wrong (notches open to the outside, the hub's region behind a buffer) and pocket points, so the check is not vacuous.
const scan=(M,stride)=>{
  const F=flood(M),i0=Math.ceil(-F.x0/FS-.5),j0=Math.ceil(-F.y0/FS-.5),cols=Math.floor((M.w-F.x0)/FS-.5)-i0+1,rows=Math.floor((M.h-F.y0)/FS-.5)-j0+1,g=new Int8Array(cols*rows).fill(-1);
  let bad=0,first=null,notch=0,shadow=0,pocket=0,cells=0;
  for(let j=0;j<rows;j+=stride)for(let i=0;i<cols;i+=stride){const s=(j+j0)*F.GW+i+i0,x=F.X(i+i0),y=F.Y(j+j0),r=rOf(x,y);
    const t=r<M.hub?1:F.inU[s]?3:zoneOfComp(M,F,F.comp[s],x,y),z=pick(M,x,y,-1).zone;g[j*cols+i]=z;cells++;
    if(z!==t){bad++;first??=[x,y,z,t];}
    if(r>=M.hub&&!F.inU[s]&&r>=firstEntry(M,x,y)){const c=F.comp[s];if(c!==F.ext&&c!==F.hubC)pocket++;else if(c===F.hubC&&F.hubC!==F.ext)shadow++;else if(r<=lastExit(M,x,y))notch++;}}
  let adj20=0,adj13=0;
  for(let j=0;j<rows;j+=stride)for(let i=0;i<cols;i+=stride)for(const [di,dj] of [[stride,0],[0,stride]]){const a=i+di,b=j+dj;if(a>=cols||b>=rows)continue;
    const u=g[j*cols+i],v=g[b*cols+a];
    if((u===1&&v===3)||(u===3&&v===1))adj13++;
    if((u===2&&v===0)||(u===0&&v===2))adj20++;}
  return {cells,bad,first,adj20,adj13,walled:F.hubC!==F.ext,components:F.nc,notch,shadow,pocket};
};
for(const [name,M] of Object.entries(layouts))test('fine-grid ground truth ('+name+'): 0 mismatches vs the flood-fill oracle; zone 1 never touches zone 3; where the hub is walled in, zone 2 never touches zone 0',()=>{
  assert.equal(M.dormant,'');
  const t=performance.now(),r=scan(M,name==='real'?1:2);console.log('# grid '+name+' '+Math.round(performance.now()-t)+' ms '+JSON.stringify(r));
  assert.equal(r.bad,0,'mismatches, first (x,y,pick,truth): '+r.first);assert.equal(r.adj13,0,'zone 1 touches zone 3');
  if(r.walled)assert.equal(r.adj20,0,'zone 2 touches zone 0');   // open layouts: zone 2 meets nothing across a gap's closed boundary and beside a notch by design (it must not leak outward)
  if(name==='real')assert(r.walled&&r.notch>=300&&r.pocket>0,'the real layout is walled in and has an enclosed pocket and outward notches: '+JSON.stringify(r));
  if(name==='walled')assert(r.walled&&r.notch>0&&r.shadow>0&&r.pocket>0,'the walled layout exercises notches, the hub region behind a buffer and a pocket: '+JSON.stringify(r));
});

test('the lit stop is a percentage in [0,100]',()=>check(fc.property(inner,prevSeg,({x,y},prev)=>{
  const s=pick(N,x,y,prev);
  if(s.zone===2)assert(Number.isFinite(s.stop)&&s.stop>=0&&s.stop<=100,'stop '+s.stop);
})));
test('a dead-end strip is never picked, and a snapped spore never has one on its path',()=>check(fc.property(point,prevSeg,({x,y},prev)=>{
  const s=pick(N,x,y,prev);
  if(s.zone===2)assert(!N.dead.includes(N.segs[s.seg].id),'dead strip '+N.segs[s.seg].id);
  if(s.zone===3)for(const id of N.paths[s.spore].split(' ').map(Number))assert(!N.dead.includes(id));
})));
test('all 106 circle centres are zone 3 and snap to themselves',()=>{
  assert.equal(nSpores,106);
  for(let i=0;i<nSpores;i++){const [x,y]=sporeAt(N,i);assert.deepEqual(pick(N,x,y,-1),{zone:3,spore:i},'circle '+i);}
});
test('a pointer within a few units of a circle centre still snaps to that circle',()=>check(fc.property(fc.integer({min:0,max:nSpores-1}),fc.double({min:0,max:2,noNaN:true}),fc.double({min:0,max:TAU,noNaN:true}),(i,d,a)=>{
  const [cx,cy]=sporeAt(N,i);
  assert.deepEqual(pick(N,cx+d*Math.cos(a),cy+d*Math.sin(a),-1),{zone:3,spore:i});
})));
test('pick is deterministic',()=>check(fc.property(point,prevSeg,({x,y},prev)=>{
  assert.deepEqual(pick(N,x,y,prev),pick(N,x,y,prev));
})));
test('continuity: small pointer moves only change root by switching to a strictly nearer branch (hysteresis prev)',()=>check(fc.property(inner,fc.double({min:0,max:TAU,noNaN:true}),(start,heading)=>{
  let {x,y}=start,prev=-1,last=pick(N,x,y,prev);
  prev=last.zone===2?last.seg:-1;
  for(let step=0;step<60;step++){
    x+=Math.cos(heading);y+=Math.sin(heading);   // 1 stage unit per move
    const s=pick(N,x,y,prev);
    if(s.zone===2&&prev>=0&&rootOf(s.seg)!==rootOf(prev)){
      assert(dist(N.segs[s.seg],x,y)<dist(N.segs[prev],x,y),'jumped from root of '+N.segs[prev].id+' to a farther strip '+N.segs[s.seg].id+' at ('+x.toFixed(1)+','+y.toFixed(1)+')');
    }
    prev=s.zone===2?s.seg:-1;
  }
})));
test('continuity: one 1-unit move from a lit strip never switches root when the pointer is on that strip',()=>check(fc.property(fc.integer({min:0,max:N.segs.length-1}),fc.integer({min:0,max:6}),fc.double({min:0,max:TAU,noNaN:true}),(i,k,a)=>{
  const sg=N.segs[i];if(N.dead.includes(sg.id))return;
  const x=sg.p[2*k],y=sg.p[2*k+1],here=pick(N,x,y,i);   // standing on the strip's own centreline with it as prev
  if(here.zone!==2)return;
  const s=pick(N,x+Math.cos(a),y+Math.sin(a),here.seg);
  if(s.zone===2)assert.equal(rootOf(s.seg),rootOf(here.seg),'root changed after a 1-unit move');
}),{numRuns:300}));

// Dormancy: the layout must keep every buffer (radius B = mean nearest-neighbour spacing) clear of the hub.
const clearOf=sp=>{   // independent oracle: min over circles of dist - B - hub
  const m=sp.length/2;let sum=0;
  for(let i=0;i<m;i++){let d=1e9;for(let j=0;j<m;j++)if(j!==i)d=Math.min(d,hyp(sp[2*i]-sp[2*j],sp[2*i+1]-sp[2*j+1]));sum+=d;}
  const B=sum/m;return Math.min(...Array.from({length:m},(_,i)=>hyp(sp[2*i]-N.cx,sp[2*i+1]-N.cy)-B-N.hub));
};
const ANY=[{r0:0,r1:1e9}];   // isolates the buffer/hub rule from the root-coverage rule
test('dormant: moving one circle inward, or shrinking the spacing, is dormant exactly when a buffer reaches the hub; others are not',()=>check(fc.property(
  fc.integer({min:0,max:nSpores-1}),fc.double({min:0,max:420,noNaN:true}),fc.double({min:0,max:TAU,noNaN:true}),fc.double({min:.3,max:1.6,noNaN:true}),fc.boolean(),
  (i,r,a,scale,move)=>{
    const sp=[...N.spores];
    if(move){sp[2*i]=Math.round((N.cx+r*Math.cos(a))*10)/10;sp[2*i+1]=Math.round((N.cy+r*Math.sin(a))*10)/10;}
    else for(let k=0;k<sp.length;k+=2){sp[k]=Math.round((N.cx+(sp[k]-N.cx)*scale)*10)/10;sp[k+1]=Math.round((N.cy+(sp[k+1]-N.cy)*scale)*10)/10;}
    const c=clearOf(sp);if(Math.abs(c)<.2)return;   // a tie within rounding of B
    assert.equal(!!computeZones(sp,N.cx,N.cy,N.hub,ANY).dormant,c<0,'clearance '+c.toFixed(2));
  })));
test('dormant: the shipped layout is fine; a circle moved inside the hub buffer, or a layout that outgrows the live roots, is dormant with a plain reason',()=>{
  assert.equal(computeZones(N.spores,N.cx,N.cy,N.hub,N.segs).dormant,'');
  const sp=[...N.spores];sp[0]=N.cx+100;sp[1]=N.cy;
  assert(/reaches the hub/.test(computeZones(sp,N.cx,N.cy,N.hub,N.segs).dormant));
  const out=N.spores.map((v,k)=>k%2?N.cy+(v-N.cy)*1.5:N.cx+(v-N.cx)*1.5);   // buffers clear of the hub, but zone 2 now reaches radii no live root covers
  assert(/no live root crossing/.test(computeZones(out,N.cx,N.cy,N.hub,N.segs).dormant));
});

// Budgets.
test('pick() costs under 0.1 ms per call (median over 10000 random points)',()=>{
  const pts=fc.sample(point,10000),prevs=fc.sample(prevSeg,10000),ts=[];
  for(let i=0;i<pts.length;i++){const t=performance.now();pick(N,pts[i].x,pts[i].y,prevs[i]);ts.push(performance.now()-t);}
  ts.sort((a,b)=>a-b);
  console.log('# pick median '+(ts[5000]*1000).toFixed(2)+' us, p99 '+(ts[9900]*1000).toFixed(2)+' us');
  assert(ts[5000]<.1,'median '+ts[5000]+' ms');
});

// Touch: the tap state machine (pure). Each tap is a circle that a pick() said zone 3 for, a zone 0/1/2 point, or a direct hit on a circle/link (null: the site opens it).
const tapOf=fc.oneof(fc.integer({min:0,max:3}).map(i=>({zone:3,spore:i})),fc.constantFrom({zone:0},{zone:1},{zone:2,seg:0,stop:50}),fc.constant(null));
const run=taps=>{let prev=-1;const out=[];for(const z of taps){const r=tap(prev,z);out.push({prev0:prev,z,...r});prev=r.prev;}return out;};
test('tap: a tap opens only when it lands on the circle that is already previewed; otherwise it previews or clears',()=>check(fc.property(fc.array(tapOf,{maxLength:40}),taps=>{
  for(const s of run(taps)){
    if(s.open){assert(s.z&&s.z.zone===3&&s.z.spore===s.prev0&&s.prev0>=0,'opened without a matching preview');assert.equal(s.prev,-1,'opening clears the preview');}
    else if(s.z&&s.z.zone===3){assert.equal(s.prev,s.z.spore,'an empty-space tap previews its snapped circle');assert.notEqual(s.z.spore,s.prev0);}
    else assert.equal(s.prev,-1,'a tap elsewhere, or on a circle, clears the preview');
  }
})));
test('tap: two taps in the same snap area open it; a third previews again (never two opens in a row); any other tap in between clears',()=>check(fc.property(fc.integer({min:0,max:105}),tapOf,(i,other)=>{
  const z={zone:3,spore:i};
  assert.deepEqual(run([z,z]).map(s=>s.open),[false,true]);
  assert.deepEqual(run([z,z,z]).map(s=>s.open),[false,true,false]);
  if(!(other&&other.zone===3&&other.spore===i))assert.deepEqual(run([z,other,z]).map(s=>s.open),[false,false,false]);
})));
test('tap + pick: only taps that pick() puts in zone 3 ever preview or open; hub, zone-2 and outside taps clear',()=>check(fc.property(point,({x,y})=>{
  const z=pick(N,x,y,-1),r=tap(-1,z);
  assert.equal(r.open,false);
  assert.equal(r.prev,z.zone===3?z.spore:-1);
  const again=tap(r.prev,z);assert.equal(again.open,z.zone===3);
})));
