import {commandCleanupProblems} from './command-acceptance.mjs';
// Opt-in property tests (fast-check). `npm test` stays install-free; fast-check is pinned in tools/package.json with its lock.
//   node tools/test-properties.mjs          HW_FC_RUNS=1000 HW_FC_SEED=<n> to scale / replay
import {ensureToolRuntime} from './tool-runtime.mjs';
import {parseToolArgs,showToolHelp} from './tool-cli.mjs';
showToolHelp(parseToolArgs(),'Usage: node tools/test-properties.mjs (HW_FC_RUNS/HW_FC_SEED control scale)');
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'..');
const requireFromTools=createRequire(new URL('./package.json',import.meta.url));
let fastCheckInstalled=false;try{requireFromTools.resolve('fast-check/package.json');fastCheckInstalled=true;}catch{}
if(!fastCheckInstalled){
  console.error('FAIL: fast-check is not installed, so NO property tests ran.\n  cd tools && npm ci --ignore-scripts\n(fast-check is pinned in tools/package.json and its lock.)');
  process.exit(1);
}
const retired=['package-optimized.property.test.mjs'];   // retired with the old package optimizer; kept so the name cannot silently reappear
const files=readdirSync(resolve(root,'tests')).filter(f=>f.endsWith('.property.test.mjs')&&!retired.includes(f)).sort().map(f=>'tests/'+f);
if(!files.length){console.error('FAIL: no tests/*.property.test.mjs found');process.exit(1);}
const rt=ensureToolRuntime({name:'property acceptance suite',runTimeoutMs:600000});
await rt.ready;
const r=await rt.runCommand(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',timeoutMs:540000,label:'property test workers',env:{...process.env,MODAL_VARIANT:'modal-fast-geometry.js'}});
const cleanupProblems=commandCleanupProblems(r);if(cleanupProblems.length)console.error(cleanupProblems.join('; '));
process.exitCode=r.status||(cleanupProblems.length?1:0);
await rt.shutdown('property acceptance suite complete');
