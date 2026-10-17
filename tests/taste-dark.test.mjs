// Unit tests for the designed dark mode (tools/taste-dark.mjs). No browser; see tools/verify-taste-dark.mjs for the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {FIREFLY,NIGHT,owl,emitter,darkJs,darkCss,darkPalette,fireflyCss,fireflyTiming,CRITTERS} from '../tools/taste-dark.mjs';

const SITE=`:root {
  --grain: radial-gradient(circle, rgb(255 255 255 / .07) 0 1px, transparent 2px), radial-gradient(circle, rgb(0 0 0 / .06) 0 1px, transparent 2px);
  --leaf-shape: none;
}
`+Array.from({length:45},(_,i)=>`.p${i} > i { background: var(--grain), var(--c); filter: drop-shadow(1px 2px 3px rgb(20 10 0 / .5)); }`).join('\n');

test('owls are cut like the author\'s birds: integer units in a 100 x 64 box, five-point wings and tail, twelve-sided head',()=>{
  for(const kind of ['barred','screech']){const o=owl(kind);assert.equal(o.w,100);assert.equal(o.h,64);
    const wings=o.plies.filter(p=>/bird__wing/.test(p.cls||''));assert.equal(wings.length,2,kind+': near and far wing');
    for(const w of wings)assert.equal(w.s[0].p.length,5,kind+': five-point wing like the cardinal');
    assert.equal(o.plies[0].s[0].p.length,5,kind+': five-point tail');
    assert(o.plies.some(p=>p.s.some(s=>s.p.length===12)),kind+': twelve-sided head');
    for(const p of o.plies)for(const s of p.s)if(s.p.length<=5||s.p.length===4)for(const [x,y] of s.p)assert(Number.isInteger(x)&&Number.isInteger(y),`${kind}: cut piece on the design grid (${x},${y})`);
    // wings hinge on the site's flap origin (50% 53% of 64 = 34 units)
    for(const w of wings)assert(Math.max(...w.s[0].p.map(([,y])=>y))>=33&&Math.max(...w.s[0].p.map(([,y])=>y))<=35,kind+': wing base on the flap hinge');
  }
});

test('emitter: classes only, deduped polygons, colours as --c classes',()=>{
  const E=emitter();const a=E.html(CRITTERS.barred(),'bird__face hw-nface'),b=E.html(CRITTERS.barred(),'bird__face hw-nface');
  assert.equal(a,b);assert(!/style=/.test(a));
  const css=E.css();assert.match(css,/^\.hw-np-0\{clip-path:polygon\(/);assert.match(css,/\.hw-nc-[0-9a-f]{6}\{--c:#[0-9a-f]{6}\}/);
});

test('fireflies: one clock, bursts of flashes, a wave whose direction changes burst to burst, stragglers only on a first flash',()=>{
  const T=fireflyTiming(),n=FIREFLY.homes.length,B=FIREFLY.order.length,K=FIREFLY.flashes;
  assert(T.cycle>=10&&T.cycle<=12,'cycle '+T.cycle);assert(Math.abs(T.super-T.cycle*B)<1e-9);
  assert(new Set(FIREFLY.order).size>=3&&FIREFLY.order.includes('ltr')&&FIREFLY.order.includes('rtl')&&FIREFLY.order.includes('centre'));
  for(let i=0;i<n;i++){assert.equal(T.flashes[i].length,B*K);const st=FIREFLY.stragglers[i+1]||0;
    for(let b=0;b<B;b++){const f=T.flashes[i].slice(b*K,b*K+K);
      for(let k=2;k<K;k++)assert(Math.abs(f[k].t-f[k-1].t-FIREFLY.interval)<1e-9,'flashes '+FIREFLY.interval+' s apart');
      assert(Math.abs(f[1].t-f[0].t-(FIREFLY.interval-st))<1e-9,'only the first flash straggles');
      for(const x of f)assert(x.t+x.s+x.f<b*T.cycle+T.cycle,'a burst stays inside its cycle');}}
  const xs=FIREFLY.homes.map(h=>h[0]),first=(i,b)=>T.flashes[i][b*K+1].t-FIREFLY.interval;   // the locked-in timing, without straggle
  FIREFLY.order.forEach((pat,b)=>{const ts=xs.map((x,i)=>first(i,b));const span=Math.max(...ts)-Math.min(...ts);
    assert(span<=FIREFLY.wave+1e-9&&span>=FIREFLY.wave*.5,pat+': the burst ripples across the swarm within FIREFLY.wave ('+span+')');
    const order=xs.map((x,i)=>i).sort((p,q)=>ts[p]-ts[q]);
    if(pat==='ltr')assert.deepEqual(order,[...order].sort((p,q)=>xs[p]-xs[q]));
    if(pat==='rtl')assert.deepEqual(order,[...order].sort((p,q)=>xs[q]-xs[p]));
    const o=FIREFLY.patterns[pat].origin;if(o!==undefined)for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(Math.abs(xs[i]-o)<Math.abs(xs[j]-o))assert(ts[i]<=ts[j],pat+': spreads out from x='+o);});
  const {css}=fireflyCss();
  assert.equal((css.match(/@keyframes hw-ff-\d+\{/g)||[]).length,n,'one keyframes per firefly');
  assert.equal((css.match(new RegExp(`animation: var\\(--hw-ffk\\) ${+T.super.toFixed(3)}s linear infinite`,'g'))||[]).length,1,'every flash animation shares one duration and no delay');
});

test('every new keyframe animates only transform/translate/rotate/scale/opacity; no animated filter or blur',()=>{
  const css=darkCss(SITE,'');
  const kf=[...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)];
  assert(kf.length>=9+7,'found '+kf.length+' keyframes');
  for(const [,name,body] of kf)for(const [,props] of body.matchAll(/\{([^{}]*)\}/g))for(const d of props.split(';').map(s=>s.trim()).filter(Boolean)){
    const p=d.split(':')[0].trim();assert(['transform','translate','rotate','scale','opacity','animation-timing-function'].includes(p),`${name} animates ${p}`);}
  assert(!/animation[^;{}]*\b(filter|blur)\b/.test(css));
});

test('unsupported-relative-color fallback stays scoped; supported taste always uses night regardless OS',()=>{
  const css=darkCss(SITE,emitter().css()),top=css.slice(0,css.indexOf('@supports'));
  const sels=[...top.replace(/\/\*[\s\S]*?\*\//g,'').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,'').matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m=>m[1].trim()).filter(s=>!s.startsWith('@'));
  for(const s of sels)for(const one of s.split(','))assert(/hw-n|hw-nx|hw-nw|bug--hop|bug--waddle|bee__face::after/.test(one),'a light-mode rule touches site elements: '+one);
  assert.match(css,/@supports \(color: oklch\(from red l c h\)\) \{\n:root \{ color-scheme: dark; \}/);
  assert.doesNotMatch(css,/prefers-color-scheme/,'OS scheme cannot hide the night palette');
  assert(!/^:root\s*\{\s*color-scheme/m.test(top),'color-scheme only where the night palette is supported');
});

test('night palette: the site paper goes through the night curve, tokens are hand-set, and the taste hover snap matches the site hover',()=>{
  const p=darkPalette(SITE);
  assert.match(p,/\.p0 > i \{ background: var\(--grain\), oklch\(from var\(--c\) calc\(0\.05 \+ 0\.8 \* pow\(l, 1\.55\)\) calc\(c \* 0\.95\) h\); filter: drop-shadow\(1px 2px 3px rgb\(20 10 0 \/ 0\.70\)\); \}/);
  assert.match(p,/\.spore:hover, \.spore:focus-visible, \.spore\.is-hit, \.net \.spore\.hw-taste-snap \{ --c: #fff0a8; \}/);
  assert.throws(()=>darkPalette('.a{color:red}'),/--grain/);
});

test('script: supported taste always locks its night; OS changes cannot disable it; unsupported colours stay inert',()=>{
  const run=({dark,supports=true})=>{const heads=[],listeners={},mq={matches:dark,addEventListener:(t,f)=>listeners[t]=f};
    const document={readyState:'loading',head:{append:m=>{heads.push(m);m.remove=()=>heads.splice(heads.indexOf(m),1);}},createElement:()=>({}),addEventListener(){},querySelector:()=>null};
    vm.runInNewContext(darkJs(),{window:{CSS:{supports:()=>supports}},CSS:{supports:()=>supports},matchMedia:()=>mq,document,IntersectionObserver:class{}});
    return {heads,mq,listeners};};
  const light=run({dark:false});assert.equal(light.heads.length,1);assert.equal(light.heads[0].name,'darkreader-lock');assert.deepEqual(light.listeners,{});
  const d=run({dark:true});assert.equal(d.heads.length,1);assert.equal(d.heads[0].name,'darkreader-lock');
  d.mq.matches=false;for(const listener of Object.values(d.listeners))listener();assert.equal(d.heads.length,1,'night lock remains when the preference turns light');
  d.mq.matches=true;for(const listener of Object.values(d.listeners))listener();assert.equal(d.heads.length,1);assert.deepEqual(d.listeners,{});
  assert.deepEqual(run({dark:true,supports:false}).heads,[]);
});

test('night sky plan names real critters for real birds',()=>{
  for(const [k,v] of Object.entries(NIGHT))for(const t of v)assert(t==='day'||CRITTERS[t],k+': '+t);
  assert.equal(NIGHT.cardinal.length+NIGHT.jay.length+NIGHT.goldfinch.length+NIGHT.speck.length,9);
  assert.equal(Object.values(NIGHT).flat().filter(t=>t==='bat').length,1,'one spare bat');
});

test('mobileNight(): the phone build gets the same night (tokens, curve, glow-and-relief burst, critter art) in the shape mobile/night.mjs reads',async()=>{
  const {mobileNight}=await import('../tools/taste-dark.mjs');const n=await mobileNight({siteCss:SITE});
  for(const k of ['--sky-left','--sky-right','--paper','--paper-2','--card','--ink','--ink-soft','--gold','--cream','--focus','--lay','--lay-up','--grain','--below'])assert(n.tokens[k],k);
  assert.match(n.lc,/^calc\([\d.]+ \+ [\d.]+ \* pow\(l, [\d.]+\)\) calc\(c \* [\d.]+\)$/);assert.match(n.lcGold,/^calc\([\d.]+ \+ [\d.]+ \* pow\(l, [\d.]+\)\) calc\(c \* [\d.]+\)$/);
  assert.equal((n.syncKeyframes.match(/opacity: 1;/g)||[]).length,FIREFLY.flashes);assert(n.syncKeyframes.includes('opacity: 0;'));
  for(const k of ['barred','screech','moth','bat','raccoon','rabbit']){assert.match(n.templates[k],/^<span class="(bird|bug)__face">/);for(const c of n.templates[k].matchAll(/class="([^"]*)"/g))for(const cls of c[1].split(' '))if(/^hw-n[pc]-/.test(cls))assert(n.critterCss.includes('.'+cls+'{'),cls);}
  assert.match(n.fireflyGlow,/^radial-gradient\(circle closest-side/);assert.equal(n.syncFlashes.length,FIREFLY.order.length);
});

test('mobileNight(): the default reads the authored public CSS directly — no legacy site/ fallback',async()=>{
  const {readFile}=await import('node:fs/promises');const {mobileNight}=await import('../tools/taste-dark.mjs');
  const authored=await readFile(new URL('../source/css/heartwood-site.css',import.meta.url),'utf8');
  assert.deepEqual(await mobileNight(),await mobileNight({siteCss:authored}));
  const source=await readFile(new URL('../tools/taste-dark.mjs',import.meta.url),'utf8');
  assert(!source.includes('site/local')&&!source.includes("'../site/"),'the tool must not reference the legacy site/ fallback');
});
