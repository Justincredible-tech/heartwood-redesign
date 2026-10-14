/** Confined loopback preview; node tools/serve.mjs (PORT defaults to 8765).
 * Baseline routes without headers.json retain no-store. Candidate/final routes
 * apply the nearest headers.json. All routes negotiate the same compression; compressed responses use a verified
 * `.precompressed/<identity sha256>.br|.gz` sidecar when present, else Brotli q4/gzip 6.
 */
import {createServer,validateHeaderName,validateHeaderValue} from 'node:http';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,basename,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {brotliCompress,gzip,brotliDecompress,gunzip,constants} from 'node:zlib';
import {isIP} from 'node:net';
import {createPhotoFixtureResponder,rewriteNoScriptPhotoFixtures} from './photo-fixtures.mjs';

const brotli=promisify(brotliCompress),gzipAsync=promisify(gzip);
const unbrotli=promisify(brotliDecompress),ungzip=promisify(gunzip);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.ico':'image/x-icon','.pdf':'application/pdf','.wasm':'application/wasm'};
const compressible=type=>/^(text\/|application\/(json|xml|wasm)|image\/svg\+xml)/.test(type);
const fingerprinted=name=>/\.[a-f0-9]{12,64}\.[^.]+$/i.test(name);
const inside=(root,path)=>{const part=relative(root,path);return part===''||(!isAbsolute(part)&&part.split(sep)[0]!=='..');};
const statusError=status=>Object.assign(new Error('HTTP '+status),{status});
const stamp=s=>`${s.mtimeNs}:${s.ctimeNs}:${s.size}`;
const digest=body=>'"'+createHash('sha256').update(body).digest('hex')+'"';
const protectedHeaders=new Set(['connection','keep-alive','transfer-encoding','content-length','content-encoding','content-type','etag','last-modified','vary','trailer','upgrade']);

function configuredHeaders(value) {
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid header configuration');
  const output={};
  for(const [name,entry] of Object.entries(value)){
    validateHeaderName(name);
    if(typeof entry!=='string'||protectedHeaders.has(name.toLowerCase()))throw Error('Invalid configured header '+name);
    validateHeaderValue(name,entry);
    output[name.toLowerCase()]=entry;
  }
  return output;
}
export function encodingFor(header,available) {
  if(!header)return 'identity';
  const qualities=new Map();
  for(const token of String(header).split(',')){
    const [rawName,...parameters]=token.toLowerCase().split(';'),name=rawName.trim();
    if(!name)continue;
    const q=parameters.map(p=>/^\s*q\s*=\s*(.*?)\s*$/.exec(p)).find(Boolean);
    const value=q?Number(q[1]):1;
    qualities.set(name,Number.isFinite(value)&&value>=0&&value<=1?value:0);
  }
  const quality=name=>qualities.has(name)?qualities.get(name):name==='identity'?(qualities.get('*')===0?0:1):(qualities.get('*')||0);
  return available.map(name=>({name,q:quality(name)})).filter(item=>item.q>0).sort((a,b)=>b.q-a.q)[0]?.name;
}
function hostname(value) {
  if(typeof value!=='string'||!value)return null;
  if(value.startsWith('['))return value.endsWith(']')&&isIP(value.slice(1,-1))===6?value.toLowerCase():null;
  if(/^[\d.]+$/.test(value))return isIP(value)===4?value:null;
  return value.length<=253&&value.split('.').every(label=>/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))?value.toLowerCase():null;
}

function requestHostname(value) {
  if(typeof value!=='string')return null;
  const match=/^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(value);
  if(!match||(match[2]!==undefined&&Number(match[2])>65535))return null;
  return hostname(match[1]);
}

export async function createPreviewServer({siteRoot=resolve(import.meta.dirname,'../publish'),cacheBytes=64*1024*1024,allowedHosts=['127.0.0.1','localhost','[::1]'],publicOnly=false,photoFixtureRoot=resolve(import.meta.dirname,'../source/assets/mobile/photos')}={}) {
  if(!Array.isArray(allowedHosts)||!allowedHosts.length||allowedHosts.some(value=>!hostname(value)))throw Error('allowedHosts must be a nonempty list of exact hostnames or IP literals without ports');
  const hosts=new Set(allowedHosts.map(hostname));
  const root=await realpath(siteRoot);
  if(!(await stat(root)).isDirectory())throw Error('Site root must be a directory');
  const cache=new Map(),policies=new Map();
  // Full originals served locally; never live proof or fallback acquisition.
  const respondPhotoFixture=createPhotoFixtureResponder({root:photoFixtureRoot});
  let retainedBytes=0;
  function trimCache(){
    while(retainedBytes>cacheBytes&&cache.size){const [key,entry]=cache.entries().next().value;cache.delete(key);retainedBytes-=entry.bytes;}
  }
  async function confined(path){const actual=await realpath(path);if(!inside(root,actual))throw statusError(403);return actual;}
  async function readPolicy(path){
    const actual=await confined(path),info=await stat(actual,{bigint:true});
    if(!info.isFile())throw Error('Header configuration must be a file');
    const key=stamp(info),cached=policies.get(actual);
    if(cached?.stamp===key)return cached.policy;
    const data=JSON.parse(await readFile(actual,'utf8'));
    const policy={html:configuredHeaders(data.html),fingerprintedAssets:configuredHeaders(data.fingerprintedAssets)};
    policies.set(actual,{stamp:key,policy});
    return policy;
  }
  async function snapshotPolicy(folder,sourceSha256){
    if(!sourceSha256)return null;
    let snapshots;
    try{snapshots=await confined(resolve(folder,'.release-policies'));}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!(await stat(snapshots)).isDirectory())throw Error('Release policies must be a directory');
    try{return await readPolicy(resolve(snapshots,sourceSha256+'.json'));}
    catch(error){
      if(['ENOENT','ENOTDIR'].includes(error.code))throw Error('HTML has no matching release policy');
      throw error;
    }
  }
  async function policyFor(file,sourceSha256) {
    for(let folder=dirname(file);inside(root,folder);folder=dirname(folder)){
      const snapshot=await snapshotPolicy(folder,sourceSha256);
      if(snapshot)return snapshot;
      try{
        const policy=await readPolicy(resolve(folder,'headers.json'));
        // Adoption may install the immutable directory after the first lookup,
        // then replace headers.json before this read. Recheck after reading the
        // fallback so even an already-running request keeps its HTML's policy.
        return await snapshotPolicy(folder,sourceSha256)||policy;
      }catch(error){
        if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;
      }
      if(folder===root)break;
    }
    return null;
  }
  async function precompressed(file,entry,encoding){
    const name=entry.variants.get('identity').etag.slice(1,-1)+(encoding==='br'?'.br':'.gz');
    for(let folder=dirname(file);inside(root,folder);folder=dirname(folder)){
      try{
        const path=await confined(resolve(folder,'.precompressed',name));
        const encoded=await readFile(path);
        // Sidecars are optional acceleration. Never trust their name alone,
        // and bound decode size before comparing with the actual source bytes.
        const decoded=await (encoding==='br'?unbrotli:ungzip)(encoded,{maxOutputLength:entry.body.length});
        if(decoded.equals(entry.body))return encoded;
      }catch{/* Missing, malformed, stale or unconfined sidecar: use source. */}
      if(folder===root)break;
    }
    return null;
  }
  async function representation(file,info,encoding) {
    const key=stamp(info);
    let entry=cache.get(file);
    if(entry?.stamp!==key){
      if(entry){cache.delete(file);retainedBytes-=entry.bytes;}
      const source=await readFile(file),sourceSha256=digest(source).slice(1,-1);
      const transformed=!publicOnly&&extname(file).toLowerCase()==='.html'?rewriteNoScriptPhotoFixtures(source):{body:source,replacements:0};
      const body=transformed.body;
      // Another request may have populated this file while readFile yielded.
      const concurrent=cache.get(file);
      if(concurrent?.stamp===key)entry=concurrent;
      else{
        if(concurrent){cache.delete(file);retainedBytes-=concurrent.bytes;}
        entry={stamp:key,body,sourceSha256,photoFixtureHtml:transformed.replacements>0,bytes:body.length,variants:new Map([['identity',{body,etag:digest(body)}]])};
        if(body.length<=cacheBytes){cache.set(file,entry);retainedBytes+=entry.bytes;trimCache();}
      }
    }else{cache.delete(file);cache.set(file,entry);}
    if(!entry.variants.has(encoding)){
      const operation=(async()=>{
        // Original HTML sidecars describe different bytes after fixture rewriting.
        const body=(!entry.photoFixtureHtml&&await precompressed(file,entry,encoding))||(encoding==='br'?await brotli(entry.body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}):await gzipAsync(entry.body,{level:6}));
        if(cache.get(file)===entry){entry.bytes+=body.length;retainedBytes+=body.length;trimCache();}
        return {body,etag:digest(body)};
      })();
      entry.variants.set(encoding,operation);
      operation.catch(()=>entry.variants.delete(encoding));
    }
    return {...await entry.variants.get(encoding),sourceSha256:entry.sourceSha256,photoFixtureHtml:entry.photoFixtureHtml};
  }
  return createServer({requestTimeout:30000,headersTimeout:10000,keepAliveTimeout:5000},async(req,res)=>{
    const send=(status,message,extra={})=>{
      const body=Buffer.from(message);
      res.writeHead(status,{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff','cache-control':'no-store','content-length':body.length,...extra});
      res.end(req.method==='HEAD'?undefined:body);
    };
    try{
      if(!hosts.has(requestHostname(req.headers.host)))return send(421,'Allowed host required');
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,'Method not allowed',{allow:'GET, HEAD'});
      if(!req.url?.startsWith('/')||req.url.startsWith('//'))return send(400,'Invalid path');
      const query=req.url.indexOf('?'),raw=query<0?req.url:req.url.slice(0,query);
      let path;
      try{path=decodeURIComponent(raw);}catch{return send(400,'Invalid path encoding');}
      if(/[\x00-\x1f\x7f]/.test(path))return send(400,'Invalid path');
      if(path.includes('\\')||path.includes(':')||path.split('/').includes('..'))return send(403,'Forbidden');
      if(!publicOnly&&await respondPhotoFixture(req,res,path))return;
      if(path.startsWith('/__hw_photo__/'))return send(404,'Not found');
      if(publicOnly&&path!=='/'&&path!=='/index.html'&&!/^\/assets\/[^/]+\.[a-f0-9]{12,64}\.[a-z0-9]+$/i.test(path))return send(404,'Not found');
      if(path==='/favicon.ico'){
        // Serve the selected site's own fingerprinted icon bytes; never fetch an external favicon.
        const meta=resolve(root,'assets/meta');
        const names=await readdir(meta).catch(()=>[]);
        const pick=names.find(n=>/^favicon-32\.[a-f0-9]{12,64}\.png$/.test(n))??names.find(n=>/^favicon\.[a-f0-9]{12,64}\.svg$/.test(n));
        if(!pick)return send(404,'Not found');
        path='/assets/meta/'+pick;
      }
      let file=await confined(resolve(root,'.'+path));
      let info=await stat(file,{bigint:true});
      if(info.isDirectory()){
        if(!path.endsWith('/')){
          res.writeHead(308,{location:raw+'/'+(query<0?'':req.url.slice(query)),'cache-control':'no-store','content-length':0});res.end();return;
        }
        file=await confined(resolve(file,'index.html'));
        info=await stat(file,{bigint:true});
      }
      if(!info.isFile())return send(404,'Not found');
      const type=types[extname(file).toLowerCase()]||'application/octet-stream';
      const isHtml=extname(file).toLowerCase()==='.html',immutable=fingerprinted(basename(file));
      const mayCompress=compressible(type)&&info.size>=256n;
      const encoding=encodingFor(req.headers['accept-encoding'],mayCompress?['br','gzip','identity']:['identity']);
      if(!encoding)return send(406,'No acceptable content encoding',{vary:'Accept-Encoding'});
      const value=await representation(file,info,encoding);
      // Choose the immutable policy for the exact uncompressed HTML bytes read.
      // The file may have changed after stat or between public-file renames.
      const policy=await policyFor(file,isHtml?value.sourceSha256:undefined);
      const headers={'content-type':type,'x-content-type-options':'nosniff',
        'cache-control':policy?(immutable?'public, max-age=31536000, immutable':'no-cache'):'no-store',
        ...(policy?(isHtml?policy.html:immutable?policy.fingerprintedAssets:{}):{}),
        etag:value.etag,'last-modified':new Date(Number(info.mtimeMs)).toUTCString()};
      if(value.photoFixtureHtml){headers['x-heartwood-photo-fixture']='LOCAL_FIXTURE';headers['x-heartwood-html-fixture']='noscript-photos';}
      if(mayCompress)headers.vary='Accept-Encoding';
      if(encoding!=='identity')headers['content-encoding']=encoding;
      const tags=String(req.headers['if-none-match']||'').split(',').map(tag=>tag.trim().replace(/^W\//,''));
      if(tags.includes('*')||tags.includes(value.etag)){res.writeHead(304,headers);res.end();return;}
      headers['content-length']=value.body.length;
      res.writeHead(200,headers);
      res.end(req.method==='HEAD'?undefined:value.body);
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      const status=error.status||(['ENOENT','ENOTDIR'].includes(error.code)?404:['EACCES','EPERM'].includes(error.code)?403:500);
      send(status,status===404?'Not found':status===403?'Forbidden':'Internal server error');
    }
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {parseToolArgs,showToolHelp}=await import('./tool-cli.mjs');showToolHelp(parseToolArgs(),'Usage: PORT=8765 node tools/serve.mjs (intentional foreground loopback preview)');
  const port=Number(process.env.PORT||8765);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT must be an integer from 0 through 65535');
  const {ensureToolRuntime}=await import('./tool-runtime.mjs');
  const {listenServer}=await import('./server-lifecycle.mjs');
  const rt=ensureToolRuntime({name:'loopback preview',persistent:true,runTimeoutMs:null,reason:'explicit foreground preview server; owner is invoking shell'});await rt.ready;
  const server=await createPreviewServer();
  await listenServer(server,{port,runtime:rt});
  console.log('Heartwood audit: http://127.0.0.1:'+server.address().port+'/heartwood-site.html');
}
