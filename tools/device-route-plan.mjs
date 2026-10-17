// Pure pre-acquisition admission. This module starts no native command/runtime.
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
const routePattern=/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export function unsupportedDeviceEvidence(reason){const e=Error('UNSUPPORTED: '+reason);e.code='HW_DEVICE_EVIDENCE_UNSUPPORTED';e.exitCode=64;return e;}
export function normalizeAndroidPlan({base,routes,parts,tool='android-check'}={}){
 if(typeof base!=='string'||!base.trim()||/%|\\/.test(base)||/(?:^|\/)\.\.?\//.test(base))throw Error('Android --base must use a literal safe route path; encoded/dot segments are ambiguous');
 let url;try{url=new URL(base);}catch{throw Error('Android --base must be a loopback HTTP URL');}
 if(!['http:','https:'].includes(url.protocol)||!LOOPBACK.has(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('Android --base must be a loopback HTTP origin or one exact route, without credentials/query/fragment');
 const pathname=url.pathname.replace(/^\/+|\/+$/g,'');
 if(pathname&&!routePattern.test(pathname))throw Error('Unsupported Android base pathname');
 const routeValues=routes===undefined?(pathname?[pathname]:['optimized','optimized-taste']):routes.split(',');
 if(!routeValues.length||routeValues.some(r=>!routePattern.test(r))||new Set(routeValues).size!==routeValues.length)throw Error('Android --routes requires unique nonempty safe route paths');
 if(pathname&&(routeValues.length!==1||routeValues[0]!==pathname))throw Error('Ambiguous Android base pathname and --routes: use the base origin plus routes, or one matching exact route');
 const partValues=parts===undefined?['shots','interact','abuse']:parts.split(',');
 if(!partValues.length||partValues.some(p=>!['shots','interact','abuse','fling'].includes(p))||new Set(partValues).size!==partValues.length)throw Error('Android --parts requires unique supported names: shots,interact,abuse,fling');
 if(!['android-check','abuse'].includes(tool))throw Error('Unknown Android tool');
 const phoneRoutes=routeValues.filter(r=>/(?:^|\/)(?:optimized-)?(?:mobile|phone)(?:-[A-Za-z0-9_-]+)?(?:\/|$)/.test(r));
 if(phoneRoutes.length&&(tool==='abuse'||partValues.some(p=>['interact','abuse'].includes(p))))throw unsupportedDeviceEvidence('Android phone functional/abuse journeys are not implemented by the desktop-selector driver. No emulator is allocated. Phone diagnostics may be requested explicitly with --parts shots,fling; these do not certify full phone functionality.');
 const origin=url.origin;
 return {origin,routes:routeValues,parts:partValues,phoneRoutes,urls:routeValues.map(route=>({route,url:origin+'/'+route+'/',kind:phoneRoutes.includes(route)?'phone':'desktop'})),scope:phoneRoutes.length?'phone route screenshots/fling diagnostics only; no full journey or physical-device acceptance':'desktop route driver'};
}
export function requireIOSCaptureOracle(){
 // simctl openurl + a sleep proves neither which page Safari displayed nor
 // that its first navigation survived startup. No positive inspector is wired.
 throw unsupportedDeviceEvidence('ios-capture has no verified local Safari URL/content-readiness oracle. No simulator is created or booted and no screenshot is certified. Use independent inspected Safari captures until an owned WebKit oracle is implemented.');
}
