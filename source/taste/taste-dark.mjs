// Designed night is the default for the separate taste route; an explicit light choice keeps its daytime art.
// source/taste/index.mjs adapts the authored HTML/CSS and scopes night rules to the root's theme choice.
// The faithful daytime build never imports this dark-art transformation.
import assert from 'node:assert/strict';

// ============================================================ knobs (edit, then rebuild)
// Fireflies (Photinus carolinus, the Smokies' synchronous fireflies). Times in seconds, places in % of the 1508 x 1047 sheet.
export const FIREFLY={
  flashes:6,          // flashes per burst
  interval:.5,        // between flash starts inside a burst
  swell:.18,          // one flash: soft swell up...
  fade:.3,            // ...and a slower fade ("glow and relief"); swell + fade stays under interval
  halo:2.5,           // halo diameter, x the firefly's body length (ambient shimmer, not a beacon)
  haloPeak:.5,        // halo opacity at full flash (the tiny tail core is brighter)
  lead:.4,            // dark before a burst's first flash (room for the early straggler)
  dark:7.2,           // dark after a burst's last flash
  wave:.8,            // a burst ripples across the swarm in this long
  // super-cycle: one wave pattern per burst, then it repeats (5 bursts, about 54 s)
  order:['ltr','centre','rtl','off','centre'],
  patterns:{ltr:{from:'left'},rtl:{from:'right'},centre:{origin:50},off:{origin:71}},   // origin = x of the point the wave spreads out from
  stragglers:{3:-.2,7:.24},   // firefly (nth-child) -> its first flash of every burst comes this early (-) or late (+), then it locks in
  lift:-40,           // rise during a burst, % of the firefly's height
  bob:[3.2,4.8],      // full bob period range (each firefly gets its own)
  bobHeight:-38,      // % of its height
  drift:[24,40],      // one slow wander across, range
  // where each of the 9 fireflies hovers (x,y) and how far it wanders (dx,dy): low over the meadow, the understory under the crown's edge;
  // never over the words, buttons or chips (verify-taste-dark checks the halos against every text box at several window sizes)
  homes:[[5,40.4,2,.4],[13.5,40.9,2.2,.35],[22,40.3,2,.5],[31.5,38.6,1.6,.8],[40,40.3,2,.5],[59,40.6,2,.45],[67.5,37.8,1.4,.8],[72.5,40.8,1.8,.35],[92,40.6,2.2,.4]],
};
// Night sky: which critter flies each day bird's path ('day' keeps the bird). Index = the bird's order within its kind in the markup.
export const NIGHT={cardinal:['barred'],jay:['barred'],goldfinch:['screech','bat'],speck:['moth','moth','moth','moth','moth']};
export const WALKERS={rabbit:true,raccoon:true};   // cottontail walks day and night; raccoon at night only
export const FIREFLIES=true;                       // false: the bees stay bees at night
// Size of a night critter on a smaller day bird's path (% of the sheet width); others keep the bird's own size.
const SIZE={'moth@speck':2.1,'moth@goldfinch':2.4,'screech@speck':2.1,'bat@goldfinch':2.5,'bat@speck':2.5,'barred@speck':3.2,'barred@goldfinch':3.2};

// ============================================================ paper-cut geometry
const rad=d=>d*Math.PI/180;
function ell(cx,cy,rx,ry,{n=18,rot=0}={}){const o=[],r=rad(rot);for(let i=0;i<n;i++){const t=2*Math.PI*i/n,x=rx*Math.cos(t),y=ry*Math.sin(t);o.push([cx+x*Math.cos(r)-y*Math.sin(r),cy+x*Math.sin(r)+y*Math.cos(r)]);}return o;}
function smooth(pts,k=5){const o=[],n=pts.length;for(let i=0;i<n;i++){const p0=pts[(i+n-1)%n],p1=pts[i],p2=pts[(i+1)%n],p3=pts[(i+2)%n];
  for(let j=0;j<k;j++){const t=j/k,t2=t*t,t3=t2*t,f=(a,b,c,d)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);o.push([f(p0[0],p1[0],p2[0],p3[0]),f(p0[1],p1[1],p2[1],p3[1])]);}}return o;}
const scale=(pts,sx,sy,cx,cy)=>pts.map(([x,y])=>[cx+(x-cx)*sx,cy+(y-cy)*(sy??sx)]);
const move=(pts,dx,dy)=>pts.map(([x,y])=>[x+dx,y+dy]);
function clipHalf(poly,nx,ny,d){const o=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=nx*a[0]+ny*a[1]-d,db=nx*b[0]+ny*b[1]-d;
  if(da<=0)o.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);o.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return o;}
function band(poly,deg,lo,hi){const r=rad(deg),nx=Math.cos(r),ny=Math.sin(r);let p=clipHalf(poly,nx,ny,hi);if(p.length)p=clipHalf(p,-nx,-ny,-lo);return p;}
function scallop(a,b,depth,n=6){const o=[],dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy),nx=-dy/L,ny=dx/L;for(let i=1;i<n;i++){const t=i/n,s=Math.sin(Math.PI*t)*depth;o.push([a[0]+dx*t+nx*s,a[1]+dy*t+ny*s]);}return o;}

// ============================================================ the critters
// Built like the author's birds and bugs: plies (<b>, one paper colour each) of clip-path pieces (<i>), all in % of one box, facing right.
// A ply is {c:'#hex', cls:'bird__wing ...', s:[{p:points, c?:'#hex'}]}. Day colours; at night the site's own night mapping dims them like every other piece.
// Owls are cut exactly like the cardinal and the jay (100 x 64 box, integer design units, five-point wings and tail, an eleven-point body,
// twelve-sided head, eight-sided small rounds, triangle beak, quad wing bars); the near and far wings hinge on the site's 50% 53% flap origin.
const OWL={
  barred:{tail:'#7a5c40',tbar:'#e3d3b4',far:'#6c5038',body:'#8d6b4a',belly:'#eadcc0',streak:'#8d6b4a',rim:'#6c5038',disc:'#e6d8bc',eye:'#2b2118',beak:'#e0b44a',wing:'#a07a54',bar:'#ecdfc4'},
  screech:{tail:'#7a746a',tbar:'#cfc8b6',far:'#6b665d',body:'#8b857a',belly:'#ddd5c3',streak:'#6f6a60',rim:'#625d54',disc:'#d4ccb9',eye:'#e5bc3d',pupil:'#2b2118',beak:'#cfa44a',wing:'#a39c8f',bar:'#d9d2c0'},
};
export function owl(kind='barred'){
  const P=OWL[kind],sc=kind==='screech',[hx,hy]=sc?[79,28]:[80,27],[rx,ry]=sc?[15,14]:[14,13];
  const quad=(x0,y0,x1,y1,x2,y2,x3,y3)=>[[x0,y0],[x1,y1],[x2,y2],[x3,y3]];
  return {w:100,h:64,plies:[
    {c:P.tail,s:[{p:sc?[[6,32],[8,42],[26,41],[30,35],[24,31]]:[[2,30],[4,42],[24,41],[28,34],[22,29]]},
      ...(sc?[[12,15],[18,21]]:[[8,11],[15,18]]).map(([a,b])=>({p:quad(a,31,b,31,b,40,a,40),c:P.tbar}))]},
    {c:P.far,cls:'bird__wing bird__wing--far',s:[{p:sc?[[42,33],[33,8],[44,2],[58,15],[64,33]]:[[40,33],[30,6],[42,0],[58,14],[64,33]]}]},
    {c:P.body,s:[{p:sc?[[22,37],[29,27],[44,22],[61,23],[74,30],[79,39],[75,48],[63,54],[46,56],[31,51],[24,44]]:[[20,36],[27,27],[42,23],[60,24],[74,30],[80,38],[76,47],[64,53],[47,55],[31,50],[22,43]]},
      {p:sc?[[33,46],[46,49],[62,47],[75,41],[74,48],[63,54],[46,56],[32,51]]:[[32,45],[46,48],[62,46],[76,40],[75,47],[64,53],[47,55],[33,50]],c:P.belly},
      ...[[47,48],[55,48],[63,46]].map(([x,y])=>({p:quad(x,y+(sc?1:0),x+2,y+(sc?1:0),x+2,y+(sc?4:3),x,y+(sc?4:3)),c:P.streak}))]},
    {c:P.body,s:[{p:ell(hx,hy,rx,ry,{n:12})},...(sc?[{p:[[68,18],[70,6],[77,15]]},{p:[[86,15],[93,6],[92,20]]}]:[])]},
    {c:P.rim,s:[{p:ell(hx+3,hy+2,11,10,{n:12})}]},
    {c:P.disc,s:[{p:ell(hx+3,hy+2,10,9,{n:12})}]},
    {c:P.eye,s:[{p:ell(hx-1,hy+1,sc?3:2.6,sc?3:2.6,{n:8})},{p:ell(hx+8.5,hy+1,sc?3:2.6,sc?3:2.6,{n:8})},
      ...(sc?[{p:ell(hx-1,hy+1,1.5,1.5,{n:8}),c:P.pupil},{p:ell(hx+8.5,hy+1,1.5,1.5,{n:8}),c:P.pupil}]:[])]},
    {c:P.beak,s:[{p:[[hx+2,hy+4],[hx+6,hy+4],[hx+4,hy+9]]}]},
    {c:P.wing,cls:'bird__wing',s:[{p:sc?[[38,34],[24,4],[40,0],[57,12],[68,34]]:[[36,34],[22,4],[38,0],[56,12],[68,34]]},
      ...[[[30,11],[44,5],[46,9],[32,15]],[[33,19],[50,12],[52,16],[35,23]],[[37,27],[56,19],[58,23],[39,31]]].map(p=>({p:sc?move(p,1,0):p,c:P.bar}))]},
  ]};
}
// luna moth (eastern North America), wings up, 100 x 50
export function moth(){
  const fore=smooth([[48,28],[43,18],[41,7],[46,2],[54,8],[59,18],[58,28]]),lobe=ell(36,19,10,8,{rot:-32});
  const tailR=smooth([[29,15],[21,9],[12,4],[6,2],[9,6],[16,13],[24,20],[30,22]]),f=p=>scale(move(p,-5,2),.94,.94,48,28);
  const edge=smooth([[41,7],[41.6,18],[44.5,28],[46.6,28],[44,18],[43.4,6.5]],3);
  return {w:100,h:50,plies:[
    {c:'#8fbf78',cls:'bird__wing bird__wing--far',s:[{p:f(fore)},{p:f(lobe)},{p:f(tailR)}]},
    {c:'#f3efdf',s:[{p:ell(52,30,13,5.2,{rot:-6})},{p:ell(66,28,4.6,4.4)}]},
    {c:'#8c6a5c',s:[{p:[[66,25],[70,15],[78,8],[79.6,10],[72,17],[68,26]]},{p:[[68,25],[76,18],[84,14],[85,16.2],[78,21],[70,27]]}]},
    {c:'#3a2a3a',s:[{p:ell(67.6,27.4,1.2,1.2)}]},
    {c:'#bfe3a5',cls:'bird__wing',s:[{p:fore},{p:lobe},{p:tailR},{p:edge,c:'#8c5f86'},{p:ell(47,14,2.8,3.4),c:'#f1dc72'},{p:ell(47,14,1.3,1.7),c:'#5a3f5e'}]},
  ]};
}
// eastern red bat, storybook-round, 100 x 64
export function bat(){
  const S=[50,38],T=[30,5],E1=[14,24],E2=[26,36],E3=[40,44];
  const wingPts=()=>[S,T,...scallop(T,E1,-3.2,5),E1,...scallop(E1,E2,-3,5),E2,...scallop(E2,E3,-2.6,4),E3];
  const bone=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy),nx=-dy/L*.55,ny=dx/L*.55;return [[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]];};
  return {w:100,h:64,plies:[
    {c:'#8f4c2a',cls:'bird__wing bird__wing--far',s:[{p:wingPts()}]},
    {c:'#c9733a',s:[{p:ell(52,44,13,11)},{p:ell(66,36,9.5,9)},{p:ell(62,26,3.6,4.6,{rot:-12})},{p:ell(71,26.5,3.6,4.6,{rot:12})}]},
    {c:'#e8a98a',s:[{p:ell(62,26.4,1.8,2.6,{rot:-12})},{p:ell(71,26.9,1.8,2.6,{rot:12})}]},
    {c:'#e3a074',s:[{p:ell(74,39,3.4,2.7)}]},
    {c:'#2a1a10',s:[{p:ell(69.4,34.4,1.9,2.1)},{p:ell(76,38.2,1.2,1)}]},
    {c:'#f6efe0',s:[{p:ell(70,33.6,.7,.7)}]},
    {c:'#b5693a',cls:'bird__wing',s:[{p:scale(move(wingPts(),2,2),1.08,1.08,50,38)},{p:bone([52,40],[31,6]),c:'#7a3e22'},{p:bone([52,40],[15,25]),c:'#7a3e22'},{p:bone([52,40],[27,37]),c:'#7a3e22'}]},
  ]};
}
// raccoon, facing right, 100 x 60; the bug__legs plies scurry like the bugs' legs
export function raccoon(){
  const tail=smooth([[2,28],[10,20],[22,18],[30,24],[30,36],[22,44],[10,44],[2,38]]),leg=(x0,y0)=>[[x0,y0],[x0+7,y0],[x0+7.6,y0+13],[x0-.6,y0+13]];
  return {w:100,h:60,plies:[
    {c:'#8e8a82',s:[{p:tail},...[[5,9],[13,17],[21,25]].map(([a,b])=>({p:band(tail,0,a,b),c:'#3d3a37'})),{p:band(tail,0,0,3.4),c:'#3d3a37'}]},
    {c:'#4b4845',cls:'bug__legs',s:[{p:leg(33,44)},{p:leg(64,44)}]},
    {c:'#96918a',s:[{p:ell(50,36,24,15)}]},
    {c:'#b6b1a8',s:[{p:ell(52,44,17,7)}]},
    {c:'#5a5652',cls:'bug__legs',s:[{p:leg(26,45)},{p:leg(70,45)}]},
    {c:'#9d9890',s:[{p:ell(76,32,13,11.5)},{p:ell(70,21,3.9,4.3)},{p:ell(81,20.4,3.9,4.3)}]},
    {c:'#c9b2a6',s:[{p:ell(70,21.4,2,2.5)},{p:ell(81,20.8,2,2.5)}]},
    {c:'#e6e0d2',s:[{p:ell(88,36,8,5.5)},{p:[[72,38],[73.6,45],[79,39]]},{p:ell(78,26.4,6.2,1.7),c:'#efeadc'}]},
    {c:'#34312e',s:[{p:smooth([[70,29],[78,27.5],[86,31],[84,35],[76,36],[70,34]],4)}]},
    {c:'#f4efe2',s:[{p:ell(79.8,30.8,1.3,1.3)}]},
    {c:'#2a2826',s:[{p:ell(95.6,34.6,2.1,1.8)}]},
  ]};
}
// eastern cottontail, facing right, 100 x 62
export function cottontail(){
  const leg=(x0,y0,w=7)=>[[x0,y0],[x0+w,y0],[x0+w+.8,y0+10],[x0-.4,y0+10]];
  return {w:100,h:62,plies:[
    {c:'#8b6d4b',s:[{p:ell(70,10,4.2,13,{rot:15})}]},
    {c:'#d9a79b',s:[{p:ell(70,10.4,1.9,10,{rot:15})}]},
    {c:'#f6f1e6',s:[{p:ell(7,38,6.4,6.4)}]},
    {c:'#9b7b57',cls:'bug__legs',s:[{p:leg(57,48)},{p:ell(22,56.5,11,3.6)}]},
    {c:'#a88660',s:[{p:ell(24,40,17,15)}]},
    {c:'#b0906a',s:[{p:ell(42,36,26,17)},{p:ell(72,30,12,11)},{p:ell(65,12,4.4,13.6,{rot:-10})}]},
    {c:'#e6d8bd',s:[{p:ell(46,46,18,7)},{p:ell(81,35,6.6,5)}]},
    {c:'#d9a79b',s:[{p:ell(65.2,12.4,2,10.2,{rot:-10})}]},
    {c:'#b79a74',cls:'bug__legs',s:[{p:leg(50,47,6)}]},
    {c:'#2a1d14',s:[{p:ell(76,28,2,2.2)}]},
    {c:'#f6efe0',s:[{p:ell(76.6,27.2,.7,.7)}]},
    {c:'#e08e8e',s:[{p:ell(86.4,33.4,1.8,1.4)}]},
  ]};
}
export const CRITTERS={barred:()=>owl('barred'),screech:()=>owl('screech'),moth,bat,raccoon,rabbit:cottontail};

// Markup and classes for a set of critters (classes only: the page CSP has style-src-attr 'none').
// Pieces dedupe to one hw-np-* class per polygon; colours are hw-nc-<hex> classes setting the site's --c.
export function emitter(){
  const polys=new Map(),cols=new Set();
  const poly=(cr,pts)=>{const v='polygon('+pts.map(([x,y])=>`${(x/cr.w*100).toFixed(1)}% ${(y/cr.h*100).toFixed(1)}%`).join(',')+')';if(!polys.has(v))polys.set(v,'hw-np-'+polys.size.toString(36));return polys.get(v);};
  const col=c=>{assert.match(c,/^#[0-9a-f]{6}$/);cols.add(c);return 'hw-nc-'+c.slice(1);};
  const html=(cr,cls)=>`<span class="${cls}">`+cr.plies.map(pl=>`<b class="${[pl.cls,col(pl.c)].filter(Boolean).join(' ')}">`+pl.s.map(s=>`<i class="${poly(cr,s.p)}${s.c?' '+col(s.c):''}"></i>`).join('')+'</b>').join('')+'</span>';
  const css=()=>[...polys].map(([v,k])=>`.${k}{clip-path:${v}}`).concat([...cols].map(c=>`.hw-nc-${c.slice(1)}{--c:${c}}`)).join('\n')+'\n';
  return {html,css};
}

// ============================================================ markup: night faces baked in beside the day faces, walkers on the ground line
// Each bird keeps its own box, path, bob and flap; its night face sits next to the day face and CSS shows one of them.
export function darkHtml(html,{expectedDayBees=9}={}){
  const E=emitter(),count={},used=new Set();let birds=0;
  html=html.replace(/<div class="bird bird--(\w+)([^"]*)"([^>]*)>\s*<span class="(bird__bob[^"]*)"([^>]*)>\s*<span class="bird__face( bird__face--left)?">([\s\S]*?)<\/span><\/span><\/div>/g,(m,kind,rest,flightAttrs,bob,bobAttrs,left='',face)=>{
    birds++;const i=count[kind]=(count[kind]??-1)+1,t=NIGHT[kind]?.[i];
    if(!t||t==='day')return m;
    assert(CRITTERS[t],'unknown night critter '+t);used.add(t+'@'+kind);
    // Keep authored flight/flap/top and day dimensions. Night dimensions override variables, never discard inline geometry.
    bobAttrs=bobAttrs.replace(/style="([^"]*)"/,(all,style)=>'style="'+style.replace(/(^|;)width:([^;]+)/,(_,start,value)=>start+'width:var(--hw-night-w,'+value+')').replace(/(^|;)aspect-ratio:([^;]+)/,(_,start,value)=>start+'aspect-ratio:var(--hw-night-ar,'+value+')')+'"');
    return `<div class="bird bird--${kind}${rest} hw-night hw-n-${t} hw-n-${t}-on-${kind}"${flightAttrs}><span class="${bob}"${bobAttrs}><span class="bird__face${left}">${face}</span>${E.html(CRITTERS[t](),'bird__face hw-nface'+left)}</span></div>`;
  });
  assert.equal(birds,9,`expected the 9 birds of the original sky, found ${birds}; update NIGHT in source/taste/taste-dark.mjs`);
  assert.equal((html.match(/<div class="bee(?: |")/g)||[]).length,expectedDayBees,'The source meadow bee count changed; update the explicit taste source mapping');
  const walk=[WALKERS.rabbit&&`<div class="bug bug--east bug--rare bug--hop hw-nw-rabbit">${E.html(CRITTERS.rabbit(),'bug__face hw-nwf-rabbit')}</div>`,
    WALKERS.raccoon&&`<div class="bug bug--west bug--rare bug--waddle hw-nw-raccoon">${E.html(CRITTERS.raccoon(),'bug__face bug__face--left hw-nwf-raccoon')}</div>`].filter(Boolean).join('');
  const soil=/(<div class="scene" aria-hidden="true"[^>]*>[\s\S]*?)(<div class="cut soil(?: |"))/;
  assert(soil.test(html),'the first scene no longer has a cut soil sheet; the ground walkers need a new place (source/taste/taste-dark.mjs darkHtml)');
  if(walk)html=html.replace(soil,(m,a,b)=>`${a}<div class="bugs hw-nx-walkers">${walk}</div>\n      ${b}`);
  return {html,css:E.css(),used:[...used]};
}

// ============================================================ palette: the site's own colours on a night curve
// Every paper colour the site cuts with var(--c)/var(--c2)/var(--mycelium) goes through one value curve that keeps the tonal order
// (leaves keep their t1..t6 spread, so they still pop), shadows deepen, pale roots stay pale paper only dimmed. Hand-set tokens below.
const NL={a:.05,k:.8,g:1.55,c:.95};
const LC=`calc(${NL.a} + ${NL.k} * pow(l, ${NL.g})) calc(c * ${NL.c})`,LC_GOLD='calc(.05 + .8 * pow(l, 1.3)) calc(c * 1.05)';   // the night curve; gold leaves (t6) keep a little more light
// hand-set night tokens (sky: the dusk blue the daytime sky is cut from, a few stops down; paper keeps its cream, lamp-lit rather than daylit)
export const TOKENS={'--sky-left':'#213358','--sky-right':'#17233f','--paper':'#cfc7ac','--paper-2':'#c0b799','--card':'#e0dac4','--ink':'#1e2a21','--ink-soft':'#384538',
  '--gold':'#e3c944','--gold-deep':'#cdb12c','--cream':'#ece3c9','--focus':'#8fb0ff','--scrim':'rgb(5 9 20 / .8)',
  '--lay':'drop-shadow(0 0 .5px rgb(10 5 0 / .6)) drop-shadow(1.5px 3px 3px rgb(5 3 0 / .5))','--lay-up':'drop-shadow(0 0 .5px rgb(10 5 0 / .6)) drop-shadow(3px 7px 7px rgb(5 3 0 / .52))'};
// the site's paper grain, night version: highlights at .55, shadows at 1.3 (read from the site's :root).
// With a dedicated night tile the fine half is that tile (night alpha baked in) and only the mottles are
// transformed here; without one, the daytime tile expands to its fine layers (or the raw recipe is used) and
// every layer transforms, as before.
const splitTopGrain=v=>{const out=[];let d=0,cur='';for(const ch of v){if(ch==='(')d++;else if(ch===')')d--;if(ch===','&&!d){out.push(cur.trim());cur='';}else cur+=ch;}if(cur.trim())out.push(cur.trim());return out;};
function grainOf(css,tile=false){const root=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/(?:^|\})\s*:root\s*\{([^{}]*)\}/g)].map(m=>m[1]).join('\n');
  let g=(/--grain:([\s\S]*?);(?=\s*(?:\/\*|--leaf-shape))/.exec(root)||[])[1];
  assert(g,'the site :root no longer defines --grain before --leaf-shape; update grainOf() in source/taste/taste-dark.mjs');
  const transform=v=>v.replace(/rgb\(255 255 255 \/ ([\d.]+)\)/g,(m,a)=>`rgb(255 255 255 / ${(a*.55).toFixed(3)})`).replace(/rgb\(0 0 0 \/ ([\d.]+)\)/g,(m,a)=>`rgb(0 0 0 / ${(a*1.3).toFixed(3)})`).replace(/\s+/g,' ').trim();
  if(tile){
    const layers=splitTopGrain(g),firstMottle=layers.findIndex(l=>/^radial-gradient\(ellipse/.test(l));
    assert(firstMottle>0,'the night grain needs the fine half before its mottles; update grainOf()');
    if(/var\(--grain-tile\)/.test(g))assert(/var\(--grain-tile\)\s+0\s+0\s*\/\s*256px\s+256px/.test(g),'Unsupported grain tile placement');
    return `var(--grain-tile-night) 0 0 / 256px 256px, ${transform(layers.slice(firstMottle).join(', '))}`;
  }
  // Upstream stores the fine recipe separately from its daytime tile. Night alpha must affect the fine paper too.
  if(/var\(--grain-tile\)/.test(g)){const fine=(/--grain-fine:\s*([\s\S]*?);/.exec(root)||[])[1];assert(fine,'The upstream fine grain recipe is missing');g=g.replace(/var\(--grain-tile\)\s+0\s+0\s*\/\s*256px\s+256px/,fine.trim());assert(!/var\(--grain-tile\)/.test(g),'Unsupported grain tile placement');}
  return transform(g);}
const N=x=>`oklch(from ${x} ${LC} h)`;
const NS=x=>`oklch(from ${x} calc(0.03 + 0.7 * pow(l, 1.65)) calc(c * ${NL.c}) h)`;   // sand and gravel bands: a step lower, so cream words on them pass AA
const TILE_STEPS=['1.125','1.375','1.625','1.875','2.25','2.75'];
export function darkPalette(siteCss,nightTiles=null){
  if(nightTiles)assert(nightTiles.length===7,'darkPalette wants the seven night tiles or none');
  const css=siteCss.replace(/\/\*[\s\S]*?\*\//g,'');
  const rules=[];{let depth=0,start=0,sel='';for(let i=0;i<css.length;i++){const ch=css[i];if(ch==='{'){if(depth===0)sel=css.slice(start,i).trim();depth++;}else if(ch==='}'){depth--;if(depth===0){rules.push({sel,body:css.slice(css.indexOf('{',start)+1,i),at:sel.startsWith('@')});start=i+1;}}}}
  const decls=body=>{const o=[];let d=0,cur='';for(const ch of body){if(ch==='(')d++;if(ch===')')d--;if(ch===';'&&d===0){if(cur.trim())o.push(cur.trim());cur='';}else cur+=ch;}if(cur.trim())o.push(cur.trim());return o;};
  const deepen=v=>v.replace(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/g,(m,r,g,b,a)=>`rgb(${r} ${g} ${b} / ${Math.min(.92,+a*1.4).toFixed(2)})`);
  const out=[],seen=new Set();
  for(const r of rules){if(r.at||/hw-s-/.test(r.sel)||/^:root/.test(r.sel))continue;const keep=[];
    for(const d of decls(r.body)){let x=d,hit=false;const prop=x.split(':')[0].trim();
      // Night fill selectors gain a root prefix; mirror authored transparent resets at the same specificity.
      const value=x.slice(x.indexOf(':')+1).trim();
      if(/^background(?:-color|-image)?$/.test(prop)&&/^(?:none|transparent)(?:\s*!important)?$/i.test(value))hit=true;
      if(/^background/.test(prop)&&/var\(--c2?\)/.test(x)&&!/^\.crease/.test(r.sel)){x=x.replace(/var\(--c2?\)/g,m=>N(m));hit=true;}
      if(/^background/.test(prop)&&/var\(--mycelium\)/.test(x)){x=x.replace(/var\(--mycelium\)/g,N('var(--mycelium)'));hit=true;}
      if(/--uv|f1eed6/.test(x)){x=x.replace(/#fbf8e6/g,'#cfc9b0').replace(/#f1eed6/g,'#bdb9a1');hit=true;}
      if(prop==='filter'&&/drop-shadow\(/.test(x)){const y=deepen(x);if(y!==x){x=y;hit=true;}}
      if(hit)keep.push(x);}
    if(keep.length){const k=r.sel+'|'+keep.join(';');if(!seen.has(k)){seen.add(k);out.push(r.sel+' { '+keep.join('; ')+'; }');}}}
  const grainDark=grainOf(siteCss,!!nightTiles);
  assert(out.length>40,'the night palette found only '+out.length+' paper rules; the site CSS changed shape (tools/taste-dark.mjs darkPalette)');
  return `
  :root {
    color-scheme: dark;
    ${Object.entries(TOKENS).map(([k,v])=>k+': '+v+';').join(' ')}
    --below: ${N('#553d26')}; --leaf-deep: ${N('#3f6b3f')}; --leaf-mid: ${N('#56894f')}; --leaf-bright: ${N('#b9d482')};
    --grain: ${grainDark};${nightTiles?`\n    --grain-tile-night: url(../assets/grain/${nightTiles[0]});`:''}
  }
${nightTiles?nightTiles.slice(1).map((name,i)=>`  @media (min-resolution: ${TILE_STEPS[i]}dppx), (-webkit-min-device-pixel-ratio: ${TILE_STEPS[i]}) { :root { --grain-tile-night: url(../assets/grain/${name}); } }\n`).join(''):''}  /* leaf tones: same six steps, same order, moonlit: a little cooler, the value spread kept */
  .t1 { --a: ${N('#3f6b3f')}; } .t2 { --a: ${N('#56894f')}; } .t3 { --a: ${N('#72a35f')}; }
  .t4 { --a: ${N('#9bb45c')}; } .t5 { --a: ${N('#b9d482')}; } .t6 { --a: oklch(from #ecd24a ${LC_GOLD} h); }
  .dialog, .leaftag, .card { --on: var(--ink); }
  .top { --leaf-deep: #a9d08f; }
  .cap { --cap-tone: ${N('#9bb45c')}; }
  .stratum--subsoil .cap, .stratum--clay .cap, .stratum--shale .cap, .stratum--bedrock .cap { --cap-tone: ${N('#56894f')}; }
  .finder input::placeholder { color: #46524a; }
  /* text on the sky, and the header strip */
  .top, .hero { color: var(--cream); }
  .top .brand { color: var(--cream); }
  .top::after { background: var(--grain), #1b2746; }
  @media (max-width: 860px) { .nav { background: var(--grain), #1b2746; } }
  /* the light strata read as dim sand and gravel at night, so their words turn cream like the others; the two bands sit a step lower
     on the night curve than the rest so cream on them meets WCAG AA (4.5:1), and the count on a chip is a little less faded */
  .stratum--sand, .stratum--gravel { --on: var(--cream); --on-soft: var(--cream); --rule: rgb(236 227 201 / .3); }
  .stratum--sand .card, .stratum--gravel .card { --on: var(--ink); }
  .deep .stratum--sand .soil > i, .deep .stratum--gravel .soil > i { background: var(--grain), linear-gradient(90deg, ${NS('var(--c)')} 12%, ${NS('var(--c2)')} 88%) calc(50% + var(--shift)) 0 / var(--sheet-w) 100% no-repeat; }
  .chip small { opacity: .8; }
  /* a hovered circle: the site sets --c to gold; on the night curve that needs a paler gold to land on the same lit look.
     The taste Network snap (.hw-taste-snap) mirrors the site's hover, so it gets the same. */
  .spore:hover, .spore:focus-visible, .spore.is-hit, .net .spore.hw-taste-snap { --c: #fff0a8; }
  .issue__cover img, .dialog figure img { filter: brightness(.9); }
${out.join('\n')}`;
}

// ============================================================ fireflies: keyframes from the knobs
const r3=x=>+x.toFixed(3);
export function fireflyTiming(F=FIREFLY){
  const burst=(F.flashes-1)*F.interval+F.swell+F.fade,cycle=F.lead+burst+F.dark,super_=cycle*F.order.length;
  const xs=F.homes.map(h=>h[0]),lo=Math.min(...xs),hi=Math.max(...xs);
  const offset=(pat,x)=>{const p=F.patterns[pat];assert(p,'FIREFLY.order names an unknown pattern '+pat);
    if(p.from==='left')return (x-lo)/(hi-lo)*F.wave;if(p.from==='right')return (hi-x)/(hi-lo)*F.wave;
    const far=Math.max(...xs.map(v=>Math.abs(v-p.origin)));return Math.abs(x-p.origin)/far*F.wave;};
  // per firefly: the start time of every flash in the super-cycle, and its swell/fade (a late straggler's first flash is shortened so it never runs into its second)
  const flashes=F.homes.map(([x],i)=>{const st=F.stragglers[i+1]||0,o=[];
    F.order.forEach((pat,b)=>{const t0=b*cycle+F.lead+offset(pat,x);for(let k=0;k<F.flashes;k++){let s=F.swell,f=F.fade,t=t0+k*F.interval;
      if(k===0&&st){t+=st;const room=F.interval-st-.02;if(s+f>room){const q=room/(s+f);s*=q;f*=q;}}
      o.push({t,s,f});}});
    return o;});
  return {burst,cycle,super:super_,flashes,offset};
}
function flashKeyframes(name,list,S){
  // keyframe selector lists keep it small: every swell start, every peak, every end share one block each
  const pc=t=>r3(t/S*100)+'%',starts=[],peaks=[],ends=['0%','100%'];
  let last=0;for(const {t,s,f} of list){assert(t>last+1e-6,'firefly flashes overlap ('+name+')');starts.push(pc(t));peaks.push(pc(t+s));ends.push(pc(t+s+f));last=t+s+f;}
  assert(last<S,'a firefly burst runs past the super-cycle');
  assert.equal(new Set([...starts,...peaks,...ends]).size,starts.length*3+2,'two firefly keyframes round to the same % ('+name+')');
  return `@keyframes ${name}{${ends}{opacity:0}${starts}{opacity:0;animation-timing-function:cubic-bezier(.45,0,.55,1)}${peaks}{opacity:1;animation-timing-function:cubic-bezier(.15,.55,.35,1)}}\n`;
}
// the firefly's paper: dark body, orange shield, pale lantern; and its pre-built halo (tiny bright core, soft halo at FIREFLY.haloPeak)
export const FIREFLY_BODY='linear-gradient(90deg, #d6d29a 0 22%, #3b2b1e 22% 72%, #e2813b 72%)';
export const fireflyHalo=(F=FIREFLY)=>{const core=1.3/(F.halo*11/2)*100,P=F.haloPeak;
  return `radial-gradient(circle closest-side, rgb(253 255 205) 0, rgb(246 252 160) ${r3(core*.55)}%, rgb(232 246 120 / ${P}) ${r3(core*1.15)}%, rgb(218 240 100 / ${r3(P*.55)}) 40%, rgb(205 233 88 / ${r3(P*.2)}) 68%, transparent 100%)`;};
export function fireflyCss(F=FIREFLY){
  const T=fireflyTiming(F),pc=t=>r3(t/T.cycle*100)+'%';
  const spread=(i,[a,b])=>a+(b-a)*((i*0.618034)%1);
  // halo box on the face (11 x 6.6 design units), centred on the lantern (the first 22% of the body); core = the lantern's ~1.3 unit radius
  const hw=F.halo*100,hh=F.halo*100*11/6.6;
  assert(F.swell+F.fade<F.interval,'FIREFLY.swell + fade must stay under interval');
  let css=`
  /* ===== fireflies: the bees' paper recut (dark body, orange shield, pale lantern), hovering lazily instead of foraging.
     One clock: every flash animation is ${r3(T.super)}s long and starts with the page; each firefly's own keyframes place its flashes
     by the burst's wave pattern and its x. Compositor only: transform and opacity. Knobs: FIREFLY in tools/taste-dark.mjs. ===== */
  .bees > .bee { animation: hw-ff-drift var(--hw-dd) ease-in-out var(--hw-ddl) infinite alternate; }
  .bee__bob { filter: none; animation: hw-ff-bob var(--hw-bp) ease-in-out var(--hw-bd) infinite alternate; }
  .bee__face { animation: hw-ff-lift ${r3(T.cycle)}s linear infinite; }
  .bee__body { background: ${FIREFLY_BODY}; }
  .bee__wing { animation: none; scale: 1 .55; background: rgb(236 242 214 / .5); }
  .bee__wing--b { background: rgb(226 236 214 / .45); }
  .bee__face::after { content: ""; position: absolute; left: ${r3(11-hw/2)}%; top: ${r3(50-hh/2)}%; width: ${r3(hw)}%; height: ${r3(hh)}%; pointer-events: none; opacity: 0;
    background: ${fireflyHalo(F)};
    animation: var(--hw-ffk) ${r3(T.super)}s linear infinite; }
  .bees.hw-ff-off .bee, .bees.hw-ff-off .bee *, .bees.hw-ff-off .bee__face::after { animation-play-state: paused; }   /* off-screen: everything holds (darkJs) */
  @keyframes hw-ff-drift {
    0% { translate: calc(var(--hw-x) - var(--hw-dx)) var(--hw-y); }
    31% { translate: calc(var(--hw-x) - .25 * var(--hw-dx)) calc(var(--hw-y) - var(--hw-dy)); }
    64% { translate: calc(var(--hw-x) + .45 * var(--hw-dx)) calc(var(--hw-y) + .6 * var(--hw-dy)); }
    100% { translate: calc(var(--hw-x) + var(--hw-dx)) calc(var(--hw-y) - .3 * var(--hw-dy)); }
  }
  @keyframes hw-ff-bob { to { translate: 0 ${F.bobHeight}%; } }
  @keyframes hw-ff-lift { 0% { translate: 0 0; } ${pc(F.lead*.5)} { translate: 0 0; animation-timing-function: cubic-bezier(.45,0,.55,1); } ${pc(F.lead+T.burst*.55)} { translate: 0 ${F.lift}%; animation-timing-function: cubic-bezier(.45,0,.55,1); } ${pc(Math.min(T.cycle-.2,F.lead+T.burst+1.6))} { translate: 0 0; } 100% { translate: 0 0; } }
`;
  F.homes.forEach(([x,y,dx,dy],i)=>{const n=i+1,dd=spread(i,F.drift),bp=spread(i+3,F.bob);
    css+=`  .bees > .bee:nth-child(${n}) { --hw-x: ${x}%; --hw-y: ${y}%; --hw-dx: ${dx}%; --hw-dy: ${dy}%; --hw-dd: ${r3(dd/2)}s; --hw-ddl: ${r3(-((i*7.3)%dd))}s; --hw-bp: ${r3(bp/2)}s; --hw-bd: ${r3(-((i*.83)%bp))}s; --hw-ffk: hw-ff-${n}; }\n`;});
  return {css:css+T.flashes.map((l,i)=>flashKeyframes('hw-ff-'+(i+1),l,T.super)).join(''),timing:T};
}

// ============================================================ the phone build (mobile/night.mjs loadNight): the same night, as data
// Shape (mobile/night.mjs): tokens (:root custom properties), lc/lcGold (the night curve for oklch(from <colour> <lc> h)), syncKeyframes (one
// burst cycle of glow-and-relief flashes, "opacity: 0;" between flashes, for the phone's single swarm element), stars, fireflyGlow, fireflyBody,
// critterCss + templates (the same critter art; classes only). The phone swarm is one element, so it flashes on the mean timing of a burst;
// the waves that change direction (FIREFLY.order) need one element per firefly, as in the taste build: syncFlashes lists each burst's per-firefly offsets.
export async function mobileNight({siteCss,nightTile=true}={}){
  assert(typeof siteCss==='string'&&siteCss.trim(),'mobileNight requires explicit authored paper CSS');
  const F=FIREFLY,T=fireflyTiming(F),pc=t=>r3(t/T.cycle*100)+'%';let kf=['0% { opacity: 0; }'];
  for(let k=0;k<F.flashes;k++){const t=F.lead+F.wave/2+k*F.interval;kf.push(`${pc(t)} { opacity: 0; animation-timing-function: cubic-bezier(.45,0,.55,1); }`,`${pc(t+F.swell)} { opacity: 1; animation-timing-function: cubic-bezier(.15,.55,.35,1); }`,`${pc(t+F.swell+F.fade)} { opacity: 0; }`);}
  kf.push('100% { opacity: 0; }');
  let seed=20260;const rnd=()=>(seed=(seed*1664525+1013904223)%4294967296)/4294967296,stars=[];   // the approved mock-up's seeded paper stars
  for(let i=0;i<54;i++){const x=(2+rnd()*96).toFixed(1),y=(3+rnd()*92).toFixed(1),big=rnd()<.14,r=big?1.5:(.6+rnd()*.7),a=(big?.95:.4+rnd()*.5).toFixed(2);stars.push(`radial-gradient(circle at ${x}% ${y}%, rgb(246 240 214 / ${a}) 0 ${r.toFixed(1)}px, transparent ${(r+.7).toFixed(1)}px)`);}
  const E=emitter(),templates=Object.fromEntries(['barred','screech','moth','bat','raccoon','rabbit'].map(k=>[k,E.html(CRITTERS[k](),['raccoon','rabbit'].includes(k)?'bug__face':'bird__face')]));
  return {tokens:{...TOKENS,'--below':N('#553d26'),'--grain':grainOf(siteCss,nightTile)},lc:LC,lcGold:LC_GOLD,
    syncKeyframes:kf.join('\n  '),syncSeconds:r3(T.cycle),syncFlashes:F.order.map(p=>({pattern:p,offsets:F.homes.map(([x])=>r3(T.offset(p,x)))})),
    stars:stars.join(', '),fireflyGlow:fireflyHalo(F),fireflyBody:FIREFLY_BODY,critterCss:E.css(),templates};
}

// ============================================================ the stylesheet
export function darkCss(siteCss,critterCss,nightTiles=null){
  const sized=Object.entries(SIZE).map(([k,w])=>{const [t,slot]=k.split('@'),cr=CRITTERS[t]();return `  .bird.hw-n-${t}-on-${slot} > .bird__bob:not(#hw-inline) { --hw-night-w: ${w}%; --hw-night-ar: ${cr.w} / ${cr.h}; width: ${w}%; aspect-ratio: ${cr.w} / ${cr.h}; }`;}).join('\n');
  const ff=FIREFLIES?fireflyCss().css:'';
  return `/* Optional designed dark mode. Generated by source/taste/taste-dark.mjs; edit there. */
/* night critter art (paper pieces + colours) and the ground walkers; the cottontail also walks by day */
${critterCss}.hw-nface { display: none; }
.hw-nx-walkers .bug--rare { animation-name: hw-rare-east; }
.hw-nx-walkers .bug--rare.bug--west { animation-name: hw-rare-west; }
@keyframes hw-rare-east { 0% { translate: -8% 0; } 24% { translate: 103% 0; } 100% { translate: 103% 0; } }
@keyframes hw-rare-west { 0% { translate: 103% 0; } 24% { translate: -8% 0; } 100% { translate: -8% 0; } }
@keyframes hw-hop { 0%, 100% { translate: 0 0; } 50% { translate: 0 -46%; } }
@keyframes hw-waddle { from { rotate: -1.6deg; } to { rotate: 1.6deg; } }
.bug--hop .bug__face { animation: hw-hop .7s ease-in-out infinite; }
.bug--hop .bug__legs { animation-duration: .35s; }
.bug--waddle .bug__face { animation: hw-waddle 1.1s ease-in-out infinite alternate; }
.bug--waddle .bug__legs { animation-duration: .4s; }
.hw-nw-rabbit { --dur: 260s; --delay: -18.2s; }
.hw-nw-raccoon { --dur: 330s; --delay: -26.4s; display: none; }
.hw-nwf-rabbit { top: 42.9%; width: 2.7%; aspect-ratio: 100 / 62; }
.hw-nwf-raccoon { top: 42.1%; width: 3.7%; aspect-ratio: 100 / 60; }
@media (prefers-reduced-motion: reduce) { .bee__face::after { animation-play-state: paused; } }
@supports (color: oklch(from red l c h)) {
:root { color-scheme: dark; }
${darkPalette(siteCss,nightTiles)}
  /* ===== night sky: owls, luna moths and one red bat fly the birds' own paths, bob and wing-beat ===== */
  .hw-night > .bird__bob > .bird__face:not(.hw-nface) { display: none; }
  .hw-night .hw-nface { display: block; }
${sized}
  .hw-n-moth .hw-nface .bird__wing { animation-duration: calc(var(--flap) * 2); }
  .hw-n-bat .hw-nface .bird__wing { animation-duration: calc(var(--flap) * 1.8); }
  .bird.hw-n-moth > .bird__bob { animation: bird-bob 1.9s ease-in-out infinite alternate; }
  .hw-nw-raccoon { display: block; }
${ff}
}
`;
}

// ============================================================ the script (parser-blocking in <head>, ~0.6 KB)
// 1. When the entry script chose night, <meta name="darkreader-lock"> asks Dark Reader to stand down.
//    The night-scoped root color-scheme also declares the intended native controls.
// 2. Fireflies hold still while the meadow is off-screen (one IntersectionObserver). Nothing runs per frame or per burst.
export function darkJs(){
  return `/* Optional designed dark mode. source/taste/taste-dark.mjs */
(()=>{"use strict";if(!(window.CSS&&CSS.supports("color","oklch(from red l c h)")))return;
if(document.documentElement.dataset.hwTheme==='night'&&!document.querySelector('meta[name="darkreader-lock"]')){const m=document.createElement("meta");m.name="darkreader-lock";document.head.append(m);}
let io=null;
const watch=()=>{const b=document.querySelector(".stage .bees");if(!b||io)return;
  io=new IntersectionObserver(e=>{if(e.length)b.classList.toggle("hw-ff-off",!e[e.length-1].isIntersecting);});io.observe(b);};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",watch,{once:true});else watch();})();
`;
}
