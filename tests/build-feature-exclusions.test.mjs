import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {resolveBuildFeatures,parseFeatureFlags,applySceneExclusions} from '../source/build-features.mjs';
import {entryScript,experienceEntry} from '../source/taste/experience-entry.mjs';
import {prepareTaste} from '../source/taste/index.mjs';

const names=['night','phone','tree-effects','network-effects'];
const html=await readFile(new URL('../source/heartwood-site.html',import.meta.url),'utf8');
const css=await readFile(new URL('../source/css/heartwood-site.css',import.meta.url),'utf8');
test('default enables every feature and retains the existing CLI default shape',()=>{
  const features=resolveBuildFeatures();
  assert.deepEqual(features,{night:true,phone:true,treeEffects:true,networkEffects:true,excluded:[]});
  assert.deepEqual(parseFeatureFlags([]),{help:false});
  assert.deepEqual(parseFeatureFlags(['--exclude=phone,night']),{help:false,exclude:['night','phone']});
  assert(Object.isFrozen(features)&&Object.isFrozen(features.excluded));
});
test('CLI and programmatic policy reject malformed, unknown, duplicate and empty inputs',()=>{
  for(const value of ['',null,'phone,',' phone','phone,phone','night,,phone','mobile',{},[false],['night','night']])
    assert.throws(()=>resolveBuildFeatures(value));
  for(const args of [['--exclude='],['--exclude=phone','--exclude=night'],['--help','--exclude=phone'],['--wat'],['phone']])
    assert.throws(()=>parseFeatureFlags(args));
});
function route(experience,exclude,{phone=false,osNight=false,query=''}={}){
  let target;
  const location={href:'https://preview.example/'+(experience==='taste'?'taste/':'')+query+'#network',
    replace:value=>{target=value}};
  vm.runInNewContext(entryScript(experience,exclude),{location,URL,
    navigator:{userAgent:phone?'iPhone':'Desktop',userAgentData:{mobile:phone},maxTouchPoints:phone?5:0},
    screen:{width:390,height:844},matchMedia:value=>({matches:value.includes('color-scheme')?osNight:phone})});
  return new URL(target);
}
test('all16 exclusion policies route only to available families, retaining query/hash and taste default',()=>{
  for(let bits=0;bits<16;bits++){
    const exclude=names.filter((_,i)=>bits&(1<<i)), f=resolveBuildFeatures(exclude);
    for(const experience of ['main','taste'])for(const phone of [false,true])for(const osNight of [false,true]){
      const got=route(experience,exclude,{phone,osNight,query:'?q=oak'});
      const night=f.night&&(experience==='taste'||osNight);
      const wanted=phone&&f.phone?'mobile/'+(night?'night.html':'day.html'):
        experience==='taste'||night?'taste/scene.html':'desktop-day.html';
      assert.equal(got.pathname,'/'+wanted);
      assert.equal(got.search,'?q=oak'); assert.equal(got.hash,'#network');
    }
  }
  assert.equal(route('taste',[],{query:'?theme=light'}).pathname,'/taste/scene.html');
  assert.equal(route('main',[],{phone:true,query:'?view=desktop&theme=light'}).pathname,'/desktop-day.html');
});
test('no-JS entries omit unavailable links and desktop head emits no excluded dispatch/runtime',()=>{
  for(const exclude of [[],['night'],['phone'],['night','phone']]){
    const f=resolveBuildFeatures(exclude),entry=experienceEntry('main',{htmlSource:html,exclude});
    const scene=applySceneExclusions(html,exclude);
    assert.doesNotThrow(()=>new vm.Script(scene.match(/<script>([\s\S]*?)<\/script>/)[1]));
    if(!f.night){assert(!entry.includes('>Night</a>'));assert(!entry.includes('mobile/night.html'));
      assert(!scene.includes('data-hw-mode'));assert(!scene.includes('osNight'));}
    if(!f.phone){assert(!entry.includes('mobile/'));assert(!scene.includes('navigator.userAgent'));
      assert(!scene.includes('mobile/night.html'));assert(!scene.includes('mobile/day.html'));}
    assert(entry.includes('>Day</a>'));
  }
  assert.equal(applySceneExclusions(html,[]),html);
});
test('taste exclusions remove optional runtime/css/night art while preserving all149 baseline leaves',()=>{
  const all=prepareTaste({html,css});
  const bare=prepareTaste({html,css,exclude:['night','tree-effects','network-effects']});
  assert.equal(all.contract.treeLeaves,149);assert.equal(bare.contract.treeLeaves,149);
  assert(all.html.includes('data-hw-theme="night"'),'taste retains its Night default without JavaScript');
  assert(all.html.includes('href="../desktop-day.html?view=desktop&amp;theme=light" data-hw-mode>Day</a>'),
    'no-JS Day control must leave the static Night document for the actual Day scene');
  assert(bare.html.includes('data-hw-theme="day"'));
  const root={dataset:{hwExperience:'taste',hwTheme:'night'}};
  vm.runInNewContext(all.html.match(/<script>([\s\S]*?)<\/script>/)[1],{
    document:{documentElement:root,addEventListener:()=>{}},URL,
    location:{href:'https://preview.example/taste/?theme=light&view=desktop'},history:{replaceState:()=>{}},
    navigator:{userAgent:'Desktop',maxTouchPoints:0},screen:{width:1440,height:900},matchMedia:()=>({matches:false})});
  assert.equal(root.dataset.hwTheme,'day','explicit Day is selected before styles/preloads');
  assert(bare.html.includes('data-leaf="149"')||bare.html.match(/data-leaf="/g).length===149);
  assert(!bare.html.includes('hw-firefly-extra'));assert(!bare.html.includes('hw-bird'));
  assert(!bare.css.includes('hw-taste-clone'));assert(!bare.css.includes('hw-firefly-extra'));
  assert(!bare.js.includes('runTree'));assert(!bare.js.includes('extractNetwork'));
  assert(!bare.js.includes('IntersectionObserver'));assert(!bare.headJs.includes('darkreader'));
  assert(bare.css.includes('hw-leaf-layer'));assert.equal(bare.js,'void 0;');
  const noTree=prepareTaste({html,css,exclude:['tree-effects']});
  const noNetwork=prepareTaste({html,css,exclude:['network-effects']});
  assert(!noTree.css.includes('hw-taste-clone'));assert(!noTree.js.includes('runTree'));
  assert(noTree.js.length>1000);assert(noTree.css.includes('hw-firefly-extra'));
  assert(noNetwork.css.includes('hw-taste-clone'));assert(noNetwork.js.includes('runTree'));
  assert(!noNetwork.js.includes('function run('));
});
