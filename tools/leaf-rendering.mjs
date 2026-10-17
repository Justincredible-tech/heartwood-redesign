/** Give each static tree leaf an unrotated layer box that the browser can
 * promote, so rapid hover re-rasterizes one small layer instead of the whole
 * canopy. The button, its artwork, transform, filter, animation and style
 * attribute are untouched. Capture-specific, not a general HTML/CSS rewriter.
 * If an assertion below fails, the original art CSS changed: update this file.
 */
import assert from 'node:assert/strict';

const voidTags=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const hasClass=(tag,name)=>(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find(x=>x!==undefined)||'').split(/\s+/).includes(name);
const upd=' - update tools/leaf-rendering.mjs';
const need=(cond,msg)=>cond||assert.fail(msg());
const tokenPattern=/<!--[\s\S]*?-->|<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function wrapStaticLeaves(html){
  const stack=[],insertions=[],ctx=i=>' (markup at index '+i+': '+JSON.stringify(html.slice(Math.max(0,i-40),i+40))+')';
  let leavesWrapped=0;const leafClasses=new Set();
  for(const match of html.matchAll(tokenPattern)){
    const raw=match[0],end=match.index+raw.length;
    if(raw.startsWith('<!--')||match[1])continue;
    const tag=match[2].toLowerCase();
    if(raw.startsWith('</')){
      const node=stack.pop();
      need(node?.tag===tag,()=>'Unexpected closing tag or nesting in leaf input: expected </'+node?.tag+'> but found </'+tag+'>'+ctx(match.index)+upd);
      if(node.leaf)insertions.push([end,'</span>']);
      continue;
    }
    need(!hasClass(raw,'hw-leaf-layer'),()=>'Leaf layer wrapper already present in input'+ctx(match.index)+upd);
    let leaf=false;
    if(tag==='button'&&hasClass(raw,'leaf')&&stack.some(node=>node.tree)){
      need(stack.at(-1).tree,()=>'Static leaf button must be a direct child of .tree, but its parent is <'+stack.at(-1).tag+'>; the markup nests leaves now'+ctx(match.index)+upd);
      const style=/\sstyle\s*=\s*"([^"]*)"/i.exec(raw)?.[1];
      need(style!==undefined,()=>'Static leaf button has no style attribute; its layer needs the same --x/--y/--s'+ctx(match.index)+upd);
      const declarations=style.split(';').map(d=>d.trim()).filter(Boolean);
      need(declarations.every(d=>/^--[\w-]+\s*:/.test(d)),()=>'Static leaf style must contain only custom properties, got: '+style+ctx(match.index)+upd);
      for(const name of ['--x','--y','--s'])need(declarations.some(d=>d.startsWith(name+':')),()=>'Static leaf style is missing '+name+': '+style+ctx(match.index)+upd);
      for(const c of (/\sclass\s*=\s*"([^"]*)"/i.exec(raw)?.[1]||'').split(/\s+/))if(c&&c!=='leaf'&&!c.startsWith('hw-'))leafClasses.add(c);
      insertions.push([match.index,'<span class="hw-leaf-layer" style="'+style+'">']);
      leaf=true;leavesWrapped++;
    }
    if(!voidTags.has(tag)&&!raw.endsWith('/>'))stack.push({tag,tree:hasClass(raw,'tree'),leaf});
  }
  need(!stack.length,()=>'Unclosed tag in leaf input; open tags: '+stack.map(n=>n.tag).join(' > ')+upd);
  need(leavesWrapped>0,()=>'No static tree leaf buttons found; the .tree markup changed'+upd);
  // Stable sort: at equal offsets (adjacent leaves) the earlier close precedes the later open.
  let out='',last=0;
  for(const [index,text] of insertions.sort((a,b)=>a[0]-b[0])){out+=html.slice(last,index)+text;last=index;}
  return {html:out+html.slice(last),leavesWrapped,leafClasses:[...leafClasses]};
}

const geometryProps='position|left|top|width|aspect-ratio';
const forbiddenProps='inset(?:-[\\w-]+)?|right|bottom|height|(?:min|max)-[\\w-]+|margin(?:-[\\w-]+)?|padding(?:-[\\w-]+)?|border(?:-[\\w-]+)?|translate|scale|rotate';
const declared=(body,names)=>[...body.matchAll(new RegExp('(?:^|;)\\s*('+names+')\\s*:\\s*([^;]+)','gi'))].map(m=>[m[1].toLowerCase(),m[2].trim()]);
const leafOf=/\.leaf(?![\w-])/;
// A rule styles static leaves if any of its selectors names .leaf, a `button` inside the tree context, or a class carried by the static leaf buttons in the input (t1-t6...).
const styleLeaf=(selector,classes)=>selector.split(',').some(sel=>leafOf.test(sel)||/(?<![\w-])button(?![\w-])/.test(sel)&&/\.(?:big)?tree(?![\w-])/.test(sel)||classes.some(c=>new RegExp('\\.'+c.replace(/[^\w-]/g,'\\$&')+'(?![\\w-])').test(sel)));

function layerStyles(originalCss,classes=[]){
  const css=originalCss.replace(/\/\*[\s\S]*?\*\//g,'');
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),body:m[2]}));
  const leafRules=rules.filter(rule=>styleLeaf(rule.selector,classes));
  const z=leafRules.flatMap(rule=>declared(rule.body,'z-index').map(([,value])=>rule.selector+' '+value));
  assert.deepEqual(z,['button.leaf:hover 5','.leaf:focus-visible 6','.tree.is-filtered .leaf.is-lit 4','.leaf.is-found 6'],
    'z-index rules on .leaf changed. The layer mirrors them in generated CSS; update the mirrored selectors and their specificity order in tools/leaf-rendering.mjs');
  assert(/@media\s*\(hover:\s*hover\)\s*\{\s*button\.leaf:hover\s*\{[^{}]*\bz-index\s*:\s*5\b/i.test(css),
    'The button.leaf:hover z-index rule must sit inside @media (hover: hover) in the original CSS; the mirrored hover rule is gated the same way - update tools/leaf-rendering.mjs');
  const geometry=leafRules.filter(rule=>declared(rule.body,geometryProps).length);
  assert.equal(geometry.length,1,'Exactly one .leaf rule must set position/left/top/width/aspect-ratio; the layer derives its box from it. Update tools/leaf-rendering.mjs');
  assert.equal(geometry[0].selector,'.leaf','Leaf geometry must come from the bare .leaf rule; update tools/leaf-rendering.mjs');
  for(const rule of leafRules){
    const bad=declared(rule.body,forbiddenProps).filter(([name,value])=>rule!==geometry[0]||!/^(?:margin|padding|border)$/.test(name)||value!=='0');
    assert(!bad.length,'.leaf rule "'+rule.selector+'" sets '+bad.map(b=>b[0]).join(', ')+', which would move the leaf relative to its layer. Update tools/leaf-rendering.mjs');
  }
  const g=Object.fromEntries(declared(geometry[0].body,geometryProps));
  for(const name of geometryProps.split('|'))assert(g[name],'Original .leaf rule lost its '+name+' declaration; update tools/leaf-rendering.mjs');
  for(const name of geometryProps.split('|')){const bad=[...g[name].matchAll(/var\(\s*(--[\w-]+)/g)].map(m=>m[1]).filter(v=>!['--x','--y','--s','--leaf-ar'].includes(v));
    assert(!bad.length,'Original .leaf '+name+' references '+bad.join(', ')+'; the layer copies geometry and only knows --x/--y/--s/--leaf-ar (the leaf style attribute and :root). Update tools/leaf-rendering.mjs');}
  for(const rule of rules){
    const ar=declared(rule.body,'--leaf-ar').length,xys=declared(rule.body,'--x|--y|--s').map(d=>d[0]);
    assert(!ar||rule.selector===':root','Rule "'+rule.selector+'" now declares --leaf-ar; the layer assumes it comes only from :root. Update tools/leaf-rendering.mjs');
    assert(!xys.length,'Rule "'+rule.selector+'" now declares '+xys.join(', ')+'; the layer assumes --x/--y/--s come only from the leaf style attribute. Update tools/leaf-rendering.mjs');
    for(const sel of rule.selector.split(',').map(x=>x.trim())){
      const flat=sel.replace(/\([^()]*\)/g,'()'),mentions=/\.(?:big)?tree(?![\w-])|\.leaf(?![\w-])|(?<![\w-])button(?![\w-])|\[data-leaf/i.test(sel);
      const hit=/\[data-leaf/i.test(sel)||/\.(?:big)?tree(?![\w-])[^\s>+~]*\s*>/.test(sel)||/>\s*(?:\.leaf|button)(?![\w-])/.test(sel)||mentions&&/[+~]|:nth-|:(?:first|last|only)-(?:child|of-type)/i.test(flat.replace(/\(\)/g,''));
      assert(!hit,'Selector "'+sel+'" now depends on the .tree child structure (child/sibling combinator, :nth-/:first-child/:last-child/:only-child or [data-leaf), which the leaf layer wrapper breaks. Update tools/leaf-rendering.mjs');
    }
  }
  const names=new Set(leafRules.flatMap(rule=>declared(rule.body,'animation|animation-name').flatMap(d=>d[1].split(/[^\w-]+/))));
  for(const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)){
    const bad=names.has(m[1])?[...m[2].matchAll(/[{;]\s*(position|left|top|width)\s*:/gi)].map(x=>x[1]):[];
    assert(!bad.length,'@keyframes '+m[1]+' is applied to .leaf and now sets '+bad.join(', ')+'; the layer owns those properties. Update tools/leaf-rendering.mjs');
  }
  return '\n/* Static leaf layers: unrotated boxes the browser can promote; the button keeps all original motion, shadow and hit targets. */\n'+
    '.tree .hw-leaf-layer{position:absolute;left:'+g.left+';top:'+g.top+';width:'+g.width+';aspect-ratio:'+g['aspect-ratio']+';pointer-events:none}\n'+
    '.tree .hw-leaf-layer>button.leaf{left:0;top:0;width:100%}\n'+
    '@supports selector(:has(*)){\n'+
    '/* promotion gate */\n'+
    '@media (hover: hover){.tree .hw-leaf-layer{will-change:transform}}\n'+
    '@media (hover: hover){.tree .hw-leaf-layer:has(>button.leaf:hover){z-index:5}}\n'+
    '.tree .hw-leaf-layer:has(>.leaf:focus-visible),.tree .hw-leaf-layer:has(>.leaf.is-found){z-index:6}\n'+
    '.tree.is-filtered .hw-leaf-layer:has(>.leaf.is-lit){z-index:4}\n'+
    '}\n';
}

// ponytail: promoted on hover-capable devices only (touch devices render the tree exactly like the original: one shared layer); ~149 layers there
export function prepareLeafRendering(html,originalCss){
  const wrapped=wrapStaticLeaves(html);
  return {html:wrapped.html,leavesWrapped:wrapped.leavesWrapped,css:layerStyles(originalCss,wrapped.leafClasses)};
}
