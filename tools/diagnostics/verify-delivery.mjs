import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createPreviewServer} from '../serve.mjs';
import {ensureToolRuntime} from '../tool-runtime.mjs';
import {listenServer,closeServer,browserToolCLI,isLocalUrl} from '../browser-test-lib.mjs';
browserToolCLI();
// Own loopback server over HW_SITE_ROOT (default site/) so the check never depends on a preview being up on 8766; HW_BASE=http://host:port/optimized/ checks a running server instead.
const site=resolve(process.env.HW_SITE_ROOT||resolve(import.meta.dirname,'../../publish')),evidence=resolve(process.env.HW_OUT||resolve(import.meta.dirname,'../../output/playwright/delivery'));
if(process.env.HW_BASE&&!isLocalUrl(process.env.HW_BASE))throw Error('HW_BASE must be loopback');
const runtime=ensureToolRuntime();await runtime.ready;
const fetchOwned=(url,options)=>runtime.deadline('delivery request '+url,signal=>fetch(url,{...options,signal}));
const server=process.env.HW_BASE?null:await createPreviewServer({siteRoot:site});
if(server)await listenServer(server,{runtime});
const base=process.env.HW_BASE||`http://127.0.0.1:${server.address().port}/optimized/`;
const manifest=JSON.parse(await readFile(resolve(site,'optimized/manifest.json'),'utf8'));
try{
const response=await fetchOwned(base);
assert.equal(response.status,200);await runtime.deadline('delivery response body',()=>response.arrayBuffer());
const headers=Object.fromEntries(response.headers);
assert.equal(headers['cache-control'],'no-cache');
assert(headers['content-security-policy'].includes("frame-ancestors 'self'"));
assert(headers['content-security-policy'].includes("style-src-attr 'none'"));
const unchanged=await fetchOwned(base,{headers:{'If-None-Match':headers.etag}});
assert.equal(unchanged.status,304);
const assets=[];
for(const asset of manifest.assets){
 const r=await fetchOwned(base+'assets/'+asset.file,{method:'HEAD'});
 assert.equal(r.status,200);assert(r.headers.get('cache-control').includes('immutable'));
 assets.push({file:asset.file,status:r.status,type:r.headers.get('content-type'),cache:r.headers.get('cache-control')});
}
const result={hash:manifest.htmlSha256,url:base,headers,conditionalStatus:unchanged.status,assets};
await mkdir(evidence,{recursive:true});
await writeFile(resolve(evidence,'implementation-delivery-headers.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({status:response.status,conditionalStatus:unchanged.status,encoding:headers['content-encoding'],assets:assets.length,cspApplied:true}));
}finally{if(server)await closeServer(server);}
