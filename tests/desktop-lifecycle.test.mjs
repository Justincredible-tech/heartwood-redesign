import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const read=rel=>fs.readFile(path.join(root,rel),'utf8');
const classes=()=>{const s=new Set();return{add:(...ks)=>ks.forEach(k=>s.add(k)),remove:(...ks)=>ks.forEach(k=>s.delete(k)),contains:k=>s.has(k),toggle(k,on){if(on===undefined)on=!s.has(k);on?s.add(k):s.delete(k);return on;}};};
const target=()=>{const listeners=new Map();return{classList:classes(),addEventListener:(n,f)=>{if(!listeners.has(n))listeners.set(n,[]);listeners.get(n).push(f);},dispatch:(n,e={})=>(listeners.get(n)||[]).forEach(f=>f(e))};};

test('actual desktop lifecycle pauses visible unfocused or hidden pages and resumes focused visibility without an idle timer',async()=>{
  const text=await read('source/js/heartwood-site.js'),start=text.indexOf('  const motionRegions ='),end=text.indexOf('  /* Let initial fragments',start);
  assert(start>=0&&end>start,'Actual lifecycle block must be present');
  const win=target(),doc=target(),html=target(),region=target();let focused=false,callback;
  Object.assign(doc,{documentElement:html,hidden:false,hasFocus:()=>focused});
  class IO{constructor(cb){callback=cb;}observe(){}}
  win.IntersectionObserver=IO;
  vm.runInNewContext(text.slice(start,end),{window:win,document:doc,IntersectionObserver:IO,$$:()=>[region]},{timeout:1000});
  assert(html.classList.contains('is-motion-hidden'),'Visible but unfocused page must pause');
  focused=true;win.dispatch('focus');assert(!html.classList.contains('is-motion-hidden'));
  callback([{target:region,isIntersecting:false}]);assert(region.classList.contains('is-motion-paused'));
  callback([{target:region,isIntersecting:true}]);assert(!region.classList.contains('is-motion-paused'));
  focused=false;win.dispatch('blur');assert(html.classList.contains('is-motion-hidden'));
  focused=true;win.dispatch('focus');doc.hidden=true;doc.dispatch('visibilitychange');assert(html.classList.contains('is-motion-hidden'));
  doc.hidden=false;doc.dispatch('visibilitychange');assert(!html.classList.contains('is-motion-hidden'));
});

test('real generated leaf promotion is confined to visible foreground while retaining authored leaf transforms',async()=>{
  const {prepareLeafRendering}=await import(pathToFileURL(path.join(root,'source/taste/leaf-rendering.mjs')));
  const html=await read('source/heartwood-site.html'),css=await read('source/css/heartwood-site.css'),out=prepareLeafRendering(html,css);
  assert.equal(out.leavesWrapped,149);
  const rule=out.css.match(/([^{}]+)\{will-change:transform\}/);
  assert(rule,'A foreground promotion rule must exist');
  assert(rule[1].includes('html:not(.is-motion-hidden)'),'Root lifecycle must gate explicit leaf promotion');
  assert(rule[1].includes('.stage:not(.is-motion-paused)'),'Offscreen stage must gate explicit leaf promotion');
  assert(!out.css.includes('animation-duration'),'Wrapper must not change authored animation timing');
});

test('ornamental lifecycle pause covers night glow pseudo-elements and outranks species animation declarations',async()=>{
  const css=await read('source/css/heartwood-site.css'),start=css.indexOf('/* Pause ornamental loops only;'),end=css.indexOf('/* For visitors who ask for less motion',start),rule=css.slice(start,end);
  assert(rule.includes('.bee__face'),'Night firefly face must be covered');
  assert(rule.includes('::after'),'Generated firefly glow must pause, not just its parent');
  assert.match(rule,/animation-play-state\s*:\s*paused\s*!important/,'Lifecycle pause must beat night-specific animation shorthand');
  assert(!rule.includes('.leaf'),'Leaf entrance/dialog animation remains independent');
});

test('actual Network runtime cancels pending work and demotes on focus loss, restoring prewarm only in view',async()=>{
  const {run}=await import(pathToFileURL(path.join(root,'source/taste/taste-network.mjs')));
  const win=target(),doc=target(),stage=target(),hub=target(),hy=target(),net=target();let focused=true,ioCallback,raf=0,observed=0,overlay;
  const styles=new Map();hy.children=[];hy.getBoundingClientRect=()=>({left:.25,top:.25});hy.querySelectorAll=()=>[];hy.after=el=>overlay=el;
  stage.querySelector=s=>s==='.net__hub'?hub:s==='.net__hyphae'?hy:null;stage.contains=()=>false;
  net.querySelector=s=>s==='.net__stage'?stage:null;net.querySelectorAll=()=>[];net.contains=()=>false;
  Object.assign(doc,{hidden:false,hasFocus:()=>focused,activeElement:null,getElementById:id=>id==='net'?net:null,createElement:()=>({...target(),style:{getPropertyValue:k=>styles.get(k)||'',setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)},setAttribute(){},getAttribute:()=>null,removeAttribute(){},append(){}})});
  class IO{constructor(cb){ioCallback=cb;}observe(){}}
  class RO{observe(){observed++;}disconnect(){observed=0;}}
  win.IntersectionObserver=IO;win.ResizeObserver=RO;
  vm.runInNewContext(`(${run})({segs:[],paths:[],occ:{}},()=>({zone:1}),()=>({prev:-1,open:false}));`,{window:win,document:doc,matchMedia:()=>({matches:true}),IntersectionObserver:IO,ResizeObserver:RO,addEventListener:win.addEventListener,requestAnimationFrame:()=>++raf,cancelAnimationFrame:()=>raf=0,scrollX:0,scrollY:0,Set,Map},{timeout:1000});
  ioCallback([{isIntersecting:true}]);assert(overlay.classList.contains('hw-taste-wc'));assert.equal(observed,1);
  stage.dispatch('pointermove',{pointerType:'mouse',target:{closest:()=>null},clientX:10,clientY:10});assert.equal(raf,1);
  focused=false;win.dispatch('blur');assert.equal(raf,0);assert(!overlay.classList.contains('hw-taste-wc'),'Unfocused overlay must demote');assert.equal(observed,0);
  focused=true;win.dispatch('focus');assert(overlay.classList.contains('hw-taste-wc'));
  doc.hidden=true;doc.dispatch('visibilitychange');assert(!overlay.classList.contains('hw-taste-wc'));assert.equal(observed,0);
  doc.hidden=false;doc.dispatch('visibilitychange');assert(overlay.classList.contains('hw-taste-wc'));
  ioCallback([{isIntersecting:false}]);assert(!overlay.classList.contains('hw-taste-wc'));
});

test('actual tree Web Animations pause on lifecycle loss and resume their existing progress without restarting finished animations',async()=>{
  const {runTree}=await import(pathToFileURL(path.join(root,'source/taste/taste-tree.mjs')));
  const win=target(),doc=target(),tree=target(),wood=target(),button=target(),wrap=target(),animations=[];let focused=true,ioCallback;
  tree.parentNode=wood.parentNode={};tree.className='tree bigtree';tree.isConnected=wood.isConnected=true;
  button.dataset={leaf:'0'};button.matches=()=>false;button.closest=()=>button;button.parentNode=wrap;button.contains=()=>false;
  wrap.firstElementChild=button;wrap.after=()=>{};
  const animation=()=>{const a={playState:'running',currentTime:123,pause(){this.playState='paused';},play(){this.playState='running';this.currentTime=0;},cancel(){this.playState='idle';},reverse(){this.playState='running';}};animations.push(a);return a;};
  const element=()=>{const el=target();el.isConnected=true;el.firstChild=null;el.remove=()=>el.isConnected=false;el.append=c=>el.firstChild=c;el.setAttribute=()=>{};el.removeAttribute=()=>{};el.matches=()=>false;el.animate=()=>el.wrapperAnimation=animation();return el;};
  wrap.cloneNode=()=>{const el=element();el.firstElementChild=element();const cssTransition=animation();el.getAnimations=()=>[el.wrapperAnimation,cssTransition].filter(Boolean);return el;};wood.after=()=>{};
  Object.assign(doc,{hidden:false,hasFocus:()=>focused,querySelector:s=>s==='.tree.bigtree'?tree:s==='.scene.bigtree'?wood:null,createElement:element});
  class IO{constructor(cb){ioCallback=cb;}observe(){}}win.IntersectionObserver=IO;
  vm.runInNewContext(`(${runTree})({'0':[1,1]});`,{window:win,document:doc,matchMedia:()=>({matches:true}),addEventListener:win.addEventListener,IntersectionObserver:IO,getComputedStyle:()=>({opacity:1}),Set,Map},{timeout:1000});
  tree.dispatch('pointerover',{pointerType:'mouse',target:button});assert.equal(animations.length,4);
  focused=false;win.dispatch('blur');assert(animations.every(a=>a.playState==='paused'),'Both active wrapper animations must pause');assert(animations.every(a=>a.currentTime===123));
  focused=true;win.dispatch('focus');assert(animations.every(a=>a.playState==='running'));assert(animations.every(a=>a.currentTime===123),'Resume must restore captured progress even if play auto-rewinds');
  assert(ioCallback,'Tree requires lifecycle viewport admission');ioCallback([{isIntersecting:false}]);assert(animations.every(a=>a.playState==='paused'));
  ioCallback([{isIntersecting:true}]);assert(animations.every(a=>a.playState==='running'));assert(animations.every(a=>a.currentTime===123));
  animations.forEach(a=>a.playState='finished');focused=false;win.dispatch('blur');focused=true;win.dispatch('focus');assert(animations.every(a=>a.playState==='finished'),'Finished holds must not restart');
  doc.dispatch('leaf:pick');assert(animations.every(a=>a.playState==='idle'),'Existing modal cleanup still cancels clones');
});
