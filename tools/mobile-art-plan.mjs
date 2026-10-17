// Pure selected-document plan; wording edits never imply a bake or encode.
import assert from 'node:assert/strict';
import {sha256} from './mobile-origin.mjs';
// Large native package receipts are shared by hash, not duplicated for every derivative.
export function recordArtToolchain(table,receipt){
 assert(table&&typeof table==='object'&&!Array.isArray(table)&&receipt?.schema===1&&receipt.kind==='optional-public-mobile-art-toolchain','Invalid shared art toolchain receipt');
 const bytes=JSON.stringify(receipt),digest=sha256(bytes);assert(Buffer.byteLength(bytes)<=8*1024*1024,'Art toolchain receipt exceeds8MiB');if(table[digest])assert(JSON.stringify(table[digest])===bytes,'Art toolchain reference changed');else table[digest]=receipt;return digest;
}
export function artRegenerationPlan({docs,masters,selected}={}){
 assert(Array.isArray(docs)&&docs.length>0&&docs.length<=32,'Expected1..32current art documents');
 const names=new Set();for(const doc of docs){assert(/^[a-z0-9-]+$/.test(doc.name)&&!names.has(doc.name),'Invalid or duplicate art name');names.add(doc.name);assert(Number.isInteger(doc.w)&&Number.isInteger(doc.h)&&doc.w>0&&doc.h>0&&doc.w<=4096&&doc.h<=4096&&typeof doc.html==='string'&&Buffer.byteLength(doc.html)<=8*1024*1024,'Invalid bounded art document');}
 if(selected!==undefined){assert(Array.isArray(selected)&&selected.length>0&&selected.length<=docs.length&&new Set(selected).size===selected.length,'Expected a nonempty unique art selection');for(const name of selected)assert(names.has(name),'Unknown art selection: '+name);}
 return docs.filter(doc=>!selected||selected.includes(doc.name)).map(doc=>{const prior=masters?.[doc.name],documentSha256=sha256(doc.html);return {name:doc.name,width:doc.w,height:doc.h,mask:!!doc.mask,documentSha256,action:prior?.doc===documentSha256&&prior.w===doc.w&&prior.h===doc.h&&/^[a-f0-9]{64}$/.test(prior.png||'')?'reuse-pinned-master':'render',priorMasterSha256:prior?.png||null};});
}
