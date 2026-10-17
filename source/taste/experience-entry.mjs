import {resolveBuildFeatures,featureEntryScript} from '../build-features.mjs';
import {createHash} from 'node:crypto';

// These public documents contain no scene assets for Chrome's speculative parser to fetch.
export function entryScript(experience='main',exclude){
 const features=resolveBuildFeatures(exclude);
 if(!features.night||!features.phone)return featureEntryScript(experience,exclude);
 if(!['main','taste'].includes(experience))throw Error('Unknown public experience');
 return `(()=>{const here=new URL(location.href),base=new URL('${experience==='taste'?'../':'./'}',here),theme=here.searchParams.get('theme'),osNight=matchMedia('(prefers-color-scheme: dark)').matches,phone=navigator.userAgentData?.mobile===true||/Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent)||(navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<=1100),mobile=phone&&here.searchParams.get('view')!=='desktop',night=theme==='dark'||(theme!=='light'&&(${experience==='taste'?'true':'false'}||osNight)),route=mobile?(night?'mobile/night.html':'mobile/day.html'):(${experience==='taste'?'true':'false'}||night?'taste/scene.html':'desktop-day.html'),target=new URL(route,base);target.search=here.search;target.hash=here.hash;location.replace(target.href)})();`;
}

export function entryMetadata(htmlSource){
 if(typeof htmlSource!=='string')throw Error('Entry requires readable author metadata source');
 const once=(pattern,label)=>{const matches=[...htmlSource.matchAll(pattern)];if(matches.length!==1)throw Error('Expected one author '+label);return matches[0][0];};
 const title=once(/<title>[\s\S]*?<\/title>/g,'title'),description=once(/<meta name="description" content="[^"]*">/g,'description'),canonical=once(/<link rel="canonical" href="[^"]+">/g,'canonical link');
 const social=[...htmlSource.matchAll(/<meta (?:property="og:[^"]+"|name="twitter:[^"]+")[^>]*>/g)].map(match=>match[0]);
 if(!social.some(tag=>tag.includes('property="og:image"'))||!social.some(tag=>tag.includes('name="twitter:card"')))throw Error('Author social metadata is missing');
 return [title,description,canonical,...social].join('\n');
}

export function experienceEntry(experience='main',{htmlSource,exclude}={}){
 const features=resolveBuildFeatures(exclude);
 const script=entryScript(experience,exclude),digest=createHash('sha256').update(script).digest('base64'),base=experience==='taste'?'../':'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest}'; base-uri 'none'">${entryMetadata(htmlSource)}<script>${script}</script></head><body><noscript><p>Choose a Heartwood scene:</p><a href="${base}desktop-day.html?view=desktop&amp;theme=light">Day</a> ${features.night?`<a href="${base}taste/scene.html?view=desktop&amp;theme=dark">Night</a>`:''} ${features.phone?`<a href="${base}mobile/">Phone</a>`:''}</noscript></body></html>`;
}

export function canonicalSceneUrl(href,{publicMain=''}={}){
 const here=new URL(href);
 if(!/\/(?:desktop-day|heartwood-site)\.html$|\/taste\/scene\.html$/.test(here.pathname))return here.href;
 if(publicMain&&publicMain!=='living-tree.html')throw Error('Unknown packaged main entry');
 const canonical=new URL(here.pathname.endsWith('/taste/scene.html')?'./':publicMain||'./',here);canonical.search=here.search;canonical.hash=here.hash;return canonical.href;
}

// Parent inserts this after `const here = new URL(location.href);` in the authored head.
// It removes private scene filenames from history before a person can bookmark them.
export const CANONICAL_HEAD_PATCH=`if (/\\/(?:desktop-day|heartwood-site)\\.html$|\\/taste\\/scene\\.html$/.test(here.pathname)) {
    const canonical = new URL(taste ? './' : root.dataset.hwPublicEntry || './', here); canonical.search = here.search; canonical.hash = here.hash;
    history.replaceState(history.state, '', canonical.href);
  }`;
