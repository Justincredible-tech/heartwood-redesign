/** Taste you didn't ask for: Tree hover, the project’s opinion, opt-in. See BUILD.md.
 * A hovered leaf that sits partly under the front wood sheet comes out in front of the branch: it slides out from under
 * the paper, swaps to a copy above the wood, and tucks back; on leaving it does the reverse. Leaves nothing covers keep
 * the site's own hover untouched.
 * treeData() reads the generated markup at build time (even-odd raster, a port of
 * output/playwright/review-taste-tree/occlusion.py); runTree() is shipped verbatim (Function#toString) like pick()/run()
 * in taste-network.mjs, so the tests exercise the browser code.
 */
import assert from 'node:assert/strict';

const CAP=.1,MIN_COVER=.005,SHADOW=[1.6,2.8,2.2],LEAVES=149,r1=v=>Math.round(v*10)/10;
const HINT=' If the tree art was deliberately edited, update the expected counts and markers in tools/taste-tree.mjs, then the pinned table in tests/taste-tree.test.mjs (see "Taste you didn\'t ask for" in tools/BUILD.md).';
const WOOD='<div class="scene bigtree" aria-hidden="true" style="z-index:4">',woodCache=new Map();

// Build time: the leaf geometry the site's own stylesheet gives every leaf, read from the page (never assumed): the artwork box (.stage aspect-ratio, W x H design px),
// --leaf-ar and --leaf-shape (the cascade's winner among top-level :root rules), the .leaf box/anchor/transform the table's model relies on, and the hover pose (tilt, grow).
// Any other form is unsupported and fails loudly, naming the declaration.
export function leafGeometry(html){
  const css=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g,'');
  const top=[];for(let i=0,depth=0,start=0,body=0;i<css.length;i++){const c=css[i];   // top-level rules: [selector, body] (an at-rule's body keeps its nested rules)
    if(c==='{'){if(!depth++){top.push([css.slice(start,i).trim().replace(/\s+/g,' ')]);body=i+1;}}else if(c==='}'&&!--depth){top.at(-1).push(css.slice(body,i));start=i+1;}}
  const decls=sel=>top.filter(r=>r[0]===sel).flatMap(r=>r[1].split(';').map(d=>d.trim()).filter(Boolean).map(d=>{const k=d.indexOf(':');return [d.slice(0,k).trim(),d.slice(k+1).trim().replace(/\s+/g,' ')];}));
  const last=(sel,name)=>decls(sel).filter(d=>d[0]===name).map(d=>d[1]).at(-1);
  const rootVar=name=>{const v=last(':root',name),n=decls(':root').filter(d=>d[0]===name).length,all=css.split(new RegExp(name+'\\s*:')).length-1;
    assert(v!==undefined,name+' is not set on :root.'+HINT);
    assert.equal(all,n,name+' is set outside a top-level :root rule (in a media query or on another element): the Tree taste table cannot model that.'+HINT);return v;};
  const ar=rootVar('--leaf-ar');
  assert(/^(\d+(\.\d+)?|\.\d+)$/.test(ar)&&+ar>0,'--leaf-ar is "'+ar+'"; the Tree taste table supports a plain positive number (width / length).'+HINT);
  const shape=/^polygon\(([^)]*)\)$/.exec(rootVar('--leaf-shape'));
  assert(shape,'--leaf-shape is not a polygon().'+HINT);
  const LEAF=shape[1].split(',').map(p=>p.trim().split(/\s+/).map(t=>/^-?[\d.]+%$/.test(t)?parseFloat(t)/100:NaN));
  assert(LEAF.length>3&&LEAF.every(p=>p.length===2&&p.every(Number.isFinite)),'--leaf-shape is not a plain polygon of percentages.'+HINT);
  const stage=/^(\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?)$/.exec(last('.stage','aspect-ratio')||'');
  assert(stage,'.stage aspect-ratio is not "W / H".'+HINT);
  const want={'--angle':'calc(var(--r) * 1deg)',left:'calc(var(--x) * 1%)',top:'calc(var(--y) * 1%)',width:'calc(var(--s) * var(--leaf-ar) * 1%)','aspect-ratio':'var(--leaf-ar)','transform-origin':'50% 100%',transform:'translate(-50%, -100%) rotate(var(--angle))'};
  for(const [k,v] of Object.entries(want))assert.equal(last('.leaf',k),v,'.leaf '+k+' changed from "'+v+'": the Tree taste table models a leaf as that box, anchored at its stem.'+HINT);
  const hover=top.filter(r=>/^@media \(hover: ?hover\)$/.test(r[0])).map(r=>/(?:^|\})\s*button\.leaf:hover\s*\{([^{}]*)\}/.exec(r[1])).find(Boolean);
  assert(hover,'The original "@media (hover: hover) { button.leaf:hover { ... } }" rule is gone.'+HINT);
  const tf=hover[1].split(';').map(d=>d.trim()).find(d=>/^transform\s*:/.test(d))?.replace(/^transform\s*:\s*/,'').replace(/\s+/g,' ');
  const pose=/^translate\(-50%, -100%\) rotate\(calc\(var\(--angle\) \+ (-?\d+(?:\.\d+)?)deg\)\) scale\((\d+(?:\.\d+)?)\)$/.exec(tf||'');
  assert(pose,'The leaf hover transform is "'+tf+'"; the Tree taste table supports translate(-50%, -100%) rotate(calc(var(--angle) + Ndeg)) scale(S).'+HINT);
  return {W:+stage[1],H:+stage[2],AR:+ar,LEAF,TILT:+pose[1],GROW:+pose[2]};
}

// Even-odd scanlines of one polygon (grid px). fn(row,from,to) gets disjoint pixel runs [from,to), sampled at pixel centres.
function spans(P,GW,GH,fn){
  let lo=Infinity,hi=-Infinity;for(const p of P){if(p[1]<lo)lo=p[1];if(p[1]>hi)hi=p[1];}
  const n=P.length,xs=[];
  for(let row=Math.max(0,Math.trunc(lo)),last=Math.min(GH-1,Math.trunc(hi)+1);row<=last;row++){
    const yc=row+.5;xs.length=0;
    for(let i=0;i<n;i++){const a=P[i],b=P[(i+1)%n];if((a[1]<=yc&&b[1]>yc)||(b[1]<=yc&&a[1]>yc))xs.push(a[0]+(yc-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
    xs.sort((p,q)=>p-q);let end=0;
    for(let k=0;k+1<xs.length;k+=2){const a=Math.max(end,Math.ceil(xs[k]-.5)),b=Math.min(GW,Math.floor(xs[k+1]-.5)+1);if(b>a){fn(row,a,b);end=b;}}
  }
}

// The front wood sheet as a mask: every .cut is the XOR of its pieces' even-odd fills, the sheets are OR'd.
function woodMask(front,K,W,H){
  const key=[K,W,H,front].join(),hit=woodCache.get(key);if(hit)return hit;
  const GW=W*K,GH=H*K,wood=new Uint8Array(GW*GH),sheet=new Uint8Array(GW*GH);
  let cuts=0,pieces=0;
  for(const s of front.matchAll(/<div class="cut ([^"]+)">(.*?)<\/div>/g)){
    cuts++;sheet.fill(0);
    for(const m of s[2].matchAll(/<i style="left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%;clip-path:polygon\(((?:evenodd,)?[^)]*)\)"/g)){
      pieces++;const [l,t,w,h]=[1,2,3,4].map(i=>parseFloat(m[i]));
      const P=m[5].replace('evenodd,','').split(',').map(p=>{const [a,b]=p.trim().split(/\s+/);return [(l+w*parseFloat(a)/100)*W/100*K,(t+h*parseFloat(b)/100)*H/100*K];});
      spans(P,GW,GH,(row,a,b)=>{for(let i=row*GW+a,e=row*GW+b;i<e;i++)sheet[i]^=1;});
    }
    for(let i=0;i<sheet.length;i++)wood[i]|=sheet[i];
  }
  assert(cuts>0&&pieces>0,'No wood sheet pieces found after the front wood marker.'+HINT);
  assert.equal(front.split('<i style=').length-1,pieces,'Some wood pieces in the front sheet do not parse (expected <i style="left:..;top:..;width:..;height:..;clip-path:polygon(..)">).'+HINT);
  woodCache.clear();woodCache.set(key,wood);return wood;
}

// Build time. Returns {T, rows}. T[id]=[x,y]: the slide, in % of the leaf's own (unrotated) box, for every leaf the wood covers at the hover pose
// (at least 0.5%), plus [0,0] for leaves only in the wood's drop shadow. rows[]: every leaf with its cover at hover and at the switch moment.
export function treeData(html,{K=2}={}){
  const {W,H,AR,LEAF,TILT,GROW}=leafGeometry(html),GW=W*K,GH=H*K;
  const a=html.indexOf(WOOD),b=html.indexOf('<!-- ===== end generated',a);
  assert(a>0&&b>a,'The front wood sheet marker (<div class="scene bigtree" aria-hidden="true" style="z-index:4"> ... <!-- ===== end generated) is gone.'+HINT);
  const t0=html.indexOf('<div class="tree bigtree"'),t1=html.indexOf('<div class="scene bigtree"',t0);
  assert(t0>0&&t1>t0,'The tree / front wood sheet structure changed.'+HINT);
  const tree=html.slice(t0,t1),leaves=[...tree.matchAll(/<button class="leaf ([^"]*)" type="button" data-leaf="(\d+)"[^>]*style="--x:([-\d.]+);--y:([-\d.]+);--r:([-\d.]+);--s:([-\d.]+)/g)].map(m=>({id:+m[2],x:+m[3],y:+m[4],r:+m[5],s:+m[6]}));
  assert.equal(tree.split('data-leaf="').length-1,leaves.length,'Some tree leaf buttons do not parse (expected class, type, data-leaf, then style="--x;--y;--r;--s").'+HINT);
  assert.equal(leaves.length,LEAVES,'expected '+LEAVES+' tree leaves, found '+leaves.length+'.'+HINT);
  const wood=woodMask(html.slice(a,b),K,W,H);
  const poly=(L,extra=0,sc=1,off=[0,0])=>{
    const w=L.s*AR/100*W,h=w/AR,X=L.x/100*W+off[0],Y=L.y/100*H+off[1],ang=(L.r+extra)*Math.PI/180,c=Math.cos(ang),s=Math.sin(ang);
    return {w,h,P:LEAF.map(([px,py])=>{const vx=(px-.5)*w*sc,vy=(py-1)*h*sc;return [(X+vx*c-vy*s)*K,(Y+vx*s+vy*c)*K];})};
  };
  // pixels of the leaf under the wood, and the centroids of both (stage units)
  const scan=P=>{
    let area=0,hit=0,lx=0,ly=0,ox=0,oy=0;
    spans(P,GW,GH,(row,x0,x1)=>{for(let x=x0;x<x1;x++){area++;lx+=x;ly+=row;if(wood[row*GW+x]){hit++;ox+=x;oy+=row;}}});
    return {area,hit,frac:area?hit/area:0,lc:[lx/area/K,ly/area/K],oc:hit?[ox/hit/K,oy/hit/K]:null};
  };
  const [sx,sy,sr]=[Math.round(SHADOW[0]*K),Math.round(SHADOW[1]*K),Math.round(SHADOW[2]*K)];
  const inShadow=P=>{let any=false;   // a leaf pixel (not wood) within sr of the sheet shifted by the drop-shadow offset
    spans(P,GW,GH,(row,x0,x1)=>{for(let x=x0;x<x1&&!any;x++){if(wood[row*GW+x])continue;
      for(let dy=-sr;dy<=sr&&!any;dy++)for(let dx=-sr;dx<=sr;dx++){if(dx*dx+dy*dy>sr*sr)continue;const yy=row-dy-sy,xx=x-dx-sx;if(yy>=0&&yy<GH&&xx>=0&&xx<GW&&wood[yy*GW+xx]){any=true;break;}}}});
    return any;};
  const T={},rows=[];
  for(const L of leaves){
    const {w,h,P}=poly(L,TILT,GROW),hov=scan(P),row={id:L.id,hover:hov.frac,switch:hov.frac,shadow:false,v:null};rows.push(row);
    if(hov.hit){
      const d0=[hov.lc[0]-hov.oc[0],hov.lc[1]-hov.oc[1]],nn=Math.hypot(...d0)||1,centroid=[Math.round(d0[0]/nn*1e3)/1e3,Math.round(d0[1]/nn*1e3)/1e3];
      const cands=[centroid,...Array.from({length:16},(_,k)=>[Math.cos(k*Math.PI/8),Math.sin(k*Math.PI/8)])];
      let best=null;
      for(const n of cands){
        let d=CAP*h;
        for(let t=.5;t<=d+1e-9;t+=.5)if(!scan(poly(L,TILT,GROW,[n[0]*t,n[1]*t]).P).hit){d=t;break;}   // stop once clear: never slide further than needed
        const res=scan(poly(L,TILT,GROW,[n[0]*d,n[1]*d]).P).frac;
        if(!best||res<best[0]-1e-3||(Math.abs(res-best[0])<=1e-3&&d<best[2]))best=[res,n,d];
      }
      row.switch=best[0];
      if(hov.frac>=MIN_COVER){row.v=T[L.id]=[r1(100*best[1][0]*best[2]/w),r1(100*best[1][1]*best[2]/h)];row.d=best[2];row.len=h;}
    }else if(inShadow(P)){row.shadow=true;row.v=T[L.id]=[0,0];}
  }
  assert(Object.keys(T).length>0,'No tree leaf is covered by the front wood sheet: the raster found nothing, so the wood marker or geometry has changed.'+HINT);
  return {T,rows};
}

// The Tree taste CSS. Declarations of the site's own hover rule, applied to the clones by class: nothing colour-bearing is written here.
export function treeCss(originalCss){
  const css=originalCss.replace(/\/\*[\s\S]*?\*\//g,'');
  const m=/@media\s*\(hover:\s*hover\)\s*\{\s*button\.leaf:hover\s*\{([^{}]*)\}/.exec(css);
  assert(m,'The original "@media (hover: hover) { button.leaf:hover { ... } }" rule is gone.'+HINT);
  const decls=m[1].split(';').map(d=>d.trim()).filter(d=>d&&!/^z-index\s*:/.test(d));
  assert(decls.some(d=>d.startsWith('transform'))&&decls.some(d=>d.startsWith('--lift')),'The original leaf hover no longer sets transform and --lift.'+HINT);
  assert(!decls.some(d=>/color|background|#|rgb|hsl/i.test(d)),'The original leaf hover now sets a colour; the clones copy its declarations.'+HINT);
  const fm=/(?:^|\})\s*\.leaf:focus-visible\s*\{([^{}]*)\}/.exec(css);   // a keyboard-focused leaf's ring: mirrored onto the painted copies (focus itself stays on the real button)
  assert(fm,'The original ".leaf:focus-visible { ... }" rule is gone; the raised copies mirror it.'+HINT);
  const focus=fm[1].split(';').map(d=>d.trim().replace(/\s+/g,' ')).filter(d=>d&&!/^z-index\s*:/.test(d));
  assert(focus.some(d=>d.startsWith('filter')),'The original leaf focus ring is no longer a filter; the raised copies mirror it.'+HINT);
  assert(/\.leaf\s*\{\s*transition:\s*transform\s+\.28s\s+cubic-bezier\(\.3,\s*1\.4,\s*\.5,\s*1\)/.test(css),'The original .leaf transition changed from transform .28s cubic-bezier(.3, 1.4, .5, 1); the Tree taste timings (280 ms, same curve) mirror it.'+HINT);
  return `/* Taste you didn't ask for: Tree hover, the project’s opinion, opt-in. Classes only; set by taste.js. */
.tree .hw-taste-clone, .tree .hw-taste-clone * { pointer-events: none !important; }
.tree .hw-taste-clone > button.leaf { animation: none; }
.tree .hw-leaf-layer.hw-taste-clone { will-change: auto; }
:where(.tree .hw-taste-clone) > button.leaf.hw-taste-fv { ${focus.join('; ')}; }
@media (hover: hover) { :where(.tree .hw-taste-clone) > button.leaf.hw-taste-up { ${decls.join('; ')}; } }
.tree .hw-leaf-layer.hw-taste-under { z-index: 5; }
.tree.is-filtered .hw-leaf-layer.hw-taste-under { z-index: 4; }
.tree .hw-leaf-layer.hw-taste-hidden { opacity: 0; }
.tree.hw-taste-over { z-index: 4; }
`;
}

// Browser: wiring. Idle it does no work: no timers, no rAF; two pointer and two focus listeners on the tree and the document leaf:pick listener, each returning at once when nothing is raised.
// The copies are inert, so they never match :focus-visible; a keyboard-focused raised leaf shows its ring on the copies through hw-taste-fv (the site's own focus-visible
// declarations, written before the hover ones so hover wins the transform exactly as button.leaf:hover beats .leaf:focus-visible on the real leaf).
// A hovered leaf in T gets two clones of its layer: L below the wood (the original place), U in an overlay above the wood. The clones run the site's own hover
// transition (class hw-taste-up) while their wrappers play one 280 ms Web Animation (transform and opacity only): L slides out along v, at 40% L hands over to U,
// U tucks back. Leaving plays the same animation reversed, which is continuous from wherever it was, so every interruption is just a direction flip.
export function runTree(T){
  if(!matchMedia('(hover: hover)').matches)return;
  const tree=document.querySelector('.tree.bigtree'),wood=document.querySelector('.scene.bigtree');
  if(!tree||!wood||wood.parentNode!==tree.parentNode)return console.warn('taste: tree markup drifted');
  const SLIDE=1,MS=280,MAX=3,OUT='cubic-bezier(.3,1.4,.5,1)',BACK='cubic-bezier(.55,0,.2,1)',recs=new Map();   // SLIDE: 0 swaps in place, no slide
  let ov=null;
  const frames=(t,a,b)=>[{transform:'none',opacity:a,offset:0,easing:OUT},{transform:t,opacity:a,offset:.4,easing:'linear'},{transform:t,opacity:b,offset:.4,easing:BACK},{transform:'none',opacity:b,offset:1}];
  const clone=wrap=>{
    const c=wrap.cloneNode(true),b=c.firstElementChild;
    c.classList.add('hw-taste-clone');c.inert=true;c.setAttribute('aria-hidden','true');
    for(const a of ['data-leaf','data-item','aria-label'])b.removeAttribute(a);
    b.tabIndex=-1;b.classList.toggle('hw-taste-fv',wrap.firstElementChild.matches(':focus-visible'));return c;
  };
  const ring=(btn,on)=>{const r=recs.get(btn);if(r)for(const c of [r.L,r.U])c.firstElementChild.classList.toggle('hw-taste-fv',on);};
  function kill(r){
    r.aU.onfinish=null;r.aL.cancel();r.aU.cancel();r.L.remove();r.U.remove();
    r.wrap.classList.remove('hw-taste-hidden');recs.delete(r.btn);
    if(!ov.firstChild)ov.remove();
  }
  function dir(r,fwd){
    if(r.fwd!==fwd){r.fwd=fwd;r.aU.reverse();r.aL.reverse();}   // own flag: playbackRate still reads the old value until the change applies
    for(const c of [r.L,r.U])c.firstElementChild.classList.toggle('hw-taste-up',fwd);
  }
  function raise(btn,v){
    const wrap=btn.parentNode,L=clone(wrap),U=clone(wrap),t='translate('+v[0]*SLIDE+'%,'+v[1]*SLIDE+'%)';
    L.classList.add('hw-taste-under','hw-taste-hidden');wrap.after(L);
    ov||=document.createElement('div');
    ov.className=tree.className+' hw-taste-over';ov.setAttribute('aria-hidden','true');
    if(!ov.isConnected)wood.after(ov);
    ov.append(U);
    getComputedStyle(L.firstElementChild).opacity;   // style flush only (no layout): the clones' resting style exists before hw-taste-up, so the site's hover transition runs
    for(const c of [L,U])c.firstElementChild.classList.add('hw-taste-up');
    wrap.classList.add('hw-taste-hidden');   // opacity 0, still takes the pointer: the real leaf keeps :hover, focus and click
    const r={btn,wrap,L,U,fwd:true,aL:L.animate(frames(t,1,0),MS),aU:U.animate(frames(t,0,1),MS)};
    r.aU.onfinish=()=>{if(!r.fwd)kill(r);};
    recs.set(btn,r);
    while(recs.size>MAX)kill(recs.values().next().value);
  }
  tree.addEventListener('pointerover',e=>{
    if(e.pointerType==='touch')return;
    const b=e.target.closest('button.leaf'),r=b&&recs.get(b);
    if(r)return dir(r,true);                          // came back while it was leaving
    const v=b&&T[b.dataset.leaf];
    if(!v||b.classList.contains('is-found')||(window.leafLift&&window.leafLift.busy()))return;   // not covered by the wood: the site's own hover
    for(const o of recs.values())dir(o,false);        // one leaf up at a time
    raise(b,v);
  });
  tree.addEventListener('pointerout',e=>{
    const b=e.target.closest('button.leaf'),r=b&&recs.get(b);
    if(r&&!b.contains(e.relatedTarget))dir(r,false);
  });
  tree.addEventListener('focusin',e=>{const b=e.target.closest('button.leaf');if(b)ring(b,b.matches(':focus-visible'));});
  tree.addEventListener('focusout',e=>{const b=e.target.closest('button.leaf');if(b)ring(b,false);});
  document.addEventListener('leaf:pick',()=>{for(const r of [...recs.values()])kill(r);});   // the modal reads the real leaf: put it back this task
}

export function treeSource(html){
  return `/* Taste you didn't ask for: Tree hover, the project’s opinion, opt-in. */\n(()=>{"use strict";const T=${JSON.stringify(treeData(html).T)};(${runTree})(T);})();\n`;
}
