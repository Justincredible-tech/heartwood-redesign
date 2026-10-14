/** Maintained representative coverage for historical diagnostics; explicitly historical, never current public acceptance. No page acceptance is inferred. */
import {join,basename,resolve,dirname} from 'node:path';
import {readFile,writeFile,mkdir,readdir,symlink,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {commandCleanupProblems} from './command-acceptance.mjs';
import {loadSharp} from './sharp-deps.mjs';
export const RETAINED_BROWSER_TOOLS=[
  "output/playwright/review-taste-overlay/shift.mjs",
  "output/playwright/review-taste-overlay/lag.mjs",
  "output/playwright/review-taste-overlay/fringe2.mjs",
  "output/playwright/review-taste-bug/screenshot-session.mjs",
  "output/playwright/review-taste-bug/exploratory-walk.mjs",
  "output/playwright/review-taste-overlay/offs.mjs",
  "output/playwright/review-taste-overlay/touchdbg2.mjs",
  "output/playwright/review-taste-overlay/fringe.mjs",
  "output/playwright/review-taste-overlay/px.mjs",
  "output/playwright/review-taste-overlay/dbg.mjs",
  "output/playwright/review-taste-overlay/layers.mjs",
  "output/playwright/review-taste-overlay/touchdbg.mjs",
  "output/playwright/review-critters-inv/idle.mjs",
  "output/playwright/review-critters-inv/inventory.mjs",
  "output/playwright/review-critters-inv/zoom.mjs",
  "output/playwright/review-critters-inv/layers.mjs",
  "output/playwright/review-critters-inv/exp.mjs",
  "output/playwright/review-taste-dark/proposal/mech.mjs",
  "output/playwright/review-taste-dark/proposal/scene2.mjs",
  "output/playwright/review-taste-dark/proposal/shot.mjs",
  "output/playwright/review-taste-dark/proposal/shotfile2.mjs",
  "output/playwright/review-taste-dark/proposal/measure.mjs",
  "output/playwright/review-taste-dark/proposal/dom.mjs",
  "output/playwright/review-taste-dark/proposal/mech2.mjs",
  "output/playwright/review-taste-dark/proposal/mech3.mjs",
  "output/playwright/review-taste-lag/colour.mjs",
  "output/playwright/review-taste-lag/dr-mech.mjs",
  "output/playwright/review-taste-lag/parity.mjs",
  "output/playwright/review-taste-lag/debug-grain.mjs",
  "output/playwright/review-taste-lag/lag.mjs",
  "output/playwright/review-mobile/tools/measure3.mjs",
  "output/playwright/review-mobile/tools/measure2.mjs",
  "output/playwright/review-taste-dark/impl/diag-recalc.mjs",
  "output/playwright/review-measure-leaf/explore2.mjs",
  "output/playwright/review-measure-leaf/layers.mjs",
  "output/playwright/review-measure-leaf/explore.mjs",
  "output/playwright/review-taste-lag/debug-ov.mjs",
  "output/playwright/review-measure-leaf/profile.mjs",
  "output/playwright/review-measure-leaf/gated-idle.mjs",
  "output/playwright/abuse/dbg1.mjs",
  "output/playwright/review-measure-leaf/anims.mjs",
  "output/playwright/review-measure-leaf/measure.mjs",
  "output/playwright/review-p7-adv/adv-narrow.mjs",
  "output/playwright/review-p7-adv/adv-taste.mjs"
];
export function retainedBrowserStages({root,siteRoot,out}){
 return RETAINED_BROWSER_TOOLS.map(path=>{const name='retained-'+path.replace(/^output\/playwright\//,'').replace(/\.(mjs|js)$/,'').replaceAll('/','-'),stageOut=join(out,name),file=basename(path),env={HW_DIAGNOSTIC_TIMEOUT_MS:'180000'};let args=[];
 if(/review-taste-overlay/.test(path))Object.assign(env,{HW_GROW:'0',HW_PROMO:'wc',HW_DPR:'1',HW_FRACS:'0',HW_MODES:'plain',HW_ROUTES:'1',HW_SCROLL:'0',DS:'32',VW:'390',VH:'844'});
 if(/review-taste-(overlay|lag)\/(lag|parity|colour|dr-mech)\.mjs$/.test(path))Object.assign(env,{HW_VARIANTS:'taste',HW_VARIANT:'taste',HW_COMBOS:'1365x768@1:plain',HW_ENVS:'plain',HW_SWEEPS:'default',HW_SECONDS:'6',HW_PHASE_S:'2',HW_TRACE:'0',HW_OUT_SUB:stageOut,HW_TAG:'coverage'});
 if(/review-critters-inv/.test(path))Object.assign(env,{VARIANTS:file==='exp.mjs'?'orig':'optimized:base',ROUTES:'optimized',HW_SECONDS:'6',REPS:'1',HW_TRACE:'0',MODE:'PIX'});
 if(/review-measure-leaf/.test(path))Object.assign(env,{M_VARIANTS:file==='measure.mjs'?'repeat':'shipped',M_ACTIVITIES:'idle',M_STATE:'rest',M_STATES:'rest',M_SIZES:'1365x768@1',M_GLOBAL:'none',HW_SECONDS:'6'});
 if(path.endsWith('screenshot-session.mjs'))args=['@workspace','coverage'];
 if(path.endsWith('exploratory-walk.mjs'))args=['plain','8','/optimized-taste/'];
 if(file==='zoom.mjs')args=['@workspace/matrix-fixtures/a.png','@workspace/matrix-fixtures/b.png',join(stageOut,'zoom.png')];
 if(path.endsWith('proposal/scene2.mjs'))args=[stageOut,'light'];if(path.endsWith('proposal/shot.mjs'))args=['light','/optimized-taste/',stageOut];
 if(path.endsWith('proposal/shotfile2.mjs'))args=['@workspace/site/optimized/index.html',join(stageOut,'page.png')];if(path.endsWith('proposal/measure.mjs'))args=['light'];if(path.endsWith('proposal/dom.mjs'))args=['/optimized-taste/'];
 return {name,cat:'retained-diagnostic',args:[path,...args],covers:[path],scope:'full',timeoutMs:180000,prepare:'isolated-retained',env,requires:[join(root,path),join(siteRoot,'local/index.html'),join(siteRoot,'optimized/index.html'),join(siteRoot,'optimized-taste/index.html')],artifactScope:'historical-retained',note:'Historical retained diagnostic (archived private-review browser tools; not current public acceptance). Representative normal diagnostic plumbing with declared configuration; original sample/settling windows retained. No experimental ablation or concurrent timing acceptance claim.'};
 });
}
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function isolateRetainedBrowser(runtime,{root,siteRoot,out}){
 const dir=await runtime.tempDir('browser-retained-source-'),records=[];
 async function copy(from,to){const bytes=await readFile(from);await mkdir(dirname(to),{recursive:true});await writeFile(to,bytes,{mode:(await stat(from)).mode&0o777});if(hash(await readFile(from))!==hash(bytes)||hash(await readFile(to))!==hash(bytes))throw Error('Source changed during retained isolated copy: '+from);records.push({sourcePath:from,path:to,sha256:hash(bytes)});}
 async function tree(from,to,filter=()=>true){for(const e of await readdir(from,{withFileTypes:true})){if(e.name==='__pycache__'||!filter(e))continue;const src=join(from,e.name),dst=join(to,e.name);if(e.isDirectory())await tree(src,dst,filter);else if(e.isFile())await copy(src,dst);else throw Error('Unexpected source link '+src);}}
 const exists=async p=>{try{return !!(await stat(p));}catch{return false;}};
 await tree(join(root,'tools'),join(dir,'tools'),e=>e.name!=='node_modules');   // maintained current tools; standard dependencies bind by explicit symlink below, never a recursive whole-node_modules copy
 for(const route of ['local','optimized','optimized-taste','optimized-taste-dark','_external','heartwood']){const src=join(siteRoot,route);if(await exists(src))await tree(src,join(dir,'site',route),e=>e.name!=='node_modules');}
 await tree(join(root,'source'),join(dir,'source'),e=>e.name!=='node_modules');   // selected current public source
 for(const name of ['mobile','experiments']){const from=join(root,name);if(!await exists(from)){records.push({kind:'historical-tree',sourcePath:from,disposition:'historical',availability:'absent'});continue;}await tree(from,join(dir,name),e=>e.name!=='node_modules');records.push({kind:'historical-tree',sourcePath:from,path:join(dir,name),disposition:'historical',availability:'present'});}   // archived private-layout trees: never current inputs, kept only as an explicitly historical archival path
 const parents=[...new Set(RETAINED_BROWSER_TOOLS.map(dirname))];for(const p of parents){const from=join(root,p);if(!await exists(from)){records.push({kind:'historical-tool-tree',sourcePath:from,disposition:'historical',availability:'absent'});continue;}await tree(from,join(dir,p),e=>e.isDirectory()?e.name==='lib':/\.(mjs|js|css|py)$/.test(e.name)||e.name==='templates.json');}
 for(const [dependency,disposition] of [['node_modules','historical-legacy-root'],['tools/node_modules','current-standard-tools'],['tools/browser/node_modules','current-optional-browser']]){const from=join(root,dependency);if(!await exists(from)){records.push({kind:'dependency-binding',sourcePath:from,disposition,availability:'absent'});continue;}const to=join(dir,dependency);if(await exists(to)){records.push({kind:'dependency-binding',sourcePath:from,path:to,disposition,availability:'already-present'});continue;}await mkdir(dirname(to),{recursive:true});await symlink(from,to,'dir');records.push({kind:'dependency-binding',sourcePath:from,path:to,disposition,availability:'symlinked'});}   // optional deps resolve through tools/browser-deps.mjs, tools/fidelity-deps.mjs and tools/sharp-deps.mjs
 await mkdir(join(dir,'evidence'),{recursive:true});await mkdir(join(dir,'matrix-fixtures'),{recursive:true});const sharp=loadSharp();for(const name of ['a','b'])await sharp({create:{width:96,height:96,channels:4,background:name==='a'?'#bfcd99':'#bdcb97'}}).png().toFile(join(dir,'matrix-fixtures',name+'.png'));
 const generator=join(dir,'output/playwright/review-mobile/tools/gen.mjs');   // archived private review generator: available only from the explicit historical archival path
 if(await exists(generator)){const generated=await runtime.runCommand(process.execPath,[generator],{cwd:dir,env:{...process.env,HW_SITE_ROOT:join(dir,'site'),HW_W:dir,HW_OUT:join(out,'concept-preparation')},label:'prepare historical retained mobile concept outputs (archived private review generator)',timeoutMs:30000,maxBuffer:1048576});if(generated.status!==0||commandCleanupProblems(generated).length)throw Error('Historical retained mobile concept preparation failed: '+generated.status+' '+generated.stderr);records.push({kind:'historical-generator',path:generator,disposition:'historical',availability:'ran',exit:generated.status});}else records.push({kind:'historical-generator',path:generator,disposition:'historical',availability:'absent'});
 await mkdir(out,{recursive:true});await writeFile(join(out,'isolated-retained-source-ledger.json'),JSON.stringify({at:new Date().toISOString(),scope:'historical-retained isolation (archived private diagnostics only; never current public acceptance)',dir,records},null,2));return dir;
}
