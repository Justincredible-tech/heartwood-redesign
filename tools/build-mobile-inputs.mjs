import {open,lstat} from 'node:fs/promises';import {constants} from 'node:fs';
// Preserve every author geometry digit; transforms must never be rounded as path coordinates.
export function svgFromSymbol(symbol,fill){const viewBox=/viewBox="([^"]+)"/.exec(symbol)?.[1];if(!viewBox)throw Error('Logo symbol has no viewBox');const body=symbol.replace(/^<symbol[^>]*>/,'').replace(/<\/symbol>$/,'').replace(/currentColor/g,fill);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${/fill=/.test(body)?'':` fill="${fill}"`}>${body}</svg>`;}
export async function readBuildInput(path){
 let handle;const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||!Number.isSafeInteger(before.size)||before.size<0||before.size>8*1024*1024)throw Error('Expected bounded regular mobile source input: '+path);
 const unchanged=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===before.dev&&stat.ino===before.ino&&stat.size===before.size&&stat.mtimeMs===before.mtimeMs&&stat.ctimeMs===before.ctimeMs;
 const changed=()=>Error('Mobile source input changed: '+path);
 try{
  handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  if(!unchanged(await handle.stat()))throw changed();
  const chunks=[];let size=0;
  for(;;){const bytes=Buffer.allocUnsafe(Math.min(65536,before.size-size+1)),result=await handle.read(bytes,0,bytes.length,null);if(!result.bytesRead)break;size+=result.bytesRead;if(size>before.size)throw changed();chunks.push(bytes.subarray(0,result.bytesRead));}
  if(size!==before.size||!unchanged(await handle.stat())||!unchanged(await lstat(path)))throw changed();
  return Buffer.concat(chunks,size);
 }finally{await handle?.close();}
}
export function imageDimensions(bytes,type){
 const valid=(width,height)=>{if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>32768||height>32768)throw Error('Invalid mobile image dimensions');return {width,height};};
 if(type==='png'){if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw Error('Invalid pinned PNG master');return valid(bytes.readUInt32BE(16),bytes.readUInt32BE(20));}
 if(type!=='jpeg'||bytes.length<4||bytes[0]!==255||bytes[1]!==216)throw Error('Invalid pinned JPEG photograph');
 let at=2;while(at<bytes.length){if(bytes[at++]!==255)throw Error('Invalid JPEG marker');while(bytes[at]===255)at++;const marker=bytes[at++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(at+2>bytes.length)break;const size=bytes.readUInt16BE(at);if(size<2||at+size>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(size<8)break;return valid(bytes.readUInt16BE(at+5),bytes.readUInt16BE(at+3));}at+=size;}
 throw Error('JPEG has no supported dimension frame');
}
