/** Build-side adapter for the authored split source. All changes apply to the taste derivative only. */
import assert from 'node:assert/strict';
import {tasteSource,tasteCss,extractNetwork} from './taste-network.mjs';
import {treeSource,treeCss} from './taste-tree.mjs';
import {darkHtml,darkCss,darkJs,FIREFLY} from './taste-dark.mjs';
import {prepareLeafRendering} from './leaf-rendering.mjs';

const NIGHT='html[data-hw-theme="night"]';
function splitSelectors(value){let depth=0,last=0,out=[];for(let i=0;i<value.length;i++){if('(['.includes(value[i]))depth++;else if(')]'.includes(value[i]))depth--;else if(value[i]===','&&!depth){out.push(value.slice(last,i));last=i+1;}}out.push(value.slice(last));return out;}
export function scopeNightRules(css){
 css=css.replace(/\/\*[\s\S]*?\*\//g,'');let at=0,out='';
 while(at<css.length){const open=css.indexOf('{',at);if(open<0){assert(!css.slice(at).trim(),'Unsupported trailing night CSS');break;}const selector=css.slice(at,open).trim();let depth=1,quote='',end=open+1;
  for(;end<css.length&&depth;end++){const c=css[end];if(quote){if(c==='\\')end++;else if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='{')depth++;else if(c==='}')depth--;}
  assert.equal(depth,0,'Unbalanced night CSS');const body=css.slice(open+1,end-1);
  if(/^@(?:-webkit-)?keyframes\b/.test(selector)||/^@font-face\b/.test(selector))out+=selector+'{'+body+'}\n';
  else if(/^@(supports|media|layer)\b/.test(selector))out+=selector+'{'+scopeNightRules(body)+'}\n';
  else{assert(!selector.startsWith('@'),'Unsupported night CSS rule '+selector);const scoped=splitSelectors(selector).map(s=>{s=s.trim();return /^(?::root|html)(?=$|[\s.:#\[])/.test(s)?s.replace(/^(?::root|html)/,NIGHT):NIGHT+' '+s;});out+=scoped.join(',')+'{'+body+'}\n';}
  at=end;
 }
 return out;
}

function nightCarriers(html){
 const bees=[...html.matchAll(/<div class="bee"[^>]*><span class="bee__bob"><span class="bee__face(?: bee__face--left)?">[\s\S]*?<\/span><\/span><\/div>/g)];
 assert.equal(bees.length,4,'Expected the four authored daytime bees; no count-only approximation');assert.equal(FIREFLY.homes.length,9,'The approved night swarm mapping changed');
 const last=bees.at(-1),end=last.index+last[0].length;assert(/\s*<\/div>/.test(html.slice(end,end+80)),'The bee carriers must be direct children of the meadow swarm');
 const extra=Array.from({length:5},()=>bees[0][0].replace('class="bee"','class="bee hw-firefly-extra"')).join('\n');
 return html.slice(0,end)+'\n'+extra+html.slice(end);
}

export function prepareTaste({html,css}){
 assert(typeof html==='string'&&typeof css==='string'&&html.includes('<html ')&&css.includes('--grain-fine:'),'prepareTaste requires authored split HTML and CSS, not minified publish output');
 assert(!html.includes('data-hw-experience='),'Taste adapter input is already an experience derivative');
 const geometry=html.replace('</head>','<style>'+css+'</style></head>');assert.notEqual(geometry,html,'Authored HTML has no head boundary');
 const network=extractNetwork(geometry);assert(!network.dormant,'Current authored Network must satisfy all taste zones; do not silently ship dormant behavior');
 const leaf=prepareLeafRendering(html,css);assert.equal(leaf.leavesWrapped,149,'All149 original interactive leaves must keep their geometry');
 const faces=darkHtml(leaf.html,{expectedDayBees:4});let changed=nightCarriers(faces.html);
 changed=changed.replace(/<html\b([^>]*)>/,(_,attributes)=>'<html'+attributes+' data-hw-experience="taste">');
 const dark=darkCss(css,faces.css),boundary=dark.indexOf('@supports (color: oklch(');assert(boundary>0,'Night palette support boundary changed');
 const nightCss=dark.slice(0,boundary)+scopeNightRules(dark.slice(boundary));
 return {html:changed,css:leaf.css+tasteCss()+treeCss(css)+'\n.bee.hw-firefly-extra{display:none}\n@supports (color: oklch(from red l c h)){'+NIGHT+' .bee.hw-firefly-extra{display:block}}\n'+nightCss,
  js:tasteSource(geometry)+treeSource(geometry),headJs:darkJs(),
  contract:{treeLeaves:leaf.leavesWrapped,dayBees:4,nightFireflies:9,nightBirdFaces:9,features:['Network overlay and touch','Tree leaf-over-branch','designed day/night critters and palette'],theme:'Root parser-blocking dispatch selects dataset.hwTheme; direct taste defaultsnight and explicitlight selectsday',grain:'Night uses original eight fine layers plus three mottles with approved night alpha; live fallback cost is unmeasured, no equivalence claim for daytime tile'},
  limitations:['Night live grain performance must be measured; dedicated night tiles are a follow-up, never substitute a daytime tile as equivalent','No per-instance compositor or physical-device acceptance is implied by a source build']};
}
