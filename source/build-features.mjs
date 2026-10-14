// Build-time policy only. No runtime feature switch, browser, worker or network.
export const BUILD_FEATURE_NAMES=Object.freeze(['night','phone','tree-effects','network-effects']);
const fields=['night','phone','treeEffects','networkEffects'];
export function resolveBuildFeatures(exclude){
  let list;
  if(exclude===undefined)list=[];
  else if(typeof exclude==='string'){if(!exclude)throw Error('Feature exclusion must not be empty');list=exclude.split(',');}
  else if(Array.isArray(exclude))list=[...exclude];
  else throw Error('Feature exclusion requires a comma-separated string or array');
  if(list.some(name=>!BUILD_FEATURE_NAMES.includes(name)))throw Error('Unknown or empty build feature exclusion');
  if(new Set(list).size!==list.length)throw Error('Duplicate build feature exclusion');
  const excluded=BUILD_FEATURE_NAMES.filter(name=>list.includes(name));
  return Object.freeze({...Object.fromEntries(fields.map((field,i)=>[field,!excluded.includes(BUILD_FEATURE_NAMES[i])])),
    excluded:Object.freeze(excluded)});
}
export function parseFeatureFlags(args){
  if(!Array.isArray(args)||args.some(value=>typeof value!=='string'))throw Error('Invalid build arguments');
  if(args.length===1&&['--help','-h'].includes(args[0]))return {help:true};
  if(!args.length)return {help:false};
  if(args.length!==1||!args[0].startsWith('--exclude='))throw Error('Unknown or repeated build option');
  return {help:false,exclude:[...resolveBuildFeatures(args[0].slice('--exclude='.length)).excluded]};
}
export function featureEntryScript(experience,exclude){
  const features=resolveBuildFeatures(exclude),taste=experience==='taste';
  if(!['main','taste'].includes(experience))throw Error('Unknown public experience');
  const detector="navigator.userAgentData?.mobile===true||/Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent)"
    +"||(navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<=1100)";
  const theme=features.night?"theme=here.searchParams.get('theme'),osNight=matchMedia('(prefers-color-scheme: dark)').matches,":'';
  const night=features.night?"theme==='dark'||(theme!=='light'&&("+(taste?'true':'false')+"||osNight))":'false';
  const desktop=features.night?'('+(taste?'true':'false')+"||night?'taste/scene.html':'desktop-day.html')":
    JSON.stringify(taste?'taste/scene.html':'desktop-day.html');
  const mobile=features.night?"(night?'mobile/night.html':'mobile/day.html')":"'mobile/day.html'";
  const route=features.phone?'mobile?'+mobile+':'+desktop:desktop;
  return `(()=>{const here=new URL(location.href),base=new URL('${taste?'../':'./'}',here),${theme}`
    +(features.phone?`phone=${detector},mobile=phone&&here.searchParams.get('view')!=='desktop',`:'')
    +(features.night?`night=${night},`:'')
    +`route=${route},target=new URL(route,base);target.search=here.search;target.hash=here.hash;location.replace(target.href)})();`;
}
export function applySceneExclusions(html,exclude){
  const f=resolveBuildFeatures(exclude);
  if(f.night&&f.phone)return html;
  const match=/<script>\s*\/\/ Select the phone composition[\s\S]*?<\/script>/.exec(html);
  if(!match)throw Error('Authored scene dispatcher boundary changed');
  const night=f.night?"theme==='dark'||(theme!=='light'&&(taste||matchMedia('(prefers-color-scheme: dark)').matches))":'false';
  const phone=f.phone?`const phone=navigator.userAgentData?.mobile===true||/Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent)||
    (navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<=1100);
    if(phone&&here.searchParams.get('view')!=='desktop'){const target=new URL(${f.night?"night?'mobile/night.html':'mobile/day.html'":"'mobile/day.html'"},base);
      target.search=here.search;target.hash=here.hash;location.replace(target.href);return;}`:'';
  const mode=f.night?`if(night&&!taste){const target=new URL('taste/',base);target.search=here.search;target.hash=here.hash;location.replace(target.href);return;}
    document.addEventListener('DOMContentLoaded',()=>{const link=document.querySelector('[data-hw-mode]');if(!link)return;
    const update=()=>{const current=new URL(location.href),target=new URL('taste/',base);target.search=current.search;target.hash=current.hash;
      target.searchParams.set('theme',night?'light':'dark');link.href=target.href};update();
    for(const event of ['click','auxclick','focus','contextmenu'])link.addEventListener(event,update);
    link.textContent=night?'Day':'Night';link.setAttribute('aria-label',night?'Use the day scene':'Use the night scene')},{once:true});`:'';
  const head=String.raw`<script>(()=>{const root=document.documentElement,taste=root.dataset.hwExperience==='taste',here=new URL(location.href);
    if(/\/(?:desktop-day|heartwood-site)\.html$|\/taste\/scene\.html$/.test(here.pathname)){
      const canonical=new URL(taste?'./':root.dataset.hwPublicEntry||'./',here);canonical.search=here.search;canonical.hash=here.hash;
      history.replaceState(history.state,'',canonical.href)}
    const base=new URL(taste?'../':'./',here)${f.night?`,theme=here.searchParams.get('theme'),night=${night}`:''};${phone}
    root.dataset.hwTheme=${f.night?"night?'night':'day'":"'day'"};${mode}})();</script>`;
  let changed=html.replace(match[0],head);
  if(!f.night)changed=changed.replace(/<a\b[^>]*\sdata-hw-mode(?=[\s>=/])[^>]*>[\s\S]*?<\/a>/g,'');
  return changed;
}
