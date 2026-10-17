// Local dependency only; never invoke npx/package installation or an external URL.
import {resolve,join} from 'node:path';
import {access,mkdir,readdir,readFile} from 'node:fs/promises';
import {parseToolArgs,showToolHelp} from '../tool-cli.mjs';
import {ensureToolRuntime} from '../tool-runtime.mjs';
const p=parseToolArgs({strings:['url','label','cpu','variant','out']});showToolHelp(p,'Usage: node tools/diagnostics/run-lighthouse.mjs [--url LOOPBACK_HTTP_URL] [--label LABEL] [--cpu N] [--variant NAME] [--out DIR]; requires an already installed local Lighthouse CLI via HW_LIGHTHOUSE_CLI');
const url=p.values.url||'http://127.0.0.1:8766/optimized/',label=p.values.label||p.values.variant||'optimized',cpu=Number(p.values.cpu||6),u=new URL(url);
if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('Lighthouse URL must be loopback HTTP(S) without credentials');
if(!/^[a-zA-Z0-9_-]+$/.test(label)||!Number.isFinite(cpu)||cpu<=0)throw Error('invalid label or CPU multiplier');
const cli=process.env.HW_LIGHTHOUSE_CLI?resolve(process.env.HW_LIGHTHOUSE_CLI):null;
try{if(!cli)throw Error('unset');await access(cli);}catch{console.error('UNSUPPORTED: local Lighthouse CLI is not installed. No package or network download attempted. Set HW_LIGHTHOUSE_CLI to an existing local CLI.');process.exitCode=64;}
if(!process.exitCode){const rt=ensureToolRuntime({name:'local Lighthouse diagnostic',runTimeoutMs:180000});await rt.ready;
 try{const out=resolve(p.values.out||'output/playwright/lighthouse/'+label);await mkdir(out,{recursive:true});const stem=join(out,'run-'+rt.runId);
 const result=await rt.runCommand(process.execPath,[cli,url,'--preset=desktop','--only-categories=performance','--throttling-method=devtools','--throttling.cpuSlowdownMultiplier='+cpu,'--throttling.requestLatencyMs=0','--throttling.downloadThroughputKbps=0','--throttling.uploadThroughputKbps=0','--screenEmulation.width=1366','--screenEmulation.height=768','--screenEmulation.deviceScaleFactor=1','--chrome-flags=--headless --disable-extensions --disable-background-networking --proxy-server=http://127.0.0.1:1 --proxy-bypass-list=localhost;127.0.0.1;[::1]','--output=json','--output=html','--output-path='+stem,'--save-assets','--no-enable-error-reporting','--quiet'],{timeoutMs:170000,label:'local Lighthouse Chrome and report',stdio:'inherit'});
 if(result.status===0){const files=(await readdir(out)).filter(n=>n.startsWith('run-'+rt.runId));const json=files.find(n=>n.endsWith('.json')),html=files.find(n=>n.endsWith('.html'));if(!json||!html)throw Error('Lighthouse returned0 without both fresh report formats');const report=JSON.parse(await readFile(join(out,json),'utf8'));if(!report.lighthouseVersion||!report.audits||report.runtimeError)throw Error('Lighthouse output is incomplete or reports a runtime error');console.log('Diagnostic reports saved to '+out+'; page acceptance was not evaluated.');}
 process.exitCode=result.status||((result.cleanup.remaining.length||result.cleanup.errors.length||result.cleanup.observedLeftovers.length)?1:0);}
 finally{await rt.shutdown('Lighthouse completed');}}
