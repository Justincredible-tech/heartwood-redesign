/** PRIVATE offline browser fixtures. These serve committed originals locally;
 * their responses and validators are never proof about current live assets. */
import {lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';

export const PHOTO_FIXTURES=Object.freeze([
 Object.freeze({original:'https://heartwood.org/heartbeat/Fall-2026.jpg',path:'/__hw_photo__/cover.jpg',file:'Fall-2026.jpg'}),
 Object.freeze({original:'https://heartwood.org/events/forest-council/2026-forest-council.jpg',path:'/__hw_photo__/poster.jpg',file:'2026-forest-council.jpg'}),
]);
export const PHOTO_FIXTURE_INFO=Object.freeze({kind:'LOCAL_FIXTURE',liveSourceProof:false,sources:PHOTO_FIXTURES});
export const PHOTO_FIXTURE_INIT=`(()=>{
 if(!/^https?:$/.test(location.protocol)||!['127.0.0.1','localhost','[::1]'].includes(location.hostname))return;
 const sources=new Map(${JSON.stringify(PHOTO_FIXTURES.map(row=>[row.original,row.path]))});
 window.heartwoodPhotoSource=original=>sources.has(original)?new URL(sources.get(original),location.origin).href:original;
 window.heartwoodPhotoFixture=Object.freeze({kind:'LOCAL_FIXTURE',liveSourceProof:false,origin:location.origin,sources:${JSON.stringify(PHOTO_FIXTURES)}});
})();`;

const error=status=>Object.assign(Error('Local photo fixture unavailable'),{status});
const inside=(root,file)=>{const part=relative(root,file);return part===''||(!isAbsolute(part)&&!part.split(sep).includes('..'));};
const stamp=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
const etag=body=>'"'+createHash('sha256').update(body).digest('hex')+'"';

export function createPhotoFixtureResponder({root,maxBytes=6*1024*1024}={}){
 if(typeof root!=='string'||!root.trim()||!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('Invalid local photo fixture configuration');
 const directory=resolve(root),cache=new Map();
 async function photo(file){
  const rootBefore=await lstat(directory,{bigint:true});if(!rootBefore.isDirectory()||rootBefore.isSymbolicLink())throw error(403);
  const actualRoot=await realpath(directory),name=resolve(directory,file),before=await lstat(name,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink())throw error(403);
  const actual=await realpath(name);if(!inside(actualRoot,actual))throw error(403);
  if(before.size<=0n||before.size>BigInt(maxBytes))throw error(413);
  const key=stamp(before),cached=cache.get(file);
  if(cached?.stamp===key){
   const [named,rootAfter]=await Promise.all([lstat(name,{bigint:true}),lstat(directory,{bigint:true})]);
   if(stamp(named)!==key||named.isSymbolicLink()||rootBefore.dev!==rootAfter.dev||rootBefore.ino!==rootAfter.ino||!rootAfter.isDirectory()||rootAfter.isSymbolicLink())throw error(409);
   return cached;
  }
  const handle=await open(name,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
   const opened=await handle.stat({bigint:true});if(!opened.isFile()||stamp(opened)!==key)throw error(409);
   const body=Buffer.alloc(Number(opened.size));let offset=0;
   while(offset<body.length){const {bytesRead}=await handle.read(body,offset,body.length-offset,offset);if(!bytesRead)throw error(409);offset+=bytesRead;}
   const [after,named,rootAfter]=await Promise.all([handle.stat({bigint:true}),lstat(name,{bigint:true}),lstat(directory,{bigint:true})]);
   if(stamp(after)!==key||stamp(named)!==key||named.isSymbolicLink()||rootBefore.dev!==rootAfter.dev||rootBefore.ino!==rootAfter.ino||!rootAfter.isDirectory()||rootAfter.isSymbolicLink())throw error(409);
   const value={stamp:key,body,etag:etag(body),modified:new Date(Number(after.mtimeMs)).toUTCString()};cache.set(file,value);return value;
  }finally{await handle.close();}
 }
 return async(req,res,requestPath)=>{
  const fixture=PHOTO_FIXTURES.find(row=>row.path===requestPath);if(!fixture)return false;
  const value=await photo(fixture.file);
  const headers={'content-type':'image/jpeg','x-content-type-options':'nosniff','cache-control':'no-cache','x-heartwood-photo-fixture':'LOCAL_FIXTURE',etag:value.etag,'last-modified':value.modified};
  const tags=String(req.headers['if-none-match']||'').split(',').map(tag=>tag.trim().replace(/^W\//,''));
  if(tags.includes('*')||tags.includes(value.etag)){res.writeHead(304,headers);res.end();return true;}
  res.writeHead(200,{...headers,'content-length':value.body.length});res.end(req.method==='HEAD'?undefined:value.body);return true;
 };
}

// The phone's authored no-script photo remains remote in public output. Private
// loopback tests use the same original bytes locally even when JS is disabled.
// This deliberately narrow HTML token scan only changes literal known img src
// attributes within noscript; links, scripts, comments and other hosts survive.
export function rewriteNoScriptPhotoFixtures(body){
 const html=body.toString('utf8');if(!Buffer.from(html).equals(body))return {body,replacements:0};
 const sources=new Map(PHOTO_FIXTURES.map(row=>[row.original,row.path])),edits=[];
 let cursor=0,depth=0;
 const tagEnd=start=>{let quote='';for(let i=start;i<html.length;i++){const c=html[i];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')return i+1;}return html.length;};
 const raw=new Set(['script','style','textarea','title','xmp','iframe','noembed']);
 while(cursor<html.length){
  const start=html.indexOf('<',cursor);if(start<0)break;
  if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);cursor=end<0?html.length:end+3;continue;}
  const head=/^<(\/?)([a-z][\w:-]*)(?=[\s/>])/i.exec(html.slice(start));
  // A literal '<' in ordinary text is not an HTML tag; do not swallow
  // the next real noscript start while looking for a closing angle bracket.
  if(!head){cursor=['!','?'].includes(html[start+1])?tagEnd(start+1):start+1;continue;}
  const end=tagEnd(start+head[0].length),tag=html.slice(start,end),name=head[2].toLowerCase(),closing=!!head[1];
  if(!closing&&raw.has(name)){const close=new RegExp('</'+name+'(?=[\\s/>])','ig');close.lastIndex=end;const found=close.exec(html);cursor=found?tagEnd(found.index+found[0].length):html.length;continue;}
  if(!closing&&name==='plaintext')break;
  if(name==='noscript'){depth=closing?Math.max(0,depth-1):depth+1;cursor=end;continue;}
  if(depth&&!closing&&name==='img'){
   const attributes=/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;attributes.lastIndex=head[0].length;
   let attribute;while((attribute=attributes.exec(tag))){if(attribute[1].toLowerCase()!=='src')continue;
    const value=attribute[2]??attribute[3]??attribute[4],replacement=sources.get(value);
    if(replacement){const eq=attribute[0].indexOf('='),rest=attribute[0].slice(eq+1),gap=/^\s*/.exec(rest)[0].length,quoted=rest[gap]==='"'||rest[gap]==="'",offset=attribute.index+eq+1+gap+(quoted?1:0);edits.push({start:start+offset,end:start+offset+value.length,replacement});}
    break; // HTML takes the first duplicate attribute, even if it is unknown.
   }
  }
  cursor=end;
 }
 if(!edits.length)return {body,replacements:0};
 let result='',position=0;for(const edit of edits){result+=html.slice(position,edit.start)+edit.replacement;position=edit.end;}
 return {body:Buffer.from(result+html.slice(position)),replacements:edits.length};
}
