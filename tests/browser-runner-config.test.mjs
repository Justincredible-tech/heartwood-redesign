import test from 'node:test';
import assert from 'node:assert/strict';
import {browserStagePlan,selectBrowserStages,browserRunBudget,stageEnvironment,parseAbusePlan,browserCleanupStatus} from '../tools/test-browser-all.mjs';

const plan=full=>browserStagePlan({full,root:'/project',siteRoot:'/snapshot/site',out:'/reports',env:{}});
test('explicit selections reach full and opt-in stages without --full, and invalid selections fail',()=>{
 const stages=plan(false);
 assert.deepEqual(selectBrowserStages(stages,{only:'taste-dark,mobile,ios-capture'}).map(s=>s.name),['taste-dark','mobile','ios-capture']);
 for(const only of ['',',','taste-dark,taste-dark','unknown','taste-dark,'])assert.throws(()=>selectBrowserStages(stages,{only}),/selection|unknown|Duplicate|Empty/);
 assert(!selectBrowserStages(stages,{}).some(s=>s.scope==='opt-in'||s.scope==='full'));
 assert(selectBrowserStages(plan(true),{full:true}).some(s=>s.name==='taste-colour'));
 assert(!selectBrowserStages(plan(true),{full:true}).some(s=>s.scope==='opt-in'));
});
test('all maintained local canonical browser drivers have a live cleanup stage and finite honest budgets',()=>{
 const stages=plan(true),paths=new Set(stages.filter(s=>!s.unsupported).flatMap(s=>s.covers||[]));
 for(const path of ['tools/verify-taste-dark.mjs','tools/verify-taste-colour.mjs','tools/verify-taste-lag.mjs','tools/verify-mobile.mjs','tools/diagnostics/check-header-stuck.mjs','tools/diagnostics/finder-leak-probe.mjs','tools/diagnostics/layer-churn-probe.mjs','tools/diagnostics/light-identity-probe.mjs','tools/diagnostics/measure-startup.mjs','tools/diagnostics/perf-trace.mjs','tools/diagnostics/verify-delivery.mjs','output/playwright/android/hash-desktop.mjs'])assert(paths.has(path),path);
 for(const s of stages)assert(Number.isFinite(s.timeoutMs)&&s.timeoutMs>0,s.name);
 assert.equal(new Set(stages.map(s=>s.name)).size,stages.length);
 assert(stages.find(s=>s.name==='taste').timeoutMs>=3600000);
 assert(stages.find(s=>s.name==='taste-lag-matrix').timeoutMs>=150*60000);
 assert(!stages.find(s=>s.name==='mobile').args.includes('--quick'));
 assert(stages.find(s=>s.name==='abuse').args.includes('--full'));
 const selected=selectBrowserStages(stages,{only:'taste,taste-lag-matrix,mobile'});
 assert(browserRunBudget(selected)>selected.reduce((n,s)=>n+s.timeoutMs,0));
});
test('ambient narrowing cannot silently replace the recorded stage scope or strip ownership',()=>{
 const stage=plan(true).find(s=>s.name==='taste-lag');
 const env=stageEnvironment(stage,{HW_ONLY:'missing',HW_COMBOS:'bad',HW_SWEEPS:'bad',HW_TOOL_RUN_TOKEN:'owned',TMPDIR:'/owned',HW_DARKREADER:'/existing/darkreader.js'});
 assert.equal(env.HW_ONLY,undefined);assert.equal(env.HW_COMBOS,stage.env.HW_COMBOS);assert.equal(env.HW_SWEEPS,stage.env.HW_SWEEPS);
 assert.equal(env.HW_TOOL_RUN_TOKEN,'owned');assert.equal(env.TMPDIR,'/owned');assert.equal(env.HW_DARKREADER,'/existing/darkreader.js');
});

test('abuse plan requires one finite nonempty source-produced selection',()=>{const plan={schema:1,routes:['optimized'],seconds:3,mode:'quick',scenarioConfigs:[{name:'pointer-sweeps',config:'d1',cycles:null}],chaos:false,chaosMs:150000,deferred:false,timeoutMs:66000},line='HW_ABUSE_PLAN='+JSON.stringify(plan);assert.equal(parseAbusePlan('# setup log\n'+line).timeoutMs,66000);for(const input of ['',line+'\n'+line,'HW_ABUSE_PLAN='+JSON.stringify({...plan,timeoutMs:null}),'HW_ABUSE_PLAN='+JSON.stringify({...plan,scenarioConfigs:[]})])assert.throws(()=>parseAbusePlan(input),/plan/);});

test('cleanup pass binds exact command/current scope and rejects stale, missing and forced-residue reports',()=>{const command=['node','tools/example.mjs'],result={status:0,scopeToken:'run/gate',cleanup:{errors:[],remaining:[],observedLeftovers:[]}},gate={command,result:{scopeToken:'run/gate/subject'},clean:true,failures:[],passed:true};assert.equal(browserCleanupStatus(result,gate,command).status,'PASS');for(const row of [null,{...gate,result:{scopeToken:'old/gate/subject'}},{...gate,command:['node','different.mjs']},{...gate,failures:[{kind:'temp'}]},{...gate,passed:false}])assert.equal(browserCleanupStatus(result,row,command).status,'FAIL');assert.equal(browserCleanupStatus({...result,status:64},{...gate,passed:false},command).status,'UNSUPPORTED');assert.equal(browserCleanupStatus({...result,status:64},null,command).status,'FAIL');assert.equal(browserCleanupStatus({...result,cleanup:{errors:[],remaining:[],observedLeftovers:[{pid:42}]}},gate,command).status,'FAIL');});

test('current phone stage binds the selected candidate mobile directory and public source mask',()=>{
 const stage=browserStagePlan({root:'/chosen/fork',siteRoot:'/selected/stage',out:'/reports',env:{}}).find(s=>s.name==='mobile');
 const value=name=>stage.args[stage.args.indexOf(name)+1];
 assert(stage.args.includes('--site'),'current phone verifier requires explicit input');assert.equal(value('--site'),'/selected/stage/mobile');
 assert.equal(value('--source-root'),'/chosen/fork');assert.equal(value('--out'),'/reports/mobile');assert(!stage.args.includes('--quick'));
 assert.deepEqual(stage.requires,['/selected/stage/mobile/manifest.json','/chosen/fork/source/mobile/art/masters/masters.json','/chosen/fork/source/mobile/art/masters/tree-crown@3x.png']);
 assert(!stage.requires.some(path=>path.includes('/.audit/mobile/')||path.endsWith('/site/local/index.html')));
 assert.match(stage.note,/current public phone/i);
});
test('current phone explicit directory or package remains the sole selected root',()=>{
 for(const phoneSite of ['/specific/phone','/specific/complete-candidate']){
  const stages=browserStagePlan({root:'/elsewhere/.audit',siteRoot:'/unrelated/stage',phoneSite,sourceRoot:'/specific/fork',out:'/reports',env:{}}),stage=stages.find(s=>s.name==='mobile');
  assert.equal(stage.args[stage.args.indexOf('--site')+1],phoneSite);assert.equal(stage.args[stage.args.indexOf('--source-root')+1],'/specific/fork');
  assert.equal(stage.requires[0],phoneSite+'/manifest.json');assert(!stage.args.some(arg=>arg.includes('/unrelated/stage/optimized/mobile')||arg.includes('/publish/mobile')));
  assert.deepEqual(selectBrowserStages(stages,{only:'mobile'}).map(s=>s.name),['mobile']);
 }
});
test('current phone empty explicit input and source binding fail during pure planning',()=>{
 for(const options of [{siteRoot:''},{siteRoot:' '},{siteRoot:null},{phoneSite:''},{phoneSite:' '},{phoneSite:null},{sourceRoot:''},{sourceRoot:' '},{sourceRoot:null}])assert.throws(()=>browserStagePlan({root:'/fork/.audit',siteRoot:'/stage',out:'/reports',env:{},...options}),/site-root|phone-site|source-root/);
});
