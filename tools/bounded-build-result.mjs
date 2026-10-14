// Pure transport result admission. Inert stdlib import; no Worker or composer entry.
import assert from 'node:assert/strict';
export function admitBoundedResult(method,result,{summary=false}={}){
 assert(result&&typeof result==='object'&&!Array.isArray(result)&&Object.keys(result).length>0,'Missing meaningful bounded build result');
 if(method==='buildMobile'){
  assert(typeof result.out==='string'&&result.out.trim()&&/^[a-f0-9]{64}$/.test(result.artifact||''),'Missing phone output/artifact');
  if(summary){assert(Number.isSafeInteger(result.files)&&result.files>0,'Empty phone build files');return result;}
  assert(result.manifest&&result.manifest.artifact===result.artifact&&Array.isArray(result.manifest.files)&&result.manifest.files.length>0,'Empty phone build manifest/files');
  assert(result.manifest.files.every(file=>file&&typeof file.path==='string'&&file.path.trim()&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&/^[a-f0-9]{64}$/.test(file.sha256||'')),'Invalid phone generated file evidence');
  return {out:result.out,artifact:result.artifact,files:result.manifest.files.length};
 }
 if(method==='describeArtRegeneration')assert(Array.isArray(result.plan)&&Array.isArray(result.photos)&&typeof result.browserRequired==='boolean'&&typeof result.scope==='string'&&result.scope.trim(),'Missing meaningful art planning result');
 return result;
}
