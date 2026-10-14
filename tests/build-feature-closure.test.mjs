import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {resolveBuildFeatures} from '../source/build-features.mjs';
import {capturePreviousOutputs,retireStaleOutputs,verifyFeatureClosure} from '../tools/feature-output.mjs';
import {phoneSourceFeatures,phoneHtmlFeatures,selectPhoneArt,mobileSelector} from '../tools/mobile-feature-source.mjs';
import {supervisedFeatureOptions} from '../tools/supervised-build-options.mjs';
import {themePreloads} from '../tools/theme-preloads.mjs';
import {runWholeBuild} from '../tools/whole-build.mjs';

function proveGroupOpen(app,{network}){
  const start=app.indexOf("addEventListener('click', e =>"),end=app.indexOf("document.addEventListener('keydown'",start);
  assert(start>=0&&end>start,'Actual delegated click listener missing');
  let handler;const calls=[];
  const open={dataset:{open:'member-oak',i:'7'},closest:selector=>selector==='#groups'?{}:null};
  const context={addEventListener:(event,callback)=>{assert.equal(event,'click');handler=callback},
    show:(id,route,opener)=>calls.push(['show',id,route,opener===open]),
    $:()=>({open:false})};
  if(network)context.select=(index,pin)=>calls.push(['select',index,pin]);
  vm.runInNewContext(app.slice(start,end),context);
  let prevented=0,stopped=0;
  assert.doesNotThrow(()=>handler({target:{closest:selector=>selector==='[data-open]'?open:null},
    preventDefault:()=>prevented++,stopPropagation:()=>stopped++}));
  assert.equal(prevented,1);assert.equal(stopped,1);
  assert.deepEqual(calls,network?[['select',7,false],['show','member-oak',true,true]]:[['show','member-oak',true,true]]);
}

test('all16 feature manifests admit only available phone/night route families',()=>{
  const names=['night','phone','tree-effects','network-effects'];
  for(let bits=0;bits<16;bits++){
    const features=resolveBuildFeatures(names.filter((_,i)=>bits&(1<<i)));
    const generated=['heartwood-site.html','desktop-day.html','experience-entry.html','taste/index.html','taste/scene.html'];
    if(features.phone){generated.push('mobile/index.html','mobile/day.html','mobile/manifest.json');
      if(features.night)generated.push('mobile/night.html');}
    assert(verifyFeatureClosure({features,generated}));
    if(features.phone&&features.night)assert.throws(()=>verifyFeatureClosure({features,
      generated:generated.filter(path=>path!=='mobile/night.html')}));
    if(!features.phone)assert.throws(()=>verifyFeatureClosure({features,generated:[...generated,'mobile/day.html']}));
    if(!features.night)assert.throws(()=>verifyFeatureClosure({features,generated:[...generated,'mobile/night.html']}));
  }
});
test('owned route cleanup retires stale phone/night routes and sidecars, preserving unrelated output',async()=>{
  const root=await mkdtemp(join(tmpdir(),'heartwood-feature-cleanup-'));
  try{
    await mkdir(join(root,'mobile'),{recursive:true});
    await writeFile(join(root,'mobile/night.html'),'old night');
    await writeFile(join(root,'mobile/night.html.gz'),'old compressed');
    await writeFile(join(root,'mobile/day.html'),'day');
    await writeFile(join(root,'unrelated.txt'),'keep');
    const snapshot=await capturePreviousOutputs(root,{generated:['mobile/night.html','mobile/day.html']});
    await retireStaleOutputs(root,snapshot,['mobile/day.html']);
    await assert.rejects(access(join(root,'mobile/night.html')));
    await assert.rejects(access(join(root,'mobile/night.html.gz')));
    assert.equal(await readFile(join(root,'unrelated.txt'),'utf8'),'keep');
    await assert.rejects(capturePreviousOutputs(root,{generated:['unrelated.txt']}));
  }finally{await rm(root,{recursive:true,force:false})}
});
test('owned retirement rejects a concurrent edit instead of deleting it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'heartwood-feature-cas-'));
  try{
    await mkdir(join(root,'mobile'));await writeFile(join(root,'mobile/night.html'),'old');
    const snapshot=await capturePreviousOutputs(root,{generated:['mobile/night.html']});
    await writeFile(join(root,'mobile/night.html'),'new concurrent body');
    await assert.rejects(retireStaleOutputs(root,snapshot,[]),/changed/);
    assert.equal(await readFile(join(root,'mobile/night.html'),'utf8'),'new concurrent body');
  }finally{await rm(root,{recursive:true,force:false})}
});
test('phone network exclusion physically omits listeners/helpers/overlay but preserves basic navigation',async()=>{
  const inputs=await Promise.all(['app.js','state.mjs','mobile.css'].map(name=>
    readFile(new URL('../source/mobile/'+name,import.meta.url),'utf8')));
  const features=resolveBuildFeatures(['night','tree-effects','network-effects']);
  const result=phoneSourceFeatures({app:inputs[0],state:inputs[1],css:inputs[2]},features);
  assert(!result.app.includes('const NET'));assert(!result.app.includes("stage.addEventListener('pointer"));
  assert(!result.state.includes('function nearest'));assert(!result.state.includes('function chain'));
  assert(result.app.includes('function peek('));assert(result.app.includes('function show('));
  assert(result.app.includes("find.addEventListener('input'"));assert(result.css.includes('.net__img'));
  assert(!result.css.includes('.net__path'));assert(!result.css.includes('.net__pin'));
  assert(!result.css.includes('.crit--flies'));
  proveGroupOpen(result.app,{network:false});
  proveGroupOpen(inputs[0],{network:true});
  new vm.Script('(()=>{'+result.state.replace(/^export /gm,'')+result.app+'})();');
  const html='<meta name="color-scheme" content="light dark">'
    +'<i class="crit crit--flies"></i>'
    +'<svg class="net__path"><path/></svg><div class="net__pin"><button>Open</button></div>'
    +'<script type="application/json" id="hw-net">{}</script><img class="net__img" src="roots.webp">';
  const without=phoneHtmlFeatures(html,features);
  assert(!without.includes('net__path'));assert(!without.includes('net__pin'));assert(!without.includes('hw-net'));
  assert(without.includes('net__img'));assert(without.includes('content="light"'));
  assert(!without.includes('crit--flies'));
});
test('phone art selection uses explicit theme provenance and day-only selector omits night route',()=>{
  const docs=[{name:'any-new-name',theme:'light'},{name:'future-grain',theme:'dark'}];
  assert.deepEqual(selectPhoneArt(docs,resolveBuildFeatures(['night'])),[docs[0]]);
  assert.deepEqual(selectPhoneArt(docs,resolveBuildFeatures()),docs);
  assert.throws(()=>selectPhoneArt([{name:'mystery'}],resolveBuildFeatures()));
  assert(!mobileSelector(resolveBuildFeatures(['night'])).includes('night.html'));
});
test('supervised option policy forwards ordinary exclusions and rejects contradictory/duplicate requests',()=>{
  assert.deepEqual(supervisedFeatureOptions({exclude:'night,tree-effects'},['--exclude=night,tree-effects']),
    {exclude:['night','tree-effects']});
  assert.throws(()=>supervisedFeatureOptions({phone:true,exclude:'phone'},['--phone','--exclude=phone']));
  assert.throws(()=>supervisedFeatureOptions({exclude:'night'},['--exclude=night','--exclude=night']));
  assert.throws(()=>supervisedFeatureOptions({out:'bad'},['--out','bad']));
  assert.throws(()=>supervisedFeatureOptions({help:true,exclude:''},['--help','--exclude=']));
  assert.throws(()=>supervisedFeatureOptions({help:true,exclude:'night'},['--help','--exclude=night']));
  assert.deepEqual(supervisedFeatureOptions({help:true},['--help']),{exclude:[]});
});
test('taste preload selection requests only selected grain; no-JS retains Night and Day-only excludes it',()=>{
  const day='<link rel="preload" href="day.webp">',night='<link rel="preload" href="night.webp">';
  const markup=themePreloads(day,night),script=markup.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const theme of ['day','night']){
    let inserted;vm.runInNewContext(script,{document:{documentElement:{dataset:{hwTheme:theme}},
      head:{insertAdjacentHTML:(where,value)=>{assert.equal(where,'beforeend');inserted=value}}}});
    assert.equal(inserted,theme==='night'?night:day);
  }
  assert.equal(markup.match(/<noscript>([\s\S]*?)<\/noscript>/)[1],night);
  assert.equal(themePreloads(day,null),day);
});
test('programmatic supervised exclusions fail before any worker or output path is acquired',async()=>{
  await assert.rejects(runWholeBuild({entry:'file:///deliberately-absent-feature-fixture.mjs',
    out:'deliberately-absent-output',projectRoot:'deliberately-absent-root',options:{exclude:'unknown'}}),
    /Unknown or empty build feature exclusion/);
});
