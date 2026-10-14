/** Paper grain as baked tiles (faithful build, --cache-grain). The site's `--grain` is eleven translucent background layers on every
 * piece of paper; seven of them are small gradient TILES (`<gradient> x y / w h`). Chrome rasterizes each tiled gradient as its own
 * picture shader on every element and every raster tile, which was ~3/4 of all GPU raster work (perf round 3). Here those seven
 * tiles are drawn once per device-pixel ratio by Chrome itself (tools/bake-grain.mjs, masters in source/grain/) and shipped as
 * PNG tiles: the same pixels, drawn as cached images. The four untiled layers stay CSS gradients.
 *
 * Only where the baked tile is the same raster: devices at exactly 1, 2 or 3 device pixels per CSS pixel (any other ratio, e.g.
 * a 2.625 phone or browser zoom, keeps the original gradients), and never on art that is scaled or smaller than a tile, where
 * Chrome re-rasterizes the gradient at the new scale or draws it directly (see SCALED/SKIP below). Every original rule stays
 * verbatim; after each rule whose `background` uses var(--grain) a media-gated copy of that declaration follows with
 * var(--grain-img), so the cascade order, specificity and invalid-at-computed-value behaviour are exactly the original's.
 * If an assertion below fails, the original CSS changed shape: update this file (and re-bake when --grain changed).
 *
 * SUPERSEDED (2026-10-14): the maintained stylesheet carries the tile machinery directly
 * (`--grain-tile` + per-density media steps in source/css/heartwood-site.css), the baked tiles live in
 * source/assets/grain/ with grain-provenance.json, and the canonical grain-density tests are the live
 * coverage; the desktop build does not call this tool. Retained historical capability for the
 * `--cache-grain` css-rewriting epoch: kept, not counted as current coverage, and its suite is not part
 * of the optional artifacts group.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const GRAIN_DPRS=[1,2,3];
export const GRAIN_MEDIA='(resolution: 1dppx), (resolution: 2dppx), (resolution: 3dppx)';
// Subtrees whose pieces are drawn under a scale (the tree: scale(1.12, 1.04); the flying leaf; critters, whose fidget/flap/wriggle
// keyframes scale and skew) or are smaller than a tile (flower petals): Chrome rasterizes their grain at that scale or
// point-samples it directly, so a baked tile would differ there.
export const SCALED='.bigtree *, .flowers *, .lift *, .bird *, .bug *, .critter *';
// Rules for art that is always scaled or rotated (tree leaves and the flyer, card leaf marks, the leaves behind capitals): no override.
// (Network circles scale 1.65 only while hovered; at rest their baked grain is exact.)
const SKIP=/\.leaf__|\.leafmark|\.cap\b/;
export const PIECES='.stage > .scene',SMALL_TILE=24;
const upd=' - update tools/grain-rendering.mjs';

const stripComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,'');
function splitTop(text,sep){const out=[];let depth=0,cur='',q='';for(const ch of text){if(q){cur+=ch;if(ch===q)q='';continue;}if(ch==='"'||ch==="'"){q=ch;cur+=ch;continue;}if(ch==='('||ch==='[')depth++;else if(ch===')'||ch===']')depth--;if(ch===sep&&!depth){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;}

/** The --grain layers of the original :root, tiled layers parsed. */
export function grainLayers(css){
  const roots=[...stripComments(css).matchAll(/(?:^|\})\s*:root\s*\{([^{}]*)\}/g)].map(m=>m[1]).join('\n');
  const defs=[...roots.matchAll(/--grain\s*:([^;]*);/g)];
  assert.equal(defs.length,1,'Expected exactly one --grain definition in :root, found '+defs.length+upd);
  const text=defs[0][1].trim().replace(/\s+/g,' ');
  const layers=splitTop(text,',').map(s=>s.trim()).map(l=>{
    const m=/^((?:repeating-)?(?:radial|linear|conic)-gradient\(.*\))\s+(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)\s*\/\s*([\d.]+)px\s+([\d.]+)px$/.exec(l);
    if(m)return {text:l,image:m[1],x:m[2],y:m[3],w:+m[4],h:+m[5]};
    const fn=/^(?:repeating-)?(?:radial|linear|conic)-gradient\(/.exec(l);let depth=0,close=-1;
    if(fn)for(let k=fn[0].length-1;k<l.length;k++){if(l[k]==='(')depth++;else if(l[k]===')'&&!--depth){close=k;break;}}
    assert(fn&&close===l.length-1,'Grain layer is neither a tiled gradient "<gradient> x y / Wpx Hpx" nor a bare gradient: '+l+upd);
    return {text:l};
  });
  return {text,hash:createHash('sha256').update(text).digest('hex'),layers,tiled:layers.flatMap((l,index)=>l.w?[{...l,index}]:[])};
}

// Style rules of a stylesheet: [{prelude, body, end}] with `end` the index just after the closing brace, recursing into
// @media/@supports and skipping other at-rules (@keyframes, @font-face). Comments and strings are respected.
function styleRules(css){
  const rules=[];
  const skipComment=i=>{const j=css.indexOf('*/',i+2);assert(j>=0,'Unclosed comment in original CSS'+upd);return j+2;};
  const blockEnd=i=>{let depth=0;for(let k=i;k<css.length;k++){const ch=css[k];if(ch==='/'&&css[k+1]==='*'){k=skipComment(k)-1;continue;}if(ch==='"'||ch==="'"){const e=css.indexOf(ch,k+1);assert(e>0,'Unclosed string'+upd);k=e;continue;}if(ch==='{')depth++;else if(ch==='}'&&!--depth)return k+1;}assert.fail('Unbalanced braces in original CSS'+upd);};
  const walk=(start,end)=>{
    let i=start;
    while(i<end){
      if(/\s/.test(css[i])){i++;continue;}
      if(css[i]==='/'&&css[i+1]==='*'){i=skipComment(i);continue;}
      let k=i;for(;k<end&&css[k]!=='{'&&css[k]!==';';k++){if(css[k]==='/'&&css[k+1]==='*')k=skipComment(k)-1;}
      if(k>=end)break;
      if(css[k]===';'){i=k+1;continue;}
      const prelude=stripComments(css.slice(i,k)).trim(),close=blockEnd(k);
      if(/^@(media|supports)\b/i.test(prelude))walk(k+1,close-1);
      else if(!prelude.startsWith('@'))rules.push({prelude,bodyStart:k+1,end:close,body:css.slice(k+1,close-1)});
      i=close;
    }
  };
  walk(0,css.length);
  return rules;
}
const scopedSelector=sel=>{const m=/(::?(?:before|after))$/.exec(sel);const guard=':where(:not('+SCALED+'))';return m?sel.slice(0,-m[1].length)+guard+m[1]:sel+guard;};

/** Rewrite the original stylesheet: every rule stays as written; the grain overrides and the --grain-img definition are inserted. */
export function prepareGrainRendering(css,{tileUrl}){
  assert.equal(typeof tileUrl,'function','tileUrl(layerIndex, dpr) is required');
  const grain=grainLayers(css);
  assert.equal(grain.layers.length,11,'--grain has '+grain.layers.length+' layers, expected 11'+upd);
  assert.equal(grain.tiled.length,7,'--grain has '+grain.tiled.length+' tiled layers, expected 7'+upd);
  const imgLayers=grain.layers.map((l,i)=>l.w?`image-set(${GRAIN_DPRS.map(d=>`url(${tileUrl(i,d)}) ${d}x`).join(', ')}) ${l.x} ${l.y} / ${l.w}px ${l.h}px`:l.text);
  // Art pieces (the scenes) are mostly smaller than the large soft tiles, which Chrome then draws directly rather than as a tile:
  // there only the small dot tiles are swapped.
  const pieceLayers=grain.layers.map((l,i)=>l.w&&l.w<=SMALL_TILE&&l.h<=SMALL_TILE?imgLayers[i]:l.text);
  const rootRule=`\n@media ${GRAIN_MEDIA}{:root{--grain-img:${imgLayers.join(',')}}${PIECES}{--grain-img:${pieceLayers.join(',')}}}`;
  const insertions=[];let overrides=0,skipped=0,rootAt=-1;
  for(const rule of styleRules(css)){
    if(rule.prelude===':root'&&/--grain\s*:/.test(rule.body)){assert.equal(rootAt,-1,'Two :root rules define --grain'+upd);rootAt=rule.end;}
    const decls=splitTop(stripComments(rule.body),';').map(d=>d.trim()).filter(Boolean);
    const grains=decls.map((d,i)=>[d,i]).filter(([d])=>/var\(\s*--grain\s*\)/.test(d));
    if(!grains.length)continue;
    assert.equal(grains.length,1,'Rule "'+rule.prelude+'" uses var(--grain) in '+grains.length+' declarations; expected one background'+upd);
    const [decl,at]=grains[0],m=/^background\s*:([^]*)$/i.exec(decl);
    assert(m,'Rule "'+rule.prelude+'" uses var(--grain) outside the background shorthand: '+decl+upd);
    assert(!/!important/i.test(decl),'Rule "'+rule.prelude+'" has an !important grain background'+upd);
    const later=decls.slice(at+1).filter(d=>/^background-/i.test(d));
    assert(!later.length,'Rule "'+rule.prelude+'" sets '+later.join('; ')+' after its grain background; the override would reset it'+upd);
    const parts=splitTop(rule.prelude,',').map(s=>s.trim().replace(/\s+/g,' ')).filter(s=>!SKIP.test(s));
    if(!parts.length){skipped++;continue;}
    const value=m[1].trim().replace(/var\(\s*--grain\s*\)/g,'var(--grain-img)');
    insertions.push([rule.end,`\n@media ${GRAIN_MEDIA}{${parts.map(scopedSelector).join(',')}{background:${value}}}`]);overrides++;
  }
  assert(rootAt>=0,'No :root rule defines --grain'+upd);
  assert(overrides>=20,'Only '+overrides+' grain rules found; the original CSS changed shape'+upd);
  insertions.push([rootAt,rootRule]);
  let out='',last=0;
  for(const [index,text] of insertions.sort((a,b)=>a[0]-b[0])){out+=css.slice(last,index)+text;last=index;}
  out+=css.slice(last);
  return {css:out,grain,overrides,skipped,tiles:grain.tiled.map(l=>({index:l.index,w:l.w,h:l.h}))};
}
