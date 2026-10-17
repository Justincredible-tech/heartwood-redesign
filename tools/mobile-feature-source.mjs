import assert from 'node:assert/strict';

function between(text,start,end,label,{unique=true}={}){
  const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
  assert(a>=0&&b>a&&(!unique||text.indexOf(start,a+1)<0),'Phone '+label+' boundary changed');
  return text.slice(0,a)+text.slice(b);
}
export function selectPhoneArt(documents,features){
  assert(documents.every(doc=>['light','dark'].includes(doc.theme)),'Phone art lacks explicit theme provenance');
  return documents.filter(doc=>features.night||doc.theme==='light');
}
export function phoneSourceFeatures({app,state,css},features){
  if(!features.night)css=css.replace(/\.crit--flies\s*\{[^{}]*\}/g,'');
  if(features.networkEffects)return {app,state,css};
  app=between(app,"const NET = JSON.parse($('#hw-net').textContent);",
    '// ------------------------------------------------------------------ the hero tags','network runtime');
  const selection="  if (open && open.closest('#groups')) select(+open.dataset.i, false);\n";
  assert.equal(app.split(selection).length,2,'Owned group-selection consumer changed');
  app=app.replace(selection,'');
  state=between(state,'// nearest spore to a point','// The shared local-picture markup','network helpers');
  // Explicit optional overlay selectors only; list/search/static roots remain.
  css=css.replace(/\.groups \.is-sel a\s*\{[^{}]*\}/g,'');
  css=between(css,'.net__path {','.council {','network overlay styles',{unique:false});
  css=css.replace(/,\s*\.net__(?:path|pin)(?=\s*\{)/g,'');
  css=css.replace('touch-action: manipulation; cursor: pointer;','touch-action: manipulation;');
  assert(!/\bNET\b|\bselect\s*\(|\bnearest\(/.test(app),'Unremoved phone network consumer');
  return {app,state,css};
}
export function phoneHtmlFeatures(html,features){
  if(!features.night){
    html=html.replace('<meta name="color-scheme" content="light dark">','<meta name="color-scheme" content="light">');
    html=html.replace(/<i class="crit crit--flies"><\/i>/g,'');
  }
  if(features.networkEffects)return html;
  const overlays=[/<svg class="net__path"[\s\S]*?<\/svg>/g,
    /<div class="net__pin"[\s\S]*?<\/div>/g,
    /<script type="application\/json" id="hw-net">[\s\S]*?<\/script>/g];
  for(const expression of overlays){assert.equal([...html.matchAll(expression)].length,1,'Phone network markup changed');
    html=html.replace(expression,'')}
  const instruction='Tap near one to find it.';
  const caption='Every member group is a spore on the roots. '+instruction;
  if(html.includes(caption))html=html.replace(caption,'Every member group is a spore on the roots.');
  assert(!/Tap[^.<]*find it\./.test(html),'Phone caption changed: the network-overlay touch instruction must not survive target exclusion');
  return html;
}
export function mobileSelector(features){
  return features.night?null:"(()=>{location.replace('day.html'+location.search+location.hash)})();";
}
