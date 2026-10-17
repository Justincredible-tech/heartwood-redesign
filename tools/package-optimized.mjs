import {readFile,writeFile,mkdir,rename,unlink,rmdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {promisify} from 'node:util';
import {brotliCompress,gzip,constants} from 'node:zlib';

const root=resolve(import.meta.dirname,'..');
const digest=b=>createHash('sha256').update(b).digest('hex');
const brotli=promisify(brotliCompress),gzipAsync=promisify(gzip);

// Windows editors/AV can briefly deny delete-sharing. Bound EPERM/EBUSY retries;
// unrelated errors such as bad paths or disk exhaustion fail immediately.
async function renameWithRetry(from,to){
  for(let attempt=0;;attempt++){
    try{return await rename(from,to);}catch(error){
      if(!['EPERM','EBUSY'].includes(error.code)||attempt===3)throw error;
      await delay(25*2**attempt);
    }
  }
}
async function optionalRead(path){
  try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// [br, gzip] sidecar bodies. RFC 1952 OS byte: 255 = unknown; not covered by CRC32/ISIZE. Makes sidecars platform-independent.
export async function encodeVariants(body){
  const variants=await Promise.all([brotli(body,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}),gzipAsync(body,{level:9})]);
  variants[1][9]=0xff;
  return variants;
}

// A validated in-memory snapshot prevents later input edits from changing the
// bytes we publish. The manifest is the builder's final commit marker.
export async function packageOptimized({input=resolve(root,'site/responsive-styles'),output=resolve(root,'site/optimized'),evidence}={}) {
  const inputManifestBytes=await readFile(join(input,'manifest.json'));
  const manifest=JSON.parse(inputManifestBytes);
  const html=await readFile(join(input,'index.html'));
  const headers=await readFile(join(input,'headers.json'));
  assert.equal(digest(html),manifest.htmlSha256,'HTML hash mismatch');
  assert.equal(digest(headers),manifest.headersSha256,'Headers hash mismatch');
  JSON.parse(headers);
  const assets=new Map();
  for(const asset of manifest.assets){
    assert.match(asset.file,/^[a-zA-Z0-9._-]+\.[a-f0-9]{16}\.[a-z0-9]+$/,'Invalid asset filename');
    assert(asset.file.includes('.'+asset.sha256.slice(0,16)+'.'),'Asset filename does not identify its bytes');
    const body=await readFile(join(input,'assets',asset.file));
    assert.equal(digest(body),asset.sha256,'Asset hash mismatch: '+asset.file);
    assert.equal(body.length,asset.bytes,'Asset length mismatch: '+asset.file);
    if(assets.has(asset.file))assert(assets.get(asset.file).equals(body),'Conflicting duplicate asset');
    assets.set(asset.file,body);
  }
  // Each immutable representation is keyed by its decoded source identity.
  // Generate before publication so no request pays the high-quality encode.
  const compressed=new Map();
  manifest.encodings=[];
  for(const [source,body] of [['index.html',html],...[...assets].map(([file,body])=>['assets/'+file,body])]){
    if(body.length<256||!(/\.(html|css|js|mjs|json|xml|svg|txt|wasm)$/i.test(source)))continue;
    const sourceSha256=digest(body),entry={source,sourceSha256,sourceBytes:body.length};
    const variants=await encodeVariants(body);
    for(const [i,encoding] of ['br','gzip'].entries()){
      const encoded=variants[i],name=sourceSha256+(encoding==='br'?'.br':'.gz');
      compressed.set(name,encoded);
      entry[encoding]={file:'.precompressed/'+name,sha256:digest(encoded),bytes:encoded.length};
    }
    manifest.encodings.push(entry);
  }
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));
  assert((await readFile(join(input,'manifest.json'))).equals(inputManifestBytes),'Build changed during packaging; retry after it completes');
  await mkdir(output,{recursive:true});
  const lock=join(output,'.package-lock');
  await mkdir(lock); // Fail rather than interleave two publishers.
  const stage=join(output,'.package-'+randomUUID());
  const staged=[],stagedDirectories=[],previous=new Map(),published=[];
  let recoveryRequired=false;
  const publicNames=['index.html','headers.json','manifest.json'];
  try{
    await mkdir(stage);
    for(const name of publicNames)previous.set(name,await optionalRead(join(output,name)));
    if([...previous.values()].some(body=>body!==null)){
      try{
        assert([...previous.values()].every(body=>body!==null));
        const priorManifest=JSON.parse(previous.get('manifest.json'));
        assert.equal(digest(previous.get('index.html')),priorManifest.htmlSha256);
        assert.equal(digest(previous.get('headers.json')),priorManifest.headersSha256);
      }catch(cause){
        throw new Error('Existing output is not a coherent generation; inspect the prior split and restore matching HTML, headers, and manifest before publishing',{cause});
      }
    }
    await mkdir(join(output,'assets'),{recursive:true});
    if(compressed.size)await mkdir(join(output,'.precompressed'),{recursive:true});
    for(const [name,body] of previous){
      if(body){const backup=join(stage,name+'.previous');staged.push(backup);await writeFile(backup,body,{flag:'wx'});}
    }
    // Bind preview response headers to the HTML bytes actually read, not to
    // a mutable headers.json that may belong to the next/previous generation.
    // Retain these snapshots, like assets, for in-flight old-page requests.
    const policies=join(output,'.release-policies');
    let policyDirectory=policies;
    try{assert((await stat(policies)).isDirectory(),'Release policies must be a directory');}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      // Existing preview requests may still be using headers.json. Publish the
      // first snapshot directory only after both generations are complete.
      policyDirectory=join(stage,'.release-policies');
      await mkdir(policyDirectory);stagedDirectories.push(policyDirectory);
    }
    async function preservePolicy(htmlBytes,headerBytes){
      const path=join(policyDirectory,digest(htmlBytes)+'.json'),existing=await optionalRead(path);
      if(existing){assert(existing.equals(headerBytes),'The same HTML identity has conflicting response headers');return;}
      const temporary=join(stage,digest(htmlBytes)+'.policy');staged.push(temporary);
      await writeFile(temporary,headerBytes,{flag:'wx'});
      await renameWithRetry(temporary,path);
      if(policyDirectory!==policies)staged.push(path);
    }
    if(previous.get('index.html')){
      assert(previous.get('headers.json'),'Existing HTML is missing its response headers');
      await preservePolicy(previous.get('index.html'),previous.get('headers.json'));
    }
    await preservePolicy(html,headers);
    if(policyDirectory!==policies)await renameWithRetry(policyDirectory,policies);
    // Every prospective write and rollback backup exists before public files
    // change. Never retire old assets: lazy media in open tabs still need them.
    for(const [name,body] of [...assets,['headers.json',headers],['manifest.json',manifestBytes],['index.html',html]]){
      const path=join(stage,name);staged.push(path);await writeFile(path,body,{flag:'wx'});
    }
    for(const [name,body] of compressed){
      const path=join(stage,'encoded-'+name);staged.push(path);await writeFile(path,body,{flag:'wx'});
    }
    for(const [name,body] of compressed){
      const existing=await optionalRead(join(output,'.precompressed',name));
      if(existing)assert(existing.equals(body),'Existing source identity has different precompressed bytes: '+name);
      else await renameWithRetry(join(stage,'encoded-'+name),join(output,'.precompressed',name));
    }
    for(const name of assets.keys()){
      const existing=await optionalRead(join(output,'assets',name));
      if(existing)assert(existing.equals(assets.get(name)),'Existing fingerprint identifies different asset bytes: '+name);
      else await renameWithRetry(join(stage,name),join(output,'assets',name));
    }
    // A locked index must fail before changing shared public metadata. Later
    // failures restore all changed files from backups. This is not a crash-
    // atomic transaction for arbitrary static hosts; deployment stays separate.
    for(const name of publicNames){await renameWithRetry(join(stage,name),join(output,name));published.push(name);}
  }catch(error){
    const failures=[];
    for(const name of [...published].reverse()){
      try{
        if(previous.get(name))await renameWithRetry(join(stage,name+'.previous'),join(output,name));
        else await unlink(join(output,name));
      }catch(failure){failures.push(failure);}
    }
    if(failures.length){
      recoveryRequired=true;
      await writeFile(join(stage,'recovery.json'),JSON.stringify({published,previousFiles:[...previous].filter(([,bytes])=>bytes).map(([name])=>name),error:error.message,rollbackErrors:failures.map(failure=>failure.message)},null,2));
      throw new AggregateError([error,...failures],'Publication and rollback failed; retained publisher lock and recovery files at '+stage,{cause:error});
    }
    throw error;
  }finally{
    if(!recoveryRequired){
      for(const path of staged)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
      for(const path of stagedDirectories)await rmdir(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await rmdir(stage).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await rmdir(lock);
    }
  }
  if(evidence)await writeFile(evidence,JSON.stringify(manifest,null,2));
  return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {parseToolArgs,showToolHelp}=await import('./tool-cli.mjs');
  const parsed=parseToolArgs({maxPositionals:1});showToolHelp(parsed,'Usage: node tools/package-optimized.mjs [INPUT_DIR]');
  const {ensureToolRuntime}=await import('./tool-runtime.mjs');const rt=ensureToolRuntime({name:'optimized packaging',runTimeoutMs:300000});await rt.ready;
  const manifest=await packageOptimized({...(parsed.positionals[0]&&{input:resolve(parsed.positionals[0])}),evidence:resolve(root,'evidence/optimized-build.json')});
  console.log(JSON.stringify({output:resolve(root,'site/optimized'),htmlSha256:manifest.htmlSha256,assets:manifest.assets.length,records:manifest.content.records}));
}
