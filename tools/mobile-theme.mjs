// Resolve a static phone page before any picture/CSS art request. No OS-opposite image families are emitted.
export function forceColourScheme(css,theme){
 if(!['light','dark'].includes(theme))throw Error('Invalid fixed phone theme');
 const re=/@media\s*\(prefers-color-scheme:\s*dark\)(\s+and\s+[^{}]+)?\s*\{/g;let output='',cursor=0,match;
 while((match=re.exec(css))){let depth=1,quote='',comment=false,index=re.lastIndex;
  for(;index<css.length&&depth;index++){const ch=css[index],next=css[index+1];if(comment){if(ch==='*'&&next==='/'){comment=false;index++;}continue;}if(quote){if(ch==='\\'){index++;continue;}if(ch===quote)quote='';continue;}if(ch==='/'&&next==='*'){comment=true;index++;continue;}if(ch==='"'||ch==="'"){quote=ch;continue;}if(ch==='{')depth++;else if(ch==='}')depth--;}
  if(depth)throw Error('Unclosed phone night media block');const inner=css.slice(re.lastIndex,index-1),remaining=match[1]?.replace(/^\s+and\s+/,'').trim();if(remaining&&remaining!=='(prefers-reduced-motion: reduce)')throw Error('Unsupported phone night media conjunction: '+remaining);output+=css.slice(cursor,match.index)+(theme==='dark'?(remaining?'@media '+remaining+' {'+inner+'}':inner):'');cursor=index;re.lastIndex=index;
 }
 const fixed=output+css.slice(cursor);if(/@media[^{}]*prefers-color-scheme\s*:\s*dark/.test(fixed))throw Error('Unsupported phone night media query');return fixed+`\n:root { color-scheme: ${theme==='dark'?'dark':'light'}; }\n`;
}
export function fixedPictureArt(art,theme){if(!['light','dark'].includes(theme))throw Error('Invalid fixed phone theme');return Object.fromEntries(Object.entries(art).filter(([name])=>!name.endsWith('-night')).map(([name,a])=>[name,theme==='dark'&&art[name+'-night']?art[name+'-night']:a]));}
export const MOBILE_SELECT=`(()=>{const p=new URLSearchParams(location.search),t=p.get('theme'),n=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);location.replace((n?'night.html':'day.html')+location.search+location.hash)})();`;
