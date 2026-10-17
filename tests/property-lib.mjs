// Shared fast-check setup for tests/*.property.test.mjs (required for the pure property suites; see
// docs/TESTING.md). Resolved by package name from the tools project (../tools/package.json) and
// pinned in the tools lockfile together with its exact pure-rand transitive version. Missing ->
// UNSUPPORTED; the property suites never silently pass and never substitute deterministic stand-ins.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const requireFromTools=createRequire(new URL('../tools/package.json',import.meta.url));
const UNSUPPORTED='UNSUPPORTED: fast-check is not installed (required for the pure property suites; see docs/TESTING.md)';
let fc=null;
try{fc=requireFromTools('fast-check');}catch{fc=null;}
if(!fc||typeof fc.assert!=='function')throw Error(UNSUPPORTED);
export {fc};
// HW_FC_RUNS = runs per property (default 200); HW_FC_SEED pins the seed. A failure prints its seed and counterexample; rerun with HW_FC_SEED=<seed>.
export const numRuns=Number(process.env.HW_FC_RUNS??200);
if(!Number.isInteger(numRuns)||numRuns<1)throw Error('HW_FC_RUNS must be a positive integer; zero property runs cannot pass');
export const seed=process.env.HW_FC_SEED!==undefined?Number(process.env.HW_FC_SEED):Math.floor(Math.random()*2**31);
if(!Number.isSafeInteger(seed)||(process.env.HW_FC_SEED!==undefined&&!process.env.HW_FC_SEED.trim()))throw Error('HW_FC_SEED must be a nonempty safe integer');
export const check=(property,opts={})=>{if(!opts||typeof opts!=='object'||Array.isArray(opts))throw Error('Property options must be an object');const runs=opts.numRuns??numRuns,selectedSeed=opts.seed??seed;if(!Number.isSafeInteger(selectedSeed))throw Error('Property seed must be a safe integer');if(!Number.isInteger(runs)||runs<1)throw Error('Property numRuns must be a positive integer');return fc.assert(property,{...opts,numRuns:runs,seed:selectedSeed,markInterruptAsFailure:true});};
let version='unknown';try{version=JSON.parse(await readFile(requireFromTools.resolve('fast-check/package.json'),'utf8')).version;}catch{}
console.log('# fast-check '+version+' numRuns='+numRuns+' seed='+seed);
