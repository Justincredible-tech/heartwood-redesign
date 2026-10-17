import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {grainLayers,prepareGrainRendering,GRAIN_DPRS,GRAIN_MEDIA,SCALED} from '../../tools/grain-rendering.mjs';

// SUPERSEDED (2026-10-14): retained historical suite for the `--cache-grain` css-rewriting
// epoch; the maintained stylesheet carries `--grain-tile` + media steps directly and the canonical
// grain-density tests are the live coverage. Not part of the optional artifacts group; its
// epoch-mismatch failures are recorded, not masked.
// --cache-grain (tools/grain-rendering.mjs): the original stylesheet stays verbatim, media-gated overrides are only inserted.
const root=new URL('../../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const css=await readFile(new URL('source/css/heartwood-site.css',root),'utf8');
const tileUrl=(i,d)=>`grain-${i}-${d}x.png`;
const media='\n@media '+GRAIN_MEDIA;
// Every insertion is "\n@media <GRAIN_MEDIA>{<rule>[<rule>]}" with brace-free declarations.
const insertion=new RegExp(media.replace(/[()]/g,'\\$&')+'\\{(?:[^{}]*\\{[^{}]*\\})+\\}','g');

test('the baked tiles belong to the current --grain and match grain.json',async()=>{
  const grain=grainLayers(css),baked=JSON.parse(await readFile(new URL('source/grain/grain.json',root),'utf8'));
  assert.equal(grain.layers.length,11);assert.equal(grain.tiled.length,7);
  assert.equal(baked.grain,grain.hash,'source/grain/ is stale: run node tools/bake-grain.mjs');
  assert.deepEqual(baked.dprs,GRAIN_DPRS);
  assert.equal(Object.keys(baked.tiles).length,grain.tiled.length*GRAIN_DPRS.length);
  for(const l of grain.tiled)for(const d of GRAIN_DPRS){
    const name=`grain-${l.index}-${d}x.png`,png=await readFile(new URL('source/grain/'+name,root));
    assert.equal(sha(png),baked.tiles[name],name);
    // PNG IHDR: one tile at d device pixels per CSS pixel.
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[l.w*d,l.h*d],name+' size');
  }
});

test('the original stylesheet is kept verbatim; only media-gated overrides are inserted',()=>{
  const out=prepareGrainRendering(css,{tileUrl});
  assert.equal(out.css.replace(insertion,''),css);
  const blocks=out.css.match(insertion);
  assert.equal(blocks.length,out.overrides+1,'one block per grain rule plus the --grain-img definition');
  assert(out.overrides>=20);
});

test('overrides only swap var(--grain), never on scaled or rotated art, and the scenes only take the small tiles',()=>{
  const out=prepareGrainRendering(css,{tileUrl}),blocks=out.css.match(insertion);
  const rootBlock=blocks.find(b=>b.includes(':root{--grain-img:'));
  const [all,pieces]=[...rootBlock.matchAll(/--grain-img:([^}]*)/g)].map(m=>m[1]);
  const grain=grainLayers(css);
  assert.equal((all.match(/image-set\(/g)||[]).length,grain.tiled.length);
  for(const l of grain.tiled)for(const d of GRAIN_DPRS)assert(all.includes(`url(${tileUrl(l.index,d)}) ${d}x`),l.index+'@'+d);
  const small=grain.tiled.filter(l=>l.w<=24&&l.h<=24);
  assert.equal((pieces.match(/image-set\(/g)||[]).length,small.length);
  for(const l of grain.layers.filter(l=>!l.w||l.w>24||l.h>24))assert(pieces.includes(l.text),'scene pieces keep '+l.text.slice(0,40));
  assert(rootBlock.includes('.stage > .scene{--grain-img:'));
  for(const b of blocks.filter(b=>b!==rootBlock)){
    const [,selectors,body]=/\{([^{}]*)\{([^{}]*)\}\}$/.exec(b);
    assert.match(body,/^background:[^]*var\(--grain-img\)/);assert(!body.includes('var(--grain)'));
    for(const s of selectors.split(/,(?![^(]*\))/)){
      assert(s.includes(':where(:not('+SCALED+'))'),'unscoped override '+s);
      assert(!/\.leaf__|\.leafmark|\.cap\b/.test(s),'override on scaled art '+s);
    }
  }
});

test('a changed --grain or grain rule shape fails the build with a message naming this module',()=>{
  const fewer=css.replace(/(--grain\s*:[^;]*?),\s*radial-gradient\(ellipse at 50% 50%, rgb\(255 255 255 \/ \.04\)[^;]*?(;)/,'$1$2');
  assert.notEqual(fewer,css,'fixture edit applies');
  assert.throws(()=>prepareGrainRendering(fewer,{tileUrl}),/update tools\/grain-rendering\.mjs/);
  assert.throws(()=>prepareGrainRendering(css+'\n.x { background-image: var(--grain); }',{tileUrl}),/outside the background shorthand[^]*update tools\/grain-rendering\.mjs/);
  assert.throws(()=>prepareGrainRendering(css+'\n.x { background: var(--grain), red; background-size: 3px; }',{tileUrl}),/after its grain background/);
  assert.throws(()=>prepareGrainRendering(css,{}),/tileUrl/);
});
