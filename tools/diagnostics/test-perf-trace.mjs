// Self-test for tools/diagnostics/perf-trace.mjs on generated fixture routes (needs Chrome; not part of npm test).
// node tools/diagnostics/test-perf-trace.mjs
// `jank` animates `left` (main thread) and burns 40 ms in rAF every 10th frame: those frames must be flagged and attributed to script (fn f) plus layout/paint of div#box.
import {ensureToolRuntime} from '../tool-runtime.mjs';
import {browserToolCLI} from '../browser-test-lib.mjs';
browserToolCLI();
const runtime=ensureToolRuntime({runTimeoutMs:300000});await runtime.ready;
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),dir=await runtime.tempDir('hw-perf-'),json=join(dir,'report.json');
const page=(css,body,js='')=>`<!doctype html><meta charset=utf-8><style>body{margin:0;height:3000px}#box{position:absolute;top:20px;left:0;width:60px;height:60px;background:#c33}@keyframes mv{to{left:300px}}@keyframes spin{to{rotate:1turn}}${css}</style>${body}<script>${js}</script>`;
const JS='let n=0;(function f(){if(++n%10===0){const e=performance.now()+40;while(performance.now()<e);}requestAnimationFrame(f)})()';   // x.js: external so FunctionCall events carry a url
const jank=page('#box{animation:mv 2s linear infinite alternate}','<p>perf fixture</p><div id=box data-pt-sweep></div><script src=x.js></script>');
const clean=page('#box{animation:spin 1s linear infinite}','<p>perf fixture</p><div id=box data-pt-sweep></div>');
try{
 for(const [route,html] of [['jank',jank],['clean',clean]]){await mkdir(join(dir,route));await writeFile(join(dir,route,'index.html'),html);}
 await writeFile(join(dir,'jank','x.js'),JS);
 const run=async(route)=>{const r=await runtime.runCommand(process.execPath,['tools/diagnostics/perf-trace.mjs','--route',route,'--scenario','sweep,idle,load','--seconds','5','--json',join(dir,route+'.json')],{label:'perf-trace fixture '+route,timeoutMs:120000,cwd:root,env:{...process.env,HW_SITE_ROOT:dir,HW_OUT:join(dir,'out-'+route)}});process.stdout.write(r.stdout+r.stderr);assert.equal(r.status,0,route+' run failed');return JSON.parse(readFileSync(join(dir,route+'.json'),'utf8'));};
 const J=await run('jank'),C=await run('clean');
 const jl=J.scenarios.sweep.window.lag,cl=C.scenarios.sweep.window.lag;
 // 5 s at 60 Hz = ~300 frames, every 10th janks: expect many; the clean route must be far quieter
 assert(jl.missed>=10,'jank route: expected >=10 flagged frames, got '+jl.missed);
 assert(jl.missed>cl.missed*3,`jank (${jl.missed}) must flag far more frames than clean (${cl.missed})`);
 const scripty=jl.worst.filter(m=>m.cause==='script');assert(scripty.length>=jl.missed/3,'most jank frames must be attributed to script, got '+JSON.stringify(jl.byCause));
 assert(scripty.some(m=>m.topFunctions.some(t=>/^f /.test(t.fn))),'attribution must name function f: '+JSON.stringify(scripty[0]?.topFunctions));
 assert(jl.worst.some(m=>m.mainThreadAnimations.some(a=>/div#box/.test(a))),'the left animation on div#box must be listed as a main-thread animation');
 assert(jl.byElement.some(e=>/div#box/.test(e.el)),'div#box must be implicated by paint/invalidation: '+JSON.stringify(jl.byElement));
 assert(J.scenarios.idle.top.main.TaskDurationMsPerSec>C.scenarios.idle.top.main.TaskDurationMsPerSec,'jank idle main-thread time must exceed clean');
 assert(J.scenarios.load.reload.fcpMs>0&&J.scenarios.load.reload.resources.length>=1,'load timeline must report FCP and resources');
 console.log('\nperf-trace self-test: OK');
}finally{await runtime.shutdown('perf-trace self-test complete');}
