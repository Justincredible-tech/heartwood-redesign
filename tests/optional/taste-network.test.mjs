import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {extractNetwork,pick,tap,run,tasteSource,tasteCss,withSporeAt} from '../../tools/taste-network.mjs';

const html=await readFile(new URL('../../source/heartwood-site.html',import.meta.url),'utf8');
const css=await readFile(new URL('../../source/css/heartwood-site.css',import.meta.url),'utf8');
const page=html+'\n<style>\n'+css+'\n</style>\n';   // the maintained composition keeps markup and stylesheet in separate files; the tools parse one page source
const t0=performance.now(),N=extractNetwork(page),computeMs=performance.now()-t0;   // first call in this process: cold
const HINT=' If the Network was deliberately edited, update the expected counts in tools/taste-network.mjs, DEAD/hub/fade in tests/taste-network.test.mjs, and DEAD in tools/verify-taste.mjs.';
const DEAD=[1,5,9,11,21,27,31,35,41];   // pinned; also derived below from the markup so a drift names itself
const at=(r,deg)=>[N.cx+r*Math.cos(deg*Math.PI/180),N.cy+r*Math.sin(deg*Math.PI/180)];
const spore=i=>[N.spores[2*i],N.spores[2*i+1]];
const firsts=N.paths.map((k,i)=>[k,i]).filter(([k])=>!N.paths.some(o=>o!==k&&k.startsWith(o+' '))).map(([,i])=>i);
const root=i=>{while(N.segs[i].parent>=0)i=N.segs[i].parent;return i;};
// Distance from (x,y) to a segment's centreline at the pointer's circle (same arithmetic as pick, for constructing cases).
const dist=(s,x,y)=>{const r=Math.hypot(x-N.cx,y-N.cy);let d=1e9;if(r<s.r0||r>s.r1)return d;
  for(let k=0;k<6;k++){const a=s.r[k],b=s.r[k+1];if(a===b||(a-r)*(b-r)>0)continue;const u=(r-a)/(b-a);d=Math.min(d,Math.hypot(s.p[2*k]+u*(s.p[2*k+2]-s.p[2*k])-x,s.p[2*k+1]+u*(s.p[2*k+3]-s.p[2*k+1])-y));}
  return d;};

test('extraction matches the generated network',()=>{
  assert.equal(N.paths.length,106,'spore count.'+HINT);assert.equal(N.hub,81,'hub radius.'+HINT);
  assert(Math.abs(N.fade-58.1)<.5,'fade '+N.fade+'.'+HINT);
  assert(N.maxGap<6);
  assert(N.rin.length===720&&N.rout.length===720&&N.rin.every((v,k)=>v>N.hub&&v<=N.rout[k]),'inner/outer boundaries: 720 samples, hub < rin <= rout');
  assert.equal(N.dormant,'','the shipped layout fits the zone rules');assert(N.clearance>0&&N.uncovered.length===0);
  const onPath=new Set(N.paths.flatMap(k=>k.split(' ').map(Number))),strips=[...html.matchAll(/<i id="hy-(\d+)"/g)].map(m=>+m[1]);
  const dead=strips.filter(id=>!onPath.has(id)).sort((a,b)=>a-b);
  assert.deepEqual(dead,DEAD,'dead-end strips changed.'+HINT);
  assert.deepEqual(N.dead,dead);
  assert(N.segs.every(s=>!dead.includes(s.id)),'dead-end strips are never lit');
  assert(N.segs.every(s=>s.r0<s.r1&&s.t[0]>=0&&s.t[0]<s.t[6]&&s.t[6]<=100&&s.p.length===14&&s.r.length===7&&s.parent<N.segs.indexOf(s)));
  assert(N.segs.every(s=>s.parent<0||s.r0<=N.segs[s.parent].r1),'a child never starts past its parent tip (junction sliver clamped)');
});

test('no inner strip has a spore-bearing ancestor',()=>{
  const bearing=new Set(N.paths.map(k=>+k.split(' ').pop()));
  for(let i=0;i<N.segs.length;i++)for(let p=N.segs[i].parent;p>=0;p=N.segs[p].parent)assert(!bearing.has(N.segs[p].id),'strip '+N.segs[i].id);
});

test('zones: hub, outside, beyond the outermost spore',()=>{
  assert.deepEqual(pick(N,N.cx,N.cy),{zone:1});
  assert.deepEqual(pick(N,0,0),{zone:0});
  assert.deepEqual(pick(N,N.cx,N.cy+N.hub-1),{zone:1});
  let far=0,idx=0;
  for(let i=0;i<N.paths.length;i++){const r=Math.hypot(spore(i)[0]-N.cx,spore(i)[1]-N.cy);if(r>far){far=r;idx=i;}}
  const [sx,sy]=spore(idx),u=[(sx-N.cx)/far,(sy-N.cy)/far];
  assert.deepEqual(pick(N,sx+30*u[0],sy+30*u[1]),{zone:3,spore:idx});
  assert.deepEqual(pick(N,sx+120*u[0],sy+120*u[1]),{zone:0});
});

test('zone 3 is the buffers plus ENCLOSED pockets only: an outward notch between buffers is nothing, the enclosed pocket snaps',()=>{
  const inDisc=(x,y)=>N.paths.some((_,i)=>Math.hypot(spore(i)[0]-x,spore(i)[1]-y)<=N.fade);
  assert.deepEqual(N.holes.map(h=>h.hub),[0,0,1],'the discs wall the hub in (the largest hole) and enclose two pockets: about 1250 square units, and a speck where three buffers nearly meet');
  const notch=[288.5,669.5];   // the verifier's witness: 61.6 units from the nearest circle (B 58.1), between two buffers, open to the outside
  assert(!inDisc(...notch));assert.deepEqual(pick(N,...notch),{zone:0},'an outward notch is nothing');
  const v=N.holes[1].v,xs=v.filter((_,k)=>k%2===0),ys=v.filter((_,k)=>k%2===1);let inside=0;
  for(let y=Math.min(...ys);y<=Math.max(...ys);y++)for(let x=Math.min(...xs);x<=Math.max(...xs);x++){
    if(inDisc(x,y)||Math.hypot(x-N.cx,y-N.cy)<N.hub)continue;
    let w=0;for(let k=0;k<v.length;k+=2){const [x0,y0,x1,y1]=[v[k],v[k+1],v[(k+2)%v.length],v[(k+3)%v.length]];if((y0>y)!==(y1>y)&&x<x0+(y-y0)*(x1-x0)/(y1-y0))w++;}
    if(w%2){inside++;const z=pick(N,x,y,-1);assert.equal(z.zone,3,'pocket point '+x+','+y);}
  }
  assert(inside>50,'the pocket was sampled ('+inside+' points)');
});

test('every spore centre is zone 3 and snaps to itself (no spore sits on the root tree any more)',()=>{
  for(let i=0;i<N.paths.length;i++){const [x,y]=spore(i);assert.deepEqual(pick(N,x,y),{zone:3,spore:i},'spore '+i);}
});

test('growth: a ray from the hub to a first spore lights outward, ending on a valid tip',()=>{
  for(const i of firsts){
    const [x,y]=spore(i),deg=Math.atan2(y-N.cy,x-N.cx)*180/Math.PI,rmax=Math.hypot(x-N.cx,y-N.cy);
    let prev=-1,n=0,z2=0,chain=0,stop=0,seg=-1,rt=-1;
    for(let r=N.hub+1;r<rmax;r+=.5){
      const z=pick(N,...at(r,deg),prev);n++;
      if(z.zone===3)break;   // zone 2 runs unbroken from the hub edge until the ray enters a buffer
      assert.equal(z.zone,2,'zone 2 fills the space from the hub edge to the first buffer: r='+r);
      z2++;
      const s=N.segs[z.seg],len=(()=>{let c=1;for(let p=s.parent;p>=0;p=N.segs[p].parent)c++;return c;})();
      assert(r>=s.r0-.01&&r<=s.r1+.01,'tip strip spans the pointer circle');
      assert(z.stop>=0&&z.stop<=100,'stop '+z.stop);
      if(rt===root(z.seg)){assert(len>=chain,'chain shrank at r='+r);if(z.seg===seg)assert(z.stop>=stop,'stop went backwards on strip '+s.id+' at r='+r);}
      rt=root(z.seg);prev=z.seg;chain=len;seg=z.seg;stop=z.stop;
    }
    assert(z2>=20,'spore '+i+': only '+z2+' ray steps in zone 2 before its buffer');
  }
});

test('hysteresis: a point within best+4 of the previous strip keeps it; farther switches',()=>{
  let kept=0,switched=0;
  for(let y=40;y<720&&(kept<5||switched<5);y+=7)for(let x=40;x<1160;x+=7){
    const a=pick(N,x,y,-1);if(a.zone!==2)continue;
    const da=dist(N.segs[a.seg],x,y);
    for(let b=0;b<N.segs.length;b++){
      if(b===a.seg||N.segs[b].parent===a.seg||N.segs[a.seg].parent===b)continue;   // lineage is covered by the flicker test
      const db=dist(N.segs[b],x,y);if(db>1e8)continue;
      const z=pick(N,x,y,b);
      if(db<=da+4){assert.equal(z.seg,b,'prev within best+4 is kept');kept++;}
      else{assert.equal(z.seg,a.seg,'prev more than 4 farther loses');switched++;}
    }
  }
  assert(kept>=5&&switched>=5,'constructed both cases: kept '+kept+', switched '+switched);
});

test('no root flicker A to B to A when walking out every degree in 0.05 steps',()=>{
  for(let deg=0;deg<360;deg++){
    let prev=-1;const h=[];
    for(let r=N.hub+.5;r<N.rin[2*deg];r+=.05){
      const z=pick(N,...at(r,deg),prev);
      if(z.zone!==2){prev=-1;continue;}
      prev=z.seg;h.push(root(z.seg));
      const i=h.length-1;
      if(i&&h[i]!==h[i-1])for(let j=Math.max(0,i-10);j<i-1;j++)assert.notEqual(h[j],h[i],'root flicker at '+deg+' deg, r='+r.toFixed(2));
    }
  }
});

test('along first-spore rays, a parent or child of the current strip within best+4 keeps the light on its lineage',()=>{
  for(const i of firsts){
    const [x,y]=spore(i),deg=Math.atan2(y-N.cy,x-N.cx)*180/Math.PI,rmax=Math.hypot(x-N.cx,y-N.cy);
    let prev=-1;
    for(let r=N.hub+1;r<rmax-1;r+=.25){
      const p=at(r,deg),z=pick(N,...p,prev);
      if(z.zone!==2){prev=-1;continue;}
      if(prev>=0){
        const d=N.segs.map(s=>dist(s,...p)),best=Math.min(...d),lin=c=>c===prev||N.segs[c].parent===prev||N.segs[prev].parent===c;
        if(d.some((v,c)=>lin(c)&&v<=best+4))assert(lin(z.seg),'left the lineage of strip '+N.segs[prev].id+' toward spore '+i+' at r='+r);
      }
      prev=z.seg;
    }
  }
});

test('grid sweep returns only well-formed results',()=>{
  for(let y=0;y<=760;y+=5)for(let x=0;x<=1200;x+=5){
    const z=pick(N,x,y,-1);
    assert([0,1,2,3].includes(z.zone));
    if(z.zone===2){assert(z.seg>=0&&z.seg<N.segs.length&&Number.isInteger(z.stop)&&z.stop>=0&&z.stop<=100);assert(!DEAD.includes(N.segs[z.seg].id));}
    if(z.zone===3)assert(z.spore>=0&&z.spore<N.paths.length);
  }
});

test('zone computation is within budget (cold: extraction + boundaries + dormant check)',()=>{assert(computeMs<=250,'zone computation took '+computeMs.toFixed(1)+' ms (hard budget 250 ms, target 100)');});

test('dormant: a spore whose buffer reaches the hub makes the whole feature inert, loudly',()=>{
  const bad=withSporeAt(page,3,N.cx+100,N.cy),d=extractNetwork(bad);
  assert(/reaches the hub/.test(d.dormant),d.dormant);
  const warn=[],w=console.warn;console.warn=m=>warn.push(m);let src;try{src=tasteSource(bad);}finally{console.warn=w;}
  assert(/TASTE DORMANT/.test(warn.join()),'the build warns loudly');
  assert(!/\(\)=>|pick|addEventListener/.test(src.replace(/\/\*[\s\S]*?\*\//g,'')),'the shipped script has no code at all');
  new vm.Script(src);
  let touched=0;const guard=new Proxy({},{get(){touched++;return ()=>null;}});
  vm.runInNewContext(src,{matchMedia:()=>({matches:true}),document:guard,addEventListener:()=>touched++,requestAnimationFrame:()=>touched++});
  assert.equal(touched,0,'no listeners, no document access');
  assert.equal(extractNetwork(withSporeAt(page,3,N.cx+N.hub+N.fade+1,N.cy)).dormant,'','just outside the buffer rule is fine');
});

test('asset: header, compiles, ships the tested pick and run, and does nothing without hover',()=>{
  const src=tasteSource(page);
  assert(src.startsWith("/* Taste you didn't ask for: Network hover, the project’s opinion, opt-in. */\n"));
  new vm.Script(src);
  assert(src.includes(String(pick))&&src.includes(String(tap))&&src.includes(String(run)));
  assert(!src.includes('"dead"'),'dead list is test-only');
  let touched=0;
  const guard=new Proxy({},{get(){touched++;return ()=>null;}});
  vm.runInNewContext(src,{matchMedia:()=>({matches:false}),document:guard,addEventListener:()=>touched++,requestAnimationFrame:()=>touched++});
  assert.equal(touched,0);
});

test('lighting is class-driven: no colour-bearing inline write in run(), every class it sets is styled by the shipped stylesheet',()=>{
  const code=String(run),css=tasteCss();
  assert(!/style\.(background|color|scale|zIndex|cursor)|setProperty\(['"]--(c|paper|gold|mycelium)['"]/.test(code),'colour-rewriting extensions copy inline colour writes and keep them after removeProperty (Dark Reader left roots and spores stuck lit)');
  assert(!/color-mix|var\(--gold\)|var\(--grain\)/.test(code),'colours live in the stylesheet, not in run()');
  const setProps=[...code.matchAll(/setProperty\('(--[\w-]+)'/g)].map(m=>m[1]);
  assert.deepEqual([...setProps].sort(),['--hw-a','--hw-dx','--hw-dy','--hw-stop'],'the only inline properties are the tip angle, the tip percentage and the overlay placement (lengths)');
  const classes=new Set([...code.matchAll(/'(hw-taste-[\w-]+)'/g)].map(m=>m[1]));
  assert.deepEqual([...classes].sort(),['hw-taste-glow','hw-taste-pointer','hw-taste-snap','hw-taste-wc']);
  for(const c of classes)assert(css.includes('.'+c),'stylesheet styles .'+c);
  assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css.replace(/#000/g,'')),'stylesheet uses the site variables only (#000 appears only as the tip mask opaque stop, which paints nothing)');
});

test('stylesheet: no colour anywhere except the hub glow (and the snapped spore mirroring the site\'s own :hover variable); the overlay takes its colour from the site\'s .is-lit rule',()=>{
  const css=tasteCss(),rules=css.split('\n').filter(l=>/^[.@]/.test(l)&&!/hub\.hw-taste-glow|spore\.hw-taste-snap/.test(l));
  for(const r of rules)assert(!/var\(--(gold|mycelium|grain|paper|ink|sky|c)[\w-]*\)|color-mix|#[0-9a-f]{3,8}\b|rgba?\(|hsl|\bgold\b|\bred\b|\bblack\b|\bwhite\b|background(?!-origin)/i.test(r.replace(/#000/g,'')),'colour in a non-glow rule: '+r);
  assert(!/hw-taste-lit|hw-taste-tip/.test(css),'the old class-lit rules are gone');
  assert(/hw-taste-ov \{ filter: none; pointer-events: none; \}/.test(css),'overlay: no own filter (the base shadow is already underneath), never a hit target');
  assert(/hw-taste-ov\.hw-taste-wc \{ will-change: transform; \}/.test(css),'promotion is a class, added while the Network is in or near the viewport');
  const code=String(run);
  assert(/className='net__hyphae hw-taste-ov'/.test(code)&&/\.concat\('is-lit'\)/.test(code),'twins always carry the site\'s is-lit class');
  assert(/:scope > i\.is-lit/.test(code),'one-route enforcement is scoped to the base strips');
});

test('paint order: N.occ lists, for every live strip, the later strips that overlap it by about a square unit or more (finer grid cross-check); dead strips have no entry',()=>{
  const S=[];
  for(const m of html.matchAll(/<i id="hy-(\d+)" style="left:(-?[\d.]+)%;top:(-?[\d.]+)%;width:(-?[\d.]+)%;height:(-?[\d.]+)%;clip-path:polygon\(([^)]*)\)"/g)){
    const [bx,by,bw,bh]=[m[2]*N.w/100,m[3]*N.h/100,m[4]*N.w/100,m[5]*N.h/100];
    S.push({id:+m[1],P:m[6].split(',').map(s=>s.trim().split(/\s+/).map(parseFloat)).map(([x,y])=>[bx+bw*x/100,by+bh*y/100])});
  }
  const inside=(P,x,y)=>{let c=false;for(let i=0,j=P.length-1;i<P.length;j=i++){const [xi,yi]=P[i],[xj,yj]=P[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
  const area=(A,B)=>{let n=0;const xs=[...A.P,...B.P].map(p=>p[0]),ys=[...A.P,...B.P].map(p=>p[1]);for(let x=Math.min(...xs);x<Math.max(...xs);x+=.2)for(let y=Math.min(...ys);y<Math.max(...ys);y+=.2)if(inside(A.P,x,y)&&inside(B.P,x,y))n++;return n*.04;};
  const live=new Set(N.paths.flatMap(k=>k.split(' ').map(Number))),listed=new Set(Object.entries(N.occ).flatMap(([i,js])=>js.map(j=>i+'>'+j)));
  assert(Object.keys(N.occ).every(i=>live.has(+i)),'dead strips never get lit, so they have no occluder list');
  for(const [i,js] of Object.entries(N.occ))for(const j of js)assert(S.findIndex(s=>s.id===+i)<S.findIndex(s=>s.id===j),'an occluder comes later in markup order: '+i+' '+j);
  let big=0;
  for(let a=0;a<S.length;a++)if(live.has(S[a].id))for(let b=a+1;b<S.length;b++){
    const x0=Math.max(...[S[a],S[b]].map(s=>Math.min(...s.P.map(p=>p[0])))),x1=Math.min(...[S[a],S[b]].map(s=>Math.max(...s.P.map(p=>p[0])))),y0=Math.max(...[S[a],S[b]].map(s=>Math.min(...s.P.map(p=>p[1])))),y1=Math.min(...[S[a],S[b]].map(s=>Math.max(...s.P.map(p=>p[1]))));
    if(x0>=x1||y0>=y1)continue;
    const ar=area(S[a],S[b]),key=S[a].id+'>'+S[b].id;
    if(ar>=1.6){big++;assert(listed.has(key),'overlap '+ar.toFixed(2)+' not listed: '+key);}
    if(listed.has(key))assert(ar>=.5,'listed pair '+key+' overlaps only '+ar.toFixed(2));
  }
  assert(big>=20&&JSON.stringify(N.occ).length<2000,'many fan-out overlaps at the hub ('+big+'), a small table ('+JSON.stringify(N.occ).length+' bytes)');
  assert(N.occ[13].includes(14)&&N.occ[13].includes(15),'the root strips 13, 14, 15 fan out over each other (the pair that showed gold over a neighbouring root)');
});

// The shipped run() in a minimal fake page (stage = 1200 x 760 client px at 0,0, so client px are stage units): what it leaves behind after taps, scrolls and resizes.
// io: the page has IntersectionObserver (P.see(true|false) moves the stage into or out of the observed band); near: the stage starts in it (a page scrolled to the Network).
function fakePage({hover,io=true,near=true}){
  const pd=[];
  class CL{constructor(){this.s=new Set();}add(...k){for(const x of k)this.s.add(x);}remove(...k){for(const x of k)this.s.delete(x);}contains(k){return this.s.has(k);}toggle(k,f){if(f??!this.s.has(k))this.s.add(k);else this.s.delete(k);}[Symbol.iterator](){return this.s[Symbol.iterator]();}}
  class El{
    constructor(tag,id='',cls=''){this.tagName=tag;this.id=id;this.classList=new CL();for(const c of cls.split(' ').filter(Boolean))this.classList.add(c);this.children=[];this.parentNode=null;this.dataset={};this.attrs={};this.ls={};this.rect={left:0,top:0,width:0,height:0};
      const st=new Map(),sync=()=>{if(st.size)this.attrs.style=[...st].map(([a,b])=>a+': '+b+';').join(' ');else if('style' in this.attrs)this.attrs.style='';};
      this.style={setProperty:(k,v)=>{st.set(k,v);sync();},removeProperty:k=>{st.delete(k);sync();},getPropertyValue:k=>st.get(k)||''};}
    set className(v){this.classList.s=new Set(v.split(' ').filter(Boolean));}
    setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
    append(...cs){for(const c of cs){c.parentNode=this;this.children.push(c);}}after(c){const p=this.parentNode;c.parentNode=p;p.children.splice(p.children.indexOf(this)+1,0,c);}
    contains(o){for(;o;o=o.parentNode)if(o===this)return true;return false;}
    matches(sel){return sel.split(',').some(s=>{s=s.trim();return s==='[data-open]'?'open' in this.dataset:s.startsWith('.')&&this.classList.contains(s.slice(1));});}
    closest(sel){for(let e=this;e;e=e.parentNode)if(e.matches(sel))return e;return null;}
    all(){return this.children.flatMap(c=>[c,...c.all()]);}
    querySelectorAll(sel){return sel===':scope > i.is-lit'?this.children.filter(c=>c.classList.contains('is-lit')):this.all().filter(e=>e.matches(sel));}
    querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
    addEventListener(t,f,o){(this.ls[t]??=[]).push({f,capture:o===true||!!o?.capture});}
    dispatchEvent(e){e.target??=this;for(const l of this.ls[e.type]||[])l.f(e);return true;}
    getBoundingClientRect(){return this.rect;}blur(){}click(){this.clicks=(this.clicks||0)+1;}
  }
  const doc=new El('#document'),body=new El('body'),net=new El('section','net'),stage=new El('div','','net__stage'),hub=new El('div','','net__hub'),hy=new El('div','','net__hyphae'),outside=new El('a','','link');
  doc.append(body);body.append(net,outside);net.append(stage);stage.append(hy,hub);stage.rect={left:0,top:0,width:N.w,height:N.h};hy.rect={left:10.25,top:20.4,width:N.w,height:N.h};
  for(const id of new Set([...N.paths.flatMap(p=>p.split(' ')),...Object.keys(N.occ),...Object.values(N.occ).flat()].map(String)))hy.append(new El('i','hy-'+id,'s'+id));
  const spores=N.paths.map(p=>{const b=new El('button','','spore');b.dataset.path=p;b.dataset.open='';stage.append(b);return b;});
  const byId=id=>doc.all().find(e=>e.id===id)||null;
  Object.assign(doc,{getElementById:byId,createElement:t=>new El(t),activeElement:body});
  let rafs=[];const ros=[],ios=[];
  class RO{constructor(cb){this.cb=cb;this.on=new Set();ros.push(this);}observe(el){this.on.add(el);}unobserve(el){this.on.delete(el);}disconnect(){this.on.clear();}}
  class IO{constructor(cb,opts){this.cb=cb;this.opts=opts;this.on=new Set();ios.push(this);}observe(el){this.on.add(el);}unobserve(el){this.on.delete(el);}disconnect(){this.on.clear();}}
  class PointerEvent{constructor(type,init={}){Object.assign(this,{isTrusted:false,isPrimary:true,timeStamp:0,...init,type});}preventDefault(){pd.push(this.type);}}
  const win={document:doc,matchMedia:q=>({matches:q==='(hover: hover)'?hover:q==='(any-pointer: coarse)'}),requestAnimationFrame:f=>{rafs.push(f);return rafs.length;},cancelAnimationFrame:()=>{},
    scrollX:0,scrollY:0,ResizeObserver:RO,PointerEvent,console,ls:{},addEventListener:(t,f,o)=>{(win.ls[t]??=[]).push({f,capture:o===true||!!o?.capture});}};
  if(io)win.IntersectionObserver=IO;
  win.window=win;
  // capture on the document, then bubble from the target up, then the window
  const fire=(target,type,init={})=>{const e=new PointerEvent(type,{isTrusted:true,target,...init});
    for(const l of doc.ls[type]||[])if(l.capture)l.f(e);
    for(let n=target;n&&n!==doc;n=n.parentNode)for(const l of n.ls[type]||[])if(!l.capture)l.f(e);
    for(const l of doc.ls[type]||[])if(!l.capture)l.f(e);for(const l of win.ls[type]||[])l.f(e);return e;};
  const flush=()=>{const q=rafs;rafs=[];for(const f of q)f(0);};
  vm.runInNewContext('('+run+')(N,pick,tap)',Object.assign(win,{N,pick,tap}));
  const see=v=>{for(const o of ios)if(o.on.has(stage))o.cb([{target:stage,isIntersecting:v}]);};   // a browser reports the observed stage once on observe(), then on every change
  see(near);
  const ov=()=>hy.parentNode.children.find(c=>c.classList.contains('hw-taste-ov'));
  const state=()=>{const o=ov();return {snapped:spores.filter(s=>s.classList.contains('hw-taste-snap')).length,on:o?o.all().filter(c=>c.classList.contains('on')||c.classList.contains('tip')).length:0,promoted:!!o&&o.classList.contains('hw-taste-wc'),style:o?o.getAttribute('style'):null,observed:ros.reduce((n,r)=>n+r.on.size,0)};};
  return {fire,flush,stage,hy,outside,spores,state,ov,ros,ios,see,pd,win};
}
const rest={snapped:0,on:0,promoted:false,style:null,observed:0};   // off-screen (or no overlay yet): nothing lit, nothing promoted, nothing observed
const ready={...rest,promoted:true,style:'--hw-dx: 0.25px; --hw-dy: 0.3999999999999986px;',observed:1};   // on screen with the overlay built: promoted and placed, nothing lit
const emptyZone3=(()=>{for(let i=0;i<N.paths.length;i++){const [x,y]=spore(i),r=Math.hypot(x-N.cx,y-N.cy);for(const d of [30,24,36]){const p=[x+d*(x-N.cx)/r,y+d*(y-N.cy)/r];if(pick(N,...p,-1).zone===3)return p;}}})();
const tapAt=(P,target,[x,y],id=1)=>{P.fire(target,'pointerdown',{pointerType:'touch',clientX:x,clientY:y,pointerId:id,timeStamp:0});P.fire(target,'pointerup',{pointerType:'touch',clientX:x,clientY:y,pointerId:id,timeStamp:80});};

test('touch: a tap outside the stage clears the preview (circle, label, lit strips) without cancelling anything; a second finger outside ends the tap',()=>{
  for(const where of ['background','link']){
    const P=fakePage({hover:false});
    assert.deepEqual(P.state(),rest,'touch-only: no overlay before the first preview');
    tapAt(P,P.stage,emptyZone3);
    assert.deepEqual([P.state().snapped,P.state().promoted],[1,true],'a tap in empty zone-3 space previews');assert(P.state().on>0);
    const t=where==='link'?P.outside:P.outside.parentNode;
    const e=P.fire(t,'pointerdown',{pointerType:'touch',clientX:5,clientY:900,pointerId:2});P.fire(t,'pointerup',{pointerType:'touch',clientX:5,clientY:900,pointerId:2});
    assert.deepEqual(P.state(),ready,'tap on the '+where+' outside the stage: nothing previewed or lit (the overlay stays promoted while the Network is on screen)');
    assert.deepEqual(P.pd,[],'nothing is preventDefault-ed');assert(!e.defaultPrevented);
    P.see(false);assert.deepEqual(P.state(),rest,'the Network leaves the screen: demoted');
  }
  const P=fakePage({hover:false});
  P.fire(P.stage,'pointerdown',{pointerType:'touch',clientX:emptyZone3[0],clientY:emptyZone3[1],pointerId:1});
  P.fire(P.outside,'pointerdown',{pointerType:'touch',clientX:5,clientY:900,pointerId:2,isPrimary:false});
  P.fire(P.stage,'pointerup',{pointerType:'touch',clientX:emptyZone3[0],clientY:emptyZone3[1],pointerId:1,timeStamp:80});
  assert.equal(P.state().snapped,0,'a gesture with a second finger outside is not a tap');
});

test('no promoted overlay while the Network is off-screen: promoted only in or near the viewport; a release clears the light but keeps the promotion there; leaving the band demotes',()=>{
  const off=fakePage({hover:true,near:false});
  assert.deepEqual(off.state(),rest,'loaded with the Network off-screen: overlay built, nothing promoted or observed (the faithful page)');
  assert.deepEqual(off.ios.map(o=>[o.on.has(off.stage),o.opts.rootMargin]),[[true,'50% 0px']],'one observer on the stage, half a viewport of margin above and below');
  off.see(true);assert.deepEqual(off.state(),ready,'scrolled near: promoted and placed before any light, so no first-light promotion frame');
  off.see(false);assert.deepEqual(off.state(),rest,'scrolled away: demoted, unobserved, no placement left');
  for(const [name,act] of [['scroll',P=>{for(const l of P.win.ls.scroll)l.f({});}],['window blur',P=>{for(const l of P.win.ls.blur)l.f({});}]]){
    const P=fakePage({hover:false});tapAt(P,P.stage,emptyZone3);assert(P.state().promoted&&P.state().on);
    act(P);assert.deepEqual(P.state(),ready,name+' leaves nothing lit; the promotion stays while on screen');
    P.see(false);assert.deepEqual(P.state(),rest,name+', then off-screen: nothing promoted');
  }
  const lit=fakePage({hover:false});tapAt(lit,lit.stage,emptyZone3);assert(lit.state().on);
  lit.see(false);assert.deepEqual(lit.state(),rest,'leaving the band with a preview showing releases it and demotes');
  const old=fakePage({hover:true,io:false});   // no IntersectionObserver: the earlier rule (promoted from the first light, demoted by every release)
  assert.deepEqual(old.state(),rest);
  const deg=Math.atan2(spore(firsts[0])[1]-N.cy,spore(firsts[0])[0]-N.cx),z2=[N.cx+(N.hub+20)*Math.cos(deg),N.cy+(N.hub+20)*Math.sin(deg)];
  old.fire(old.stage,'pointermove',{pointerType:'mouse',clientX:z2[0],clientY:z2[1]});old.flush();assert(old.state().promoted);
  old.fire(old.stage,'pointerleave',{pointerType:'mouse'});assert.deepEqual(old.state(),rest,'without IntersectionObserver a release demotes');
});

test('placement: re-measured when the stage resizes while promoted (resize, zoom, DPR), and nothing observed off-screen',()=>{
  const P=fakePage({hover:true});
  assert.deepEqual(P.state(),ready,'on screen at load: promoted, placed and watching the stage box, nothing lit');
  const deg=Math.atan2(spore(firsts[0])[1]-N.cy,spore(firsts[0])[0]-N.cx),z2=[N.cx+(N.hub+20)*Math.cos(deg),N.cy+(N.hub+20)*Math.sin(deg)];
  assert.equal(pick(N,...z2,-1).zone,2);
  P.fire(P.stage,'pointermove',{pointerType:'mouse',clientX:z2[0],clientY:z2[1]});P.flush();
  assert.deepEqual([P.state().promoted,P.state().observed],[true,1],'the first light changes nothing about the promotion');
  assert.equal(P.ov().style.getPropertyValue('--hw-dx'),'0.25px');
  P.hy.rect={...P.hy.rect,left:10.75,top:20.1};for(const r of P.ros)if(r.on.size)r.cb([]);
  assert.deepEqual([P.ov().style.getPropertyValue('--hw-dx'),P.ov().style.getPropertyValue('--hw-dy')],['-0.25px','0.10000000000000142px'],'a resize mid-hover re-places the overlay');
  P.hy.rect={...P.hy.rect,left:11.4};for(const l of P.win.ls.resize)l.f({});   // the window resized and the stage moved without changing size (no ResizeObserver callback)
  assert.equal(P.ov().style.getPropertyValue('--hw-dx'),'0.40000000000000036px','a window resize re-places the overlay');
  P.fire(P.stage,'pointerleave',{pointerType:'mouse'});
  assert.deepEqual({...P.state(),style:null},{...ready,style:null},'leaving the stage: nothing lit, still promoted and observed (on screen)');
  P.hy.rect={...P.hy.rect,left:10.25};P.fire(P.stage,'pointermove',{pointerType:'mouse',clientX:z2[0],clientY:z2[1]});P.flush();
  assert.equal(P.ov().style.getPropertyValue('--hw-dx'),'0.25px','a layout shift between sessions is picked up when the next session starts');
  P.see(false);assert.deepEqual(P.state(),rest,'off-screen: demoted, unobserved, no placement left');
});

test('lag gate (verify-taste-lag): no frame over 50 ms at all, lag p95 within two frames, too few samples is UNSUPPORTED (never a pass), and the alternate sweep must alternate',async()=>{
  // import only a module that guards its browser run (an unguarded one would start the whole benchmark on import)
  assert(/export function judgeLag/.test(await readFile(new URL('../../tools/verify-taste-lag.mjs',import.meta.url),'utf8'))&&/import\.meta\.filename===resolve\(process\.argv\[1\]\)/.test(await readFile(new URL('../../tools/verify-taste-lag.mjs',import.meta.url),'utf8')),'verify-taste-lag exports its budget judgement and runs the browser only as a script');
  const {judgeLag,BUDGET}=await import('../../tools/verify-taste-lag.mjs');
  assert.deepEqual(BUDGET,{frameP95:25,frameMax:50,lagP95:33.4,minSamples:40});
  const ok={combo:'1424x820@2:plain',variant:'taste',sweep:'default',frames:{count:300,p95:16.7,over50:0,max:33.4},elapsedMs:5000,inputsDispatched:150,lightChangeFrames:120,lagMs:{p95:30},errors:[]};
  assert.deepEqual(judgeLag(ok),[]);
  for(const invalid of [null,{...ok,frames:{...ok.frames,p95:NaN,max:NaN},lagMs:{p95:NaN}},{...ok,frames:{...ok.frames,count:0}},{...ok,inputsDispatched:0},{...ok,elapsedMs:0},{...ok,frames:{...ok.frames,max:100,over50:0}}])assert(judgeLag(invalid).length,'invalid/absent evidence cannot pass');
  assert.match(judgeLag({...ok,frames:{p95:16.7,over50:1,max:66.7}}).join(),/1 frame\(s\) over 50 ms \(max 66\.7\)/,'one long frame fails (the old gate allowed one)');
  assert.match(judgeLag({...ok,lightChangeFrames:26,lagMs:{p95:39.5}}).join(),/UNSUPPORTED: only 26 light changes/,'too few samples fails (the old gate skipped the lag check)');
  assert.match(judgeLag({...ok,lagMs:{p95:34.3}}).join(),/lag p95 34\.3 ms > 33\.4/,'34.3 ms is over two frames (the old gate allowed 36)');
  assert.match(judgeLag({...ok,sweep:'alternate',alternations:150,lightChangeFrames:41}).join(),/did not alternate/);
});
