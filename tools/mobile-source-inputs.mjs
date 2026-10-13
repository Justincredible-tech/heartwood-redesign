// Explicit fork inputs for the private phone product. Original paper recipe is
// pinned separately; content, final logos, fonts and meta assets are upstream.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {basename,resolve} from 'node:path';
import {readBuildInput} from './build-mobile-inputs.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const ORIGINAL_PAPER_SHA256='afa5bc04eaf2b1365bc86b23fbaece931bc96b50b8d2998900a7d0fa162c402a';
export const FONT_INPUTS=[
 {logical:'3qTpojO2nS2VtkB3KtkQZ1t93kY.woff2',path:'source/assets/fonts/young-serif-latin.6ba68b9927ad.woff2',sha256:'6ba68b9927ad2a640d32cbea050ffc2b5d0ae6cbaa785afe470da9d6bf0ef39f'},
 {logical:'3qTpojO2nS2VtkB3KtkQZ1tz3kYoaQ.woff2',path:'source/assets/fonts/young-serif-latin-ext.9e6eb8e5e38f.woff2',sha256:'9e6eb8e5e38f9dcbab1ea58e2f30a4d6dfdb5b3bb602bfbff9305bca1d4060f6'},
 {logical:'pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2',path:'source/assets/fonts/instrument-sans-latin.2ee17598a98d.woff2',sha256:'2ee17598a98d8a59e4df8152d015bec9ab8e4d5672cc0ab42bef806b568e3971'},
 {logical:'pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0She1YmV.woff2',path:'source/assets/fonts/instrument-sans-latin-ext.c4fcfea41f2c.woff2',sha256:'c4fcfea41f2c1cfeea9211fa43679845454a1d0e0d7e95e069c7e73c4ae302d2'},
];
export const PHOTO_INPUTS=[
 {name:'cover',src:'source/assets/mobile/photos/Fall-2026.jpg',url:'https://heartwood.org/heartbeat/Fall-2026.jpg',widths:[240,360,720],sha256:'3a59cc1b2c683d2c0614cf2cd9b81db053a163be94645d567b531bd71059136f'},
 {name:'poster',src:'source/assets/mobile/photos/2026-forest-council.jpg',url:'https://heartwood.org/events/forest-council/2026-forest-council.jpg',widths:[480,720],sha256:'f3aa87637ff4f57878047673b4dcee1dfea261b227e2a49c6818ff9b70ab666a'},
];
export function forkInputRoot(root,sourceRoot){ return resolve(sourceRoot || root); }
export function metaInputs(markup){
 const tags=[...markup.matchAll(/<link\b([^>]*)>/g)].map(([,attrs])=>Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v])));
 const take=(predicate,name)=>{const hits=tags.filter(predicate);assert.equal(hits.length,1,'Expected one upstream '+name);const item=hits[0];assert(/^assets\/meta\/[a-z0-9.-]+\.(?:svg|png)$/.test(item.href),'Unsafe upstream meta path');return {name,...item,path:'source/'+item.href};};
 return [take(t=>t.rel==='icon'&&t.type==='image/svg+xml','favicon'),take(t=>t.rel==='icon'&&t.type==='image/png'&&t.sizes==='32x32','favicon-32'),take(t=>t.rel==='apple-touch-icon','apple-touch-icon')];
}
export async function loadMobileSources({root,sourceRoot,runtime}){
 const fork=forkInputRoot(root,sourceRoot),provenance=[];
 const input=async(base,path,origin,{expected,encoding='utf8'}={})=>{const bytes=await readBuildInput(resolve(base,path));const digest=sha(bytes);if(expected)assert.equal(digest,expected,'Unreviewed input changed: '+path);provenance.push({origin,path,sha256:digest,bytes:bytes.length});return encoding===null?bytes:bytes.toString('utf8');};
 const markup=await input(fork,'source/heartwood-site.html','upstream');
 const scriptSource=await input(fork,'source/js/heartwood-site.js','upstream');
 const upstreamCss=await input(fork,'source/css/heartwood-site.css','upstream');
 const logoColours=[...upstreamCss.matchAll(/--logo:\s*(#[a-f0-9]{6})\s*;/gi)];assert.equal(logoColours.length,1,'Expected one upstream final logo colour');
 const artCss=await input(root,'source/mobile/reference-paper.css','original-paper-reference',{expected:ORIGINAL_PAPER_SHA256});
 const fonts=[];for(const f of FONT_INPUTS)fonts.push({...f,bytes:await input(fork,f.path,'upstream',{expected:f.sha256,encoding:null})});
 const licenses=[];for(const path of ['source/assets/fonts/instrumentsans-OFL.txt','source/assets/fonts/youngserif-OFL.txt'])licenses.push({name:basename(path),bytes:await input(fork,path,'upstream-font-license',{encoding:null})});
 const icons=[];for(const meta of metaInputs(markup)){const bytes=await input(fork,meta.path,'upstream',{encoding:null}),fingerprint=/\.([a-f0-9]{12})\.(?:png|svg)$/.exec(meta.path)?.[1];assert(fingerprint&&sha(bytes).startsWith(fingerprint),'Upstream meta fingerprint mismatch: '+meta.path);icons.push({...meta,bytes});}
 const photos=[];for(const p of PHOTO_INPUTS)photos.push({...p,bytes:await input(root,p.src,'original-site-photo',{expected:p.sha256,encoding:null})});
 return {fork,markup,scriptSource,upstreamCss,logoColour:logoColours[0][1],artCss,artSource:{markup,css:artCss},fonts,icons,photos,licenses,provenance};
}
