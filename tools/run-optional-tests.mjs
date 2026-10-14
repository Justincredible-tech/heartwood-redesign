// Explicit optional-test runner. Windows-safe discovery via
// readdirSync, never shell globs. The default portable checks stay with test-public.mjs; this runner only
// orchestrates the optional browser/native/artifacts/posix-python groups. Every child is bounded and owned
// by the reviewed tool runtime (per-file timeout, cleanup admission, launcher-death); every Node file runs
// under the shared public reporter/watchdog and its single result line is admitted by the shared validator,
// so empty, skipped, incomplete or unsupported runs can never report PASS. A requested group with a missing
// prerequisite fails UNSUPPORTED before any resources are created; nothing installs or reaches the network.
//   node tools/run-optional-tests.mjs --list
//   node tools/run-optional-tests.mjs --group browser|native|artifacts|posix-python|all
import {readdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {ensureToolRuntime} from './tool-runtime.mjs';
import {validatePublicTestResult} from './public-test-results.mjs';
import {publicPythonCommand} from './public-python-tests.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const optionalDir=join(root,'tests','optional');
const reporterPath=join(root,'tools','public-test-reporter.mjs');
const groups={
  browser:['taste-tree.test.mjs','taste-network.test.mjs','taste-pick.property.test.mjs','taste-tree.property.test.mjs','tool-supervisor.process.test.mjs'],
  native:['device-session.test.mjs','phone-fork-adapter.test.mjs','phone-target-admission.test.mjs','timing-environment.lifecycle.test.mjs','tool-supervisor.process.test.mjs','native-runtime-deadline.test.mjs','browser-lifecycle-darwin.test.mjs'],
  artifacts:['taste-network.test.mjs','taste-pick.property.test.mjs','taste-tree.property.test.mjs','taste-tree.test.mjs']   // source-bound taste suites; grain-rendering.mjs is retained historical capability (see its header)
};
// Only these files compile or exercise the native C helper; every other native file stays compiler-free.
const compilerFiles=new Set(['tool-supervisor.process.test.mjs','native-runtime-deadline.test.mjs']);
const darwinFiles=new Set(['browser-lifecycle-darwin.test.mjs']);   // macOS-only cases, gated in the native check
const posixPythonFile='review-qwen-render-grain-safety-posix.test.py';
const PER_FILE_MS=15*60*1000,OVERALL_MS=45*60*1000;
const USAGE='Usage: node tools/run-optional-tests.mjs --list\n'
  +'       node tools/run-optional-tests.mjs --group browser|native|artifacts|posix-python|all\n'
  +'Missing prerequisites or non-passing, skipping or incomplete files fail the run; '
  +'bounds: '+(PER_FILE_MS/60000)+' min per file, '+(OVERALL_MS/60000)+' min overall. See docs/TESTING.md.\n';
const unsupported=reason=>{console.error('UNSUPPORTED: '+reason+' (see docs/TESTING.md)');process.exit(1);};

const rawArgs=process.argv.slice(2);
for(const flag of ['--group','--list']){
  const count=rawArgs.filter(arg=>arg===flag||(flag==='--group'&&arg.startsWith('--group='))).length;
  if(count>1){console.error('Repeated '+flag+' is not allowed.');console.error(USAGE);process.exit(2);}
}
let values;
try{
  values=parseArgs({args:rawArgs,options:{list:{type:'boolean'},group:{type:'string'},help:{type:'boolean',short:'h'}},strict:true,allowPositionals:false}).values;
}catch(error){console.error(String(error.message));console.error(USAGE);process.exit(2);}
if(values.help){console.log(USAGE);process.exit(0);}
if(values.list&&values.group!==undefined){console.error('--list and --group are mutually exclusive.');console.error(USAGE);process.exit(2);}
if(values.list){
  console.log('optional groups:');
  for(const [name,files] of Object.entries(groups))console.log('  '+name+': '+files.join(', '));
  console.log('  posix-python: '+posixPythonFile);
  process.exit(0);
}
if(values.group===undefined){console.error(USAGE);process.exit(2);}
const requested=values.group;
if(requested!=='all'&&!(requested in groups)&&requested!=='posix-python')unsupported('unknown optional group '+String(requested));
const selected=requested==='all'?[...Object.keys(groups),'posix-python']:[requested];
const staged=existsSync(optionalDir)?readdirSync(optionalDir):[];
for(const name of selected)for(const file of (name==='posix-python'?[posixPythonFile]:(groups[name]||[])))if(!staged.includes(file))unsupported('file not staged yet: '+file);
const selectedFiles=[...new Set(selected.flatMap(name=>name==='posix-python'?[]:(groups[name]||[])))];
const checks={
  browser:()=>{try{createRequire(join(root,'tools','browser','package.json')).resolve('playwright-core');}catch{return 'the optional browser packages are not installed; run `cd tools/browser && npm ci`';}return null;},
  native:()=>{
    if(process.platform==='win32')return 'native custody requires POSIX (no Windows provider ships in this checkout)';
    if(process.platform!=='darwin'&&selectedFiles.some(file=>darwinFiles.has(file)))return 'the macOS app-bundle browser-lifecycle case requires darwin (see docs/TESTING.md)';
    const compiling=selectedFiles.filter(file=>compilerFiles.has(file));
    if(compiling.length){
      if(!existsSync(join(root,'tools','process-identity.c')))return 'tools/process-identity.c is missing (needed by '+compiling.join(', ')+')';
      const probe=spawnSync(process.env.CC||'cc',['--version'],{stdio:'ignore',timeout:15000});
      if(probe.error||probe.status!==0)return 'the selected native files need a C compiler on PATH (set CC or install cc): '+compiling.join(', ');
    }
    return null;
  },
  artifacts:()=>{for(const input of [join(root,'source','heartwood-site.html'),join(root,'source','css','heartwood-site.css')])if(!existsSync(input))return 'the checked-in site source is missing: '+input;return null;},
  'posix-python':()=>{
    if(process.platform==='win32')return 'the POSIX custody suite requires POSIX';
    try{
      const interpreter=publicPythonCommand();
      const probe=spawnSync(interpreter.command,[...interpreter.args,'--version'],{stdio:'ignore',timeout:15000});
      return probe.error||probe.status!==0?'the Python interpreter is not available (set HW_PUBLIC_TEST_PYTHON / HW_PUBLIC_TEST_PYTHON_ARGS)':null;
    }catch(error){return 'invalid HW_PUBLIC_TEST_PYTHON configuration: '+error.message;}
  }
};
for(const name of selected){const problem=checks[name]();if(problem)unsupported(name+' group: '+problem);}
const deadlineAt=Date.now()+OVERALL_MS;
const runtime=ensureToolRuntime({name:'optional public test runner',runTimeoutMs:OVERALL_MS});await runtime.ready;
let failed=false;
const budget=()=>{if(Date.now()>=deadlineAt){console.error('UNSUPPORTED: overall time budget exhausted');return null;}return Math.min(PER_FILE_MS,deadlineAt-Date.now());};
const childEnv=extra=>({...process.env,PYTHONDONTWRITEBYTECODE:'1',HW_PUBLIC_TEST_ROOT:root,HW_PUBLIC_TEST_LAUNCHER_PID:String(process.pid),HW_PUBLIC_TEST_DEADLINE_AT:String(deadlineAt),...extra});
const prefix='HEARTWOOD_PUBLIC_TEST_CHILD_RESULT ';
try{
  for(const file of selectedFiles){
    const timeoutMs=budget();if(timeoutMs===null){failed=true;break;}
    const rel='tests/optional/'+file;
    const result=await runtime.runCommand(process.execPath,['--test','--experimental-test-isolation=none','--test-timeout=60000','--test-reporter='+reporterPath,join(root,rel)],{cwd:root,env:childEnv({HW_PUBLIC_TEST_FILES:JSON.stringify([rel]),HW_PUBLIC_TEST_OPTIONAL:JSON.stringify({group:requested,reason:'explicit optional group run'})}),timeoutMs,label:'optional '+rel,encoding:'utf8',maxBuffer:4*1024*1024});
    if(result.stdout)console.log(String(result.stdout).trimEnd());
    if(result.stderr)console.error(String(result.stderr).trimEnd());
    if(result.status!==0){console.error('FAIL: '+rel+' exited '+result.status+(result.timedOut?', timed out':'')+(result.error?' ('+result.error+')':''));failed=true;continue;}
    const lines=String(result.stdout).split('\n').filter(line=>line.startsWith(prefix));
    if(lines.length!==1){console.error('FAIL: exactly one public result line is required for '+rel+' (saw '+lines.length+')');failed=true;continue;}
    try{validatePublicTestResult(JSON.parse(lines[0].slice(prefix.length)),[rel]);console.log('PASS '+rel);}
    catch(error){console.error('FAIL: result admission for '+rel+': '+error.message);failed=true;}
  }
  if(selected.includes('posix-python')){
    const timeoutMs=budget();
    if(timeoutMs===null)failed=true;
    else{
      const rel='tests/optional/'+posixPythonFile,interpreter=publicPythonCommand();
      const result=await runtime.runCommand(interpreter.command,[...interpreter.args,join(root,rel)],{cwd:root,env:childEnv({}),timeoutMs,label:'optional '+rel,encoding:'utf8',maxBuffer:2*1024*1024});
      if(result.stdout)console.log(String(result.stdout).trimEnd());
      if(result.stderr)console.error(String(result.stderr).trimEnd());
      const output=String(result.stdout)+'\n'+String(result.stderr),ran=/Ran (\d+) tests? in/.exec(output);
      const clean=result.status===0&&ran&&Number(ran[1])>0&&/^OK$/m.test(output)&&!/^OK \(/m.test(output)&&!/FAILED/.test(output);
      if(clean)console.log('PASS '+rel);
      else{console.error('FAIL: the POSIX custody suite must run a nonempty, skip-free, passing unittest set ('+rel+'; exit '+result.status+(result.timedOut?', timed out':'')+(result.error?', '+result.error:'')+'; cleanup '+JSON.stringify(result.cleanup&&{errors:result.cleanup.errors,remaining:result.cleanup.remaining,observedLeftovers:result.cleanup.observedLeftovers})+')');failed=true;}
    }
  }
}finally{
  await runtime.shutdown('optional public tests complete');
}
process.exit(failed?1:0);
