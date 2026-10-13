/** Optional Network hover behavior for the separate taste experience.
 * extractNetwork() reads the generated network markup at build time; pick() and run()
 * are shipped verbatim (Function#toString) so tests exercise the browser code.
 */
import assert from 'node:assert/strict';

const W=1200,H=760,r1=v=>Math.round(v*10)/10,hyp=Math.hypot;
const HINT=' If the Network was deliberately edited, update the source geometry mapping in source/taste/taste-network.mjs and independently verify the corresponding paths and dead zones.';

export function extractNetwork(html){
  const a=html.indexOf('<div class="net__stage"'),b=html.indexOf('<details class="net__list"');
  assert(a>0&&b>a,'Network stage markup changed (no net__stage / net__list found).'+HINT);
  const stage=html.slice(a,b);
  assert(stage.includes('style="aspect-ratio:1200 / 760"'),'Network stage aspect changed from 1200 / 760.'+HINT);
  assert(/\.net__hub\s*\{[^}]*width:\s*13\.5%;\s*aspect-ratio:\s*1;/.test(html),'Network hub is no longer 13.5% wide and circular.'+HINT);
  const cx=W/2,cy=H/2,hub=r1(W*.135/2);
  const strips=new Map(),inMarkup=stage.split('<i id="hy-').length-1;
  for(const m of stage.matchAll(/<i id="hy-(\d+)" style="left:(-?[\d.]+)%;top:(-?[\d.]+)%;width:(-?[\d.]+)%;height:(-?[\d.]+)%;clip-path:polygon\(([^)]*)\)"/g)){
    const [bx,by,bw,bh]=[m[2]*W/100,m[3]*H/100,m[4]*W/100,m[5]*H/100];
    const q=m[6].split(',').map(s=>s.trim().split(/\s+/).map(parseFloat));
    assert.equal(q.length,14,'strip '+m[1]+' is not a 14-point polygon.'+HINT);
    const pt=([px,py])=>[bx+bw*px/100,by+bh*py/100],P=q.map(pt);
    // centreline: midpoints of paired edges (point i with point 13-i), tip end last once oriented
    strips.set(+m[1],{id:+m[1],box:[bx,by,bw,bh],c:[0,1,2,3,4,5,6].map(i=>[(P[i][0]+P[13-i][0])/2,(P[i][1]+P[13-i][1])/2]),P});
  }
  if(strips.size!==inMarkup){const bad=[...stage.matchAll(/<i id="hy-(\d+)"[^>]*>/g)].find(m=>!strips.has(+m[1]));assert.fail('markup has '+inMarkup+' strips but only '+strips.size+' parse; first unparseable: '+(bad?bad[0].slice(0,160):'?')+'.'+HINT);}
  assert.equal(strips.size,150,'expected 150 network strips, found '+strips.size+'.'+HINT);
  const sporesInMarkup=stage.split('class="spore').length-1;
  const spores=[...stage.matchAll(/<button class="spore[^>]*style="left:(-?[\d.]+)%;top:(-?[\d.]+)%"[^>]*data-path="([^"]*)"/g)].map(m=>({x:m[1]*W/100,y:m[2]*H/100,path:m[3].split(' ').map(Number),key:m[3]}));
  assert.equal(spores.length,sporesInMarkup,'markup has '+sporesInMarkup+' spores but only '+spores.length+' parse.'+HINT);
  assert.equal(spores.length,106,'expected 106 network spores, found '+spores.length+'.'+HINT);
  // Strict tree: every strip has one parent across all paths.
  const parentOf=new Map();
  for(const s of spores)s.path.forEach((id,k)=>{
    assert(strips.has(id),'path names missing strip '+id+'.'+HINT);
    const p=k?s.path[k-1]:-1;
    assert(!parentOf.has(id)||parentOf.get(id)===p,'strip '+id+' has two parents.'+HINT);
    parentOf.set(id,p);
  });
  const keys=new Set(spores.map(s=>s.key));
  const first=spores.filter(s=>!s.path.slice(0,-1).some((_,k)=>keys.has(s.path.slice(0,k+1).join(' '))));
  // Inner tree = the strips on first spores' paths; parents precede children.
  const order=[];
  for(const s of first)for(const id of s.path)if(!order.includes(id))order.push(id);
  const index=new Map(order.map((id,i)=>[id,i])),segs=[];
  let maxGap=0,worst=-1;
  for(const id of order){
    const st=strips.get(id),parent=index.has(parentOf.get(id))?index.get(parentOf.get(id)):-1;
    let c=st.c;
    const ref=parent<0?[cx,cy]:[segs[parent].p[12],segs[parent].p[13]];
    if(hyp(c[0][0]-ref[0],c[0][1]-ref[1])>hyp(c[6][0]-ref[0],c[6][1]-ref[1]))c=[...c].reverse();
    const gap=parent<0?Math.max(0,hyp(c[0][0]-cx,c[0][1]-cy)-hub):hyp(c[0][0]-ref[0],c[0][1]-ref[1]);
    if(gap>maxGap){maxGap=gap;worst=id;}
    const p=c.flat().map(r1),pts=[0,1,2,3,4,5,6].map(i=>[p[2*i],p[2*i+1]]);
    const r=pts.map(([x,y])=>r1(hyp(x-cx,y-cy)));
    if(parent>=0&&r[0]>segs[parent].r[6])r[0]=segs[parent].r[6];   // ponytail: a child may start ~1 unit past its parent's tip; clamp so no pointer radius falls in that sliver (no crossing there would hand the light to another root)
    // CSS gradient angle along the segment's own chord; t = position of each centreline point on the gradient line.
    const dx=pts[6][0]-pts[0][0],dy=pts[6][1]-pts[0][1],n=hyp(dx,dy),sin=dx/n,cos=-dy/n;
    const [bx,by,bw,bh]=st.box,len=Math.abs(bw*sin)+Math.abs(bh*cos);
    const t=pts.map(([x,y])=>r1(50+100*((x-bx-bw/2)*sin+(y-by-bh/2)*-cos)/len));
    segs.push({id,parent,a:r1(Math.atan2(dx,-dy)*180/Math.PI),p,r,r0:Math.min(...r),r1:Math.max(...r),t});
  }
  assert(maxGap<6,'strip hy-'+worst+' join gap '+maxGap.toFixed(1)+' exceeds 6 stage units (2.1 when pinned).'+HINT);
  const onPath=new Set(spores.flatMap(s=>s.path)),dead=[...strips.keys()].filter(id=>!onPath.has(id)).sort((u,v)=>u-v);   // strips no spore path runs through: never lit
  // Paint order: the site draws strips in markup order, so a later strip covers an earlier one where they overlap (the root strips fan out from the hub on top of each other). A lit twin sits above every base strip, so for each live strip the later strips that overlap it by at least 1 square unit are listed:
  // the overlay repeats those as occluders (the strip in its idle look, from the site's own rule) while the earlier one is lit. Sampled on a 0.5 unit grid.
  const sOrder=[...strips.values()],inside=(P,x,y)=>{let c=false;for(let i=0,j=P.length-1;i<P.length;j=i++){const [xi,yi]=P[i],[xj,yj]=P[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
  const bb=P=>[Math.min(...P.map(p=>p[0])),Math.min(...P.map(p=>p[1])),Math.max(...P.map(p=>p[0])),Math.max(...P.map(p=>p[1]))];
  for(const s of sOrder)s.bb=bb(s.P);
  const occ={};
  for(let a=0;a<sOrder.length;a++){const A=sOrder[a];if(!onPath.has(A.id))continue;
    for(let b=a+1;b<sOrder.length;b++){const B=sOrder[b],x0=Math.max(A.bb[0],B.bb[0]),y0=Math.max(A.bb[1],B.bb[1]),x1=Math.min(A.bb[2],B.bb[2]),y1=Math.min(A.bb[3],B.bb[3]);if(x0>=x1||y0>=y1)continue;
      let n=0;for(let x=x0;x<x1;x+=.5)for(let y=y0;y<y1;y+=.5)if(inside(A.P,x,y)&&inside(B.P,x,y))n++;
      if(n*.25>=1)(occ[A.id]??=[]).push(B.id);}}
  const sp=spores.flatMap(s=>[r1(s.x),r1(s.y)]),z=computeZones(sp,cx,cy,hub,segs);   // segs are the live roots: dead-end strips never enter the tree
  return {w:W,h:H,cx,cy,hub,fade:z.B,dead,occ,segs,n:z.n,rin:z.rin,rout:z.rout,holes:z.holes,spores:sp,paths:spores.map(s=>s.key),maxGap:r1(maxGap),clearance:z.clearance,uncovered:z.uncovered,dormant:z.dormant};
}

// Build time: the boundary of the union of the radius-B discs, as closed cycles of arcs (each arc runs anticlockwise round its own centre with the union on its left).
// A cycle with negative area is a hole: a region outside every disc that the discs wall in. The smallest hole round the centre is the hub's own region; every other hole is an enclosed pocket.
// A hole is kept as its chord polygon (the arc end points, full precision): for any point outside every disc the chords wind round it exactly as the arcs do (an arc never leaves its own disc and subtends under 180 degrees from outside it), so the pocket test in pick() is exact, not a raster.
// Holes are sorted smallest first, so the first one that winds round a point is the region that point is in. top = the farthest radius of the hub's region (Infinity when the discs leave it open to the outside).
function holesOf(sp,B,cx,cy){
  const m=sp.length/2,TAU=2*Math.PI,arcs=[],at=(a,t)=>[a.X+B*Math.cos(t),a.Y+B*Math.sin(t)];
  for(let i=0;i<m;i++){
    const X=sp[2*i],Y=sp[2*i+1],iv=[];let twin=false;
    for(let j=0;j<m;j++){if(j===i)continue;const dx=sp[2*j]-X,dy=sp[2*j+1]-Y,d=hyp(dx,dy);
      if(d===0){twin||=j<i;continue;}                    // two circles on one spot: the first one stands for both
      if(d>=2*B)continue;
      const a=(Math.atan2(dy,dx)+TAU)%TAU,h=Math.acos(d/(2*B));   // the arc of circle i inside disc j
      if(a-h<0)iv.push([a-h+TAU,TAU],[0,a+h]);else if(a+h>TAU)iv.push([a-h,TAU],[0,a+h-TAU]);else iv.push([a-h,a+h]);}
    if(twin||!iv.length)continue;                         // an isolated circle bounds no hole
    iv.sort((p,q)=>p[0]-q[0]);
    const free=[];let end=0;for(const [s,e] of iv){if(s>end)free.push([end,s]);end=Math.max(end,e);}if(end<TAU)free.push([end,TAU]);
    if(free.length>1&&free[0][0]===0&&free.at(-1)[1]===TAU){const l=free.pop();free[0]=[l[0],free[0][1]+TAU];}
    for(const [s,e] of free)arcs.push({X,Y,s,e});
  }
  for(const a of arcs){a.p=at(a,a.s);a.q=at(a,a.e);}
  for(const a of arcs){let d=Infinity;for(const b of arcs){const e=hyp(b.p[0]-a.q[0],b.p[1]-a.q[1]);if(e<d&&b.from===undefined){d=e;a.next=b;}}   // an arc ends where the next one starts, on the circle that covers it from there
    assert(a.next&&d<1e-6*B,'The circle buffers meet in a degenerate way (three circles through one point, or two exactly touching); their boundary cannot be traced exactly.'+HINT);a.next.from=a;}
  const holes=[];
  for(const a0 of arcs){if(a0.done)continue;const cyc=[];for(let a=a0;!a.done;a=a.next){a.done=true;cyc.push(a);}
    let area=0;for(const a of cyc)area+=(B*a.X*(Math.sin(a.e)-Math.sin(a.s))-B*a.Y*(Math.cos(a.e)-Math.cos(a.s))+B*B*(a.e-a.s))/2;
    if(area<0)holes.push({area:-area,cyc,v:cyc.flatMap(a=>a.p)});}
  holes.sort((p,q)=>p.area-q.area);
  const hubHole=holes.find(h=>windsRound(h.v,cx,cy));let top=Infinity;
  if(hubHole){top=0;for(const a of hubHole.cyc){top=Math.max(top,hyp(a.p[0]-cx,a.p[1]-cy));const f=Math.atan2(a.Y-cy,a.X-cx),k=Math.ceil((a.s-f)/TAU),g=f+k*TAU;if(g<=a.e)top=Math.max(top,hyp(a.X-cx,a.Y-cy)+B);}}   // farthest point of an arc: an end, or straight out from the centre through its own circle
  return {holes:holes.map(h=>({hub:h===hubHole?1:0,v:h.v})),top};
}
// Winding number of a polygon (flat x,y list) round (x,y), non-zero when inside; the same test is inlined in pick().
function windsRound(v,x,y){let w=0;for(let k=0,n=v.length;k<n;k+=2){const x0=v[k],y0=v[k+1],x1=v[(k+2)%n],y1=v[(k+3)%n],s=(x1-x0)*(y-y0)-(x-x0)*(y1-y0);if(y0<=y){if(y1>y&&s>0)w++;}else if(y1<=y&&s<0)w--;}return w!==0;}

// Build time: Jonathan's zone rules. B = mean nearest-neighbour spacing = every spore's buffer radius (and the outer feather).
// Zone 1 = hub disc. Zone 3 = union of the radius-B discs plus the pockets they enclose (holes, see holesOf); a notch open to the outside is nothing.
// Zone 2 = the hub's own region: hub edge out to the first disc along each ray (rin, per half degree, for the zone map and gap rays) and, where the discs wall the hub in, everything they wall in with it.
// Where rays slip through gaps between discs to the outside, zone 2 is closed across the gap by interpolating rin from the nearest hitting rays, so it never leaks outward. rout = outer extent of the union (zone map only).
// Dormant (non-empty string) when a buffer reaches the hub or zone 2 has a radius with no live root crossing: the whole feature then stays out.
export function computeZones(sp,cx,cy,hub,live){
  const n=720,m=sp.length/2;
  let sum=0;for(let i=0;i<m;i++){let d=1e9;for(let j=0;j<m;j++)if(j!==i)d=Math.min(d,hyp(sp[2*i]-sp[2*j],sp[2*i+1]-sp[2*j+1]));sum+=d;}
  const B=r1(sum/m);
  let clearance=1e9,near=-1;for(let i=0;i<m;i++){const c=hyp(sp[2*i]-cx,sp[2*i+1]-cy)-B-hub;if(c<clearance){clearance=c;near=i;}}
  const rin=Array(n).fill(null),rout=Array(n).fill(null);
  for(let k=0;k<n;k++){
    const ux=Math.cos(2*Math.PI*k/n),uy=Math.sin(2*Math.PI*k/n);let lo=1e9,hi=-1;
    for(let i=0;i<m;i++){const px=sp[2*i]-cx,py=sp[2*i+1]-cy,pr=px*ux+py*uy,q=px*px+py*py-pr*pr;if(pr<=0||q>B*B)continue;const h=Math.sqrt(B*B-q);lo=Math.min(lo,pr-h);hi=Math.max(hi,pr+h);}
    if(hi>=0){rin[k]=lo;rout[k]=hi;}
  }
  for(const a of [rin,rout])if(a.some(v=>v===null)){const src=[...a];for(let k=0;k<n;k++)if(src[k]===null){   // a gap between buffers: close it from its nearest hitting rays
    let u=1,v=1;while(src[(k-u+n)%n]===null&&u<n)u++;while(src[(k+v)%n]===null&&v<n)v++;
    const l=src[(k-u+n)%n],h=src[(k+v)%n];a[k]=l===null?hub:l+(h-l)*u/(u+v);
  }}
  for(const a of [rin,rout])a.forEach((v,k)=>{a[k]=r1(v);});
  const H=holesOf(sp,B,cx,cy);
  let cur=hub;const uncovered=[],top=Math.max(...rin,H.top<Infinity?H.top:0);   // zone 2 needs a live root crossing at every radius it reaches
  for(const [a,b] of live.map(s=>[s.r0,s.r1]).sort((p,q)=>p[0]-q[0])){if(a>cur&&cur<top)uncovered.push([r1(cur),r1(Math.min(a,top))]);cur=Math.max(cur,b);}
  if(cur<top)uncovered.push([r1(cur),r1(top)]);
  const dormant=clearance<0?'Spore '+near+' sits '+r1(hyp(sp[2*near]-cx,sp[2*near+1]-cy))+' units from the centre; its buffer (B='+B+') reaches the hub (radius '+hub+') by '+r1(-clearance)+' units, so zone 3 would overlap zone 1.'
    :uncovered.length?'Zone 2 has no live root crossing at radius '+uncovered.map(g=>g.join(' to ')).join(', ')+'.':'';
  return {n,B,clearance:r1(clearance),rin,rout,holes:H.holes,uncovered,dormant};
}

// For tests and the dormant verification: the markup with spore i moved to (x,y) stage units.
export function withSporeAt(html,i,x,y){
  let k=-1;return html.replace(/(<button class="spore[^>]*style="left:)-?[\d.]+%;top:-?[\d.]+%/g,(m,pre)=>++k===i?pre+(x*100/W).toFixed(4)+'%;top:'+(y*100/H).toFixed(4)+'%':m);
}

// Browser: what the pointer at stage units (x,y) means. prev = current tip segment (hysteresis).
export function pick(N,x,y,prev){
  const dx=x-N.cx,dy=y-N.cy,r=Math.hypot(dx,dy);
  if(r<N.hub)return {zone:1};
  const ux=dx/r,uy=dy/r,B2=N.fade*N.fade;
  let best=1e9,spore=-1,lo=1e9;                       // nearest spore (inside any spore's buffer disc, radius fade: zone 3) and this very ray's exact first entry into the discs
  for(let i=0;i<N.spores.length;i+=2){const px=N.spores[i]-N.cx,py=N.spores[i+1]-N.cy,d=Math.hypot(px-dx,py-dy);if(d<best){best=d;spore=i/2;}
    const pr=px*ux+py*uy,q=px*px+py*py-pr*pr;if(pr>0&&q<=B2){const h=Math.sqrt(B2-q);if(pr-h<lo)lo=pr-h;}}
  if(best<=N.fade)return {zone:3,spore};
  if(lo===1e9){const f=(Math.atan2(dy,dx)*N.n/(2*Math.PI)+N.n)%N.n,k=Math.floor(f);lo=N.rin[k]+(N.rin[(k+1)%N.n]-N.rin[k])*(f-k);}   // a ray through a gap between buffers: zone 2 ends at the closed inner boundary (interpolated stored samples)
  if(r>=lo){                                          // past the first buffer on this ray: the region the point is in decides (exact winding test on the hole polygons, smallest first)
    let h=null;
    for(const c of N.holes){const v=c.v,n=v.length;let w=0;
      for(let k=0;k<n;k+=2){const x0=v[k],y0=v[k+1],x1=v[(k+2)%n],y1=v[(k+3)%n],s=(x1-x0)*(y-y0)-(x-x0)*(y1-y0);if(y0<=y){if(y1>y&&s>0)w++;}else if(y1<=y&&s<0)w--;}
      if(w){h=c;break;}}
    if(!h)return {zone:0};                            // open to the outside (a notch, a channel past a gap, beyond the network): nothing
    if(!h.hub)return {zone:3,spore};                  // an enclosed pocket: nearest circle
  }
  {                                                   // zone 2 (the hub's own region): the light's tip sits on the pointer's circle
    let best=1e9,seg=-1,stop=0,kept=1e9,keptSeg=-1,keptStop=0;
    const near=i=>i===prev||(prev>=0&&(N.segs[i].parent===prev||N.segs[prev].parent===i));   // the current branch, its parent and its children
    N.segs.forEach((s,i)=>{if(r<s.r0||r>s.r1)return;
      for(let k=0;k<6;k++){const a=s.r[k],b=s.r[k+1];if(a===b||(a-r)*(b-r)>0)continue;
        const u=(r-a)/(b-a),d=Math.hypot(s.p[2*k]+u*(s.p[2*k+2]-s.p[2*k])-x,s.p[2*k+1]+u*(s.p[2*k+3]-s.p[2*k+1])-y),q=Math.round(s.t[k]+u*(s.t[k+1]-s.t[k]));
        if(d<best){best=d;seg=i;stop=q;}
        if(near(i)&&d<kept){kept=d;keptSeg=i;keptStop=q;}}});
    if(seg>=0&&kept<=best+4)return {zone:2,seg:keptSeg,stop:keptStop};   // stay on the current lineage unless another branch is clearly nearer
    return seg<0?{zone:0}:{zone:2,seg,stop};
  }
}

// Browser, touch: what a tap means. prev = the circle currently previewed (-1 none); z = pick() at the tap, or null when the tap landed on a circle or link (the site's own handler owns that).
// A tap in empty zone-3 space previews the nearest circle; a second tap on the same circle's snap area opens it; any other tap clears.
export function tap(prev,z){
  if(z&&z.zone===3)return z.spore===prev?{prev:-1,open:true}:{prev:z.spore,open:false};
  return {prev:-1,open:false};
}

// Browser: wiring. Idle or outside the stage it does no work: no timers, no rAF; its listeners (stage pointer events, document leaf:pick, window scroll, finder input) return at once.
// Every taste light lives on one overlay (a second .net__hyphae above the site's): the filtered, expensive base layer is never repainted by taste. Its twins carry the site's own is-lit class, so the colour is whatever the site's own lit rule makes of it.
export function run(N,pick,tap){
  const hover=matchMedia('(hover: hover)').matches;
  if(!hover&&!matchMedia('(any-pointer: coarse)').matches)return;
  const net=document.getElementById('net'),stage=net&&net.querySelector('.net__stage'),hub=stage&&stage.querySelector('.net__hub'),hy=stage&&stage.querySelector('.net__hyphae');
  if(!hub||!hy)return;
  const spores=[...net.querySelectorAll('.spore')],segs=N.segs.map(s=>document.getElementById('hy-'+s.id));
  if(spores.length!==N.paths.length||segs.includes(null)||spores.some((s,i)=>s.dataset.path!==N.paths[i]))return console.warn('taste: network markup drifted');   // stay out
  // Lighting is done with classes (see tasteCss), never with inline colours: colour-rewriting extensions (Dark Reader and kin) copy inline colour writes into overrides of their own that outlive our removeProperty, which left roots and spores stuck lit.
  let cx=0,cy=0,raf=0,cur={zone:0},snap=null,touch=false,down=null,ov=null,on=new Set(),tipC=null,occOn=new Map();
  const twin=new Map(),cover=new Map();
  // The twins: one per live strip, in the base's DOM order, hidden until lit; each takes the site's own geometry class and always carries is-lit, so its colour comes only from the site's own `.net__hyphae > i.is-lit` rule.
  // Occluders (class occ, no is-lit: the strip's idle look from the site's own rule) follow the twin of every strip that a lit strip must stay under in the site's paint order (N.occ); they are shown only while such a strip is lit.
  function build(){
    if(ov)return;
    ov=document.createElement('div');ov.className='net__hyphae hw-taste-ov';ov.setAttribute('aria-hidden','true');
    const live=new Set(N.paths.flatMap(p=>p.split(' ')).map(k=>'hy-'+k)),later=new Set(Object.values(N.occ).flat().map(k=>'hy-'+k));
    for(const el of hy.children){
      const geo=[...el.classList].filter(k=>k!=='is-lit'&&!k.startsWith('hw-taste'));
      if(live.has(el.id)){const c=document.createElement('i');c.className=geo.concat('is-lit').join(' ');c.dataset.of=el.id;twin.set(el.id,c);ov.append(c);}
      if(later.has(el.id)){const o=document.createElement('i');o.className=geo.concat('occ').join(' ');o.dataset.occ=el.id;cover.set(el.id,o);ov.append(o);}
    }
    hy.after(ov);
  }
  // A promoted (will-change) layer is placed on a whole CSS pixel, which slides its content by up to half a pixel against the site's own strips (a cream fringe on one side of every lit strip); the container is moved back by exactly that.
  // Measured when the layer is promoted (every hover session starts with a promotion, so a layout shift between sessions is picked up) and again whenever the stage's device-pixel box changes while promoted (resize, zoom, DPR); the observer is attached only while promoted, so an idle page has none.
  function place(){const R=hy.getBoundingClientRect(),X=R.left+scrollX,Y=R.top+scrollY,dx=(X-Math.round(X))+'px',dy=(Y-Math.round(Y))+'px';   // written only when it changed
    if(ov.style.getPropertyValue('--hw-dx')!==dx)ov.style.setProperty('--hw-dx',dx);if(ov.style.getPropertyValue('--hw-dy')!==dy)ov.style.setProperty('--hw-dy',dy);}
  const ro=window.ResizeObserver?new ResizeObserver(()=>{if(ov.classList.contains('hw-taste-wc'))place();}):null;
  const promote=()=>{if(ov.classList.contains('hw-taste-wc'))return;place();ov.classList.add('hw-taste-wc');if(ro)try{ro.observe(stage,{box:'device-pixel-content-box'});}catch{ro.observe(stage);}};
  if(hover)build();
  // Promoted while the stage is in or near the viewport (half a viewport above or below), demoted when it leaves: promoting at the first light cost one 50 to 83 ms frame (paint and layerize) per hover session.
  // So there is never a promoted overlay while the Network is off-screen (an idle page at load is the faithful page), and none is made or dropped while the pointer works the network. Without IntersectionObserver: promoted at the first light, demoted by every release.
  const io=window.IntersectionObserver?new IntersectionObserver(es=>{if(!ov)return;if(es[es.length-1].isIntersecting)promote();else{release();demote();}},{rootMargin:'50% 0px'}):null;
  if(io)io.observe(stage);
  // The promotion now outlives hover sessions, so placement is also re-measured where a session used to re-promote: when one starts (show() from rest, a real circle entered) and on a window resize (the stage can move by half a pixel without changing size, which the ResizeObserver does not see). Each call site reads layout before taste writes anything in that task.
  const fresh=()=>{if(ov&&ov.classList.contains('hw-taste-wc'))place();};
  addEventListener('resize',fresh,{passive:true});
  // full: base strips lit whole; tipEl: the base strip lit up to a gradient stop (a fully lit twin masked; the cut lives on the container, angle and percentage only)
  function light(full,tipEl,a,stop){
    build();
    const want=new Set([...full].map(el=>twin.get(el.id))),tc=tipEl?twin.get(tipEl.id):null;
    for(const c of on)if(!want.has(c))c.classList.remove('on');
    for(const c of want)c.classList.add('on');
    on=want;
    if(tipC&&tipC!==tc)tipC.classList.remove('tip');
    if(tc){tc.classList.add('tip');ov.style.setProperty('--hw-a',a+'deg');ov.style.setProperty('--hw-stop',stop+'%');}else{ov.style.removeProperty('--hw-a');ov.style.removeProperty('--hw-stop');}
    tipC=tc;
    const ids=new Set([...full].map(el=>el.id)),shown=new Map();   // occluders: the strips that cover a lit strip in the site's paint order (a later strip overlapping it) and are not lit themselves; the tip's own unlit part counts too
    for(const el of tipEl?[...full,tipEl]:full)for(const k of N.occ[+el.id.slice(3)]||[]){const id='hy-'+k;if(!ids.has(id))shown.set(cover.get(id),tipEl&&tipEl.id===id?'cut':'on');}
    for(const [o,m] of occOn)if(shown.get(o)!==m)o.classList.remove(m);
    for(const [o,m] of shown)o.classList.add(m);
    occOn=shown;
    if(on.size||tc)promote();   // normally already promoted (the stage is on screen); a touch-only device builds the overlay on its first preview, and without IntersectionObserver this is the first light
  }
  const demote=()=>{if(ro)ro.disconnect();if(ov){ov.classList.remove('hw-taste-wc');ov.style.removeProperty('--hw-dx');ov.style.removeProperty('--hw-dy');if(!ov.getAttribute('style'))ov.removeAttribute('style');}};
  const fire=(sp,type)=>sp.dispatchEvent(new PointerEvent(type,{pointerType:'mouse'}));   // the site's own pointerenter/leave: thread + tag
  const unfocus=()=>{const a=document.activeElement;if(a&&a.classList&&a.classList.contains('spore')&&net.contains(a))a.blur();};   // a stale keyboard/modal-return focus is a second lit route; the site's blur unlights it
  const unthread=()=>{for(const i of hy.querySelectorAll(':scope > i.is-lit'))i.classList.remove('is-lit');};   // one route at a time: the site's own lit strips go (the overlay shows the route); done in the task that lit them, so the base nets to no change
  function show(s){
    if(s.zone===cur.zone&&s.seg===cur.seg&&s.stop===cur.stop&&s.spore===cur.spore)return;
    if(!cur.zone)fresh();   // a session starts
    const next=s.zone===3?spores[s.spore]:null;
    if(snap&&snap!==next){fire(snap,'pointerleave');snap.classList.remove('hw-taste-snap');stage.classList.remove('hw-taste-pointer');snap=null;}
    unthread();
    hub.classList.toggle('hw-taste-glow',s.zone===1);
    const full=new Set(),t=s.zone===2?segs[s.seg]:null;
    if(t)for(let p=N.segs[s.seg].parent;p>=0;p=N.segs[p].parent)full.add(segs[p]);
    if(next)for(const k of next.dataset.path.split(' '))full.add(document.getElementById('hy-'+k));
    if(ov||full.size||t)light(full,t,t?N.segs[s.seg].a:0,t?s.stop:0);
    if(next&&next!==snap){snap=next;fire(snap,'pointerenter');unthread();snap.classList.add('hw-taste-snap');stage.classList.add('hw-taste-pointer');}   // .hw-taste-snap mirrors .spore:hover
    cur=s;
  }
  const release=()=>{cancelAnimationFrame(raf);raf=0;show({zone:0});if(!io)demote();};   // nothing lit; the promotion follows the stage's visibility (io)
  const busy=()=>net.classList.contains('is-searching')||(window.leafLift&&window.leafLift.busy());
  const at=(x,y)=>{const b=stage.getBoundingClientRect();return pick(N,(x-b.left)*N.w/b.width,(y-b.top)*N.h/b.height,cur.zone===2?cur.seg:-1);};
  function frame(){
    raf=0;
    if(busy())return release();
    show(at(cx,cy));
  }
  stage.addEventListener('pointermove',e=>{
    if(e.pointerType!=='mouse'&&e.pointerType!=='pen')return;
    if(e.target.closest('.spore')){cancelAnimationFrame(raf);raf=0;return;}   // a real spore under the pointer owns the hover
    unfocus();
    cx=e.clientX;cy=e.clientY;raf||=requestAnimationFrame(frame);
  },{passive:true});
  stage.addEventListener('pointerover',e=>{if(e.target.closest('.spore')){fresh();unfocus();release();}});   // fires before that spore's own pointerenter
  // A real mouse hover on a circle: the site lights its path on the base (its handler runs first: ours were added after it); in the same task the light moves to the overlay, so the base nets to no change and is never repainted. Tag, scale and click are the site's own, untouched.
  for(const sp of spores){
    sp.addEventListener('pointerenter',e=>{if(e.isTrusted&&e.pointerType!=='touch'){unthread();light(new Set(sp.dataset.path.split(' ').map(k=>document.getElementById('hy-'+k))),null);}});
    sp.addEventListener('pointerleave',e=>{if(e.isTrusted&&e.pointerType!=='touch'&&!cur.zone)light(new Set(),null);});
  }
  // Touch: only taps act (small movement, short press); a scroll or drag ends in pointercancel or moves too far and does nothing. Nothing here is ever preventDefault'ed.
  stage.addEventListener('pointerdown',e=>{touch=e.pointerType==='touch';down=touch&&e.isPrimary?{x:e.clientX,y:e.clientY,t:e.timeStamp,id:e.pointerId}:null;},{passive:true});
  stage.addEventListener('pointerup',e=>{
    const d=down;down=null;
    if(!d||e.pointerId!==d.id||Math.hypot(e.clientX-d.x,e.clientY-d.y)>10||e.timeStamp-d.t>500||busy())return;
    const direct=e.target.closest('.spore,[data-open]'),r=tap(cur.zone===3?cur.spore:-1,direct?null:at(e.clientX,e.clientY));
    if(!direct)unfocus();
    if(r.open){const sp=spores[cur.spore];release();sp.click();}   // the site's own [data-open] delegation opens it
    else if(r.prev<0)release();
    else show({zone:3,spore:r.prev});
  },{passive:true});
  stage.addEventListener('pointerleave',e=>{if(e.pointerType!=='touch')release();});   // a touch pointer "leaves" right after every tap: the preview stays
  stage.addEventListener('pointercancel',e=>{down=null;release();});
  // A touch anywhere outside the stage (background, a link or button, the start of a swipe, a second finger) clears a preview and ends any tap in progress. Capture and passive: it runs before the page's own handlers, never cancels them or the scroll, and returns at once when nothing is shown.
  document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||stage.contains(e.target))return;down=null;if(cur.zone)release();},{passive:true,capture:true});
  addEventListener('blur',release);                                                      // window lost focus: no pointerleave may come
  stage.addEventListener('focus',release,true);                                          // capture: before the site's focus handler
  document.addEventListener('leaf:pick',release);
  addEventListener('scroll',()=>{if(cur.zone||raf)release();},{passive:true,capture:true});
  const find=document.getElementById('group-find');if(find)find.addEventListener('input',release);
  // Forward a click on a snapped spore through the site's own [data-open] delegation, mirroring its guards.
  stage.addEventListener('click',e=>{
    if(raf&&!e.target.closest('.spore')){cx=e.clientX;cy=e.clientY;cancelAnimationFrame(raf);frame();}   // a move is still queued: resolve it at the click point, never click a stale snap
    if(!snap||e.target.closest('[data-open]')||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0||touch||e.pointerType==='touch')return;
    snap.click();
  });
}

// The look of every taste state. Ordinary stylesheet rules (same shape as the site's own .is-lit / :hover), toggled by class: any dark-mode extension treats them like the site's CSS and has nothing inline to leave behind.
// No colour appears here except the hub glow: the overlay's twins take theirs from the site's own `.net__hyphae > i.is-lit` rule.
export function tasteCss(){
  return `/* Taste you didn't ask for: Network hover, Jonathan's opinion, opt-in. Classes only; set by taste.js. */
.net .net__hyphae.hw-taste-ov { filter: none; pointer-events: none; }
.net .net__hyphae.hw-taste-ov.hw-taste-wc { will-change: transform; }
.net .net__hyphae.hw-taste-ov > i { visibility: hidden; margin: var(--hw-dy, 0px) 0 0 var(--hw-dx, 0px); }
.net .net__hyphae.hw-taste-ov > i.on { visibility: visible; }
.net .net__hyphae.hw-taste-ov > i.tip { visibility: visible; -webkit-mask-image: linear-gradient(var(--hw-a), #000 var(--hw-stop), transparent var(--hw-stop)); mask-image: linear-gradient(var(--hw-a), #000 var(--hw-stop), transparent var(--hw-stop)); }
.net .net__hyphae.hw-taste-ov > i.occ.cut { visibility: visible; -webkit-mask-image: linear-gradient(var(--hw-a), transparent var(--hw-stop), #000 var(--hw-stop)); mask-image: linear-gradient(var(--hw-a), transparent var(--hw-stop), #000 var(--hw-stop)); }
.net .spore.hw-taste-snap { scale: 1.65; z-index: 2; --c: var(--gold); }
.net .net__stage.hw-taste-pointer { cursor: pointer; }
@supports (color: color-mix(in srgb, red, blue)) { .net .net__hub.hw-taste-glow { --paper: color-mix(in srgb, var(--gold) 30%, var(--paper-2)); } }
`;
}

export function tasteSource(html){
  const N=extractNetwork(html),head="/* Taste you didn't ask for: Network hover, Jonathan's opinion, opt-in. */\n",bar='!'.repeat(78);
  if(N.dormant){
    console.warn('\n'+bar+'\n!! TASTE DORMANT: Network layout no longer fits the taste zone rules.\n!! '+N.dormant+'\n!! The Network layout needs reconfiguring (spores further from the hub, or a smaller hub), or the zone rules re-tuning; see "Taste" in tools/BUILD.md.\n!! The shipped taste script is inert: the page behaves exactly as the original.\n'+bar+'\n');
    return head+'/* dormant: '+N.dormant+' */\n';
  }
  return head+`(()=>{"use strict";const N=${JSON.stringify((({dead,dormant,clearance,uncovered,maxGap,rout,...n})=>n)(N))};const pick=${pick},tap=${tap};(${run})(N,pick,tap);})();\n`;
}
