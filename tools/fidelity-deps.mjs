// Optional pixel-diff seam (pngjs + pixelmatch) for the tree/taste pixel comparisons. Resolved by
// package name from the separately locked tools/browser project (its own lockfile); a missing
// package fails closed with UNSUPPORTED and comparisons never silently pass. The exports are lazy
// forwarding proxies: the first real use resolves the installed package and forwards calls,
// constructions and member access (with owner-bound receivers) to the real pinned implementation, so
// an absent package throws UNSUPPORTED instead of substituting an empty object.
import {createRequire} from 'node:module';
const UNSUPPORTED='UNSUPPORTED: the pixel-diff dependencies (pngjs, pixelmatch) are not available; install the optional dependencies (see docs/TESTING.md)';
const requireFromBrowser=createRequire(new URL('./browser/package.json',import.meta.url));
let api=null,resolved=false;
function load(){
  if(resolved)return api;
  resolved=true;
  try{
    const pngjs=requireFromBrowser('pngjs'),pixelmatch=requireFromBrowser('pixelmatch');
    const match=typeof pixelmatch==='function'?pixelmatch:pixelmatch?.default;
    if(pngjs&&typeof pngjs.PNG==='function'&&typeof match==='function')api={PNG:pngjs.PNG,pixelmatch:match};
  }catch{api=null;}
  return api;
}
function required(){const mod=load();if(!mod)throw Error(UNSUPPORTED);return mod;}
export function fidelityAvailable(){return !!load();}
const RESERVED=new Set(['then','toJSON','inspect','constructor','valueOf','toString']);
const boundMembers=new WeakMap();
function member(owner,prop){
  const value=owner[prop];
  if(typeof value!=='function')return value;
  let cached=boundMembers.get(owner);
  if(!cached)boundMembers.set(owner,cached=new Map());
  if(!cached.has(prop))cached.set(prop,value.bind(owner));
  return cached.get(prop);
}
// One lazy member of the resolved package: get/apply/construct all resolve through required() on use.
// The proxy target is a bound function: callable and constructible like the real members, but owning
// no `prototype` property, so `prototype` (and every other member) forwards freely without Proxy
// invariants forcing a dummy prototype onto a constructed instance.
const lazyTarget=function(){}.bind(undefined);
function lazy(name){
  let proxy;
  proxy=new Proxy(lazyTarget,{
    get:(_,prop)=>{
      if(typeof prop==='symbol')return prop===Symbol.toStringTag?'fidelity-deps':undefined;
      if(RESERVED.has(prop))return undefined;
      return member(required()[name],prop);
    },
    apply:(_,thisArg,args)=>Reflect.apply(required()[name],thisArg,args),
    construct:(_,args,newTarget)=>Reflect.construct(required()[name],args,newTarget===proxy?required()[name]:newTarget)});
  return proxy;
}
export const PNG=lazy('PNG');
export const pixelmatch=lazy('pixelmatch');
export default pixelmatch;
